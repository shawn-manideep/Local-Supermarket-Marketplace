import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryCreateSchema,
  customerCartItemCreateSchema,
  customerOrderRepeatPreviewQuerySchema,
  customerOrderRepeatSchema,
  productAvailabilitySchema,
  productCreateSchema,
  productPriceSchema,
  productStockQuantitySchema,
  productUpdateSchema,
  productVariantCreateSchema,
  productVariantUpdateSchema,
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

test("product variant validation preserves normalized quantity and accepts supported units", () => {
  for (const quantityUnit of ["g", "kg", "ml", "l", "piece", "pack", "dozen"]) {
    const result = productVariantCreateSchema.safeParse({
      name: "Large",
      quantityValue: "0.500",
      quantityUnit,
      price: "40.00",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.quantityValue, "0.5");
      assert.equal(result.data.stockQuantity, 0);
      assert.equal(result.data.availability, true);
      assert.equal(result.data.isActive, true);
      assert.equal(result.data.sortOrder, 0);
    }
  }
  assert.equal(productVariantCreateSchema.safeParse({
    name: "Invalid", quantityValue: 0, quantityUnit: "pack", price: 1,
  }).success, false);
  assert.equal(productVariantCreateSchema.safeParse({
    name: "Invalid", quantityValue: 1, quantityUnit: "litre", price: 1,
  }).success, false);
  assert.equal(productVariantCreateSchema.safeParse({
    name: "Invalid", quantityValue: 1, quantityUnit: "pack", price: -1,
  }).success, false);
  assert.equal(productVariantCreateSchema.safeParse({
    name: "Invalid", quantityValue: 1, quantityUnit: "pack", price: 1, storeId: categoryId,
  }).success, false);
});

test("variant updates accept inventory and merchandising fields but reject empty or invalid updates", () => {
  assert.equal(productVariantUpdateSchema.safeParse({
    price: 25.5, stockQuantity: 4, availability: false, isActive: false, sortOrder: 2,
  }).success, true);
  assert.equal(productVariantUpdateSchema.safeParse({}).success, false);
  assert.equal(productVariantUpdateSchema.safeParse({ stockQuantity: -1 }).success, false);
  assert.equal(productVariantUpdateSchema.safeParse({ isActive: false, storeId: categoryId }).success, false);
});

test("cart and repeat-order validation identify the selected sellable variant and address", () => {
  const productId = categoryId;
  const variantId = "22222222-2222-4222-8222-222222222222";
  const idempotencyKey = "33333333-3333-4333-8333-333333333333";
  assert.equal(customerCartItemCreateSchema.safeParse({ productId, quantity: 1 }).success, false);
  assert.equal(customerCartItemCreateSchema.safeParse({ productId, variantId, quantity: 1 }).success, true);
  assert.equal(customerOrderRepeatPreviewQuerySchema.safeParse({ addressId: productId }).success, true);
  assert.equal(customerOrderRepeatSchema.safeParse({ addressId: productId, confirmStoreSwitch: true }).success, false);
  assert.equal(customerOrderRepeatSchema.safeParse({ addressId: productId, idempotencyKey, confirmStoreSwitch: true }).success, true);
  assert.equal(customerOrderRepeatSchema.safeParse({ addressId: productId, storeId: productId }).success, false);
});
