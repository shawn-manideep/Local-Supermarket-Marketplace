import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApp } from "../app.js";
import { HttpError } from "../http.js";
import {
  ensureBatchVariantIdsBelongToProduct,
  ensureBatchVariantExpectedVersionsCurrent,
  ensurePublishedBatchVariantsHavePositivePrices,
  updateOwnedProductAndChildren,
} from "./routes.js";

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

test("an unowned product aborts before child variant writes and transaction commit", async () => {
  const committedEffects: string[] = [];
  const transaction = async <T>(operation: (pendingEffects: string[]) => Promise<T>) => {
    const pendingEffects: string[] = [];
    try {
      const result = await operation(pendingEffects);
      committedEffects.push(...pendingEffects);
      return result;
    } catch (error) {
      pendingEffects.length = 0;
      throw error;
    }
  };

  await assert.rejects(
    transaction((pendingEffects) => updateOwnedProductAndChildren(
      async () => undefined,
      async () => { pendingEffects.push("variant availability changed"); },
    )),
    (error: unknown) => error instanceof HttpError && error.statusCode === 404,
  );
  assert.deepEqual(committedEffects, []);
});

test("batch variant ownership checks run before writes and preserve omitted legacy variant IDs", async () => {
  const existingIds = ["legacy-a", "legacy-b"];
  const submittedIds = ["legacy-a"];
  const committedEffects: string[] = [];
  const transaction = async <T>(operation: (pendingEffects: string[]) => Promise<T>) => {
    const pendingEffects: string[] = [];
    try {
      const result = await operation(pendingEffects);
      committedEffects.push(...pendingEffects);
      return result;
    } catch (error) {
      pendingEffects.length = 0;
      throw error;
    }
  };
  await transaction(async (pendingEffects) => {
    ensureBatchVariantIdsBelongToProduct(submittedIds, existingIds);
    pendingEffects.push("update supplied legacy variant");
  });
  assert.deepEqual(committedEffects, ["update supplied legacy variant"]);
  assert.deepEqual(existingIds, ["legacy-a", "legacy-b"], "omitted variants are not deleted");

  await assert.rejects(
    transaction(async (pendingEffects) => {
      ensureBatchVariantIdsBelongToProduct(["legacy-a", "foreign-id"], existingIds);
      pendingEffects.push("child write must not be reached");
    }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 404,
  );
  assert.deepEqual(committedEffects, ["update supplied legacy variant"]);
});

test("publishing rejects active zero-price variants but permits inactive legacy zero-price variants", () => {
  const existing = new Map([
    ["inactive-legacy", { isActive: false }],
    ["active-legacy", { isActive: true }],
  ]);
  ensurePublishedBatchVariantsHavePositivePrices(
    [{ id: "inactive-legacy", price: 0 }],
    existing,
    true,
  );
  assert.throws(
    () => ensurePublishedBatchVariantsHavePositivePrices(
      [{ id: "active-legacy", price: 0 }],
      existing,
      true,
    ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 400,
  );
  ensurePublishedBatchVariantsHavePositivePrices([{ price: 0, isActive: false }], existing, true);
});

test("stale batch expectedUpdatedAt rejects before child writes and aborts transaction", async () => {
  const id = "owned-variant";
  const currentTimestamp = new Date("2025-01-01T00:00:00.123Z");
  const existing = new Map([[id, { updatedAt: currentTimestamp }]]);
  ensureBatchVariantExpectedVersionsCurrent(
    [{ id, expectedUpdatedAt: "2025-01-01T01:00:00.123+01:00" }],
    existing,
  );
  ensureBatchVariantExpectedVersionsCurrent([{ id }], existing);

  const committedEffects: string[] = [];
  const transaction = async <T>(operation: (pendingEffects: string[]) => Promise<T>) => {
    const pendingEffects: string[] = [];
    try {
      const result = await operation(pendingEffects);
      committedEffects.push(...pendingEffects);
      return result;
    } catch (error) {
      pendingEffects.length = 0;
      throw error;
    }
  };
  await assert.rejects(
    transaction(async (pendingEffects) => {
      ensureBatchVariantExpectedVersionsCurrent(
        [{ id, expectedUpdatedAt: "2025-01-01T00:00:00.124Z" }],
        existing,
      );
      pendingEffects.push("child variant write must not be reached");
    }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 409 &&
      error.message === "Catalog changed. Refresh the catalog and try again.",
  );
  assert.deepEqual(committedEffects, []);
});

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
    const batchVariantResponse = await fetch(
      `${baseUrl}/api/vendor/products/11111111-1111-4111-8111-111111111111/variants/batch`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variants: [] }) },
    );
    assert.equal(batchVariantResponse.status, 401);
    assert.deepEqual(await batchVariantResponse.json(), { error: "Authentication required" });
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