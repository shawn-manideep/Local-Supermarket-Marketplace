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
  productVariantBatchUpdateSchema,
  productVariantUpdateSchema,
  formatVariantName,
  sortVariantsForDisplay,
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
  for (const quantityUnit of ["g", "kg", "ml", "l", "piece", "pack", "dozen", "bottle", "box"]) {
    const result = productVariantCreateSchema.safeParse({
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

test("batch variant schema requires explicit units and accepts zero stock without client-owned labels/order", () => {
  const variant = {
    quantityValue: "0.5",
    quantityUnit: "kg",
    price: "12.50",
    stockQuantity: 0,
    availability: false,
  };
  const parsed = productVariantBatchUpdateSchema.safeParse({ variants: [variant], publish: true });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.variants[0].quantityValue, "0.5");
    assert.equal(parsed.data.variants[0].stockQuantity, 0);
  }
  assert.equal(productVariantBatchUpdateSchema.safeParse({
    variants: [{ ...variant, quantityUnit: undefined }],
  }).success, false);
  assert.equal(productVariantBatchUpdateSchema.safeParse({
    variants: [{ ...variant, name: "Manual name" }],
  }).success, false);
  assert.equal(productVariantBatchUpdateSchema.safeParse({
    variants: [{ ...variant, sortOrder: 1 }],
  }).success, false);
  assert.equal(productVariantBatchUpdateSchema.safeParse({
    variants: [{ ...variant, id: categoryId }, { ...variant, id: categoryId }],
  }).success, false);
  assert.equal(productVariantBatchUpdateSchema.safeParse({
    variants: [{ ...variant, price: 0 }],
  }).success, true);
  assert.equal(productVariantBatchUpdateSchema.safeParse({
    variants: [{ ...variant, id: categoryId, expectedUpdatedAt: "2025-01-01T00:00:00.000Z" }],
  }).success, true);
  assert.equal(productVariantBatchUpdateSchema.safeParse({
    variants: [{ ...variant, id: categoryId, expectedUpdatedAt: "not-a-timestamp" }],
  }).success, false);
  assert.equal(productVariantBatchUpdateSchema.safeParse({
    variants: [{ ...variant, expectedUpdatedAt: "2025-01-01T00:00:00.000Z" }],
  }).success, false);
});

test("variant labels and automatic display ordering are consistent without changing stored quantities or units", () => {
  assert.equal(formatVariantName("500.000", "g"), "500 g");
  assert.equal(formatVariantName("1", "l"), "1 L");
  assert.equal(formatVariantName("1", "piece"), "1 piece");
  assert.equal(formatVariantName("12", "piece"), "12 pieces");

  const variants = [
    { id: "5kg", quantityValue: "5", quantityUnit: "kg" as const, createdAt: "2025-01-01T00:00:04Z" },
    { id: "500g", quantityValue: "500", quantityUnit: "g" as const, createdAt: "2025-01-01T00:00:01Z" },
    { id: "2kg", quantityValue: "2", quantityUnit: "kg" as const, createdAt: "2025-01-01T00:00:03Z" },
    { id: "1kg", quantityValue: "1", quantityUnit: "kg" as const, createdAt: "2025-01-01T00:00:02Z" },
  ];
  assert.deepEqual(sortVariantsForDisplay(variants).map(({ id }) => id), ["500g", "1kg", "2kg", "5kg"]);
  assert.deepEqual(variants.map(({ quantityValue, quantityUnit }) => [quantityValue, quantityUnit]), [
    ["5", "kg"], ["500", "g"], ["2", "kg"], ["1", "kg"],
  ]);

  const incomparable = [
    { id: "pack", quantityValue: "1", quantityUnit: "pack" as const, createdAt: "2025-01-01T00:00:03Z" },
    { id: "box", quantityValue: "2", quantityUnit: "box" as const, createdAt: "2025-01-01T00:00:01Z" },
    { id: "piece", quantityValue: "1", quantityUnit: "piece" as const, createdAt: "2025-01-01T00:00:02Z" },
  ];
  assert.deepEqual(sortVariantsForDisplay(incomparable).map(({ id }) => id), ["box", "piece", "pack"]);

  const mixedGroups = [
    { id: "2kg", quantityValue: "2", quantityUnit: "kg" as const, createdAt: "2025-01-01T00:00:01Z" },
    { id: "1pack", quantityValue: "1", quantityUnit: "pack" as const, createdAt: "2025-01-01T00:00:02Z" },
    { id: "500g", quantityValue: "500", quantityUnit: "g" as const, createdAt: "2025-01-01T00:00:03Z" },
    { id: "3l", quantityValue: "3", quantityUnit: "l" as const, createdAt: "2025-01-01T00:00:04Z" },
    { id: "1piece", quantityValue: "1", quantityUnit: "piece" as const, createdAt: "2025-01-01T00:00:05Z" },
    { id: "500ml", quantityValue: "500", quantityUnit: "ml" as const, createdAt: "2025-01-01T00:00:06Z" },
    { id: "2box", quantityValue: "2", quantityUnit: "box" as const, createdAt: "2025-01-01T00:00:07Z" },
  ];
  assert.deepEqual(
    sortVariantsForDisplay(mixedGroups).map(({ id }) => id),
    ["500g", "1pack", "2kg", "500ml", "1piece", "3l", "2box"],
  );

  const multipleIncomparableGroups = [
    { id: "2kg", quantityValue: "2", quantityUnit: "kg" as const, createdAt: "2025-01-01T00:00:01Z" },
    { id: "2pack", quantityValue: "2", quantityUnit: "pack" as const, createdAt: "2025-01-01T00:00:02Z" },
    { id: "1pack", quantityValue: "1", quantityUnit: "pack" as const, createdAt: "2025-01-01T00:00:03Z" },
    { id: "500g", quantityValue: "500", quantityUnit: "g" as const, createdAt: "2025-01-01T00:00:04Z" },
    { id: "2box", quantityValue: "2", quantityUnit: "box" as const, createdAt: "2025-01-01T00:00:05Z" },
    { id: "1box", quantityValue: "1", quantityUnit: "box" as const, createdAt: "2025-01-01T00:00:06Z" },
  ];
  assert.deepEqual(
    sortVariantsForDisplay(multipleIncomparableGroups).map(({ id }) => id),
    ["500g", "1pack", "2pack", "2kg", "1box", "2box"],
  );
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
