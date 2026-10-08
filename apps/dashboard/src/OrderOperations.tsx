import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiRequest,
  type OrderDetail,
  type OrderListEnvelope,
  type OrderStatus,
  type OrderSummary,
  type Store,
  type VendorDeliveryPartner,
} from "./api";
import type { DeliveryAssignment } from "../../../lib/api-client-react/src/generated/api.schemas";
import { actionProgress, createVendorActionGate, vendorActions, vendorEmptyMessage, vendorStatusLabel, type VendorOrderAction } from "./vendor-orders";
import { VendorOrderReceipt } from "./VendorOrderReceipt";
import "./vendor-orders.css";

const statuses: Array<OrderStatus | "ALL"> = ["ALL", "PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "REJECTED", "CANCELLED"];
const money = (value: string | number) => `₹${Number(value).toFixed(2)}`;
const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const statusLabel = (value: string) => value.replaceAll("_", " ");
const deliveryLabel = (value: string) => value === "vendor_staff" ? "Vendor delivery" : "Platform partner";
const deliveryStatusLabel = (value: string) => value.replaceAll("_", " ");
function deliverySnapshot(order: Pick<OrderSummary, "deliveryMode" | "scheduledStartAt" | "scheduledEndAt">) {
  if (order.deliveryMode !== "SCHEDULED" || !order.scheduledStartAt || !order.scheduledEndAt) return "Instant delivery";
  const start = new Date(order.scheduledStartAt);
  const end = new Date(order.scheduledEndAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Scheduled delivery";
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(start);
  const time = (value: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(value);
  return `Scheduled delivery · ${day} · ${time(start)}–${time(end)} IST`;
}

function VendorDeliveryAssignmentPanel({ token, detail, disabled = false }: { token: string; detail: OrderDetail; disabled?: boolean }) {
  const [assignment, setAssignment] = useState<DeliveryAssignment | null>(null);
  const [partners, setPartners] = useState<VendorDeliveryPartner[]>([]);
  const [partnerId, setPartnerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const requestGeneration = useRef(0);
  const actionGate = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const replacementDialog = useRef<HTMLDialogElement>(null);
  const scope = `${token}:${detail.id}`;
  const renderedScope = useRef(scope);
  renderedScope.current = scope;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const generation = ++requestGeneration.current;
    const requestScope = scope;
    setLoading(true);
    setError("");
    try {
      const response = await apiRequest<{ assignment: DeliveryAssignment | null }>(
        `/api/vendor/orders/${encodeURIComponent(detail.id)}/delivery`, token, { signal },
      );
      if (signal?.aborted || generation !== requestGeneration.current || requestScope !== renderedScope.current) return;
      setAssignment(response.assignment);
      const replaceable = !response.assignment || ["PENDING", "REJECTED", "CANCELLED"].includes(response.assignment.status);
      if (detail.status === "READY" && replaceable) {
        const directory = await apiRequest<{ partners: VendorDeliveryPartner[] }>("/api/vendor/delivery-partners", token, { signal });
        if (signal?.aborted || generation !== requestGeneration.current || requestScope !== renderedScope.current) return;
        setPartners(directory.partners.filter((partner) => partner.status === "ACTIVE"));
      } else {
        setPartners([]);
      }
    } catch {
      if (!signal?.aborted && generation === requestGeneration.current && requestScope === renderedScope.current) {
        setError("Delivery assignment could not be loaded. Retry to check its current state.");
      }
    } finally {
      if (!signal?.aborted && generation === requestGeneration.current && requestScope === renderedScope.current) setLoading(false);
    }
  }, [detail.id, detail.status, scope, token]);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    renderedScope.current = scope;
    setAssignment(null);
    setPartners([]);
    setPartnerId("");
    setLoading(true);
    void refresh(controller.signal);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible" && !actionGate.current && !controller.signal.aborted)
        void refresh(controller.signal);
    };
    const timer = window.setInterval(refreshWhenVisible, 45_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (controllerRef.current === controller) controllerRef.current = null;
      ++requestGeneration.current;
    };
  }, [refresh, scope]);

  useEffect(() => {
    if (confirmReplacement && assignment?.status === "PENDING") replacementDialog.current?.showModal();
    else replacementDialog.current?.close();
  }, [confirmReplacement, assignment?.status]);

  const assign = async () => {
    const signal = controllerRef.current?.signal;
    const requestScope = scope;
    if (disabled || requestScope !== renderedScope.current || !partnerId || saving || actionGate.current || detail.status !== "READY" || !signal || signal.aborted) return;
    actionGate.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await apiRequest<{ assignment: DeliveryAssignment | null }>(
        `/api/vendor/orders/${encodeURIComponent(detail.id)}/delivery`,
        token,
        { method: "POST", body: JSON.stringify({ partnerId }), signal },
      );
      if (signal.aborted || requestScope !== renderedScope.current) return;
      setAssignment(response.assignment);
      setPartnerId("");
      // Re-read the server-owned assignment after the write.
      await refresh(signal);
    } catch {
      if (!signal.aborted && requestScope === renderedScope.current) {
        await refresh(signal);
        if (!signal.aborted && requestScope === renderedScope.current)
          setError("Partner assignment could not be completed. Review the current assignment before trying again.");
      }
    } finally {
      actionGate.current = false;
      if (!signal.aborted && requestScope === renderedScope.current) setSaving(false);
    }
  };

  const canReplace = !assignment || ["PENDING", "REJECTED", "CANCELLED"].includes(assignment.status);
  const beginAssign = () => {
    if (assignment?.status === "PENDING") setConfirmReplacement(true);
    else void assign();
  };
  return (
    <div className="vendor-info-block vendor-delivery-assignment" aria-label="Delivery assignment">
      <div className="vendor-assignment-heading">
        <div><h3 className="vendor-subtitle">Delivery partner</h3><p className="vendor-text-muted">Partner fulfillment is managed separately from order preparation.</p></div>
        <button className="vendor-text-button" type="button" disabled={loading || saving || disabled} onClick={() => void refresh()}>{loading ? "Checking…" : "Refresh"}</button>
      </div>
      {error && <div className="vendor-notice vendor-notice-error" role="alert"><span>{error}</span><button className="vendor-secondary-button" type="button" disabled={loading} onClick={() => void refresh()}>Retry</button></div>}
      {loading ? <div className="vendor-delivery-skeleton" aria-label="Loading delivery assignment" /> : assignment ? (
        <div className="vendor-assignment-current">
          <div><span className="vendor-text-muted">Assigned to</span><strong>{assignment.partnerName}</strong></div>
          <span className={`vendor-status-badge vendor-status-${assignment.status.toLowerCase()}`}>{deliveryStatusLabel(assignment.status)}</span>
          {assignment.status === "PENDING" && <p className="vendor-assignment-warning">Replacing this assignment will cancel the current pending duty before a new partner is assigned.</p>}
          {["REJECTED", "CANCELLED"].includes(assignment.status) && <p className="vendor-text-muted">This assignment is closed. A replacement may be selected when the order is ready.</p>}
        </div>
      ) : <p className="vendor-text-muted">No delivery partner has been assigned.</p>}
      {!loading && detail.status === "READY" && canReplace && (
        <div className="vendor-assignment-select">
          <label htmlFor="delivery-partner-select">{assignment?.status === "PENDING" ? "Choose a replacement partner" : "Choose an active partner"}</label>
          <div>
            <select id="delivery-partner-select" value={partnerId} onChange={(event) => setPartnerId(event.target.value)} disabled={saving || !!error || disabled}>
              <option value="">Select a partner</option>
              {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.displayName}</option>)}
            </select>
            <button className="vendor-primary-button" type="button" disabled={!partnerId || saving || !!error || disabled} onClick={beginAssign}>{saving ? "Assigning…" : assignment?.status === "PENDING" ? "Replace pending assignment" : "Assign partner"}</button>
          </div>
          {!partners.length && !error && <small>No active partners are available.</small>}
        </div>
      )}
      {!loading && detail.status !== "READY" && !assignment && <p className="vendor-text-muted">Partner assignment becomes available when preparation is marked ready.</p>}
      <dialog className="vendor-order-reject-dialog" ref={replacementDialog} aria-labelledby="vendor-replace-delivery-title" onCancel={() => setConfirmReplacement(false)}>
        <h3 id="vendor-replace-delivery-title">Replace pending delivery?</h3>
        <p>The current pending duty for {assignment?.partnerName} will be cancelled before the new partner is assigned.</p>
        <div className="vendor-order-confirm-actions">
          <button type="button" className="vendor-secondary-button" autoFocus onClick={() => setConfirmReplacement(false)}>Keep current partner</button>
          <button type="button" className="vendor-primary-button" disabled={!partnerId || saving || !!error || disabled} onClick={() => { setConfirmReplacement(false); void assign(); }}>{saving ? "Replacing…" : "Confirm replacement"}</button>
        </div>
      </dialog>
    </div>
  );
}

function AdminSummaryTiles({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="order-summary-grid">
      <div className="summary-tile"><span>All orders</span><strong>{Object.values(counts).reduce((sum, count) => sum + count, 0)}</strong></div>
      <div className="summary-tile"><span>Needs attention</span><strong>{(counts.PLACED ?? 0) + (counts.ACCEPTED ?? 0)}</strong></div>
      <div className="summary-tile"><span>In motion</span><strong>{(counts.PREPARING ?? 0) + (counts.READY ?? 0) + (counts.OUT_FOR_DELIVERY ?? 0)}</strong></div>
      <div className="summary-tile"><span>Completed</span><strong>{counts.DELIVERED ?? 0}</strong></div>
    </div>
  );
}

function AdminDetail({ detail, busy, onClose }: {
  detail: OrderDetail;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <div className="card order-detail" data-testid={`card-order-detail-${detail.id}`}>
      <div className="card-heading">
        <div><p className="eyebrow">Immutable order detail</p><h3>Order {detail.id.slice(0, 8)}</h3><p className="muted">{date(detail.createdAt)}</p></div>
        <button className="text-button" data-testid="button-close-order-detail" onClick={onClose} type="button">Close</button>
      </div>
      <div className="order-detail-grid">
        <div>
          <dl className="detail-list">
            <div><dt>Status</dt><dd><span className={`status status-${detail.status.toLowerCase()}`}>{statusLabel(detail.status)}</span></dd></div>
            <div><dt>Store</dt><dd>{detail.storeName}</dd></div>
            <div><dt>Customer</dt><dd>{detail.deliveryContactName}</dd></div>
            <div><dt>Contact</dt><dd><a href={`tel:${detail.deliveryContactPhone}`}>{detail.deliveryContactPhone}</a></dd></div>
            <div><dt>Payment</dt><dd>{detail.paymentMethod}</dd></div>
            <div><dt>Delivery type</dt><dd>{deliveryLabel(detail.deliveryType)}</dd></div>
            <div><dt>Delivery address</dt><dd>{detail.deliveryAddressSnapshot.line1}{detail.deliveryAddressSnapshot.line2 ? `, ${detail.deliveryAddressSnapshot.line2}` : ""}, {detail.deliveryAddressSnapshot.city}, {detail.deliveryAddressSnapshot.state} {detail.deliveryAddressSnapshot.pincode}</dd></div>
            <div><dt>Items</dt><dd>{detail.items.reduce((sum, item) => sum + item.quantity, 0)}</dd></div>
          </dl>
          <h3>Items</h3>
          <div className="order-items">
            {detail.items.map((item) => <div className="order-item" key={item.id}><div><strong>{item.productNameSnapshot}</strong><small>{item.quantity} × {money(item.productPriceSnapshot)}</small></div><strong>{money(item.subtotal)}</strong></div>)}
          </div>
        </div>
        <div>
          <div className="card-heading"><h3>Totals</h3></div>
          <dl className="detail-list">
            <div><dt>Subtotal</dt><dd>{money(detail.subtotal)}</dd></div>
            <div><dt>Delivery fee</dt><dd>{money(detail.deliveryFeeSnapshot)}</dd></div>
            <div><dt>Total</dt><dd><strong>{money(detail.totalAmount)}</strong></dd></div>
            <div><dt>Commission rate</dt><dd>{detail.commissionRateSnapshot == null ? "Not recorded" : `${detail.commissionRateSnapshot}%`}</dd></div><div><dt>Commission amount</dt><dd>{detail.commissionAmountSnapshot == null ? "Not recorded" : money(detail.commissionAmountSnapshot)}</dd></div>
          </dl>
          <h3>Status history</h3>
          <div className="history-list">{detail.statusHistory.map((entry, index) => <div key={`${entry.createdAt}-${index}`}><strong>{statusLabel(entry.status)}</strong>{entry.note && <span> — {entry.note}</span>}<small>{date(entry.createdAt)}</small></div>)}</div>
        </div>
      </div>
    </div>
  );
}

function AdminOrderOperations({ token, stores = [], storeId, onMessage }: { token: string; stores?: Store[]; storeId?: string; onMessage: (message: string, kind?: "success" | "error") => void; }) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState("ALL");
  const [adminStore, setAdminStore] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0 });
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [detailTargetId, setDetailTargetId] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const listGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (status !== "ALL") params.set("status", status);
    if (adminStore) params.set("storeId", adminStore);
    if (from) params.set("from", `${from}T00:00:00.000Z`);
    if (to) params.set("to", `${to}T23:59:59.999Z`);
    return params.toString();
  }, [adminStore, from, page, status, to]);
  const load = async () => {
    const requestGeneration = ++listGeneration.current;
    setLoading(true); setError("");
    try {
      const response = await apiRequest<OrderListEnvelope>(`/api/admin/orders?${query}`, token);
      if (requestGeneration === listGeneration.current) {
        setOrders(response.orders); setCounts(response.counts); setPagination(response.pagination);
      }
    } catch (cause) { if (requestGeneration === listGeneration.current) { const message = cause instanceof Error ? cause.message : "Unable to load orders."; setError(message); onMessage(message, "error"); } }
    finally { if (requestGeneration === listGeneration.current) setLoading(false); }
  };
  useEffect(() => { ++listGeneration.current; ++detailGeneration.current; setPage(1); setSelected(null); setDetailTargetId(""); setDetailError(""); }, [token, storeId]);
  useEffect(() => { ++detailGeneration.current; }, [query]);
  useEffect(() => { void load(); }, [query, token, storeId]);
  const openDetail = async (id: string) => {
    if (!id.trim()) return;
    const requestGeneration = ++detailGeneration.current;
    setDetailTargetId(id); setDetailLoading(true); setDetailError("");
    try { const response = await apiRequest<{ order: OrderDetail }>(`/api/admin/orders/${id}`, token); if (requestGeneration === detailGeneration.current) setSelected(response.order); }
    catch (cause) {
      if (requestGeneration === detailGeneration.current) {
        const message = cause instanceof Error ? cause.message : "Unable to load order detail.";
        setSelected(null); setDetailError(message); onMessage(message, "error");
      }
    } finally { if (requestGeneration === detailGeneration.current) setDetailLoading(false); }
  };
  return (
    <section className="order-section">
      <div className="section-heading"><div><p className="eyebrow">Platform operations</p><h2>Order oversight</h2><p className="muted">Read-only platform visibility across every store and order.</p></div><button className="secondary-button" data-testid="button-refresh-orders" disabled={loading} onClick={() => void load()} type="button">{loading ? "Refreshing…" : "Refresh orders"}</button></div>
      <AdminSummaryTiles counts={counts} />
      <div className="card">
        <div className="order-toolbar"><div className="order-filters">
          <label>Status<select data-testid="select-order-status" onChange={(event) => { setStatus(event.target.value); setPage(1); }} value={status}>{statuses.map((item) => <option key={item} value={item}>{item === "ALL" ? "All statuses" : statusLabel(item)}</option>)}</select></label>
          <label>Store<select data-testid="select-order-store" onChange={(event) => { setAdminStore(event.target.value); setPage(1); }} value={adminStore}><option value="">All stores</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
          <label>From<input data-testid="input-orders-from" onChange={(event) => { setFrom(event.target.value); setPage(1); }} type="date" value={from} /></label><label>To<input data-testid="input-orders-to" onChange={(event) => { setTo(event.target.value); setPage(1); }} type="date" value={to} /></label>
        </div><span className="muted">{pagination.total} total</span></div>
        {error && <div className="order-error" role="alert"><span>{error}</span><button className="secondary-button" onClick={() => void load()} type="button">Retry</button></div>}
        {loading ? <div aria-live="polite" className="empty-state"><strong>Loading order queue…</strong><span>Checking the latest operational state.</span></div> : orders.length === 0 ? <div className="empty-state"><strong>No orders in this view</strong><span>Try another status or refresh when new orders arrive.</span></div> : <div aria-label="Orders" className="order-table" role="table"><div className="order-row order-row-header" role="row"><strong role="columnheader">Order</strong><strong role="columnheader">Customer</strong><strong role="columnheader">Status</strong><strong role="columnheader">Amount</strong><strong role="columnheader">Created</strong></div>{orders.map((order) => <div className="order-row order-row-data" data-testid={`row-order-${order.id}`} key={order.id} role="row"><button aria-label={`Open order ${order.id.slice(0, 8)} from ${order.storeName}`} className="text-button order-id" onClick={() => void openDetail(order.id)} role="cell" type="button">#{order.id.slice(0, 8)}</button><div className="order-customer" role="cell"><strong>{order.deliveryContactName}</strong><small className="order-store">{order.storeName}</small><small>{order.itemCount} items · {order.deliveryAddressSnapshot.pincode}</small></div><span className={`status status-${order.status.toLowerCase()}`} role="cell">{statusLabel(order.status)}</span><div className="order-amount" role="cell"><strong>{money(order.totalAmount)}</strong><small>{order.paymentMethod}</small></div><small className="order-created" role="cell">{date(order.createdAt)}</small></div>)}</div>}
        <div className="order-pagination"><button className="secondary-button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)} type="button">Previous</button><span className="muted">Page {page} of {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}</span><button className="secondary-button" disabled={loading || page >= Math.ceil(pagination.total / pagination.pageSize)} onClick={() => setPage((current) => current + 1)} type="button">Next</button></div>
      </div>
      {detailLoading && <div className="card empty-state"><strong>Loading order detail…</strong><span>Retrieving the latest status and historical snapshots.</span></div>}
      {!detailLoading && detailError && <div className="card order-error" role="alert"><span>{detailError}</span><button className="secondary-button" disabled={!detailTargetId} onClick={() => { if (detailTargetId) void openDetail(detailTargetId); }} type="button">Retry detail</button></div>}
      {!detailLoading && selected && <AdminDetail detail={selected} busy={busy} onClose={() => { ++detailGeneration.current; setSelected(null); setDetailTargetId(""); setDetailError(""); }} />}
    </section>
  );
}


/* ==========================================================================
 * VENDOR SPECIFIC IMPLEMENTATION
 * ========================================================================== */

const time = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const orderVendorTabs: OrderStatus[] = ["PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "REJECTED", "CANCELLED"];
const deliveryVendorTabs: OrderStatus[] = ["READY", "OUT_FOR_DELIVERY", "DELIVERED"];

function VendorDetail({ detail, token, busy, pendingAction, vendorView, onAction, onClose }: {
  detail: OrderDetail;
  token: string;
  busy: boolean;
  pendingAction: VendorOrderAction | null;
  vendorView: "orders" | "delivery";
  onAction: (action: VendorOrderAction, note?: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [rejectVisible, setRejectVisible] = useState(false);
  const rejectionDialog = useRef<HTMLDialogElement>(null);
  const available = vendorActions(detail.status, vendorView);
  useEffect(() => {
    if (rejectVisible && detail.status === "PLACED") rejectionDialog.current?.showModal();
    else rejectionDialog.current?.close();
  }, [rejectVisible, detail.status]);

  return (
    <div className={`vendor-card vendor-order-detail-view ${vendorView === "orders" ? "vendor-preparation-detail" : ""}`} data-testid={`card-order-detail-${detail.id}`}>
      <div className="vendor-detail-header">
        <div>
          <span className={`vendor-status-badge vendor-status-${detail.status.toLowerCase()}`}>{vendorStatusLabel(detail.status)}</span>
          <h2 className="vendor-title">Order #{detail.id.slice(0, 8).toUpperCase()}</h2>
          <p className="vendor-text-muted"><time dateTime={detail.createdAt}>{date(detail.createdAt)}</time></p>
        </div>
        <button className="vendor-text-button" disabled={busy} onClick={onClose} type="button">Back to Orders</button>
      </div>

      <div className="vendor-detail-layout">
        <div className="vendor-detail-main">
          <div className="vendor-info-block">
             <h3 className="vendor-subtitle">Customer & Delivery</h3>
             <div className="vendor-info-grid">
               <div><dt>Customer</dt><dd>{detail.deliveryContactName}</dd></div>
               <div><dt>Phone</dt><dd><a href={`tel:${detail.deliveryContactPhone}`}>{detail.deliveryContactPhone}</a></dd></div>
               <div><dt>Payment</dt><dd>{detail.paymentMethod}</dd></div>
               <div><dt>Delivery Method</dt><dd>{deliveryLabel(detail.deliveryType)}</dd></div>
                <div className="vendor-info-full"><dt>Delivery window</dt><dd>{deliverySnapshot(detail)}</dd></div>
             </div>
             <div className="vendor-info-full">
               <dt>Address</dt>
               <dd>{detail.deliveryAddressSnapshot.line1}{detail.deliveryAddressSnapshot.line2 ? `, ${detail.deliveryAddressSnapshot.line2}` : ""}, {detail.deliveryAddressSnapshot.city}, {detail.deliveryAddressSnapshot.state} {detail.deliveryAddressSnapshot.pincode}</dd>
             </div>
          </div>

          <VendorOrderReceipt detail={detail} />
        </div>

        <div className="vendor-detail-side">
            <VendorDeliveryAssignmentPanel token={token} detail={detail} disabled={busy} />
           {available.length > 0 ? (
             <div className="vendor-action-block">
               <h3 className="vendor-subtitle">Vendor Actions</h3>
               <div className="vendor-action-buttons">
                 {available.some(item => item.action === "REJECT") && <label className="vendor-text-muted">Rejection reason (optional)
                   <input className="vendor-input vendor-rejection-note" maxLength={500} onChange={(e) => setNote(e.target.value)} value={note} disabled={busy} />
                 </label>}
                 {available.map(item => <button key={item.action} className={item.className} disabled={busy} type="button"
                   onClick={() => item.action === "REJECT" ? setRejectVisible(true) : onAction(item.action)}>
                   {pendingAction === item.action ? actionProgress[item.action] : item.label}
                 </button>)}
               </div>
             </div>
           ) : vendorView === "orders" && detail.status === "READY" ? <div className="vendor-action-block"><h3 className="vendor-subtitle">Ready for fulfillment</h3><p className="vendor-text-muted">Preparation is complete. This order is ready for the next fulfillment step.</p></div> : null}
           <div className="vendor-info-block">
              <h3 className="vendor-subtitle">Order Timeline</h3>
              <div className="vendor-timeline">
                 {detail.statusHistory.map((h, index) => {
                    const isCurrent = index === detail.statusHistory.length - 1;
                    const isRejected = h.status === "REJECTED" || h.status === "CANCELLED";
                    
                    return (
                      <div key={`${h.status}-${index}`} className={`vendor-timeline-step completed ${isCurrent ? 'current' : ''} ${isRejected ? 'rejected' : ''}`}>
                         <div className="vendor-timeline-dot"></div>
                         <div className="vendor-timeline-content">
                             <strong>{statusLabel(h.status)}</strong>
                             <span>{date(h.createdAt)}</span>
                            {h.note && <span className="vendor-timeline-note">{h.note}</span>}
                         </div>
                      </div>
                    )
                 })}
              </div>
           </div>

        </div>
      </div>
      <dialog className="vendor-order-reject-dialog" ref={rejectionDialog} aria-labelledby="vendor-reject-title" onCancel={() => setRejectVisible(false)}>
        <h3 id="vendor-reject-title">Reject this order?</h3>
        <p>Order #{detail.id.slice(0, 8).toUpperCase()} will be marked rejected. This cannot be undone.</p>
        {note.trim() && <p className="vendor-text-muted">Reason: {note.trim()}</p>}
        <div className="vendor-order-confirm-actions">
          <button type="button" className="vendor-secondary-button" autoFocus onClick={() => setRejectVisible(false)}>Cancel</button>
          <button type="button" className="vendor-danger-button" disabled={busy || detail.status !== "PLACED"} onClick={() => {
            setRejectVisible(false);
            onAction("REJECT", note.trim() || undefined);
          }}>Reject Order</button>
        </div>
      </dialog>
    </div>
  );
}

function VendorOrderOperations({ token, vendorView = "orders", storeId, onMessage }: { token: string; vendorView?: "orders" | "delivery"; storeId?: string; onMessage: (message: string, kind?: "success" | "error") => void; }) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState(vendorView === "delivery" ? "READY" : "PLACED");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0 });
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [detailTargetId, setDetailTargetId] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<VendorOrderAction | null>(null);
  const [actionError, setActionError] = useState("");
  const actionGate = useRef(createVendorActionGate());
  const scope = `${token}:${storeId ?? ""}:${vendorView}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const renderedScope = useRef(scope);
  
  const listGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const activeTabs = vendorView === "delivery" ? deliveryVendorTabs : orderVendorTabs;

  useEffect(() => {
    if (vendorView === "delivery" && !deliveryVendorTabs.includes(status as OrderStatus)) {
      setStatus("READY");
    } else if (vendorView === "orders" && status !== "ALL" && !orderVendorTabs.includes(status as OrderStatus)) {
      setStatus("ALL");
    }
  }, [vendorView, status]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (status !== "ALL") params.set("status", status);
    return params.toString();
  }, [page, status]);

  const load = useCallback(async (quiet = false) => {
    if (actionGate.current.pending) return;
    const requestGeneration = ++listGeneration.current;
    const requestScope = scope;
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await apiRequest<OrderListEnvelope>(`/api/vendor/orders?${query}`, token);
      if (requestGeneration === listGeneration.current && requestScope === currentScope.current) {
        setOrders(response.orders); setCounts(response.counts); setPagination(response.pagination);
      }
    } catch {
      if (requestGeneration === listGeneration.current && requestScope === currentScope.current) {
        setError("We couldn't load your orders. Please refresh or try again.");
      } 
    } finally { 
      if (requestGeneration === listGeneration.current && requestScope === currentScope.current) setLoading(false);
    }
  }, [query, scope, token]);

  useEffect(() => {
    ++listGeneration.current; ++detailGeneration.current;
    renderedScope.current = scope;
    setOrders([]); setCounts({}); setPage(1); setStatus(vendorView === "delivery" ? "READY" : "PLACED");
    setSelected(null); setDetailTargetId(""); setDetailError(""); setActionError(""); setDetailRefreshing(false);
    return () => { ++listGeneration.current; ++detailGeneration.current; };
  }, [token, storeId, vendorView]);
  useEffect(() => { void load(); }, [load]);

  const openDetail = useCallback(async (id: string, quiet = false, reconcilingAction = false) => {
    if (!id.trim() || (actionGate.current.pending && !reconcilingAction)) return;
    const requestGeneration = ++detailGeneration.current;
    const requestScope = scope;
    setDetailTargetId(id);
    if (quiet) setDetailRefreshing(true);
    else { setDetailRefreshing(false); setDetailLoading(true); setDetailError(""); }
    try { 
      const response = await apiRequest<{ order: OrderDetail }>(`/api/vendor/orders/${id}`, token); 
      if (requestGeneration === detailGeneration.current && requestScope === currentScope.current) {
        setSelected(response.order);
        setDetailError("");
      }
    } catch {
      if (requestGeneration === detailGeneration.current && requestScope === currentScope.current) {
        if (!quiet) setSelected(null);
        setDetailError("We couldn't refresh this order. Please retry before taking an action.");
      }
    } finally { 
      if (requestGeneration === detailGeneration.current && requestScope === currentScope.current) {
        setDetailLoading(false);
        setDetailRefreshing(false);
      }
    }
  }, [scope, token]);

  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState !== "visible" || actionGate.current.pending) return;
      void load(true);
      if (detailTargetId) void openDetail(detailTargetId, true);
    };
    const timer = window.setInterval(refreshVisible, 45_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [load, openDetail, detailTargetId]);

  const action = async (name: VendorOrderAction, note?: string) => {
    if (!selected || busy || detailLoading || detailRefreshing || detailError || error ||
      !vendorActions(selected.status, vendorView).some(item => item.action === name) || !actionGate.current.start()) return;
    const id = selected.id;
    const requestScope = scope;
    const requestGeneration = ++detailGeneration.current;
    ++listGeneration.current;
    setBusy(true); setPendingAction(name); setActionError("");
    let needsFreshDetail = false;
    try { 
      const response = await apiRequest<{ order: OrderDetail }>(`/api/vendor/orders/${id}/actions`, token, { method: "POST", body: JSON.stringify({ action: name, ...(note ? { note } : {}) }) });
      if (requestGeneration !== detailGeneration.current || requestScope !== currentScope.current) return;
      setSelected(response.order);
      onMessage("Order status updated.", "success"); 
    } catch {
      if (requestGeneration !== detailGeneration.current || requestScope !== currentScope.current) return;
      setActionError("We couldn't update this order. Its status may have changed. Review the refreshed order before trying again.");
      needsFreshDetail = true;
    } finally { 
      if (needsFreshDetail && requestScope === currentScope.current && requestGeneration === detailGeneration.current)
        await openDetail(id, true, true);
      actionGate.current.finish();
      setBusy(false); setPendingAction(null);
      if (requestScope === currentScope.current) {
        await load(true);
      }
    }
  };

  const closeDetail = () => {
    if (actionGate.current.pending) return;
    ++detailGeneration.current;
    setSelected(null); setDetailTargetId(""); setDetailError(""); setActionError(""); setDetailLoading(false); setDetailRefreshing(false);
    void load(true);
  };

  if (renderedScope.current !== scope) return <div className="vendor-empty-state" aria-live="polite">Loading your store's orders...</div>;

  if (detailTargetId) return <section className="vendor-operations-section" aria-label="Vendor order details">
    <div className="vendor-section-header">
      <button className="vendor-secondary-button" type="button" disabled={busy} onClick={closeDetail}>Back to Orders</button>
       <button className="vendor-secondary-button" type="button" disabled={busy || detailLoading || detailRefreshing} onClick={() => void openDetail(detailTargetId)}>{detailLoading || detailRefreshing ? "Refreshing..." : "Refresh Order"}</button>
    </div>
    {!!actionError && <div role="alert" className="vendor-notice vendor-notice-error">{actionError}</div>}
    {!!detailError && <div role="alert" className="vendor-notice vendor-notice-error"><span>{detailError}</span><button className="vendor-secondary-button" type="button" disabled={detailLoading || detailRefreshing} onClick={() => void openDetail(detailTargetId)}>Retry detail</button></div>}
    {detailLoading ? <div aria-live="polite" className="vendor-card vendor-empty-state"><strong>Loading order details...</strong></div> :
       selected && <VendorDetail key={selected.id} detail={selected} token={token} busy={busy || detailLoading || detailRefreshing || !!detailError || !!error} pendingAction={pendingAction} vendorView={vendorView} onAction={action} onClose={closeDetail} />}
  </section>;

  return (
    <div className="vendor-operations-section">
      <div className="vendor-section-header">
        <div>
          <h2 className="vendor-title">{vendorView === "delivery" ? "Delivery Operations" : "Order Management"}</h2>
          <p className="vendor-text-muted">{vendorView === "delivery" ? "Manage orders ready for dispatch and track active deliveries." : "Review new orders, accept or reject, prepare, and mark ready. Updates every 45 seconds while this page is visible."}</p>
        </div>
        <button className="vendor-secondary-button" disabled={loading} onClick={() => void load()} type="button">{loading ? "Refreshing..." : "Refresh List"}</button>
      </div>
      {vendorView === "orders" && <button className="vendor-card vendor-new-order-summary" type="button" onClick={() => { setStatus("PLACED"); setPage(1); }}>
        <span className="vendor-eyebrow">NEW ORDERS</span><strong>{counts.PLACED ?? 0}</strong><span className="vendor-text-muted">View orders waiting for your response</span>
      </button>}

      <div className={`vendor-card vendor-list-card ${vendorView === "orders" ? "vendor-orders-queue" : ""}`}>
        <div className="vendor-list-toolbar">
          <div className="vendor-tabs">
            {vendorView === "orders" && <button type="button" aria-pressed={status === "ALL"} className={status === "ALL" ? "active" : ""} onClick={() => { setStatus("ALL"); setPage(1); }}>All Orders</button>}
            {activeTabs.map(t => (
              <button type="button" key={t} aria-pressed={status === t} className={status === t ? "active" : ""} onClick={() => { setStatus(t); setPage(1); }}>
                {vendorStatusLabel(t)} {counts[t] ? <span className="vendor-tab-count">{counts[t]}</span> : null}
              </button>
            ))}
          </div>
        </div>
        
        {error && <div className="vendor-notice vendor-notice-error" role="alert"><span>{error}</span><button className="vendor-secondary-button" onClick={() => void load()} type="button">Retry</button></div>}
        
        {loading ? (
          <div aria-live="polite" className="vendor-empty-state"><strong>Loading orders...</strong></div>
        ) : orders.length === 0 ? (
          <div className="vendor-empty-state"><strong>{vendorEmptyMessage(status)}</strong><span>{status === "PLACED" ? "New customer orders will appear here. You can refresh at any time." : "Try selecting a different status filter."}</span></div>
        ) : (
          <div className="vendor-table-wrapper">
             <table className="vendor-data-table">
               <thead>
                 <tr>
                    <th>Order</th>
                   <th>Customer</th>
                   <th>Status</th>
                   <th>Amount</th>
                   <th>Created</th>
                   <th className="vendor-text-right">Action</th>
                 </tr>
               </thead>
               <tbody>
                 {orders.map(order => (
                   <tr key={order.id}>
                      <td data-label="Order"><span className="vendor-mono-text">#{order.id.slice(0, 8).toUpperCase()}</span></td>
                      <td data-label="Customer">
                        <div className="vendor-customer-cell">
                          <strong>{order.deliveryContactName}</strong>
                           <span className="vendor-text-muted">{order.itemCount} items · {order.paymentMethod}</span>
                            <span className="vendor-text-muted">{deliveryLabel(order.deliveryType)}</span>
                            <span className="vendor-text-muted">{deliverySnapshot(order)}</span>
                        </div>
                     </td>
                      <td data-label="Status"><span className={`vendor-status-badge vendor-status-${order.status.toLowerCase()}`}>{vendorStatusLabel(order.status)}</span></td>
                      <td data-label="Total"><strong>{money(order.totalAmount)}</strong></td>
                      <td data-label="Placed">
                        <div className="vendor-date-cell">
                           <time dateTime={order.createdAt}>{date(order.createdAt)}</time>
                        </div>
                     </td>
                      <td data-label="Action" className="vendor-text-right">
                         <button className="vendor-secondary-button vendor-compact-button" type="button" onClick={() => void openDetail(order.id)}>View Order</button>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
          </div>
        )}
        
        <div className="vendor-pagination">
           <span className="vendor-text-muted">Total {pagination.total} records</span>
           <div className="vendor-pagination-controls">
             <button className="vendor-secondary-button" disabled={page <= 1 || loading} onClick={() => setPage(c => c - 1)} type="button">Prev</button>
             <span className="vendor-page-indicator">Page {page} of {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}</span>
             <button className="vendor-secondary-button" disabled={loading || page >= Math.ceil(pagination.total / pagination.pageSize)} onClick={() => setPage(c => c + 1)} type="button">Next</button>
           </div>
        </div>
      </div>

    </div>
  );
}

interface Props { 
  token: string; 
  vendor: boolean; 
  vendorView?: "orders" | "delivery";
  stores?: Store[]; 
  storeId?: string; 
  onMessage: (message: string, kind?: "success" | "error") => void; 
}

export function OrderOperations(props: Props) {
  if (props.vendor) {
    return <VendorOrderOperations {...props} />;
  }
  return <AdminOrderOperations {...props} />;
}