import { useSyncExternalStore } from "react";
import { apiRequest, apiUrl } from "./api";

export type BrandingConfig = { logoUrl: string | null; revision: string | null };
const REFRESH_EVENT = "local-basket:branding-refresh";
const POLL_INTERVAL = 60_000;
let config: BrandingConfig | null = null;
let listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let started = false;

function publish(next: BrandingConfig | null) {
  config = next;
  listeners.forEach((listener) => listener());
}

export function refreshBranding() {
  if (inFlight) return inFlight;
  inFlight = apiRequest<BrandingConfig>("/api/branding", "").then((result) => {
    publish({
      logoUrl: typeof result.logoUrl === "string" && result.logoUrl.startsWith("/") ? result.logoUrl : null,
      revision: typeof result.revision === "string" ? result.revision : null,
    });
  }).catch(() => {
    publish(null);
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function startSharedRefresh() {
  if (started || typeof window === "undefined") return;
  started = true;
  void refreshBranding();
  const interval = window.setInterval(() => void refreshBranding(), POLL_INTERVAL);
  const onFocus = () => void refreshBranding();
  const onRefresh = () => void refreshBranding();
  window.addEventListener("focus", onFocus);
  window.addEventListener(REFRESH_EVENT, onRefresh);
  // The singleton intentionally lives for the page lifetime; all listeners share its poll.
  void interval;
}

export function dispatchBrandingRefresh() {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export function useBrandingConfig() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      startSharedRefresh();
      return () => listeners.delete(listener);
    },
    () => config,
    () => null,
  );
}

export function brandingImageUrl(value: BrandingConfig | null | undefined) {
  if (!value?.logoUrl) return null;
  const url = apiUrl(value.logoUrl);
  const separator = url.includes("?") ? "&" : "?";
  return value.revision ? `${url}${separator}revision=${encodeURIComponent(value.revision)}` : url;
}

export function validateBrandingFile(file: Pick<File, "name" | "type" | "size">): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const extensionType = extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : null;
  if (!extensionType || (file.type && file.type !== extensionType)) return "Choose a PNG or JPEG image with a matching file extension.";
  if (file.size <= 0) return "Choose an image that is not empty.";
  if (file.size > 2 * 1024 * 1024) return "The logo must be 2 MiB or smaller.";
  return null;
}

export async function uploadBrandingLogo(token: string, file: File): Promise<BrandingConfig> {
  const validationError = validateBrandingFile(file);
  if (validationError) throw new Error(validationError);
  const contentType = file.type || (file.name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
  const response = await fetch(apiUrl(`/api/admin/branding/logo?fileName=${encodeURIComponent(file.name)}`), {
    method: "POST",
    credentials: "include",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body: file,
  });
  const payload = await response.json().catch(() => undefined) as BrandingConfig | { error?: string } | undefined;
  if (!response.ok) {
    throw new Error(payload && "error" in payload && payload.error ? payload.error : `Logo upload failed (${response.status}).`);
  }
  return payload as BrandingConfig;
}
