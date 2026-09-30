import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApp } from "../app.js";

async function withServer(
  run: (baseUrl: string) => Promise<void>,
) {
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

test("vendor catalog routes require authentication", async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      "/api/vendor/categories",
      "/api/vendor/products",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "Authentication required" });
    }
    const variantResponse = await fetch(
      `${baseUrl}/api/vendor/products/11111111-1111-4111-8111-111111111111/variants`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    assert.equal(variantResponse.status, 401);
    assert.deepEqual(await variantResponse.json(), { error: "Authentication required" });
  });
});

test("malformed JSON is reported as a client error", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/vendor/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{\"name\":",
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Malformed JSON body" });
  });
});

test("catalog hard-delete endpoints do not exist", async () => {
  await withServer(async (baseUrl) => {
    const categoryResponse = await fetch(
      `${baseUrl}/api/vendor/categories/11111111-1111-4111-8111-111111111111`,
      { method: "DELETE" },
    );
    const productResponse = await fetch(
      `${baseUrl}/api/vendor/products/11111111-1111-4111-8111-111111111111`,
      { method: "DELETE" },
    );
    const variantResponse = await fetch(
      `${baseUrl}/api/vendor/products/11111111-1111-4111-8111-111111111111/variants/22222222-2222-4222-8222-222222222222`,
      { method: "DELETE" },
    );
    assert.equal(categoryResponse.status, 404);
    assert.equal(productResponse.status, 404);
    assert.equal(variantResponse.status, 404);
  });
});