import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";
import {
  carts, cartItems, categories, customerAddresses, customerRepeatRequests, getDb, masterProducts, orderItems, productVariants,
  orderStatusHistory, orders, products, storeServicePincodes, stores,
} from "@workspace/db";
import {
  adminOrderQuerySchema, customerOrderCreateSchema, customerOrderIdParamSchema,
  customerOrderRepeatPreviewQuerySchema, customerOrderRepeatSchema,
  vendorOrderActionSchema, vendorOrderQuerySchema,
} from "@workspace/validation";
import { requireRole } from "../auth/index.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError, validationDetails } from "../http.js";
import { cartResponse } from "../customer-cart/routes.js";
import { centsToMoney, moneyToCents } from "../customer-cart/money.js";
import { commissionCents, DEFAULT_COMMISSION_RATE, LEGAL_ORDER_TRANSITIONS } from "./lifecycle.js";
import { evaluateReorderLine } from "./reorder.js";
import { checkoutReplay, deductStock, restoreOrderStock, stockError } from "./inventory.js";
import { assertStoreOrderable, deliverySnapshot, storeOrderability } from "./orderability.js";

export const ordersRouter = Router();
function userId(req: Request) {
  const id = (req as AuthenticatedRequest).auth?.userId;
  if (!id) throw new HttpError(401, "Authentication required");
  return id;
}
function orderId(req: Request) {
  const p = customerOrderIdParamSchema.safeParse(req.params);
  if (!p.success) throw new HttpError(400, "Invalid order ID", validationDetails(p.error));
  return p.data.orderId;
}
const safeOrderFields = {
  id: orders.id, storeId: orders.storeId, status: orders.status, deliveryType: orders.deliveryType,
  deliveryMode: orders.deliveryMode, scheduledStartAt: orders.scheduledStartAt, scheduledEndAt: orders.scheduledEndAt,
  paymentMethod: orders.paymentMethod, subtotal: orders.subtotal,
  deliveryFeeSnapshot: orders.deliveryFeeSnapshot, totalAmount: orders.totalAmount,
  deliveryAddressSnapshot: orders.deliveryAddressSnapshot, deliveryContactName: orders.deliveryContactName,
  deliveryContactPhone: orders.deliveryContactPhone, createdAt: orders.createdAt, updatedAt: orders.updatedAt,
};
const safeOrderSummaryFields = {
  id: orders.id, storeId: orders.storeId, status: orders.status,
  deliveryMode: orders.deliveryMode, scheduledStartAt: orders.scheduledStartAt, scheduledEndAt: orders.scheduledEndAt,
  totalAmount: orders.totalAmount, createdAt: orders.createdAt,
};
const vendorOrderSummaryFields = {
  ...safeOrderSummaryFields, deliveryType: orders.deliveryType,
  paymentMethod: orders.paymentMethod, deliveryAddressSnapshot: orders.deliveryAddressSnapshot,
  deliveryContactName: orders.deliveryContactName,
};
const safeItemFields = {
  id: orderItems.id, productNameSnapshot: orderItems.productNameSnapshot,
  productPriceSnapshot: orderItems.productPriceSnapshot, quantity: orderItems.quantity, subtotal: orderItems.subtotal,
  variantId: orderItems.variantId, variantNameSnapshot: orderItems.variantNameSnapshot,
  variantQuantityValueSnapshot: orderItems.variantQuantityValueSnapshot,
  variantQuantityUnitSnapshot: orderItems.variantQuantityUnitSnapshot,
};
const safeHistoryFields = {
  id: orderStatusHistory.id, status: orderStatusHistory.status,
  note: orderStatusHistory.note, createdAt: orderStatusHistory.createdAt,
};
const ORDER_STATUSES = [
  "PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY",
  "DELIVERED", "REJECTED", "CANCELLED",
] as const;
function addressSnapshot(address: typeof customerAddresses.$inferSelect) {
  return {
    label: address.label, recipientName: address.recipientName, phone: address.phone,
    line1: address.line1, line2: address.line2, city: address.city,
    state: address.state, pincode: address.pincode,
  };
}

const repeatPreviewQuerySchema = customerOrderRepeatPreviewQuerySchema;
const repeatOrderBodySchema = customerOrderRepeatSchema;

type RepeatIntent = { sourceOrderId: string; addressId: string; confirmStoreSwitch: boolean; orderItemId?: string | null };
export function repeatIntentMatches(existing: RepeatIntent, requested: RepeatIntent) {
  return existing.sourceOrderId === requested.sourceOrderId &&
    existing.addressId === requested.addressId &&
    existing.confirmStoreSwitch === requested.confirmStoreSwitch &&
    (existing.orderItemId ?? null) === (requested.orderItemId ?? null);
}

export function planRepeatLineAdditions(
  lines: Array<{ variantId: string | null; quantity: number; stockQuantity: number | null; available: boolean }>,
  currentQuantities: Map<string, number>,
) {
  return lines.map((line) => {
    if (!line.available || !line.variantId || line.stockQuantity === null ||
      !Number.isInteger(line.quantity) || line.quantity < 1 ||
      !Number.isInteger(line.stockQuantity)) return false;
    const current = currentQuantities.get(line.variantId) ?? 0;
    if (!Number.isInteger(current) || current < 0 ||
      current + line.quantity > line.stockQuantity || current + line.quantity > 999) return false;
    currentQuantities.set(line.variantId, current + line.quantity);
    return true;
  });
}

async function repeatOrderPreviewData(
  db: ReturnType<typeof getDb>,
  customerId: string,
  id: string,
  addressId: string,
  selectedOrderItemId?: string,
) {
  const [order] = await db.select({
    id: orders.id, storeId: orders.storeId, storeName: stores.name,
  }).from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(eq(orders.id, id), eq(orders.customerId, customerId))).limit(1);
  if (!order) throw new HttpError(404, "Order not found");
  const [address] = await db.select().from(customerAddresses)
    .where(and(eq(customerAddresses.id, addressId), eq(customerAddresses.customerId, customerId))).limit(1);
  if (!address) throw new HttpError(404, "Delivery address not found");
  const [store] = await db.select({
    status: stores.status,
  }).from(stores).innerJoin(storeServicePincodes, and(
    eq(storeServicePincodes.storeId, stores.id),
    eq(storeServicePincodes.pincode, address.pincode),
  )).where(eq(stores.id, order.storeId)).limit(1);
  const storeAvailable = store?.status === "ACTIVE" &&
    (await storeOrderability(order.storeId, db)).operatingStatus === "OPEN";
  const [activeCart] = await db.select({ id: carts.id, storeId: carts.storeId, storeName: stores.name }).from(carts)
    .innerJoin(stores, eq(stores.id, carts.storeId))
    .where(and(eq(carts.customerId, customerId), eq(carts.status, "ACTIVE")))
    .orderBy(asc(carts.createdAt)).limit(1);
  const storeSwitchRequired = Boolean(activeCart && activeCart.storeId !== order.storeId);
  const rows = await db.select({
    orderItemId: orderItems.id,
    orderProductId: orderItems.productId,
    originalVariantId: orderItems.variantId,
    productName: orderItems.productNameSnapshot,
    variantNameSnapshot: orderItems.variantNameSnapshot,
    quantity: orderItems.quantity,
    currentUnitPrice: productVariants.price,
    variantId: productVariants.id,
    variantProductId: productVariants.productId,
    productId: products.id,
    productStoreId: products.storeId,
    productActive: products.isActive,
    productAvailable: products.availability,
    variantActive: productVariants.isActive,
    variantAvailable: productVariants.availability,
    stockQuantity: productVariants.stockQuantity,
  }).from(orderItems).leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(orderItems.orderId, order.id),
      selectedOrderItemId ? eq(orderItems.id, selectedOrderItemId) : undefined))
    .orderBy(asc(orderItems.createdAt));
  if (selectedOrderItemId && rows.length === 0) throw new HttpError(404, "Order item not found");
  const existingItems = activeCart?.storeId === order.storeId
    ? await db.select({ variantId: cartItems.variantId, quantity: cartItems.quantity })
      .from(cartItems).where(eq(cartItems.cartId, activeCart.id))
    : [];
  const quantities = new Map(existingItems.map(item => [item.variantId, item.quantity]));
  const evaluated = rows.map(row => evaluateReorderLine(row, order.storeId, storeAvailable));
  const planned = planRepeatLineAdditions(rows.map((row, index) => ({
    variantId: row.variantId, quantity: row.quantity, stockQuantity: row.stockQuantity,
    available: evaluated[index]!.available,
  })), quantities);
  const items = evaluated.map((item, index) => item.available && !planned[index]
    ? { ...item, available: false, currentUnitPrice: null, reason: "Insufficient stock for cart quantity" }
    : item);
  return { storeAvailable, storeSwitchRequired, storeName: order.storeName,
    existingStoreName: storeSwitchRequired ? activeCart!.storeName : null,
    items, canAddCount: items.filter((item) => item.available).length, order };
}

ordersRouter.post("/api/customer/orders", requireRole("customer"), asyncHandler(async (req, res) => {
  const parsed = customerOrderCreateSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid order request", validationDetails(parsed.error));
  const customerId = userId(req);
  const result = await getDb().transaction(async (tx) => {
    // Keep all order/cart work serialized per customer, including concurrent checkout requests.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${customerId}, 0))`);
    const replay = await checkoutReplay(tx, customerId, parsed.data);
    if (replay) return { id: replay };
    const [cart] = await tx.select().from(carts)
      .where(and(eq(carts.id, parsed.data.cartId), eq(carts.customerId, customerId), eq(carts.status, "ACTIVE"))).limit(1).for("update");
    if (!cart) throw new HttpError(409, "Cart is empty");
    const [address] = await tx.select().from(customerAddresses)
      .where(and(eq(customerAddresses.id, parsed.data.addressId), eq(customerAddresses.customerId, customerId)))
      .limit(1).for("update");
    if (!address) throw new HttpError(404, "Delivery address not found");
    const [store] = await tx.select().from(stores)
      .innerJoin(storeServicePincodes, and(eq(storeServicePincodes.storeId, stores.id), eq(storeServicePincodes.pincode, address.pincode)))
      .where(eq(stores.id, cart.storeId)).limit(1).for("update");
    if (!store || store.stores.status !== "ACTIVE") throw new HttpError(409, "Store cannot deliver to the selected address");
    // Lock cart items/products only. PostgreSQL rejects FOR UPDATE on the nullable
    // side of an outer join, so category relation validation is a separate read.
    const rows = await tx.select({ item: cartItems, product: products, variant: productVariants })
      .from(cartItems).innerJoin(products, eq(products.id, cartItems.productId))
      .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
      .where(eq(cartItems.cartId, cart.id)).orderBy(asc(productVariants.id)).for("update");
    if (!rows.length) throw new HttpError(409, "Cart is empty");
    const categoryIds = rows.map(({ product }) => product.categoryId).filter((id): id is string => id !== null);
    const validCategories = categoryIds.length
      ? await tx.select({ id: categories.id, storeId: categories.storeId }).from(categories)
        .where(and(
          eq(categories.storeId, cart.storeId),
          eq(categories.isActive, true),
          inArray(categories.id, categoryIds),
        ))
        .for("share")
      : [];
    const unavailable = rows.find(({ product, variant }) => product.storeId !== cart.storeId || variant.productId !== product.id ||
      !product.isActive || !product.availability || !variant.isActive ||
      !variant.availability || variant.stockQuantity < 0 ||
      (product.categoryId !== null && !validCategories.some(c => c.id === product.categoryId)));
    if (unavailable) throw stockError("VARIANT_UNAVAILABLE", { productName: unavailable.product.name, variantName: unavailable.variant.name });
    for (const { item, product, variant } of rows) {
      const line = { productName: product.name, variantName: variant.name };
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) throw stockError("INVALID_QUANTITY", line);
      if (variant.stockQuantity === 0) throw stockError("OUT_OF_STOCK", line);
      if (item.quantity > variant.stockQuantity) throw stockError("INSUFFICIENT_STOCK", line);
    }
    // Read and share-lock current canonical names after the cart/product/variant rows are locked.
    // Keep master data out of the FOR UPDATE join so PostgreSQL never locks its nullable side.
    const masterProductIds = [...new Set(rows
      .map(({ product }) => product.masterProductId)
      .filter((id): id is string => id !== null))];
    const currentMasterProducts = masterProductIds.length
      ? await tx.select({ id: masterProducts.id, name: masterProducts.name })
        .from(masterProducts)
        .where(inArray(masterProducts.id, masterProductIds))
        .for("share")
      : [];
    const masterNameById = new Map(currentMasterProducts.map(({ id, name }) => [id, name]));
    const subtotal = rows.reduce((sum, { item, variant }) =>
      sum + moneyToCents(variant.price) * BigInt(item.quantity), 0n);
    const fee = moneyToCents(store.stores.deliveryFee);
    const minimum = moneyToCents(store.stores.minimumOrderValue);
    if (subtotal < minimum) throw new HttpError(409, `Minimum order value is ${store.stores.minimumOrderValue}`);
    // Final acceptance check after all potentially blocking inventory locks.
    // Hours writers lock the same store parent until this transaction completes.
    const orderability = await assertStoreOrderable(cart.storeId, tx);
    const snapshot = deliverySnapshot(parsed.data, orderability.hours, orderability.now);
    await deductStock(tx, cart.storeId, rows.map(({ item, product, variant }) => ({
      variantId: variant.id, productId: product.id, quantity: item.quantity,
      productName: (product.masterProductId && masterNameById.get(product.masterProductId)) || product.name,
      variantName: variant.name,
    })));
    const rate = store.stores.commissionRate;
    const [order] = await tx.insert(orders).values({
      customerId, storeId: cart.storeId, status: "PLACED", paymentMethod: "COD",
      ...snapshot,
      inventoryState: "DEDUCTED", checkoutKey: parsed.data.idempotencyKey,
      checkoutCartId: cart.id, checkoutAddressId: address.id,
      subtotal: centsToMoney(subtotal), deliveryFeeSnapshot: centsToMoney(fee),
      totalAmount: centsToMoney(subtotal + fee),
      commissionRateSnapshot: rate ?? DEFAULT_COMMISSION_RATE,
      commissionAmountSnapshot: centsToMoney(commissionCents(subtotal, rate)),
      deliveryAddressSnapshot: addressSnapshot(address), deliveryContactName: address.recipientName,
      deliveryContactPhone: address.phone,
    }).returning();
    if (!order) throw new HttpError(500, "Unable to create order");
    await tx.insert(orderItems).values(rows.map(({ item, product, variant }) => ({
      orderId: order.id, productId: product.id,
      productNameSnapshot: (product.masterProductId && masterNameById.get(product.masterProductId)) ?? product.name,
      variantId: variant.id, variantNameSnapshot: variant.name,
      variantQuantityValueSnapshot: variant.quantityValue,
      variantQuantityUnitSnapshot: variant.quantityUnit,
      productPriceSnapshot: variant.price, quantity: item.quantity,
      subtotal: centsToMoney(moneyToCents(variant.price) * BigInt(item.quantity)),
    })));
    await tx.insert(orderStatusHistory).values({ orderId: order.id, status: "PLACED", changedBy: customerId });
    await tx.update(carts).set({ status: "CONVERTED", updatedAt: new Date() }).where(eq(carts.id, cart.id));
  return order;
  }, { isolationLevel: "read committed" });
  const [safe] = await getDb().select({ ...safeOrderFields, storeName: stores.name })
    .from(orders).innerJoin(stores, eq(stores.id, orders.storeId)).where(eq(orders.id, result.id));
  const items = await getDb().select(safeItemFields).from(orderItems).where(eq(orderItems.orderId, result.id));
  const statusHistory = await getDb().select(safeHistoryFields).from(orderStatusHistory)
    .where(eq(orderStatusHistory.orderId, result.id)).orderBy(asc(orderStatusHistory.createdAt));
  res.status(201).json({ order: { ...safe, items, statusHistory } });
}));

ordersRouter.get("/api/customer/orders/:orderId/repeat-preview", requireRole("customer"), asyncHandler(async (req, res) => {
  const id = orderId(req);
  const parsed = repeatPreviewQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, "Invalid repeat-order preview request", validationDetails(parsed.error));
  const preview = await repeatOrderPreviewData(getDb(), userId(req), id, parsed.data.addressId, parsed.data.orderItemId);
  const { order: _order, ...result } = preview;
  res.json(result);
}));

ordersRouter.post("/api/customer/orders/:orderId/repeat", requireRole("customer"), asyncHandler(async (req, res) => {
  const id = orderId(req);
  const parsed = repeatOrderBodySchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid repeat-order request", validationDetails(parsed.error));
  const customerId = userId(req);
  const requestedIntent: RepeatIntent = {
    sourceOrderId: id,
    addressId: parsed.data.addressId,
    confirmStoreSwitch: parsed.data.confirmStoreSwitch ?? false,
    orderItemId: parsed.data.orderItemId,
  };
  const result = await getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${customerId}, 0))`);
    const [previousRequest] = await tx.select().from(customerRepeatRequests)
      .where(and(
        eq(customerRepeatRequests.customerId, customerId),
        eq(customerRepeatRequests.idempotencyKey, parsed.data.idempotencyKey),
      )).limit(1);
    if (previousRequest) {
      if (!repeatIntentMatches({
        sourceOrderId: previousRequest.sourceOrderId,
        addressId: previousRequest.addressId,
        confirmStoreSwitch: previousRequest.confirmStoreSwitch,
        orderItemId: typeof previousRequest.response.selectedOrderItemId === "string"
          ? previousRequest.response.selectedOrderItemId : null,
      }, requestedIntent)) {
        throw new HttpError(409, "Idempotency key was already used for a different repeat-order request", {
          code: "IDEMPOTENCY_KEY_REUSED",
        });
      }
      return previousRequest.response as unknown as {
        unavailable: Array<Record<string, unknown>>;
        added?: Array<Record<string, unknown>>;
        addedCount: number;
      };
    }
    const [order] = await tx.select({
      id: orders.id, storeId: orders.storeId, storeName: stores.name,
    }).from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
      .where(and(eq(orders.id, id), eq(orders.customerId, customerId))).limit(1).for("share");
    if (!order) throw new HttpError(404, "Order not found");
    const [address] = await tx.select().from(customerAddresses)
      .where(and(eq(customerAddresses.id, parsed.data.addressId), eq(customerAddresses.customerId, customerId)))
      .limit(1).for("share");
    if (!address) throw new HttpError(404, "Delivery address not found");
    const [store] = await tx.select({ status: stores.status }).from(stores).innerJoin(
      storeServicePincodes,
      and(eq(storeServicePincodes.storeId, stores.id), eq(storeServicePincodes.pincode, address.pincode)),
    ).where(eq(stores.id, order.storeId)).limit(1).for("share");
    const storeAvailable = store?.status === "ACTIVE";
    if (storeAvailable) await assertStoreOrderable(order.storeId, tx, false);
    const orderRows = await tx.select({
      orderItemId: orderItems.id, productName: orderItems.productNameSnapshot,
      orderProductId: orderItems.productId,
      originalVariantId: orderItems.variantId,
      variantNameSnapshot: orderItems.variantNameSnapshot, quantity: orderItems.quantity,
      productId: products.id, productStoreId: products.storeId, productActive: products.isActive,
      productAvailable: products.availability,
      variantId: productVariants.id, variantProductId: productVariants.productId,
      variantActive: productVariants.isActive, variantAvailable: productVariants.availability,
      stockQuantity: productVariants.stockQuantity, currentUnitPrice: productVariants.price,
      quantityValue: productVariants.quantityValue, quantityUnit: productVariants.quantityUnit,
    }).from(orderItems).leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
      .leftJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(orderItems.orderId, order.id),
        parsed.data.orderItemId ? eq(orderItems.id, parsed.data.orderItemId) : undefined))
      .orderBy(asc(orderItems.createdAt));
    if (parsed.data.orderItemId && orderRows.length === 0) throw new HttpError(404, "Order item not found");
    const variantIds = [...new Set(orderRows.flatMap((row) => row.variantId ? [row.variantId] : []))];
    const lockedVariants = variantIds.length
      ? await tx.select().from(productVariants).where(inArray(productVariants.id, variantIds)).for("share")
      : [];
    const variantById = new Map(lockedVariants.map((variant) => [variant.id, variant]));
    const productIds = [...new Set(lockedVariants.map((variant) => variant.productId))];
    const lockedProducts = productIds.length
      ? await tx.select().from(products).where(inArray(products.id, productIds)).for("share")
      : [];
    const productById = new Map(lockedProducts.map((product) => [product.id, product]));
    const evaluated = orderRows.map((row) => {
      const variant = row.variantId ? variantById.get(row.variantId) : undefined;
      const product = variant ? productById.get(variant.productId) : undefined;
      const currentRow = {
        ...row,
        variantId: variant?.id ?? null,
        variantProductId: variant?.productId ?? null,
        variantActive: variant?.isActive ?? null,
        variantAvailable: variant?.availability ?? null,
        currentUnitPrice: variant?.price ?? null,
        stockQuantity: variant?.stockQuantity ?? null,
        productId: product?.id ?? null,
        productStoreId: product?.storeId ?? null,
        productActive: product?.isActive ?? null,
        productAvailable: product?.availability ?? null,
      };
      return { ...evaluateReorderLine(currentRow, order.storeId, storeAvailable), row: currentRow };
    });
    const activeCarts = await tx.select({
      id: carts.id, storeId: carts.storeId, storeName: stores.name,
      createdAt: carts.createdAt,
    }).from(carts).innerJoin(stores, eq(stores.id, carts.storeId))
      .where(and(eq(carts.customerId, customerId), eq(carts.status, "ACTIVE")))
      .orderBy(asc(carts.createdAt)).for("update");
    const targetCarts = activeCarts.filter((cart) => cart.storeId === order.storeId);
    const targetCartIds = targetCarts.map((cart) => cart.id);
    const existingTargetItems = targetCartIds.length
      ? await tx.select({
        cartId: cartItems.cartId, variantId: cartItems.variantId,
        productId: productVariants.productId, quantity: cartItems.quantity,
      }).from(cartItems).innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
        .where(inArray(cartItems.cartId, targetCartIds)).for("update")
      : [];
    const existingQuantities = new Map<string, number>();
    for (const item of existingTargetItems) {
      existingQuantities.set(item.variantId, (existingQuantities.get(item.variantId) ?? 0) + item.quantity);
    }
    const plannedAdditions = planRepeatLineAdditions(evaluated.map((item) => ({
      variantId: item.row.variantId,
      quantity: item.quantity,
      stockQuantity: item.row.stockQuantity,
      available: item.available,
    })), existingQuantities);
    const unavailable = evaluated.flatMap((item, index) => {
      if (!item.available) {
        const { row: _row, ...publicItem } = item;
        return [publicItem];
      }
      if (!plannedAdditions[index]) {
        const { row: _row, ...publicItem } = item;
        return [{ ...publicItem, available: false, currentUnitPrice: null, reason: "Insufficient stock for cart quantity" }];
      }
      return [];
    });
    const additions = evaluated.filter((_item, index) => plannedAdditions[index]);
    if (additions.length === 0) {
      const response = { unavailable, added: [], addedCount: 0, selectedOrderItemId: requestedIntent.orderItemId ?? null };
      await tx.insert(customerRepeatRequests).values({
        customerId, idempotencyKey: parsed.data.idempotencyKey,
        sourceOrderId: id, addressId: parsed.data.addressId,
        confirmStoreSwitch: requestedIntent.confirmStoreSwitch, response,
      });
      return response;
    }
    const conflictingCarts = activeCarts.filter((cart) => cart.storeId !== order.storeId);
    if (conflictingCarts.length && !requestedIntent.confirmStoreSwitch) {
      throw new HttpError(409, "Store switch required", {
        code: "STORE_SWITCH_REQUIRED",
        existingStore: { id: conflictingCarts[0]!.storeId, name: conflictingCarts[0]!.storeName },
        requestedStore: { id: order.storeId, name: order.storeName },
      });
    }
    let cart = targetCarts[0] ? { id: targetCarts[0].id } : undefined;
    if (!cart) {
      [cart] = await tx.insert(carts).values({ customerId, storeId: order.storeId })
        .onConflictDoNothing().returning({ id: carts.id });
      if (!cart) [cart] = await tx.select({ id: carts.id }).from(carts)
        .where(and(eq(carts.customerId, customerId), eq(carts.storeId, order.storeId), eq(carts.status, "ACTIVE")))
        .limit(1).for("update");
    }
    if (!cart) throw new HttpError(409, "Unable to create active cart");
    const duplicateTargetCartIds = targetCartIds.filter((cartId) => cartId !== cart!.id);
    if (duplicateTargetCartIds.length) {
      const duplicateItems = existingTargetItems.filter((item) => duplicateTargetCartIds.includes(item.cartId));
      for (const item of duplicateItems) {
        await tx.insert(cartItems).values({
          cartId: cart.id, productId: item.productId,
          variantId: item.variantId, quantity: item.quantity,
        }).onConflictDoUpdate({
          target: [cartItems.cartId, cartItems.variantId],
          set: { quantity: sql`${cartItems.quantity} + ${item.quantity}`, updatedAt: new Date() },
        });
      }
    }
    const cartsToAbandon = activeCarts.filter((activeCart) => activeCart.id !== cart!.id);
    if (cartsToAbandon.length) {
      await tx.update(carts).set({ status: "ABANDONED", updatedAt: new Date() })
        .where(and(
          eq(carts.customerId, customerId),
          eq(carts.status, "ACTIVE"),
          inArray(carts.id, cartsToAbandon.map((activeCart) => activeCart.id)),
        ));
    }
    let addedCount = 0;
    const addedItems: ReturnType<typeof evaluateReorderLine>[] = [];
    for (const { row, ...publicItem } of additions) {
      if (!row.variantId || !row.productId || row.stockQuantity === null) continue;
      const [added] = await tx.insert(cartItems).values({
        cartId: cart.id, productId: row.productId, variantId: row.variantId, quantity: row.quantity,
      }).onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.variantId],
        set: { quantity: sql`${cartItems.quantity} + ${row.quantity}`, updatedAt: new Date() },
        where: sql`${cartItems.quantity} + ${row.quantity} <= ${row.stockQuantity}`,
      }).returning({ id: cartItems.id });
      if (!added) throw new HttpError(409, "Unable to add repeat-order item");
      addedCount += 1;
      addedItems.push(publicItem);
    }
    if (addedCount === 0) throw new HttpError(409, "Unable to add any repeat-order items");
    const response = { unavailable, added: addedItems, addedCount, selectedOrderItemId: requestedIntent.orderItemId ?? null };
    await tx.insert(customerRepeatRequests).values({
      customerId, idempotencyKey: parsed.data.idempotencyKey,
      sourceOrderId: id, addressId: parsed.data.addressId,
      confirmStoreSwitch: requestedIntent.confirmStoreSwitch, response,
    });
    return response;
  }, { isolationLevel: "read committed" });
  res.json({
    cart: await cartResponse(customerId),
    added: result.added ?? [],
    unavailable: result.unavailable,
    addedCount: result.addedCount,
  });
}));

ordersRouter.get("/api/customer/orders", requireRole("customer"), asyncHandler(async (req, res) => {
  const db = getDb();
  const list = await db.select({ ...safeOrderSummaryFields, storeName: stores.name }).from(orders)
    .innerJoin(stores, eq(stores.id, orders.storeId)).where(eq(orders.customerId, userId(req)))
    .orderBy(desc(orders.createdAt), desc(orders.id)).limit(100);
  const ids = list.map((order) => order.id);
  const summaries = ids.length ? await db.select({
    orderId: orderItems.orderId, productNameSnapshot: orderItems.productNameSnapshot,
    variantNameSnapshot: orderItems.variantNameSnapshot, quantity: orderItems.quantity,
  }).from(orderItems).where(inArray(orderItems.orderId, ids)).orderBy(asc(orderItems.createdAt)) : [];
  const summaryByOrder = new Map<string, typeof summaries>();
  for (const item of summaries) {
    const current = summaryByOrder.get(item.orderId) ?? [];
    current.push(item);
    summaryByOrder.set(item.orderId, current);
  }
  res.json({ orders: list.map((order) => ({
    ...order, itemSummary: (summaryByOrder.get(order.id) ?? []).map(({ orderId: _orderId, ...item }) => item),
  })) });
}));
ordersRouter.get("/api/customer/orders/:orderId", requireRole("customer"), asyncHandler(async (req, res) => {
  const id = orderId(req);
  const [order] = await getDb().select({ ...safeOrderFields, storeName: stores.name }).from(orders)
    .innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(eq(orders.id, id), eq(orders.customerId, userId(req)))).limit(1);
  if (!order) throw new HttpError(404, "Order not found");
  const [items, statusHistory] = await Promise.all([
    getDb().select(safeItemFields).from(orderItems).where(eq(orderItems.orderId, id)).orderBy(asc(orderItems.createdAt)),
    getDb().select(safeHistoryFields).from(orderStatusHistory).where(eq(orderStatusHistory.orderId, id)).orderBy(asc(orderStatusHistory.createdAt)),
  ]);
  res.json({ order: { ...order, items, statusHistory } });
}));
ordersRouter.post("/api/customer/orders/:orderId/cancel", requireRole("customer"), asyncHandler(async (req, res) => {
  const id = orderId(req); const customerId = userId(req);
  const updated = await getDb().transaction(async tx => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.customerId, customerId))).limit(1).for("update");
    if (!order) throw new HttpError(404, "Order not found");
    if (order.status !== "PLACED") throw new HttpError(409, "Order cannot be cancelled in its current state");
    const [value] = await tx.update(orders).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(orders.id, id)).returning();
    await restoreOrderStock(tx, id);
    await tx.insert(orderStatusHistory).values({ orderId: id, status: "CANCELLED", changedBy: customerId });
    return value;
  }, { isolationLevel: "read committed" });
  const [safe] = await getDb().select({ ...safeOrderFields, storeName: stores.name }).from(orders)
    .innerJoin(stores, eq(stores.id, orders.storeId)).where(eq(orders.id, updated.id));
  const items = await getDb().select(safeItemFields).from(orderItems).where(eq(orderItems.orderId, updated.id));
  const statusHistory = await getDb().select(safeHistoryFields).from(orderStatusHistory)
    .where(eq(orderStatusHistory.orderId, updated.id)).orderBy(asc(orderStatusHistory.createdAt));
  res.json({ order: { ...safe, items, statusHistory } });
}));

ordersRouter.get("/api/vendor/orders", requireRole("vendor"), asyncHandler(async (req, res) => {
  const storeId = (req as AuthenticatedRequest).auth?.storeId;
  if (!storeId) throw new HttpError(404, "Vendor store not found");
  const parsed = vendorOrderQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, "Invalid order filters", validationDetails(parsed.error));
  const { page, pageSize, status } = parsed.data;
  const where = and(eq(orders.storeId, storeId), ...(status && status !== "ALL" ? [eq(orders.status, status)] : []));
  const db = getDb();
  const [rows, totals, statusRows] = await Promise.all([
    db.select({ ...vendorOrderSummaryFields, storeName: stores.name }).from(orders)
      .innerJoin(stores, eq(stores.id, orders.storeId)).where(where)
      .orderBy(desc(orders.createdAt), desc(orders.id)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(orders).where(where),
    db.select({ status: orders.status, count: sql<number>`count(*)::int` }).from(orders)
      .where(eq(orders.storeId, storeId)).groupBy(orders.status),
  ]);
  const ids = rows.map(row => row.id);
  const itemCounts = ids.length
    ? await db.select({ orderId: orderItems.orderId, count: sql<number>`sum(${orderItems.quantity})::int` })
      .from(orderItems).where(inArray(orderItems.orderId, ids)).groupBy(orderItems.orderId)
    : [];
  const countMap = new Map(itemCounts.map(row => [row.orderId, row.count]));
  const countByStatus = Object.fromEntries(ORDER_STATUSES.map(value => [
    value, statusRows.find(row => row.status === value)?.count ?? 0,
  ]));
  res.json({
    orders: rows.map(row => ({
      ...row, itemCount: countMap.get(row.id) ?? 0,
      deliveryPincode: (row.deliveryAddressSnapshot as { pincode?: string }).pincode ?? null,
    })),
    pagination: { page, pageSize, total: totals[0]?.count ?? 0 },
    counts: countByStatus,
  });
}));
ordersRouter.get("/api/vendor/orders/:orderId", requireRole("vendor"), asyncHandler(async (req, res) => {
  const id = orderId(req);
  const storeId = (req as AuthenticatedRequest).auth?.storeId;
  if (!storeId) throw new HttpError(404, "Vendor store not found");
  const [order] = await getDb().select({ ...safeOrderFields, storeName: stores.name })
    .from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(eq(orders.id, id), eq(orders.storeId, storeId))).limit(1);
  if (!order) throw new HttpError(404, "Order not found");
  const [items, statusHistory] = await Promise.all([
    getDb().select(safeItemFields).from(orderItems).where(eq(orderItems.orderId, id)).orderBy(asc(orderItems.createdAt)),
    getDb().select(safeHistoryFields).from(orderStatusHistory).where(eq(orderStatusHistory.orderId, id)).orderBy(asc(orderStatusHistory.createdAt)),
  ]);
  res.json({ order: { ...order, items, statusHistory } });
}));
ordersRouter.post("/api/vendor/orders/:orderId/actions", requireRole("vendor"), asyncHandler(async (req, res) => {
  const parsed = vendorOrderActionSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid order action", validationDetails(parsed.error));
  if (parsed.data.action === "OUT_FOR_DELIVERY" || parsed.data.action === "DELIVER") {
    throw new HttpError(403, "Only the assigned active Delivery Partner can perform this action.", undefined, "UNAUTHORIZED_DELIVERY_ACTION");
  }
  const id = orderId(req); const storeId = (req as AuthenticatedRequest).auth?.storeId;
  if (!storeId) throw new HttpError(404, "Vendor store not found");
  const updated = await getDb().transaction(async tx => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.storeId, storeId))).limit(1).for("update");
    if (!order) throw new HttpError(404, "Order not found");
    const next = LEGAL_ORDER_TRANSITIONS[parsed.data.action]?.[order.status];
    if (!next) throw new HttpError(409, `Illegal order transition from ${order.status}`);
    const [value] = await tx.update(orders).set({ status: next as typeof order.status, updatedAt: new Date() }).where(eq(orders.id, id)).returning();
    if (next === "REJECTED") await restoreOrderStock(tx, id);
    await tx.insert(orderStatusHistory).values({ orderId: id, status: next as typeof order.status, note: parsed.data.note, changedBy: userId(req) });
    return value;
  }, { isolationLevel: "read committed" });
  const [safe] = await getDb().select({ ...safeOrderFields, storeName: stores.name })
    .from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(eq(orders.id, updated.id), eq(orders.storeId, storeId))).limit(1);
  if (!safe) throw new HttpError(404, "Order not found");
  const [items, statusHistory] = await Promise.all([
    getDb().select(safeItemFields).from(orderItems).where(eq(orderItems.orderId, updated.id)).orderBy(asc(orderItems.createdAt)),
    getDb().select(safeHistoryFields).from(orderStatusHistory).where(eq(orderStatusHistory.orderId, updated.id)).orderBy(asc(orderStatusHistory.createdAt)),
  ]);
  res.json({ order: { ...safe, items, statusHistory } });
}));

const adminOrderListFields = {
  ...safeOrderSummaryFields, deliveryType: orders.deliveryType, paymentMethod: orders.paymentMethod,
  deliveryContactName: orders.deliveryContactName, deliveryAddressSnapshot: orders.deliveryAddressSnapshot,
};
function adminOrderWhere(query: z.infer<typeof adminOrderQuerySchema>, includeStatus = true) {
  return and(
    ...(includeStatus && query.status && query.status !== "ALL" ? [eq(orders.status, query.status)] : []),
    ...(query.storeId ? [eq(orders.storeId, query.storeId)] : []),
    ...(query.from ? [gte(orders.createdAt, new Date(query.from))] : []),
    ...(query.to ? [lte(orders.createdAt, new Date(query.to))] : []),
  );
}

ordersRouter.get("/api/admin/orders", requireRole("admin"), asyncHandler(async (req, res) => {
  const parsed = adminOrderQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, "Invalid order filters", validationDetails(parsed.error));
  const query = parsed.data;
  const where = adminOrderWhere(query);
  const countWhere = adminOrderWhere(query, false);
  const db = getDb();
  const [rows, totals, statusRows] = await Promise.all([
    db.select({ ...adminOrderListFields, storeName: stores.name }).from(orders)
      .innerJoin(stores, eq(stores.id, orders.storeId)).where(where)
      .orderBy(desc(orders.createdAt), desc(orders.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(orders).where(where),
    db.select({ status: orders.status, count: sql<number>`count(*)::int` }).from(orders)
      .where(countWhere).groupBy(orders.status),
  ]);
  const ids = rows.map(row => row.id);
  const itemCounts = ids.length
    ? await db.select({ orderId: orderItems.orderId, count: sql<number>`sum(${orderItems.quantity})::int` })
      .from(orderItems).where(inArray(orderItems.orderId, ids)).groupBy(orderItems.orderId)
    : [];
  const countMap = new Map(itemCounts.map(row => [row.orderId, row.count]));
  res.json({
    orders: rows.map(row => ({ ...row, itemCount: countMap.get(row.id) ?? 0,
      deliveryPincode: (row.deliveryAddressSnapshot as { pincode?: string }).pincode ?? null })),
    pagination: { page: query.page, pageSize: query.pageSize, total: totals[0]?.count ?? 0 },
    counts: Object.fromEntries(ORDER_STATUSES.map(value => [
      value, statusRows.find(row => row.status === value)?.count ?? 0,
    ])),
  });
}));

ordersRouter.get("/api/admin/orders/:orderId", requireRole("admin"), asyncHandler(async (req, res) => {
  const id = orderId(req);
  const [order] = await getDb().select({
    ...safeOrderFields, storeName: stores.name,
    commissionRateSnapshot: orders.commissionRateSnapshot,
    commissionAmountSnapshot: orders.commissionAmountSnapshot,
  }).from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
    .where(eq(orders.id, id)).limit(1);
  if (!order) throw new HttpError(404, "Order not found");
  const [items, statusHistory] = await Promise.all([
    getDb().select(safeItemFields).from(orderItems).where(eq(orderItems.orderId, id)).orderBy(asc(orderItems.createdAt)),
    getDb().select(safeHistoryFields).from(orderStatusHistory).where(eq(orderStatusHistory.orderId, id)).orderBy(asc(orderStatusHistory.createdAt)),
  ]);
  res.json({ order: { ...order, items, statusHistory } });
}));