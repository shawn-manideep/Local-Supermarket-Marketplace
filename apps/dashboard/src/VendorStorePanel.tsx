import { useEffect, useRef, useState } from "react";
import { BrandingLogo } from "./BrandingLogo";
import {
  apiRequest,
  timeInputValue,
  type OperatingHour,
  type ServicePincode,
  type Store,
  type OrderListEnvelope,
} from "./api";
import { CatalogManagementPanel } from "./CatalogManagementPanel";
import { OrderOperations } from "./OrderOperations";
import { StoreProfileFields } from "./StoreProfileFields";
import { VendorDocumentsPanel, type VendorDocumentStatus } from "./VendorDocumentsPanel";

const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface HourDraft {
  isClosed: boolean;
  opensAt: string;
  closesAt: string;
}

function emptyHourDraft(): HourDraft {
  return { isClosed: true, opensAt: "09:00", closesAt: "18:00" };
}

function defaultHours() {
  return dayNames.reduce<Record<number, HourDraft>>((result, _day, index) => {
    result[index] = emptyHourDraft();
    return result;
  }, {});
}

function toHourDraft(hour?: OperatingHour): HourDraft {
  if (!hour) return emptyHourDraft();
  return {
    isClosed: hour.isClosed,
    opensAt: timeInputValue(hour.opensAt),
    closesAt: timeInputValue(hour.closesAt),
  };
}

interface VendorStorePanelProps {
  token: string;
  profile: { userId: string; role: string; storeId: string | null };
  onMessage: (message: string, kind?: "success" | "error") => void;
  onSignOut: () => void;
  notice: { message: string; kind: "success" | "error" } | null;
  onDismissNotice: () => void;
}

type Tab = "dashboard" | "store" | "catalog" | "orders" | "settings" | "documents";

export function VendorStorePanel({ token, profile, onMessage, onSignOut, notice, onDismissNotice }: VendorStorePanelProps) {
  const [currentTab, setCurrentTab] = useState<Tab>("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuButton = useRef<HTMLButtonElement>(null);
  const mobileSidebar = useRef<HTMLElement>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [pincodes, setPincodes] = useState<ServicePincode[]>([]);
  const [hours, setHours] = useState<Record<number, HourDraft>>(defaultHours);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [documentStatus, setDocumentStatus] = useState<VendorDocumentStatus | null>(null);
  const [newOrders, setNewOrders] = useState<Array<{ id: string; contact: string; total: string | number }>>([]);
  const [initialOrderId, setInitialOrderId] = useState<string | undefined>();
  const seenOrderIds = useRef<Set<string>>(new Set());
  const navigateVendor = (tab: Tab) => {
    setCurrentTab(tab);
    setMobileMenuOpen(false);
    if (window.matchMedia("(max-width: 900px)").matches)
      window.requestAnimationFrame(() => mobileMenuButton.current?.focus());
  };
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const mobileViewport = window.matchMedia("(max-width: 900px)");
    if (!mobileViewport.matches) {
      setMobileMenuOpen(false);
      return;
    }
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (!event.matches) setMobileMenuOpen(false);
    };
    mobileViewport.addEventListener("change", closeOnDesktop);
    const firstControl = mobileSidebar.current?.querySelector<HTMLElement>("button");
    firstControl?.focus();
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

  const loadStore = async (currentToken = token, isCurrent: () => boolean = () => true) => {
    if (!store) setLoading(true);
    setLoadError("");
    try {
      const [storeResponse, pincodeResponse, hoursResponse, documentResponse] = await Promise.all([
        apiRequest<{ store: Store }>("/api/vendor/store", currentToken),
        apiRequest<{ pincodes: ServicePincode[] }>("/api/vendor/store/pincodes", currentToken),
        apiRequest<{ hours: OperatingHour[] }>("/api/vendor/store/hours", currentToken),
        apiRequest<VendorDocumentStatus>("/api/vendor/documents", currentToken),
      ]);
      if (!isCurrent()) return;
      const loadedHours = defaultHours();
      for (const hour of hoursResponse.hours) {
        loadedHours[hour.dayOfWeek] = toHourDraft(hour);
      }
      setStore(storeResponse.store);
      setDocumentStatus(documentResponse);
      if (!documentResponse.canManageCatalog) setCurrentTab("documents");
      setPincodes(pincodeResponse.pincodes);
      setHours(loadedHours);
    } catch (error) {
      if (!isCurrent()) return;
      setLoadError(error instanceof Error ? error.message : "Unable to load store data.");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  useEffect(() => {
    let current = true;
    void loadStore(token, () => current);
    return () => { current = false; };
  }, [token]);

  useEffect(() => {
    let active = true;
    let initialized = false;
    const controller = new AbortController();
    setNewOrders([]);
    const check = async () => {
      if (!active || controller.signal.aborted || document.visibilityState !== "visible") return;
      try {
        const result = await apiRequest<OrderListEnvelope>("/api/vendor/orders?pageSize=50&dateFilter=RECENT", token, { signal: controller.signal });
        if (!active || controller.signal.aborted) return;
        const placed = result.orders.filter((order) => order.status === "PLACED");
        if (!initialized) {
          placed.forEach((order) => seenOrderIds.current.add(order.id));
          initialized = true;
          return;
        }
        const fresh = placed.filter((order) => !seenOrderIds.current.has(order.id));
        placed.forEach((order) => seenOrderIds.current.add(order.id));
        if (fresh.length) setNewOrders((current) => {
          const queued = new Set(current.map((order) => order.id));
          return [...current, ...fresh.filter((order) => !queued.has(order.id)).map((order) => ({ id: order.id, contact: order.deliveryContactName, total: order.totalAmount }))];
        });
      } catch { /* Existing workspace remains usable; the next poll retries. */ }
    };
    seenOrderIds.current.clear();
    void check();
    const timer = window.setInterval(() => void check(), 12_000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); seenOrderIds.current.clear(); };
  }, [token, profile.storeId]);

  if (loading) {
    return (
      <div className="vendor-layout-loading">
        <div className="vendor-loading-spinner"></div>
        <p>Loading operations environment...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="vendor-layout-loading">
        <div className="vendor-empty-state">
          <strong>Initialization failed</strong>
          <span className="vendor-text-muted">{loadError}</span>
          <button className="vendor-secondary-button" onClick={() => void loadStore()} type="button" style={{ marginTop: "12px" }}>Retry loading</button>
        </div>
      </div>
    );
  }

  if (!store) {
    return (
      <div className="vendor-layout-loading">
        <div className="vendor-empty-state">
          <strong>No store data</strong>
          <span className="vendor-text-muted">The server did not return a valid store.</span>
        </div>
      </div>
    );
  }
  const nextNewOrder = newOrders[0];

  return (
    <div className="vendor-layout is-vendor">
      <button
        ref={mobileMenuButton}
        className="vendor-mobile-menu-button"
        type="button"
        aria-expanded={mobileMenuOpen}
        aria-controls="vendor-primary-navigation"
        onClick={() => setMobileMenuOpen(true)}
      >Menu</button>
      {mobileMenuOpen && <button className="vendor-mobile-backdrop" type="button" aria-label="Close vendor navigation" onClick={() => { setMobileMenuOpen(false); window.requestAnimationFrame(() => mobileMenuButton.current?.focus()); }} />}
      <aside className={`vendor-sidebar${mobileMenuOpen ? " is-mobile-open" : ""}`} id="vendor-primary-navigation" ref={mobileSidebar} aria-label="Vendor navigation">
        <div className="vendor-application-brand"><BrandingLogo className="vendor-application-mark" /><span>Local Basket</span></div>
        <div className="vendor-brand">
          <div className="vendor-brand-logo">{store.name.slice(0,1).toUpperCase()}</div>
          <div>
            <strong>{store.name}</strong>
            <span>Vendor Operations</span>
          </div>
        </div>
        <nav className="vendor-nav">
          <button type="button" aria-current={currentTab === "dashboard" ? "page" : undefined} className={currentTab === "dashboard" ? "active" : ""} onClick={() => navigateVendor("dashboard")}>Dashboard</button>
          <button type="button" aria-current={currentTab === "orders" ? "page" : undefined} className={currentTab === "orders" ? "active" : ""} onClick={() => navigateVendor("orders")}>Orders</button>
          <button type="button" aria-current={currentTab === "catalog" ? "page" : undefined} className={currentTab === "catalog" ? "active" : ""} onClick={() => navigateVendor(documentStatus?.canManageCatalog ? "catalog" : "documents")}>Catalog</button>
          <button type="button" aria-current={currentTab === "documents" ? "page" : undefined} className={currentTab === "documents" ? "active" : ""} onClick={() => navigateVendor("documents")}>Documents</button>
          <button type="button" aria-current={currentTab === "store" ? "page" : undefined} className={currentTab === "store" ? "active" : ""} onClick={() => navigateVendor("store")}>Store Profile</button>
        </nav>
        <div className="vendor-sidebar-bottom">
          <button type="button" aria-current={currentTab === "settings" ? "page" : undefined} className={currentTab === "settings" ? "active" : ""} onClick={() => navigateVendor("settings")}>Account & Settings</button>
        </div>
      </aside>
      
      <main className="vendor-main">
        {nextNewOrder && <div className="vendor-notice vendor-new-order-banner" role="status">
          <span><strong>New order #{nextNewOrder.id.slice(0, 8).toUpperCase()}</strong> · {nextNewOrder.contact} · ₹{Number(nextNewOrder.total).toFixed(2)}{newOrders.length > 1 ? ` · ${newOrders.length - 1} more new order${newOrders.length === 2 ? "" : "s"}` : ""}</span>
          <button type="button" className="vendor-primary-button" onClick={() => { setCurrentTab("orders"); setInitialOrderId(nextNewOrder.id); setNewOrders((current) => current.slice(1)); }}>View Order</button>
          <button aria-label="Dismiss new order notice" type="button" onClick={() => setNewOrders((current) => current.slice(1))}>Dismiss</button>
        </div>}
        {notice && (
          <div className={`vendor-notice vendor-notice-${notice.kind}`} role="status">
            {notice.message}
            <button aria-label="Dismiss notification" onClick={onDismissNotice} type="button">×</button>
          </div>
        )}
        
        <div className="vendor-content-scroll">
          {currentTab === "dashboard" && <VendorDashboardHome token={token} store={store} onNavigate={setCurrentTab} onMessage={onMessage} />}
          {currentTab === "store" && (
            <VendorStoreProfile 
              token={token}
              store={store} 
              pincodes={pincodes} 
              hours={hours} 
              setStore={setStore}
              setPincodes={setPincodes}
              setHours={setHours}
              onMessage={onMessage} 
            />
          )}
          {documentStatus?.canManageCatalog && (
            <div hidden={currentTab !== "catalog"}>
              <CatalogManagementPanel token={token} storeId={store.id} onMessage={onMessage} />
            </div>
          )}
          {currentTab === "catalog" && !documentStatus?.canManageCatalog && <p role="alert">Complete your document verification before managing your catalog.</p>}
          {currentTab === "documents" && <VendorDocumentsPanel token={token} onMessage={onMessage} onChanged={setDocumentStatus} />}
          {currentTab === "orders" && <OrderOperations token={token} vendor vendorView="orders" storeId={store.id} initialOrderId={initialOrderId} onInitialOrderHandled={() => setInitialOrderId(undefined)} onMessage={onMessage} />}
          {currentTab === "settings" && <VendorSettings profile={profile} onSignOut={onSignOut} />}
        </div>
      </main>
    </div>
  );
}

// -----------------------------------------------------------------------------
// VendorDashboardHome
// -----------------------------------------------------------------------------
function VendorDashboardHome({ token, store, onNavigate, onMessage }: { token: string; store: Store; onNavigate: (tab: Tab) => void; onMessage: (msg: string, kind?: "error") => void }) {
  const [data, setData] = useState<OrderListEnvelope | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiRequest<OrderListEnvelope>("/api/vendor/orders?pageSize=50", token)
      .then(res => { if (active) setData(res); })
      .catch(err => { if (active) onMessage(err.message, "error"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const urgentOrders = data?.orders.filter(o => o.status === "PLACED" || o.status === "ACCEPTED").slice(0, 8) || [];
  
  const money = (value: string | number) => `₹${Number(value).toFixed(2)}`;
  const dateStr = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const statusLabel = (value: string) => value.replaceAll("_", " ");

  if (loading || !data) {
    return <div className="vendor-loading">Loading operational overview...</div>;
  }

  return (
    <div className="vendor-dashboard-home">
      <header className="vendor-dashboard-header">
        <div>
          <h1 className="vendor-title">Welcome, {store.name}</h1>
          <p className="vendor-text-muted">Here's your operational overview.</p>
        </div>
        <div className="vendor-store-status-pill">
           Store is <span className={`vendor-status-badge vendor-status-${store.status.toLowerCase()}`}>{store.status}</span>
        </div>
      </header>

      <div className="vendor-metrics-grid">
         <button className="vendor-metric-card urgent" onClick={() => onNavigate("orders")} type="button">
            <h3>Needs Attention</h3>
            <strong>{(data.counts.PLACED || 0) + (data.counts.ACCEPTED || 0)}</strong>
            <span>New & Accepted</span>
         </button>
         <button className="vendor-metric-card preparing" onClick={() => onNavigate("orders")} type="button">
            <h3>In Kitchen</h3>
            <strong>{data.counts.PREPARING || 0}</strong>
            <span>Currently Preparing</span>
         </button>
         <button className="vendor-metric-card ready" onClick={() => onNavigate("orders")} type="button">
            <h3>Ready & Delivery</h3>
            <strong>{(data.counts.READY || 0) + (data.counts.OUT_FOR_DELIVERY || 0)}</strong>
            <span>Waiting or In Transit</span>
         </button>
      </div>

      <div className="vendor-dashboard-urgent-orders">
         <h3 className="vendor-subtitle">Orders Requiring Action</h3>
         {urgentOrders.length === 0 ? (
            <div className="vendor-empty-state">
               <strong>All caught up!</strong>
               <span>No orders currently require immediate action.</span>
            </div>
         ) : (
            <div className="vendor-urgent-list">
               {urgentOrders.map(order => (
                 <button key={order.id} className="vendor-urgent-card" onClick={() => onNavigate("orders")} type="button">
                    <div className="vendor-urgent-card-header">
                       <strong>#{order.id.slice(0,8)}</strong>
                       <span className={`vendor-status vendor-status-${order.status.toLowerCase()}`}>{statusLabel(order.status)}</span>
                    </div>
                    <div className="vendor-urgent-card-body">
                       <span>{order.itemCount} items</span>
                       <strong>{money(order.totalAmount)}</strong>
                    </div>
                    <div className="vendor-urgent-card-footer">
                       <span>{order.deliveryContactName}</span>
                       <small>{dateStr(order.createdAt)}</small>
                    </div>
                 </button>
               ))}
            </div>
         )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// VendorStoreProfile
// -----------------------------------------------------------------------------
interface VendorStoreProfileProps {
  token: string;
  store: Store;
  pincodes: ServicePincode[];
  hours: Record<number, HourDraft>;
  setStore: React.Dispatch<React.SetStateAction<Store | null>>;
  setPincodes: React.Dispatch<React.SetStateAction<ServicePincode[]>>;
  setHours: React.Dispatch<React.SetStateAction<Record<number, HourDraft>>>;
  onMessage: (message: string, kind?: "success" | "error") => void;
}

function VendorStoreProfile({ token, store, pincodes, hours, setStore, setPincodes, setHours, onMessage }: VendorStoreProfileProps) {
  const [newPincode, setNewPincode] = useState("");
  const [storeBusy, setStoreBusy] = useState(false);
  const [pincodeBusy, setPincodeBusy] = useState(false);
  const [hoursBusyDay, setHoursBusyDay] = useState<number | null>(null);

  const updateStore = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (storeBusy) return;
    setStoreBusy(true);
    const form = new FormData(event.currentTarget);
    const latitudeRaw = String(form.get("latitude") ?? "").trim();
    const longitudeRaw = String(form.get("longitude") ?? "").trim();
    if (Boolean(latitudeRaw) !== Boolean(longitudeRaw)) {
      setStoreBusy(false);
      onMessage("Enter both latitude and longitude, or leave both blank.", "error");
      return;
    }
    try {
      const response = await apiRequest<{ store: Store }>("/api/vendor/store", token, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.get("name"),
          description: form.get("description") || null,
          logoImageUrl: form.get("logoImageUrl") || null,
          phone: form.get("phone") || null,
          ownerName: form.get("ownerName"),
          email: form.get("email") || null,
          addressLine1: form.get("addressLine1"),
          addressLine2: form.get("addressLine2") || null,
          locality: form.get("locality"),
          city: form.get("city"),
          state: form.get("state"),
          pincode: form.get("pincode"),
          minimumOrderValue: Number(form.get("minimumOrderValue")),
          latitude: latitudeRaw ? Number(latitudeRaw) : null,
          longitude: longitudeRaw ? Number(longitudeRaw) : null,
        }),
      });
      setStore(response.store);
      onMessage("Store information saved.", "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to save store information.", "error");
    } finally {
      setStoreBusy(false);
    }
  };

  const addPincode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pincodeBusy || !newPincode.trim()) return;
    setPincodeBusy(true);
    try {
      const response = await apiRequest<{ pincode: ServicePincode }>(
        "/api/vendor/store/pincodes",
        token,
        { method: "POST", body: JSON.stringify({ pincode: newPincode }) },
      );
      setPincodes((current) => [...current, response.pincode]);
      setNewPincode("");
      onMessage("Service pincode added.", "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to add pincode.", "error");
    } finally {
      setPincodeBusy(false);
    }
  };

  const removePincode = async (pincode: string) => {
    if (pincodeBusy) return;
    setPincodeBusy(true);
    try {
      await apiRequest(`/api/vendor/store/pincodes/${pincode}`, token, { method: "DELETE" });
      setPincodes((current) => current.filter((item) => item.pincode !== pincode));
      onMessage("Service pincode removed.", "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to remove pincode.", "error");
    } finally {
      setPincodeBusy(false);
    }
  };

  const saveHours = async (dayOfWeek: number) => {
    if (hoursBusyDay !== null) return;
    setHoursBusyDay(dayOfWeek);
    const draft = hours[dayOfWeek];
    try {
      const response = await apiRequest<{ hours: OperatingHour }>(
        `/api/vendor/store/hours/${dayOfWeek}`,
        token,
        {
          method: "PUT",
          body: JSON.stringify({
            isClosed: draft.isClosed,
            opensAt: draft.isClosed ? null : draft.opensAt,
            closesAt: draft.isClosed ? null : draft.closesAt,
          }),
        },
      );
      setHours((current) => ({ ...current, [dayOfWeek]: toHourDraft(response.hours) }));
      onMessage(`${dayNames[dayOfWeek]} hours saved.`, "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to save operating hours.", "error");
    } finally {
      setHoursBusyDay(null);
    }
  };

  return (
    <div className="vendor-store-profile">
      <div className="vendor-section-header">
        <div>
          <h2 className="vendor-title">Store Profile</h2>
          <p className="vendor-text-muted">Manage your store details, delivery areas, and operating hours.</p>
        </div>
      </div>

      <div className="vendor-profile-grid">
        <form className="vendor-card vendor-form-card" onSubmit={updateStore}>
          <div className="vendor-card-heading">
            <div>
              <h3 className="vendor-subtitle">Store Information</h3>
              <p className="vendor-text-muted">Store status and login identity are managed by the platform.</p>
            </div>
            <span className={`vendor-status-badge vendor-status-${store.status.toLowerCase()}`}>{store.status.replaceAll("_", " ")}</span>
          </div>
          <StoreProfileFields variant="vendor" disabled={storeBusy} values={store} />
          <div className="vendor-form-actions">
            <button className="vendor-primary-button" type="submit" disabled={storeBusy}>{storeBusy ? "Saving..." : "Save Store Information"}</button>
          </div>
        </form>

        <div className="vendor-card vendor-side-card">
          <div className="vendor-card-heading">
            <div>
              <h3 className="vendor-subtitle">Service Pincodes</h3>
              <p className="vendor-text-muted">Delivery areas served by this store.</p>
            </div>
            <span className="vendor-count-pill">{pincodes.length}</span>
          </div>
          <form className="vendor-inline-form" onSubmit={addPincode}>
            <input
              className="vendor-input"
              aria-label="New service pincode"
              maxLength={6}
              onChange={(event) => setNewPincode(event.target.value)}
              placeholder="e.g. 560001"
              value={newPincode}
              disabled={pincodeBusy}
            />
            <button className="vendor-secondary-button" type="submit" disabled={pincodeBusy || !newPincode.trim()}>{pincodeBusy ? "Working..." : "Add"}</button>
          </form>
          <div className="vendor-chip-list">
            {pincodes.length === 0 ? (
              <span className="vendor-text-muted">No service pincodes added.</span>
            ) : (
              pincodes.map((item: ServicePincode) => (
                <span className="vendor-chip" key={item.id}>
                  {item.pincode}
                  <button aria-label={`Remove ${item.pincode}`} onClick={() => removePincode(item.pincode)} type="button" disabled={pincodeBusy}>×</button>
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="vendor-card vendor-hours-card">
        <div className="vendor-card-heading">
          <div>
            <h3 className="vendor-subtitle">Weekly Operating Hours</h3>
            <p className="vendor-text-muted">Day 0 is Sunday. Closed days do not store opening times.</p>
          </div>
        </div>
        <div className="vendor-hours-list">
          {dayNames.map((day, dayOfWeek) => {
            const draft = hours[dayOfWeek];
            const isBusy = hoursBusyDay === dayOfWeek;
            return (
              <div className="vendor-hours-row" key={day}>
                <strong>{day}</strong>
                <label className="vendor-toggle-switch">
                  <input
                    checked={!draft.isClosed}
                    onChange={(event) =>
                      setHours((current) => ({
                        ...current,
                        [dayOfWeek]: { ...draft, isClosed: !event.target.checked },
                      }))
                    }
                    type="checkbox"
                    disabled={isBusy}
                  />
                  <div className="vendor-toggle-slider"></div>
                  <span>Open</span>
                </label>
                <div className="vendor-hours-inputs">
                  <input
                    className="vendor-input"
                    aria-label={`${day} opens at`}
                    disabled={draft.isClosed || isBusy}
                    onChange={(event) =>
                      setHours((current) => ({
                        ...current,
                        [dayOfWeek]: { ...draft, opensAt: event.target.value },
                      }))
                    }
                    type="time"
                    value={draft.opensAt}
                  />
                  <span className="vendor-text-muted">to</span>
                  <input
                    className="vendor-input"
                    aria-label={`${day} closes at`}
                    disabled={draft.isClosed || isBusy}
                    onChange={(event) =>
                      setHours((current) => ({
                        ...current,
                        [dayOfWeek]: { ...draft, closesAt: event.target.value },
                      }))
                    }
                    type="time"
                    value={draft.closesAt}
                  />
                  <button className="vendor-text-button" onClick={() => saveHours(dayOfWeek)} type="button" disabled={isBusy}>{isBusy ? "Saving..." : "Save"}</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// VendorSettings
// -----------------------------------------------------------------------------
interface VendorSettingsProps {
  profile: { role: string; userId: string; storeId: string | null };
  onSignOut: () => void;
}

function VendorSettings({ profile, onSignOut }: VendorSettingsProps) {
  return (
    <div className="vendor-settings-profile">
      <div className="vendor-section-header">
        <div>
          <h2 className="vendor-title">Account & Settings</h2>
          <p className="vendor-text-muted">Manage your vendor account session.</p>
        </div>
      </div>
      <div className="vendor-card">
         <div className="vendor-card-heading">
            <h3 className="vendor-subtitle">Authenticated User</h3>
         </div>
         <div className="vendor-detail-list" style={{ display: "grid", gap: "12px", borderTop: "1px solid var(--border-light)", paddingTop: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><dt style={{ color: "var(--text-muted)", fontSize: "12px" }}>Role</dt><dd style={{ margin: 0, fontWeight: 600 }}>Vendor Workspace</dd></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><dt style={{ color: "var(--text-muted)", fontSize: "12px" }}>Session Status</dt><dd style={{ margin: 0, fontWeight: 600, color: "var(--success)" }}>Active and Verified</dd></div>
         </div>
         <div className="vendor-form-actions" style={{ marginTop: '24px' }}>
            <button className="vendor-danger-button" onClick={onSignOut} type="button">Sign out safely</button>
         </div>
      </div>
    </div>
  );
}