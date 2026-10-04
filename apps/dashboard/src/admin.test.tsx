import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { matchesAdminPath } from "./admin/route-access";
test("dedicated admin navigation supports root and artifact-prefixed child routes without matching vendor/partner paths", () => {
  for (const path of ["/admin", "/admin/", "/admin/vendors", "/admin/customers", "/admin/delivery-partners", "/admin/profile"]) {
    assert.ok(matchesAdminPath(path));
    assert.ok(matchesAdminPath(`/marketplace-dashboard${path}`, "/marketplace-dashboard/"));
  }
  for (const path of ["/", "/vendor", "/delivery-partner", "/administrator", "/admin-not-admin"]) {
    assert.ok(!matchesAdminPath(path));
  }
  assert.ok(!matchesAdminPath("/marketplace-dashboard-other/admin", "/marketplace-dashboard/"));
});
test("Admin route checks authoritative role before rendering other portals; retains email/password session flow", async () => {
  const app = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  assert.ok(app.indexOf('if (adminMode && profile.role !== "admin")') < app.indexOf('if (profile.role === "delivery_partner")'));
  assert.match(app, /supabase\.auth\.signInWithPassword/);
  assert.match(app, /email: email\.trim\(\),\s+password,/);
  assert.match(app, /apiRequest<AuthProfile>\("\/api\/auth\/me"/);
  assert.match(app, /Admin access denied/);
  assert.match(app, /<AdminPortal/);
  assert.doesNotMatch(app, /signUp|AdminSummaryTiles|<AdminStoreDetails|<AdminDeliveryPartners/);
});
test("Admin UI binds server pagination, warnings, confirmations, request cancellation and secure provisioning states", async () => {
  const ui = await readFile(new URL("./admin/AdminPortal.tsx", import.meta.url), "utf8");
  for (const method of ["getAdminDashboard", "listAdminAccounts", "getAdminAccount", "changeAdminStatus", "createAdminPartner"]) assert.match(ui, new RegExp(method));
  for (const section of ["Dashboard", "Vendors", "Customers", "Delivery Partners", "Profile", "Logout"]) assert.ok(ui.includes(section));
  assert.match(ui, /window\.confirm/); assert.match(ui, /account\.activeAssignments > 0/);
  assert.match(ui, /account\.allowedStatuses\.includes/); assert.match(ui, /new AbortController/);
  assert.match(ui, /visibilitychange/); assert.match(ui, /pageSize: 15/);
  assert.match(ui, /setPassword\(""\)/);
  assert.doesNotMatch(ui, /console\.|localStorage|sessionStorage|method:\s*"DELETE"|Change Role|Impersonate/);
});