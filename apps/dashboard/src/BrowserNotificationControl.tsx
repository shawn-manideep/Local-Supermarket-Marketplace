import { useState } from "react";

export type BrowserNotificationPermission = NotificationPermission | "unsupported";
export type NotificationIdStorage = Pick<Storage, "getItem" | "setItem">;

const storagePrefix = "local-basket:browser-notifications:v1:";
const maxRememberedIds = 500;

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  try {
    return typeof window !== "undefined" && "Notification" in window
      ? window.Notification.permission
      : "unsupported";
  } catch {
    return "unsupported";
  }
}

export function browserNotificationsEnabled() {
  return getBrowserNotificationPermission() === "granted";
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    return await window.Notification.requestPermission();
  } catch {
    return "unsupported";
  }
}

export function showBackgroundBrowserNotification(title: string, body: string, tag: string) {
  if (typeof document === "undefined" || document.visibilityState !== "hidden" || !browserNotificationsEnabled()) return false;
  try {
    const notification = new window.Notification(title, { body, tag });
    notification.onclick = () => window.focus();
    return true;
  } catch {
    return false;
  }
}

export function getBrowserNotificationStorage(): NotificationIdStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function notificationStorageKey(scope: string) {
  return `${storagePrefix}${encodeURIComponent(scope)}`;
}

export function readBrowserNotificationIds(scope: string, storage?: NotificationIdStorage) {
  if (!scope || !storage) return new Set<string>();
  try {
    const value: unknown = JSON.parse(storage.getItem(notificationStorageKey(scope)) ?? "[]");
    return new Set(
      Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string" && id.length > 0).slice(-maxRememberedIds)
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

export function rememberBrowserNotificationIds(
  scope: string,
  ids: string[],
  current: Set<string>,
  storage?: NotificationIdStorage,
) {
  const next = new Set(current);
  ids.filter(Boolean).forEach((id) => next.add(id));
  if (scope && storage) {
    try {
      storage.setItem(notificationStorageKey(scope), JSON.stringify([...next].slice(-maxRememberedIds)));
    } catch {
      // In-memory deduplication still applies when browser storage is unavailable.
    }
  }
  return next;
}

export function BrowserNotificationControl({ className }: { className: string }) {
  const [permission, setPermission] = useState(getBrowserNotificationPermission);
  const [requesting, setRequesting] = useState(false);
  if (permission === "unsupported") return null;
  if (permission === "granted") return <span className={className} role="status">Browser alerts enabled</span>;
  if (permission === "denied") return <span className={className} role="status">Browser alerts blocked in site settings</span>;
  return (
    <button
      className={className}
      type="button"
      disabled={requesting}
      onClick={async () => {
        setRequesting(true);
        setPermission(await requestBrowserNotificationPermission());
        setRequesting(false);
      }}
    >
      {requesting ? "Requesting permission…" : "Enable browser alerts"}
    </button>
  );
}
