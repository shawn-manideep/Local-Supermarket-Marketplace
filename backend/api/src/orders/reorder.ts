import { moneyToCents } from "../customer-cart/money.js";

/** Pure eligibility rules shared by the preview and locked cart mutation. */
export interface ReorderLine {
  orderItemId: string;
  orderProductId: string | null;
  originalVariantId: string | null;
  productName: string;
  variantNameSnapshot: string | null;
  quantity: number;
  productId: string | null;
  productStoreId: string | null;
  variantId: string | null;
  variantProductId: string | null;
  productActive: boolean | null;
  productAvailable: boolean | null;
  variantActive: boolean | null;
  variantAvailable: boolean | null;
  stockQuantity: number | null;
  currentUnitPrice: string | null;
}

export function evaluateReorderLine(row: ReorderLine, storeId: string, storeAvailable: boolean) {
  let reason: string | null = null;
  if (!storeAvailable) reason = "Store cannot deliver to the selected address";
  else if (!row.productId || !row.variantId || row.originalVariantId !== row.variantId ||
    row.orderProductId !== row.productId || row.variantProductId !== row.productId ||
    row.productStoreId !== storeId) reason = "Original product variant is no longer available";
  else if (!row.productActive || !row.productAvailable || !row.variantActive || !row.variantAvailable)
    reason = "Product variant is currently unavailable";
  else if (!Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 999)
    reason = "Previous quantity cannot be added";
  else if (row.currentUnitPrice === null || !/^\d+(?:\.\d{1,2})?$/.test(row.currentUnitPrice) ||
    moneyToCents(row.currentUnitPrice) <= 0n)
    reason = "Current price is unavailable";
  else if (row.stockQuantity === null || !Number.isInteger(row.stockQuantity) || row.stockQuantity < row.quantity)
    reason = "Insufficient stock";
  // Explicit allowlist: never return the row or its private inventory/ownership fields.
  return {
    orderItemId: row.orderItemId,
    productName: row.productName,
    variantNameSnapshot: row.variantNameSnapshot,
    quantity: row.quantity,
    currentUnitPrice: reason === null ? row.currentUnitPrice : null,
    available: reason === null,
    reason,
  };
}