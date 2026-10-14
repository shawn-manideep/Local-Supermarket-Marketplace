import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import net from "node:net";
import type { Server } from "node:http";
import pg from "pg";
import { validateDocument, MAX_DOCUMENT_BYTES } from "./files.js";
import { documentStorage } from "./storage.js";

const exec = promisify(execFile);
const postgres = "/nix/store/269nimkimaaivb4z46bjc1rnjv9jpc0l-postgresql-17.6/bin";
const legacy = randomUUID(), vendorA = randomUUID(), vendorB = randomUUID(), customer = randomUUID();
const customerB = randomUUID();
let structuredAddressId: string;
const admin = randomUUID(), delivery = randomUUID();
const legacyStore = randomUUID(), storeA = randomUUID(), storeB = randomUUID(), masterId = randomUUID();
const protectedProduct = randomUUID(), protectedVariant = randomUUID();
const pdf = Buffer.from("%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF");
let directory = "", pool: pg.Pool, server: Server, base = "", createdProduct = "", documentId = "";
let baseline: unknown;
let failStorage = false;
const objects = new Map<string, Buffer>();
const originalFetch = globalThis.fetch;
const provider = { ...documentStorage };

before(async () => {
  directory = await mkdtemp(`${tmpdir()}/vendor-documents-`);
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const env = { ...process.env, PGHOST: "127.0.0.1", PGUSER: "document_qa", PGDATABASE: "postgres", PGPORT: String(port) };
  await exec(`${postgres}/initdb`, ["-D", `${directory}/data`, "--auth=trust", "--no-locale", "-U", "document_qa"], { env });
  await exec(`${postgres}/pg_ctl`, ["-D", `${directory}/data`, "-l", `${directory}/postgres.log`, "-o", `-h 127.0.0.1 -k ${directory} -p ${port}`, "-w", "start"], { env });
  pool = new pg.Pool({ host: "127.0.0.1", port, database: "postgres", user: "document_qa", ssl: false });
  await pool.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE postgres SUPERUSER;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  const migrations = new URL("../../../../database/migrations/", import.meta.url);
  for (const file of (await readdir(migrations)).filter(file => /^\d.*\.sql$/.test(file) && !["0019","0021","0024","0025"].some(prefix=>file.startsWith(prefix))).sort()) {
    await pool.query(await readFile(new URL(file, migrations), "utf8"));
  }
  for (const id of [legacy, vendorA, vendorB, customer, admin, delivery, customerB]) {
    await pool.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, `${id}@qa.invalid`]);
    if (id !== customer && id !== customerB) {
      await pool.query("UPDATE user_profiles SET role=$2 WHERE id=$1", [id, id === admin ? "admin" : id === delivery ? "delivery_partner" : "vendor"]);
      await pool.query("DELETE FROM customers WHERE id=$1", [id]);
    }
  }
  await pool.query("INSERT INTO stores(id,owner_user_id,name,status) VALUES($1,$2,'Existing Vendor','ACTIVE')", [legacyStore, legacy]);
  await pool.query("INSERT INTO products(id,store_id,name,price,stock_quantity) VALUES($1,$2,'Protected history',17,19)", [protectedProduct, legacyStore]);
  await pool.query("INSERT INTO product_variants(id,product_id,name,quantity_value,quantity_unit,price,stock_quantity) VALUES($1,$2,'One kg',1,'kg',17,19)", [protectedVariant, protectedProduct]);
  baseline = (await pool.query("SELECT to_jsonb(p)-'brand'-'requested_category_name' AS p, to_jsonb(v) AS v FROM products p JOIN product_variants v ON v.product_id=p.id WHERE p.id=$1", [protectedProduct])).rows;
  await pool.query(await readFile(new URL("0019_vendor_documents_and_local_products.sql", migrations), "utf8"));
  await pool.query(await readFile(new URL("0021_orderability_delivery_verification.sql", migrations), "utf8"));
  for (const [id, owner] of [[storeA, vendorA], [storeB, vendorB]]) {
    await pool.query("INSERT INTO stores(id,owner_user_id,name,status) VALUES($1,$2,'New Vendor','ACTIVE')", [id, owner]);
    await pool.query("INSERT INTO store_service_pincodes(store_id,pincode) VALUES($1,'500090')", [id]);
    await pool.query("INSERT INTO store_operating_hours(store_id,day_of_week,is_closed,opens_at,closes_at) SELECT $1,generate_series(0,6),false,'00:00','23:59'", [id]);
  }
  await pool.query(await readFile(new URL("0024_vendor_compliance_and_delivery_photos.sql", migrations),"utf8"));
  await pool.query(await readFile(new URL("0025_fssai_expiry_and_vendor_notifications.sql", migrations),"utf8"));
  // Isolate document-review regressions from the independently tested bank flow.
  const { approvedFixtureBank } = await import("../test-fixture-compliance.js");
  for(const id of [storeA,storeB]) await approvedFixtureBank(pool,id,admin);
  await pool.query("INSERT INTO master_products(id,name,brand,is_active) VALUES($1,'Canonical Apples','Harvest',true)", [masterId]);
  await pool.query(`INSERT INTO customer_addresses(customer_id,recipient_name,phone,line1,city,state,pincode,is_default)
    VALUES($1,'Synthetic shopper','9876543210','QA Home','Hyderabad','Telangana','500090',true)`, [customer]);
  process.env.SUPABASE_DB_URL = `postgresql://document_qa@127.0.0.1:${port}/postgres`;
  process.env.SUPABASE_URL = "https://document-qa.example.invalid";
  process.env.SUPABASE_ANON_KEY = "synthetic-test-key";
  process.env.PRIVATE_OBJECT_DIR = "/qa-private-bucket/private";
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== `${process.env.SUPABASE_URL}/auth/v1/user`) return originalFetch(input, init);
    const id = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "");
    return [legacy, vendorA, vendorB, customer, admin, delivery, customerB].some(actor => actor === id)
      ? Response.json({ id, email: `${id}@qa.invalid` }) : Response.json({ message: "Invalid identity" }, { status: 401 });
  };
  // External provider bytes only are simulated; HTTP/authz/transactions/RLS/DB are real.
  documentStorage.put = async (ref, bytes) => {
    if (failStorage) throw new Error("Synthetic provider failure");
    objects.set(ref, Buffer.from(bytes));
  };
  documentStorage.get = async ref => {
    const bytes = objects.get(ref);
    if (!bytes) throw new Error("Missing provider object");
    return bytes;
  };
  documentStorage.discard = async ref => { objects.delete(ref); };
  const { createApp } = await import("../app.js");
  server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
});
after(async () => {
  globalThis.fetch = originalFetch;
  Object.assign(documentStorage, provider);
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (pool) {
    const { getPool } = await import("@workspace/db");
    await getPool().end();
    await pool.end();
  }
  if (directory) {
    await exec(`${postgres}/pg_ctl`, ["-D", `${directory}/data`, "-m", "immediate", "-w", "stop"]);
    await rm(directory, { recursive: true, force: true });
  }
});
// Distinct synthetic actors originate from distinct test IPs; production rate
// limiting remains enabled and unchanged.
const actorIp = (actor: string | null) => `203.0.113.${([legacy, vendorA, vendorB, customer, admin, delivery, customerB] as string[]).indexOf(actor ?? "") + 2}`;
type QAResponse = Omit<Response, "json"> & { json(): Promise<any> };
async function request(actor: string | null, path: string, method = "GET", body?: unknown): Promise<QAResponse> {
  return originalFetch(`${base}${path}`, {
    method, headers: { ...(actor ? { Authorization: `Bearer ${actor}` } : {}), "Content-Type": "application/json", "X-Forwarded-For": actorIp(actor) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function upload(actor: string, type: string, bytes = pdf, fileName = "license.pdf", mimeType = "application/pdf"): Promise<QAResponse> {
  return originalFetch(`${base}/api/vendor/documents/${type}?fileName=${encodeURIComponent(fileName)}${type==="fssai"?"&expiryDate=2099-12-31":""}`, {
    method: "PUT", headers: { Authorization: `Bearer ${actor}`, "Content-Type": mimeType, "X-Forwarded-For": actorIp(actor) }, body: new Uint8Array(bytes),
  });
}
const localInput = () => ({
  name: "Neighborhood roasted millet", brand: "Local House",
  price: 88, stockQuantity: 7, description: "Store made groceries", categoryId: null,
  requestedCategoryName: "Millet specials", availability: true,
  variants: [
    { quantityValue: 500, quantityUnit: "g", price: 88, stockQuantity: 7 },
    { quantityValue: 1, quantityUnit: "kg", price: 160, stockQuantity: 3 },
  ],
});
test("new and existing vendors require current compliance without rewriting historical products", async () => {
  const existing = await (await request(legacy, "/api/vendor/documents")).json();
  const fresh = await (await request(vendorA, "/api/vendor/documents")).json();
  assert.equal(existing.required, true); assert.equal(existing.canManageCatalog, false);
  assert.equal(fresh.required, true); assert.equal(fresh.canManageCatalog, false);
  assert.equal(fresh.mandatoryCount, 0); assert.equal(fresh.optionalCount, 0);
  assert.deepEqual(fresh.documents.map((item: { label: string }) => item.label),
    ["FSSAI License", "Aadhaar Card", "PAN Card", "Vendor Photo", "GST", "Trade License", "Labour License"]);
  assert.equal(fresh.fssai.status, "DATE_REQUIRED");
  assert.match(fresh.message, /actual FSSAI expiry date/);
});
test("server gate covers direct product/category/variant mutations and Master selection", async () => {
  for (const [path, method, body] of [
    ["/api/vendor/products", "POST", localInput()],
    [`/api/vendor/products/${protectedProduct}`, "PATCH", { name: "Attempted overwrite" }],
    [`/api/vendor/products/${protectedProduct}/activate`, "POST", {}],
    [`/api/vendor/products/${protectedProduct}/deactivate`, "POST", {}],
    [`/api/vendor/products/${protectedProduct}/variants`, "POST", { quantityValue: 1, quantityUnit: "kg", price: 1 }],
    [`/api/vendor/products/${protectedProduct}/variants/${protectedVariant}`, "PATCH", { price: 1 }],
    [`/api/vendor/products/${protectedProduct}/variants/batch`, "PUT", { variants: [] }],
    [`/api/vendor/products/${protectedProduct}/price`, "PATCH", { price: 1 }],
    [`/api/vendor/products/${protectedProduct}/stock`, "PATCH", { stockQuantity: 1 }],
    ["/api/vendor/categories", "POST", { name: "Blocked" }],
    [`/api/vendor/master-products/${masterId}/add-to-store`, "POST", {}],
  ] as const) {
    const response = await request(vendorA, path, method, body);
    assert.equal(response.status, 403, path);
    assert.equal((await response.json()).code, "VENDOR_DOCUMENTS_REQUIRED");
  }
  assert.equal((await request(vendorA, "/api/vendor/store")).status, 200);
  assert.equal((await request(vendorA, "/api/vendor/orders")).status, 200);
  assert.equal((await request(legacy, "/api/vendor/products", "POST", localInput())).status, 403);
});
test("uploads reject invalid extensions, MIME, empty, corrupt, oversize and unknown types", async () => {
  for (const [type, bytes, name, mime] of [
    ["fssai", pdf, "evil.exe", "application/pdf"],
    ["fssai", pdf, "image.jpg", "image/jpeg"],
    ["fssai", Buffer.alloc(0), "empty.pdf", "application/pdf"],
    ["fssai", Buffer.from("bad bytes"), "corrupt.pdf", "application/pdf"],
    ["fssai", pdf, "../unsafe.pdf", "application/pdf"],
    ["unknown", pdf, "doc.pdf", "application/pdf"],
    ["fssai", Buffer.alloc(MAX_DOCUMENT_BYTES + 1), "large.pdf", "application/pdf"],
  ] as const) {
    const response = await upload(vendorA, type, bytes, name, mime);
    assert.ok([400, 413].includes(response.status), `${name}: ${response.status}`);
  }
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM vendor_documents")).rows[0].n, 0);
  assert.equal(objects.size, 0);
});
test("optional uploads and four mandatory uploads remain locked until submission and Admin approval", async () => {
  const optional = await upload(vendorA, "gst");
  assert.equal(optional.status, 201);
  assert.equal((await optional.json()).canManageCatalog, false);
  for (const type of ["fssai", "aadhaar", "pan"]) assert.equal((await upload(vendorA, type)).status, 201);
  const partial = await (await request(vendorA, "/api/vendor/documents")).json();
  assert.equal(partial.mandatoryCount, 3); assert.equal(partial.optionalCount, 1);
  assert.equal((await request(vendorA, "/api/vendor/products", "POST", localInput())).status, 403);
  const complete = await (await upload(vendorA, "labour_license")).json();
  assert.equal(complete.mandatoryCount, 4); assert.equal(complete.canManageCatalog, false);
  assert.equal(complete.verificationStatus, "DRAFT");
  const submitted = await (await request(vendorA, "/api/vendor/documents/submit", "POST", {})).json();
  assert.equal(submitted.verificationStatus, "SUBMITTED");
  assert.equal(submitted.canManageCatalog, false);
  assert.equal((await request(vendorA, "/api/vendor/products", "POST", localInput())).status, 403);
  assert.equal((await upload(vendorA, "pan")).status, 409);
  const approved = await request(admin, `/api/admin/vendors/${vendorA}/documents/approve`, "POST", { submissionId: submitted.submissionId });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).canManageCatalog, true);
  documentId = complete.documents.find((item: { type: string }) => item.type === "fssai").current.id;
  assert.ok(!JSON.stringify(complete).includes("qa-private"));
  assert.ok(!JSON.stringify(complete).includes("object_ref"));
});
test("private view denies anonymous, customers, other vendors and direct DB access", async () => {
  const path = `/api/vendor/documents/${documentId}/content`;
  assert.equal((await request(null, path)).status, 401);
  assert.equal((await request(customer, path)).status, 403);
  assert.equal((await request(vendorB, path)).status, 404);
  const response = await request(vendorA, path);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  const connection = await pool.connect();
  try {
    await connection.query("SET ROLE authenticated");
    await assert.rejects(connection.query("SELECT * FROM vendor_documents"), /permission denied/);
  } finally {
    await connection.query("RESET ROLE"); connection.release();
  }
});
test("replacements retain versions, failed provider upload leaves current valid document untouched, no deletion route", async () => {
  failStorage = true;
  assert.equal((await upload(vendorA, "fssai")).status, 500);
  failStorage = false;
  const replacement = await (await upload(vendorA, "fssai", pdf, "replacement.pdf")).json();
  assert.equal(replacement.mandatoryCount, 4);
  const current = replacement.documents.find((item: { type: string }) => item.type === "fssai").current;
  assert.equal(current.version, 2); assert.notEqual(current.id, documentId);
  assert.equal((await request(vendorA, `/api/vendor/documents/${documentId}/content`)).status, 404);
  assert.equal((await request(vendorA, "/api/vendor/documents/fssai", "DELETE")).status, 404);
  const rows = (await pool.query("SELECT version,is_current FROM vendor_documents WHERE store_id=$1 AND document_type='fssai' ORDER BY version", [storeA])).rows;
  assert.deepEqual(rows, [{ version: 1, is_current: false }, { version: 2, is_current: true }]);
  assert.equal(replacement.canManageCatalog, false);
  const submitted = await (await request(vendorA, "/api/vendor/documents/submit", "POST", {})).json();
  assert.equal((await request(admin, `/api/admin/vendors/${vendorA}/documents/approve`, "POST", { submissionId: submitted.submissionId })).status, 200);
});
test("atomic store-local creation uses existing products/variants, no global writes or other-vendor access", async () => {
  const response = await request(vendorA, "/api/vendor/products", "POST", localInput());
  assert.equal(response.status, 201);
  const { product } = await response.json();
  createdProduct = product.id;
  assert.equal(product.storeId, storeA); assert.equal(product.masterProductId, null);
  assert.equal(product.brand, "Local House"); assert.equal(product.variants.length, 2);
  assert.equal(product.requestedCategoryName, "Millet specials");
  assert.deepEqual(product.variants.map((variant: { price: string }) => Number(variant.price)), [88, 160]);
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM master_products")).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM master_categories")).rows[0].n, 0);
  assert.equal((await request(vendorB, `/api/vendor/products/${createdProduct}`)).status, 403);
  assert.equal((await request(vendorB, "/api/vendor/products")).status, 403);
  assert.equal((await request(vendorA, `/api/vendor/products/${protectedProduct}`)).status, 404);
  const listA = await (await request(vendorA, "/api/vendor/products")).json();
  assert.ok(listA.products.some((item: { id: string }) => item.id === createdProduct));
  assert.ok(!listA.products.some((item: { id: string }) => item.id === protectedProduct));
  const duplicate = await request(vendorA, "/api/vendor/products", "POST", localInput());
  assert.equal(duplicate.status, 409);
});
test("duplicate review enforces exact identities even when confirmSimilar is forged, allows deliberate similarity review", async () => {
  const exact = { ...localInput(), name: " CANONICAL  Apples ", brand: "harvest", confirmSimilar: true };
  const matches = await (await request(vendorA, "/api/vendor/product-matches?name=Canonical%20Apples&brand=Harvest")).json();
  assert.equal(matches.matches[0].exactIdentity, true);
  assert.equal((await request(vendorA, "/api/vendor/products", "POST", exact)).status, 409);
  const similar = { ...localInput(), name: "Apples special selection", brand: "Other House" };
  const unconfirmed = await request(vendorA, "/api/vendor/products", "POST", similar);
  assert.equal(unconfirmed.status, 409); assert.equal((await unconfirmed.json()).code, "SIMILAR_MASTER_PRODUCT");
  assert.equal((await request(vendorA, "/api/vendor/products", "POST", { ...similar, confirmSimilar: true })).status, 201);
  const selected = await request(vendorA, `/api/vendor/master-products/${masterId}/add-to-store`, "POST", {});
  assert.equal(selected.status, 201);
  const { product: masterListing } = await selected.json();
  const variant = await request(vendorA, `/api/vendor/products/${masterListing.id}/variants`, "POST",
    { quantityValue: 1, quantityUnit: "kg", price: 60, stockQuantity: 9, availability: true });
  assert.equal(variant.status, 201);
  assert.equal((await request(vendorA, `/api/vendor/products/${masterListing.id}/availability`, "PATCH", { availability: true })).status, 200);
  assert.equal((await request(vendorA, `/api/vendor/products/${masterListing.id}/activate`, "POST", {})).status, 200);
  assert.equal((await request(vendorB, `/api/vendor/master-products/${masterId}/add-to-store`, "POST", {})).status, 403);
});
test("foreign category and spoofed store IDs cannot create records; invalid variants roll back", async () => {
  const category = (await pool.query("INSERT INTO categories(store_id,name) VALUES($1,'Vendor B category') RETURNING id", [storeB])).rows[0].id;
  const before = (await pool.query("SELECT count(*)::integer AS n FROM products")).rows[0].n;
  assert.equal((await request(vendorA, "/api/vendor/products", "POST", { ...localInput(), name: "Foreign category grocery", categoryId: category, requestedCategoryName: undefined })).status, 404);
  assert.equal((await request(vendorA, "/api/vendor/products", "POST", { ...localInput(), storeId: storeB })).status, 400);
  assert.equal((await request(vendorA, "/api/vendor/products", "POST", { ...localInput(), variants: [{ quantityValue: 1, quantityUnit: "kg", price: 0 }] })).status, 400);
  const conflicting = { ...localInput(), name: "Another neighborhood grocery",
    variants: [
      { quantityValue: 1, quantityUnit: "kg", price: 20, sku: "same-sku" },
      { quantityValue: 2, quantityUnit: "kg", price: 40, sku: "same-sku" },
    ] };
  assert.equal((await request(vendorA, "/api/vendor/products", "POST", conflicting)).status, 409);
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM products")).rows[0].n, before);
});
test("unchanged customer discovery exposes eligible local product/variants; original stock untouched", async () => {
  const response = await request(customer, `/api/customer/stores/${storeA}/products?pincode=500090`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  const local = payload.products.find((item: { id: string }) => item.id === createdProduct);
  assert.ok(local); assert.equal(local.variants.length, 2);
  assert.ok(local.variants.every((variant: { purchasable: boolean }) => variant.purchasable));
  assert.equal((await request(customer, "/api/customer/cart/items", "POST", {
    productId: createdProduct, variantId: local.variants[0].id, quantity: 2,
  })).status, 201);
  const address = (await pool.query("SELECT id FROM customer_addresses WHERE customer_id=$1", [customer])).rows[0].id;
  const checkout = await request(customer, "/api/customer/checkout/validate", "POST", { addressId: address, paymentMethod: "COD" });
  assert.equal(checkout.status, 200);
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM orders")).rows[0].n, 0);
  assert.equal((await pool.query("SELECT stock_quantity FROM product_variants WHERE id=$1", [local.variants[0].id])).rows[0].stock_quantity, 7);
  const current = (await pool.query("SELECT to_jsonb(p)-'brand'-'requested_category_name' AS p,to_jsonb(v) AS v FROM products p JOIN product_variants v ON v.product_id=p.id WHERE p.id=$1", [protectedProduct])).rows;
  assert.deepEqual(current, baseline);
});
test("document signature rules accept PNG/JPEG and reject mismatched signatures", () => {
  const png = Buffer.alloc(45);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  png.write("IHDR", 12); png.writeUInt32BE(1, 16); png.writeUInt32BE(1, 20); png.write("IEND", 37);
  validateDocument("photo.PNG", "image/png", png);
  const jpeg = Buffer.alloc(20); jpeg[0]=255; jpeg[1]=216; jpeg[2]=255; jpeg[18]=255; jpeg[19]=217;
  validateDocument("photo.jpeg", "image/jpeg", jpeg);
  assert.throws(() => validateDocument("photo.png", "image/png", jpeg), /corrupt/);
});

let adminCurrentId = "";
const adminPath = (vendor: string = legacy) => `/api/admin/vendors/${vendor}/documents`;
test("Admin retrieves existing document metadata without private references", async () => {
  const uploaded = await upload(legacy, "fssai");
  assert.equal(uploaded.status, 201);
  adminCurrentId = (await uploaded.json()).documents.find((item: any) => item.type === "fssai").current.id;
  const response = await request(admin, adminPath());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.documents.length, 7);
  assert.equal(body.mandatoryCount, 1);
  assert.equal(body.required, true);
  assert.equal(body.canManageCatalog, false);
  assert.equal(body.documents.find((item: any) => item.type === "fssai").current.id, adminCurrentId);
  assert.doesNotMatch(JSON.stringify(body), /object_ref|objectRef|qa-private-bucket/);
});
test("Admin securely reads current PDF bytes with private inline headers", async () => {
  const response = await request(admin, `${adminPath()}/${adminCurrentId}/content`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-security-policy"), "sandbox");
  assert.match(response.headers.get("content-disposition")!, /inline; filename\*/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
});
test("Unauthenticated metadata and nested binary reads are denied", async () => {
  for (const path of [adminPath(), `${adminPath()}/${adminCurrentId}/content`])
    assert.equal((await request(null, path)).status, 401);
});
for (const [label, actor] of [["Vendor A", vendorA], ["Vendor B", vendorB], ["Customer", customer], ["Delivery Partner", delivery]] as const) {
  test(`${label} cannot use Admin metadata or nested content endpoints`, async () => {
    for (const path of [adminPath(), `${adminPath()}/${adminCurrentId}/content`])
      assert.equal((await request(actor, path)).status, 403);
  });
}
test("Admin Vendor selection returns only that Vendor; mismatched current document is denied", async () => {
  const status = await (await request(admin, adminPath(vendorB))).json();
  assert.ok(status.documents.every((item: any) => !item.current || item.current.id !== adminCurrentId));
  assert.equal((await request(admin, `${adminPath(vendorB)}/${adminCurrentId}/content`)).status, 404);
  assert.equal((await request(vendorA, `/api/vendor/documents/${adminCurrentId}/content`)).status, 404);
  assert.equal((await request(vendorA, adminPath(vendorB))).status, 403);
});
test("Unknown Vendor, non-Vendor account and store UUID selectors return safe 404", async () => {
  for (const selector of [randomUUID(), customer, storeA, "invalid-id"]) {
    assert.equal((await request(admin, adminPath(selector))).status, 404);
    assert.equal((await request(admin, `${adminPath(selector)}/${adminCurrentId}/content`)).status, 404);
  }
});
test("Optional uploads do not inflate mandatory completion; all four mandatory documents complete it", async () => {
  assert.equal((await upload(legacy, "gst")).status, 201);
  let status = await (await request(admin, adminPath())).json();
  assert.equal(status.mandatoryCount, 1);
  assert.equal(status.optionalCount, 1);
  for (const type of ["aadhaar", "pan", "labour_license"]) assert.equal((await upload(legacy, type)).status, 201);
  status = await (await request(admin, adminPath())).json();
  assert.equal(status.mandatoryCount, 4);
  assert.equal(status.optionalCount, 1);
});
test("Replacement preserves history; Admin sees only new current version and rejects obsolete bytes", async () => {
  const previous = adminCurrentId;
  const replacement = Buffer.from("%PDF-1.4\n% Replacement test bytes\n%%EOF");
  assert.equal((await upload(legacy, "fssai", replacement, "replacement.pdf")).status, 201);
  const status = await (await request(admin, adminPath())).json();
  const current = status.documents.find((item: any) => item.type === "fssai").current;
  adminCurrentId = current.id;
  assert.notEqual(current.id, previous);
  assert.equal(current.version, 2);
  assert.equal(current.fileName, "replacement.pdf");
  assert.ok(current.uploadedAt && current.updatedAt);
  assert.equal((await request(admin, `${adminPath()}/${previous}/content`)).status, 404);
  assert.equal((await request(legacy, `/api/vendor/documents/${previous}/content`)).status, 404);
  for (const path of [`${adminPath()}/${current.id}/content`, `/api/vendor/documents/${current.id}/content`])
    assert.deepEqual(Buffer.from(await (await request(path.startsWith("/api/admin") ? admin : legacy, path)).arrayBuffer()), replacement);
  const history = (await pool.query("SELECT is_current,version FROM vendor_documents WHERE store_id=$1 AND document_type='fssai' ORDER BY version", [legacyStore])).rows;
  assert.deepEqual(history, [{ is_current: false, version: 1 }, { is_current: true, version: 2 }]);
});
test("Admin image viewing uses existing upload validation and MIME type", async () => {
  const png = Buffer.alloc(45);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  png.write("IHDR", 12); png.writeUInt32BE(1, 16); png.writeUInt32BE(1, 20); png.write("IEND", 37);
  assert.equal((await upload(legacy, "photo", png, "photo.png", "image/png")).status, 201);
  const status = await (await request(admin, adminPath())).json();
  const id = status.documents.find((item: any) => item.type === "photo").current.id;
  const response = await request(admin, `${adminPath()}/${id}/content`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
});
test("Admin reads and denials leave all existing public-table data unchanged", async () => {
  async function snapshot() {
    const result: Record<string, string> = {};
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    for (const { tablename } of tables) {
      const name = String(tablename).replaceAll('"', '""');
      result[name] = (await pool.query(`SELECT md5(coalesce(string_agg(row::text,',' ORDER BY row::text),'')) AS digest FROM (SELECT to_jsonb(t) AS row FROM "${name}" t) s`)).rows[0].digest;
    }
    return result;
  }
  const before = await snapshot();
  assert.equal((await request(admin, adminPath())).status, 200);
  assert.equal((await request(admin, `${adminPath()}/${adminCurrentId}/content`)).status, 200);
  assert.equal((await request(customer, adminPath())).status, 403);
  assert.equal((await request(admin, `${adminPath(vendorB)}/${adminCurrentId}/content`)).status, 404);
  assert.deepEqual(await snapshot(), before);
});

test("new Vendor submission, partial rejection, correction and receipt-safe approval", async () => {
  assert.equal((await request(vendorB, "/api/vendor/documents/submit", "POST", {})).status, 409);
  for (const type of ["fssai", "aadhaar", "pan", "labour_license", "gst"]) assert.equal((await upload(vendorB, type)).status, 201);
  const uploaded = await (await request(vendorB, "/api/vendor/documents")).json();
  assert.equal(uploaded.canManageCatalog, false);
  const pending = await (await request(vendorB, "/api/vendor/documents/submit", "POST", {})).json();
  assert.equal(pending.verificationStatus, "SUBMITTED"); assert.equal(pending.canManageCatalog, false);
  for (const actor of [null, vendorA, vendorB, customer, delivery]) {
    for (const action of ["approve", "reject"]) {
      const response = await request(actor, `${adminPath(vendorB)}/${action}`, "POST",
        { submissionId: pending.submissionId, ...(action === "reject" ? { reason: "Unclear PAN", rejectedTypes: ["pan"] } : {}) });
      assert.equal(response.status, actor === null ? 401 : 403);
    }
  }
  assert.equal((await request(admin, `${adminPath(vendorA)}/approve`, "POST", { submissionId: pending.submissionId })).status, 409);
  assert.equal((await request(admin, `${adminPath(vendorB)}/reject`, "POST", { submissionId: pending.submissionId, reason: "  ", rejectedTypes: ["pan"] })).status, 400);
  assert.equal((await request(admin, `${adminPath(vendorB)}/reject`, "POST", { submissionId: pending.submissionId, reason: "Invalid", rejectedTypes: ["gst"] })).status, 400);
  const rejectedResponse = await request(admin, `${adminPath(vendorB)}/reject`, "POST",
    { submissionId: pending.submissionId, reason: "PAN image is unclear", rejectedTypes: ["pan"] });
  assert.equal(rejectedResponse.status, 200);
  const rejected = await rejectedResponse.json();
  assert.equal(rejected.verificationStatus, "REJECTED"); assert.equal(rejected.canManageCatalog, false);
  assert.equal(rejected.rejectionReason, "PAN image is unclear");
  assert.equal(rejected.documents.find((d: any) => d.type === "pan").current.verificationStatus, "REJECTED");
  assert.equal(rejected.documents.find((d: any) => d.type === "fssai").current.verificationStatus, "APPROVED");
  assert.equal(rejected.documents.find((d: any) => d.type === "gst").current.verificationStatus, "DRAFT");
  assert.equal((await request(vendorB, "/api/vendor/products", "POST", localInput())).status, 403);
  assert.equal((await upload(vendorB, "pan", pdf, "clear-pan.pdf")).status, 201);
  const resubmitted = await (await request(vendorB, "/api/vendor/documents/submit", "POST", {})).json();
  assert.notEqual(resubmitted.submissionId, pending.submissionId);
  assert.equal((await request(admin, `${adminPath(vendorB)}/approve`, "POST", { submissionId: pending.submissionId })).status, 409);
  const approved = await request(admin, `${adminPath(vendorB)}/approve`, "POST", { submissionId: resubmitted.submissionId });
  assert.equal(approved.status, 200); assert.equal((await approved.json()).canManageCatalog, true);
  const ownProduct = await request(vendorB, "/api/vendor/products", "POST",
    { ...localInput(), name: "Store B jasmine rice", brand: "Store B Brand" });
  assert.equal(ownProduct.status, 201);
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM vendor_documents WHERE store_id=$1 AND document_type='pan'", [storeB])).rows[0].n, 2);
  const direct = await pool.connect();
  try {
    await direct.query("SET ROLE authenticated");
    await direct.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [vendorB]);
    await assert.rejects(direct.query("UPDATE stores SET documents_required=false WHERE id=$1", [storeB]), /permission denied|API-only/);
  } finally { await direct.query("RESET ROLE"); direct.release(); }
});

test("closed checkout and cart additions reject atomically while browsing remains possible", async () => {
  assert.equal((await request(customer, "/api/customer/cart", "DELETE")).status, 204);
  const row = (await pool.query(`SELECT p.id AS product,v.id AS variant,v.stock_quantity FROM products p
    JOIN product_variants v ON v.product_id=p.id WHERE p.store_id=$1 AND p.is_active AND v.is_active
    AND v.availability AND v.stock_quantity>2 ORDER BY v.id LIMIT 1`, [storeA])).rows[0];
  const added = await request(customer, "/api/customer/cart/items", "POST", { productId: row.product, variantId: row.variant, quantity: 1 });
  assert.equal(added.status, 201);
  const cart = (await added.json()).cart;
  const address = (await pool.query("SELECT id FROM customer_addresses WHERE customer_id=$1 LIMIT 1", [customer])).rows[0].id;
  await pool.query("UPDATE store_operating_hours SET is_closed=true,opens_at=NULL,closes_at=NULL WHERE store_id=$1", [storeA]);
  const digest = async () => (await pool.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM orders o) AS orders,
    (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM product_variants v) AS variants,
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM carts c) AS carts,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM cart_items i) AS items,
    (SELECT count(*) FROM delivery_assignments) AS deliveries`)).rows[0];
  const before = await digest();
  const closed = await request(customer, "/api/customer/orders", "POST",
    { cartId: cart.id, addressId: address, idempotencyKey: randomUUID(), paymentMethod: "COD" });
  assert.equal(closed.status, 409); assert.equal((await closed.json()).code, "STORE_CLOSED");
  const scheduled = await request(customer, "/api/customer/orders", "POST", {
    cartId: cart.id, addressId: address, idempotencyKey: randomUUID(), paymentMethod: "COD", deliveryMode: "SCHEDULED",
    scheduledStartAt: new Date(Date.now() + 3_600_000).toISOString(), scheduledEndAt: new Date(Date.now() + 7_200_000).toISOString(),
  });
  assert.equal(scheduled.status, 409); assert.equal((await scheduled.json()).code, "DELIVERY_SLOT_UNAVAILABLE");
  assert.equal((await request(customer, "/api/customer/cart/items", "POST", { productId: row.product, variantId: row.variant, quantity: 1 })).status, 409);
  assert.equal((await request(customer, `/api/customer/cart/items/${cart.items[0].id}`, "PATCH", { quantity: 2 })).status, 409);
  assert.equal((await request(customer, `/api/customer/stores/${storeA}?pincode=500090`)).status, 200);
  const viewed = (await (await request(customer, "/api/customer/cart")).json()).cart;
  assert.equal(viewed.operatingStatus, "CLOSED"); assert.equal(viewed.checkoutReady, false);
  assert.equal(viewed.items[0].purchasable, true); // Closure is not out-of-stock.
  assert.deepEqual(await digest(), before);
  await pool.query("UPDATE store_operating_hours SET is_closed=false,opens_at='00:00',closes_at='23:59' WHERE store_id=$1", [storeA]);
});

test("Instant/Scheduled checkout snapshots, replay safety, stock deduction and own-product isolation", async () => {
  const cart = (await (await request(customer, "/api/customer/cart")).json()).cart;
  const address = (await pool.query("SELECT id FROM customer_addresses WHERE customer_id=$1 LIMIT 1", [customer])).rows[0].id;
  const variant = (await pool.query("SELECT product_id,stock_quantity FROM product_variants WHERE id=$1", [cart.items[0].variantId])).rows[0];
  const input = { cartId: cart.id, addressId: address, idempotencyKey: randomUUID(), paymentMethod: "COD" };
  const instantResponse = await request(customer, "/api/customer/orders", "POST", input);
  assert.equal(instantResponse.status, 201);
  const instant = (await instantResponse.json()).order;
  assert.equal(instant.deliveryMode, "INSTANT"); assert.equal(instant.scheduledStartAt, null);
  assert.equal((await pool.query("SELECT stock_quantity FROM product_variants WHERE id=$1", [cart.items[0].variantId])).rows[0].stock_quantity, variant.stock_quantity - 1);
  const replay = (await (await request(customer, "/api/customer/orders", "POST", input)).json()).order;
  assert.equal(replay.id, instant.id);
  const nextCart = (await (await request(customer, "/api/customer/cart/items", "POST",
    { productId: variant.product_id, variantId: cart.items[0].variantId, quantity: 1 })).json()).cart;
  const slotsResponse = await request(customer, `/api/customer/stores/${storeA}/delivery-slots?pincode=500090`);
  assert.equal(slotsResponse.status, 200);
  const slots = (await slotsResponse.json()).slots;
  assert.ok(slots.length);
  const slot = slots[0];
  const scheduledInput = { ...input, cartId: nextCart.id, idempotencyKey: randomUUID(), deliveryMode: "SCHEDULED",
    scheduledStartAt: slot.startAt, scheduledEndAt: slot.endAt };
  const scheduledResponse = await request(customer, "/api/customer/orders", "POST", scheduledInput);
  assert.equal(scheduledResponse.status, 201);
  const scheduled = (await scheduledResponse.json()).order;
  assert.equal(scheduled.deliveryMode, "SCHEDULED"); assert.equal(scheduled.scheduledStartAt, slot.startAt);
  assert.equal(scheduled.scheduledEndAt, slot.endAt);
  assert.equal((await request(customer, "/api/customer/orders", "POST", { ...scheduledInput, deliveryMode: "INSTANT", scheduledStartAt: undefined, scheduledEndAt: undefined })).status, 409);
  const stored = (await pool.query("SELECT delivery_mode,scheduled_start_at,scheduled_end_at FROM orders WHERE id=$1", [scheduled.id])).rows[0];
  await pool.query("UPDATE store_operating_hours SET is_closed=true,opens_at=NULL,closes_at=NULL WHERE store_id=$1", [storeA]);
  assert.deepEqual((await pool.query("SELECT delivery_mode,scheduled_start_at,scheduled_end_at FROM orders WHERE id=$1", [scheduled.id])).rows[0], stored);
  const vendorView = await request(vendorA, `/api/vendor/orders/${scheduled.id}`);
  assert.equal(vendorView.status, 200); assert.equal((await vendorView.json()).order.deliveryMode, "SCHEDULED");
  const own = (await (await request(vendorB, "/api/vendor/products")).json()).products;
  assert.ok(own.length > 0);
  assert.ok(own.every((p: any) => p.storeId === storeB));
  assert.ok(own.every((p: any) => p.id !== variant.product_id));
  await pool.query("UPDATE store_operating_hours SET is_closed=false,opens_at='00:00',closes_at='23:59' WHERE store_id=$1", [storeA]);
});

test("hours writes serialize against the checkout store lock", async () => {
  const checkout = await pool.connect(), writer = await pool.connect();
  try {
    await checkout.query("BEGIN");
    await checkout.query("SELECT id FROM stores WHERE id=$1 FOR UPDATE", [storeA]);
    await writer.query("BEGIN");
    await writer.query("SET LOCAL lock_timeout='150ms'");
    await assert.rejects(writer.query("UPDATE store_operating_hours SET is_closed=true WHERE store_id=$1", [storeA]), /lock timeout/);
    await writer.query("ROLLBACK");
    await checkout.query("COMMIT");
    await writer.query("BEGIN");
    await writer.query("UPDATE store_operating_hours SET is_closed=true WHERE store_id=$1", [storeA]);
    await writer.query("ROLLBACK");
  } finally { await checkout.query("ROLLBACK"); await writer.query("ROLLBACK"); checkout.release(); writer.release(); }
});

test("structured address create/edit/read-back preserves legacy rows, ownership and historical snapshots", async () => {
  const original = (await pool.query("SELECT to_jsonb(a) AS row FROM customer_addresses a WHERE customer_id=$1 ORDER BY created_at", [customer])).rows;
  const histories = (await pool.query("SELECT id,delivery_address_snapshot FROM orders ORDER BY id")).rows;
  const baseInput = { recipientName: "Synthetic recipient", phone: "9876543210", city: "Hyderabad", state: "Telangana", pincode: "500090" };
  assert.equal((await request(customer, "/api/customer/addresses", "POST", baseInput)).status, 400);
  assert.equal((await request(customer, "/api/customer/addresses", "POST", { ...baseInput, houseNumber: " " })).status, 400);
  const created = await request(customer, "/api/customer/addresses", "POST", { ...baseInput,
    houseNumber: "Flat No. 302", buildingName: "Green Heights Apartments", landmark: "Near ABC School", locality: "Pragathi Nagar" });
  assert.equal(created.status, 201);
  const address = (await created.json()).address;
  structuredAddressId = address.id;
  assert.equal(address.houseNumber, "Flat No. 302");
  assert.equal(address.line1, "Flat No. 302");
  assert.equal(address.line2, "Green Heights Apartments, Near ABC School, Pragathi Nagar");
  assert.deepEqual((await pool.query("SELECT to_jsonb(a) AS row FROM customer_addresses a WHERE id=ANY($1::uuid[]) ORDER BY created_at",
    [original.map((r: any) => r.row.id)])).rows, original);
  const updated = await request(customer, `/api/customer/addresses/${address.id}`, "PATCH",
    { buildingName: null, landmark: "Near updated school" });
  assert.equal(updated.status, 200);
  const read = (await (await request(customer, `/api/customer/addresses/${address.id}`)).json()).address;
  assert.equal(read.buildingName, null); assert.equal(read.landmark, "Near updated school");
  assert.equal(read.locality, "Pragathi Nagar"); assert.equal(read.line2, "Near updated school, Pragathi Nagar");
  const concurrent = await Promise.all([
    request(customer, `/api/customer/addresses/${address.id}`, "PATCH", { buildingName: "Tower B" }),
    request(customer, `/api/customer/addresses/${address.id}`, "PATCH", { landmark: "Near corner school" }),
  ]);
  assert.ok(concurrent.every(response => response.status === 200));
  const merged = (await (await request(customer, `/api/customer/addresses/${address.id}`)).json()).address;
  assert.equal(merged.buildingName, "Tower B"); assert.equal(merged.landmark, "Near corner school");
  await request(customer, `/api/customer/addresses/${address.id}`, "PATCH", { buildingName: null, landmark: "Near updated school" });
  assert.ok((await (await request(customer, "/api/customer/addresses")).json()).addresses.some((a: any) => a.id === address.id && a.houseNumber === "Flat No. 302"));
  for (const method of ["GET", "PATCH", "DELETE"]) {
    assert.equal((await request(customerB, `/api/customer/addresses/${address.id}`, method,
      method === "PATCH" ? { houseNumber: "Wrong owner" } : undefined)).status, 404);
  }
  assert.equal((await request(vendorA, "/api/customer/addresses")).status, 403);
  assert.deepEqual((await pool.query("SELECT id,delivery_address_snapshot FROM orders ORDER BY id")).rows, histories);
});

test("daily-closed store permits future scheduled checkout, blocks Instant/expired slots and freezes new address snapshot", async () => {
  await request(customer, "/api/customer/cart", "DELETE");
  await pool.query(`UPDATE store_operating_hours SET is_closed=(day_of_week=extract(dow FROM clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::integer),
    opens_at='00:00',closes_at='23:59' WHERE store_id=$1`, [storeA]);
  const row = (await pool.query(`SELECT p.id AS product,v.id AS variant,v.stock_quantity FROM products p JOIN product_variants v ON v.product_id=p.id
    WHERE p.store_id=$1 AND p.is_active AND p.availability AND v.is_active AND v.availability AND v.stock_quantity>1 ORDER BY v.id LIMIT 1`, [storeA])).rows[0];
  const slots = (await (await request(customer, `/api/customer/stores/${storeA}/delivery-slots?pincode=500090`)).json());
  assert.equal(slots.operatingStatus, "CLOSED"); assert.equal(slots.scheduledDeliveryAvailable, true);
  assert.ok(slots.nextOpeningAt); assert.ok(slots.slots.length);
  const store = (await (await request(customer, `/api/customer/stores/${storeA}?pincode=500090`)).json()).store;
  assert.equal(store.nextOpeningAt, slots.nextOpeningAt);
  const added = await request(customer, "/api/customer/cart/items", "POST", { productId: row.product, variantId: row.variant, quantity: 1 });
  assert.equal(added.status, 201);
  const cart = (await added.json()).cart;
  assert.equal(cart.instantDeliveryAvailable, false); assert.equal(cart.scheduledDeliveryAvailable, true); assert.equal(cart.checkoutReady, true);
  const input = { cartId: cart.id, addressId: structuredAddressId, idempotencyKey: randomUUID(), paymentMethod: "COD" };
  const count = (await pool.query("SELECT count(*)::integer AS n FROM orders")).rows[0].n;
  const instant = await request(customer, "/api/customer/orders", "POST", input);
  assert.equal(instant.status, 409); assert.equal((await instant.json()).code, "STORE_CLOSED");
  const expired = await request(customer, "/api/customer/orders", "POST", { ...input, deliveryMode: "SCHEDULED",
    scheduledStartAt: new Date(Date.now()-7_200_000).toISOString(), scheduledEndAt: new Date(Date.now()-3_600_000).toISOString() });
  assert.equal(expired.status, 409); assert.equal((await expired.json()).code, "DELIVERY_SLOT_UNAVAILABLE");
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM orders")).rows[0].n, count);
  assert.equal((await pool.query("SELECT stock_quantity FROM product_variants WHERE id=$1", [row.variant])).rows[0].stock_quantity, row.stock_quantity);
  const slot = slots.slots[0];
  const accepted = await request(customer, "/api/customer/orders", "POST", { ...input, deliveryMode: "SCHEDULED", scheduledStartAt: slot.startAt, scheduledEndAt: slot.endAt });
  assert.equal(accepted.status, 201);
  const order = (await accepted.json()).order;
  assert.equal(order.scheduledStartAt, slot.startAt);
  assert.equal(order.deliveryAddressSnapshot.houseNumber, "Flat No. 302");
  assert.equal(order.deliveryAddressSnapshot.buildingName, null);
  assert.equal(order.deliveryAddressSnapshot.landmark, "Near updated school");
  await request(customer, `/api/customer/addresses/${structuredAddressId}`, "PATCH", { houseNumber: "777", locality: null });
  const persisted = (await pool.query("SELECT delivery_address_snapshot FROM orders WHERE id=$1", [order.id])).rows[0].delivery_address_snapshot;
  assert.equal(persisted.houseNumber, "Flat No. 302"); assert.equal(persisted.locality, "Pragathi Nagar");
  assert.equal((await pool.query("SELECT stock_quantity FROM product_variants WHERE id=$1", [row.variant])).rows[0].stock_quantity, row.stock_quantity-1);
  await pool.query("UPDATE store_operating_hours SET is_closed=false WHERE store_id=$1", [storeA]);
});

test("administratively unavailable stores never gain scheduled eligibility from future hours", async () => {
  await request(customer, "/api/customer/cart", "DELETE");
  const row = (await pool.query(`SELECT p.id AS product,v.id AS variant FROM products p JOIN product_variants v ON v.product_id=p.id
    WHERE p.store_id=$1 AND p.is_active AND p.availability AND v.is_active AND v.availability AND v.stock_quantity>0 LIMIT 1`, [storeA])).rows[0];
  const cart = (await (await request(customer, "/api/customer/cart/items", "POST", { productId: row.product, variantId: row.variant, quantity: 1 })).json()).cart;
  const unavailable = (await pool.query("SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid=enumtypid WHERE typname='store_status' AND enumlabel<>'ACTIVE' LIMIT 1")).rows[0].enumlabel;
  await pool.query("UPDATE stores SET status=$2 WHERE id=$1", [storeA, unavailable]);
  const before = (await pool.query("SELECT count(*)::integer AS n FROM orders")).rows[0].n;
  assert.equal((await request(customer, `/api/customer/stores/${storeA}/delivery-slots?pincode=500090`)).status, 404);
  const viewed = (await (await request(customer, "/api/customer/cart")).json()).cart;
  assert.equal(viewed.scheduledDeliveryAvailable, false); assert.equal(viewed.checkoutReady, false);
  const response = await request(customer, "/api/customer/orders", "POST", { cartId: cart.id, addressId: structuredAddressId,
    idempotencyKey: randomUUID(), paymentMethod: "COD", deliveryMode: "SCHEDULED",
    scheduledStartAt: new Date(Date.now()+3_600_000).toISOString(), scheduledEndAt: new Date(Date.now()+7_200_000).toISOString() });
  assert.equal(response.status, 409);
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM orders")).rows[0].n, before);
  await pool.query("UPDATE stores SET status='ACTIVE' WHERE id=$1", [storeA]);
});

test("quantity decrement and zero-removal persist exact variants, totals and empty state without touching another store or inventory", async () => {
  await request(customer, "/api/customer/cart", "DELETE");
  await request(customerB, "/api/customer/cart", "DELETE");
  const p = randomUUID(), otherProduct = randomUUID(), v1 = randomUUID(), v2 = randomUUID(), otherVariant = randomUUID();
  await pool.query("INSERT INTO products(id,store_id,name,price,stock_quantity) VALUES($1,$2,'Quantity fixture',10.05,5),($3,$4,'Other store fixture',7.5,5)", [p, storeA, otherProduct, storeB]);
  await pool.query(`INSERT INTO product_variants(id,product_id,name,quantity_value,quantity_unit,price,stock_quantity)
    VALUES($1,$2,'1 kg',1,'kg',10.05,5),($3,$2,'500 g',500,'g',7.5,5),($4,$5,'500 g',500,'g',7.5,5)`, [v1, p, v2, otherVariant, otherProduct]);
  await pool.query("UPDATE store_operating_hours SET is_closed=false,opens_at='00:00',closes_at='23:59' WHERE store_id=ANY($1::uuid[])", [[storeA, storeB]]);
  const add1 = await request(customer, "/api/customer/cart/items", "POST", { productId: p, variantId: v1, quantity: 3 });
  assert.equal(add1.status, 201);
  const added = await request(customer, "/api/customer/cart/items", "POST", { productId: p, variantId: v2, quantity: 1 });
  assert.equal(added.status, 201);
  const original = (await added.json()).cart;
  await pool.query("UPDATE stores SET status='ACTIVE' WHERE id=$1", [storeB]);
  await pool.query("INSERT INTO store_service_pincodes(store_id,pincode) VALUES($1,'500090') ON CONFLICT DO NOTHING", [storeB]);
  const address = await request(customerB, "/api/customer/addresses", "POST", {
    recipientName: "Synthetic other Customer", phone: "9876543210", houseNumber: "20",
    city: "Hyderabad", state: "Telangana", pincode: "500090",
  });
  assert.equal(address.status, 201);
  const other = await request(customerB, "/api/customer/cart/items", "POST", { productId: otherProduct, variantId: otherVariant, quantity: 1 });
  assert.equal(other.status, 201);
  const otherCart = (await other.json()).cart;
  const first = original.items.find((row: any) => row.variantId === v1);
  const second = original.items.find((row: any) => row.variantId === v2);
  const decreased = await request(customer, `/api/customer/cart/items/${first.id}`, "PATCH", { quantity: 2 });
  assert.equal(decreased.status, 200);
  const smaller = (await decreased.json()).cart;
  assert.equal(smaller.subtotal, "27.60");
  assert.equal(smaller.items.find((row: any) => row.id === first.id).quantity, 2);
  assert.equal(smaller.storeId, storeA);
  const removed = await request(customer, `/api/customer/cart/items/${second.id}`, "PATCH", { quantity: 0 });
  assert.equal(removed.status, 200);
  const readBack = (await (await request(customer, "/api/customer/cart")).json()).cart;
  assert.equal(readBack.items.length, 1); assert.equal(readBack.items[0].variantId, v1);
  assert.equal(readBack.subtotal, "20.10");
  assert.equal((await request(customer, `/api/customer/cart/items/${otherCart.items[0].id}`, "PATCH", { quantity: 0 })).status, 404);
  assert.equal((await request(customer, `/api/customer/cart/items/${first.id}`, "PATCH", { quantity: 0 })).status, 200);
  assert.equal((await (await request(customer, "/api/customer/cart")).json()).cart, null);
  assert.equal((await pool.query("SELECT status FROM carts WHERE id=$1", [original.id])).rows[0].status, "ABANDONED");
  assert.deepEqual((await (await request(customerB, "/api/customer/cart")).json()).cart, otherCart);
  assert.deepEqual((await pool.query("SELECT stock_quantity FROM product_variants WHERE id=ANY($1::uuid[])", [[v1, v2, otherVariant]])).rows.map((row: any) => row.stock_quantity), [5, 5, 5]);
});
