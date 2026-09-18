import { useEffect, useState } from "react";
import { apiRequest, type Store, type StoreStatus } from "./api";

interface AdminStorePanelProps {
  token: string;
  onMessage: (message: string, kind?: "success" | "error") => void;
}

const statusActions: Partial<Record<StoreStatus, { label: string; path: string; className?: string }[]>> = {
  PENDING_APPROVAL: [
    { label: "Approve", path: "approve", className: "primary-button" },
    { label: "Reject", path: "reject", className: "danger-button" },
  ],
  ACTIVE: [{ label: "Suspend", path: "suspend", className: "danger-button" }],
  SUSPENDED: [{ label: "Reactivate", path: "reactivate", className: "primary-button" }],
};

export function AdminStorePanel({ token, onMessage }: AdminStorePanelProps) {
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [commission, setCommission] = useState("");
  const [loading, setLoading] = useState(false);

  const selectedStore = stores.find((store) => store.id === selectedId) ?? null;

  const loadStores = async () => {
    setLoading(true);
    try {
      const response = await apiRequest<{ stores: Store[] }>("/api/admin/stores", token);
      setStores(response.stores);
      setSelectedId((current) => current || response.stores[0]?.id || "");
      onMessage(`${response.stores.length} store${response.stores.length === 1 ? "" : "s"} loaded.`, "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to load stores.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setStores([]);
    setSelectedId("");
  }, [token]);

  useEffect(() => {
    setCommission(selectedStore?.commissionRate ?? "");
  }, [selectedStore]);

  const runAction = async (path: string) => {
    if (!selectedStore) return;
    try {
      const response = await apiRequest<{ store: Store }>(
        `/api/admin/stores/${selectedStore.id}/${path}`,
        token,
        { method: "POST" },
      );
      setStores((current) => current.map((store) => store.id === response.store.id ? response.store : store));
      onMessage(`Store ${path} action completed.`, "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to update store status.", "error");
    }
  };

  const updateCommission = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedStore) return;
    try {
      const response = await apiRequest<{ store: Store }>(
        `/api/admin/stores/${selectedStore.id}/commission-rate`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({
            commissionRate: commission.trim() === "" ? null : Number(commission),
          }),
        },
      );
      setStores((current) => current.map((store) => store.id === response.store.id ? response.store : store));
      onMessage("Commission rate updated.", "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to update commission rate.", "error");
    }
  };

  return (
    <section className="management-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Admin workspace</p>
          <h2>Store approvals</h2>
          <p className="muted">Review store state and manage the store-specific commission rate.</p>
        </div>
        <button className="secondary-button" disabled={loading} onClick={loadStores}>
          {loading ? "Loading…" : "Refresh stores"}
        </button>
      </div>
      <div className="admin-layout">
        <div className="card store-list">
          <div className="card-heading">
            <h3>All stores</h3>
            <span className="count-pill">{stores.length}</span>
          </div>
          {stores.length === 0 ? (
            <div className="empty-state compact">
              <strong>No stores loaded</strong>
              <span>Refresh to fetch admin-visible stores.</span>
            </div>
          ) : (
            stores.map((store) => (
              <button
                className={`store-list-item ${selectedId === store.id ? "selected" : ""}`}
                key={store.id}
                onClick={() => setSelectedId(store.id)}
              >
                <span>
                  <strong>{store.name}</strong>
                  <small>{store.id.slice(0, 8)}…</small>
                </span>
                <span className={`status status-${store.status.toLowerCase()}`}>{store.status.replaceAll("_", " ")}</span>
              </button>
            ))
          )}
        </div>

        <div className="card">
          {!selectedStore ? (
            <div className="empty-state">
              <strong>Select a store</strong>
              <span>Store details and approval actions will appear here.</span>
            </div>
          ) : (
            <>
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Store detail</p>
                  <h3>{selectedStore.name}</h3>
                  <p className="muted">Owner: {selectedStore.ownerUserId}</p>
                </div>
                <span className={`status status-${selectedStore.status.toLowerCase()}`}>{selectedStore.status.replaceAll("_", " ")}</span>
              </div>
              <div className="action-row">
                {statusActions[selectedStore.status]?.map((action) => (
                  <button className={action.className ?? "secondary-button"} key={action.path} onClick={() => runAction(action.path)}>
                    {action.label}
                  </button>
                ))}
              </div>
              <form className="commission-form" onSubmit={updateCommission}>
                <label>
                  Store commission rate (%)
                  <input
                    inputMode="decimal"
                    onChange={(event) => setCommission(event.target.value)}
                    placeholder="Leave blank for platform default"
                    value={commission}
                  />
                </label>
                <button className="primary-button" type="submit">Save commission</button>
              </form>
              <dl className="detail-list">
                <div><dt>Delivery fee</dt><dd>₹{selectedStore.deliveryFee}</dd></div>
                <div><dt>Minimum order</dt><dd>₹{selectedStore.minimumOrderValue}</dd></div>
                <div><dt>Description</dt><dd>{selectedStore.description || "—"}</dd></div>
              </dl>
            </>
          )}
        </div>
      </div>
    </section>
  );
}