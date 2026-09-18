import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";
import {
  carts, cartItems, categories, customerAddresses, getDb, orderItems,
  orderStatusHistory, orders, products, storeServicePincodes, stores,
} from "@workspace/db";
import {
  adminOrderQuerySchema, customerOrderCreateSchema, customerOrderIdParamSchema,
  vendorOrderActionSchema, vendorOrderQuerySchema,
} from "@workspace/validation";
import { requireRole } from "../auth/index.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError, validationDetails } from "../http.js";
import { centsToMoney, moneyToCents } from "../customer-cart/money.js";
import { commissionCents, DEFAULT_COMMISSION_RATE, LEGAL_ORDER_TRANSITIONS } from "./lifecycle.js";

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
  paymentMethod: orders.paymentMethod, subtotal: orders.subtotal,
  deliveryFeeSnapshot: orders.deliveryFeeSnapshot, totalAmount: orders.totalAmount,
  deliveryAddressSnapshot: orders.deliveryAddressSnapshot, deliveryContactName: orders.deliveryContactName,
  deliveryContactPhone: orders.deliveryContactPhone, createdAt: orders.createdAt, updatedAt: orders.updatedAt,
};
const safeOrderSummaryFields = {
  id: orders.id, storeId: orders.storeId, status: orders.status,
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

ordersRouter.post("/api/customer/orders", requireRole("customer"), asyncHandler(async (req, res) => {
  const parsed = customerOrderCreateSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid order request", validationDetails(parsed.error));
  const customerId = userId(req);
  const result = await getDb().transaction(async (tx) => {
    // Keep all order/cart work serialized per customer, including concurrent checkout requests.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${customerId}, 0))`);
    const [cart] = await tx.select().from(carts)
      .where(and(eq(carts.customerId, customerId), eq(carts.status, "ACTIVE"))).limit(1).for("update");
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
    const rows = await tx.select({ item: cartItems, product: products })
      .from(cartItems).innerJoin(products, eq(products.id, cartItems.productId))
      .where(eq(cartItems.cartId, cart.id)).for("update");
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
    if (rows.some(({ product }) => product.storeId !== cart.storeId || !product.isActive ||
      !product.availability || product.stockQuantity < 0 ||
      (product.categoryId !== null && !validCategories.some(c => c.id === product.categoryId)))) {
      throw new HttpError(409, "One or more cart products are no longer available");
    }
    if (rows.some(({ item, product }) => item.quantity > product.stockQuantity))
      throw new HttpError(409, "Requested quantity exceeds available stock");
    const subtotal = rows.reduce((sum, { item, product }) =>
      sum + moneyToCents(product.price) * BigInt(item.quantity), 0n);
    const fee = moneyToCents(store.stores.deliveryFee);
    const minimum = moneyToCents(store.stores.minimumOrderValue);
    if (subtotal < minimum) throw new HttpError(409, `Minimum order value is ${store.stores.minimumOrderValue}`);
    const rate = store.stores.commissionRate;
    const [order] = await tx.insert(orders).values({
      customerId, storeId: cart.storeId, status: "PLACED", paymentMethod: "COD",
      subtotal: centsToMoney(subtotal), deliveryFeeSnapshot: centsToMoney(fee),
      totalAmount: centsToMoney(subtotal + fee),
      commissionRateSnapshot: rate ?? DEFAULT_COMMISSION_RATE,
      commissionAmountSnapshot: centsToMoney(commissionCents(subtotal, rate)),
      deliveryAddressSnapshot: addressSnapshot(address), deliveryContactName: address.recipientName,
      deliveryContactPhone: address.phone,
    }).returning();
    if (!order) throw new HttpError(500, "Unable to create order");
    await tx.insert(orderItems).values(rows.map(({ item, product }) => ({
      orderId: order.id, productId: product.id, productNameSnapshot: product.name,
      productPriceSnapshot: product.price, quantity: item.quantity,
      subtotal: centsToMoney(moneyToCents(product.price) * BigInt(item.quantity)),
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

ordersRouter.get("/api/customer/orders", requireRole("customer"), asyncHandler(async (req, res) => {
  const list = await getDb().select({ ...safeOrderSummaryFields, storeName: stores.name }).from(orders)
    .innerJoin(stores, eq(stores.id, orders.storeId)).where(eq(orders.customerId, userId(req))).orderBy(desc(orders.createdAt));
  res.json({ orders: list });
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
  const id = orderId(req); const storeId = (req as AuthenticatedRequest).auth?.storeId;
  if (!storeId) throw new HttpError(404, "Vendor store not found");
  const updated = await getDb().transaction(async tx => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.storeId, storeId))).limit(1).for("update");
    if (!order) throw new HttpError(404, "Order not found");
    const next = LEGAL_ORDER_TRANSITIONS[parsed.data.action]?.[order.status];
    if (!next) throw new HttpError(409, `Illegal order transition from ${order.status}`);
    const [value] = await tx.update(orders).set({ status: next as typeof order.status, updatedAt: new Date() }).where(eq(orders.id, id)).returning();
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