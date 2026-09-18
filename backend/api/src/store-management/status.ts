export const STORE_STATUSES = [
  "PENDING_APPROVAL",
  "ACTIVE",
  "SUSPENDED",
  "REJECTED",
] as const;

export type StoreStatus = (typeof STORE_STATUSES)[number];

const allowedTransitions: Record<StoreStatus, readonly StoreStatus[]> = {
  PENDING_APPROVAL: ["ACTIVE", "REJECTED"],
  ACTIVE: ["SUSPENDED"],
  SUSPENDED: ["ACTIVE"],
  REJECTED: [],
};

export function canTransitionStoreStatus(
  currentStatus: StoreStatus,
  nextStatus: StoreStatus,
) {
  return allowedTransitions[currentStatus].includes(nextStatus);
}