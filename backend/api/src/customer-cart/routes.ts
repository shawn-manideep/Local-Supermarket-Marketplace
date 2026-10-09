import { and, asc, eq, ne, sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { assertStoreOrderable, storeOrderability } from "../orders/orderability.js";
import {
  customerCartItemCreateSchema,
  customerCartItemIdParamSchema,
  customerCartItemUpdateSchema,
  customerCheckoutValidationSchema,
} from "@workspace/validation";
import {
  cartItems, carts, customerAddresses, getDb, masterProducts, productVariants, products,
  storeServicePincodes, stores,
} from "@workspace/db";
import { requireRole } from "../auth/index.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError, validationDetails } from "../http.js";
import { centsToMoney, moneyToCents } from "./money.js";
import { stockError } from "../orders/inventory.js";

export const customerCartRouter = Router();

export function cartStatusAfterItemRemoval(remainingItemCount: number) {
  return remainingItemCount === 0 ? "ABANDONED" as const : "ACTIVE" as const;
}

function customerId(request: Request) {
  const id = (request as AuthenticatedRequest).auth?.userId;
  if (!id) throw new HttpError(401, "Authentication required");
  return id;
}

async function activeCart(ownerId: string) {
  const [cart] = await getDb().select({
    id: carts.id, storeId: carts.storeId, status: carts.status,
    storeName: stores.name, deliveryFee: stores.deliveryFee,
    minimumOrderValue: stores.minimumOrderValue,
  }).from(carts).innerJoin(stores, eq(stores.id, carts.storeId))
    .where(and(eq(carts.customerId, ownerId), eq(carts.status, "ACTIVE")))
    .orderBy(asc(carts.createdAt)).limit(1);
  return cart ?? null;
}

export async function cartResponse(ownerId: string) {
  const cart = await activeCart(ownerId);
  if (!cart) return null;
  const rows = await getDb().select({
    id: cartItems.id, productId: products.id,
    name: sql<string>`coalesce(${masterProducts.name}, ${products.name})`.as("name"),
    description: sql<string | null>`coalesce(${products.description}, ${masterProducts.description})`.as("description"),
    imageUrl: sql<string | null>`coalesce(${products.imageUrl}, ${masterProducts.image})`.as("imageUrl"),
    quantity: cartItems.quantity,
    variantId: productVariants.id, variantName: productVariants.name,
    quantityValue: productVariants.quantityValue, quantityUnit: productVariants.quantityUnit,
    unitPrice: productVariants.price, availability: productVariants.availability,
    isActive: productVariants.isActive, stockQuantity: productVariants.stockQuantity,
    productAvailability: products.availability, productIsActive: products.isActive,
  }).from(cartItems).innerJoin(products, eq(products.id, cartItems.productId))
    .leftJoin(masterProducts, eq(masterProducts.id, products.masterProductId))
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .where(eq(cartItems.cartId, cart.id)).orderBy(asc(products.name)).limit(100);
  const items = rows.map(({ isActive, stockQuantity, productAvailability, productIsActive, ...item }) => ({
    ...item,
    lineSubtotal: centsToMoney(moneyToCents(item.unitPrice) * BigInt(item.quantity)),
    purchasable: productIsActive && productAvailability && isActive && item.availability && item.quantity <= stockQuantity,
    unavailableReason: !productIsActive || !productAvailability || !isActive || !item.availability ? "VARIANT_UNAVAILABLE"
      : stockQuantity === 0 ? "OUT_OF_STOCK" : item.quantity > stockQuantity ? "INSUFFICIENT_STOCK" : null,
  }));
  const subtotalCents = items.reduce((sum, item) => sum + moneyToCents(item.lineSubtotal), 0n);
  const deliveryCents = moneyToCents(cart.deliveryFee);
  const minimumCents = moneyToCents(cart.minimumOrderValue);
  const { operatingStatus, scheduledDeliveryAvailable } = await storeOrderability(cart.storeId);
  return {
    id: cart.id, storeId: cart.storeId, storeName: cart.storeName, status: cart.status,
    operatingStatus,
    instantDeliveryAvailable: operatingStatus === "OPEN", scheduledDeliveryAvailable,
    items, subtotal: centsToMoney(subtotalCents), deliveryFee: cart.deliveryFee,
    minimumOrderValue: cart.minimumOrderValue,
    total: centsToMoney(subtotalCents + deliveryCents),
    checkoutReady: (operatingStatus === "OPEN" || scheduledDeliveryAvailable) && items.length > 0 && items.every((item) => item.purchasable) && subtotalCents >= minimumCents,
  };
}

customerCartRouter.get("/api/customer/cart", requireRole("customer"), asyncHandler(async (request, response) => {
  response.json({ cart: await cartResponse(customerId(request)) });
}));

customerCartRouter.post("/api/customer/cart/items", requireRole("customer"), asyncHandler(async (request, response) => {
  const parsed = customerCartItemCreateSchema.safeParse(request.body);
  if (!parsed.success) throw new HttpError(400, "Invalid cart item", validationDetails(parsed.error),
    parsed.error.issues.some(issue => issue.path[0] === "quantity") ? "INVALID_QUANTITY" : undefined);
  const ownerId = customerId(request);
  await getDb().transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`);
    const [variant] = await transaction.select({
      id: products.id, storeId: products.storeId, name: products.name,
      isActive: products.isActive, availability: products.availability,
      variantId: productVariants.id, variantActive: productVariants.isActive,
      variantAvailability: productVariants.availability, stockQuantity: productVariants.stockQuantity,
      productName: products.name, variantName: productVariants.name,
      storeName: stores.name,
    }).from(products).innerJoin(stores, eq(stores.id, products.storeId))
      .innerJoin(productVariants, eq(productVariants.productId, products.id))
      .where(and(eq(products.id, parsed.data.productId), eq(productVariants.id, parsed.data.variantId),
        eq(stores.status, "ACTIVE")))
      .limit(1).for("share");
    if (!variant || !variant.isActive || !variant.variantActive) throw new HttpError(404, "Product variant not available");
    // The joined store already has a SHARE lock; hours writers take its UPDATE lock.
    await assertStoreOrderable(variant.storeId, transaction, false, "CART");
    if (!variant.availability || !variant.variantAvailability) throw stockError("VARIANT_UNAVAILABLE", variant);
    if (variant.stockQuantity === 0) throw stockError("OUT_OF_STOCK", variant);
    if (parsed.data.quantity > variant.stockQuantity) throw stockError("INSUFFICIENT_STOCK", variant);
    const [eligible] = await transaction.select({ id: customerAddresses.id }).from(customerAddresses)
      .innerJoin(storeServicePincodes, eq(storeServicePincodes.pincode, customerAddresses.pincode))
      .where(and(eq(customerAddresses.customerId, ownerId), eq(storeServicePincodes.storeId, variant.storeId))).limit(1);
    if (!eligible) throw new HttpError(404, "Store is not available for your saved addresses");
    const [existing] = await transaction.select({
      id: carts.id, storeId: carts.storeId, storeName: stores.name,
    }).from(carts).innerJoin(stores, eq(stores.id, carts.storeId))
      .where(and(eq(carts.customerId, ownerId), eq(carts.status, "ACTIVE")))
      .orderBy(asc(carts.createdAt)).limit(1);
    if (existing && existing.storeId !== variant.storeId && !parsed.data.confirmStoreSwitch) {
      throw new HttpError(409, "Store switch required", {
        code: "STORE_SWITCH_REQUIRED",
        existingStore: { id: existing.storeId, name: existing.storeName },
        requestedStore: { id: variant.storeId, name: variant.storeName },
      });
    }
    if (existing && existing.storeId !== variant.storeId) {
      await transaction.update(carts).set({ status: "ABANDONED", updatedAt: new Date() })
        .where(and(eq(carts.customerId, ownerId), eq(carts.status, "ACTIVE"), ne(carts.storeId, variant.storeId)));
    }
    let [cart] = await transaction.select({ id: carts.id }).from(carts)
      .where(and(eq(carts.customerId, ownerId), eq(carts.storeId, variant.storeId), eq(carts.status, "ACTIVE"))).limit(1);
    if (!cart) {
      [cart] = await transaction.insert(carts).values({ customerId: ownerId, storeId: variant.storeId })
        .onConflictDoNothing().returning({ id: carts.id });
      if (!cart) [cart] = await transaction.select({ id: carts.id }).from(carts)
        .where(and(eq(carts.customerId, ownerId), eq(carts.storeId, variant.storeId), eq(carts.status, "ACTIVE"))).limit(1);
    }
    if (!cart) throw new HttpError(409, "Unable to create active cart");
    const [existingLine] = await transaction.select({ quantity: cartItems.quantity }).from(cartItems)
      .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, variant.variantId))).limit(1);
    if ((existingLine?.quantity ?? 0) + parsed.data.quantity > 999) throw stockError("INVALID_QUANTITY", variant);
    const [item] = await transaction.insert(cartItems)
      .values({ cartId: cart.id, productId: variant.id, variantId: variant.variantId, quantity: parsed.data.quantity })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.variantId],
        set: { quantity: sql`${cartItems.quantity} + ${parsed.data.quantity}`, updatedAt: new Date() },
        where: sql`${cartItems.quantity} + ${parsed.data.quantity} <= ${variant.stockQuantity}
          AND ${cartItems.quantity} + ${parsed.data.quantity} <= 999`,
      }).returning({ id: cartItems.id });
    if (!item) throw stockError("INSUFFICIENT_STOCK", variant);
  });
  response.status(201).json({ cart: await cartResponse(ownerId) });
}));

customerCartRouter.patch("/api/customer/cart/items/:itemId", requireRole("customer"), asyncHandler(async (request, response) => {
  const params = customerCartItemIdParamSchema.safeParse(request.params);
  const body = customerCartItemUpdateSchema.safeParse(request.body);
  if (!params.success || !body.success) throw new HttpError(400, "Invalid cart item update");
  const ownerId = customerId(request);
  await getDb().transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`);
    const [owned] = await transaction.select({
      id: cartItems.id, cartId: cartItems.cartId, stock: productVariants.stockQuantity,
      currentQuantity: cartItems.quantity,
      productName: products.name, variantName: productVariants.name,
      active: productVariants.isActive, available: productVariants.availability,
      productActive: products.isActive, productAvailable: products.availability,
      productStoreId: products.storeId, cartStoreId: carts.storeId,
      storeActive: stores.status,
    }).from(cartItems).innerJoin(carts, eq(carts.id, cartItems.cartId))
      .innerJoin(products, eq(products.id, cartItems.productId))
      .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
      .innerJoin(stores, eq(stores.id, products.storeId))
      .where(and(eq(cartItems.id, params.data.itemId), eq(carts.customerId, ownerId), eq(carts.status, "ACTIVE")))
      .limit(1).for("share");
    if (!owned) throw new HttpError(404, "Cart item not found");
    if (body.data.quantity === 0) {
      await transaction.delete(cartItems).where(eq(cartItems.id, owned.id));
      const remaining = await transaction.select({ id: cartItems.id }).from(cartItems)
        .where(eq(cartItems.cartId, owned.cartId)).limit(1);
      if (cartStatusAfterItemRemoval(remaining.length) === "ABANDONED") {
        await transaction.update(carts).set({ status: "ABANDONED", updatedAt: new Date() })
          .where(and(eq(carts.id, owned.cartId), eq(carts.customerId, ownerId), eq(carts.status, "ACTIVE")));
      }
    } else {
      if (body.data.quantity > owned.currentQuantity) await assertStoreOrderable(owned.cartStoreId, transaction, false, "CART");
      if (!owned.active || !owned.available || !owned.productActive || !owned.productAvailable ||
        owned.productStoreId !== owned.cartStoreId || owned.storeActive !== "ACTIVE") {
        throw stockError("VARIANT_UNAVAILABLE", owned);
      }
      if (owned.stock === 0) throw stockError("OUT_OF_STOCK", owned);
      if (body.data.quantity > owned.stock) throw stockError("INSUFFICIENT_STOCK", owned);
      await transaction.update(cartItems).set({ quantity: body.data.quantity, updatedAt: new Date() }).where(eq(cartItems.id, owned.id));
    }
  });
  response.json({ cart: await cartResponse(ownerId) });
}));

customerCartRouter.delete("/api/customer/cart/items/:itemId", requireRole("customer"), asyncHandler(async (request, response) => {
  const params = customerCartItemIdParamSchema.safeParse(request.params);
  if (!params.success) throw new HttpError(400, "Invalid cart item ID");
  const ownerId = customerId(request);
  await getDb().transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`);
    const [owned] = await transaction.select({ id: cartItems.id, cartId: cartItems.cartId }).from(cartItems)
      .innerJoin(carts, eq(carts.id, cartItems.cartId))
      .where(and(eq(cartItems.id, params.data.itemId), eq(carts.customerId, ownerId), eq(carts.status, "ACTIVE"))).limit(1);
    if (!owned) throw new HttpError(404, "Cart item not found");
    await transaction.delete(cartItems).where(eq(cartItems.id, owned.id));
    const remaining = await transaction.select({ id: cartItems.id }).from(cartItems)
      .where(eq(cartItems.cartId, owned.cartId)).limit(1);
    if (cartStatusAfterItemRemoval(remaining.length) === "ABANDONED") {
      await transaction.update(carts).set({ status: "ABANDONED", updatedAt: new Date() })
        .where(and(eq(carts.id, owned.cartId), eq(carts.customerId, ownerId), eq(carts.status, "ACTIVE")));
    }
  });
  response.json({ cart: await cartResponse(ownerId) });
}));

customerCartRouter.delete("/api/customer/cart", requireRole("customer"), asyncHandler(async (request, response) => {
  const ownerId = customerId(request);
  await getDb().transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`);
    await transaction.update(carts).set({ status: "ABANDONED", updatedAt: new Date() })
      .where(and(eq(carts.customerId, ownerId), eq(carts.status, "ACTIVE")));
  });
  response.status(204).send();
}));

customerCartRouter.post("/api/customer/checkout/validate", requireRole("customer"), asyncHandler(async (request, response) => {
  const parsed = customerCheckoutValidationSchema.safeParse(request.body);
  if (!parsed.success) throw new HttpError(400, "Invalid checkout request", validationDetails(parsed.error));
  const ownerId = customerId(request);
  const checkout = await getDb().transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`);
    const [cartRecord] = await transaction.select({
      id: carts.id, storeId: carts.storeId,
    }).from(carts).where(and(eq(carts.customerId, ownerId), eq(carts.status, "ACTIVE"))).limit(1).for("share");
    if (!cartRecord) throw new HttpError(409, "Cart is empty");
    const rows = await transaction.select({
      id: cartItems.id, quantity: cartItems.quantity, unitPrice: productVariants.price,
      productName: products.name, variantName: productVariants.name,
      active: productVariants.isActive, available: productVariants.availability, stock: productVariants.stockQuantity,
      productActive: products.isActive, productAvailable: products.availability,
      productId: products.id, productStoreId: products.storeId, variantProductId: productVariants.productId,
    }).from(cartItems).innerJoin(products, eq(products.id, cartItems.productId))
      .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
      .where(eq(cartItems.cartId, cartRecord.id)).for("share");
    if (rows.length === 0) throw new HttpError(409, "Cart is empty");
    if (rows.some((item) => item.productStoreId !== cartRecord.storeId || item.variantProductId !== item.productId)) {
      throw new HttpError(409, "Cart contains a product from another store");
    }
    for (const item of rows) {
      if (!item.active || !item.available || !item.productActive || !item.productAvailable) throw stockError("VARIANT_UNAVAILABLE", item);
      if (item.stock === 0) throw stockError("OUT_OF_STOCK", item);
      if (item.quantity > item.stock) throw stockError("INSUFFICIENT_STOCK", item);
    }
    const [address] = await transaction.select().from(customerAddresses)
      .where(and(eq(customerAddresses.id, parsed.data.addressId), eq(customerAddresses.customerId, ownerId))).limit(1).for("share");
    if (!address) throw new HttpError(404, "Delivery address not found");
    const [store] = await transaction.select({
      status: stores.status, deliveryFee: stores.deliveryFee, minimumOrderValue: stores.minimumOrderValue,
    }).from(stores).innerJoin(storeServicePincodes, and(eq(storeServicePincodes.storeId, stores.id), eq(storeServicePincodes.pincode, address.pincode)))
      .where(eq(stores.id, cartRecord.storeId)).limit(1).for("share");
    if (!store || store.status !== "ACTIVE") throw new HttpError(409, "Store cannot deliver to the selected address");
    const subtotalCents = rows.reduce((sum, item) => sum + moneyToCents(item.unitPrice) * BigInt(item.quantity), 0n);
    if (subtotalCents < moneyToCents(store.minimumOrderValue)) throw new HttpError(409, `Minimum order value is ${store.minimumOrderValue}`);
    return {
      cartId: cartRecord.id, storeId: cartRecord.storeId, address,
      paymentMethod: "COD" as const, subtotal: centsToMoney(subtotalCents), deliveryFee: store.deliveryFee,
      total: centsToMoney(subtotalCents + moneyToCents(store.deliveryFee)), ready: true as const,
    };
  }, { isolationLevel: "serializable" });
  response.json({ checkout });
}));