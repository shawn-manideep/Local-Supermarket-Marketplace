import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeliveryAssignment, DeliveryAssignmentOutcome, PartnerDashboardOutcome, PartnerDeliveriesOutcome, PartnerProfileOutcome } from "../../../lib/api-client-react/src/generated/api.schemas";
import { ApiRequestError, apiRequest } from "./api";
import "./partner.css";

type Props = { token: string; onSignOut: () => Promise<void> };
type Screen = "dashboard" | "deliveries" | "profile";
type DataState = { profile: PartnerProfileOutcome["partner"] | null; summary: PartnerDashboardOutcome["summary"] | null; deliveries: PartnerDeliveriesOutcome["deliveries"] | null };

const EMPTY: DataState = { profile: null, summary: null, deliveries: null };
const POLL_MS = 45_000;
type PartnerAction = "ACCEPT" | "REJECT" | "PICKUP" | "START" | "DELIVER";
const deliveryActions: Partial<Record<DeliveryAssignment["status"], Array<{ action: PartnerAction; label: string }>>> = {
  PENDING: [{ action: "ACCEPT", label: "Accept delivery" }, { action: "REJECT", label: "Reject delivery" }],
  ACCEPTED: [{ action: "PICKUP", label: "Mark picked up" }],
  PICKED_UP: [{ action: "START", label: "Start delivery" }],
  OUT_FOR_DELIVERY: [{ action: "DELIVER", label: "Mark delivered" }],
};

function prettyStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" }).format(date);
}

function snapshotAddress(value: DeliveryAssignment["deliveryAddress"]) {
  if (!value || typeof value !== "object") return "";
  const fields = value as Record<string, unknown>;
  return ["line1", "line2", "city", "state", "pincode"]
    .map((key) => typeof fields[key] === "string" ? (fields[key] as string).trim() : "")
    .filter(Boolean)
    .join(", ");
}

export function DeliveryPartnerPortal({ token, onSignOut }: Props) {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [data, setData] = useState<DataState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [signingOut, setSigningOut] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<DeliveryAssignment | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [actionPending, setActionPending] = useState<PartnerAction | null>(null);
  const [actionError, setActionError] = useState("");
  const [rejectConfirmation, setRejectConfirmation] = useState(false);
  const activeController = useRef<AbortController | null>(null);
  const profileLoaded = useRef(false);
  const actionGate = useRef(false);
  const detailGeneration = useRef(0);
  const selectedDeliveryId = useRef<string | null>(null);
  const scopeRef = useRef(token);
  scopeRef.current = token;

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
        setSelectedDelivery(null);
        selectedDeliveryId.current = null;
        profileLoaded.current = false;
        setDenied(true);
        setError("This partner account is inactive. Sign out and contact your administrator.");
        setLoading(false);
        return;
      }
      setData({ profile: profileResponse.partner, summary: dashboardResponse.summary, deliveries: deliveryResponse.deliveries });
      setSelectedDelivery((selected) => selected
        ? deliveryResponse.deliveries.find((delivery) => delivery.id === selected.id) ?? selected
        : null);
      profileLoaded.current = true;
      setDenied(false);
      setError("");
    } catch (requestError) {
      if (signal.aborted) return;
      if (requestError instanceof ApiRequestError && (requestError.status === 401 || requestError.status === 403)) {
        setData(EMPTY);
        setSelectedDelivery(null);
        selectedDeliveryId.current = null;
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
    setSelectedDelivery(null);
    selectedDeliveryId.current = null;
    ++detailGeneration.current;
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

  const openDelivery = async (id: string) => {
    const signal = activeController.current?.signal;
    if (!signal || signal.aborted) return;
    const generation = ++detailGeneration.current;
    selectedDeliveryId.current = id;
    const summaryRow = (data.deliveries ?? []).find((delivery) => delivery.id === id);
    if (summaryRow) setSelectedDelivery(summaryRow);
    setDetailLoading(true);
    setDetailError("");
    setActionError("");
    try {
      const response = await apiRequest<DeliveryAssignmentOutcome>(`/api/delivery-partner/deliveries/${encodeURIComponent(id)}`, token, { signal });
      if (!signal.aborted && scopeRef.current === token && generation === detailGeneration.current) {
        setSelectedDelivery(response.assignment ?? summaryRow ?? null);
        if (!response.assignment) setDetailError("This delivery is no longer available.");
      }
    } catch (cause) {
      if (signal.aborted || scopeRef.current !== token || generation !== detailGeneration.current) return;
      if (cause instanceof ApiRequestError && (cause.status === 401 || cause.status === 403)) {
        setData(EMPTY);
        setSelectedDelivery(null);
        selectedDeliveryId.current = null;
        setDenied(true);
        setError(cause.status === 403 ? cause.message : "Your partner session is no longer available. Sign out and sign in again.");
      } else setDetailError("Delivery details could not be loaded. Refresh and try again.");
    } finally {
      if (!signal.aborted && scopeRef.current === token && generation === detailGeneration.current) setDetailLoading(false);
    }
  };

  const refreshSelectedDelivery = async (id: string, signal: AbortSignal) => {
    const response = await apiRequest<DeliveryAssignmentOutcome>(`/api/delivery-partner/deliveries/${encodeURIComponent(id)}`, token, { signal });
    if (!signal.aborted && scopeRef.current === token) {
      if (selectedDeliveryId.current === id) setSelectedDelivery(response.assignment);
      if (!response.assignment) {
        if (selectedDeliveryId.current === id) selectedDeliveryId.current = null;
        setData((current) => ({ ...current, deliveries: (current.deliveries ?? []).filter((row) => row.id !== id) }));
        return;
      }
      const assignment = response.assignment;
      setData((current) => ({
        ...current,
        deliveries: (current.deliveries ?? []).map((row) => row.id === assignment.id ? assignment : row),
      }));
    }
  };

  const performAction = async (action: PartnerAction) => {
    const current = selectedDelivery;
    const signal = activeController.current?.signal;
    if (!current || !signal || signal.aborted || actionGate.current || !deliveryActions[current.status]?.some((item) => item.action === action)) return;
    actionGate.current = true;
    setActionPending(action);
    setActionError("");
    try {
      await apiRequest<DeliveryAssignmentOutcome>(`/api/delivery-partner/deliveries/${encodeURIComponent(current.id)}/actions`, token, {
        method: "POST", body: JSON.stringify({ action }), signal,
      });
      await refreshSelectedDelivery(current.id, signal);
      await reload(signal);
    } catch (cause) {
      if (!signal.aborted && scopeRef.current === token) {
        const deniedRequest = cause instanceof ApiRequestError && (cause.status === 401 || cause.status === 403);
        if (deniedRequest) {
          setData(EMPTY);
          setSelectedDelivery(null);
          selectedDeliveryId.current = null;
          setDenied(true);
          setError(cause.status === 403 ? cause.message : "Your partner session is no longer available. Sign out and sign in again.");
        } else setActionError("That update could not be confirmed. We refreshed the delivery; review its current status before trying again.");
        try {
          await refreshSelectedDelivery(current.id, signal);
          await reload(signal);
        } catch {
          if (!signal.aborted && scopeRef.current === token) setDetailError("The latest delivery status is unavailable. Retry before taking another action.");
        }
      }
    } finally {
      actionGate.current = false;
      if (!signal.aborted && scopeRef.current === token) setActionPending(null);
    }
  };

  const signOut = async () => {
    activeController.current?.abort();
    activeController.current = null;
    setData(EMPTY);
    setSelectedDelivery(null);
    selectedDeliveryId.current = null;
    ++detailGeneration.current;
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
                {([["pending", "Pending"], ["accepted", "Accepted"], ["pickedUp", "Picked up"], ["outForDelivery", "Out for delivery"], ["delivered", "Delivered"], ["assigned", "Assigned"], ["inProgress", "In progress"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["rejected", "Rejected"]] as const).map(([key, label]) => <div className="lbp-stat" key={key} data-testid={`stat-partner-${key}`}><span className="lbp-stat-value">{data.summary?.[key] ?? "—"}</span><span className="lbp-stat-label">{label}</span></div>)}
              </div>
            </div>
          <aside className="lbp-aside-card"><div><p className="lbp-kicker">At a glance</p><h2>Keep the day moving, one delivery at a time.</h2></div><p>Updates are checked automatically every 45 seconds. Open an assignment to review its route and take the next step.</p></aside>
          </section>
        ) : screen === "deliveries" && selectedDelivery ? (
          <section className="lbp-panel lbp-content-panel">
            <div className="lbp-section-head lbp-delivery-detail-head">
              <div><p className="lbp-kicker">Assigned delivery</p><h2>{selectedDelivery.orderReference}</h2></div>
              <div className="lbp-detail-controls">
                <button className="lbp-button lbp-button-quiet" type="button" disabled={detailLoading || !!actionPending} onClick={() => void openDelivery(selectedDelivery.id)}>{detailLoading ? "Refreshing…" : "Refresh details"}</button>
                <button className="lbp-button lbp-button-quiet" type="button" onClick={() => { selectedDeliveryId.current = null; ++detailGeneration.current; setSelectedDelivery(null); setDetailError(""); setActionError(""); }}>Back to deliveries</button>
              </div>
            </div>
            {!!detailError && <div className="lbp-alert" role="alert">{detailError}<button className="lbp-button" type="button" onClick={() => void openDelivery(selectedDelivery.id)}>Retry details</button></div>}
            {!!actionError && <div className="lbp-alert" role="alert" data-testid="delivery-action-error">{actionError}</div>}
            {detailLoading ? <div className="lbp-skeleton" aria-label="Loading delivery details" /> : (
              <>
                <div className="lbp-delivery-detail-grid">
                  <div className="lbp-delivery-detail-item"><span>Status</span><strong className={`lbp-status lbp-status-${selectedDelivery.status.toLowerCase()}`}>{prettyStatus(selectedDelivery.status)}</strong></div>
                  <div className="lbp-delivery-detail-item"><span>Store</span><strong>{selectedDelivery.storeName}</strong></div>
                  <div className="lbp-delivery-detail-item"><span>Order status</span><strong>{prettyStatus(selectedDelivery.orderStatus)}</strong></div>
                  <div className="lbp-delivery-detail-item"><span>Order total</span><strong>₹{Number(selectedDelivery.orderTotal).toFixed(2)}</strong></div>
                  <div className="lbp-delivery-detail-item"><span>Recipient</span><strong>{selectedDelivery.recipientName || "Not provided"}</strong></div>
                  <div className="lbp-delivery-detail-item lbp-address-item"><span>Delivery address</span><strong>{snapshotAddress(selectedDelivery.deliveryAddress) || "Address not available"}</strong></div>
                </div>
                  {deliveryActions[selectedDelivery.status]?.length ? <div className="lbp-duty-actions">
                  <span className="lbp-duty-caption">Next step</span>
                  {deliveryActions[selectedDelivery.status]!.map(({ action, label }) => <button key={action} className={action === "REJECT" ? "lbp-button lbp-button-danger" : "lbp-button lbp-button-primary"} type="button" disabled={!!actionPending || detailLoading || !!detailError} data-testid={`button-delivery-action-${action.toLowerCase()}`} onClick={() => action === "REJECT" ? setRejectConfirmation(true) : void performAction(action)}>{actionPending === action ? "Updating…" : label}</button>)}
                </div> : <p className="lbp-terminal-note">This assignment has no further actions.</p>}
              </>
            )}
            {rejectConfirmation && <div className="lbp-confirm-scrim"><div className="lbp-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delivery-reject-title" aria-describedby="delivery-reject-description">
              <p className="lbp-kicker">Confirm decision</p><h3 id="delivery-reject-title">Reject this delivery?</h3><p id="delivery-reject-description">This assignment will be closed and returned to the store for reassignment.</p>
              <div><button className="lbp-button lbp-button-quiet" type="button" disabled={!!actionPending} onClick={() => setRejectConfirmation(false)}>Keep delivery</button><button className="lbp-button lbp-button-danger" type="button" disabled={!!actionPending || !!detailError} onClick={() => { setRejectConfirmation(false); void performAction("REJECT"); }}>{actionPending === "REJECT" ? "Updating…" : "Reject delivery"}</button></div>
            </div></div>}
          </section>
        ) : screen === "deliveries" ? (
          <section className="lbp-panel lbp-content-panel">
            <div className="lbp-section-head"><h2>Delivery activity</h2><label className="lbp-filter">Filter <select className="lbp-admin-status" aria-label="Filter deliveries by status" data-testid="select-delivery-status" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="ALL">All statuses</option>{Array.from(new Set((data.deliveries ?? []).map((item) => item.status))).sort().map((status) => <option key={status} value={status}>{prettyStatus(status)}</option>)}</select></label></div>
            {visibleDeliveries.length ? <div className="lbp-delivery-list">{visibleDeliveries.map((delivery) => <article className="lbp-delivery-row" key={delivery.id}><div><div className="lbp-delivery-ref">{delivery.orderReference}</div><div className="lbp-delivery-time">{delivery.storeName} · Updated {dateTime(delivery.updatedAt)}</div></div><span className={`lbp-status lbp-status-${delivery.status.toLowerCase()}`}>{prettyStatus(delivery.status)}</span><button className="lbp-button lbp-button-quiet lbp-open-delivery" type="button" onClick={() => void openDelivery(delivery.id)}>View delivery</button></article>)}</div> : <div className="lbp-empty"><strong>{filter === "ALL" ? "No deliveries assigned yet" : "No deliveries in this status"}</strong><span>{filter === "ALL" ? "When delivery activity is recorded, it will appear here." : "Try another status filter to see delivery activity."}</span></div>}
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