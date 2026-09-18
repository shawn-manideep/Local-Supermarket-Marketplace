import { useEffect, useMemo, useState } from "react";
import {
  apiRequest,
  type OrderDetail,
  type OrderListEnvelope,
  type OrderStatus,
  type OrderSummary,
  type Store,
} from "./api";

const statuses: Array<OrderStatus | "ALL"> = ["ALL", "PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "REJECTED", "CANCELLED"];
const money = (value: string | number) => `₹${Number(value).toFixed(2)}`;
const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const statusLabel = (value: string) => value.replaceAll("_", " ");
const deliveryLabel = (value: string) => value === "vendor_staff" ? "Vendor delivery" : "Platform partner";

function SummaryTiles({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="order-summary-grid">
      <div className="summary-tile"><span>All orders</span><strong>{Object.values(counts).reduce((sum, count) => sum + count, 0)}</strong></div>
      <div className="summary-tile"><span>Needs attention</span><strong>{(counts.PLACED ?? 0) + (counts.ACCEPTED ?? 0)}</strong></div>
      <div className="summary-tile"><span>In motion</span><strong>{(counts.PREPARING ?? 0) + (counts.READY ?? 0) + (counts.OUT_FOR_DELIVERY ?? 0)}</strong></div>
      <div className="summary-tile"><span>Completed</span><strong>{counts.DELIVERED ?? 0}</strong></div>
    </div>
  );
}

function Detail({ detail, vendor, busy, onAction, onClose }: {
  detail: OrderDetail;
  vendor: boolean;
  busy: boolean;
  onAction: (action: string, note?: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const actions: Partial<Record<OrderStatus, Array<{ action: string; label: string; className: string }>>> = {
    PLACED: [{ action: "ACCEPT", label: "Accept order", className: "primary-button" }, { action: "REJECT", label: "Reject", className: "danger-button" }],
    ACCEPTED: [{ action: "PREPARE", label: "Start preparing", className: "primary-button" }],
    PREPARING: [{ action: "READY", label: "Mark ready", className: "primary-button" }],
    READY: [{ action: "OUT_FOR_DELIVERY", label: "Out for delivery", className: "primary-button" }],
    OUT_FOR_DELIVERY: [{ action: "DELIVER", label: "Mark delivered", className: "primary-button" }],
  };
  const available = vendor ? actions[detail.status] ?? [] : [];
  return (
    <div className="card order-detail" data-testid={`card-order-detail-${detail.id}`}>
      <div className="card-heading">
        <div><p className="eyebrow">Immutable order detail</p><h3>Order {detail.id.slice(0, 8)}</h3><p className="muted">{date(detail.createdAt)}</p></div>
        <button className="text-button" data-testid="button-close-order-detail" onClick={onClose}>Close</button>
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
            {!vendor && <><div><dt>Commission rate</dt><dd>{detail.commissionRateSnapshot == null ? "Not recorded" : `${detail.commissionRateSnapshot}%`}</dd></div><div><dt>Commission amount</dt><dd>{detail.commissionAmountSnapshot == null ? "Not recorded" : money(detail.commissionAmountSnapshot)}</dd></div></>}
          </dl>
          <h3>Status history</h3>
          <div className="history-list">{detail.statusHistory.map((entry, index) => <div key={`${entry.createdAt}-${index}`}><strong>{statusLabel(entry.status)}</strong>{entry.note && <span> — {entry.note}</span>}<small>{date(entry.createdAt)}</small></div>)}</div>
        </div>
      </div>
      {vendor && available.length > 0 && <div className="order-actions">
        {available.some((item) => item.action === "REJECT") && <input className="order-note" data-testid="input-rejection-note" maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Optional rejection note" value={note} />}
        {available.map((item) => <button className={item.className} data-testid={`button-order-action-${item.action.toLowerCase()}`} disabled={busy} key={item.action} onClick={() => onAction(item.action, item.action === "REJECT" ? note.trim() || undefined : undefined)}>{busy ? "Working…" : item.label}</button>)}
      </div>}
    </div>
  );
}

interface Props { token: string; vendor: boolean; stores?: Store[]; storeId?: string; onMessage: (message: string, kind?: "success" | "error") => void; }

export function OrderOperations({ token, vendor, stores = [], storeId, onMessage }: Props) {
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
  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (status !== "ALL") params.set("status", status);
    if (!vendor && adminStore) params.set("storeId", adminStore);
    if (!vendor && from) params.set("from", `${from}T00:00:00.000Z`);
    if (!vendor && to) params.set("to", `${to}T23:59:59.999Z`);
    return params.toString();
  }, [adminStore, from, page, status, to, vendor]);
  const load = async () => {
    setLoading(true); setError("");
    try {
      const response = await apiRequest<OrderListEnvelope>(`${vendor ? "/api/vendor/orders" : "/api/admin/orders"}?${query}`, token);
      setOrders(response.orders); setCounts(response.counts); setPagination(response.pagination);
    } catch (cause) { const message = cause instanceof Error ? cause.message : "Unable to load orders."; setError(message); onMessage(message, "error"); }
    finally { setLoading(false); }
  };
  useEffect(() => { setPage(1); setSelected(null); setDetailTargetId(""); setDetailError(""); }, [token, vendor, storeId]);
  useEffect(() => { void load(); }, [query, token, vendor, storeId]);
  const openDetail = async (id: string) => {
    setDetailTargetId(id); setDetailLoading(true); setDetailError("");
    try { const response = await apiRequest<{ order: OrderDetail }>(`${vendor ? "/api/vendor/orders" : "/api/admin/orders"}/${id}`, token); setSelected(response.order); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to load order detail.";
      setSelected(null); setDetailError(message); onMessage(message, "error");
    } finally { setDetailLoading(false); }
  };
  const action = async (name: string, note?: string) => {
    if (!selected || busy) return;
    setBusy(true);
    try { await apiRequest(`${`/api/vendor/orders/${selected.id}/actions`}`, token, { method: "POST", body: JSON.stringify({ action: name, ...(note ? { note } : {}) }) }); onMessage("Order status updated."); await openDetail(selected.id); await load(); }
    catch (cause) { onMessage(cause instanceof Error ? cause.message : "This order changed elsewhere. Refreshing detail.", "error"); await openDetail(selected.id); }
    finally { setBusy(false); }
  };
  return (
    <section className="order-section">
      <div className="section-heading"><div><p className="eyebrow">{vendor ? "Vendor operations" : "Platform operations"}</p><h2>{vendor ? "Orders in motion" : "Order oversight"}</h2><p className="muted">{vendor ? "Review the newest orders and move each one forward with confidence." : "Read-only platform visibility across every store and order."}</p></div><button className="secondary-button" data-testid="button-refresh-orders" disabled={loading} onClick={() => void load()}>{loading ? "Refreshing…" : "Refresh orders"}</button></div>
      <SummaryTiles counts={counts} />
      {vendor && <div className="delivery-queue" aria-label="Delivery queue">
        <div><p className="eyebrow">Delivery queue</p><strong>Vendor-owned delivery</strong></div>
        {(["READY", "OUT_FOR_DELIVERY", "DELIVERED"] as const).map((deliveryStatus) =>
          <button className={status === deliveryStatus ? "active" : ""} key={deliveryStatus} onClick={() => { setStatus(deliveryStatus); setPage(1); }}>
            <span>{statusLabel(deliveryStatus)}</span><strong>{counts[deliveryStatus] ?? 0}</strong>
          </button>)}
      </div>}
      <div className="card">
        <div className="order-toolbar"><div className="order-filters">
          <label>Status<select data-testid="select-order-status" onChange={(event) => { setStatus(event.target.value); setPage(1); }} value={status}>{statuses.map((item) => <option key={item} value={item}>{item === "ALL" ? "All statuses" : statusLabel(item)}</option>)}</select></label>
          {!vendor && <label>Store<select data-testid="select-order-store" onChange={(event) => { setAdminStore(event.target.value); setPage(1); }} value={adminStore}><option value="">All stores</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>}
          {!vendor && <><label>From<input data-testid="input-orders-from" onChange={(event) => { setFrom(event.target.value); setPage(1); }} type="date" value={from} /></label><label>To<input data-testid="input-orders-to" onChange={(event) => { setTo(event.target.value); setPage(1); }} type="date" value={to} /></label></>}
        </div><span className="muted">{pagination.total} total</span></div>
        {error && <div className="order-error" role="alert"><span>{error}</span><button className="secondary-button" onClick={() => void load()}>Retry</button></div>}
        {loading ? <div className="empty-state"><strong>Loading order queue…</strong><span>Checking the latest operational state.</span></div> : orders.length === 0 ? <div className="empty-state"><strong>No orders in this view</strong><span>Try another status or refresh when new orders arrive.</span></div> : <div className="order-table"><div className="order-row"><strong>Order</strong><strong>Customer</strong><strong>Status</strong><strong>Amount</strong><strong>Created</strong></div>{orders.map((order) => <div className="order-row" data-testid={`row-order-${order.id}`} key={order.id}><button className="text-button order-id" onClick={() => void openDetail(order.id)}>#{order.id.slice(0, 8)}</button><div className="order-customer"><strong>{order.deliveryContactName}</strong><small>{order.itemCount} items · {order.deliveryAddressSnapshot.pincode}</small></div><span className={`status status-${order.status.toLowerCase()}`}>{statusLabel(order.status)}</span><div className="order-amount"><strong>{money(order.totalAmount)}</strong><small>{order.paymentMethod}</small></div><small>{date(order.createdAt)}</small></div>)}</div>}
        <div className="order-pagination"><button className="secondary-button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button><span className="muted">Page {page} of {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}</span><button className="secondary-button" disabled={loading || page >= Math.ceil(pagination.total / pagination.pageSize)} onClick={() => setPage((current) => current + 1)}>Next</button></div>
      </div>
      {detailLoading && <div className="card empty-state"><strong>Loading order detail…</strong><span>Retrieving the latest status and historical snapshots.</span></div>}
      {!detailLoading && detailError && <div className="card order-error" role="alert"><span>{detailError}</span><button className="secondary-button" onClick={() => void openDetail(detailTargetId)}>Retry detail</button></div>}
      {!detailLoading && selected && <Detail detail={selected} vendor={vendor} busy={busy} onAction={action} onClose={() => { setSelected(null); setDetailTargetId(""); setDetailError(""); }} />}
    </section>
  );
}