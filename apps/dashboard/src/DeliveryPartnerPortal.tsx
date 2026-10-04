import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PartnerDashboardOutcome, PartnerDeliveriesOutcome, PartnerProfileOutcome } from "../../../lib/api-client-react/src/generated/api.schemas";
import { ApiRequestError, apiRequest } from "./api";
import "./partner.css";

type Props = { token: string; onSignOut: () => Promise<void> };
type Screen = "dashboard" | "deliveries" | "profile";
type DataState = { profile: PartnerProfileOutcome["partner"] | null; summary: PartnerDashboardOutcome["summary"] | null; deliveries: PartnerDeliveriesOutcome["deliveries"] | null };

const EMPTY: DataState = { profile: null, summary: null, deliveries: null };
const POLL_MS = 45_000;

function prettyStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" }).format(date);
}

export function DeliveryPartnerPortal({ token, onSignOut }: Props) {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [data, setData] = useState<DataState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [signingOut, setSigningOut] = useState(false);
  const activeController = useRef<AbortController | null>(null);
  const profileLoaded = useRef(false);

  const reload = useCallback(async (signal: AbortSignal) => {
    if (!token) return;
    try {
      const [profileResponse, dashboardResponse, deliveryResponse] = await Promise.all([
        apiRequest<PartnerProfileOutcome>("/api/delivery-partner/me", token, { signal }),
        apiRequest<PartnerDashboardOutcome>("/api/delivery-partner/dashboard", token, { signal }),
        apiRequest<PartnerDeliveriesOutcome>("/api/delivery-partner/deliveries", token, { signal }),
      ]);
      if (signal.aborted) return;
      if (profileResponse.partner.status !== "ACTIVE") {
        setData(EMPTY);
        profileLoaded.current = false;
        setDenied(true);
        setError("This partner account is inactive. Sign out and contact your administrator.");
        setLoading(false);
        return;
      }
      setData({ profile: profileResponse.partner, summary: dashboardResponse.summary, deliveries: deliveryResponse.deliveries });
      profileLoaded.current = true;
      setDenied(false);
      setError("");
    } catch (requestError) {
      if (signal.aborted) return;
      if (requestError instanceof ApiRequestError && (requestError.status === 401 || requestError.status === 403)) {
        setData(EMPTY);
        profileLoaded.current = false;
        setDenied(true);
        setError(requestError.status === 403 ? requestError.message : "Your partner session is no longer available. Sign out and sign in again.");
      } else {
        setError(profileLoaded.current ? "The portal could not refresh just now. Your last verified information is shown; try again shortly." : "The partner portal could not load your information. Check your connection and retry.");
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    activeController.current = controller;
    setData(EMPTY);
    profileLoaded.current = false;
    setError("");
    setDenied(false);
    setScreen("dashboard");
    setLoading(true);
    void reload(controller.signal);
    const timer = window.setInterval(() => { void reload(controller.signal); }, POLL_MS);
    return () => {
      controller.abort();
      if (activeController.current === controller) activeController.current = null;
      window.clearInterval(timer);
    };
  }, [token, reload]);

  const visibleDeliveries = useMemo(() => {
    const deliveries = data.deliveries ?? [];
    return filter === "ALL" ? deliveries : deliveries.filter((item) => item.status === filter);
  }, [data.deliveries, filter]);

  const signOut = async () => {
    activeController.current?.abort();
    activeController.current = null;
    setData(EMPTY);
    profileLoaded.current = false;
    setSigningOut(true);
    try { await onSignOut(); }
    catch { setError("Sign out could not be completed. Please try again."); }
    finally { setSigningOut(false); }
  };

  return (
    <main className="lbp">
      <div className="lbp-frame">
        <header className="lbp-topline">
          <div className="lbp-brand"><span className="lbp-mark" aria-hidden="true">LB</span><div className="lbp-brand-copy"><strong>Local Basket</strong><span>Delivery partner</span></div></div>
          <button className="lbp-button" data-testid="button-partner-logout" type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
        </header>
        <section className="lbp-heading-row">
          <div><p className="lbp-kicker">Partner workspace</p><h1 className="lbp-title">{screen === "dashboard" ? "Good day, " + (data.profile?.displayName || "partner") + "." : screen === "deliveries" ? "My deliveries" : "Your profile"}</h1><p className="lbp-subtitle">{screen === "dashboard" ? "A clear view of today's delivery activity." : screen === "deliveries" ? "Status and timing only. Customer and order details are not shown here." : "Your partner details are managed by Local Basket administration."}</p></div>
          <div className="lbp-top-actions"><span className={`lbp-status ${data.profile?.status === "INACTIVE" ? "lbp-status-inactive" : ""}`} data-testid="status-partner-account">{data.profile ? prettyStatus(data.profile.status) : "Account check"}</span></div>
        </section>
        <nav className="lbp-nav" aria-label="Partner navigation">
          {(["dashboard", "deliveries", "profile"] as const).map((tab) => <button key={tab} className="lbp-tab" aria-current={screen === tab ? "page" : undefined} data-testid={`tab-partner-${tab}`} onClick={() => setScreen(tab)} type="button">{tab === "dashboard" ? "Dashboard" : tab === "deliveries" ? "My deliveries" : "Profile"}</button>)}
        </nav>
        {error && <div className={`lbp-alert ${!denied ? "lbp-alert-info" : ""}`} role="alert" data-testid="status-partner-portal-error">{error}{denied ? <div style={{ marginTop: 10 }}><button className="lbp-button" type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button></div> : <div style={{ marginTop: 10 }}><button className="lbp-button" type="button" onClick={() => { const signal = activeController.current?.signal; if (signal && !signal.aborted) { setLoading(!data.profile); void reload(signal); } }} disabled={loading}>{loading ? "Retrying…" : "Try again"}</button></div>}</div>}
        {loading && !data.profile ? <div aria-label="Loading partner workspace" data-testid="loading-partner-workspace"><div className="lbp-skeleton" /><div className="lbp-skeleton" /></div> : denied ? <div className="lbp-empty"><strong>Partner access unavailable</strong><span>Your private partner information has been cleared.</span></div> : screen === "dashboard" ? (
          <section className="lbp-overview" aria-label="Today's delivery summary">
            <div className="lbp-panel lbp-count-panel">
              <div className="lbp-count-head"><strong>Today's deliveries</strong><span className="lbp-date-note">Asia / Kolkata</span></div>
              <div className="lbp-total" data-testid="text-partner-total">{data.summary?.total ?? "—"}<div className="lbp-total-label">recorded for today</div></div>
              <div className="lbp-stats">
                {([["pending", "Pending"], ["assigned", "Assigned"], ["inProgress", "In progress"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["rejected", "Rejected"]] as const).map(([key, label]) => <div className="lbp-stat" key={key} data-testid={`stat-partner-${key}`}><span className="lbp-stat-value">{data.summary?.[key] ?? "—"}</span><span className="lbp-stat-label">{label}</span></div>)}
              </div>
            </div>
            <aside className="lbp-aside-card"><div><p className="lbp-kicker">At a glance</p><h2>Keep the day moving, one delivery at a time.</h2></div><p>Updates are checked automatically every 45 seconds. Delivery assignments are managed separately.</p></aside>
          </section>
        ) : screen === "deliveries" ? (
          <section className="lbp-panel lbp-content-panel">
            <div className="lbp-section-head"><h2>Delivery activity</h2><label className="lbp-filter">Filter <select className="lbp-admin-status" aria-label="Filter deliveries by status" data-testid="select-delivery-status" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="ALL">All statuses</option>{Array.from(new Set((data.deliveries ?? []).map((item) => item.status))).sort().map((status) => <option key={status} value={status}>{prettyStatus(status)}</option>)}</select></label></div>
            {visibleDeliveries.length ? <div className="lbp-delivery-list">{visibleDeliveries.map((delivery) => <article className="lbp-delivery-row" key={delivery.id} data-testid={`row-delivery-${delivery.id}`}><div><div className="lbp-delivery-ref">Delivery · {delivery.id.slice(0, 8)}</div><div className="lbp-delivery-time">Updated {dateTime(delivery.updatedAt)}</div></div><div className="lbp-delivery-time">Created {dateTime(delivery.createdAt)}</div><span className={`lbp-status lbp-status-${delivery.status.toLowerCase()}`}>{prettyStatus(delivery.status)}</span></article>)}</div> : <div className="lbp-empty"><strong>{filter === "ALL" ? "No deliveries assigned yet" : "No deliveries in this status"}</strong><span>{filter === "ALL" ? "When delivery activity is recorded, it will appear here." : "Try another status filter to see delivery activity."}</span></div>}
          </section>
        ) : (
          <section className="lbp-panel lbp-content-panel">
            <div className="lbp-section-head"><h2>Partner details</h2><span className="lbp-date-note">Read only</span></div>
            <div className="lbp-profile-grid">
              <div className="lbp-profile-item"><span>Display name</span><strong data-testid="text-partner-display-name">{data.profile?.displayName || "—"}</strong></div>
              <div className="lbp-profile-item"><span>Username</span><strong data-testid="text-partner-profile-username">{data.profile?.username || "—"}</strong></div>
              <div className="lbp-profile-item"><span>Contact number</span><strong data-testid="text-partner-contact-number">{data.profile?.contactNumber || "Not provided"}</strong></div>
              <div className="lbp-profile-item"><span>Account status</span><strong>{data.profile ? prettyStatus(data.profile.status) : "—"}</strong></div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}