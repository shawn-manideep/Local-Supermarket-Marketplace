import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeliveryAssignment, DeliveryAssignmentOutcome, PartnerDashboardOutcome, PartnerDeliveriesOutcome, PartnerProfileOutcome } from "../../../lib/api-client-react/src/generated/api.schemas";
import { ApiRequestError, apiAuthorizationHeaders, apiRequest, apiUrl } from "./api";
import "./partner.css";
import { BrandingLogo } from "./BrandingLogo";
import { runRefreshEventStream } from "./refresh-event-stream";
import { PortalResourceMenu, PortalResourcePage, type PortalResourceId } from "./PortalResources";
import { portalResourceIntro, portalResourceTitle } from "./portal-resource-content";

type Props = { token: string; onSignOut: () => Promise<void> };
type Screen = "dashboard" | "deliveries" | "profile" | PortalResourceId;
type DataState = { profile: PartnerProfileOutcome["partner"] | null; summary: PartnerDashboardOutcome["summary"] | null; deliveries: PartnerDeliveriesOutcome["deliveries"] | null };
type AvailableOffer = { orderId: string; orderReference: string; storeId: string; storeName: string; orderTotal: string | number; deliveryMode: "INSTANT" | "SCHEDULED"; scheduledStartAt?: string | null; scheduledEndAt?: string | null };

const EMPTY: DataState = { profile: null, summary: null, deliveries: null };
const POLL_MS = 45_000;
const OFFER_POLL_MS = 12_000;
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

function isPortalResourceScreen(screen: Screen): screen is PortalResourceId {
  return screen === "help" || screen === "privacy" || screen === "accountPrivacy" || screen === "terms";
}

function timeOfDay() {
  const hour = Number(new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone: "Asia/Kolkata",
  }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" }).format(date);
}

type ScheduleFields = { deliveryMode?: "INSTANT" | "SCHEDULED"; scheduledStartAt?: string | null; scheduledEndAt?: string | null };
function scheduleFields(delivery: DeliveryAssignment): ScheduleFields {
  return delivery as DeliveryAssignment & ScheduleFields;
}
function scheduledLabel(delivery: DeliveryAssignment) {
  const { deliveryMode, scheduledStartAt, scheduledEndAt } = scheduleFields(delivery);
  if (deliveryMode !== "SCHEDULED" || !scheduledStartAt || !scheduledEndAt) return "Instant delivery";
  const start = new Date(scheduledStartAt);
  const end = new Date(scheduledEndAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Scheduled delivery";
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(start);
  const time = (value: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(value);
  return `Scheduled delivery · ${day} · ${time(start)}–${time(end)} IST`;
}
function waitForScheduledStart(delivery: DeliveryAssignment) {
  const { deliveryMode, scheduledStartAt } = scheduleFields(delivery);
  return deliveryMode === "SCHEDULED" && Boolean(scheduledStartAt) && Date.now() < new Date(scheduledStartAt!).getTime();
}
function todayInIndia() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
async function savePdf(path: string, token: string, fileName: string) {
  const response = await fetch(apiUrl(path), { credentials: "same-origin", headers: apiAuthorizationHeaders(token) });
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
    throw new Error(payload?.error || `Report download failed (${response.status}).`);
  }
  const blob = await response.blob();
  if (!blob.size || (response.headers.get("Content-Type") || "").toLowerCase().includes("application/json"))
    throw new Error("The report could not be generated. Please retry.");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
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
  const [offers, setOffers] = useState<AvailableOffer[]>([]);
  const [claimedOffer, setClaimedOffer] = useState("");
  const claimGate = useRef(false);
  const [offerError, setOfferError] = useState("");
  const claimedOffers = useRef<Set<string>>(new Set());
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [savedPhoto, setSavedPhoto] = useState("");
  const [photoExists, setPhotoExists] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [photoCapturedAt, setPhotoCapturedAt] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const [reportDate, setReportDate] = useState(todayInIndia);
  const [reportBusy, setReportBusy] = useState(false);
  const photoUploadGate = useRef(false);
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

  useEffect(() => {
    const controller = new AbortController();
    claimedOffers.current.clear();
    setOffers([]); setOfferError("");
    const checkOffers = async () => {
      if (controller.signal.aborted || document.visibilityState !== "visible") return;
      try {
        const result = await apiRequest<{ deliveries: AvailableOffer[] }>("/api/delivery-partner/available-deliveries", token, { signal: controller.signal });
        if (!controller.signal.aborted && scopeRef.current === token)
          setOffers(result.deliveries.filter((offer) => !claimedOffers.current.has(offer.orderId)));
      } catch {
        if (!controller.signal.aborted && scopeRef.current === token) setOfferError("Available offers could not refresh. Try again shortly.");
      }
    };
    void checkOffers();
    void runRefreshEventStream("/api/delivery-partner/events", token, controller.signal, () => { void checkOffers(); });
    const timer = window.setInterval(() => void checkOffers(), OFFER_POLL_MS);
    window.addEventListener("focus", checkOffers);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", checkOffers); claimedOffers.current.clear(); };
  }, [token]);

  useEffect(() => {
    if (!photoPreview) return;
    return () => URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);
  useEffect(() => {
    if (!savedPhoto) return;
    return () => URL.revokeObjectURL(savedPhoto);
  }, [savedPhoto]);

  useEffect(() => {
    let active = true;
    const assignmentId = selectedDelivery?.id;
    const controller = new AbortController();
    setPhotoFile(null); setPhotoPreview(""); setSavedPhoto(""); setPhotoExists(false); setPhotoError(""); setPhotoCapturedAt("");
    if (!assignmentId) return () => controller.abort();
    void apiRequest<{ photo: { id: string; capturedAt: string; uploadedAt: string; mimeType: string } | null }>(
      `/api/delivery-partner/deliveries/${encodeURIComponent(assignmentId)}/photo/metadata`, token, { signal: controller.signal },
    ).then(async ({ photo }) => {
      if (!active || controller.signal.aborted || !photo) return;
      setPhotoExists(true);
      const response = await fetch(apiUrl(`/api/delivery-partner/deliveries/${encodeURIComponent(assignmentId)}/photo`), {
        credentials: "same-origin", headers: apiAuthorizationHeaders(token), signal: controller.signal,
      });
      if (!response.ok) throw new Error("Saved package photo could not be loaded.");
      const url = URL.createObjectURL(await response.blob());
      if (active && !controller.signal.aborted) setSavedPhoto(url); else URL.revokeObjectURL(url);
    }).catch(() => { if (active && !controller.signal.aborted) setPhotoError("Saved package photo is unavailable. Retry delivery details before pickup."); });
    return () => { active = false; controller.abort(); };
  }, [selectedDelivery?.id, token]);

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

  const claimOffer = async (offer: AvailableOffer) => {
    const signal = activeController.current?.signal;
    if (!signal || signal.aborted || claimGate.current) return;
    claimGate.current = true;
    setClaimedOffer(offer.orderId); setOfferError("");
    try {
      const result = await apiRequest<{ assignment: DeliveryAssignment }>(`/api/delivery-partner/orders/${encodeURIComponent(offer.orderId)}/claim`, token, { method: "POST", body: JSON.stringify({}), signal });
      if (signal.aborted || scopeRef.current !== token) return;
      claimedOffers.current.add(offer.orderId);
      setOffers((current) => current.filter((item) => item.orderId !== offer.orderId));
      await reload(signal);
      setScreen("deliveries");
      await openDelivery(result.assignment.id);
    } catch (cause) {
      if (signal.aborted || scopeRef.current !== token) return;
      if (cause instanceof ApiRequestError && cause.status === 409) {
        setOfferError("Another partner claimed this delivery first. The available offers have been refreshed.");
      } else {
        setOfferError(cause instanceof Error ? cause.message : "This delivery could not be claimed. Refresh available offers and retry.");
      }
      try {
        const result = await apiRequest<{ deliveries: AvailableOffer[] }>("/api/delivery-partner/available-deliveries", token, { signal });
        if (!signal.aborted) setOffers(result.deliveries.filter((item) => !claimedOffers.current.has(item.orderId)));
      } catch { /* keep the clear conflict message */ }
    } finally {
      claimGate.current = false;
      if (!signal.aborted && scopeRef.current === token) setClaimedOffer("");
    }
  };

  const selectPhoto = (file?: File) => {
    if (!file) return;
    setPhotoError("");
    const extension = file.name.toLowerCase().split(".").pop();
    const mimeType = file.type || (extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "");
    if (!["image/jpeg", "image/png"].includes(mimeType)) { setPhotoError("Choose one JPEG or PNG package photo."); return; }
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) { setPhotoError("Photo must be 5 MiB or smaller."); return; }
    const normalizedFile = file.type ? file : new File([file], file.name, { type: mimeType });
    setPhotoFile(normalizedFile); setPhotoCapturedAt(new Date().toISOString()); setPhotoPreview(URL.createObjectURL(normalizedFile));
  };

  const uploadPhoto = async () => {
    const current = selectedDelivery;
    const signal = activeController.current?.signal;
    if (!current || !photoFile || !signal || signal.aborted || photoUploadGate.current) return;
    photoUploadGate.current = true;
    setPhotoBusy(true); setPhotoError("");
    try {
      const query = new URLSearchParams({ fileName: photoFile.name, mimeType: photoFile.type, capturedAt: photoCapturedAt || new Date().toISOString() });
      const response = await fetch(apiUrl(`/api/delivery-partner/deliveries/${encodeURIComponent(current.id)}/photo?${query}`), {
        method: "POST", credentials: "same-origin",
        headers: apiAuthorizationHeaders(token, { "Content-Type": photoFile.type }), body: photoFile, signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(payload?.error || `Photo upload failed (${response.status}).`);
      }
      await response.json();
      if (selectedDeliveryId.current !== current.id) return;
      setPhotoExists(true);
      setSavedPhoto(URL.createObjectURL(photoFile));
      setPhotoFile(null); setPhotoPreview("");
      setPhotoCapturedAt("");
      if (photoInput.current) photoInput.current.value = "";
    } catch (cause) {
      if (!signal.aborted) setPhotoError(cause instanceof Error ? cause.message : "Package photo could not be saved. Retry when connected.");
    } finally { photoUploadGate.current = false; if (!signal.aborted) setPhotoBusy(false); }
  };

  const downloadDailyReport = async () => {
    if (!reportDate || reportBusy) return;
    setReportBusy(true);
    try { await savePdf(`/api/delivery-partner/reports/daily.pdf?date=${encodeURIComponent(reportDate)}`, token, `delivery-report-${reportDate}.pdf`); }
    catch (cause) { setOfferError(cause instanceof Error ? cause.message : "Unable to download daily report."); }
    finally { setReportBusy(false); }
  };

  const performAction = async (action: PartnerAction) => {
    const current = selectedDelivery;
    const signal = activeController.current?.signal;
    if (!current || !signal || signal.aborted || actionGate.current || !deliveryActions[current.status]?.some((item) => item.action === action)) return;
    if (action === "PICKUP" && !photoExists) {
      setActionError("Capture and save the complete package photo before confirming pickup.");
      return;
    }
    if ((action === "PICKUP" || action === "START") && waitForScheduledStart(current)) {
      setActionError("This is a scheduled delivery. Pickup and delivery can start at the selected window.");
      return;
    }
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
          <div className="lbp-brand"><BrandingLogo className="lbp-mark" /><div className="lbp-brand-copy"><strong>Local Basket</strong><span>Delivery partner</span></div></div>
          <button className="lbp-button" data-testid="button-partner-logout" type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
        </header>
        <section className="lbp-heading-row">
          <div><p className="lbp-kicker">Partner workspace</p><h1 className="lbp-title">{isPortalResourceScreen(screen) ? portalResourceTitle(screen) : screen === "dashboard" ? `${timeOfDay()}, ${data.profile?.displayName || "partner"}` : screen === "deliveries" ? "My deliveries" : "Your profile"}</h1><p className="lbp-subtitle">{isPortalResourceScreen(screen) ? portalResourceIntro("delivery_partner", screen) : screen === "dashboard" ? "Here’s your delivery activity for today." : screen === "deliveries" ? "Status and timing only. Customer and order details are not shown here." : "Your partner details are managed by Local Basket administration."}</p></div>
          <div className="lbp-top-actions"><span className={`lbp-status ${data.profile?.status === "INACTIVE" ? "lbp-status-inactive" : ""}`} data-testid="status-partner-account">{data.profile ? prettyStatus(data.profile.status) : "Account check"}</span></div>
        </section>
        <nav className="lbp-nav" aria-label="Partner navigation">
          {(["dashboard", "deliveries", "profile"] as const).map((tab) => <button key={tab} className="lbp-tab" aria-current={screen === tab || (tab === "profile" && isPortalResourceScreen(screen)) ? "page" : undefined} data-testid={`tab-partner-${tab}`} onClick={() => setScreen(tab)} type="button">{tab === "dashboard" ? "Dashboard" : tab === "deliveries" ? "My deliveries" : "Profile"}</button>)}
        </nav>
        {offers.length > 0 && screen !== "dashboard" && !isPortalResourceScreen(screen) && <div className="lbp-alert lbp-offer-alert" role="status">
          <strong>{offers.length} delivery offer{offers.length === 1 ? "" : "s"} available</strong>
          <span>Offers refresh while this portal is open. Claiming is confirmed by the server.</span>
          <button className="lbp-button lbp-button-primary" type="button" onClick={() => setScreen("dashboard")}>Review offers</button>
        </div>}
        {error && <div className={`lbp-alert ${!denied ? "lbp-alert-info" : ""}`} role="alert" data-testid="status-partner-portal-error">{error}{denied ? <div style={{ marginTop: 10 }}><button className="lbp-button" type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button></div> : <div style={{ marginTop: 10 }}><button className="lbp-button" type="button" onClick={() => { const signal = activeController.current?.signal; if (signal && !signal.aborted) { setLoading(!data.profile); void reload(signal); } }} disabled={loading}>{loading ? "Retrying…" : "Try again"}</button></div>}</div>}
        {offerError && <div className="lbp-alert lbp-alert-info" role="alert">{offerError}<button className="lbp-button" type="button" onClick={() => setOfferError("")}>Dismiss</button></div>}
         {loading && !data.profile ? <div aria-label="Loading partner workspace" data-testid="loading-partner-workspace"><div className="lbp-skeleton" /><div className="lbp-skeleton" /></div> : denied ? <div className="lbp-empty"><strong>Partner access unavailable</strong><span>Your private partner information has been cleared.</span></div> : isPortalResourceScreen(screen) ? (
           <PortalResourcePage
             role="delivery_partner"
             resource={screen}
             account={data.profile ? {
               displayName: data.profile.displayName,
               username: data.profile.username,
               contactNumber: data.profile.contactNumber,
               status: data.profile.status,
             } : null}
             onBack={() => setScreen("profile")}
           />
         ) : screen === "dashboard" ? (
           <div className="lbp-dashboard-content">
             <section className="lbp-overview" aria-label="Delivery activity summary">
               <div className="lbp-panel lbp-count-panel">
                 <div className="lbp-count-head"><div><p className="lbp-kicker">Activity overview</p><strong>Your deliveries</strong></div><span className="lbp-date-note">Updated automatically</span></div>
                 <div className="lbp-total" data-testid="text-partner-total">{data.summary?.total ?? "—"}<div className="lbp-total-label">total assigned deliveries</div></div>
                 <div className="lbp-summary-tiles">
                   {([["pending", "New deliveries", "lbp-summary-new"], ["inProgress", "Active deliveries", "lbp-summary-active"], ["completed", "Completed deliveries", "lbp-summary-done"]] as const).map(([key, label, className]) => <div className={`lbp-summary-tile ${className}`} key={key} data-testid={`summary-partner-${key}`}><span>{label}</span><strong>{data.summary?.[key] ?? "—"}</strong></div>)}
                 </div>
                 <div className="lbp-breakdown-heading"><span>Status breakdown</span><span className="lbp-date-note">All assigned activity</span></div>
                 <div className="lbp-stats">
                   {([["pending", "Pending"], ["accepted", "Accepted"], ["pickedUp", "Picked up"], ["outForDelivery", "Out for delivery"], ["delivered", "Delivered"], ["assigned", "Assigned"], ["inProgress", "In progress"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["rejected", "Rejected"]] as const).map(([key, label]) => <div className="lbp-stat" key={key} data-testid={`stat-partner-${key}`}><span className="lbp-stat-value">{data.summary?.[key] ?? "—"}</span><span className="lbp-stat-label">{label}</span></div>)}
                 </div>
               </div>
                <aside className="lbp-aside-card"><div><p className="lbp-kicker">Partner note</p><h2>One clear next step at a time.</h2></div><p>Available offers refresh every 12 seconds while this portal is open. Assigned delivery details refresh every 45 seconds.</p></aside>
             </section>
              <section className="lbp-panel lbp-content-panel lbp-available-offers" aria-label="Available delivery offers">
                 <div className="lbp-section-head"><div><p className="lbp-kicker">First claim wins</p><h2>Available deliveries</h2></div><span className="lbp-date-note">Live refresh signal when connected · 12-second polling fallback</span></div>
                {offers.length ? <div className="lbp-delivery-list">{offers.map((offer) => <article className="lbp-delivery-row" key={offer.orderId}>
                  <div><div className="lbp-delivery-ref">{offer.orderReference}</div><div className="lbp-delivery-time">{offer.storeName} · ₹{Number(offer.orderTotal).toFixed(2)}</div><div className="lbp-delivery-schedule">{offer.deliveryMode === "SCHEDULED" && offer.scheduledStartAt ? `Scheduled · ${dateTime(offer.scheduledStartAt)}` : "Instant delivery"}</div></div>
                  <button className="lbp-button lbp-button-primary" type="button" disabled={claimedOffer === offer.orderId || Boolean(claimedOffer)} onClick={() => void claimOffer(offer)}>{claimedOffer === offer.orderId ? "Claiming…" : "Claim delivery"}</button>
                </article>)}</div> : <div className="lbp-empty"><strong>No delivery offers right now</strong><span>{offerError ? "We’ll retry when the portal is open." : "New eligible deliveries will appear here while you are signed in."}</span></div>}
              </section>
              <section className="lbp-panel lbp-daily-report" aria-label="Daily delivery report"><div><p className="lbp-kicker">Your records</p><h2>Daily delivery report</h2><p className="lbp-date-note">Includes only your deliveries for the selected India-local day.</p></div><label>Report date<input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} /></label><button className="lbp-button lbp-button-primary" type="button" disabled={reportBusy || !reportDate} onClick={() => void downloadDailyReport()}>{reportBusy ? "Preparing PDF…" : "Download PDF"}</button></section>
              <section className="lbp-panel lbp-dashboard-activity" aria-label="Recent delivery activity">
               <div className="lbp-section-head"><div><p className="lbp-kicker">On your route</p><h2>Delivery activity</h2></div><button className="lbp-button lbp-button-quiet" type="button" data-testid="button-partner-view-deliveries" onClick={() => setScreen("deliveries")}>View all deliveries</button></div>
                {data.deliveries?.length ? <div className="lbp-dashboard-delivery-list">{data.deliveries.slice(0, 3).map((delivery) => <article className="lbp-dashboard-delivery" key={delivery.id}><div className="lbp-dashboard-delivery-copy"><span className="lbp-delivery-ref">{delivery.orderReference}</span><span className="lbp-delivery-time">{delivery.storeName} · Updated {dateTime(delivery.updatedAt)}</span><span className="lbp-delivery-schedule">{scheduledLabel(delivery)}</span></div><span className={`lbp-status lbp-status-${delivery.status.toLowerCase()}`}>{prettyStatus(delivery.status)}</span><button className="lbp-button lbp-button-quiet lbp-open-delivery" type="button" data-testid={`button-partner-open-delivery-${delivery.id}`} onClick={() => { setScreen("deliveries"); void openDelivery(delivery.id); }}>View delivery</button></article>)}</div> : <div className="lbp-empty lbp-dashboard-empty"><strong>No deliveries assigned yet</strong><span>New assignments will appear here when they are available.</span></div>}
             </section>
           </div>
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
            {!!photoError && <div className="lbp-alert" role="alert">{photoError}<button className="lbp-button" type="button" onClick={() => setPhotoError("")}>Dismiss</button></div>}
            {detailLoading ? <div className="lbp-skeleton" aria-label="Loading delivery details" /> : (
              <>
                <div className="lbp-delivery-detail-grid">
                  <div className="lbp-delivery-detail-item"><span>Status</span><strong className={`lbp-status lbp-status-${selectedDelivery.status.toLowerCase()}`}>{prettyStatus(selectedDelivery.status)}</strong></div>
                  <div className="lbp-delivery-detail-item"><span>Store</span><strong>{selectedDelivery.storeName}</strong></div>
                  <div className="lbp-delivery-detail-item"><span>Order status</span><strong>{prettyStatus(selectedDelivery.orderStatus)}</strong></div>
                  <div className="lbp-delivery-detail-item"><span>Order total</span><strong>₹{Number(selectedDelivery.orderTotal).toFixed(2)}</strong></div>
                  <div className="lbp-delivery-detail-item lbp-schedule-item"><span>Delivery window</span><strong>{scheduledLabel(selectedDelivery)}</strong></div>
                  <div className="lbp-delivery-detail-item"><span>Recipient</span><strong>{selectedDelivery.recipientName || "Not provided"}</strong></div>
                  <div className="lbp-delivery-detail-item lbp-address-item"><span>Delivery address</span><strong>{snapshotAddress(selectedDelivery.deliveryAddress) || "Address not available"}</strong></div>
                </div>
                {(selectedDelivery.status === "ACCEPTED" || photoExists) && <section className="lbp-package-photo" aria-label="Package photo">
                  <div><p className="lbp-kicker">{selectedDelivery.status === "ACCEPTED" ? "Required before pickup" : "Delivery record"}</p><h3>Complete order photo</h3><p>{selectedDelivery.status === "ACCEPTED" ? "Capture one clear photo of the full package. Pickup stays unavailable until the image is saved. If camera access is denied, choose a JPEG or PNG file from your device." : "Saved photo for this assigned delivery."}</p></div>
                  {savedPhoto && <img src={savedPhoto} alt="Saved complete package" />}
                  {photoPreview && !savedPhoto && <img src={photoPreview} alt="Preview of package photo before upload" />}
                  {selectedDelivery.status === "ACCEPTED" && !photoExists && <>
                    <input ref={photoInput} type="file" accept="image/jpeg,image/png" capture="environment" aria-label="Capture package photo using camera" onChange={(event) => selectPhoto(event.target.files?.[0])} disabled={photoBusy || !!actionPending} />
                    <div className="lbp-photo-actions">
                      <button className="lbp-button lbp-button-quiet" type="button" disabled={photoBusy || !!actionPending} onClick={() => photoInput.current?.click()}>{photoPreview ? "Recapture photo" : "Take package photo"}</button>
                      {photoFile && <button className="lbp-button lbp-button-primary" type="button" disabled={photoBusy} onClick={() => void uploadPhoto()}>{photoBusy ? "Saving photo…" : "Save package photo"}</button>}
                    </div>
                  </>}
                  {photoExists && <span className="lbp-photo-saved" role="status">Package photo saved</span>}
                </section>}
                  {waitForScheduledStart(selectedDelivery) && (selectedDelivery.status === "ACCEPTED" || selectedDelivery.status === "PICKED_UP") && <div className="lbp-scheduled-wait" role="status"><strong>Scheduled delivery</strong><span>Pickup and start are available at {scheduledLabel(selectedDelivery).replace("Scheduled delivery · ", "")}. The assignment remains in its current step until then.</span></div>}
                  {deliveryActions[selectedDelivery.status]?.length ? <div className="lbp-duty-actions">
                  <span className="lbp-duty-caption">Next step</span>
                   {deliveryActions[selectedDelivery.status]!.map(({ action, label }) => <button key={action} className={action === "REJECT" ? "lbp-button lbp-button-danger" : "lbp-button lbp-button-primary"} type="button" disabled={!!actionPending || detailLoading || !!detailError || (action === "PICKUP" && !photoExists) || ((action === "PICKUP" || action === "START") && waitForScheduledStart(selectedDelivery))} data-testid={`button-delivery-action-${action.toLowerCase()}`} onClick={() => action === "REJECT" ? setRejectConfirmation(true) : void performAction(action)}>{actionPending === action ? "Updating…" : label}</button>)}
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
             {visibleDeliveries.length ? <div className="lbp-delivery-list">{visibleDeliveries.map((delivery) => <article className="lbp-delivery-row" key={delivery.id}><div><div className="lbp-delivery-ref">{delivery.orderReference}</div><div className="lbp-delivery-time">{delivery.storeName} · Updated {dateTime(delivery.updatedAt)}</div><div className="lbp-delivery-schedule">{scheduledLabel(delivery)}</div></div><span className={`lbp-status lbp-status-${delivery.status.toLowerCase()}`}>{prettyStatus(delivery.status)}</span><button className="lbp-button lbp-button-quiet lbp-open-delivery" type="button" onClick={() => void openDelivery(delivery.id)}>View delivery</button></article>)}</div> : <div className="lbp-empty"><strong>{filter === "ALL" ? "No deliveries assigned yet" : "No deliveries in this status"}</strong><span>{filter === "ALL" ? "When delivery activity is recorded, it will appear here." : "Try another status filter to see delivery activity."}</span></div>}
          </section>
        ) : (
          <>
          <section className="lbp-panel lbp-content-panel">
            <div className="lbp-section-head"><h2>Partner details</h2><span className="lbp-date-note">Read only</span></div>
            <div className="lbp-profile-grid">
              <div className="lbp-profile-item"><span>Display name</span><strong data-testid="text-partner-display-name">{data.profile?.displayName || "—"}</strong></div>
              <div className="lbp-profile-item"><span>Username</span><strong data-testid="text-partner-profile-username">{data.profile?.username || "—"}</strong></div>
              <div className="lbp-profile-item"><span>Contact number</span><strong data-testid="text-partner-contact-number">{data.profile?.contactNumber || "Not provided"}</strong></div>
              <div className="lbp-profile-item"><span>Account status</span><strong>{data.profile ? prettyStatus(data.profile.status) : "—"}</strong></div>
            </div>
          </section>
          <PortalResourceMenu role="delivery_partner" onOpen={(resource) => setScreen(resource)} />
          </>
        )}
      </div>
    </main>
  );
}