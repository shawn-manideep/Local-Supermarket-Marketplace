import assert from "node:assert/strict";
import test from "node:test";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { createServer } from "node:http";
import { createBrandingRouter } from "./routes.js";
import { validateLogo, MAX_LOGO_BYTES } from "./validation.js";
import { HttpError } from "../http.js";
import type { AuthenticatedRequest, AuthContext } from "../auth/types.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ZkAAAAASUVORK5CYII=", "base64");
test("logo content, MIME, filename and server size checks reject unsafe inputs", () => {
  assert.doesNotThrow(() => validateLogo("logo.png", "image/png", png));
  for (const [name, type, bytes] of [
    ["logo.svg", "image/svg+xml", Buffer.from("<svg/>")],
    ["logo.jpg", "image/jpeg", png],
    ["logo.png", "image/png", Buffer.from("not an image")],
    ["../logo.png", "image/png", png],
    ["logo.png", "image/png", Buffer.alloc(MAX_LOGO_BYTES + 1)],
  ] as const) assert.throws(() => validateLogo(name, type, bytes), HttpError);
});

test("Admin saves and replaces shared logo; other roles cannot change it; failures preserve current logo", async () => {
  let active: { bytes: Buffer; mimeType: string; revision: string } | null = null;
  let writes = 0;
  let fail = false;
  const storage = {
    metadata: async () => active ? { mimeType: active.mimeType, revision: active.revision } : null,
    put: async (bytes: Buffer, mimeType: string) => {
      if (fail) throw new Error("Test storage unavailable");
      active = { bytes, mimeType, revision: String(++writes) };
    },
    get: async () => {
      if (!active) throw new Error("Missing");
      return { bytes: active.bytes, mimeType: active.mimeType };
    },
  };
  const testIdentity: RequestHandler = (req, res, next) => {
    const role = req.get("x-test-role") as AuthContext["role"] | undefined;
    if (!role) { res.status(401).end(); return; }
    (req as AuthenticatedRequest).auth = { userId: "verified-test-user", role, storeId: null };
    next();
  };
  const app = express();
  app.use(createBrandingRouter(testIdentity, storage));
  app.use(((error, _req, res, _next) => {
    res.status(error instanceof HttpError ? error.statusCode : error.type === "entity.too.large" ? 413 : 500).json({ error: "Request rejected" });
  }) as ErrorRequestHandler);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const upload = (role?: string, bytes = png, type = "image/png", name = "logo.png") => fetch(`${base}/api/admin/branding/logo?fileName=${encodeURIComponent(name)}`, {
    method: "POST", headers: { "Content-Type": type, ...(role ? { "x-test-role": role } : {}) },
    body: Uint8Array.from(bytes),
  });
  try {
    assert.deepEqual(await (await fetch(`${base}/api/branding`)).json(), { logoUrl: null, revision: null });
    assert.equal((await fetch(`${base}/api/branding/logo`)).status, 404);
    for (const role of [undefined, "customer", "vendor", "delivery_partner"]) {
      assert.equal((await upload(role)).status, role ? 403 : 401);
      assert.equal(writes, 0);
    }
    assert.equal((await upload("admin")).status, 200);
    const publicLogo = await fetch(`${base}/api/branding/logo`);
    assert.equal(publicLogo.headers.get("content-type"), "image/png");
    assert.equal(publicLogo.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await publicLogo.arrayBuffer()), png);
    assert.equal((await upload("admin", png, "image/jpeg", "logo.jpg")).status, 400);
    assert.equal((await upload("admin", Buffer.alloc(MAX_LOGO_BYTES + 1))).status, 413);
    assert.equal(writes, 1);
    assert.equal((await upload("admin")).status, 200);
    assert.deepEqual(await (await fetch(`${base}/api/branding`)).json(), { logoUrl: "/api/branding/logo", revision: "2" });
    fail = true;
    assert.equal((await upload("admin")).status, 503);
    assert.equal(writes, 2);
    assert.equal((await fetch(`${base}/api/branding/logo`)).status, 200);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("production branding router requires real bearer authentication before upload", async () => {
  const app = express();
  app.use(createBrandingRouter());
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/branding/logo?fileName=logo.png`, {
      method: "POST", headers: { "Content-Type": "image/png", "x-test-role": "admin" }, body: Uint8Array.from(png),
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
