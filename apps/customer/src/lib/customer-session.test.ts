import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { retainVerifiedCustomerAccess } from "./customer-session";

test("only transient verification failures retain a previously verified same-user Customer session", () => {
  assert.equal(retainVerifiedCustomerAccess("customer-1", "customer-1", 503), true);
  assert.equal(retainVerifiedCustomerAccess("customer-1", "customer-1", undefined), true);
  assert.equal(retainVerifiedCustomerAccess("customer-1", "customer-1", 401), false);
  assert.equal(retainVerifiedCustomerAccess("customer-1", "customer-1", 403), false);
  assert.equal(retainVerifiedCustomerAccess("customer-1", "customer-2", 503), false);
  assert.equal(retainVerifiedCustomerAccess(null, "customer-1", 503), false);
});

test("Customer session restore cannot overwrite a newer auth event and rechecks on tab return", async () => {
  const app = await readFile(new URL("../../App.tsx", import.meta.url), "utf8");
  assert.ok(app.indexOf("supabase.auth.onAuthStateChange") < app.indexOf("supabase.auth.getSession"));
  assert.match(app, /if \(!active \|\| sessionEventSeen\) return/);
  assert.match(app, /window.addEventListener\("focus", scheduleAccessCheck\)/);
  assert.match(app, /window.addEventListener\("online", scheduleAccessCheck\)/);
  assert.match(app, /status === 401 \|\| status === 403/);
});
