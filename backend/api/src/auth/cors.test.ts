import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createApp } from "../app.js";

const approved = [
  "https://local-basket-preview.pike.replit.dev",
  "https://local-basket-preview.pike.repl.co",
];

test("explicit development origins reach login validation; unapproved origins are rejected before authentication", async () => {
  const previous = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = approved.join(",");
  const server = createServer(createApp());
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, origin: string, method = "POST") => fetch(`${base}${path}`, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    ...(method === "POST" ? { body: "{}" } : {}),
  });
  try {
    for (const origin of approved) {
      for (const [path, status] of [
        ["/api/customer/login", 401],
        ["/api/vendor/login", 400],
        ["/api/delivery-partner/login", 401],
      ] as const) {
        const response = await request(path, origin);
        assert.equal(response.status, status, `${origin} ${path}`);
        assert.equal(response.headers.get("access-control-allow-origin"), origin);
        const payload = await response.json() as { error?: string };
        assert.notEqual(payload.error, "Origin is not allowed");
      }
      // Origin approval does not grant Admin or other protected access.
      assert.equal((await request("/api/auth/me", origin, "GET")).status, 401);
      const preflight = await request("/api/vendor/login", origin, "OPTIONS");
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
      assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /POST/);
      assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /Authorization/);
    }
    for (const origin of [
      "https://other-project.pike.replit.dev",
      "https://other-project.pike.repl.co",
      "https://replit.com",
      "http://local-basket-preview.pike.repl.co",
      "null",
      `${approved[1]}.attacker.example`,
    ]) {
      for (const path of ["/api/customer/login", "/api/vendor/login"]) {
        const response = await request(path, origin);
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error: "Origin is not allowed" });
        assert.equal(response.headers.get("access-control-allow-origin"), null);
      }
      assert.equal((await request("/api/vendor/login", origin, "OPTIONS")).status, 403);
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = previous;
  }
});

test("API development command preserves the configured allowlist rather than overwriting preview aliases", async () => {
  const artifact = await readFile(new URL("../../../../artifacts/api-server/.replit-artifact/artifact.toml", import.meta.url), "utf8");
  assert.match(artifact, /\$\{CORS_ALLOWED_ORIGINS:-https:\/\/\$REPLIT_DEV_DOMAIN\}/);
  assert.doesNotMatch(artifact, /run = "CORS_ALLOWED_ORIGINS=https:\/\/\$REPLIT_DEV_DOMAIN /);
});
