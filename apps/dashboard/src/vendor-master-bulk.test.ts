import assert from "node:assert/strict";
import { test } from "node:test";
import type { MasterProduct, Product } from "./api";
import {
  getExistingMasterProductIds,
  getSelectableMasterProducts,
  isEligibleMasterProduct,
  processBulkAdd,
} from "./vendor-master-bulk";

const masterProducts: MasterProduct[] = [
  { id: "one", name: "One", isActive: true, canAddToStore: true, exactIdentity: true, masterCategoryId: null, description: null, image: null, brand: null, attributes: {}, createdAt: "", updatedAt: "" },
  { id: "two", name: "Two", isActive: true, canAddToStore: false, exactIdentity: true, masterCategoryId: null, description: null, image: null, brand: null, attributes: {}, createdAt: "", updatedAt: "" },
  { id: "three", name: "Three", isActive: true, canAddToStore: true, exactIdentity: false, masterCategoryId: null, description: null, image: null, brand: null, attributes: {}, createdAt: "", updatedAt: "" },
  { id: "four", name: "Four", isActive: false, canAddToStore: true, exactIdentity: true, masterCategoryId: null, description: null, image: null, brand: null, attributes: {}, createdAt: "", updatedAt: "" },
];

test("bulk selection excludes inactive, unaddable, non-exact, and existing store listings", () => {
  const existing = [{ masterProductId: "one" }] as Product[];
  const ids = getExistingMasterProductIds(existing);
  assert.equal(isEligibleMasterProduct(masterProducts[0]), true);
  assert.deepEqual(getSelectableMasterProducts(masterProducts, ids), []);
  assert.deepEqual(getSelectableMasterProducts(masterProducts, new Set()).map((item) => item.id), ["one"]);
});

test("bulk operation isolates partial failures, reused listings, and duplicate IDs", async () => {
  const calls: string[] = [];
  const result = await processBulkAdd(["existing", "ok", "reused", "failed", "failed"], new Set(["existing"]), async (id) => {
    calls.push(id);
    if (id === "failed") throw new Error("temporary failure");
    return { reused: id === "reused" };
  });
  assert.deepEqual(calls, ["ok", "reused", "failed"]);
  assert.deepEqual(result, {
    succeeded: ["ok"],
    skipped: ["existing", "reused", "failed"],
    failed: [{ id: "failed", message: "temporary failure" }],
  });
});
