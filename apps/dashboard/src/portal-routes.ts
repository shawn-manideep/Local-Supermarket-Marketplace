export type PortalRoute =
  | "vendor-login"
  | "vendor-dashboard"
  | "delivery-login"
  | "delivery-dashboard"
  | "admin"
  | "not-found";

export type LegacyPortalEntry = "home" | "delivery" | null;

function relativePath(pathname: string, basePath: string) {
  const base = basePath.replace(/\/+$/, "");
  if (!base) return pathname.replace(/\/+$/, "") || "/";
  if (pathname === base || pathname === `${base}/`) return "/";
  if (pathname.startsWith(`${base}/`)) return pathname.slice(base.length).replace(/\/+$/, "") || "/";
  return pathname.replace(/\/+$/, "") || "/";
}

export function portalRouteFromPath(pathname: string, basePath = "/"): PortalRoute {
  const path = relativePath(pathname, basePath);
  if (/^\/admin(?:\/|$)/.test(path)) return "admin";
  if (path === "/vendor/login" || path === "/" || path === "/vendor") return "vendor-login";
  if (path === "/vendor/dashboard") return "vendor-dashboard";
  if (path === "/delivery/login" || path === "/delivery-partner") return "delivery-login";
  if (path === "/delivery/dashboard") return "delivery-dashboard";
  return "not-found";
}

export function legacyPortalEntryFromPath(pathname: string, basePath = "/"): LegacyPortalEntry {
  const path = relativePath(pathname, basePath);
  if (path === "/") return "home";
  if (path === "/delivery-partner") return "delivery";
  return null;
}

export function portalRoutePath(route: PortalRoute, basePath = "/") {
  const base = basePath.replace(/\/+$/, "");
  const suffix: Record<PortalRoute, string> = {
    "vendor-login": "/vendor/login",
    "vendor-dashboard": "/vendor/dashboard",
    "delivery-login": "/delivery/login",
    "delivery-dashboard": "/delivery/dashboard",
    admin: "/admin",
    "not-found": "/vendor/login",
  };
  return `${base}${suffix[route]}` || suffix[route];
}

export function dashboardForRole(role: "vendor" | "delivery_partner" | "admin") : PortalRoute {
  return role === "vendor" ? "vendor-dashboard" : role === "delivery_partner" ? "delivery-dashboard" : "admin";
}

export function loginForDashboard(route: PortalRoute): PortalRoute | null {
  if (route === "vendor-dashboard") return "vendor-login";
  if (route === "delivery-dashboard") return "delivery-login";
  return null;
}

export function portalRouteMatchesRole(role: "vendor" | "delivery_partner" | "admin", route: PortalRoute) {
  if (role === "vendor") return route === "vendor-login" || route === "vendor-dashboard";
  if (role === "delivery_partner") return route === "delivery-login" || route === "delivery-dashboard";
  return route === "admin";
}
