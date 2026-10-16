import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { partnerProvisionSchema } from "@workspace/validation";
import type { PartnerAdminRecord, PartnerDirectoryOutcome, PartnerProvisionInput, PartnerProvisionInputStatus, PartnerStatusInput } from "../../../lib/api-client-react/src/generated/api.schemas";
import { ApiRequestError, apiRequest } from "./api";
import "./partner.css";

type Props = { token: string };

function showDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
}

export function AdminDeliveryPartners({ token }: Props) {
  const [partners, setPartners] = useState<PartnerAdminRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [status, setStatus] = useState<PartnerProvisionInputStatus>("ACTIVE");
  const [busyPartnerId, setBusyPartnerId] = useState<string | null>(null);
  const directoryController = useRef<AbortController | null>(null);
  const operationControllers = useRef(new Set<AbortController>());

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await apiRequest<PartnerDirectoryOutcome>("/api/admin/delivery-partners", token, { signal });
      if (!signal.aborted) {
        setPartners(response.partners);
        setError("");
      }
    } catch (loadError) {
      if (!signal.aborted) {
        const denied = loadError instanceof ApiRequestError && (loadError.status === 401 || loadError.status === 403);
        if (denied) setPartners([]);
        setError(denied ? "You do not have permission to view delivery partner accounts." : "The delivery partner directory could not be loaded. Try again.");
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    directoryController.current = controller;
    for (const operation of operationControllers.current) operation.abort();
    operationControllers.current.clear();
    setPartners([]);
    setError("");
    setNotice("");
    setLoading(true);
    setSaving(false);
    setBusyPartnerId(null);
    setUsername("");
    setPassword("");
    setDisplayName("");
    setContactNumber("");
    setStatus("ACTIVE");
    void load(controller.signal);
    return () => {
      directoryController.current?.abort();
      directoryController.current = null;
      for (const operation of operationControllers.current) operation.abort();
      operationControllers.current.clear();
    };
  }, [token, load]);

  const clearForm = () => {
    setUsername("");
    setPassword("");
    setDisplayName("");
    setContactNumber("");
    setStatus("ACTIVE");
  };

  const createPartner = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    const parsed = partnerProvisionSchema.safeParse({ username, password, displayName, contactNumber: contactNumber.trim() || null, status });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the partner details.");
      return;
    }
    const input: PartnerProvisionInput = parsed.data;
    const controller = new AbortController();
    operationControllers.current.add(controller);
    setSaving(true);
    try {
      const response = await apiRequest<{ partner: PartnerAdminRecord }>("/api/admin/delivery-partners", token, { method: "POST", body: JSON.stringify(input), signal: controller.signal });
      if (controller.signal.aborted) return;
      setPartners((current) => [response.partner, ...current.filter((partner) => partner.id !== response.partner.id)]);
      clearForm();
      setNotice(`Partner ${response.partner.username} was created.`);
    } catch (saveError) {
      if (!controller.signal.aborted) setError(saveError instanceof ApiRequestError ? saveError.message : "Partner account could not be created. Try again.");
    } finally {
      operationControllers.current.delete(controller);
      if (!controller.signal.aborted) {
        setPassword("");
        setSaving(false);
      }
    }
  };

  const changeStatus = async (partner: PartnerAdminRecord, nextStatus: PartnerStatusInput["status"]) => {
    if (partner.status === nextStatus) return;
    setError("");
    setNotice("");
    const controller = new AbortController();
    operationControllers.current.add(controller);
    setBusyPartnerId(partner.id);
    try {
      const input: PartnerStatusInput = { status: nextStatus };
      const response = await apiRequest<{ partner: PartnerAdminRecord }>(`/api/admin/delivery-partners/${encodeURIComponent(partner.id)}/status`, token, { method: "PATCH", body: JSON.stringify(input), signal: controller.signal });
      if (controller.signal.aborted) return;
      setPartners((current) => current.map((item) => item.id === response.partner.id ? response.partner : item));
      setNotice(`${response.partner.username} is now ${response.partner.status.toLowerCase()}.`);
    } catch (statusError) {
      if (!controller.signal.aborted) setError(statusError instanceof ApiRequestError ? statusError.message : "Partner status could not be changed. Try again.");
    } finally {
      operationControllers.current.delete(controller);
      if (!controller.signal.aborted) setBusyPartnerId(null);
    }
  };

  const retry = () => {
    directoryController.current?.abort();
    const controller = new AbortController();
    directoryController.current = controller;
    setLoading(true);
    void load(controller.signal);
  };

  return (
    <main className="lbp">
      <div className="lbp-frame">
        <header className="lbp-topline"><div className="lbp-brand"><span className="lbp-mark" aria-hidden="true">ALB</span><div className="lbp-brand-copy"><strong>Apna Local Basket</strong><span>Admin operations</span></div></div><button className="lbp-button" data-testid="button-refresh-partners" type="button" onClick={retry} disabled={loading}>{loading ? "Refreshing…" : "Refresh directory"}</button></header>
        <section className="lbp-heading-row"><div><p className="lbp-kicker">Access management</p><h1 className="lbp-title">Delivery partners</h1><p className="lbp-subtitle">Create and maintain partner portal accounts. Account access can be paused or restored here.</p></div></section>
        {error && <div className="lbp-alert" role="alert" data-testid="status-admin-partners-error">{error}</div>}
        {notice && <div className="lbp-alert lbp-alert-info" role="status" data-testid="status-admin-partners-notice">{notice}</div>}
        <p className="lbp-kicker">DELIVERY_PARTNER · Admin-provisioned accounts</p>
        <form className="lbp-panel lbp-admin-create" onSubmit={(event) => void createPartner(event)}>
          <h2>Add a partner account</h2>
          <div className="lbp-field"><label htmlFor="admin-partner-username">Username</label><input id="admin-partner-username" data-testid="input-admin-partner-username" autoComplete="off" maxLength={30} value={username} onChange={(event) => setUsername(event.target.value)} required /></div>
          <div className="lbp-field"><label htmlFor="admin-partner-display">Display name</label><input id="admin-partner-display" data-testid="input-admin-partner-display-name" maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></div>
          <div className="lbp-field"><label htmlFor="admin-partner-password">Temporary password</label><input id="admin-partner-password" data-testid="input-admin-partner-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
          <div className="lbp-field"><label htmlFor="admin-partner-phone">Contact number <span>(optional)</span></label><input id="admin-partner-phone" data-testid="input-admin-partner-contact" type="tel" autoComplete="off" placeholder="+919876543210" value={contactNumber} onChange={(event) => setContactNumber(event.target.value)} /></div>
          <div className="lbp-field"><label htmlFor="admin-partner-status">Initial status</label><select id="admin-partner-status" data-testid="select-admin-partner-status" value={status} onChange={(event) => setStatus(event.target.value as PartnerProvisionInputStatus)}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
          <button className="lbp-button lbp-button-primary" data-testid="button-create-delivery-partner" disabled={saving} type="submit">{saving ? "Creating account…" : "Create account"}</button>
          <p className="lbp-admin-note">Usernames are case-insensitive against reserved names. Passwords are used only for account creation and are never displayed or stored here.</p>
        </form>
        <section className="lbp-panel lbp-content-panel">
          <div className="lbp-section-head"><h2>Partner directory</h2><span className="lbp-date-note">{partners.length} {partners.length === 1 ? "account" : "accounts"}</span></div>
         {loading && partners.length === 0 ? <div aria-label="Loading partner directory" data-testid="loading-admin-partners"><div className="lbp-skeleton" /><div className="lbp-skeleton" /></div> : partners.length === 0 ? <div className="lbp-empty"><strong>No partner accounts</strong><span>Create an account above to provide delivery partner portal access.</span></div> : <div className="lbp-table-wrap"><table className="lbp-table"><thead><tr><th>Partner</th><th>Username</th><th>Contact</th><th>Created</th><th>Status</th></tr></thead><tbody>{partners.map((partner) => <tr key={partner.id} data-testid={`row-admin-partner-${partner.id}`}><td data-label="Partner"><strong>{partner.displayName}</strong><small>Updated {showDate(partner.updatedAt)}</small></td><td data-label="Username">{partner.username}</td><td data-label="Contact">{partner.contactNumber || "—"}</td><td data-label="Created">{showDate(partner.createdAt)}</td><td data-label="Status"><select className="lbp-admin-status" aria-label={`Status for ${partner.username}`} data-testid={`select-partner-status-${partner.id}`} value={partner.status} disabled={busyPartnerId === partner.id} onChange={(event) => void changeStatus(partner, event.target.value as PartnerStatusInput["status"])}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></td></tr>)}</tbody></table></div>}
        </section>
      </div>
    </main>
  );
}