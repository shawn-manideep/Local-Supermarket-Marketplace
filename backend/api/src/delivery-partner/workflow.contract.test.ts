import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("customer delivery progress uses existing order status/history endpoint with abortable refresh, not assignment/private partner fields", async () => {
  const source = await readFile(new URL("../../../../apps/customer/src/OrdersScreen.tsx",import.meta.url),"utf8");
  const detail = source.slice(source.indexOf("function OrderDetail"));
  assert.match(detail, /\/api\/customer\/orders\/\$\{order\.id\}/);
  assert.match(detail, /signal: controller\.signal/);
  assert.match(detail, /generation === refreshGeneration\.current/);
  assert.match(detail, /45_000/);
  assert.match(detail, /controller\.abort\(\); clearInterval\(timer\)/);
  assert.match(detail, /localOrder\.statusHistory/);
  assert.doesNotMatch(detail, /\/delivery-partner\/|partner_user_id|partnerUsername|delivery_assignments/);
});
test("vendor legacy delivery mutation is blocked before order/stock writes; new workflow never imports inventory", async () => {
  const orders = await readFile(new URL("../orders/routes.ts",import.meta.url),"utf8");
  const actions = orders.slice(orders.indexOf('ordersRouter.post("/api/vendor/orders/:orderId/actions"'));
  assert.ok(actions.indexOf('parsed.data.action === "OUT_FOR_DELIVERY"') < actions.indexOf("getDb().transaction"));
  assert.match(actions, /UNAUTHORIZED_DELIVERY_ACTION/);
  const workflow = await readFile(new URL("./workflow.ts",import.meta.url),"utf8");
  assert.match(workflow,/LEGAL_ORDER_TRANSITIONS/);
  assert.match(workflow,/INSERT INTO order_status_history/);
  assert.doesNotMatch(workflow,/product_variants|restoreOrderStock|deductOrderStock|inventory_state|commission_amount_snapshot/);
});