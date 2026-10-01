import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApp } from "../app.js";

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