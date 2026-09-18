import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryCreateSchema,
  productAvailabilitySchema,
  productCreateSchema,
  productPriceSchema,
  productStockQuantitySchema,
  productUpdateSchema,
} from "@workspace/validation";

const categoryId = "11111111-1111-4111-8111-111111111111";

test("catalog schemas reject blank names and client-owned fields", () => {
  assert.equal(categoryCreateSchema.safeParse({ name: " " }).success, false);
  assert.equal(productCreateSchema.safeParse({ name: "Rice", price: 20, storeId: categoryId }).success, false);
  assert.equal(productUpdateSchema.safeParse({ isActive: false }).success, false);
  assert.equal(productUpdateSchema.safeParse({}).success, false);
});

test("product schemas reject negative price and stock while separating availability", () => {
  assert.equal(productPriceSchema.safeParse({ price: -1 }).success, false);
  assert.equal(productStockQuantitySchema.safeParse({ stockQuantity: -1 }).success, false);
  assert.equal(productAvailabilitySchema.safeParse({ availability: false }).success, true);
  assert.equal(productUpdateSchema.safeParse({ availability: false, name: "Rice" }).success, true);
  assert.equal(productPriceSchema.safeParse({ price: 10_000_000_000 }).success, false);
  for (const invalidValue of ["", "   ", null, false, true]) {
    assert.equal(productPriceSchema.safeParse({ price: invalidValue }).success, false);
    assert.equal(
      productStockQuantitySchema.safeParse({ stockQuantity: invalidValue }).success,
      false,
    );
  }
});

test("catalog product creation accepts nullable category and fixed precision price input", () => {
  const result = productCreateSchema.safeParse({ name: "Rice", price: "20.50", categoryId: null });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.price, 20.5);
});
