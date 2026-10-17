/** Public configuration validation shared by the native client and EAS hook. */
export const DEFAULT_CUSTOMER_NATIVE_BUILD_PROFILE = "preview";
export const CUSTOMER_NATIVE_BUILD_TARGETS = Object.freeze({
  preview: Object.freeze({
    projectRef: "gkwcolipeavxnuzqlamb",
    supabaseUrl: "https://gkwcolipeavxnuzqlamb.supabase.co",
  }),
});

function publicHttpsUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const privateHost = host === "localhost" || host.endsWith(".localhost")
      || host.endsWith(".local") || host.endsWith(".internal")
      || /^(?:127|10|0)\./.test(host) || /^192\.168\./.test(host)
      || /^169\.254\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
      || host.includes(":") || !host.includes(".");
    const previewHost = /\.(?:replit\.dev|repl\.co)$/.test(host);
    if (url.protocol !== "https:" || url.username || url.password
      || url.search || url.hash || privateHost || previewHost
      || host.endsWith(".invalid")) return null;
    return url;
  } catch {
    return null;
  }
}

export function isPublicSupabaseKey(key, expectedProjectRef) {
  if (typeof key !== "string" || typeof expectedProjectRef !== "string") return false;
  try {
    const parts = key.split(".");
    if (parts.length !== 3 || !parts[0] || !parts[2]) return false;
    const claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return claims.role === "anon" && claims.ref === expectedProjectRef;
  } catch {
    return false;
  }
}

/**
 * Checks configuration shape, NOT endpoint health, key authenticity, or API/DB
 * identity. Those require a separately authorized real-backend verification.
 * Never include configuration values in returned errors.
 */
export function nativeConfigurationIssues({
  apiUrl,
  supabaseUrl,
  anonKey,
  profile = DEFAULT_CUSTOMER_NATIVE_BUILD_PROFILE,
}) {
  const issues = [];
  const target =
    typeof profile === "string" ? CUSTOMER_NATIVE_BUILD_TARGETS[profile] : undefined;
  if (!target) {
    issues.push("Select an explicitly approved Customer native build profile.");
  }
  const apiBaseUrl = publicHttpsUrl(apiUrl);
  if (!apiBaseUrl || apiBaseUrl.pathname !== "/") {
    issues.push("Configure a stable public HTTPS API origin, not localhost or a workspace preview URL.");
  }
  const authUrl = publicHttpsUrl(supabaseUrl);
  if (!authUrl || authUrl.pathname !== "/") {
    issues.push("Configure the public HTTPS Supabase project URL for the native app.");
  } else if (target && authUrl.origin !== target.supabaseUrl) {
    issues.push("The Supabase URL does not match the selected Customer native build profile.");
  }
  if (!target || !isPublicSupabaseKey(anonKey, target.projectRef)) {
    issues.push("Configure only a JWT anon key whose project and role claims match the selected profile.");
  }
  return issues;
}
