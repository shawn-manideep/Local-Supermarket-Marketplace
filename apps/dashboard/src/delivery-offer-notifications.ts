export type OfferNoticeStorage = Pick<Storage, "getItem" | "setItem">;

const storagePrefix = "local-basket:delivery-offer-notices:v1:";
const maxRememberedOffers = 500;

function storageKey(username: string) {
  return `${storagePrefix}${encodeURIComponent(username.trim().toLowerCase())}`;
}

export function getOfferNoticeStorage(): OfferNoticeStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readSeenOfferIds(username: string, storage?: OfferNoticeStorage) {
  if (!username || !storage) return new Set<string>();
  try {
    const value: unknown = JSON.parse(storage.getItem(storageKey(username)) ?? "[]");
    return new Set(
      Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string" && id.length > 0).slice(-maxRememberedOffers)
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

export function rememberSeenOfferIds(
  username: string,
  orderIds: string[],
  current: Set<string>,
  storage?: OfferNoticeStorage,
) {
  const next = new Set(current);
  orderIds.filter(Boolean).forEach((id) => next.add(id));
  if (username && storage) {
    try {
      storage.setItem(storageKey(username), JSON.stringify([...next].slice(-maxRememberedOffers)));
    } catch {
      // In-memory deduplication still applies if browser storage is unavailable.
    }
  }
  return next;
}

export function unseenOffers<T extends { orderId: string }>(offers: T[], seenIds: Set<string>) {
  return offers.filter((offer) => !seenIds.has(offer.orderId));
}
