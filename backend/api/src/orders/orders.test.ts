import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  customerOrderCreateSchema,
  customerOrderIdParamSchema,
  vendorOrderActionSchema,
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
      ["POST", `/api/vendor/orders/${id}/actions`],
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