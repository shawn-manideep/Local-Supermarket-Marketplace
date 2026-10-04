// Navigation guard only; the API remains the authorization boundary.
export function matchesAdminPath(pathname: string, basePath = "/") {
  const base = basePath.replace(/\/$/, "");
  const relative = base && pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
  return /^\/admin(?:\/|$)/.test(relative);
}