import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  customerOrderCreateSchema,
  customerOrderIdParamSchema,
  adminOrderQuerySchema,
  vendorOrderActionSchema,
  vendorOrderQuerySchema,
} from "@workspace/validation";
import { createApp } from "../app.js";
import {
  commissionCents,
  DEFAULT_COMMISSION_RATE,
  LEGAL_ORDER_TRANSITIONS,
} from "./lifecycle.js";
import { planRepeatLineAdditions, repeatIntentMatches } from "./routes.js";

test("customer and vendor order routes require authentication", async () => {
  const id = crypto.randomUUID();
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    for (const [method, path] of [
      ["POST", "/api/customer/orders"],
      ["GET", "/api/customer/orders"],
      ["GET", `/api/customer/orders/${id}`],
      ["GET", `/api/customer/orders/${id}/repeat-preview?addressId=${crypto.randomUUID()}`],
      ["POST", `/api/customer/orders/${id}/repeat`],
      ["POST", `/api/customer/orders/${id}/cancel`],
      ["GET", "/api/vendor/orders"],
      ["GET", `/api/vendor/orders/${id}`],
      ["POST", `/api/vendor/orders/${id}/actions`],
      ["GET", "/api/admin/orders"],
      ["GET", `/api/admin/orders/${id}`],
    ] as const) {
      assert.equal(
        (await fetch(`http://127.0.0.1:${port}${path}`, { method })).status,
        401,
      );
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("variant checkout uses current variant inventory and writes immutable variant snapshots", async () => {
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const orderRoute = routes.slice(
    routes.indexOf('ordersRouter.post("/api/customer/orders"'),
    routes.indexOf('ordersRouter.get("/api/customer/orders/:orderId/repeat-preview"'),
  );
  assert.match(orderRoute, /innerJoin\(productVariants, eq\(productVariants\.id, cartItems\.variantId\)\)/);
  assert.match(orderRoute, /moneyToCents\(variant\.price\)/);
  assert.match(orderRoute, /variantNameSnapshot: variant\.name/);
  assert.match(orderRoute, /variantQuantityValueSnapshot: variant\.quantityValue/);
  assert.match(orderRoute, /variantQuantityUnitSnapshot: variant\.quantityUnit/);
  assert.match(orderRoute, /productPriceSnapshot: variant\.price/);
});

test("repeat order previews only original variants and re-adds to cart without creating orders", async () => {
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const preview = routes.slice(
    routes.indexOf('ordersRouter.get("/api/customer/orders/:orderId/repeat-preview"'),
    routes.indexOf('ordersRouter.get("/api/customer/orders"'),
  );
  assert.match(preview, /eq\(orders\.customerId, customerId\)/);
  assert.match(preview, /variantNameSnapshot: orderItems\.variantNameSnapshot/);
  assert.match(preview, /currentUnitPrice: productVariants\.price/);
  assert.match(preview, /Insufficient stock/);
  assert.match(preview, /Original product variant is no longer available/);
  assert.match(preview, /confirmStoreSwitch/);
  assert.match(preview, /tx\.insert\(cartItems\)/);
  assert.doesNotMatch(preview, /tx\.insert\(orders\)/);
});

test("repeat retries are idempotent and concurrent requests serialize before key lookup", async () => {
  const intent = {
    sourceOrderId: crypto.randomUUID(),
    addressId: crypto.randomUUID(),
    confirmStoreSwitch: false,
  };
  assert.equal(repeatIntentMatches(intent, { ...intent }), true);
  assert.equal(repeatIntentMatches(intent, { ...intent, confirmStoreSwitch: true }), false);
  assert.equal(repeatIntentMatches(intent, { ...intent, addressId: crypto.randomUUID() }), false);
  assert.equal(repeatIntentMatches(intent, { ...intent, sourceOrderId: crypto.randomUUID() }), false);

  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const repeatPost = routes.slice(
    routes.indexOf('ordersRouter.post("/api/customer/orders/:orderId/repeat"'),
    routes.indexOf('ordersRouter.get("/api/customer/orders"'),
  );
  const lock = repeatPost.indexOf("pg_advisory_xact_lock");
  const priorRequestRead = repeatPost.indexOf("tx.select().from(customerRepeatRequests)");
  const returnStoredResult = repeatPost.indexOf("return previousRequest.response");
  const firstCartMutation = repeatPost.indexOf("tx.insert(carts)");
  assert.ok(lock >= 0 && lock < priorRequestRead && priorRequestRead < returnStoredResult);
  assert.ok(returnStoredResult < firstCartMutation);
  assert.match(repeatPost, /IDEMPOTENCY_KEY_REUSED/);
  assert.match(repeatPost, /tx\.insert\(customerRepeatRequests\)/);
  assert.match(routes, /idempotencyKey: z\.string\(\)\.uuid\(\)/);
});

test("repeat store switching is only committed when preflight finds an insertable line", async () => {
  const current = new Map<string, number>([["variant-a", 3]]);
  const plan = planRepeatLineAdditions([
    { variantId: "variant-a", quantity: 2, stockQuantity: 4, available: true },
    { variantId: "variant-b", quantity: 1, stockQuantity: 0, available: false },
  ], current);
  assert.deepEqual(plan, [false, false]);
  assert.equal(current.get("variant-a"), 3);
  const partial = planRepeatLineAdditions([
    { variantId: "variant-c", quantity: 3, stockQuantity: 5, available: true },
    { variantId: "variant-c", quantity: 3, stockQuantity: 5, available: true },
  ], new Map());
  assert.deepEqual(partial, [true, false]);

  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const repeatPost = routes.slice(
    routes.indexOf('ordersRouter.post("/api/customer/orders/:orderId/repeat"'),
    routes.indexOf('ordersRouter.get("/api/customer/orders"'),
  );
  const zeroAdditionReturn = repeatPost.indexOf("if (additions.length === 0)");
  const activeCartAbandon = repeatPost.indexOf("tx.update(carts)");
  assert.ok(zeroAdditionReturn >= 0 && zeroAdditionReturn < activeCartAbandon);
  assert.match(repeatPost, /inArray\(carts\.id, cartsToAbandon\.map/);
  assert.match(repeatPost, /if \(addedCount === 0\) throw new HttpError/);
});

test("customer order list summaries include historical variant labels", async () => {
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const customerList = routes.slice(
    routes.indexOf('ordersRouter.get("/api/customer/orders"'),
    routes.indexOf('ordersRouter.get("/api/customer/orders/:orderId"'),
  );
  assert.match(customerList, /eq\(orders\.customerId, userId\(req\)\)/);
  assert.match(customerList, /itemSummary/);
  assert.match(customerList, /variantNameSnapshot: orderItems\.variantNameSnapshot/);
});

test("Phase 11 rejects oversized bodies and throttles order creation", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const oversized = await fetch(`${base}/api/customer/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(110_000) }),
    });
    assert.equal(oversized.status, 413);

    for (let attempt = 0; attempt < 9; attempt += 1) {
      assert.equal((await fetch(`${base}/api/customer/orders`, { method: "POST" })).status, 401);
    }
    const limited = await fetch(`${base}/api/customer/orders`, { method: "POST" });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("Phase 9 order list queries are strict and bounded", () => {
  assert.equal(vendorOrderQuerySchema.safeParse({ page: "1", pageSize: "100", status: "READY" }).success, true);
  assert.equal(vendorOrderQuerySchema.safeParse({ pageSize: "101" }).success, false);
  assert.equal(vendorOrderQuerySchema.safeParse({ storeId: crypto.randomUUID() }).success, false);
  assert.equal(adminOrderQuerySchema.safeParse({
    storeId: crypto.randomUUID(), from: "2025-01-01T00:00:00.000Z",
    to: "2025-01-02T00:00:00.000Z",
  }).success, true);
  assert.equal(adminOrderQuerySchema.safeParse({ from: "not-a-date" }).success, false);
  assert.equal(adminOrderQuerySchema.safeParse({
    from: "2025-01-01T00:00:00.000Z",
    to: "2026-01-03T00:00:00.000Z",
  }).success, false);
});

test("Phase 9 routes use bounded deterministic reads and no generic order patch", async () => {
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  assert.match(routes, /ordersRouter\.get\("\/api\/vendor\/orders\/:orderId"/);
  assert.match(routes, /ordersRouter\.get\("\/api\/admin\/orders"/);
  assert.match(routes, /orderBy\(desc\(orders\.createdAt\), desc\(orders\.id\)\)/);
  assert.doesNotMatch(routes, /ordersRouter\.patch\("\/api\/admin\/orders/);
  assert.doesNotMatch(routes.slice(routes.indexOf('ordersRouter.get("/api/vendor/orders/:orderId"'),
    routes.indexOf('ordersRouter.post("/api/vendor/orders/:orderId/actions"')), /customerId|commission/);
  const vendorAction = routes.slice(
    routes.indexOf('ordersRouter.post("/api/vendor/orders/:orderId/actions"'),
    routes.indexOf("const adminOrderListFields"),
  );
  assert.match(vendorAction, /safeOrderFields/);
  assert.doesNotMatch(vendorAction, /res\.json\(\{ order: updated \}\)/);
  assert.doesNotMatch(vendorAction, /commissionRateSnapshot|commissionAmountSnapshot|customerId/);
});

test("Phase 10 reuses lifecycle delivery actions and immutable delivery UI fields", async () => {
  const [dashboard, customer] = await Promise.all([
    readFile(new URL("../../../../apps/dashboard/src/OrderOperations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../../apps/customer/src/OrdersScreen.tsx", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(LEGAL_ORDER_TRANSITIONS.OUT_FOR_DELIVERY, { READY: "OUT_FOR_DELIVERY" });
  assert.deepEqual(LEGAL_ORDER_TRANSITIONS.DELIVER, { OUT_FOR_DELIVERY: "DELIVERED" });
  assert.match(dashboard, /\["READY", "OUT_FOR_DELIVERY", "DELIVERED"\]/);
  assert.match(dashboard, /deliveryAddressSnapshot\.line1/);
  assert.match(dashboard, /deliveryContactPhone/);
  assert.match(dashboard, /Vendor delivery/);
  assert.match(customer, /Vendor Delivery/);
  assert.doesNotMatch(`${dashboard}\n${customer}`, /Google Maps|Mapbox|navigator\.geolocation|WebSocket|delivery agent/i);
});

test("order inputs reject client-owned and unsupported values", () => {
  const addressId = crypto.randomUUID();
  assert.equal(
    customerOrderCreateSchema.safeParse({ addressId, paymentMethod: "COD" }).success,
    true,
  );
  assert.equal(
    customerOrderCreateSchema.safeParse({
      addressId,
      paymentMethod: "COD",
      total: "1.00",
    }).success,
    false,
  );
  assert.equal(
    customerOrderCreateSchema.safeParse({ addressId, paymentMethod: "CARD" }).success,
    false,
  );
  assert.equal(customerOrderIdParamSchema.safeParse({ orderId: "invalid" }).success, false);
  assert.equal(
    vendorOrderActionSchema.safeParse({ action: "DELIVERED" }).success,
    false,
  );
});

test("vendor lifecycle permits exactly the Phase 8 transitions", () => {
  assert.deepEqual(LEGAL_ORDER_TRANSITIONS, {
    ACCEPT: { PLACED: "ACCEPTED" },
    PREPARE: { ACCEPTED: "PREPARING" },
    READY: { PREPARING: "READY" },
    OUT_FOR_DELIVERY: { READY: "OUT_FOR_DELIVERY" },
    DELIVER: { OUT_FOR_DELIVERY: "DELIVERED" },
    REJECT: { PLACED: "REJECTED" },
  });
  for (const [action, status] of [
    ["DELIVER", "PLACED"],
    ["PREPARE", "PLACED"],
    ["DELIVER", "ACCEPTED"],
    ["PREPARE", "DELIVERED"],
    ["ACCEPT", "REJECTED"],
    ["ACCEPT", "CANCELLED"],
  ] as const) {
    assert.equal(
      (LEGAL_ORDER_TRANSITIONS[action] as Record<string, string> | undefined)?.[status],
      undefined,
    );
  }
});

test("commission snapshots use precise half-up integer-cent calculations", () => {
  assert.equal(DEFAULT_COMMISSION_RATE, "0.00");
  assert.equal(commissionCents(10_000n, null), 0n);
  assert.equal(commissionCents(10_000n, "10.00"), 1_000n);
  assert.equal(commissionCents(9_999n, "7.25"), 725n);
  assert.equal(commissionCents(1n, "50.00"), 1n);
});

test("Phase 8 migration hardens immutable order history and identity", async () => {
  const migration = await readFile(
    new URL("../../../../database/migrations/0003_harden_order_history.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.order_status_history/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON public\.order_status_history FROM anon, authenticated/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON public\.orders FROM anon, authenticated/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON public\.order_items FROM anon, authenticated/);
  assert.match(migration, /DROP POLICY IF EXISTS orders_admin_manage ON public\.orders/);
  assert.match(migration, /NEW\.customer_id IS DISTINCT FROM OLD\.customer_id/);
  assert.match(migration, /NEW\.store_id IS DISTINCT FROM OLD\.store_id/);
  assert.match(migration, /NEW\.order_id IS DISTINCT FROM OLD\.order_id/);
  assert.match(migration, /NEW\.product_id IS DISTINCT FROM OLD\.product_id/);
  assert.doesNotMatch(
    migration,
    /payment_intent|refund|settlement|delivery_partner|tracking_location/i,
  );
});

test("Phase 11 migration hardens definer privileges, scope identity, carts, and order indexes", async () => {
  const migration = await readFile(
    new URL("../../../../database/migrations/0004_phase11_security_hardening.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.handle_new_auth_user\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.prevent_order_history_mutation\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.current_app_role\(\) TO authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.current_store_id\(\) TO authenticated/);
  assert.match(migration, /carts\.customer_id = auth\.uid\(\) OR public\.current_app_role\(\) = 'admin'/);
  assert.doesNotMatch(migration, /carts\.store_id = public\.current_store_id\(\)/);
  assert.match(migration, /stores_owner_user_id_immutable/);
  for (const table of ["store_service_pincodes", "store_operating_hours", "categories", "products"]) {
    assert.match(migration, new RegExp(`${table}_store_id_immutable`));
  }
  assert.match(migration, /orders_customer_newest_idx[\s\S]*customer_id, created_at DESC, id DESC/);
  assert.match(migration, /orders_store_status_newest_idx[\s\S]*store_id, status, created_at DESC, id DESC/);
});

test("Phase 11 structurally enforces role, ownership, and protected-field boundaries", async () => {
  const [orderRoutes, cartRoutes, catalogRoutes, customerRoutes] = await Promise.all([
    readFile(new URL("./routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../customer-cart/routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../catalog-management/routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../customer-management/routes.ts", import.meta.url), "utf8"),
  ]);
  assert.match(orderRoutes, /requireRole\("customer"\)/);
  assert.match(orderRoutes, /requireRole\("vendor"\)/);
  assert.match(orderRoutes, /requireRole\("admin"\)/);
  assert.match(orderRoutes, /eq\(orders\.customerId, userId\(req\)\)/);
  assert.match(orderRoutes, /eq\(orders\.storeId, storeId\)/);
  assert.doesNotMatch(orderRoutes, /ordersRouter\.(patch|put)\("\/api\/admin\/orders/);
  assert.match(cartRoutes, /eq\(carts\.customerId, ownerId\)/);
  assert.match(catalogRoutes, /eq\(products\.storeId, storeId\)/);
  assert.match(catalogRoutes, /eq\(categories\.storeId, storeId\)/);
  assert.match(customerRoutes, /eq\(customerAddresses\.customerId, ownerId\)/);
  assert.equal(customerOrderCreateSchema.safeParse({
    addressId: crypto.randomUUID(), paymentMethod: "COD", customerId: crypto.randomUUID(),
    storeId: crypto.randomUUID(), status: "DELIVERED", subtotal: "0.01",
    totalAmount: "0.01", commissionAmountSnapshot: "0.01",
  }).success, false);
});

test("order placement structurally locks before rechecking and converts atomically", async () => {
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const orderRoute = routes.slice(
    routes.indexOf('ordersRouter.post("/api/customer/orders"'),
    routes.indexOf('ordersRouter.get("/api/customer/orders"'),
  );
  const advisoryLock = orderRoute.indexOf("pg_advisory_xact_lock");
  const activeCartRead = orderRoute.indexOf('eq(carts.status, "ACTIVE")');
  const cartRowLock = orderRoute.indexOf('.for("update")');
  const orderInsert = orderRoute.indexOf("tx.insert(orders)");
  const itemInsert = orderRoute.indexOf("tx.insert(orderItems)");
  const historyInsert = orderRoute.indexOf("tx.insert(orderStatusHistory)");
  const cartConversion = orderRoute.indexOf('status: "CONVERTED"');

  assert.ok(advisoryLock >= 0);
  assert.ok(advisoryLock < activeCartRead);
  assert.ok(activeCartRead < cartRowLock);
  assert.ok(cartRowLock < orderInsert);
  assert.ok(orderInsert < itemInsert);
  assert.ok(itemInsert < historyInsert);
  assert.ok(historyInsert < cartConversion);
  assert.match(orderRoute, /isolationLevel: "read committed"/);
});

test("Phase 2 and Phase 8 migrations preserve exact order visibility and snapshots", async () => {
  const [foundation, hardening] = await Promise.all([
    readFile(
      new URL("../../../../database/migrations/0000_furry_doomsday.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../../../database/migrations/0003_harden_order_history.sql", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(foundation, /orders_customer_vendor_admin_select[\s\S]*customer_id = auth\.uid\(\)[\s\S]*store_id = public\.current_store_id\(\)[\s\S]*current_app_role\(\) = 'admin'/);
  assert.match(foundation, /order_items_customer_vendor_admin_select[\s\S]*orders\.id = order_items\.order_id/);
  assert.match(foundation, /order_status_history_customer_vendor_admin_select[\s\S]*orders\.id = order_status_history\.order_id/);
  assert.match(foundation, /CREATE TRIGGER orders_prevent_snapshot_changes/);
  assert.match(foundation, /NEW\.subtotal IS DISTINCT FROM OLD\.subtotal/);
  assert.match(foundation, /NEW\.delivery_address_snapshot IS DISTINCT FROM OLD\.delivery_address_snapshot/);
  assert.match(foundation, /CREATE TRIGGER order_items_prevent_snapshot_changes/);
  assert.match(foundation, /NEW\.product_name_snapshot IS DISTINCT FROM OLD\.product_name_snapshot/);
  assert.match(foundation, /NEW\.product_price_snapshot IS DISTINCT FROM OLD\.product_price_snapshot/);
  assert.match(hardening, /DROP POLICY IF EXISTS orders_admin_manage ON public\.orders/);
});