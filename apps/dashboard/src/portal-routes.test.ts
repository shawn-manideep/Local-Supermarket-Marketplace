import assert from "node:assert/strict";
import test from "node:test";
import { dashboardForRole, legacyPortalEntryFromPath, loginForDashboard, portalRouteFromPath, portalRouteMatchesRole, portalRoutePath } from "./portal-routes";

test("separate portal entry, dashboard, and legacy paths resolve within the artifact base", () => {
  const base = "/marketplace-dashboard/";
  assert.equal(portalRouteFromPath("/marketplace-dashboard/vendor/login", base), "vendor-login");
  assert.equal(portalRouteFromPath("/marketplace-dashboard/vendor/dashboard", base), "vendor-dashboard");
  assert.equal(portalRouteFromPath("/marketplace-dashboard/delivery/login", base), "delivery-login");
  assert.equal(portalRouteFromPath("/marketplace-dashboard/delivery/dashboard", base), "delivery-dashboard");
  assert.equal(portalRouteFromPath("/marketplace-dashboard/admin/vendors/123", base), "admin");
  assert.equal(portalRouteFromPath("/marketplace-dashboard/delivery-partner", base), "delivery-login");
  assert.equal(portalRouteFromPath("/marketplace-dashboard/", base), "vendor-login");
  assert.equal(portalRouteFromPath("/marketplace-dashboard-other/vendor/dashboard", base), "not-found");
  assert.equal(legacyPortalEntryFromPath("/marketplace-dashboard/", base), "home");
  assert.equal(legacyPortalEntryFromPath("/marketplace-dashboard/delivery-partner", base), "delivery");
  assert.equal(legacyPortalEntryFromPath("/marketplace-dashboard/vendor/login", base), null);
});

test("canonical portal paths preserve each role's own dashboard and login", () => {
  const base = "/marketplace-dashboard/";
  assert.equal(portalRoutePath("vendor-login", base), "/marketplace-dashboard/vendor/login");
  assert.equal(portalRoutePath("delivery-dashboard", base), "/marketplace-dashboard/delivery/dashboard");
  assert.equal(dashboardForRole("vendor"), "vendor-dashboard");
  assert.equal(dashboardForRole("delivery_partner"), "delivery-dashboard");
  assert.equal(dashboardForRole("admin"), "admin");
  assert.equal(loginForDashboard("vendor-dashboard"), "vendor-login");
  assert.equal(loginForDashboard("delivery-dashboard"), "delivery-login");
  assert.equal(loginForDashboard("admin"), null);
  assert.equal(portalRouteMatchesRole("vendor", "vendor-dashboard"), true);
  assert.equal(portalRouteMatchesRole("vendor", "delivery-dashboard"), false);
  assert.equal(portalRouteMatchesRole("delivery_partner", "delivery-login"), true);
  assert.equal(portalRouteMatchesRole("delivery_partner", "vendor-login"), false);
  assert.equal(portalRouteMatchesRole("admin", "admin"), true);
  assert.equal(portalRouteMatchesRole("admin", "vendor-dashboard"), false);
});
