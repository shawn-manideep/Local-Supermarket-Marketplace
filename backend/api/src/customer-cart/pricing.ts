import { centsToMoney, moneyToCents } from "./money.js";
import { HttpError } from "../http.js";

/** Shared server pricing: integer cents, no client-owned fees or totals. */
export function cartPricing(subtotalCents: bigint, store: { deliveryFee: string; handlingFee?: string }) {
  const delivery = moneyToCents(store.deliveryFee);
  const handling = moneyToCents(store.handlingFee ?? "0");
  const total = subtotalCents + delivery + handling;
  if (subtotalCents < 0n || handling > 100000000n || total > 999999999999n) {
    throw new HttpError(400, "Invalid order pricing");
  }
  return {
    subtotal: centsToMoney(subtotalCents),
    deliveryFee: centsToMoney(delivery),
    handlingFee: centsToMoney(handling),
    total: centsToMoney(total),
  };
}
