/** Public configuration validation shared by the native client and EAS hook. */
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

export function isPublicSupabaseKey(key) {
  if (typeof key !== "string") return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  try {
    const parts = key.split(".");
    if (parts.length !== 3 || !parts[0] || !parts[2]) return false;
    const claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return claims.role === "anon";
  } catch {
    return false;
  }
}

/**
 * Checks configuration shape, NOT endpoint health, key authenticity, or API/DB
 * identity. Those require a separately authorized real-backend verification.
 * Never include configuration values in returned errors.
 */
export function nativeConfigurationIssues({ apiUrl, supabaseUrl, anonKey }) {
  const issues = [];
  if (!publicHttpsUrl(apiUrl)) {
    issues.push("Configure a stable public HTTPS API URL for the native app, not localhost or a workspace preview URL.");
  }
  const authUrl = publicHttpsUrl(supabaseUrl);
  if (!authUrl || authUrl.pathname !== "/") {
    issues.push("Configure the public HTTPS Supabase project URL for the native app.");
  }
  if (!isPublicSupabaseKey(anonKey)) {
    issues.push("Configure only a Supabase anon or publishable key. Never use a service-role or secret key in the app.");
  }
  return issues;
}
