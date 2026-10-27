import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { before, after } from "node:test";
import { vendorOrderActionSchema, vendorOrderQuerySchema } from "@workspace/validation";
import { LEGAL_ORDER_TRANSITIONS } from "./lifecycle.js";
import { localApiFixture } from "../test-fixtures/local-api.js";

let fixture: Awaited<ReturnType<typeof localApiFixture>>;
type VendorList = {
  orders: { id: string; itemCount: number }[];
  pagination: { total: number };
  counts: Record<string, number>;
};
before(async () => { fixture = await localApiFixture(); });
after(async () => { if (fixture) await fixture.close(); });

for (const [action, from, to] of [
  ["ACCEPT", "PLACED", "ACCEPTED"],
  ["REJECT", "PLACED", "REJECTED"],
  ["PREPARE", "ACCEPTED", "PREPARING"],
  ["READY", "PREPARING", "READY"],
] as const) {
  test(`existing authoritative lifecycle permits ${from} → ${to}`, () => {
    assert.equal(LEGAL_ORDER_TRANSITIONS[action]![from], to);
    assert.equal(vendorOrderActionSchema.safeParse({ action }).success, true);
  });
}
test("skips, late rejection, terminal actions and duplicate accept/reject are not legal", () => {
  assert.equal(LEGAL_ORDER_TRANSITIONS.PREPARE!.PLACED, undefined);
  assert.equal(LEGAL_ORDER_TRANSITIONS.READY!.PLACED, undefined);
  assert.equal(LEGAL_ORDER_TRANSITIONS.READY!.ACCEPTED, undefined);
  assert.equal(LEGAL_ORDER_TRANSITIONS.ACCEPT!.ACCEPTED, undefined);
  assert.equal(LEGAL_ORDER_TRANSITIONS.REJECT!.REJECTED, undefined);
  assert.equal(LEGAL_ORDER_TRANSITIONS.REJECT!.ACCEPTED, undefined);
  assert.equal(LEGAL_ORDER_TRANSITIONS.REJECT!.PREPARING, undefined);
  for (const status of ["DELIVERED", "CANCELLED", "REJECTED"])
    for (const action of ["ACCEPT", "REJECT", "PREPARE", "READY"])
      assert.equal(LEGAL_ORDER_TRANSITIONS[action]![status], undefined);
});
test("vendor queries and actions reject forged store, customer, snapshots and arbitrary statuses", () => {
  assert.equal(vendorOrderQuerySchema.safeParse({ status: "PLACED" }).success, true);
  assert.equal(vendorOrderQuerySchema.safeParse({ storeId: crypto.randomUUID() }).success, false);
  assert.equal(vendorOrderActionSchema.safeParse({ status: "READY" }).success, false);
  assert.equal(vendorOrderActionSchema.safeParse({ action: "REJECT", note: "Unavailable for fulfillment" }).success, true);
  for (const field of ["storeId", "customerId", "totalAmount", "items", "variantId"])
    assert.equal(vendorOrderActionSchema.safeParse({ action: "ACCEPT", [field]: "forged" }).success, false);
});

async function vendorRoutes() {
  const source = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  return {
    source,
    list: source.slice(source.indexOf('ordersRouter.get("/api/vendor/orders",'), source.indexOf('ordersRouter.get("/api/vendor/orders/:orderId",')),
    detail: source.slice(source.indexOf('ordersRouter.get("/api/vendor/orders/:orderId",'), source.indexOf('ordersRouter.post("/api/vendor/orders/:orderId/actions",')),
    action: source.slice(source.indexOf('ordersRouter.post("/api/vendor/orders/:orderId/actions",'), source.indexOf("const adminOrderListFields")),
  };
}
test("new orders, list totals and status counts all use the authenticated vendor's store scope", async () => {
  const { list } = await vendorRoutes();
  assert.match(list, /requireRole\("vendor"\)/);
  assert.match(list, /auth\?\.storeId/);
  assert.match(list, /eq\(orders\.storeId, storeId\)/);
  assert.match(list, /status !== "ALL" \? \[eq\(orders\.status, status\)\]/);
  assert.match(list, /where\(where\)/);
  assert.match(list, /where\(and\(eq\(orders\.storeId, storeId\),\s*dateWhere\)\)\.groupBy\(orders\.status\)/);
  assert.match(list, /where\(inArray\(orderItems\.orderId, ids\)\)/);
  const placed=await fixture.order(0), ready=await fixture.order(0,"READY");
  await fixture.order(1);
  await fixture.order(0,"PLACED","2026-10-13T10:00:00+05:30");
  const response=await fixture.request("/api/vendor/orders?dateFilter=CUSTOM&startDate=2026-10-14&endDate=2026-10-14&status=PLACED",fixture.vendors[0]);
  assert.equal(response.status,200);
  const result=await response.json() as VendorList;
  assert.deepEqual(result.orders.map((row: {id:string})=>row.id),[placed]);
  assert.equal(result.orders[0].itemCount,2);
  assert.equal(result.pagination.total,1);
  assert.equal(result.counts.PLACED,1);
  assert.equal(result.counts.READY,1,"counts preserve date/store scope but not selected-status scope");
  assert.equal(Object.values(result.counts).reduce((sum:number,n)=>sum+Number(n),0),2);
  const all=await (await fixture.request("/api/vendor/orders?dateFilter=CUSTOM&startDate=2026-10-14&endDate=2026-10-14&status=ALL",fixture.vendors[0])).json() as VendorList;
  assert.deepEqual(new Set(all.orders.map((row:{id:string})=>row.id)),new Set([placed,ready]));
  assert.equal(all.pagination.total,2);
  assert.equal((await fixture.request(`/api/vendor/orders?storeId=${fixture.stores[1]}`,fixture.vendors[0])).status,400);
});
test("unauthorized details fail before reading any items or customer fulfillment snapshots", async () => {
  const { detail } = await vendorRoutes();
  assert.match(detail, /requireRole\("vendor"\)/);
  assert.match(detail, /eq\(orders\.id, id\), eq\(orders\.storeId, storeId\)/);
  const ownershipGuard = detail.indexOf('if (!order) throw new HttpError(404, "Order not found")');
  assert.ok(ownershipGuard >= 0);
  assert.ok(ownershipGuard < detail.indexOf("select(safeItemFields)"));
  assert.ok(ownershipGuard < detail.indexOf("select(safeHistoryFields)"));
});
test("cross-vendor and invalid actions throw inside the transaction before parent or history writes", async () => {
  const { action } = await vendorRoutes();
  const transaction = action.indexOf("getDb().transaction");
  const ownershipGuard = action.indexOf('if (!order) throw new HttpError(404, "Order not found")');
  const transitionGuard = action.indexOf('if (!next) throw new HttpError(409');
  const parentWrite = action.indexOf("tx.update(orders)");
  assert.match(action, /eq\(orders\.id, id\), eq\(orders\.storeId, storeId\)/);
  assert.match(action, /\.for\("update"\)/);
  assert.match(action, /LEGAL_ORDER_TRANSITIONS\[parsed\.data\.action\]\?\.\[order\.status\]/);
  assert.ok(transaction < ownershipGuard && ownershipGuard < transitionGuard);
  assert.ok(ownershipGuard < parentWrite,"ownership is checked before every branch can write");
  assert.match(action,/parsed\.data\.action === "READY" && order\.status === "ACCEPTED"/);
  const finalWrite=action.indexOf("const [value] = await tx.update(orders)");
  assert.ok(transitionGuard < finalWrite,"generic transitions validate before their final write");
  assert.match(action, /isolationLevel: "read committed"/);
  const id=await fixture.order(0);
  const state=async ()=>(await fixture.pool.query(`SELECT
    (SELECT to_jsonb(o) FROM orders o WHERE id=$1) AS parent,
    (SELECT jsonb_agg(to_jsonb(h) ORDER BY created_at,id) FROM order_status_history h WHERE order_id=$1) AS history,
    (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM product_variants v) AS variants`,[id])).rows;
  const initial=await state();
  assert.equal((await fixture.request(`/api/vendor/orders/${id}/actions`,fixture.vendors[1],{action:"ACCEPT"})).status,404);
  assert.deepEqual(await state(),initial);
  assert.equal((await fixture.request(`/api/vendor/orders/${id}/actions`,fixture.vendors[0],{action:"READY"})).status,409);
  assert.deepEqual(await state(),initial);
});
test("intermediate preparation and stock restoration roll back when audit history fails",async()=>{
  // A test-only database trigger fails AFTER parent writes, proving actual rollback.
  await fixture.pool.query(`CREATE FUNCTION fixture_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END $$;
    CREATE TRIGGER fixture_fail_audit BEFORE INSERT ON order_status_history
      FOR EACH ROW EXECUTE FUNCTION fixture_fail_audit();`);
  try {
    for(const [status,action,deducted] of [["ACCEPTED","READY",false],["PLACED","ACCEPT",false],["PLACED","REJECT",true]] as const) {
      const id=await fixture.order(0,status,undefined,deducted);
      const snapshot=async ()=>(await fixture.pool.query(`SELECT
        (SELECT to_jsonb(o) FROM orders o WHERE id=$1) AS parent,
        (SELECT jsonb_agg(to_jsonb(h) ORDER BY created_at,id) FROM order_status_history h WHERE order_id=$1) AS history,
        (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM product_variants v) AS variants`,[id])).rows;
      const before=await snapshot();
      assert.equal((await fixture.request(`/api/vendor/orders/${id}/actions`,fixture.vendors[0],{action})).status,500);
      assert.deepEqual(await snapshot(),before);
    }
  } finally {
    await fixture.pool.query("DROP TRIGGER fixture_fail_audit ON order_status_history; DROP FUNCTION fixture_fail_audit()");
  }
});
test("concurrent acceptance and rejection preserve single audit events and exactly-once stock restoration",async()=>{
  const actions=async(id:string,action:string)=>Promise.all([1,2].map(()=>fixture.request(`/api/vendor/orders/${id}/actions`,fixture.vendors[0],{action})));
  const accepted=await fixture.order(0);
  assert.deepEqual((await actions(accepted,"ACCEPT")).map(r=>r.status).sort(),[200,409]);
  const history=async(id:string)=>(await fixture.pool.query("SELECT status,changed_by,note FROM order_status_history WHERE order_id=$1 ORDER BY created_at,id",[id])).rows;
  assert.deepEqual((await history(accepted)).map(row=>row.status),["ACCEPTED","PREPARING"]);
  assert.ok((await history(accepted)).every(row=>row.changed_by===fixture.vendors[0]));
  assert.equal((await fixture.request(`/api/vendor/orders/${accepted}/actions`,fixture.vendors[0],{action:"READY",note:"Fixture ready"})).status,200);
  assert.deepEqual((await history(accepted)).map(row=>row.status),["ACCEPTED","PREPARING","READY"]);
  assert.equal((await history(accepted))[2].note,"Fixture ready");
  const legacy=await fixture.order(0,"ACCEPTED");
  assert.equal((await fixture.request(`/api/vendor/orders/${legacy}/actions`,fixture.vendors[0],{action:"READY"})).status,200);
  assert.deepEqual((await history(legacy)).map(row=>row.status),["PREPARING","READY"]);
  const rejected=await fixture.order(0,"PLACED",undefined,true);
  const stock=async()=>(await fixture.pool.query("SELECT stock_quantity FROM product_variants WHERE id=$1",[fixture.variants[0]])).rows[0].stock_quantity;
  const before=await stock();
  assert.deepEqual((await actions(rejected,"REJECT")).map(r=>r.status).sort(),[200,409]);
  assert.equal(await stock(),before+2);
  assert.deepEqual((await history(rejected)).map(row=>row.status),["REJECTED"]);
  assert.equal((await fixture.pool.query("SELECT inventory_state FROM orders WHERE id=$1",[rejected])).rows[0].inventory_state,"RESTORED");
});
test("each valid transition appends existing status history with optional reason and actor", async () => {
  const { action } = await vendorRoutes();
  assert.match(action, /tx\.insert\(orderStatusHistory\)\.values\(\{ orderId: id, status: next as typeof order\.status, note: parsed\.data\.note, changedBy: userId\(req\)/);
  assert.doesNotMatch(action, /(?:update|delete)\(orderStatusHistory\)/);
});
test("operational updates preserve every commercial snapshot and never touch inventory or catalog", async () => {
  const { action, detail } = await vendorRoutes();
  assert.match(action, /set\(\{ status: next as typeof order\.status, updatedAt: new Date\(\) \}\)/);
  assert.doesNotMatch(action, /(?:update|delete|insert)\((?:orderItems|products|productVariants|masterProducts|customerAddresses|userProfiles)\)/);
  assert.doesNotMatch(detail, /innerJoin\((?:products|productVariants|masterProducts)/);
});
test("safe vendor responses expose only order fulfillment and historical commercial allowlists", async () => {
  const { source, list, detail, action } = await vendorRoutes();
  const orderFields = source.slice(source.indexOf("const safeOrderFields"), source.indexOf("const safeOrderSummaryFields"));
  const itemFields = source.slice(source.indexOf("const safeItemFields"), source.indexOf("const safeHistoryFields"));
  assert.match(itemFields, /variantNameSnapshot: orderItems\.variantNameSnapshot/);
  assert.match(itemFields, /productPriceSnapshot: orderItems\.productPriceSnapshot/);
  for (const body of [orderFields, itemFields, list, detail, action])
    assert.doesNotMatch(body, /password|sku|externalCode|commissionAmountSnapshot|commissionRateSnapshot|customerId|userProfiles/);
  assert.match(detail, /select\(safeItemFields\)/);
  assert.match(action, /select\(\{ \.\.\.safeOrderFields/);
  assert.doesNotMatch(action, /res\.json\(\{ order: updated \}\)/);
});
test("vendor and customer read the same persisted status, without a second status model", async () => {
  const { source } = await vendorRoutes();
  const customer = source.slice(source.indexOf('ordersRouter.get("/api/customer/orders/:orderId",'), source.indexOf('ordersRouter.post("/api/customer/orders/:orderId/cancel",'));
  assert.match(source, /status: orders\.status/);
  assert.match(customer, /safeOrderFields/);
  const customerUi = await readFile(new URL("../../../../apps/customer/src/OrdersScreen.tsx", import.meta.url), "utf8");
  assert.match(customerUi, /localOrder\.status\.replaceAll/);
  assert.doesNotMatch(customer, /vendorPreparationStatus|deliveryPartnerStatus/);
});