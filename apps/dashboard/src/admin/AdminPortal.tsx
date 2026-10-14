import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { ApiRequestError, apiAuthorizationHeaders, apiUrl } from "../api";
import { AdminMasterCatalogPanel } from "../AdminMasterCatalogPanel";
import { AdminVendorDocuments } from "./AdminVendorDocuments";
import { AdminBranding } from "./AdminBranding";
import { BrandingLogo } from "../BrandingLogo";
import {
  changeAdminStatus,
  createAdminVendor,
  createAdminPartner,
  getAdminVendorDocuments,
  getAdminAccount,
  getAdminDashboard,
  listAdminAccounts,
  updateAdminVendor,
  type AccountStatus,
  type AdminDashboard,
  type AdminDetail,
  type AdminKind,
  type AdminPage,
  type AdminRow,
} from "../admin-api";
import { partnerProvisionSchema, storeUpdateSchema, usernameSchema } from "@workspace/validation";
import { StoreProfileFields } from "../StoreProfileFields";
import { StoreLocationMap } from "../StoreLocationMap";
import { readWeeklyHours, WeeklyHoursFields } from "../WeeklyHoursFields";
import { OrderOperations } from "../OrderOperations";
import "./admin.css";

type Section = "dashboard" | AdminKind | "orders" | "profile" | "master-catalog" | "branding";
type Props = { token: string; session: Session; userId: string; onLogout: () => void };
type Message = { text: string; kind: "error" | "success" | "notice" };

const nav: Array<{ key: Section; label: string; number: string }> = [
  { key: "dashboard", label: "Dashboard", number: "01" },
  { key: "vendors", label: "Vendors", number: "02" },
  { key: "customers", label: "Customers", number: "03" },
  { key: "delivery-partners", label: "Delivery Partners", number: "04" },
  { key: "orders", label: "Order Oversight", number: "05" },
  { key: "profile", label: "Profile", number: "06" },
  { key: "master-catalog", label: "Master Catalog", number: "07" },
  { key: "branding", label: "Application Branding", number: "08" },
];
const kindLabel: Record<AdminKind, string> = {
  vendors: "Vendors",
  customers: "Customers",
  "delivery-partners": "Delivery partners",
};
const titleCaseStatus = (status: string) => status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
};
const statusClass = (status: string | null) => (status || "unlinked").toLowerCase();
const fallbackError = (error: unknown, purpose: string) => {
  if (error instanceof ApiRequestError) {
    if (error.status === 401 || error.status === 403) return "Permission denied. Your admin access could not be confirmed; refresh your session or contact a platform administrator.";
    if (error.status === 409) return error.message || "This action conflicts with the account's current state. Refresh and review the latest details.";
    return error.message || `The ${purpose} request could not be completed.`;
  }
  return `The ${purpose} request could not be completed. Check your connection and try again.`;
};
const vendorProfileError = (error: unknown, purpose: string) => {
  if (error instanceof ApiRequestError && error.details?.length) {
    const fieldMessages = error.details.map((issue) => {
      const path = issue.path?.filter((part) => typeof part === "string").join(".");
      return path ? `${path}: ${issue.message || "Invalid value"}` : issue.message || "Invalid value";
    });
    return `Please review the vendor profile: ${fieldMessages.join(" · ")}`;
  }
  return fallbackError(error, purpose);
};
const isDestructive = (status: string) => ["SUSPENDED", "REJECTED", "INACTIVE"].includes(status);
const statusOptions: Record<AdminKind, Array<{ value: string; label: string }>> = {
  vendors: [
    { value: "", label: "All store statuses" },
    { value: "PENDING_APPROVAL", label: "Pending approval" },
    { value: "ACTIVE", label: "Active" },
    { value: "SUSPENDED", label: "Suspended" },
    { value: "REJECTED", label: "Rejected" },
  ],
  customers: [
    { value: "", label: "All account statuses" },
    { value: "ACTIVE", label: "Active" },
    { value: "INACTIVE", label: "Inactive" },
  ],
  "delivery-partners": [
    { value: "", label: "All account statuses" },
    { value: "ACTIVE", label: "Active" },
    { value: "INACTIVE", label: "Inactive" },
  ],
};

function sectionFromPath(): Section {
  const path = window.location.pathname.replace(/\/+$/, "");
  const last = path.split("/").pop() || "";
  if (last === "vendors" || last === "customers" || last === "delivery-partners" || last === "orders" || last === "profile" || last === "master-catalog" || last === "branding") return last;
  return "dashboard";
}
function sectionPath(section: Section) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return section === "dashboard" ? `${base}/admin` : `${base}/admin/${section}`;
}
function headingFor(section: Section) {
  if (section === "dashboard") return ["Platform overview", "A clear view of the neighborhood marketplace."];
  if (section === "profile") return ["Admin profile", "Your verified platform identity. Profile details are read-only here."];
  if (section === "master-catalog") return ["Master Catalog", "Manage canonical grocery identities without changing store-owned prices or inventory."];
  if (section === "branding") return ["Application Branding", "Set the shared Local Basket identity across customer and operations portals."];
  if (section === "orders") return ["Order oversight", "Review order timelines, delivery assignments, package photos, and downloadable reports."];
  return [kindLabel[section], section === "vendors" ? "Review neighborhood shops and manage their storefront access." : section === "customers" ? "Look up customer accounts and safely manage access." : "Provision and maintain delivery partner portal access."];
}

export function AdminPortal({ token, session, userId, onLogout }: Props) {
  const [section, setSection] = useState<Section>(sectionFromPath);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuButton = useRef<HTMLButtonElement>(null);
  const mobileSidebar = useRef<HTMLElement>(null);
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<AdminDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailTarget, setDetailTarget] = useState<{ kind: AdminKind; id: string } | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const detailController = useRef<AbortController | null>(null);
  const heading = headingFor(section);
  const email = session.user.email || "Email unavailable";

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const mobileViewport = window.matchMedia("(max-width: 680px)");
    if (!mobileViewport.matches) {
      setMobileMenuOpen(false);
      return;
    }
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (!event.matches) setMobileMenuOpen(false);
    };
    mobileViewport.addEventListener("change", closeOnDesktop);
    mobileSidebar.current?.querySelector<HTMLElement>("button")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
        mobileMenuButton.current?.focus();
      }
      if (event.key === "Tab" && mobileSidebar.current) {
        const controls = Array.from(mobileSidebar.current.querySelectorAll<HTMLElement>("button:not(:disabled)"));
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      mobileViewport.removeEventListener("change", closeOnDesktop);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const sync = () => setSection(sectionFromPath());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => () => detailController.current?.abort(), []);
  useEffect(() => {
    if (!detail && !detailLoading && !detailError) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        detailController.current?.abort();
        setDetail(null);
        setDetailError("");
        setDetailLoading(false);
        setDetailTarget(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detail, detailLoading, detailError]);
  useEffect(() => {
    const refreshOnReturn = () => {
      if (document.visibilityState === "visible") setRevision((current) => current + 1);
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setDashboardLoading(true);
    void getAdminDashboard(token, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      setDashboard(response.dashboard);
      setDashboardError("");
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setDashboardError(fallbackError(error, "dashboard"));
    }).finally(() => {
      if (!controller.signal.aborted) setDashboardLoading(false);
    });
    return () => controller.abort();
  }, [token, revision]);

  const navigate = (target: Section) => {
    window.history.pushState(null, "", sectionPath(target));
    setSection(target);
    if (mobileMenuOpen) window.requestAnimationFrame(() => mobileMenuButton.current?.focus());
    setMobileMenuOpen(false);
    setMessage(null);
    detailController.current?.abort();
    setDetail(null);
    setDetailLoading(false);
    setDetailError("");
    setDetailTarget(null);
  };
  const reload = () => setRevision((current) => current + 1);
  const openDetail = (kind: AdminKind, id: string) => {
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setDetailTarget({ kind, id });
    setDetail(null);
    setDetailLoading(true);
    setDetailError("");
    void getAdminAccount(kind, id, token, controller.signal).then((response) => {
      setDetail(response.account);
      setDetailError("");
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setDetailError(fallbackError(error, "account detail"));
    }).finally(() => {
      if (!controller.signal.aborted) setDetailLoading(false);
    });
  };
  const closeDetail = () => {
    detailController.current?.abort();
    setDetail(null);
    setDetailLoading(false);
    setDetailError("");
    setDetailTarget(null);
  };
  const refreshDetail = async (kind: AdminKind, id: string) => {
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    try {
      const result = await getAdminAccount(kind, id, token, controller.signal);
      if (!controller.signal.aborted) setDetail(result.account);
    } catch (error) {
      if (!controller.signal.aborted) setDetailError(fallbackError(error, "account detail"));
    }
  };
  const changeStatus = async (kind: AdminKind, account: AdminDetail, nextStatus: string) => {
    if (!account.allowedStatuses.includes(nextStatus) || account.status === nextStatus) return;
    const destructive = isDestructive(nextStatus);
    let confirmedAssignments = false;
    if (destructive) {
      const action = nextStatus === "REJECTED" ? "reject" : nextStatus === "SUSPENDED" ? "suspend" : "deactivate";
      let prompt = `Confirm ${action} for ${account.displayName || account.username || "this account"}? Account data and history will be preserved; access will be restricted.`;
      if (kind === "delivery-partners" && nextStatus === "INACTIVE" && account.activeAssignments > 0) {
        prompt = `This partner has ${account.activeAssignments} active assignment${account.activeAssignments === 1 ? "" : "s"}. Deactivation will preserve the duty and all delivery state; it will not cancel or reassign work. Partner operations will be blocked. Confirm deactivation?`;
        confirmedAssignments = true;
      }
      if (!window.confirm(prompt)) return;
    }
    setMessage(null);
    setStatusBusy(true);
    try {
      await changeAdminStatus(kind, account.id, nextStatus, token, confirmedAssignments);
      setMessage({ text: `${account.displayName || account.username || "Account"} is now ${titleCaseStatus(nextStatus)}.`, kind: "success" });
      reload();
      await refreshDetail(kind, account.id);
    } catch (error) {
      setMessage({ text: fallbackError(error, "status change"), kind: "error" });
      if (error instanceof ApiRequestError && error.status === 409 && kind === "delivery-partners" && nextStatus === "INACTIVE" && !confirmedAssignments) {
        const retry = window.confirm("The partner has active assignments. Deactivation preserves existing duties and blocks operations; nothing will be cancelled or reassigned. Confirm deactivation?");
        if (retry) {
          try {
            await changeAdminStatus(kind, account.id, nextStatus, token, true);
            setMessage({ text: "Partner deactivated. Existing delivery duties were preserved and not reassigned.", kind: "success" });
            reload();
            await refreshDetail(kind, account.id);
          } catch (retryError) {
            setMessage({ text: fallbackError(retryError, "partner deactivation"), kind: "error" });
          }
        }
      }
    } finally {
      setStatusBusy(false);
    }
  };
  const logout = async () => {
    setLogoutBusy(true);
    try { await onLogout(); } finally { setLogoutBusy(false); }
  };

  return (
    <div className="lb-admin">
      <div className="lb-admin-layout">
        {mobileMenuOpen && <button className="lb-admin-backdrop" type="button" aria-label="Close admin navigation" onClick={() => { setMobileMenuOpen(false); window.requestAnimationFrame(() => mobileMenuButton.current?.focus()); }} />}
        <aside className={`lb-admin-sidebar${mobileMenuOpen ? " is-mobile-open" : ""}`} ref={mobileSidebar} id="admin-primary-navigation" aria-label="Admin navigation">
          <div className="lb-admin-brand"><BrandingLogo className="lb-admin-mark" /><div><strong>Local Basket</strong><span>Platform office</span></div></div>
          <div className="lb-admin-nav-label">OPERATIONS</div>
          <nav className="lb-admin-nav" aria-label="Admin navigation">
            {nav.map((item) => <button key={item.key} type="button" aria-current={section === item.key ? "page" : undefined} onClick={() => navigate(item.key)}><span className="nav-index">{item.number}</span>{item.label}</button>)}
          </nav>
          <div className="lb-admin-side-foot">
            <div className="lb-admin-identity"><strong>Platform administrator</strong><span title={email}>{email}</span></div>
            <button className="lb-admin-logout" type="button" onClick={() => void logout()} disabled={logoutBusy}>{logoutBusy ? "Signing out…" : "Logout"}</button>
          </div>
        </aside>
        <main className="lb-admin-main">
          <div className="lb-admin-mobile-head"><button ref={mobileMenuButton} className="lb-admin-menu-toggle" type="button" aria-expanded={mobileMenuOpen} aria-controls="admin-primary-navigation" onClick={() => setMobileMenuOpen(true)}>Admin menu</button><span className="lb-admin-mobile-brand"><BrandingLogo /> <strong>Local Basket · Admin</strong></span><button onClick={() => void logout()} type="button" disabled={logoutBusy}>{logoutBusy ? "Signing out…" : "Logout"}</button></div>
          <div className="lb-admin-top"><div className="lb-admin-breadcrumb">LOCAL BASKET <span aria-hidden="true">/</span> ADMIN / {heading[0].toUpperCase()}</div><div className="lb-admin-top-status"><i className="lb-admin-live-dot" /> Admin access verified</div></div>
          {message && <div className={`lb-admin-message ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</div>}
          <section className="lb-admin-content" key={section}>
            <header className="lb-admin-heading"><div><p className="lb-admin-eyebrow">Platform administration</p><h1>{heading[0]}</h1><p className="lb-admin-subtitle">{heading[1]}</p></div>
              {section !== "profile" && section !== "branding" && section !== "orders" && <button className="lb-admin-button" type="button" onClick={reload} disabled={section === "dashboard" && dashboardLoading}>{section === "dashboard" && dashboardLoading ? "Refreshing…" : "Refresh data"}</button>}
            </header>
            {section === "dashboard" && <Dashboard data={dashboard} loading={dashboardLoading} error={dashboardError} retry={reload} go={navigate} />}
            {section === "orders" && <OrderOperations token={token} vendor={false} onMessage={(text, kind = "success") => setMessage({ text, kind })} />}
            {section === "master-catalog" && <AdminMasterCatalogPanel token={token} onMessage={(text, kind = "success") => setMessage({ text, kind })} />}
            {section === "branding" && <AdminBranding token={token} />}
            {(section === "vendors" || section === "customers" || section === "delivery-partners") && <AccountDirectory key={section} kind={section} token={token} revision={revision} onOpen={openDetail} onProvisioned={(text) => { setMessage({ text, kind: "success" }); reload(); }} />}
            {section === "profile" && <ProfileCard email={email} userId={userId} />}
          </section>
        </main>
      </div>
      {(detailLoading || detail || detailError) && <div className="lb-admin-detail-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}>
        <aside className="lb-admin-detail" role="dialog" aria-modal="true" aria-label="Account details">
          <div className="lb-admin-detail-head"><div><p className="lb-admin-eyebrow">Account record</p><h2>{detail?.displayName || "Account details"}</h2></div><button className="lb-admin-close" type="button" onClick={closeDetail} aria-label="Close details">×</button></div>
          {detailLoading && <div className="lb-admin-loading" aria-label="Loading account details"><div className="lb-admin-skeleton" /><div className="lb-admin-skeleton" /><div className="lb-admin-skeleton" /></div>}
          {detailError && <div className="lb-admin-message error" role="alert">{detailError}{detailTarget && <button className="lb-admin-row-action" type="button" onClick={() => openDetail(detailTarget.kind, detailTarget.id)}>Try again</button>}</div>}
          {detail && (section === "vendors" || section === "customers" || section === "delivery-partners") && <AccountDetail kind={section} account={detail} token={token} busy={statusBusy} onStatus={(status) => void changeStatus(section, detail, status)} onSaved={async () => { await refreshDetail(section, detail.id); reload(); setMessage({ text: "Vendor store profile saved.", kind: "success" }); }} />}
        </aside>
      </div>}
    </div>
  );
}

function Metric({ label, value, foot }: { label: string; value: number; foot: string }) {
  return <div className="lb-admin-metric"><div className="lb-admin-metric-label">{label}</div><div className="lb-admin-metric-value">{value.toLocaleString("en-IN")}</div><div className="lb-admin-metric-foot">{foot}</div></div>;
}
function Dashboard({ data, loading, error, retry, go }: { data: AdminDashboard | null; loading: boolean; error: string; retry: () => void; go: (section: Section) => void }) {
  if (loading && !data) return <div className="lb-admin-metrics" aria-label="Loading dashboard">{Array.from({ length: 8 }, (_, index) => <div className="lb-admin-metric" key={index}><div className="lb-admin-skeleton" /><div className="lb-admin-skeleton" /><div className="lb-admin-skeleton" /></div>)}</div>;
  if (error && !data) return <div className="lb-admin-error-state"><strong>Dashboard unavailable</strong><p>{error}</p><button className="lb-admin-button" type="button" onClick={retry}>Retry dashboard</button></div>;
  if (!data) return null;
  return <>
    {error && <div className="lb-admin-message error" role="alert">{error} <button className="lb-admin-row-action" type="button" onClick={retry}>Retry</button></div>}
    <div className="lb-admin-metrics">
      <Metric label="Customers" value={data.totalCustomers} foot={`${data.activeCustomers.toLocaleString("en-IN")} active · ${data.inactiveCustomers.toLocaleString("en-IN")} inactive`} />
      <Metric label="Active customers" value={data.activeCustomers} foot="Customer portal access" />
      <Metric label="Vendors" value={data.totalVendors} foot="Neighborhood shop accounts" />
      <Metric label="Pending vendors" value={data.pendingVendors} foot="Awaiting store review" />
      <Metric label="Active vendors" value={data.activeVendors} foot="Stores currently active" />
      <Metric label="Delivery partners" value={data.totalDeliveryPartners} foot={`${data.activeDeliveryPartners.toLocaleString("en-IN")} active partners`} />
      <Metric label="Active partners" value={data.activeDeliveryPartners} foot="Partner portal access" />
      <Metric label="Inactive partners" value={data.inactiveDeliveryPartners} foot="Partner accounts paused" />
    </div>
    <div className="lb-admin-dash-lower">
      <section className="lb-admin-panel"><div className="lb-admin-panel-head"><h2>Account stewardship</h2><span className="lb-admin-eyebrow" style={{ margin: 0 }}>ACCESS ONLY</span></div><div className="lb-admin-panel-body"><p className="lb-admin-note">This workspace governs who can access marketplace portals and whether a neighborhood storefront may operate. Account history and active delivery duties remain preserved when access changes.</p></div></section>
      <section className="lb-admin-panel"><div className="lb-admin-panel-head"><h2>Go to a directory</h2></div><div className="lb-admin-panel-body lb-admin-quick">{(["vendors", "customers", "delivery-partners"] as AdminKind[]).map((kind) => <button key={kind} type="button" onClick={() => go(kind)}><span>{kindLabel[kind]}</span><span>OPEN DIRECTORY</span></button>)}</div></section>
    </div>
  </>;
}

function AccountDirectory({ kind, token, revision, onOpen, onProvisioned }: { kind: AdminKind; token: string; revision: number; onOpen: (kind: AdminKind, id: string) => void; onProvisioned: (text: string) => void }) {
  const [page, setPage] = useState<AdminPage | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [search, setSearch] = useState("");
  const [searchReady, setSearchReady] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showProvision, setShowProvision] = useState(false);
  const [fetchIndex, setFetchIndex] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchReady(search.trim());
      setPageNumber(1);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void listAdminAccounts(kind, token, { page: pageNumber, pageSize: 15, search: searchReady, status }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setPage(result);
      setError("");
    }).catch((loadError: unknown) => {
      if (!controller.signal.aborted) setError(fallbackError(loadError, `${kindLabel[kind].toLowerCase()} directory`));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [kind, token, pageNumber, searchReady, status, revision, fetchIndex]);
  const start = page && page.total > 0 ? (page.page - 1) * page.pageSize + 1 : 0;
  const end = page ? Math.min(page.page * page.pageSize, page.total) : 0;
  const title = kind === "vendors" ? "Shop / vendor" : kind === "customers" ? "Customer" : "Delivery partner";
  const resetStatus = (value: string) => { setStatus(value); setPageNumber(1); };
  return <>
    {kind === "delivery-partners" && <section className="lb-admin-panel lb-admin-provision">
      <div className="lb-admin-panel-head"><div><h2>Provision a partner login</h2><span className="lb-admin-secondary">Creates a Delivery Partner account through the existing secure flow.</span></div><button className={`lb-admin-button ${showProvision ? "" : "primary"}`} type="button" onClick={() => setShowProvision((current) => !current)}>{showProvision ? "Close form" : "Add partner"}</button></div>
      {showProvision && <ProvisionForm token={token} onCancel={() => setShowProvision(false)} onComplete={(text) => { setShowProvision(false); setSearch(""); setSearchReady(""); setStatus(""); setPageNumber(1); onProvisioned(text); setFetchIndex((value) => value + 1); }} />}
    </section>}
    {kind === "vendors" && <section className="lb-admin-panel lb-admin-provision">
      <div className="lb-admin-panel-head"><div><h2>Create a vendor & store</h2><span className="lb-admin-secondary">Provision a login and complete neighborhood store profile.</span></div><button className={`lb-admin-button ${showProvision ? "" : "primary"}`} type="button" onClick={() => setShowProvision((current) => !current)}>{showProvision ? "Close form" : "Add vendor"}</button></div>
      {showProvision && <VendorProvisionForm token={token} onCancel={() => setShowProvision(false)} onComplete={(text) => { setShowProvision(false); setSearch(""); setSearchReady(""); setStatus(""); setPageNumber(1); onProvisioned(text); setFetchIndex((value) => value + 1); }} />}
    </section>}
    {kind === "delivery-partners" && <AdminDailyReports token={token} partners={page?.items ?? []} />}
    <div className="lb-admin-toolbar" style={{ marginTop: kind === "delivery-partners" ? 20 : 0 }}>
      <label className="lb-admin-search-wrap"><span className="lb-admin-search-icon" aria-hidden="true">⌕</span><input className="lb-admin-search" type="search" placeholder={`Search ${kindLabel[kind].toLowerCase()}…`} aria-label={`Search ${kindLabel[kind].toLowerCase()}`} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <select aria-label="Filter by status" value={status} onChange={(event) => resetStatus(event.target.value)}>{statusOptions[kind].map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
      <button className="lb-admin-button" type="button" disabled={loading} onClick={() => setFetchIndex((value) => value + 1)}>{loading ? "Loading…" : "Refresh"}</button>
    </div>
    {error && <div className="lb-admin-message error" role="alert">{error}<button className="lb-admin-row-action" type="button" onClick={() => setFetchIndex((value) => value + 1)}>Try again</button></div>}
    <section className="lb-admin-panel">
      {loading && !page ? <div className="lb-admin-loading" aria-label={`Loading ${kindLabel[kind]}`}><div className="lb-admin-skeleton" /><div className="lb-admin-skeleton" /><div className="lb-admin-skeleton" /></div> : error && !page ? <div className="lb-admin-empty"><strong>Directory could not be loaded</strong>Retry to check your permission and connection.</div> : page && page.items.length === 0 ? <div className="lb-admin-empty"><strong>No {kindLabel[kind].toLowerCase()} found</strong>{searchReady || status ? "Adjust the search or status filter and try again." : `No ${kindLabel[kind].toLowerCase()} are available yet.`}</div> : page && <>
        <div className="lb-admin-table-wrap"><table className="lb-admin-table"><thead><tr><th>{title}</th>{kind === "vendors" && <><th>Owner</th><th>Location</th><th>Store status</th><th>Documents</th></>}<th>{kind === "delivery-partners" || kind === "vendors" ? "Username" : "Email / username"}</th><th>Created</th><th>Status</th><th aria-label="Actions" /></tr></thead><tbody>
          {page.items.map((row) => <AccountRow key={row.id} kind={kind} row={row} token={token} onOpen={() => onOpen(kind, row.id)} />)}
        </tbody></table></div>
        <div className="lb-admin-pagination"><span>Showing {start}–{end} of {page.total.toLocaleString("en-IN")} · Page {page.page} of {Math.max(1, Math.ceil(page.total / page.pageSize))}</span><div className="lb-admin-page-actions"><button type="button" disabled={loading || page.page <= 1} onClick={() => setPageNumber((current) => Math.max(1, current - 1))}>Previous</button><button type="button" disabled={loading || page.page * page.pageSize >= page.total} onClick={() => setPageNumber((current) => current + 1)}>Next</button></div></div>
      </>}
    </section>
  </>;
}

function AdminDailyReports({ token, partners }: { token: string; partners: AdminRow[] }) {
  const [date, setDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const [partnerId, setPartnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [partnerOptions, setPartnerOptions] = useState<AdminRow[]>(partners);
  useEffect(() => {
    const controller = new AbortController();
    void listAdminAccounts("delivery-partners", token, { page: 1, pageSize: 100, search: "", status: "" }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPartnerOptions(result.items); })
      .catch(() => { if (!controller.signal.aborted) setPartnerOptions(partners); });
    return () => controller.abort();
  }, [token]);
  const download = async () => {
    if (!date || busy) return;
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ date });
      if (partnerId) query.set("partnerId", partnerId);
      const response = await fetch(apiUrl(`/api/admin/reports/deliveries/daily.pdf?${query}`), { credentials: "same-origin", headers: apiAuthorizationHeaders(token) });
      if (!response.ok) {
        const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(payload?.error || `Report download failed (${response.status}).`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = `delivery-report-${date}${partnerId ? "-partner" : "-all"}.pdf`;
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Daily report could not be downloaded."); }
    finally { setBusy(false); }
  };
  return <section className="lb-admin-panel lb-admin-daily-reports">
    <div className="lb-admin-panel-head"><div><h2>Daily delivery reports</h2><span className="lb-admin-secondary">Use Asia/Kolkata dates. Choose all partners or an individual partner.</span></div></div>
    <div className="lb-admin-report-controls">
      <label>Delivery date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label>Partner<select value={partnerId} onChange={(event) => setPartnerId(event.target.value)}><option value="">All partners · consolidated</option>{partnerOptions.map((partner) => <option value={partner.id} key={partner.id}>{partner.displayName || partner.username || partner.id}</option>)}</select></label>
      <button className="lb-admin-button primary" type="button" disabled={!date || busy} onClick={() => void download()}>{busy ? "Preparing PDF…" : "Download PDF"}</button>
    </div>
    {error && <div className="lb-admin-message error" role="alert">{error}<button className="lb-admin-row-action" type="button" onClick={() => void download()}>Retry</button></div>}
  </section>;
}

function AccountRow({ kind, row, token, onOpen }: { kind: AdminKind; row: AdminRow; token: string; onOpen: () => void }) {
  const display = row.displayName || row.username || row.email || "Unnamed account";
  const storeStatus = kind === "vendors" ? row.status : null;
  const accountStatus = kind === "vendors" ? (row.storeId ? row.status : null) : row.status;
  return <tr>
    <td data-label={kind === "vendors" ? "Shop / vendor" : "Account"}><span className="lb-admin-person">{kind === "vendors" ? row.storeName || "Not linked" : display}</span><span className="lb-admin-secondary">{kind === "vendors" ? [row.locality, row.city, row.pincode].filter(Boolean).join(" · ") || "Location not provided" : row.username ? `@${row.username}` : "Account"}</span></td>
    {kind === "vendors" && <><td data-label="Owner">{row.ownerName || "—"}</td><td data-label="Location">{[row.locality, row.city, row.pincode].filter(Boolean).join(", ") || "—"}</td></>}
    {kind === "vendors" && <td data-label="Store status"><StatusPill value={storeStatus} fallback={row.storeId ? "Unknown" : "Not linked"} /></td>}
    {kind === "vendors" && <td data-label="Documents"><DocumentVerificationPill value={row.documentVerificationStatus} /><VendorFssaiDirectoryCell vendorId={row.id} token={token} /></td>}
    <td data-label={kind === "customers" ? "Email / username" : "Username"}>{kind === "delivery-partners" || kind === "vendors" ? row.username || "—" : row.email || row.username || "—"}{kind !== "delivery-partners" && kind !== "vendors" && row.email && row.username && <span className="lb-admin-secondary">@{row.username}</span>}</td>
    <td data-label="Created">{formatDate(row.createdAt)}</td>
    <td data-label="Status"><StatusPill value={accountStatus} fallback={row.storeId || kind !== "vendors" ? "Unknown" : "Not linked"} /></td>
    <td data-label="Actions"><button className="lb-admin-row-action" type="button" onClick={onOpen}>View details</button></td>
  </tr>;
}
function VendorFssaiDirectoryCell({ vendorId, token }: { vendorId: string; token: string }) {
  const [expiry, setExpiry] = useState<{ date: string | null; status: string } | null>(null);
  useEffect(() => {
    let active = true;
    void getAdminVendorDocuments(vendorId, token).then((result) => {
      if (active && result.fssai) setExpiry({ date: result.fssai.expiryDate, status: result.fssai.status });
    }).catch(() => { if (active) setExpiry(null); });
    return () => { active = false; };
  }, [vendorId, token]);
  return <span className="lb-admin-secondary lb-admin-fssai-directory" data-testid={`vendor-fssai-summary-${vendorId}`}>
    FSSAI · {expiry ? `${expiry.status.replaceAll("_", " ")}${expiry.date ? ` · ${formatDate(expiry.date)}` : " · date unknown"}` : "Checking…"}
  </span>;
}
function StatusPill({ value, fallback }: { value: string | null; fallback: string }) {
  return <span className={`lb-admin-status ${statusClass(value)}`}>{value ? titleCaseStatus(value) : fallback}</span>;
}
function DocumentVerificationPill({ value }: { value: AdminRow["documentVerificationStatus"] }) {
  if (!value) return <span className="lb-admin-secondary">Not provided</span>;
  const label = value === "EXEMPT" ? "Review required" : value === "APPROVED" ? "Verified" : value.toLowerCase().replaceAll("_", " ");
  return <span className={`lb-admin-doc-directory-status lb-admin-doc-verification-${value.toLowerCase()}`}>{label}</span>;
}

function AccountDetail({ kind, account, token, busy, onStatus, onSaved }: { kind: AdminKind; account: AdminDetail; token: string; busy: boolean; onStatus: (status: string) => void; onSaved: () => void }) {
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const noVendorStore = kind === "vendors" && !account.storeId;
  const fields: Array<[string, string]> = [
    ["Display name", account.displayName || "—"],
    ["Email", account.email || "—"],
    ["Username", account.username ? `@${account.username}` : "—"],
    ["Contact number", account.contactNumber || "—"],
    ["Account ID", account.id],
    ["Created", formatDate(account.createdAt)],
  ];
  if (kind === "vendors") fields.splice(3, 0, ["Shop", account.store?.name || account.storeName || "Not linked"], ["Owner", account.ownerName || account.store?.ownerName || "—"], ["City", account.city || account.store?.city || "—"], ["Locality", account.locality || account.store?.locality || "—"], ["Pincode", account.pincode || account.store?.pincode || "—"], ["Store ID", account.storeId || "—"]);
  if (kind !== "vendors" && account.orderCount !== null) fields.push(["Order count", String(account.orderCount)]);
  if (kind === "delivery-partners") fields.push(["Active assignments", String(account.activeAssignments)]);
  return <>
    {kind === "vendors" && account.store && <form className="lb-admin-panel lb-admin-vendor-edit" onSubmit={async (event) => {
      event.preventDefault(); if (savingProfile) return;
      setSavingProfile(true); setProfileError("");
      const form = new FormData(event.currentTarget);
      const optional = (name: string) => String(form.get(name) ?? "").trim() || null;
      const latitudeRaw = String(form.get("latitude") ?? "").trim();
      const longitudeRaw = String(form.get("longitude") ?? "").trim();
      if (Boolean(latitudeRaw) !== Boolean(longitudeRaw)) { setProfileError("Enter both latitude and longitude, or leave both blank."); setSavingProfile(false); return; }
      try {
        await updateAdminVendor(account.id, token, {
          name: String(form.get("name") ?? "").trim(), ownerName: String(form.get("ownerName") ?? "").trim(),
          phone: optional("phone"), email: optional("email"), description: optional("description"),
          logoImageUrl: optional("logoImageUrl"), addressLine1: String(form.get("addressLine1") ?? "").trim(),
          addressLine2: optional("addressLine2"), locality: String(form.get("locality") ?? "").trim(),
          city: String(form.get("city") ?? "").trim(), state: String(form.get("state") ?? "").trim(),
          pincode: String(form.get("pincode") ?? "").trim(),
          latitude: latitudeRaw ? Number(latitudeRaw) : null,
          longitude: longitudeRaw ? Number(longitudeRaw) : null,
          deliveryFee: Number(form.get("deliveryFee") ?? 0), handlingFee: String(form.get("handlingFee") ?? "0"), minimumOrderValue: Number(form.get("minimumOrderValue") ?? 0),
          hours: readWeeklyHours(form),
        });
        onSaved();
      } catch (error) { setProfileError(vendorProfileError(error, "vendor profile update")); }
      finally { setSavingProfile(false); }
    }}>
      <div className="lb-admin-panel-head"><div><h3>Edit store profile</h3><span className="lb-admin-secondary">Login identity and status are managed separately.</span></div></div>
      <StoreProfileFields values={account.store} disabled={savingProfile} />
      <section className="lb-admin-hours-form lb-admin-edit-hours">
        <div className="lb-admin-form-section"><h3>Weekly operating hours</h3><p>Edit all seven days. Closed days do not include opening or closing times.</p></div>
        <WeeklyHoursFields hours={account.hours} disabled={savingProfile} />
      </section>
      {profileError && <div className="lb-admin-message error" role="alert">{profileError}</div>}
      <div className="lb-admin-provision-footer"><span className="lb-admin-note">Username and password cannot be changed here.</span><button className="lb-admin-button primary" type="submit" disabled={savingProfile}>{savingProfile ? "Saving…" : "Save profile"}</button></div>
    </form>}
    <div className="lb-admin-account-grid">
      {fields.map(([label, value]) => <div className="lb-admin-field" key={label}><label>{label}</label><input value={value} readOnly /></div>)}
      <div className="lb-admin-field"><label>{kind === "vendors" ? "Store status" : "Account status"}</label><input value={account.status ? titleCaseStatus(account.status) : noVendorStore ? "Not linked" : "Unknown"} readOnly /></div>
    </div>
    {kind === "delivery-partners" && account.activeAssignments > 0 && <div className="lb-admin-message notice" style={{ marginTop: 17 }}>This partner has {account.activeAssignments} active assignment{account.activeAssignments === 1 ? "" : "s"}. Deactivation preserves existing duties and blocks partner operations; this portal will not cancel or reassign work.</div>}
    {kind === "vendors" && account.store && <VendorDetailGroups account={account} />}
    {kind === "vendors" && <AdminVendorDocuments key={account.id} vendorId={account.id} token={token} />}
    {kind === "vendors" && account.hours && account.hours.length > 0 && <section className="lb-admin-panel lb-admin-detail-hours"><div className="lb-admin-panel-head"><h3>Operations · operating hours</h3></div><div>{account.hours.slice().sort((a,b) => a.dayOfWeek-b.dayOfWeek).map((hour) => <div className="lb-admin-hour-line" key={hour.dayOfWeek}><strong>{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][hour.dayOfWeek]}</strong><span>{hour.isClosed ? "Closed" : `${hour.opensAt?.slice(0,5) ?? "—"}–${hour.closesAt?.slice(0,5) ?? "—"}`}</span></div>)}</div></section>}
    {noVendorStore && <div className="lb-admin-message notice" style={{ marginTop: 17 }}>No store is linked to this vendor. Store status changes are unavailable until a store is associated.</div>}
    {!noVendorStore && account.allowedStatuses.length > 0 && <div className="lb-admin-detail-actions">{account.allowedStatuses.filter((status) => status !== account.status).map((status) => <button key={status} className={`lb-admin-button ${isDestructive(status) ? "danger" : "primary"}`} type="button" disabled={busy} onClick={() => onStatus(status)}>{busy ? "Updating…" : actionLabel(kind, account.status, status)}</button>)}</div>}
    {account.allowedStatuses.length === 0 && !noVendorStore && <p className="lb-admin-note" style={{ marginTop: 18 }}>No status changes are currently permitted for this account.</p>}
  </>;
}

function VendorDetailGroups({ account }: { account: AdminDetail }) {
  const store = account.store!;
  const line = [store.addressLine1, store.addressLine2, store.locality, store.city, store.state, store.pincode].filter(Boolean).join(", ");
  return <div className="lb-admin-vendor-groups">
    <section><h3>Owner</h3><p>{store.ownerName || account.ownerName || "—"} · {store.phone || account.contactNumber || "No mobile"} · {store.email || account.email || "No email"}</p></section>
    <section><h3>Store</h3><p>{store.name}</p><p>{store.description || "No store description provided."}</p>{store.logoImageUrl && <a href={store.logoImageUrl} target="_blank" rel="noreferrer">View store logo</a>}</section>
    <section><h3>Store location</h3><p>{line || "Store address not provided."}</p><p>Coordinates · {store.latitude != null && store.longitude != null ? `${store.latitude}, ${store.longitude}` : "Not provided"}</p><StoreLocationMap latitude={store.latitude} longitude={store.longitude} editable={false} /></section>
    <section><h3>Operations</h3><p>Delivery fee ₹{store.deliveryFee} · Handling fee ₹{store.handlingFee ?? "0.00"} · Minimum order ₹{store.minimumOrderValue}</p></section>
  </div>;
}
function actionLabel(kind: AdminKind, current: string | null, next: string) {
  if (kind === "vendors") {
    if (next === "ACTIVE" && current === "PENDING_APPROVAL") return "Approve store";
    if (next === "ACTIVE") return "Reactivate store";
    if (next === "SUSPENDED") return "Suspend store";
    if (next === "REJECTED") return "Reject store";
  }
  if (next === "ACTIVE") return current === "INACTIVE" ? "Reactivate access" : "Activate access";
  if (next === "INACTIVE") return "Deactivate access";
  return `Set ${titleCaseStatus(next)}`;
}

function VendorProvisionForm({ token, onCancel, onComplete }: { token: string; onCancel: () => void; onComplete: (text: string) => void }) {
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const clearSecrets = () => {
    if (passwordRef.current) passwordRef.current.value = "";
    if (confirmRef.current) confirmRef.current.value = "";
  };
  useEffect(() => () => clearSecrets(), []);
  const cancel = () => { clearSecrets(); onCancel(); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const usernameResult = usernameSchema.safeParse(String(form.get("username") ?? ""));
    const password = passwordRef.current?.value ?? "";
    const confirmPassword = confirmRef.current?.value ?? "";
    const passwordResult = partnerProvisionSchema.shape.password.safeParse(password);
    const phone = String(form.get("phone") ?? "").trim();
    const phoneResult = storeUpdateSchema.shape.phone.safeParse(phone || null);
    if (!usernameResult.success) { setError(usernameResult.error.issues[0]?.message || "Enter a valid username."); clearSecrets(); return; }
    if (!passwordResult.success) { setError(passwordResult.error.issues[0]?.message || "Password does not meet the existing policy."); clearSecrets(); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); clearSecrets(); return; }
    if (!phoneResult.success) { setError(phoneResult.error.issues[0]?.message || "Enter a valid Indian mobile number."); clearSecrets(); return; }
    const optional = (name: string) => String(form.get(name) ?? "").trim() || null;
    const latitudeRaw = String(form.get("latitude") ?? "").trim();
    const longitudeRaw = String(form.get("longitude") ?? "").trim();
    if (Boolean(latitudeRaw) !== Boolean(longitudeRaw)) { setError("Enter both latitude and longitude, or leave both blank."); return; }
    const hours = readWeeklyHours(form);
    setSaving(true); setError("");
    try {
      await createAdminVendor(token, {
        username: usernameResult.data, password,
        name: String(form.get("name") ?? "").trim(), ownerName: String(form.get("ownerName") ?? "").trim(),
        phone: phone || null, email: optional("email"), description: optional("description"), logoImageUrl: optional("logoImageUrl"),
        addressLine1: String(form.get("addressLine1") ?? "").trim(), addressLine2: optional("addressLine2"),
        locality: String(form.get("locality") ?? "").trim(), city: String(form.get("city") ?? "").trim(),
        state: String(form.get("state") ?? "").trim(), pincode: String(form.get("pincode") ?? "").trim(),
        latitude: latitudeRaw ? Number(latitudeRaw) : null,
        longitude: longitudeRaw ? Number(longitudeRaw) : null,
        deliveryFee: Number(form.get("deliveryFee") || 0), handlingFee: String(form.get("handlingFee") ?? "0"), minimumOrderValue: Number(form.get("minimumOrderValue") || 0),
        hours,
      });
      clearSecrets();
      onComplete(`Vendor “${usernameResult.data}” created and marked pending approval. The password is not shown or retained.`);
    } catch (createError) {
      setError(vendorProfileError(createError, "vendor creation"));
      clearSecrets();
    } finally {
      setSaving(false);
    }
  };
  return <form onSubmit={(event) => void submit(event)}>
    {error && <div className="lb-admin-message error" role="alert" style={{ margin: "15px 17px 0" }}>{error}</div>}
    <section className="lb-admin-form-block">
      <div className="lb-admin-form-section"><h3>Vendor login</h3><p>Credentials are used only to provision the secure vendor account. <span className="lb-required-note">* Required</span></p></div>
      <div className="lb-admin-provision-grid">
        <div className="lb-admin-field"><label htmlFor="vendor-create-username">Username <span className="lb-required-mark" aria-hidden="true">*</span></label><input id="vendor-create-username" name="username" autoComplete="off" maxLength={30} required /></div>
        <div className="lb-admin-field"><label htmlFor="vendor-create-password">Password <span className="lb-required-mark" aria-hidden="true">*</span></label><input id="vendor-create-password" ref={passwordRef} type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></div>
        <div className="lb-admin-field"><label htmlFor="vendor-create-confirm">Confirm password <span className="lb-required-mark" aria-hidden="true">*</span></label><input id="vendor-create-confirm" ref={confirmRef} type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></div>
      </div>
    </section>
    <section className="lb-admin-form-block">
      <StoreProfileFields disabled={saving} />
    </section>
    <section className="lb-admin-form-block lb-admin-hours-form">
      <div className="lb-admin-form-section"><h3>Weekly operations</h3><p>Set the store’s opening hours. Closed is the default for each day.</p></div>
      <WeeklyHoursFields disabled={saving} />
    </section>
    <div className="lb-admin-provision-footer"><p className="lb-admin-note">New stores start in Pending approval. No catalog items are added automatically.</p><div style={{ display: "flex", gap: 8 }}><button className="lb-admin-button" type="button" onClick={cancel} disabled={saving}>Cancel</button><button className="lb-admin-button primary" type="submit" disabled={saving}>{saving ? "Creating vendor…" : "Create vendor"}</button></div></div>
  </form>;
}

function ProvisionForm({ token, onCancel, onComplete }: { token: string; onCancel: () => void; onComplete: (text: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [status, setStatus] = useState<AccountStatus>("ACTIVE");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const reset = () => { setPassword(""); setUsername(""); setDisplayName(""); setContactNumber(""); setStatus("ACTIVE"); setError(""); };
  const cancel = () => { reset(); onCancel(); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!/^[A-Za-z][A-Za-z0-9_]{2,29}$/.test(username)) {
      setError("Username must be 3–30 characters, start with a letter, and contain only letters, numbers, or underscores.");
      return;
    }
    setSaving(true);
    try {
      await createAdminPartner(token, { username, password, displayName: displayName.trim(), contactNumber: contactNumber.trim() || undefined, status });
      reset();
      onComplete(`Delivery partner account “${username}” created. The temporary password is not shown or retained.`);
    } catch (createError) {
      setError(fallbackError(createError, "partner provisioning"));
    } finally {
      setPassword("");
      setSaving(false);
    }
  };
  return <form onSubmit={(event) => void submit(event)}>
    {error && <div className="lb-admin-message error" role="alert" style={{ margin: "15px 17px 0" }}>{error}</div>}
    <div className="lb-admin-provision-grid">
      <div className="lb-admin-field"><label htmlFor="lb-admin-new-username">Username</label><input id="lb-admin-new-username" autoComplete="off" maxLength={30} value={username} onChange={(event) => setUsername(event.target.value)} required pattern="[A-Za-z][A-Za-z0-9_]{2,29}" title="3–30 characters; start with a letter; letters, numbers, and underscore only." /></div>
      <div className="lb-admin-field"><label htmlFor="lb-admin-new-password">Temporary password</label><input id="lb-admin-new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
      <div className="lb-admin-field"><label htmlFor="lb-admin-new-name">Display name</label><input id="lb-admin-new-name" maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></div>
      <div className="lb-admin-field"><label htmlFor="lb-admin-new-contact">Contact number · optional</label><input id="lb-admin-new-contact" type="tel" autoComplete="off" value={contactNumber} onChange={(event) => setContactNumber(event.target.value)} /></div>
      <div className="lb-admin-field wide"><label htmlFor="lb-admin-new-status">Initial access</label><select id="lb-admin-new-status" value={status} onChange={(event) => setStatus(event.target.value as AccountStatus)}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
    </div>
    <div className="lb-admin-provision-footer"><p className="lb-admin-note">Username reservations and password policy are enforced by the existing provisioning service. Password is sent only for account creation.</p><div style={{ display: "flex", gap: 8 }}><button className="lb-admin-button" type="button" onClick={cancel} disabled={saving}>Cancel</button><button className="lb-admin-button primary" type="submit" disabled={saving}>{saving ? "Creating account…" : "Create partner"}</button></div></div>
  </form>;
}

function ProfileCard({ email, userId }: { email: string; userId: string }) {
  const initials = useMemo(() => email.split("@")[0].slice(0, 2).toUpperCase() || "AD", [email]);
  return <section className="lb-admin-panel">
    <div className="lb-admin-panel-head"><h2>Signed-in identity</h2><span className="lb-admin-status active">Verified admin</span></div>
    <div className="lb-admin-profile-card"><div className="lb-admin-avatar" aria-hidden="true">{initials}</div><div><h2>Platform administrator</h2><p>{email}</p></div></div>
    <div className="lb-admin-profile-details"><div><span>Email address</span><strong>{email}</strong></div><div><span>Application role</span><strong>Administrator</strong></div><div><span>Account identifier</span><strong className="mono">{userId}</strong></div><div><span>Credentials</span><strong>Managed securely by Supabase</strong></div></div>
  </section>;
}