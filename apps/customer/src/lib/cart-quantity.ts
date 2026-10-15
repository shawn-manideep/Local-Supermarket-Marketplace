import type { CustomerCart } from "./api";

const activeWrites = new Set<Promise<void>>();
export async function waitForCartQuantityWrites() {
  while (activeWrites.size) await Promise.all([...activeWrites]);
}
const cents = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
};
const money = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;

export function projectCartQuantities(cart: CustomerCart | null, targets: ReadonlyMap<string, number>): CustomerCart | null {
  if (!cart) return null;
  const items = cart.items.flatMap(item => {
    const quantity = targets.get(item.id) ?? item.quantity;
    return quantity === 0 ? [] : [{ ...item, quantity, lineSubtotal: money(cents(item.unitPrice) * BigInt(quantity)) }];
  });
  if (!items.length) return null;
  const subtotal = items.reduce((sum, item) => sum + cents(item.lineSubtotal), 0n);
  return { ...cart, items, subtotal: money(subtotal), total: money(subtotal + cents(cart.deliveryFee)),
    checkoutReady: (cart.operatingStatus === "OPEN" || !!cart.scheduledDeliveryAvailable)
      && items.every(item => item.purchasable) && subtotal >= cents(cart.minimumOrderValue) };
}

/** One writer per screen; rapid presses use the latest target, never a render's stale quantity. */
export function createCartQuantityController(options: {
  write: (itemId: string, quantity: number) => Promise<CustomerCart | null>;
  read: () => Promise<CustomerCart | null>;
  onChange: (cart: CustomerCart | null) => void;
  onPending: (pending: boolean) => void;
  onError: (reason: unknown, syncFailed: boolean) => void;
}) {
  let cart: CustomerCart | null = null;
  const targets = new Map<string, number>();
  let running: Promise<void> | null = null;
  let revision = 0;
  let changeVersion = 0;
  const publish = () => options.onChange(projectCartQuantities(cart, targets));
  async function flush() {
    const version = revision;
    while (targets.size && version === revision) {
      const [itemId, target] = targets.entries().next().value!;
      const cartId = cart?.id;
      try {
        const result = await options.write(itemId, target);
        if (version !== revision) return;
        cart = result;
        if (cart?.id !== cartId) targets.clear();
        else if (targets.get(itemId) === target) targets.delete(itemId);
        publish();
      } catch (reason) {
        if (version !== revision) return;
        targets.delete(itemId);
        let syncFailed = false;
        try { cart = await options.read(); if (cart?.id !== cartId) targets.clear(); }
        catch { syncFailed = true; targets.clear(); }
        if (version !== revision) return;
        publish();
        options.onError(reason, syncFailed);
      }
    }
  }
  function start() {
    if (running) return;
    options.onPending(true);
    running = flush().finally(() => {
      running = null;
      options.onPending(false);
      if (targets.size) start();
    });
    const work = running;
    activeWrites.add(work);
    void work.finally(() => activeWrites.delete(work));
  }
  function change(itemId: string, delta: number, remove = false) {
    const item = cart?.items.find(row => row.id === itemId);
    if (!item) return;
    const current = targets.get(itemId) ?? item.quantity;
    if (current === 0) return; // A queued deletion must never be resurrected by stale presses.
    const next = remove ? 0 : Math.max(0, Math.min(999, current + delta));
    if (next === current) return;
    changeVersion++;
    targets.set(itemId, next);
    publish();
    start();
  }
  return {
    reset(value: CustomerCart | null) { revision++; changeVersion++; targets.clear(); cart = value; publish(); },
    version() { return changeVersion; },
    adjust(itemId: string, delta: -1 | 1) { change(itemId, delta); },
    remove(itemId: string) { change(itemId, 0, true); },
    async settled() { while (running) await running; },
    isPending() { return targets.size > 0 || running !== null; },
  };
}
