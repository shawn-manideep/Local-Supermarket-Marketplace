import type { VendorNotification, VendorNotificationFeed } from "../../../lib/api-client-react/src/generated/api.schemas";

export function mergeUnreadNotifications(
  current: VendorNotification[],
  feed: VendorNotificationFeed,
  surfacedIds: Set<string>,
): VendorNotification[] {
  const readIds = new Set(feed.notifications.filter((item) => item.readAt).map((item) => item.id));
  const merged = new Map(current.filter((item) => !readIds.has(item.id)).map((item) => [item.id, item]));
  for (const notification of feed.notifications) {
    if (notification.readAt || surfacedIds.has(notification.id)) continue;
    surfacedIds.add(notification.id);
    merged.set(notification.id, notification);
  }
  return [...merged.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
