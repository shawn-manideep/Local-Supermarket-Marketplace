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

test("Phase 9 order list queries are strict and bounded", () => {
  assert.equal(vendorOrderQuerySchema.safeParse({ page: "1", pageSize: "100", status: "READY" }).success, true);
  assert.equal(vendorOrderQuerySchema.safeParse({ pageSize: "101" }).success, false);
  assert.equal(vendorOrderQuerySchema.safeParse({ storeId: crypto.randomUUID() }).success, false);
  assert.equal(adminOrderQuerySchema.safeParse({
    storeId: crypto.randomUUID(), from: "2025-01-01T00:00:00.000Z",
    to: "2025-01-02T00:00:00.000Z",
  }).success, true);
  assert.equal(adminOrderQuerySchema.safeParse({ from: "not-a-date" }).success, false);
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