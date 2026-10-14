import { useCallback, useEffect, useRef, useState } from "react";
import { apiAuthorizationHeaders, apiRequest, apiUrl } from "../api";
import { getAdminVendorDocuments } from "../admin-api";
import type { VendorDocumentStatus, VendorDocumentTypeName } from "../vendor-document-types";
import type { VendorNotificationFeed } from "../../../../lib/api-client-react/src/generated/api.schemas";

type DocumentItem = VendorDocumentStatus["documents"][number];
type CurrentDocument = NonNullable<DocumentItem["current"]>;
type PreviewSession = { popup: Window; objectUrl?: string; closeCheck?: number };
type BankDetailsRecord = { accountHolderName: string; maskedAccountNumber: string; accountNumber?: string; ifsc: string; bankName: string; bankBranch: string; vendorMobileNumber: string; status: "SUBMITTED" | "APPROVED" | "REJECTED"; submissionId: string; rejectionReason?: string | null; submittedAt?: string | null; reviewedAt?: string | null };
type BankStatus = { bankDetails: BankDetailsRecord | null; history: Array<{ action: string; createdAt: string; previousStatus?: string | null; nextStatus?: string | null }> };

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+05:30` : value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(date);
};

function errorMessage(error: unknown) {
  if (error instanceof Error && error.name !== "AbortError") return error.message;
  return "Vendor documents could not be loaded. Check your connection and try again.";
}

export function AdminVendorDocuments({ vendorId, token }: { vendorId: string; token: string }) {
  const [status, setStatus] = useState<VendorDocumentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewError, setViewError] = useState("");
  const [viewingType, setViewingType] = useState("");
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectedTypes, setRejectedTypes] = useState<VendorDocumentTypeName[]>([]);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [bankStatus, setBankStatus] = useState<BankStatus | null>(null);
  const [bankError, setBankError] = useState("");
  const [bankExpanded, setBankExpanded] = useState(false);
  const [revealBank, setRevealBank] = useState(false);
  const [bankReviewBusy, setBankReviewBusy] = useState(false);
  const [bankReviewReason, setBankReviewReason] = useState("");
  const [notifications, setNotifications] = useState<VendorNotificationFeed | null>(null);
  const [expiryDraft, setExpiryDraft] = useState("");
  const [expiryBusy, setExpiryBusy] = useState(false);
  const [expiryError, setExpiryError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const viewRequestRef = useRef<AbortController | null>(null);
  const previewRef = useRef<PreviewSession | null>(null);
  const mountedRef = useRef(true);

  const closePreview = useCallback(() => {
    const session = previewRef.current;
    if (!session) return;
    previewRef.current = null;
    viewRequestRef.current?.abort();
    viewRequestRef.current = null;
    if (session.closeCheck) window.clearInterval(session.closeCheck);
    try {
      if (!session.popup.closed) session.popup.close();
    } catch {
      // A browser may already have discarded the preview window.
    }
    if (session.objectUrl) URL.revokeObjectURL(session.objectUrl);
  }, []);

  const refresh = useCallback(() => setRefreshIndex((index) => index + 1), []);

  const reviewSubmission = async (decision: "approve" | "reject") => {
    if (!status?.submissionId || decisionBusy) return;
    if (decision === "reject" && (!rejectionReason.trim() || rejectedTypes.length === 0)) {
      setDecisionError("Add a reason and select at least one mandatory document to reject.");
      return;
    }
    setDecisionBusy(true);
    setDecisionError("");
    try {
      const body = decision === "approve"
        ? { submissionId: status.submissionId }
        : { submissionId: status.submissionId, reason: rejectionReason.trim(), rejectedTypes };
      const next = await apiRequest<VendorDocumentStatus>(`/api/admin/vendors/${encodeURIComponent(vendorId)}/documents/${decision}`, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setStatus(next);
      setRejectedTypes([]);
      setRejectionReason("");
      refresh();
    } catch (cause) {
      setDecisionError(cause instanceof Error ? cause.message : `Unable to ${decision} this submission.`);
    } finally {
      setDecisionBusy(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
      viewRequestRef.current?.abort();
      closePreview();
    };
  }, [closePreview, vendorId]);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    void getAdminVendorDocuments(vendorId, token, controller.signal).then((nextStatus) => {
      if (controller.signal.aborted) return;
      setStatus(nextStatus);
      setExpiryDraft(nextStatus.fssai?.expiryDate ?? "");
      setError("");
    }).catch((loadError: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(loadError));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    void apiRequest<BankStatus>(`/api/admin/vendors/${encodeURIComponent(vendorId)}/bank-details${revealBank ? "?reveal=true" : ""}`, token, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setBankStatus(result); setBankError(""); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setBankError(errorMessage(cause)); });
    void apiRequest<VendorNotificationFeed>(`/api/admin/vendors/${encodeURIComponent(vendorId)}/notifications`, token, { signal: controller.signal })
      .then((feed) => { if (!controller.signal.aborted) setNotifications(feed); })
      .catch(() => { if (!controller.signal.aborted) setNotifications(null); });
    return () => controller.abort();
  }, [vendorId, token, refreshIndex, revealBank]);

  useEffect(() => { setExpiryDraft(status?.fssai?.expiryDate ?? ""); }, [status?.fssai?.expiryDate]);

  const saveFssaiExpiry = async (documentId: string) => {
    if (!expiryDraft || expiryBusy) return;
    setExpiryBusy(true); setExpiryError("");
    try {
      const next = await apiRequest<VendorDocumentStatus>(`/api/admin/vendors/${encodeURIComponent(vendorId)}/documents/${encodeURIComponent(documentId)}/expiry`, token, {
        method: "PATCH", body: JSON.stringify({ expiryDate: expiryDraft }),
      });
      setStatus(next); setExpiryDraft(next.fssai?.expiryDate ?? ""); refresh();
    } catch (cause) { setExpiryError(cause instanceof Error ? cause.message : "Unable to save FSSAI expiry date."); }
    finally { setExpiryBusy(false); }
  };

  const reviewBank = async (action: "APPROVE" | "REJECT") => {
    const submissionId = bankStatus?.bankDetails?.submissionId;
    if (!submissionId || bankReviewBusy) return;
    if (action === "REJECT" && !bankReviewReason.trim()) { setBankError("Add a reason before rejecting bank details."); return; }
    setBankReviewBusy(true); setBankError("");
    try {
      const next = await apiRequest<BankStatus>(`/api/admin/vendors/${encodeURIComponent(vendorId)}/bank-details/review`, token, {
        method: "POST", body: JSON.stringify({ submissionId, action, ...(action === "REJECT" ? { reason: bankReviewReason.trim() } : {}) }),
      });
      setBankStatus(next); setBankReviewReason(""); refresh();
    } catch (cause) { setBankError(errorMessage(cause)); }
    finally { setBankReviewBusy(false); }
  };

  useEffect(() => {
    const refreshOnReturn = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [refresh]);

  const viewDocument = async (item: DocumentItem) => {
    const current = item.current as CurrentDocument | null;
    if (!current || viewingType) return;
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setViewError("Your browser blocked the document window. Allow pop-ups for this site, then try again.");
      return;
    }
    popup.opener = null;
    popup.document.title = `${item.label} — Vendor document`;
    popup.document.body.innerHTML = "";
    const message = popup.document.createElement("p");
    message.textContent = "Opening secure document…";
    message.style.cssText = "font: 15px system-ui,sans-serif;color:#334155;margin:32px";
    popup.document.body.appendChild(message);
    closePreview();
    const session: PreviewSession = { popup };
    previewRef.current = session;
    session.closeCheck = window.setInterval(() => {
      if (popup.closed) {
        closePreview();
        setViewingType("");
      }
    }, 800);
    setViewingType(item.type);
    setViewError("");
    const controller = new AbortController();
    viewRequestRef.current?.abort();
    viewRequestRef.current = controller;
    try {
      const response = await fetch(apiUrl(`/api/admin/vendors/${encodeURIComponent(vendorId)}/documents/${encodeURIComponent(current.id)}/content`), {
        credentials: "same-origin",
        headers: apiAuthorizationHeaders(token),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 404) {
          refresh();
          throw new Error("This file is no longer the current version. Document details have been refreshed; review the updated version before opening it.");
        }
        const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(payload?.error ?? `Unable to open document (${response.status}).`);
      }
      const blob = await response.blob();
      const mime = (response.headers.get("Content-Type") || current.mimeType).split(";")[0].trim().toLowerCase();
      if (!(mime === "application/pdf" || mime === "image/jpeg" || mime === "image/png" || mime === "image/webp")) {
        throw new Error("This document format cannot be previewed securely.");
      }
      if (controller.signal.aborted || previewRef.current !== session || popup.closed) return;
      const objectUrl = URL.createObjectURL(new Blob([blob], { type: mime }));
      session.objectUrl = objectUrl;
      popup.location.replace(objectUrl);
    } catch (openError) {
      if (!controller.signal.aborted && mountedRef.current) {
        setViewError(errorMessage(openError));
        setViewingType("");
        closePreview();
      }
    } finally {
      if (!controller.signal.aborted && mountedRef.current) setViewingType("");
    }
  };

  if (loading && !status) {
    return <section className="lb-admin-vendor-documents lb-admin-panel" aria-labelledby="admin-vendor-documents-title">
      <div className="lb-admin-panel-head"><div><p className="lb-admin-eyebrow">Read-only record</p><h3 id="admin-vendor-documents-title">Vendor Documents</h3></div></div>
      <div className="lb-admin-doc-skeleton" aria-label="Loading vendor documents"><i /><i /><i /><i /></div>
    </section>;
  }

  const documents = status?.documents ?? [];
  const mandatory = documents.filter((document) => document.mandatory || document.type === "labour_license");
  const optional = documents.filter((document) => !document.mandatory && document.type !== "labour_license");
  const mandatoryCount = mandatory.filter((document) => Boolean(document.current)).length;
  const complete = mandatoryCount >= 4;
  const renderGroup = (title: string, items: DocumentItem[], isMandatory: boolean) => (
    <section className="lb-admin-doc-group" aria-label={title}>
      <header className="lb-admin-doc-group-head">
        <div><span className="lb-admin-eyebrow">{isMandatory ? "Required" : "Additional"}</span><h4>{title}</h4></div>
        {isMandatory
          ? <strong className={`lb-admin-doc-completion ${complete ? "is-complete" : "is-incomplete"}`}>{mandatoryCount}/4 {complete ? "Complete" : "Incomplete"}</strong>
          : <span className="lb-admin-doc-optional-count">{status?.optionalCount ?? 0}/3 uploaded</span>}
      </header>
      <div className="lb-admin-doc-list">
        {items.map((item) => {
          const current = item.current as CurrentDocument | null;
          return <article className="lb-admin-doc-row" key={item.type}>
        <div className="lb-admin-doc-copy">
              <div className="lb-admin-doc-title"><strong>{item.label}</strong><span className={`lb-admin-doc-kind ${item.mandatory ? "is-mandatory" : "is-optional"}`}>{item.mandatory ? "Mandatory" : "Optional"}</span></div>
              {current ? <>
                <span className="lb-admin-doc-state is-uploaded">Uploaded</span>
                {item.mandatory && <span className={`lb-admin-doc-state lb-admin-doc-verification-${(current.verificationStatus ?? "DRAFT").toLowerCase()}`}>Review · {(current.verificationStatus ?? "DRAFT").toLowerCase()}</span>}
                <span className="lb-admin-doc-filename" title={current.fileName}>{current.fileName}</span>
                <span className="lb-admin-doc-meta">Uploaded {formatDate(current.uploadedAt)} · Version {current.version}{current.updatedAt ? ` · Updated ${formatDate(current.updatedAt)}` : ""}</span>
                {current.rejectionReason && <span className="lb-admin-doc-meta lb-admin-doc-rejection-reason">Review note: {current.rejectionReason}</span>}
              </> : <span className="lb-admin-doc-state is-missing">Not uploaded</span>}
            </div>
            {current && <button type="button" className="lb-admin-button lb-admin-doc-view" onClick={() => void viewDocument(item)} disabled={Boolean(viewingType) || loading} aria-label={`View current ${item.label} document`}>
              {viewingType === item.type ? "Opening…" : "View"}
            </button>}
          </article>;
        })}
        {!items.length && <p className="lb-admin-doc-empty">No document types were returned for this group.</p>}
      </div>
    </section>
  );

  const verificationStatus = status?.verificationStatus === "EXEMPT" ? "DRAFT" : status?.verificationStatus ?? "DRAFT";
  const submittedForReview = verificationStatus === "SUBMITTED" && Boolean(status?.submissionId);
  return <section className="lb-admin-vendor-documents lb-admin-panel" aria-labelledby="admin-vendor-documents-title">
    <div className="lb-admin-panel-head lb-admin-doc-panel-head">
      <div><p className="lb-admin-eyebrow">Vendor verification</p><h3 id="admin-vendor-documents-title">Vendor Documents</h3><p className="lb-admin-secondary">Current files and mandatory document submission status.</p></div>
      <button className="lb-admin-button" type="button" onClick={refresh} disabled={loading} aria-label="Refresh vendor document details">{loading ? "Refreshing…" : "Refresh"}</button>
    </div>
    {error && <div className="lb-admin-doc-error" role="alert"><span>{error}</span><button className="lb-admin-row-action" type="button" onClick={refresh}>Retry</button></div>}
    {viewError && <div className="lb-admin-doc-error" role="alert"><span>{viewError}</span><button className="lb-admin-row-action" type="button" onClick={() => setViewError("")}>Dismiss</button></div>}
    {status && <>
      {loading && <p className="lb-admin-doc-refreshing" role="status">Refreshing current document details…</p>}
      <div className={`lb-admin-doc-review-summary lb-admin-doc-verification-${verificationStatus.toLowerCase()}`} role="status">
          <div><span className="lb-admin-eyebrow">Submission status</span><strong>{verificationStatus.toLowerCase().replaceAll("_", " ")}</strong>
          {status.submittedAt && <span>Submitted {formatDate(status.submittedAt)}{status.reviewedAt ? ` · Reviewed ${formatDate(status.reviewedAt)}` : ""}</span>}
          {status.rejectionReason && <span className="lb-admin-doc-rejection-reason">Review note: {status.rejectionReason}</span>}
        </div>
        {submittedForReview && <div className="lb-admin-doc-review-actions">
          <button className="lb-admin-button primary" type="button" disabled={decisionBusy || loading} onClick={() => void reviewSubmission("approve")}>{decisionBusy ? "Saving…" : "Approve submission"}</button>
        </div>}
      </div>
      {status.fssai && <section className="lb-admin-fssai-summary">
        <div><span className="lb-admin-eyebrow">License compliance</span><strong>FSSAI · {status.fssai.status.replaceAll("_", " ")}</strong>
          <span>{status.fssai.expiryDate ? `Expires ${formatDate(status.fssai.expiryDate)}${status.fssai.daysRemaining != null && status.fssai.daysRemaining >= 0 ? ` · ${status.fssai.daysRemaining} days remaining` : ""}` : "Expiry date unknown; no value has been supplied."}</span>
        </div>
        {status.fssai.status === "EXPIRED" && <strong>Expired · review required</strong>}
        {status.documents.find((item) => item.type === "fssai")?.current && <label>Actual expiry date<input aria-label="FSSAI expiry date for vendor" type="date" value={expiryDraft} disabled={expiryBusy} onChange={(event) => setExpiryDraft(event.target.value)} /></label>}
        {status.documents.find((item) => item.type === "fssai")?.current && <button className="lb-admin-button" type="button" disabled={expiryBusy || !expiryDraft} onClick={() => {
          const document = status.documents.find((item) => item.type === "fssai")?.current;
          if (document) void saveFssaiExpiry(document.id);
        }}>{expiryBusy ? "Saving…" : "Save expiry date"}</button>}
        {expiryError && <span className="lb-admin-doc-rejection-reason" role="alert">{expiryError}</span>}
        {verificationStatus === "SUBMITTED" && <small>Changing an expiry date resets the mandatory submission to draft; review it again after resubmission.</small>}
      </section>}
      <section className="lb-admin-vendor-notifications">
        <div><span className="lb-admin-eyebrow">Notification audit</span><h4>Vendor notification feed</h4></div>
        <p>Feed mode: {notifications ? String(notifications.deliveryMode).replaceAll("_", " ") : "checking"}. Creation and read acknowledgement only; this does not prove browser delivery. Background delivery is not configured here.</p>
        {!notifications ? <p className="lb-admin-secondary">Notification feed is unavailable.</p> : notifications.notifications.length === 0
          ? <p className="lb-admin-secondary">No recent notification records.</p>
          : <ul>{notifications.notifications.map((notice) => <li key={notice.id}><strong>{notice.kind === "NEW_ORDER" ? `Order ${notice.orderId ?? ""}` : "FSSAI expiry"}</strong><span>{notice.message}</span><small>Created {formatDate(notice.createdAt)} · {notice.readAt ? `Acknowledged ${formatDate(notice.readAt)}` : "Unread"}</small></li>)}</ul>}
      </section>
      {submittedForReview && <div className="lb-admin-doc-reject-form">
        <label>Rejection reason<textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} maxLength={1000} rows={2} placeholder="Explain which mandatory document needs correction." /></label>
        <fieldset><legend>Select mandatory document types to reject</legend>
          {mandatory.map((item) => <label key={item.type}><input type="checkbox" checked={rejectedTypes.includes(item.type)} onChange={(event) => setRejectedTypes((current) => event.target.checked ? [...current, item.type] : current.filter((type) => type !== item.type))} />{item.label}</label>)}
        </fieldset>
        <button className="lb-admin-button" type="button" disabled={decisionBusy || loading} onClick={() => void reviewSubmission("reject")}>{decisionBusy ? "Saving…" : "Reject selected documents"}</button>
      </div>}
      {decisionError && <div className="lb-admin-doc-error" role="alert">{decisionError}</div>}
      <div className="lb-admin-doc-groups">
        {renderGroup("Mandatory Documents", mandatory, true)}
        {renderGroup("Optional Documents", optional, false)}
      </div>
      <section className="lb-admin-bank-review">
        <button className="lb-admin-bank-toggle" type="button" aria-expanded={bankExpanded} onClick={() => setBankExpanded((value) => !value)}>
          <span><strong>Bank Details</strong><small>Private financial information · admin review</small></span>
          <span>{bankStatus?.bankDetails?.status ?? "Not submitted"} · {bankExpanded ? "−" : "+"}</span>
        </button>
        {bankExpanded && <div className="lb-admin-bank-body">
          {bankError && <div className="lb-admin-doc-error" role="alert">{bankError}<button className="lb-admin-row-action" type="button" onClick={refresh}>Retry</button></div>}
          {!bankStatus?.bankDetails ? <p className="lb-admin-secondary">No bank submission has been received.</p> : <>
            <div className="lb-admin-bank-grid">
              <div><span>Account holder</span><strong>{bankStatus.bankDetails.accountHolderName}</strong></div>
              <div><span>Account number</span><strong>{revealBank ? bankStatus.bankDetails.accountNumber ?? bankStatus.bankDetails.maskedAccountNumber : bankStatus.bankDetails.maskedAccountNumber}</strong></div>
              <div><span>IFSC</span><strong>{bankStatus.bankDetails.ifsc}</strong></div>
              <div><span>Bank</span><strong>{bankStatus.bankDetails.bankName} · {bankStatus.bankDetails.bankBranch}</strong></div>
              <div><span>Vendor mobile</span><strong>{bankStatus.bankDetails.vendorMobileNumber}</strong></div>
              <div><span>Status</span><strong>{bankStatus.bankDetails.status}</strong></div>
              <div><span>Submitted</span><strong>{formatDate(bankStatus.bankDetails.submittedAt)}</strong></div>
              <div><span>Reviewed</span><strong>{formatDate(bankStatus.bankDetails.reviewedAt)}</strong></div>
            </div>
            <label className="lb-admin-bank-reveal"><input type="checkbox" checked={revealBank} onChange={(event) => setRevealBank(event.target.checked)} /> Reveal full account number (authorized admin view)</label>
            {bankStatus.bankDetails.rejectionReason && <p className="lb-admin-doc-rejection-reason">Review note: {bankStatus.bankDetails.rejectionReason}</p>}
            {bankStatus.bankDetails.status === "SUBMITTED" && <div className="lb-admin-bank-actions">
              <button className="lb-admin-button primary" type="button" disabled={bankReviewBusy} onClick={() => void reviewBank("APPROVE")}>{bankReviewBusy ? "Saving…" : "Approve bank details"}</button>
              <label>Rejection reason<textarea value={bankReviewReason} maxLength={1000} rows={2} onChange={(event) => setBankReviewReason(event.target.value)} placeholder="Explain what needs correction." /></label>
              <button className="lb-admin-button" type="button" disabled={bankReviewBusy || !bankReviewReason.trim()} onClick={() => void reviewBank("REJECT")}>{bankReviewBusy ? "Saving…" : "Reject bank details"}</button>
            </div>}
            {bankStatus.history.length > 0 && <div className="lb-admin-bank-history"><strong>Approval history</strong>{bankStatus.history.map((entry, index) => <span key={`${entry.createdAt}-${index}`}>{entry.action.replaceAll("_", " ")}{entry.nextStatus ? ` · ${entry.nextStatus.toLowerCase()}` : ""} · {formatDate(entry.createdAt)}</span>)}</div>}
          </>}
        </div>}
      </section>
    </>}
  </section>;
}
