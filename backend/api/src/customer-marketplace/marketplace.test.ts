import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { customerCatalogQuerySchema, customerDiscoveryQuerySchema } from "@workspace/validation";
import { createApp } from "../app.js";
import { operatingStatus } from "./operating-status.js";
import { addCustomerVariants, customerProductQuerySchema, customerVariantFields, publicProduct } from "./routes.js";

test("discovery validates Indian pincodes and optional category IDs", () => {
  assert.equal(customerDiscoveryQuerySchema.safeParse({ pincode: "560001" }).success, true);
  assert.equal(customerDiscoveryQuerySchema.safeParse({ pincode: "000001" }).success, false);
  assert.equal(customerCatalogQuerySchema.safeParse({ pincode: "560001", categoryId: "bad" }).success, false);
});

test("customer product search validates pincode, pagination, and optional filters", () => {
  const parsed = customerProductQuerySchema.safeParse({ pincode: "560001", search: "  rice  ", page: "2", pageSize: "24" });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.search, "rice");
    assert.deepEqual({ page: parsed.data.page, pageSize: parsed.data.pageSize }, { page: 2, pageSize: 24 });
  }
  assert.equal(customerProductQuerySchema.safeParse({ pincode: "560001" }).success, true);
  assert.equal(customerProductQuerySchema.safeParse({ pincode: "560001", page: "0" }).success, false);
  assert.equal(customerProductQuerySchema.safeParse({ pincode: "560001", pageSize: "101" }).success, false);
  assert.equal(customerProductQuerySchema.safeParse({ pincode: "560001", categoryId: "bad" }).success, false);
});

test("global customer discovery and store catalog require customer authentication", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    for (const path of [
      "/api/customer/products?pincode=560001&search=rice",
      "/api/customer/categories?pincode=560001",
      `/api/customer/stores/${crypto.randomUUID()}/products?pincode=560001&page=1&pageSize=24`,
    ]) {
      assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status, 401);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("operating status separates weekly schedule from approval status", () => {
  const mondayAtTenInIndia = new Date("2026-09-21T04:30:00.000Z");
  assert.equal(operatingStatus([{ dayOfWeek: 1, opensAt: "09:00:00", closesAt: "18:00:00", isClosed: false }], mondayAtTenInIndia), "OPEN");
  assert.equal(operatingStatus([{ dayOfWeek: 1, opensAt: "11:00:00", closesAt: "18:00:00", isClosed: false }], mondayAtTenInIndia), "CLOSED");
  assert.equal(operatingStatus([{ dayOfWeek: 1, opensAt: null, closesAt: null, isClosed: true }], mondayAtTenInIndia), "CLOSED");
});

test("customer marketplace RLS uses non-recursive eligibility helpers", async () => {
  const migration = await readFile(
    new URL("../../../../database/migrations/0001_customer_marketplace_read_policies.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = public/);
  assert.match(migration, /USING \(public\.customer_can_access_store\(id\)\)/);
  assert.doesNotMatch(migration, /stores_customer_discovery_select[\\s\\S]*?JOIN public\.store_service_pincodes/);
});

test("customer product lists use safe variants and server pagination without internal inventory fields", async () => {
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const customerApi = await readFile(new URL("../../../../apps/customer/src/lib/api.ts", import.meta.url), "utf8");
  assert.match(routes, /isActive: productVariants\.isActive/);
  assert.match(routes, /eq\(productVariants\.isActive, true\)/);
  assert.match(routes, /purchasable: sql<boolean>/);
  assert.doesNotMatch(routes, /masterProductId\s*:|sku:\s*productVariants\.sku|externalCode:\s*productVariants\.externalCode|stockQuantity:\s*productVariants\.stockQuantity|createdAt:\s*productVariants\.createdAt|updatedAt:\s*productVariants\.updatedAt/);
  assert.doesNotMatch(customerApi, /masterProductId\s*:/);
  assert.match(routes, /\.limit\(query\.pageSize\)\s*\.offset\(\(query\.page - 1\) \* query\.pageSize\)/);
  assert.match(routes, /pagination: \{ page: query\.page, pageSize: query\.pageSize, total:/);
});

test("customer offers remain discoverable while purchase eligibility requires an active, available, stocked, priced variant", async () => {
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const activeVariantsQuery = routes.slice(
    routes.indexOf("async function customerVariantsFor"),
    routes.indexOf("function addCustomerVariants"),
  );
  assert.match(routes, /purchasable: sql<boolean>`\$\{productVariants\.isActive\} = true AND \$\{productVariants\.availability\} = true AND \$\{productVariants\.stockQuantity\} > 0 AND \$\{productVariants\.price\} > 0`/);
  assert.match(activeVariantsQuery, /eq\(productVariants\.isActive, true\)/);
  assert.doesNotMatch(activeVariantsQuery, /stockQuantity/);
  assert.match(routes, /purchasable: product\.availability && productVariants\.some\(\(variant\) => variant\.purchasable\)/);
});

test("customer variant choices label options and disable unavailable or out-of-stock purchases", async () => {
  const screen = await readFile(new URL("../../../../apps/customer/src/MarketplaceScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /Choose an option/);
  assert.match(screen, /function customerVariantLabel/);
  assert.match(screen, /variantAvailabilityLabel.*from "\.\/lib\/shopping"/);
  assert.match(screen, /accessibilityState=\{\{ selected, disabled: !available \}\} disabled=\{!available\}/);
  assert.match(screen, /if \(!canPurchaseVariant\(selected, variant\)\)/);
  assert.match(screen, /setSelectedVariantId\(initialVariantId\(/);
  assert.doesNotMatch(screen, /Available sizes/);
});

test("public product and variant SQL projections omit private catalog and inventory fields", () => {
  for (const projection of [publicProduct, customerVariantFields]) {
    for (const field of ["sku", "externalCode", "stockQuantity", "createdAt", "updatedAt", "masterProductId"]) {
      assert.equal(Object.hasOwn(projection, field), false, field);
    }
  }
});

test("one listing groups multiple variants without creating duplicate product results", () => {
  const product = {
    id: "product-a", storeId: "store-a", categoryId: null, name: "Rice",
    description: null, price: "0.00", availability: true, imageUrl: null, brand: null, categoryName: null,
  };
  const variant = {
    id: "variant-a", productId: product.id, name: "1 kg", quantityValue: "1", quantityUnit: "kg",
    price: "75.50", availability: true, isActive: true, sortOrder: 0, purchasable: true,
  };
  const result = addCustomerVariants([product], [variant, { ...variant, id: "variant-b", price: "145.00", sortOrder: 1 }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].variants.length, 2);
  assert.equal(result[0].variants[0].price, "75.50");
  assert.equal(result[0].purchasable, true);
  assert.equal(addCustomerVariants([product], [{ ...variant, purchasable: false }])[0].purchasable, false);
  assert.equal(addCustomerVariants([{ ...product, availability: false }], [variant])[0].purchasable, false);
});

test("global category filters are read-only, pincode eligible, and share category identities across stores", async () => {
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const categoryRoute = routes.slice(
    routes.indexOf('customerMarketplaceRouter.get("/api/customer/categories"'),
    routes.indexOf('customerMarketplaceRouter.get("/api/customer/stores/:storeId"'),
  );
  assert.match(categoryRoute, /requireRole\("customer"\)/);
  assert.match(categoryRoute, /await discoveryContext\(request\)/);
  assert.match(categoryRoute, /selectDistinct\(\{ id: categoryId, name: categoryName \}\)/);
  assert.match(categoryRoute, /eq\(stores\.status, "ACTIVE"\)/);
  assert.match(categoryRoute, /eq\(storeServicePincodes\.pincode, pincode\)/);
  assert.match(categoryRoute, /coalesce\(\$\{categories\.masterCategoryId\}, \$\{categories\.id\}\)/);
  assert.doesNotMatch(categoryRoute, /\.insert\(|\.update\(|\.delete\(/);
  assert.match(routes, /eq\(categories\.masterCategoryId, query\.categoryId\)/);
});

test("Master Product creation remains vendor-only, with no customer catalog write routes", async () => {
  const routes = await readFile(new URL("../master-catalog/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /masterCatalogRouter\.post\(\s*"\/api\/vendor\/master-products",\s*requireRole\("vendor"\)/);
  assert.doesNotMatch(routes, /requireRole\([^)]*"customer"/);
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/vendor/master-products`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("product lists order by the canonical name expression instead of an ambiguous projection alias", async () => {
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const storeProductsRoute = routes.slice(
    routes.indexOf('customerMarketplaceRouter.get("/api/customer/stores/:storeId/products"'),
    routes.indexOf('customerMarketplaceRouter.get("/api/customer/products"'),
  );
  const globalProductsRoute = routes.slice(
    routes.indexOf('customerMarketplaceRouter.get("/api/customer/products"'),
    routes.indexOf('customerMarketplaceRouter.get("/api/customer/stores/:storeId/products/:productId"'),
  );
  const canonicalOrder = /\.orderBy\(asc\(sql<string>`coalesce\(\$\{masterProducts\.name\}, \$\{products\.name\}\)`\)/;
  assert.match(storeProductsRoute, canonicalOrder);
  assert.match(globalProductsRoute, /\.orderBy\(asc\(sql<string>`coalesce\(\$\{masterProducts\.name\}, \$\{products\.name\}\)`\), asc\(stores\.name\)\)/);
  assert.doesNotMatch(routes, /orderBy\(asc\(publicProduct\.name\)/);
});

test("global customer search is limited to saved-pincode active stores and active offers", async () => {
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  assert.match(routes, /eq\(customerAddresses\.customerId, customerId\(request\)\)/);
  assert.match(routes, /innerJoin\(storeServicePincodes, eq\(storeServicePincodes\.storeId, stores\.id\)\)/);
  assert.match(routes, /eq\(storeServicePincodes\.pincode, query\.pincode\)/);
  assert.match(routes, /eq\(stores\.status, "ACTIVE"\)/);
  assert.match(routes, /eq\(products\.isActive, true\)/);
  assert.match(routes, /eq\(products\.storeId, parsed\.data\.storeId\)/);
  assert.match(routes, /ilike\(masterProducts\.brand, pattern\)/);
  assert.equal((routes.match(/ilike\(masterProducts\.description, pattern\)/g) ?? []).length, 2);
  assert.equal((routes.match(/ilike\(products\.description, pattern\)/g) ?? []).length, 2);
  assert.match(routes, /sql`\$\{masterProducts\.attributes\}::text ILIKE \$\{pattern\}`/);
});