import { useCallback, useEffect, useRef, useState } from "react";
import { apiAuthorizationHeaders, apiUrl } from "./api";

export type VendorDocumentStatus = {
  required: boolean;
  canManageCatalog: boolean;
  mandatoryCount: number;
  optionalCount: number;
  message: string;
  documents: Array<{
    type: "fssai" | "aadhaar" | "pan" | "photo" | "gst" | "trade_license" | "labour_license";
    label: string;
    mandatory: boolean;
    current: null | {
      id: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      uploadedAt: string;
      version: number;
    };
  }>;
};

interface Props {
  token: string;
  onMessage: (message: string, kind?: "success" | "error") => void;
  onChanged: (status: VendorDocumentStatus) => void;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export function VendorDocumentsPanel({ token, onMessage, onChanged }: Props) {
  const [status, setStatus] = useState<VendorDocumentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [uploadingType, setUploadingType] = useState("");
  const [viewingId, setViewingId] = useState("");
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(apiUrl("/api/vendor/documents"), {
        credentials: "omit",
        headers: apiAuthorizationHeaders(token),
      });
      const payload = await response.json().catch(() => undefined) as VendorDocumentStatus | { error?: string } | undefined;
      if (!response.ok) throw new Error((payload as { error?: string } | undefined)?.error ?? `Unable to load documents (${response.status}).`);
      const nextStatus = payload as VendorDocumentStatus;
      setStatus(nextStatus);
      onChangedRef.current(nextStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load vendor documents.";
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

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
        credentials: "omit",
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

  const viewDocument = async (id: string) => {
    if (viewingId) return;
    setViewingId(id);
    try {
      const response = await fetch(apiUrl(`/api/vendor/documents/${encodeURIComponent(id)}/content`), {
        credentials: "omit",
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
  const mandatoryDocs = documents.filter((item) => item.mandatory);
  const optionalDocs = documents.filter((item) => !item.mandatory);
  const mandatoryUploaded = status?.mandatoryCount ?? 0;
  const optionalUploaded = status?.optionalCount ?? 0;
  const complete = status?.canManageCatalog ?? false;

  return (
    <section className="vendor-documents-section" aria-labelledby="vendor-documents-title">
      <header className="vendor-documents-header">
        <div>
          <p className="vendor-eyebrow">Account setup</p>
          <h2 className="vendor-title" id="vendor-documents-title">Documents</h2>
          <p className="vendor-text-muted">Store your business documents securely. Only you can view or replace these files.</p>
        </div>
        <div className={`vendor-document-count ${complete ? "is-complete" : ""}`} aria-live="polite">
          <strong>{mandatoryUploaded}/{mandatoryDocs.length || 4}</strong>
          <span>mandatory complete</span>
        </div>
      </header>

      {!status?.required && (
        <div className="vendor-document-grandfather-note">
          <strong>Existing vendor account</strong>
          <span>Document onboarding is not required for this account. Your catalog access remains unchanged.</span>
        </div>
      )}
      {status?.message && <div className={`vendor-document-message ${complete ? "is-complete" : ""}`} role="status">{status.message}</div>}
      {loading && status && <p className="vendor-text-muted" role="status">Refreshing document status…</p>}
      {loadError && status && <div className="vendor-document-inline-error" role="alert">{loadError}<button type="button" className="vendor-text-button" onClick={() => void loadStatus()}>Retry</button></div>}

      <div className="vendor-document-groups">
        <section className="vendor-card vendor-document-group" aria-labelledby="mandatory-documents-title">
          <div className="vendor-card-heading">
            <div>
              <p className="vendor-eyebrow">Required for new vendors</p>
              <h3 className="vendor-subtitle" id="mandatory-documents-title">Mandatory Documents</h3>
              <p className="vendor-text-muted">{mandatoryUploaded} / {mandatoryDocs.length || 4} completed</p>
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
                disabled={Boolean(uploadingType)}
                inputRef={(element) => { fileInputs.current[item.type] = element; }}
                onUpload={(file) => void uploadDocument(item.type, file)}
                onChoose={() => fileInputs.current[item.type]?.click()}
                onView={() => item.current && void viewDocument(item.current.id)}
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
      <p className="vendor-document-file-note">Accepted files: PDF, JPG/JPEG, PNG · Maximum size: 5 MiB. Replacing a document keeps the same document type.</p>
    </section>
  );
}

type DocumentItem = VendorDocumentStatus["documents"][number];

function DocumentRow({
  item, busy, viewing, disabled, inputRef, onUpload, onChoose, onView,
}: {
  item: DocumentItem;
  busy: boolean;
  viewing: boolean;
  disabled: boolean;
  inputRef: (element: HTMLInputElement | null) => void;
  onUpload: (file: File | undefined) => void;
  onChoose: () => void;
  onView: () => void;
}) {
  const current = item.current;
  return (
    <article className={`vendor-document-row ${current ? "is-uploaded" : ""}`}>
      <div className="vendor-document-state" aria-hidden="true">{current ? "✓" : item.mandatory ? "!" : "+"}</div>
      <div className="vendor-document-copy">
        <strong>{item.label}</strong>
        {current ? (
          <span>{current.fileName} · Uploaded {new Date(current.uploadedAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}{current.version > 1 ? ` · Version ${current.version}` : ""}</span>
        ) : (
          <span>{item.mandatory ? "Not uploaded yet" : "Optional"}</span>
        )}
      </div>
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
