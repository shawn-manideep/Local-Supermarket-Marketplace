import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApp } from "../app.js";
import { shouldApplyVendorMasterCategoryFilter } from "./routes.js";

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("master catalog reads and mutations require vendor or admin authorization", async () => {
  await withServer(async (baseUrl) => {
    const cases: Array<[string, RequestInit?]> = [
      ["/api/vendor/master-categories"],
      ["/api/vendor/master-products?search=rice"],
      ["/api/vendor/master-products/duplicate-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }],
      ["/api/vendor/master-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }],
      ["/api/admin/master-categories"],
      ["/api/admin/master-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }],
      ["/api/admin/master-products/11111111-1111-4111-8111-111111111111/archive", { method: "POST" }],
    ];
    for (const [path, init] of cases) {
      const response = await fetch(`${baseUrl}${path}`, init);
      assert.equal(response.status, 401, path);
      assert.deepEqual(await response.json(), { error: "Authentication required" }, path);
    }
  });
});

test("vendor Master Catalog search ignores the browse category filter only for nonempty global searches", () => {
  assert.equal(shouldApplyVendorMasterCategoryFilter("rice"), false);
  assert.equal(shouldApplyVendorMasterCategoryFilter("  milk  "), false);
  assert.equal(shouldApplyVendorMasterCategoryFilter(undefined), true);
  assert.equal(shouldApplyVendorMasterCategoryFilter("   "), true);
});

test("master catalog does not expose physical deletion endpoints", async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      "/api/admin/master-categories/11111111-1111-4111-8111-111111111111",
      "/api/admin/master-products/11111111-1111-4111-8111-111111111111",
    ]) {
      const response = await fetch(`${baseUrl}${path}`, { method: "DELETE" });
      assert.equal(response.status, 404, path);
    }
  });
});

test("vendor master search and detail include active pending products but filter archived categories", async () => {
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  assert.equal((routes.match(/ilike\(masterProducts\.description, pattern\)/g) ?? []).length, 3,
    "vendor search, duplicate candidates, and admin search include ordinary product details");
  const vendorProductReads = routes.slice(
    routes.indexOf('masterCatalogRouter.get(\n  "/api/vendor/master-products",'),
    routes.indexOf('masterCatalogRouter.post(\n  "/api/vendor/master-products/duplicate-check",'),
  );
  assert.match(vendorProductReads, /leftJoin\(masterCategories/);
  assert.match(vendorProductReads, /or\(isNull\(masterProducts\.masterCategoryId\), eq\(masterCategories\.isActive, true\)\)/);
  assert.match(vendorProductReads, /classificationLabel: row\.categoryName \?\? "Pending classification"/);
  assert.match(routes, /classificationLabel: categoryName \?\? "Pending classification"/);
  assert.match(routes, /canAddToStore: match\.isActive && \(match\.masterCategoryId === null \|\| categoryIsActive === true\)/);
  assert.match(routes, /categoryActive: masterCategories\.isActive,[\s\S]*?leftJoin\(masterCategories,[\s\S]*?or\(isNull\(masterProducts\.masterCategoryId\), eq\(masterCategories\.isActive, true\)\)/);
});

test("admin can classify a pending product and category counts include archived products", async () => {
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const adminCategories = routes.slice(
    routes.indexOf('masterCatalogRouter.get(\n  "/api/admin/master-categories",'),
    routes.indexOf('masterCatalogRouter.get(\n  "/api/admin/master-products",'),
  );
  const adminProductPatch = routes.slice(
    routes.indexOf('masterCatalogRouter.patch(\n  "/api/admin/master-products/:id",'),
    routes.indexOf("async function setMasterCategoryActive"),
  );
  assert.match(adminCategories, /productCount: count\(masterProducts\.id\)/);
  assert.match(adminCategories, /leftJoin\(masterProducts, eq\(masterProducts\.masterCategoryId, masterCategories\.id\)\)/);
  assert.match(adminCategories, /\.groupBy\(masterCategories\.id\)/);
  assert.doesNotMatch(adminCategories, /eq\(masterProducts\.isActive/);
  assert.match(adminProductPatch, /isNewMasterCategoryAssignment\(existing\.masterCategoryId, parsed\.data\.masterCategoryId\)/);
  assert.match(adminProductPatch, /masterCategoryId: parsed\.data\.masterCategoryId === undefined[\s\S]*?existing\.masterCategoryId[\s\S]*?: parsed\.data\.masterCategoryId/);
});