import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { apiAuthorizationHeaders, apiRequest, apiUrl } from "./api";
import { FssaiExpiryStatus } from "./FssaiExpiryStatus";
import type { VendorDocumentStatus } from "./vendor-document-types";
export type { VendorDocumentStatus } from "./vendor-document-types";

interface Props {
  token: string;
  onMessage: (message: string, kind?: "success" | "error") => void;
  onChanged: (status: VendorDocumentStatus) => void;
  currentStatus?: VendorDocumentStatus | null;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};
type BankDetails = { accountHolderName: string; maskedAccountNumber: string; accountNumber?: string; ifsc: string; bankName: string; bankBranch: string; vendorMobileNumber: string; status: "SUBMITTED" | "APPROVED" | "REJECTED"; submissionId: string; rejectionReason?: string | null; submittedAt?: string | null; reviewedAt?: string | null };
type BankResponse = { bankDetails: BankDetails | null; history: Array<{ action: string; createdAt: string; previousStatus?: string | null; nextStatus?: string | null }> };

export function VendorDocumentsPanel({ token, onMessage, onChanged, currentStatus }: Props) {
  const [status, setStatus] = useState<VendorDocumentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [uploadingType, setUploadingType] = useState("");
  const [viewingId, setViewingId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bank, setBank] = useState<BankResponse | null>(null);
  const [bankBusy, setBankBusy] = useState(false);
  const [bankError, setBankError] = useState("");
  const [bankExpanded, setBankExpanded] = useState(false);
  const [expiryBusy, setExpiryBusy] = useState(false);
  const [expiryError, setExpiryError] = useState("");
  const [expiryDraft, setExpiryDraft] = useState("");
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const nextStatus = await apiRequest<VendorDocumentStatus>("/api/vendor/documents", token);
      const bankResponse = await apiRequest<BankResponse>("/api/vendor/bank-details", token);
      setStatus(nextStatus);
      setBank(bankResponse);
      onChangedRef.current(nextStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load vendor documents.";
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { if (currentStatus) setStatus(currentStatus); }, [currentStatus]);
  useEffect(() => { setExpiryDraft(status?.fssai?.expiryDate ?? ""); }, [status?.fssai?.expiryDate]);

  const saveFssaiExpiry = async (documentId: string) => {
    if (!expiryDraft || expiryBusy || status?.verificationStatus === "SUBMITTED") return;
    setExpiryBusy(true); setExpiryError("");
    try {
      const nextStatus = await apiRequest<VendorDocumentStatus>(`/api/vendor/documents/${encodeURIComponent(documentId)}/expiry`, token, {
        method: "PATCH", body: JSON.stringify({ expiryDate: expiryDraft }),
      });
      setStatus(nextStatus); onChangedRef.current(nextStatus);
      onMessage("FSSAI expiry date saved. Your mandatory submission is now a draft and must be resubmitted for review.", "success");
    } catch (error) {
      setExpiryError(error instanceof Error ? error.message : "Unable to save FSSAI expiry date.");
    } finally { setExpiryBusy(false); }
  };

  const uploadDocument = async (type: string, file: File | undefined) => {
    if (!file || uploadingType) return;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const inferredType = MIME_BY_EXTENSION[extension];
    if (!inferredType || (file.type && (!ACCEPTED_TYPES.has(file.type) || file.type !== inferredType))) {
      onMessage("Choose a PDF, JPG/JPEG, or PNG file.", "error");
      return;
    }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      onMessage("Choose a document smaller than 5 MiB.", "error");
      return;
    }
    setUploadingType(type);
    try {
      const query = new URLSearchParams({ fileName: file.name });
      const response = await fetch(apiUrl(`/api/vendor/documents/${type}?${query.toString()}`), {
        method: "PUT",
        credentials: "same-origin",
        headers: apiAuthorizationHeaders(token, { "Content-Type": file.type || inferredType }),
        body: file,
      });
      const payload = await response.json().catch(() => undefined) as VendorDocumentStatus | { error?: string } | undefined;
      if (!response.ok) {
        throw new Error((payload as { error?: string } | undefined)?.error ?? `Document upload failed (${response.status}).`);
      }
      const nextStatus = payload as VendorDocumentStatus;
      setStatus(nextStatus);
      onChangedRef.current(nextStatus);
      onMessage("Document uploaded successfully.", "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to upload this document.", "error");
    } finally {
      setUploadingType("");
      const input = fileInputs.current[type];
      if (input) input.value = "";
    }
  };

  const submitDocuments = async () => {
    if (!status || submitting || status.mandatoryCount < 4) return;
    setSubmitting(true);
    try {
      const nextStatus = await apiRequest<VendorDocumentStatus>("/api/vendor/documents/submit", token, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setStatus(nextStatus);
      onChangedRef.current(nextStatus);
      onMessage("Mandatory documents submitted for verification.", "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to submit documents.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const saveBankDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (bankBusy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const accountNumber = String(form.get("accountNumber") ?? "").trim();
    if (!bank?.bankDetails && accountNumber.length < 6) { setBankError("Enter a bank account number with at least 6 characters."); return; }
    if (accountNumber && !/^[A-Za-z0-9-]{6,34}$/.test(accountNumber)) { setBankError("Use 6–34 letters, numbers, or hyphens for the account number."); return; }
    const ifsc = String(form.get("ifsc") ?? "").trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) { setBankError("Enter a valid IFSC code."); return; }
    const mobile = String(form.get("vendorMobileNumber") ?? "").trim();
    const mobileDigits = mobile.replace(/\D/g, "");
    if (!/^\+?[0-9][0-9 ()-]{8,17}$/.test(mobile) || mobileDigits.length < 10 || mobileDigits.length > 15) { setBankError("Enter a valid vendor mobile number."); return; }
    setBankBusy(true); setBankError("");
    try {
      const next = await apiRequest<BankResponse>("/api/vendor/bank-details", token, {
        method: "PATCH",
        body: JSON.stringify({
          accountHolderName: String(form.get("accountHolderName") ?? "").trim(),
          ...(accountNumber ? { accountNumber } : {}),
          ifsc, bankName: String(form.get("bankName") ?? "").trim(),
          bankBranch: String(form.get("bankBranch") ?? "").trim(),
          vendorMobileNumber: mobile,
        }),
      });
      setBank(next);
      const latestDocs = await apiRequest<VendorDocumentStatus>("/api/vendor/documents", token);
      setStatus(latestDocs); onChangedRef.current(latestDocs);
      formElement.reset();
      onMessage("Bank details submitted for Admin review. Account number remains masked.", "success");
    } catch (error) { setBankError(error instanceof Error ? error.message : "Unable to save bank details."); }
    finally { setBankBusy(false); }
  };

  const viewDocument = async (id: string) => {
    if (viewingId) return;
    setViewingId(id);
    try {
      const response = await fetch(apiUrl(`/api/vendor/documents/${encodeURIComponent(id)}/content`), {
        credentials: "same-origin",
        headers: apiAuthorizationHeaders(token),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(payload?.error ?? `Unable to open document (${response.status}).`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to open this document.", "error");
    } finally {
      setViewingId("");
    }
  };

  if (loading && !status) {
    return (
      <div className="vendor-documents-section">
        <div className="vendor-document-summary-skeleton" aria-label="Loading vendor documents"><i /><i /></div>
        <div className="vendor-document-list-skeleton"><i /><i /><i /><i /></div>
      </div>
    );
  }

  if (loadError && !status) {
    return (
      <section className="vendor-card vendor-documents-section" aria-labelledby="vendor-documents-title">
        <div className="vendor-card-heading">
          <div><p className="vendor-eyebrow">Account setup</p><h2 className="vendor-title" id="vendor-documents-title">Documents</h2></div>
        </div>
        <div className="vendor-empty-state vendor-compact" role="alert">
          <strong>Documents could not load</strong><span>{loadError}</span>
          <button type="button" className="vendor-secondary-button" onClick={() => void loadStatus()}>Retry</button>
        </div>
      </section>
    );
  }

  const documents = status?.documents ?? [];
  const mandatoryDocs = documents.filter((item) => item.mandatory || item.type === "labour_license");
  const optionalDocs = documents.filter((item) => !item.mandatory && item.type !== "labour_license");
  const mandatoryUploaded = mandatoryDocs.filter((item) => Boolean(item.current)).length;
  const optionalUploaded = status?.optionalCount ?? 0;
  const complete = status?.canManageCatalog ?? false;
  const verification = status?.verificationStatus === "EXEMPT" ? "DRAFT" : status?.verificationStatus ?? "DRAFT";
  const canSubmit = mandatoryUploaded >= 4 && verification !== "SUBMITTED" && verification !== "APPROVED";

  return (
    <section className="vendor-documents-section" aria-labelledby="vendor-documents-title">
      <header className="vendor-documents-header">
        <div>
          <p className="vendor-eyebrow">Account setup</p>
          <h2 className="vendor-title" id="vendor-documents-title">Documents</h2>
          <p className="vendor-text-muted">Store your business documents securely. Only you can view or replace these files.</p>
        </div>
        <div className={`vendor-document-count ${complete ? "is-complete" : ""}`} aria-live="polite">
            <strong>{mandatoryUploaded}/4</strong>
          <span>mandatory complete</span>
        </div>
      </header>

      {
        <div className={`vendor-document-review-status status-${verification.toLowerCase()}`} role="status">
          <div><strong>Verification status · {verification === "SUBMITTED" ? "Under review" : verification === "APPROVED" ? "Approved" : verification === "REJECTED" ? "Needs correction" : "Not submitted"}</strong>
            <span>{verification === "SUBMITTED"
              ? `Your mandatory documents were submitted${status?.submittedAt ? ` on ${new Date(status.submittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}. Catalog access will unlock after approval.`
              : verification === "APPROVED"
                ? "Mandatory documents approved. Bank review and active store status are also required for catalog access."
                : verification === "REJECTED"
                  ? "Some mandatory documents need attention. Replace the requested documents and submit again."
                  : "Submit all four required documents for Admin verification."}</span>
          </div>
          {verification === "REJECTED" && status?.rejectionReason && <p><strong>Review note:</strong> {status.rejectionReason}</p>}
          {!complete && <small>Catalog access remains locked until documents, bank details, and store approval are complete.</small>}
        </div>
      }
      {loading && status && <p className="vendor-text-muted" role="status">Refreshing document status…</p>}
      {loadError && status && <div className="vendor-document-inline-error" role="alert">{loadError}<button type="button" className="vendor-text-button" onClick={() => void loadStatus()}>Retry</button></div>}
      {status?.fssai && <FssaiExpiryStatus value={status.fssai} />}
      {expiryError && <div className="vendor-document-inline-error" role="alert">{expiryError}</div>}

      <section className="vendor-card vendor-document-group vendor-bank-details">
        <button type="button" className="vendor-card-heading vendor-bank-toggle" aria-expanded={bankExpanded} onClick={() => setBankExpanded((value) => !value)}>
          <span><strong className="vendor-subtitle">Bank Details</strong><span className="vendor-text-muted">Sensitive details are kept private and masked after submission.</span></span>
          <span className="vendor-status-badge vendor-status-inactive">{bank?.bankDetails?.status?.replaceAll("_", " ") ?? "Required"} · {bankExpanded ? "−" : "+"}</span>
        </button>
        {bankExpanded && <div className="vendor-bank-content">
          {bank?.bankDetails && <p className="vendor-document-review-status" role="status">Review · {bank.bankDetails.status.toLowerCase()}{bank.bankDetails.maskedAccountNumber ? ` · Account ${bank.bankDetails.maskedAccountNumber}` : ""}{bank.bankDetails.rejectionReason ? ` · Note: ${bank.bankDetails.rejectionReason}` : ""}</p>}
          {bankError && <div className="vendor-document-inline-error" role="alert">{bankError}<button className="vendor-text-button" type="button" onClick={() => void loadStatus()}>Retry</button></div>}
          <form className="vendor-bank-form" onSubmit={(event) => void saveBankDetails(event)}>
            <label>Bank account holder name<input name="accountHolderName" defaultValue={bank?.bankDetails?.accountHolderName ?? ""} autoComplete="name" required maxLength={120} disabled={bankBusy} /></label>
            <label>Bank account number<input name="accountNumber" type="password" autoComplete="off" inputMode="numeric" placeholder={bank?.bankDetails ? "Leave blank to keep saved account" : "Enter account number"} required={!bank?.bankDetails} maxLength={34} disabled={bankBusy} /></label>
            <label>IFSC code<input name="ifsc" defaultValue={bank?.bankDetails?.ifsc ?? ""} autoCapitalize="characters" pattern="[A-Za-z]{4}0[A-Za-z0-9]{6}" required maxLength={11} disabled={bankBusy} /></label>
            <label>Bank name<input name="bankName" defaultValue={bank?.bankDetails?.bankName ?? ""} required maxLength={120} disabled={bankBusy} /></label>
            <label>Bank branch<input name="bankBranch" defaultValue={bank?.bankDetails?.bankBranch ?? ""} required maxLength={120} disabled={bankBusy} /></label>
            <label>Vendor mobile number<input name="vendorMobileNumber" type="tel" defaultValue={bank?.bankDetails?.vendorMobileNumber ?? ""} inputMode="tel" pattern="\+?[0-9][0-9 ()-]{8,17}" required maxLength={20} disabled={bankBusy} /></label>
            <p className="vendor-text-muted">Saving details submits them for review. Updating approved information requires Admin review again.</p>
            <button className="vendor-primary-button" type="submit" disabled={bankBusy}>{bankBusy ? "Saving securely…" : bank?.bankDetails ? "Save changes for review" : "Save bank details"}</button>
          </form>
          {bank?.history?.length ? <div className="vendor-bank-history"><strong>Approval history</strong>{bank.history.map((entry, index) => <span key={`${entry.createdAt}-${index}`}>{entry.action.replaceAll("_", " ")}{entry.nextStatus ? ` · ${entry.nextStatus.toLowerCase()}` : ""} · {new Date(entry.createdAt).toLocaleString("en-IN")}</span>)}</div> : null}
        </div>}
      </section>

      <div className="vendor-document-groups">
        <section className="vendor-card vendor-document-group" aria-labelledby="mandatory-documents-title">
          <div className="vendor-card-heading">
            <div>
              <p className="vendor-eyebrow">Required for vendor approval</p>
              <h3 className="vendor-subtitle" id="mandatory-documents-title">Mandatory Documents</h3>
              <p className="vendor-text-muted">{mandatoryUploaded} / 4 completed</p>
            </div>
            <span className={`vendor-status-badge ${complete ? "vendor-status-active" : "vendor-status-inactive"}`}>{complete ? "Complete" : "Required"}</span>
          </div>
          <div className="vendor-document-list">
            {mandatoryDocs.map((item) => (
              <DocumentRow
                key={item.type}
                item={item}
                busy={uploadingType === item.type}
                viewing={viewingId === item.current?.id}
                disabled={Boolean(uploadingType) || verification === "SUBMITTED"}
                inputRef={(element) => { fileInputs.current[item.type] = element; }}
                onUpload={(file) => {
                  if (file && verification === "APPROVED" && !window.confirm("Replacing an approved mandatory document will invalidate this approval and lock new-only catalog access until Admin reviews the replacement. Continue?")) return;
                  void uploadDocument(item.type, file);
                }}
                onChoose={() => fileInputs.current[item.type]?.click()}
                onView={() => item.current && void viewDocument(item.current.id)}
                 {...(item.type === "fssai" && item.current ? {
                   expiryDate: expiryDraft,
                   expiryStatus: status?.fssai?.status ?? "DATE_REQUIRED",
                   expiryBusy,
                   expiryDisabled: verification === "SUBMITTED",
                   onExpiryChange: setExpiryDraft,
                   onSaveExpiry: () => void saveFssaiExpiry(item.current!.id),
                 } : {})}
              />
            ))}
          </div>
        </section>

        <section className="vendor-card vendor-document-group" aria-labelledby="optional-documents-title">
          <div className="vendor-card-heading">
            <div>
              <p className="vendor-eyebrow">Does not block catalog access</p>
              <h3 className="vendor-subtitle" id="optional-documents-title">Optional Documents</h3>
              <p className="vendor-text-muted">{optionalUploaded} / {optionalDocs.length || 3} uploaded</p>
            </div>
            <span className="vendor-document-optional-count">{optionalUploaded}/{optionalDocs.length || 3}</span>
          </div>
          <div className="vendor-document-list">
            {optionalDocs.map((item) => (
              <DocumentRow
                key={item.type}
                item={item}
                busy={uploadingType === item.type}
                viewing={viewingId === item.current?.id}
                disabled={Boolean(uploadingType)}
                inputRef={(element) => { fileInputs.current[item.type] = element; }}
                onUpload={(file) => void uploadDocument(item.type, file)}
                onChoose={() => fileInputs.current[item.type]?.click()}
                onView={() => item.current && void viewDocument(item.current.id)}
              />
            ))}
          </div>
        </section>
      </div>
      {canSubmit && <div className="vendor-document-submit">
        <p className="vendor-text-muted">{verification === "REJECTED" ? "Review the rejection notes, replace any requested files, then send the mandatory set for another review." : "All four mandatory files are ready. Catalog access stays locked until an Admin approves them."}</p>
        <button className="vendor-primary-button" type="button" onClick={() => void submitDocuments()} disabled={submitting || Boolean(uploadingType)}>{submitting ? "Submitting…" : verification === "REJECTED" ? "Resubmit for Verification" : "Submit for Verification"}</button>
      </div>}
      {verification === "APPROVED" && <div className="vendor-document-approved-note"><strong>Documents approved</strong><span>Your new-vendor catalog access is enabled.</span></div>}
      <p className="vendor-document-file-note">Accepted files: PDF, JPG/JPEG, PNG · Maximum size: 5 MiB. Replacing a document keeps the same document type.</p>
    </section>
  );
}

type DocumentItem = VendorDocumentStatus["documents"][number];

function DocumentRow({
  item, busy, viewing, disabled, inputRef, onUpload, onChoose, onView,
  expiryDate, expiryStatus, expiryBusy = false, expiryDisabled = false, onExpiryChange, onSaveExpiry,
}: {
  item: DocumentItem;
  busy: boolean;
  viewing: boolean;
  disabled: boolean;
  inputRef: (element: HTMLInputElement | null) => void;
  onUpload: (file: File | undefined) => void;
  onChoose: () => void;
  onView: () => void;
  expiryDate?: string;
  expiryStatus?: string;
  expiryBusy?: boolean;
  expiryDisabled?: boolean;
  onExpiryChange?: (value: string) => void;
  onSaveExpiry?: () => void;
}) {
  const current = item.current;
  const verificationStatus = current?.verificationStatus ?? (current ? "DRAFT" : undefined);
  return (
    <article className={`vendor-document-row ${current ? "is-uploaded" : ""}`}>
      <div className="vendor-document-state" aria-hidden="true">{current ? "✓" : item.mandatory ? "!" : "+"}</div>
      <div className="vendor-document-copy">
        <strong>{item.label}</strong>
        {current ? (
          <>
            <span>{current.fileName} · Uploaded {new Date(current.uploadedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}{current.version > 1 ? ` · Version ${current.version}` : ""}</span>
            {verificationStatus && <span className={`vendor-document-review-pill status-${verificationStatus.toLowerCase()}`}>File · {verificationStatus.toLowerCase()}</span>}
            {current.rejectionReason && <span className="vendor-document-rejection-reason">Review note: {current.rejectionReason}</span>}
          </>
        ) : (
          <span>{item.mandatory ? "Not uploaded yet" : "Optional"}</span>
        )}
      </div>
      {item.type === "fssai" && onExpiryChange && onSaveExpiry && <div className="vendor-fssai-expiry-editor">
        <label>License expiry date
          <input type="date" value={expiryDate ?? ""} onChange={(event) => onExpiryChange(event.target.value)} disabled={expiryDisabled || expiryBusy} aria-label="FSSAI license expiry date" />
        </label>
        <span className={`vendor-document-review-pill status-${(expiryStatus ?? "DATE_REQUIRED").toLowerCase()}`}>{(expiryStatus ?? "DATE_REQUIRED").replaceAll("_", " ")}</span>
        <button type="button" className="vendor-secondary-button vendor-compact-button" onClick={onSaveExpiry} disabled={expiryDisabled || expiryBusy || !expiryDate}>{expiryBusy ? "Saving…" : "Save expiry"}</button>
        {expiryDisabled && <small>Mandatory submission is under review. Expiry date editing is locked until review completes.</small>}
      </div>}
      <div className="vendor-document-actions">
        {current && <button type="button" className="vendor-text-button" onClick={onView} disabled={viewing || disabled}>{viewing ? "Opening…" : "View"}</button>}
        <input
          ref={inputRef}
          className="vendor-document-file-input"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          aria-label={`${current ? "Replace" : "Upload"} ${item.label}`}
          onChange={(event) => onUpload(event.target.files?.[0])}
          disabled={disabled}
        />
        <button type="button" className={current ? "vendor-secondary-button vendor-compact-button" : "vendor-primary-button vendor-compact-button"} onClick={onChoose} disabled={disabled || busy}>
          {busy ? "Uploading…" : current ? "Replace" : "Upload"}
        </button>
      </div>
    </article>
  );
}
