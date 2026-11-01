import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { readFile } from "node:fs/promises";
import type { Request, RequestHandler, Response } from "express";
import { PgDialect } from "drizzle-orm/pg-core";
import * as realDb from "@workspace/db";
import { createSupabaseAssets, getSupabaseAssets } from "./supabase-assets.js";
import { createSupabaseBasicStore } from "./supabase-storage.js";
import { createSupabaseObjectStore } from "./supabase-concurrency.js";
import { FakeSupabaseStorage, fixtureSupabaseConfig } from "./fixtures/fake-supabase-storage.js";

// Ephemeral module doubles only; no process.env changes, keys, DB or HTTP server.
const config = fixtureSupabaseConfig();
const storeA = "00000000-0000-4000-8000-000000000001";
const storeB = "00000000-0000-4000-8000-000000000002";
const documentId = "00000000-0000-4000-8000-000000000003";
const users: Record<string, { role: string; storeId?: string }> = {
  vendorA: { role: "vendor", storeId: storeA }, vendorB: { role: "vendor", storeId: storeB },
  admin: { role: "admin" }, customer: { role: "customer" },
};
const dialect = new PgDialect();
let documentReads = 0;
const ref = `/${config.privateRoot}/vendor-documents/${storeA}/${documentId}`;
const fixtureDb = {
  select() {
    let table: unknown, condition: Parameters<PgDialect["sqlToQuery"]>[0];
    const chain = {
      from(value: unknown) { table = value; return chain; },
      where(value: typeof condition) { condition = value; return chain; },
      async limit() {
        const token = String(dialect.sqlToQuery(condition).params[0]), user = users[token];
        if (!user) return [];
        if (table === realDb.userProfiles) return [{ role: user.role }];
        if (table === realDb.stores) return user.storeId ? [{ id: user.storeId, status: "ACTIVE" }] : [];
        if (table === realDb.customers) return [{ status: "ACTIVE" }];
        throw new Error("Unexpected fixture table");
      },
    };
    return chain;
  },
  async execute(statement: Parameters<PgDialect["sqlToQuery"]>[0]) {
    const query = dialect.sqlToQuery(statement);
    assert.match(query.sql, /WHERE id=.*AND store_id=.*AND is_current/s);
    const [id, owner] = query.params;
    documentReads++;
    return { rows: id === documentId && owner === storeA ? [{
      object_ref: ref, mime_type: "application/pdf", file_name: "fixture.pdf",
    }] : [] };
  },
};
mock.module("@workspace/db", { exports: { ...realDb, getDb: () => fixtureDb } });
mock.module(new URL("../auth/config.ts", import.meta.url).href, { exports: {
  getSupabasePublicConfig: () => ({ SUPABASE_URL: "https://fixture.invalid", SUPABASE_ANON_KEY: "synthetic-public" }),
  getSupabaseServerConfig: () => { throw new Error("No server configuration in fixtures"); },
} });
mock.module("@supabase/supabase-js", { exports: {
  createClient: () => ({ auth: { getUser: async (token: string) =>
    ({ data: { user: users[token] ? { id: token } : null }, error: null }) } }),
} });

const { requireRole } = await import("../auth/middleware.js");
const { ownedDocumentStore } = await import("../vendor-documents/service.js");
const { sendDocumentContent } = await import("../vendor-documents/content.js");
const { documentStorage } = await import("../vendor-documents/storage.js");
const { requireDeliveryPartner } = await import("../delivery-partner/middleware.js");

function fixture() {
  const client = new FakeSupabaseStorage(config), basic = createSupabaseBasicStore(config, client);
  const strict = createSupabaseObjectStore(basic, client.capabilities);
  return { client, basic, assets: createSupabaseAssets(strict, config) };
}
function response() {
  const state = { status: 200, headers: {} as Record<string, string>, body: undefined as unknown };
  const res = {
    setHeader(name: string, value: string) { state.headers[name] = value; return this; },
    status(value: number) { state.status = value; return this; },
    json(value: unknown) { state.body = value; return this; },
    send(value: unknown) { state.body = value; return this; },
  };
  return { state, res: res as unknown as Response };
}
async function authorize(guard: RequestHandler, token?: string) {
  const req = { header: () => token ? `Bearer ${token}` : undefined, query: { storeId: storeB } } as unknown as Request;
  const r = response();
  let next = false;
  await new Promise<void>((resolve, reject) => {
    r.res.json = ((value: unknown) => { r.state.body = value; resolve(); return r.res; }) as Response["json"];
    guard(req, r.res, error => { if (error) reject(error); else { next = true; resolve(); } });
  });
  return { req, ...r, next };
}

test("all four asset classes preserve logical references, MIME and byte responses", async () => {
  const f = fixture(), bytes = Buffer.from("fixture");
  await f.assets.products.put(storeA, documentId, bytes, "image/webp");
  assert.deepEqual(await f.assets.products.get(storeA, documentId), { bytes, mimeType: "image/webp" });
  await f.assets.documents.put(ref, bytes, "application/pdf");
  assert.deepEqual(await f.assets.documents.get(ref), bytes);
  const photo = `/${config.privateRoot}/delivery-photos/${storeA}/${documentId}`;
  await f.assets.photos.put(photo, bytes, "image/jpeg");
  assert.deepEqual(await f.assets.photos.get(photo), bytes);
  await f.assets.branding.put(bytes, "image/png");
  assert.equal((await f.assets.branding.metadata())?.mimeType, "image/png");
  assert.deepEqual(await f.assets.branding.get(), { bytes, mimeType: "image/png" });
  assert.ok(f.client.objects.has(`${config.privateRoot}/vendor-documents/${storeA}/${documentId}`));
});

test("cross-area, nested, traversal and wrong MIME references are rejected without reads or writes", async () => {
  const f = fixture(), bytes = Buffer.from("fixture");
  for (const path of [
    `/${config.privateRoot}/delivery-photos/${storeA}/${documentId}`,
    `/${config.privateRoot}/vendor-documents/${storeA}/../${documentId}`,
    `/${config.privateRoot}/vendor-documents/${storeA}/${documentId}/extra`,
    "/other/private/vendor-documents/a/b",
  ]) await assert.rejects(f.assets.documents.get(path), /INVALID_INPUT/);
  await assert.rejects(f.assets.photos.put(`/${config.privateRoot}/delivery-photos/a/b`, bytes, "application/pdf"), /INVALID_INPUT/);
  await assert.rejects(f.assets.products.put(storeA, documentId, bytes, "application/pdf"), /INVALID_INPUT/);
  await assert.rejects(f.assets.branding.put(bytes, "image/webp"), /INVALID_INPUT/);
  await assert.rejects(f.assets.branding.put(Buffer.alloc(2 * 1024 * 1024 + 1), "image/png"), /INVALID_INPUT/);
  assert.equal(f.client.operations.length, 0);
});

test("branding replacements and discard operations use observed revisions; failed replacement retains old bytes", async () => {
  const f = fixture(), original = Buffer.from("old");
  await f.assets.branding.put(original, "image/png");
  const revision = (await f.assets.branding.metadata())!.revision;
  f.client.fail = { operation: "replace-revision", statusCode: 412 };
  await assert.rejects(f.assets.branding.put(Buffer.from("new"), "image/jpeg"), /CONFLICT/);
  assert.deepEqual((await f.assets.branding.get()).bytes, original);
  assert.equal((await f.assets.branding.metadata())!.revision, revision);
  f.client.fail = undefined;
  await f.assets.branding.put(Buffer.from("new"), "image/jpeg");
  assert.notEqual((await f.assets.branding.metadata())!.revision, revision);
  await f.assets.documents.put(ref, original, "application/pdf");
  await f.assets.documents.discard(ref);
  assert.equal(f.client.operations.at(-1)?.operation, "delete-revision");
});

test("basic-only feature instances refuse pinned reads, existing-logo replacement and cleanup", async () => {
  const client = new FakeSupabaseStorage(config), basic = createSupabaseBasicStore(config, client);
  const assets = createSupabaseAssets(createSupabaseObjectStore(basic), config);
  await assets.branding.put(Buffer.from("original"), "image/png");
  await assert.rejects(assets.branding.get(), /CAPABILITY_UNAVAILABLE/);
  await assert.rejects(assets.branding.put(Buffer.from("replacement"), "image/jpeg"), /CAPABILITY_UNAVAILABLE/);
  await assets.documents.put(ref, Buffer.from("document"), "application/pdf");
  await assert.rejects(assets.documents.discard(ref), /CAPABILITY_UNAVAILABLE/);
  assert.ok(!client.operations.some(o => o.operation.includes("replace") || o.operation.includes("delete")));
});

test("real role middleware denies unauthenticated and wrong-role private requests with fake Auth/DB only", async () => {
  assert.equal((await authorize(requireRole("vendor"))).state.status, 401);
  assert.equal((await authorize(requireRole("vendor"), "unknown")).state.status, 401);
  assert.equal((await authorize(requireRole("vendor"), "customer")).state.status, 403);
  assert.equal((await authorize(requireRole("admin"), "vendorA")).state.status, 403);
  assert.equal((await authorize(requireRole("admin"), "admin")).next, true);
});

test("real document ownership/content checks deny cross-store reads and retain private API headers", async () => {
  const f = fixture(), bytes = Buffer.from("private fixture document");
  await f.assets.documents.put(ref, bytes, "application/pdf");
  const originalGet = documentStorage.get;
  documentStorage.get = f.assets.documents.get;
  try {
    const owned = await authorize(requireRole("vendor"), "vendorA");
    assert.equal(ownedDocumentStore(owned.req), storeA); // Caller query supplied storeB; ignored.
    await sendDocumentContent(ownedDocumentStore(owned.req), documentId, owned.res);
    assert.deepEqual(owned.state.body, bytes);
    assert.equal(owned.state.headers["Cache-Control"], "private, no-store");
    assert.equal(owned.state.headers["Content-Type"], "application/pdf");
    assert.equal(owned.state.headers["X-Content-Type-Options"], "nosniff");
    assert.match(owned.state.headers["Content-Disposition"], /fixture.pdf/);
    const other = await authorize(requireRole("vendor"), "vendorB");
    const before = f.client.operations.length;
    await assert.rejects(sendDocumentContent(ownedDocumentStore(other.req), documentId, other.res), /Document not found/);
    assert.equal(f.client.operations.length, before);
    assert.ok(documentReads >= 2);
  } finally { documentStorage.get = originalGet; }
});

test("real Delivery Partner middleware rejects wrong roles and inactive profiles using injected lookups", async () => {
  const authenticate: RequestHandler = (_req, _res, next) => next();
  const invoke = async (role: string, active: boolean) => {
    const r = response(), req = { auth: { userId: "fixture", role } } as unknown as Request;
    const guard = requireDeliveryPartner(authenticate, async () => ({ status: active ? "ACTIVE" : "INACTIVE" }) as never);
    let next = false;
    await new Promise<void>((resolve, reject) => {
      r.res.json = ((value: unknown) => { r.state.body = value; resolve(); return r.res; }) as Response["json"];
      guard(req, r.res, error => { if (error) reject(error); else { next = true; resolve(); } });
    });
    return { ...r.state, next };
  };
  assert.equal((await invoke("vendor", true)).status, 403);
  assert.equal((await invoke("delivery_partner", false)).status, 403);
  assert.equal((await invoke("delivery_partner", true)).next, true);
});

test("unchanged route source retains publication, compliance, assignment, Admin and private-header guards", async () => {
  const source = async (path: string) => readFile(new URL(path, import.meta.url), "utf8");
  const images = await source("../product-images/routes.ts");
  assert.match(images, /requireRole\("vendor"\), requireCatalogDocuments/);
  assert.match(images, /eq\(products.isActive, true\)/);
  assert.match(images, /eq\(stores.status, "ACTIVE"\)/);
  assert.match(images, /auth\?\.storeId !== storeId/);
  const photos = await source("../delivery-partner/photos.ts");
  assert.match(photos, /AND partner_user_id=\$\{partnerId\}/);
  assert.match(photos, /admin \? requireRole\("admin"\) : requireDeliveryPartner\(\)/);
  assert.match(photos, /"Cache-Control","private, no-store"/);
  const branding = await source("../branding/routes.ts");
  assert.match(branding, /authorizeAdmin: RequestHandler = requireRole\("admin"\)/);
  assert.match(branding, /auth\?\.role !== "admin"/);
  for (const path of ["../product-images/routes.ts", "../branding/routes.ts",
    "../vendor-documents/content.ts", "../delivery-partner/photos.ts"]) {
    assert.doesNotMatch(await source(path), /getPublicUrl|createSignedUrl|SUPABASE_SERVICE_ROLE_KEY/);
  }
});

test("runtime resolver has no fixture installer or live execution switch", () => {
  assert.throws(getSupabaseAssets, /LIVE_OPERATIONS_DISABLED/);
});
