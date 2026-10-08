import { useCallback, useEffect, useRef, useState } from "react";
import type { VendorDocumentStatus } from "../../../../lib/api-client-react/src/generated/api.schemas";
import { apiAuthorizationHeaders, apiUrl } from "../api";
import { getAdminVendorDocuments } from "../admin-api";

type DocumentItem = VendorDocumentStatus["documents"][number];
type CurrentDocument = NonNullable<DocumentItem["current"]>;
type PreviewSession = { popup: Window; objectUrl?: string; closeCheck?: number };

const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
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
  const [refreshIndex, setRefreshIndex] = useState(0);
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
      setError("");
    }).catch((loadError: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(loadError));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [vendorId, token, refreshIndex]);

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
  const mandatory = documents.filter((document) => document.mandatory);
  const optional = documents.filter((document) => !document.mandatory);
  const complete = (status?.mandatoryCount ?? 0) >= 4;
  const renderGroup = (title: string, items: DocumentItem[], isMandatory: boolean) => (
    <section className="lb-admin-doc-group" aria-label={title}>
      <header className="lb-admin-doc-group-head">
        <div><span className="lb-admin-eyebrow">{isMandatory ? "Required" : "Additional"}</span><h4>{title}</h4></div>
        {isMandatory
          ? <strong className={`lb-admin-doc-completion ${complete ? "is-complete" : "is-incomplete"}`}>{status?.mandatoryCount ?? 0}/4 {complete ? "Complete" : "Incomplete"}</strong>
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
                <span className="lb-admin-doc-filename" title={current.fileName}>{current.fileName}</span>
                <span className="lb-admin-doc-meta">Uploaded {formatDate(current.uploadedAt)} · Version {current.version}{current.updatedAt ? ` · Updated ${formatDate(current.updatedAt)}` : ""}</span>
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

  return <section className="lb-admin-vendor-documents lb-admin-panel" aria-labelledby="admin-vendor-documents-title">
    <div className="lb-admin-panel-head lb-admin-doc-panel-head">
      <div><p className="lb-admin-eyebrow">Read-only record</p><h3 id="admin-vendor-documents-title">Vendor Documents</h3><p className="lb-admin-secondary">Current files and onboarding completeness. This is informational, not an approval decision.</p></div>
      <button className="lb-admin-button" type="button" onClick={refresh} disabled={loading} aria-label="Refresh vendor document details">{loading ? "Refreshing…" : "Refresh"}</button>
    </div>
    {error && <div className="lb-admin-doc-error" role="alert"><span>{error}</span><button className="lb-admin-row-action" type="button" onClick={refresh}>Retry</button></div>}
    {viewError && <div className="lb-admin-doc-error" role="alert"><span>{viewError}</span><button className="lb-admin-row-action" type="button" onClick={() => setViewError("")}>Dismiss</button></div>}
    {status && <>
      {loading && <p className="lb-admin-doc-refreshing" role="status">Refreshing current document details…</p>}
      <div className="lb-admin-doc-groups">
        {renderGroup("Mandatory Documents", mandatory, true)}
        {renderGroup("Optional Documents", optional, false)}
      </div>
    </>}
  </section>;
}
