import { and, asc, eq, ne, sql } from "drizzle-orm";
import { Router, type Request } from "express";
import {
  customerCartItemCreateSchema,
  customerCartItemIdParamSchema,
  customerCartItemUpdateSchema,
  customerCheckoutValidationSchema,
} from "@workspace/validation";
import {
  cartItems, carts, customerAddresses, getDb, products,
  storeServicePincodes, stores,
} from "@workspace/db";
import { requireRole } from "../auth/index.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError, validationDetails } from "../http.js";
import { centsToMoney, moneyToCents } from "./money.js";

export const customerCartRouter = Router();

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

async function cartResponse(ownerId: string) {
  const cart = await activeCart(ownerId);
  if (!cart) return null;
  const rows = await getDb().select({
    id: cartItems.id, productId: products.id, name: products.name,
    imageUrl: products.imageUrl, quantity: cartItems.quantity,
    unitPrice: products.price, availability: products.availability,
    isActive: products.isActive, stockQuantity: products.stockQuantity,
  }).from(cartItems).innerJoin(products, eq(products.id, cartItems.productId))
    .where(eq(cartItems.cartId, cart.id)).orderBy(asc(products.name)).limit(100);
  const items = rows.map(({ isActive, stockQuantity, ...item }) => ({
    ...item,
    lineSubtotal: centsToMoney(moneyToCents(item.unitPrice) * BigInt(item.quantity)),
    purchasable: isActive && item.availability && item.quantity <= stockQuantity,
  }));
  const subtotalCents = items.reduce((sum, item) => sum + moneyToCents(item.lineSubtotal), 0n);
  const deliveryCents = moneyToCents(cart.deliveryFee);
  const minimumCents = moneyToCents(cart.minimumOrderValue);
  return {
    id: cart.id, storeId: cart.storeId, storeName: cart.storeName, status: cart.status,
    items, subtotal: centsToMoney(subtotalCents), deliveryFee: cart.deliveryFee,
    minimumOrderValue: cart.minimumOrderValue,
    total: centsToMoney(subtotalCents + deliveryCents),
    checkoutReady: items.length > 0 && items.every((item) => item.purchasable) && subtotalCents >= minimumCents,
  };
}

customerCartRouter.get("/api/customer/cart", requireRole("customer"), asyncHandler(async (request, response) => {
  response.json({ cart: await cartResponse(customerId(request)) });
}));

customerCartRouter.post("/api/customer/cart/items", requireRole("customer"), asyncHandler(async (request, response) => {
  const parsed = customerCartItemCreateSchema.safeParse(request.body);
  if (!parsed.success) throw new HttpError(400, "Invalid cart item", validationDetails(parsed.error));
  const ownerId = customerId(request);
  await getDb().transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`);
    const [product] = await transaction.select({
      id: products.id, storeId: products.storeId, name: products.name,
      isActive: products.isActive, availability: products.availability,
      stockQuantity: products.stockQuantity, storeName: stores.name,
    }).from(products).innerJoin(stores, eq(stores.id, products.storeId))
      .where(and(eq(products.id, parsed.data.productId), eq(stores.status, "ACTIVE")))
      .limit(1).for("share");
    if (!product || !product.isActive) throw new HttpError(404, "Product not available");
    if (!product.availability) throw new HttpError(409, "Product is currently unavailable");
    if (parsed.data.quantity > product.stockQuantity) throw new HttpError(409, "Requested quantity exceeds available stock");
    const [eligible] = await transaction.select({ id: customerAddresses.id }).from(customerAddresses)
      .innerJoin(storeServicePincodes, eq(storeServicePincodes.pincode, customerAddresses.pincode))
      .where(and(eq(customerAddresses.customerId, ownerId), eq(storeServicePincodes.storeId, product.storeId))).limit(1);
    if (!eligible) throw new HttpError(404, "Store is not available for your saved addresses");
    const [existing] = await transaction.select({
      id: carts.id, storeId: carts.storeId, storeName: stores.name,
    }).from(carts).innerJoin(stores, eq(stores.id, carts.storeId))
      .where(and(eq(carts.customerId, ownerId), eq(carts.status, "ACTIVE")))
      .orderBy(asc(carts.createdAt)).limit(1);
    if (existing && existing.storeId !== product.storeId && !parsed.data.confirmStoreSwitch) {
      throw new HttpError(409, "Store switch required", {
        code: "STORE_SWITCH_REQUIRED",
        existingStore: { id: existing.storeId, name: existing.storeName },
        requestedStore: { id: product.storeId, name: product.storeName },
      });
    }
    if (existing && existing.storeId !== product.storeId) {
      await transaction.update(carts).set({ status: "ABANDONED", updatedAt: new Date() })
        .where(and(eq(carts.customerId, ownerId), eq(carts.status, "ACTIVE"), ne(carts.storeId, product.storeId)));
    }
    let [cart] = await transaction.select({ id: carts.id }).from(carts)
      .where(and(eq(carts.customerId, ownerId), eq(carts.storeId, product.storeId), eq(carts.status, "ACTIVE"))).limit(1);
    if (!cart) {
      [cart] = await transaction.insert(carts).values({ customerId: ownerId, storeId: product.storeId })
        .onConflictDoNothing().returning({ id: carts.id });
      if (!cart) [cart] = await transaction.select({ id: carts.id }).from(carts)
        .where(and(eq(carts.customerId, ownerId), eq(carts.storeId, product.storeId), eq(carts.status, "ACTIVE"))).limit(1);
    }
    if (!cart) throw new HttpError(409, "Unable to create active cart");
    const [item] = await transaction.insert(cartItems)
      .values({ cartId: cart.id, productId: product.id, quantity: parsed.data.quantity })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.productId],
        set: { quantity: sql`${cartItems.quantity} + ${parsed.data.quantity}`, updatedAt: new Date() },
        where: sql`${cartItems.quantity} + ${parsed.data.quantity} <= ${product.stockQuantity}`,
      }).returning({ id: cartItems.id });
    if (!item) throw new HttpError(409, "Cart quantity would exceed available stock");
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
      id: cartItems.id, stock: products.stockQuantity, active: products.isActive,
      available: products.availability,
    }).from(cartItems).innerJoin(carts, eq(carts.id, cartItems.cartId))
      .innerJoin(products, eq(products.id, cartItems.productId))
      .where(and(eq(cartItems.id, params.data.itemId), eq(carts.customerId, ownerId), eq(carts.status, "ACTIVE")))
      .limit(1).for("share");
    if (!owned) throw new HttpError(404, "Cart item not found");
    if (body.data.quantity === 0) await transaction.delete(cartItems).where(eq(cartItems.id, owned.id));
    else {
      if (!owned.active || !owned.available) throw new HttpError(409, "Product is no longer available");
      if (body.data.quantity > owned.stock) throw new HttpError(409, "Requested quantity exceeds available stock");
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
    const [owned] = await transaction.select({ id: cartItems.id }).from(cartItems)
      .innerJoin(carts, eq(carts.id, cartItems.cartId))
      .where(and(eq(cartItems.id, params.data.itemId), eq(carts.customerId, ownerId), eq(carts.status, "ACTIVE"))).limit(1);
    if (!owned) throw new HttpError(404, "Cart item not found");
    await transaction.delete(cartItems).where(eq(cartItems.id, owned.id));
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
      id: cartItems.id, quantity: cartItems.quantity, unitPrice: products.price,
      active: products.isActive, available: products.availability, stock: products.stockQuantity,
      productStoreId: products.storeId,
    }).from(cartItems).innerJoin(products, eq(products.id, cartItems.productId))
      .where(eq(cartItems.cartId, cartRecord.id)).for("share");
    if (rows.length === 0) throw new HttpError(409, "Cart is empty");
    if (rows.some((item) => item.productStoreId !== cartRecord.storeId)) {
      throw new HttpError(409, "Cart contains a product from another store");
    }
    if (rows.some((item) => !item.active || !item.available || item.quantity > item.stock)) {
      throw new HttpError(409, "One or more cart products are unavailable or out of stock");
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