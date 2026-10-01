import assert from "node:assert/strict";
import test from "node:test";
import {
  masterCatalogCanonicalProductSchema,
  masterCatalogQuerySchema,
  masterProductCreateAfterReviewSchema,
  masterProductMappingUpdateSchema,
} from "@workspace/validation";

const categoryId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";

test("canonical product validation normalizes optional fields and defaults attributes", () => {
  const result = masterCatalogCanonicalProductSchema.safeParse({
    masterCategoryId: categoryId,
    name: "  Organic Jaggery ",
    image: "",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.name, "Organic Jaggery");
    assert.equal(result.data.image, null);
    assert.deepEqual(result.data.attributes, {});
  }
  assert.equal(masterCatalogCanonicalProductSchema.safeParse({
    masterCategoryId: categoryId,
    name: "Rice",
    price: 20,
  }).success, false);
  assert.equal(masterCatalogCanonicalProductSchema.safeParse({
    masterCategoryId: categoryId,
    name: "Rice",
    attributes: { grade: 123 },
  }).success, false);
});

test("duplicate-review confirmation and master mapping require explicit, valid inputs", () => {
  const canonical = {
    masterCategoryId: categoryId,
    name: "Basmati Rice",
    attributes: {},
    confirmedNoMatch: true,
    duplicateReviewToken: "x".repeat(32),
  };
  assert.equal(masterProductCreateAfterReviewSchema.safeParse(canonical).success, true);
  assert.equal(masterProductCreateAfterReviewSchema.safeParse({
    ...canonical,
    confirmedNoMatch: false,
  }).success, false);
  assert.equal(masterProductCreateAfterReviewSchema.safeParse({
    ...canonical,
    masterProductId: productId,
  }).success, false);
  assert.equal(masterProductMappingUpdateSchema.safeParse({
    masterProductId: productId,
    reason: "Correcting clerical mapping",
  }).success, true);
  assert.equal(masterProductMappingUpdateSchema.safeParse({
    masterProductId: productId,
    reason: " ",
  }).success, false);
});

test("master catalog search is global by default and validates pagination/filter boundaries", () => {
  const result = masterCatalogQuerySchema.safeParse({ search: "rice", page: "2", pageSize: "30" });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.page, 2);
    assert.equal(result.data.pageSize, 30);
    assert.equal(result.data.categoryId, undefined);
  }
  assert.equal(masterCatalogQuerySchema.safeParse({ page: 0 }).success, false);
  assert.equal(masterCatalogQuerySchema.safeParse({ pageSize: 101 }).success, false);
});