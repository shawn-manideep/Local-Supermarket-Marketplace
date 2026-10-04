import type { CustomerOrderSummary, RepeatOrderPreview } from "./api";

export type HomePreviewRow = {
  orderId: string;
  item: RepeatOrderPreview["items"][number];
  storeAvailable: boolean;
  storeName: string;
};

/** Presentation selection only: the API owns order status, availability and price. */
export function homeHistorySelection(orders: CustomerOrderSummary[]) {
  const recent = orders.filter(order => !["CANCELLED", "REJECTED"].includes(order.status)).slice(0, 2);
  const activeOrder = orders.find(order =>
    ["PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"].includes(order.status)) ?? null;
  return { recent, activeOrder, hasHistory: orders.length > 0 };
}

export function homeRecentStore<T extends { id: string }>(orders: CustomerOrderSummary[], stores: T[]) {
  return stores.find(store => store.id === orders[0]?.storeId) ?? null;
}

export function homePreviewRows(results: Array<{ orderId: string; preview: RepeatOrderPreview }>): HomePreviewRow[] {
  return results.flatMap(({ orderId, preview }) => preview.items.map(item => ({
    orderId, item, storeAvailable: preview.storeAvailable, storeName: preview.storeName,
  }))).slice(0, 4);
}

export function homeItemAvailable(row: HomePreviewRow) {
  const price = Number(row.item.currentUnitPrice);
  return row.storeAvailable && row.item.available && row.item.currentUnitPrice !== null
    && Number.isFinite(price) && price > 0;
}