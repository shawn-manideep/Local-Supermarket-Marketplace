import type { RepeatOrderPreviewItem, RepeatOrderResult } from "./api";

export function reorderSummary(result: Pick<RepeatOrderResult, "addedCount" | "unavailable">) {
  if (result.addedCount === 0) return "None of these items are currently available.";
  return result.unavailable.length > 0 ? "Partially available" : "Items added to your cart";
}

export function reorderItemLabel(item: Pick<RepeatOrderPreviewItem, "productName" | "variantNameSnapshot">) {
  return [item.productName, item.variantNameSnapshot].filter(Boolean).join(" — ");
}

/** Only operational identity and confirmation fields go to the reorder API. */
export function reorderInput(addressId: string, idempotencyKey: string, orderItemId?: string, confirmStoreSwitch = false) {
  return { addressId, idempotencyKey, confirmStoreSwitch, ...(orderItemId ? { orderItemId } : {}) };
}

export function reorderPreviewQuery(addressId: string, orderItemId?: string) {
  const query = new URLSearchParams({ addressId });
  if (orderItemId) query.set("orderItemId", orderItemId);
  return query.toString();
}