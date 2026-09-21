import { useEffect, useState } from "react";
import {
  apiRequest,
  timeInputValue,
  type OperatingHour,
  type ServicePincode,
  type Store,
} from "./api";
import { CatalogManagementPanel } from "./CatalogManagementPanel";
import { OrderOperations } from "./OrderOperations";

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
  if (!hour) {
    return emptyHourDraft();
  }
  return {
    isClosed: hour.isClosed,
    opensAt: timeInputValue(hour.opensAt),
    closesAt: timeInputValue(hour.closesAt),
  };
}

interface VendorStorePanelProps {
  token: string;
  onMessage: (message: string, kind?: "success" | "error") => void;
}

export function VendorStorePanel({ token, onMessage }: VendorStorePanelProps) {
  const [store, setStore] = useState<Store | null>(null);
  const [pincodes, setPincodes] = useState<ServicePincode[]>([]);
  const [hours, setHours] = useState<Record<number, HourDraft>>(defaultHours);
  const [newPincode, setNewPincode] = useState("");
  const [loading, setLoading] = useState(false);

  const loadStore = async () => {
    setLoading(true);
    try {
      const [storeResponse, pincodeResponse, hoursResponse] = await Promise.all([
        apiRequest<{ store: Store }>("/api/vendor/store", token),
        apiRequest<{ pincodes: ServicePincode[] }>("/api/vendor/store/pincodes", token),
        apiRequest<{ hours: OperatingHour[] }>("/api/vendor/store/hours", token),
      ]);
      const loadedHours = defaultHours();
      for (const hour of hoursResponse.hours) {
        loadedHours[hour.dayOfWeek] = toHourDraft(hour);
      }
      setStore(storeResponse.store);
      setPincodes(pincodeResponse.pincodes);
      setHours(loadedHours);
      onMessage("Vendor store data loaded.", "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to load store data.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setStore(null);
    setPincodes([]);
    setHours(defaultHours());
  }, [token]);

  const updateStore = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!store) return;
    const form = new FormData(event.currentTarget);
    try {
      const response = await apiRequest<{ store: Store }>("/api/vendor/store", token, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.get("name"),
          description: form.get("description") || null,
          logoImageUrl: form.get("logoImageUrl") || null,
          phone: form.get("phone") || null,
          deliveryFee: Number(form.get("deliveryFee")),
          minimumOrderValue: Number(form.get("minimumOrderValue")),
        }),
      });
      setStore(response.store);
      onMessage("Store information saved.", "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to save store information.", "error");
    }
  };

  const addPincode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    }
  };

  const removePincode = async (pincode: string) => {
    try {
      await apiRequest(`/api/vendor/store/pincodes/${pincode}`, token, { method: "DELETE" });
      setPincodes((current) => current.filter((item) => item.pincode !== pincode));
      onMessage("Service pincode removed.", "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to remove pincode.", "error");
    }
  };

  const saveHours = async (dayOfWeek: number) => {
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
    }
  };

  return (
    <section className="management-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Vendor workspace</p>
          <h2>My store</h2>
          <p className="muted">Manage the store linked to your authenticated vendor account.</p>
        </div>
        <button className="secondary-button" disabled={loading} onClick={loadStore} type="button">
          {loading ? "Loading…" : "Load my store"}
        </button>
      </div>

      {!store ? (
        <div className="empty-state">
          <strong>Store data is not loaded</strong>
          <span>Load your linked store to begin managing its settings.</span>
        </div>
      ) : (
        <div className="panel-grid">
          <form className="card form-card" onSubmit={updateStore}>
            <div className="card-heading">
              <div>
                <h3>Store information</h3>
                <p className="muted">Protected fields such as status and commission are read-only here.</p>
              </div>
              <span className={`status status-${store.status.toLowerCase()}`}>{store.status.replaceAll("_", " ")}</span>
            </div>
            <label>
              Store name
              <input name="name" defaultValue={store.name} required />
            </label>
            <label>
              Description
              <textarea name="description" defaultValue={store.description ?? ""} rows={4} />
            </label>
            <div className="two-column">
              <label>
                Phone
                <input name="phone" defaultValue={store.phone ?? ""} placeholder="+91 9876543210" />
              </label>
              <label>
                Logo URL
                <input name="logoImageUrl" defaultValue={store.logoImageUrl ?? ""} type="url" />
              </label>
            </div>
            <div className="two-column">
              <label>
                Delivery fee
                <input name="deliveryFee" defaultValue={store.deliveryFee} inputMode="decimal" />
              </label>
              <label>
                Minimum order value
                <input name="minimumOrderValue" defaultValue={store.minimumOrderValue} inputMode="decimal" />
              </label>
            </div>
            <button className="primary-button" type="submit">Save store information</button>
          </form>

          <div className="card">
            <div className="card-heading">
              <div>
                <h3>Service pincodes</h3>
                <p className="muted">India-first six-digit service areas.</p>
              </div>
              <span className="count-pill">{pincodes.length}</span>
            </div>
            <form className="inline-form" onSubmit={addPincode}>
              <input
                aria-label="New service pincode"
                maxLength={6}
                onChange={(event) => setNewPincode(event.target.value)}
                placeholder="e.g. 560001"
                value={newPincode}
              />
              <button className="secondary-button" type="submit">Add</button>
            </form>
            <div className="chip-list">
              {pincodes.length === 0 ? (
                <span className="muted">No service pincodes yet.</span>
              ) : (
                pincodes.map((item) => (
                  <span className="chip" key={item.id}>
                    {item.pincode}
                    <button aria-label={`Remove ${item.pincode}`} onClick={() => removePincode(item.pincode)} type="button">×</button>
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {store && (
        <div className="card hours-card">
          <div className="card-heading">
            <div>
              <h3>Weekly operating hours</h3>
              <p className="muted">Day 0 is Sunday. Closed days do not store opening times.</p>
            </div>
          </div>
          <div className="hours-list">
            {dayNames.map((day, dayOfWeek) => {
              const draft = hours[dayOfWeek];
              return (
                <div className="hours-row" key={day}>
                  <strong>{day}</strong>
                  <label className="switch-label">
                    <input
                      checked={!draft.isClosed}
                      onChange={(event) =>
                        setHours((current) => ({
                          ...current,
                          [dayOfWeek]: { ...draft, isClosed: !event.target.checked },
                        }))
                      }
                      type="checkbox"
                    />
                    Open
                  </label>
                  <input
                    aria-label={`${day} opens at`}
                    disabled={draft.isClosed}
                    onChange={(event) =>
                      setHours((current) => ({
                        ...current,
                        [dayOfWeek]: { ...draft, opensAt: event.target.value },
                      }))
                    }
                    type="time"
                    value={draft.opensAt}
                  />
                  <span className="muted">to</span>
                  <input
                    aria-label={`${day} closes at`}
                    disabled={draft.isClosed}
                    onChange={(event) =>
                      setHours((current) => ({
                        ...current,
                        [dayOfWeek]: { ...draft, closesAt: event.target.value },
                      }))
                    }
                    type="time"
                    value={draft.closesAt}
                  />
                  <button className="text-button" onClick={() => saveHours(dayOfWeek)} type="button">Save</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {store && (
        <CatalogManagementPanel
          onMessage={onMessage}
          storeId={store.id}
          token={token}
        />
      )}
      {store && (
        <OrderOperations
          onMessage={onMessage}
          storeId={store.id}
          token={token}
          vendor
        />
      )}
    </section>
  );
}