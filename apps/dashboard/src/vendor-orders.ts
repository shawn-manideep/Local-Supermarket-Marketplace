import type { OrderItemSnapshot, OrderStatus } from "./api";
import { formatVariantName } from "@workspace/validation/variant-formatting";

export type VendorOrderAction = "ACCEPT" | "REJECT" | "PREPARE" | "READY" | "OUT_FOR_DELIVERY" | "DELIVER";
export type VendorOrderView = "orders" | "delivery";
export function vendorActions(status: OrderStatus, view: VendorOrderView): Array<{ action: VendorOrderAction; label: string; className: string }> {
  const primary = "vendor-primary-button";
  if (view === "delivery") {
    if (status === "READY") return [{ action: "OUT_FOR_DELIVERY", label: "Out for Delivery", className: primary }];
    if (status === "OUT_FOR_DELIVERY") return [{ action: "DELIVER", label: "Mark as Delivered", className: primary }];
    return [];
  }
  if (status === "PLACED") return [
    { action: "ACCEPT", label: "Accept Order", className: primary },
    { action: "REJECT", label: "Reject Order", className: "vendor-danger-button" },
  ];
  if (status === "ACCEPTED") return [{ action: "PREPARE", label: "Start Preparing", className: primary }];
  if (status === "PREPARING") return [{ action: "READY", label: "Mark Ready", className: primary }];
  return [];
}

export function historicalVariantLabel(item: Pick<OrderItemSnapshot, "variantNameSnapshot" | "variantQuantityValueSnapshot" | "variantQuantityUnitSnapshot">) {
  if (item.variantNameSnapshot?.trim()) return item.variantNameSnapshot;
  if (item.variantQuantityValueSnapshot && item.variantQuantityUnitSnapshot)
    return formatVariantName(item.variantQuantityValueSnapshot, item.variantQuantityUnitSnapshot);
  return "Variant not recorded";
}

export function vendorStatusLabel(status: OrderStatus) {
  return status === "PLACED" ? "New / Placed" : status === "DELIVERED" ? "Completed / Delivered" : status.replaceAll("_", " ");
}

export function vendorEmptyMessage(status: string) {
  return status === "PLACED" ? "No new orders" : status === "ALL" ? "No orders yet" : "No orders found in this status.";
}

export const actionProgress: Record<VendorOrderAction, string> = {
  ACCEPT: "Accepting...", REJECT: "Rejecting...", PREPARE: "Starting preparation...",
  READY: "Marking ready...", OUT_FOR_DELIVERY: "Updating delivery...", DELIVER: "Updating delivery...",
};

/** A synchronous guard: two clicks in one render must not submit twice. */
export function createVendorActionGate() {
  let pending = false;
  return {
    start() { if (pending) return false; pending = true; return true; },
    finish() { pending = false; },
    get pending() { return pending; },
  };
}