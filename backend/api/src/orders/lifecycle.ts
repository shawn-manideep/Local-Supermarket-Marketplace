export const DEFAULT_COMMISSION_RATE = "0.00";
export const LEGAL_ORDER_TRANSITIONS: Record<string, Record<string, string>> = {
  ACCEPT: { PLACED: "ACCEPTED" }, PREPARE: { ACCEPTED: "PREPARING" },
  READY: { PREPARING: "READY" }, OUT_FOR_DELIVERY: { READY: "OUT_FOR_DELIVERY" },
  DELIVER: { OUT_FOR_DELIVERY: "DELIVERED" }, REJECT: { PLACED: "REJECTED" },
};
export function commissionRateCents(rate: string | null) {
  const [whole, fraction = ""] = (rate ?? DEFAULT_COMMISSION_RATE).split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
/** Half-up rounding, entirely in bigint cents/basis points. */
export function commissionCents(subtotal: bigint, rate: string | null) {
  return (subtotal * commissionRateCents(rate) + 5000n) / 10000n;
}