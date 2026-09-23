import { useEffect, useMemo, useRef, useState } from "react";
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

function VendorDetail({ detail, busy, onAction, onClose }: {
  detail: OrderDetail;
  busy: boolean;
  onAction: (action: string, note?: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const actions: Partial<Record<OrderStatus, Array<{ action: string; label: string; className: string }>>> = {
    PLACED: [{ action: "ACCEPT", label: "Accept Order", className: "vendor-primary-button" }, { action: "REJECT", label: "Reject Order", className: "vendor-danger-button" }],
    ACCEPTED: [{ action: "PREPARE", label: "Start Preparing", className: "vendor-primary-button" }],
    PREPARING: [{ action: "READY", label: "Mark as Ready", className: "vendor-primary-button" }],
    READY: [{ action: "OUT_FOR_DELIVERY", label: "Out for Delivery", className: "vendor-primary-button" }],
    OUT_FOR_DELIVERY: [{ action: "DELIVER", label: "Mark as Delivered", className: "vendor-primary-button" }],
  };
  const available = actions[detail.status] ?? [];
  const timelineSteps: OrderStatus[] = ["PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"];

  return (
    <div className="vendor-card vendor-order-detail-view" data-testid={`card-order-detail-${detail.id}`}>
      <div className="vendor-detail-header">
        <div>
          <p className="vendor-eyebrow">Order Reference: {detail.id}</p>
          <h2 className="vendor-title">Order {detail.id.slice(0, 8)}</h2>
          <span className={`vendor-status-badge vendor-status-${detail.status.toLowerCase()}`}>{statusLabel(detail.status)}</span>
        </div>
        <button className="vendor-text-button" onClick={onClose} type="button">Close Detail</button>
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
             </div>
             <div className="vendor-info-full">
               <dt>Address</dt>
               <dd>{detail.deliveryAddressSnapshot.line1}{detail.deliveryAddressSnapshot.line2 ? `, ${detail.deliveryAddressSnapshot.line2}` : ""}, {detail.deliveryAddressSnapshot.city}, {detail.deliveryAddressSnapshot.state} {detail.deliveryAddressSnapshot.pincode}</dd>
             </div>
          </div>

          <div className="vendor-info-block">
            <h3 className="vendor-subtitle">Items Ordered</h3>
            <div className="vendor-receipt-items">
              {detail.items.map((item) => (
                <div className="vendor-receipt-row" key={item.id}>
                  <div className="vendor-receipt-desc">
                    <strong>{item.productNameSnapshot}</strong>
                    <span className="vendor-text-muted">{item.quantity} × {money(item.productPriceSnapshot)}</span>
                  </div>
                  <strong>{money(item.subtotal)}</strong>
                </div>
              ))}
            </div>
            <div className="vendor-receipt-totals">
               <div className="vendor-receipt-row vendor-text-muted"><span>Subtotal</span><span>{money(detail.subtotal)}</span></div>
               <div className="vendor-receipt-row vendor-text-muted"><span>Delivery Fee</span><span>{money(detail.deliveryFeeSnapshot)}</span></div>
               <div className="vendor-receipt-row vendor-grand-total"><span>Total</span><span>{money(detail.totalAmount)}</span></div>
            </div>
          </div>
        </div>

        <div className="vendor-detail-side">
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
                            <span>{date(h.createdAt)} at {time(h.createdAt)}</span>
                            {h.note && <span className="vendor-timeline-note">{h.note}</span>}
                         </div>
                      </div>
                    )
                 })}
              </div>
           </div>

           {available.length > 0 && (
             <div className="vendor-action-block">
                <h3 className="vendor-subtitle">Required Action</h3>
                <div className="vendor-action-buttons">
                  {available.some(item => item.action === "REJECT") && (
                    <input className="vendor-input vendor-rejection-note" maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Reason for rejection (optional)" value={note} disabled={busy} />
                  )}
                  {available.map(item => (
                    <button 
                      key={item.action} 
                      className={item.className} 
                      disabled={busy}
                      type="button"
                      onClick={() => onAction(item.action, item.action === "REJECT" ? note.trim() || undefined : undefined)}
                    >
                      {busy ? "Updating..." : item.label}
                    </button>
                  ))}
                </div>
             </div>
           )}
        </div>
      </div>
    </div>
  );
}

function VendorOrderOperations({ token, vendorView = "orders", storeId, onMessage }: { token: string; vendorView?: "orders" | "delivery"; storeId?: string; onMessage: (message: string, kind?: "success" | "error") => void; }) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState("ALL");
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

  const load = async () => {
    const requestGeneration = ++listGeneration.current;
    setLoading(true); setError("");
    try {
      const response = await apiRequest<OrderListEnvelope>(`/api/vendor/orders?${query}`, token);
      if (requestGeneration === listGeneration.current) {
        setOrders(response.orders); setCounts(response.counts); setPagination(response.pagination);
      }
    } catch (cause) { 
      if (requestGeneration === listGeneration.current) { 
        const message = cause instanceof Error ? cause.message : "Unable to load orders."; 
        setError(message); onMessage(message, "error"); 
      } 
    } finally { 
      if (requestGeneration === listGeneration.current) setLoading(false); 
    }
  };

  useEffect(() => { ++listGeneration.current; ++detailGeneration.current; setPage(1); setSelected(null); setDetailTargetId(""); setDetailError(""); }, [token, storeId]);
  useEffect(() => { ++detailGeneration.current; }, [query]);
  useEffect(() => { void load(); }, [query, token, storeId]);

  const openDetail = async (id: string) => {
    if (!id.trim()) return;
    const requestGeneration = ++detailGeneration.current;
    setDetailTargetId(id); setDetailLoading(true); setDetailError("");
    try { 
      const response = await apiRequest<{ order: OrderDetail }>(`/api/vendor/orders/${id}`, token); 
      if (requestGeneration === detailGeneration.current) setSelected(response.order); 
    } catch (cause) {
      if (requestGeneration === detailGeneration.current) {
        const message = cause instanceof Error ? cause.message : "Unable to load order detail.";
        setSelected(null); setDetailError(message); onMessage(message, "error");
      }
    } finally { 
      if (requestGeneration === detailGeneration.current) setDetailLoading(false); 
    }
  };

  const action = async (name: string, note?: string) => {
    if (!selected || busy) return;
    setBusy(true);
    try { 
      await apiRequest(`${`/api/vendor/orders/${selected.id}/actions`}`, token, { method: "POST", body: JSON.stringify({ action: name, ...(note ? { note } : {}) }) }); 
      onMessage("Order status updated.", "success"); 
      await openDetail(selected.id); 
      await load(); 
    } catch (cause) { 
      onMessage(cause instanceof Error ? cause.message : "This order changed elsewhere. Refreshing detail.", "error"); 
      await openDetail(selected.id); 
    } finally { 
      setBusy(false); 
    }
  };

  return (
    <div className="vendor-operations-section">
      <div className="vendor-section-header">
        <div>
          <h2 className="vendor-title">{vendorView === "delivery" ? "Delivery Operations" : "Order Management"}</h2>
          <p className="vendor-text-muted">{vendorView === "delivery" ? "Manage orders ready for dispatch and track active deliveries." : "Process active orders through your kitchen workflow."}</p>
        </div>
        <button className="vendor-secondary-button" disabled={loading} onClick={() => void load()} type="button">{loading ? "Refreshing..." : "Refresh List"}</button>
      </div>

      <div className="vendor-card vendor-list-card">
        <div className="vendor-list-toolbar">
          <div className="vendor-tabs">
            {vendorView === "orders" && <button type="button" className={status === "ALL" ? "active" : ""} onClick={() => { setStatus("ALL"); setPage(1); }}>All Orders</button>}
            {activeTabs.map(t => (
              <button type="button" key={t} className={status === t ? "active" : ""} onClick={() => { setStatus(t); setPage(1); }}>
                {statusLabel(t)} {counts[t] ? <span className="vendor-tab-count">{counts[t]}</span> : null}
              </button>
            ))}
          </div>
        </div>
        
        {error && <div className="vendor-notice vendor-notice-error" role="alert"><span>{error}</span><button className="vendor-secondary-button" onClick={() => void load()} type="button">Retry</button></div>}
        
        {loading ? (
          <div aria-live="polite" className="vendor-empty-state"><strong>Loading orders...</strong></div>
        ) : orders.length === 0 ? (
          <div className="vendor-empty-state"><strong>No orders found</strong><span>Try selecting a different status filter.</span></div>
        ) : (
          <div className="vendor-table-wrapper">
             <table className="vendor-data-table">
               <thead>
                 <tr>
                   <th>Order ID</th>
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
                     <td><span className="vendor-mono-text">#{order.id.slice(0, 8)}</span></td>
                     <td>
                        <div className="vendor-customer-cell">
                          <strong>{order.deliveryContactName}</strong>
                          <span className="vendor-text-muted">{order.itemCount} items · {order.paymentMethod}</span>
                        </div>
                     </td>
                     <td><span className={`vendor-status-badge vendor-status-${order.status.toLowerCase()}`}>{statusLabel(order.status)}</span></td>
                     <td><strong>{money(order.totalAmount)}</strong></td>
                     <td>
                        <div className="vendor-date-cell">
                          <span>{date(order.createdAt)}</span>
                          <span className="vendor-text-muted">{time(order.createdAt)}</span>
                        </div>
                     </td>
                     <td className="vendor-text-right">
                        <button className="vendor-secondary-button vendor-compact-button" onClick={() => void openDetail(order.id)}>View</button>
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

      {detailLoading && <div className="vendor-card vendor-empty-state"><strong>Loading order detail...</strong></div>}
      {!detailLoading && detailError && <div className="vendor-card vendor-notice vendor-notice-error" role="alert"><span>{detailError}</span><button className="vendor-secondary-button" disabled={!detailTargetId} onClick={() => { if (detailTargetId) void openDetail(detailTargetId); }} type="button">Retry detail</button></div>}
      {!detailLoading && selected && <VendorDetail detail={selected} busy={busy} onAction={action} onClose={() => { ++detailGeneration.current; setSelected(null); setDetailTargetId(""); setDetailError(""); }} />}
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