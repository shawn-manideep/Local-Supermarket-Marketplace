export const CUSTOMER_NATIVE_AUTH_REDIRECT = "apnalocalbasket-customer://auth/callback";

export type NativeAuthCallback =
  | { kind: "recovery" | "signup"; access_token: string; refresh_token: string }
  | { kind: "invalid" };

/** Only the app's exact callback route is allowed to consume Auth credentials. */
export function parseNativeAuthCallback(value: string): NativeAuthCallback | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "apnalocalbasket-customer:" || url.hostname !== "auth"
    || !["/callback", "/callback/"].includes(url.pathname)
    || url.username || url.password || url.port) return null;
  const params = new URLSearchParams(url.hash.slice(1));
  const kind = params.get("type");
  if (params.has("error") || url.searchParams.has("error")
    || (kind !== "recovery" && kind !== "signup")
    || ["type", "access_token", "refresh_token"].some(key => params.getAll(key).length !== 1)) {
    return { kind: "invalid" };
  }
  const access_token = params.get("access_token")!;
  const refresh_token = params.get("refresh_token")!;
  if (!access_token.trim() || !refresh_token.trim()) return { kind: "invalid" };
  return { kind, access_token, refresh_token };
}
