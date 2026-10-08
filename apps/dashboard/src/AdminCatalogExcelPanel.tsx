import { useCallback, useEffect, useRef, useState } from "react";
import { apiAuthorizationHeaders, apiRequest, apiUrl } from "./api";

type ImportSummary = { added: number; updated: number; archived: number; unchanged: number };
type PreviewError = { sheet: string; row: number; column: string; message: string };
type FieldChange = { field: string; before: string | null; after: string | null };
type CatalogChange = { sheet: string; row: number; id: string; name: string; fields: FieldChange[] };
type PreviewResult = {
  valid: boolean;
  errors: PreviewError[];
  warnings: string[];
  summary: ImportSummary;
  changes: CatalogChange[];
  previewToken?: string;
  expiresAt?: string;
};
type HistoryRecord = {
  version: number;
  createdAt: string;
  actorUserId: string;
  actorLabel: string;
  filename: string;
  added: number;
  updated: number;
  archived: number;
  unchanged: number;
  result: "APPLIED";
};
type HistoryResponse = {
  history: HistoryRecord[];
  pagination: { page: number; pageSize: number; total: number };
  catalog: { products: number; categories: number; lastUpdated: string | null; updatedBy: string | null };
};
type Props = { token: string; onApplied: () => void };

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const initialSummary: ImportSummary = { added: 0, updated: 0, archived: 0, unchanged: 0 };

async function responseError(response: Response) {
  const payload = await response.json().catch(() => undefined) as { error?: string; message?: string } | undefined;
  return payload?.error || payload?.message || `Request failed (${response.status})`;
}

function dateTime(value: string | null) {
  if (!value) return "Not yet recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function AdminCatalogExcelPanel({ token, onApplied }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState<"current" | "template" | "preview" | "apply" | "history" | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [appliedSummary, setAppliedSummary] = useState<ImportSummary | null>(null);

  const loadHistory = useCallback(async (page = 1) => {
    setWorking((current) => current === "apply" ? current : "history");
    try {
      const response = await apiRequest<HistoryResponse>(`/api/admin/master-catalog/excel/history?page=${page}`, token);
      setHistory(response);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load catalog import history.");
    } finally {
      setWorking((current) => current === "history" ? null : current);
    }
  }, [token]);

  useEffect(() => { void loadHistory(1); }, [loadHistory]);

  const download = async (kind: "current" | "template") => {
    setError("");
    setNotice("");
    setWorking(kind);
    try {
      const suffix = kind === "current" ? "" : "/template";
      const response = await fetch(apiUrl(`/api/admin/master-catalog/excel${suffix}`), {
        headers: apiAuthorizationHeaders(token),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = kind === "current" ? "local-basket-master-catalog.xlsx" : "local-basket-master-catalog-template.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setNotice(kind === "current" ? "Downloaded the current database catalog." : "Downloaded the current-catalog update template.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Excel file could not be downloaded.");
    } finally {
      setWorking(null);
    }
  };

  const chooseFile = (next: File | null) => {
    setFile(next);
    setPreview(null);
    setConfirmed(false);
    setError("");
    setNotice("");
    setAppliedSummary(null);
    if (next && !next.name.toLowerCase().endsWith(".xlsx")) {
      setFile(null);
      setError("Choose an .xlsx workbook to continue.");
    }
  };

  const validate = async () => {
    if (!file || working) return;
    setWorking("preview");
    setError("");
    setNotice("");
    setPreview(null);
    setConfirmed(false);
    try {
      const query = new URLSearchParams({ filename: file.name });
      const response = await fetch(apiUrl(`/api/admin/master-catalog/excel/preview?${query}`), {
        method: "POST",
        headers: apiAuthorizationHeaders(token, { "Content-Type": XLSX_TYPE }),
        body: file,
      });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as PreviewResult;
      setPreview(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The workbook could not be validated.");
    } finally {
      setWorking(null);
    }
  };

  const cancelPreview = () => {
    setPreview(null);
    setConfirmed(false);
    setNotice("Preview cleared. No catalog changes were applied.");
  };

  const apply = async () => {
    if (!file || !preview?.valid || !preview.previewToken || !confirmed || working) return;
    if (preview.expiresAt && new Date(preview.expiresAt).getTime() <= Date.now()) {
      setError("This preview has expired. Validate the workbook again before applying changes.");
      setPreview(null);
      setConfirmed(false);
      return;
    }
    setWorking("apply");
    setError("");
    try {
      const query = new URLSearchParams({ filename: file.name });
      const response = await fetch(apiUrl(`/api/admin/master-catalog/excel/apply?${query}`), {
        method: "POST",
        headers: apiAuthorizationHeaders(token, {
          "Content-Type": XLSX_TYPE,
          "X-Catalog-Preview": preview.previewToken,
          "X-Catalog-Confirm": "true",
        }),
        body: file,
      });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as { applied: boolean; summary: ImportSummary; version: number };
      setAppliedSummary(result.summary);
      setPreview(null);
      setConfirmed(false);
      setNotice(`Catalog version ${result.version} applied successfully.`);
      onApplied();
      await loadHistory(1);
      setHistoryPage(1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The catalog update could not be applied.");
    } finally {
      setWorking(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil((history?.pagination.total ?? 0) / (history?.pagination.pageSize ?? 20)));
  const expired = !!preview?.expiresAt && new Date(preview.expiresAt).getTime() <= Date.now();

  return (
    <section className="lb-catalog-excel" aria-label="Master catalog Excel management">
      <div className="lb-catalog-excel-heading">
        <div>
          <p className="lb-admin-eyebrow">Workbook tools</p>
          <h2>Bulk updates, with a review step</h2>
          <p>Excel is an editing surface—not the source of truth. Every download reflects the live database.</p>
        </div>
        <div className="lb-catalog-excel-actions">
          <button className="lb-admin-button" data-testid="button-download-current-catalog" type="button" disabled={working !== null} onClick={() => void download("current")}>
            {working === "current" ? "Preparing…" : "Download current catalog"}
          </button>
          <button className="lb-admin-button" data-testid="button-download-catalog-template" type="button" disabled={working !== null} onClick={() => void download("template")}>
            {working === "template" ? "Preparing…" : "Download update template"}
          </button>
        </div>
      </div>

      {history ? <div className="lb-catalog-facts" aria-label="Current catalog summary">
        <div><span>Master products</span><strong>{history.catalog.products.toLocaleString("en-IN")}</strong></div>
        <div><span>Categories</span><strong>{history.catalog.categories.toLocaleString("en-IN")}</strong></div>
        <div><span>Last updated</span><strong>{dateTime(history.catalog.lastUpdated)}</strong></div>
        <div><span>Updated by</span><strong>{history.catalog.updatedBy || "No import recorded"}</strong></div>
      </div> : working === "history" ? <div className="lb-catalog-facts is-loading" aria-label="Loading catalog summary"><i /><i /><i /><i /></div> : null}

      <div className="lb-catalog-policy">
        <strong>Updates only · IDs stay fixed</strong>
        <span>Existing product and category IDs are identity proofs, not editable values. Blank category fields retain pending classification. Missing rows are never deleted. Store price, stock, availability, SKUs, and variants are outside this workbook.</span>
      </div>

      <div className="lb-catalog-upload">
        <div>
          <p className="lb-admin-eyebrow">Import a revision</p>
          <h3>Upload the edited workbook</h3>
          <p>We validate the complete file first. Nothing changes until you review the proposed changes and confirm.</p>
        </div>
        <div className="lb-catalog-file-controls">
          <input ref={fileInput} data-testid="input-catalog-workbook" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Choose updated master catalog workbook" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
          <button className="lb-admin-button primary" data-testid="button-validate-catalog-workbook" type="button" disabled={!file || working !== null} onClick={() => void validate()}>{working === "preview" ? "Validating workbook…" : "Validate & preview"}</button>
        </div>
        {file && <div className="lb-catalog-selected-file"><span>{file.name}</span><button type="button" data-testid="button-clear-catalog-file" onClick={() => { chooseFile(null); if (fileInput.current) fileInput.current.value = ""; }}>Remove file</button></div>}
      </div>

      {error && <div className="lb-catalog-feedback is-error" role="alert" data-testid="status-catalog-error"><strong>Catalog request could not be completed</strong><span>{error}</span></div>}
      {notice && <div className="lb-catalog-feedback is-success" role="status" data-testid="status-catalog-notice">{notice}</div>}
      {appliedSummary && <div className="lb-catalog-feedback is-success" role="status"><strong>Database update completed</strong><span>{appliedSummary.updated} updated · {appliedSummary.archived} archived · {appliedSummary.unchanged} unchanged. No vendor-owned commercial values were included.</span></div>}

      {preview && <section className="lb-catalog-preview" aria-labelledby="catalog-preview-title">
        <div className="lb-catalog-preview-title">
          <div><p className="lb-admin-eyebrow">Review before applying</p><h3 id="catalog-preview-title">Master catalog preview</h3></div>
          <span className={`lb-catalog-validation-tag ${preview.valid ? "is-valid" : "is-invalid"}`}>{preview.valid ? "Ready to apply" : "Needs correction"}</span>
        </div>
        <div className="lb-catalog-counts">
          {(["added", "updated", "archived", "unchanged"] as const).map((key) => <div key={key}><span>{key}</span><strong>{preview.summary?.[key] ?? 0}</strong></div>)}
        </div>
        {preview.expiresAt && <p className={`lb-catalog-expiry ${expired ? "is-expired" : ""}`}>{expired ? "Preview expired" : "Preview expires"} · {dateTime(preview.expiresAt)}</p>}
        {preview.errors.length > 0 ? <div className="lb-catalog-issues is-error">
          <strong>{preview.errors.length} validation {preview.errors.length === 1 ? "issue" : "issues"} · No changes were applied</strong>
          <ul>{preview.errors.map((item, index) => <li key={`${item.sheet}-${item.row}-${item.column}-${index}`}><b>{item.sheet}</b> · Row {item.row} · {item.column}<span>{item.message}</span></li>)}</ul>
        </div> : null}
        {preview.valid && !preview.previewToken && <div className="lb-catalog-issues is-error" role="alert"><strong>This preview cannot be applied</strong><ul><li>The server did not issue a preview token. Validate the workbook again before applying any changes.</li></ul></div>}
        {preview.warnings.length > 0 && <div className="lb-catalog-issues is-warning"><strong>Warnings</strong><ul>{preview.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}
        {preview.changes.length > 0 && <div className="lb-catalog-change-wrap">
          <div className="lb-catalog-change-label"><strong>Proposed changes</strong><span>{preview.changes.length} rows</span></div>
          <div className="lb-catalog-changes" role="region" aria-label="Catalog change preview" tabIndex={0}>
            <table><thead><tr><th>Sheet / row</th><th>Catalog identity</th><th>Field</th><th>Current value</th><th>New value</th></tr></thead>
              <tbody>{preview.changes.flatMap((change) => (change.fields.length ? change.fields : [{ field: "Status", before: null, after: "Unchanged" }]).map((field, fieldIndex) => (
                <tr key={`${change.id}-${field.field}-${fieldIndex}`}>
                  <td><span className="lb-catalog-row-ref">{change.sheet} · {change.row}</span></td>
                  <td><strong>{change.name || change.id}</strong><small>{change.id}</small></td>
                  <td>{field.field}</td>
                  <td>{field.before ?? <em>Blank</em>}</td>
                  <td><strong>{field.after ?? <em>Blank</em>}</strong></td>
                </tr>
              )))}</tbody>
            </table>
          </div>
        </div>}
        {preview.valid && preview.changes.length === 0 && <p className="lb-catalog-no-changes">No catalog changes are proposed by this workbook.</p>}
        {preview.valid && <div className="lb-catalog-confirm">
          <label><input data-testid="checkbox-confirm-catalog-apply" type="checkbox" checked={confirmed} disabled={working !== null || expired} onChange={(event) => setConfirmed(event.target.checked)} /><span>I reviewed these catalog changes and confirm this workbook update.</span></label>
          <div>
            <button className="lb-admin-button" type="button" data-testid="button-cancel-catalog-preview" disabled={working !== null} onClick={cancelPreview}>Cancel preview</button>
            <button className="lb-admin-button primary" type="button" data-testid="button-apply-catalog-preview" disabled={!confirmed || working !== null || expired || !preview.previewToken} onClick={() => void apply()}>{working === "apply" ? "Applying update…" : "Apply changes"}</button>
          </div>
        </div>}
      </section>}

      <section className="lb-catalog-history" aria-labelledby="catalog-history-title">
        <div className="lb-catalog-history-heading">
          <div><p className="lb-admin-eyebrow">Audit trail</p><h3 id="catalog-history-title">Import history</h3></div>
          <button className="lb-admin-button" type="button" data-testid="button-refresh-catalog-history" disabled={working !== null} onClick={() => void loadHistory(historyPage)}>{working === "history" ? "Refreshing…" : "Refresh history"}</button>
        </div>
        {!history && working === "history" ? <div className="lb-catalog-history-skeleton" aria-label="Loading import history"><i /><i /><i /></div>
          : history && history.history.length ? <>
            <div className="lb-catalog-history-table-wrap" role="region" aria-label="Catalog import history" tabIndex={0}><table><thead><tr><th>Version</th><th>When</th><th>Updated by</th><th>Workbook</th><th>Updated</th><th>Added</th><th>Archived</th><th>Result</th></tr></thead>
              <tbody>{history.history.map((item) => <tr key={item.version}><td><strong>v{item.version}</strong></td><td>{dateTime(item.createdAt)}</td><td>{item.actorLabel || item.actorUserId}</td><td title={item.filename}>{item.filename}</td><td>{item.updated}</td><td>{item.added}</td><td>{item.archived}</td><td><span className="lb-catalog-history-status">{item.result}</span></td></tr>)}</tbody>
            </table></div>
            <div className="lb-catalog-history-pagination"><span>{history.pagination.total.toLocaleString("en-IN")} import versions</span><div><button type="button" disabled={historyPage <= 1 || working !== null} onClick={() => { setHistoryPage((page) => page - 1); void loadHistory(historyPage - 1); }}>Previous</button><span>Page {historyPage} of {totalPages}</span><button type="button" disabled={historyPage >= totalPages || working !== null} onClick={() => { setHistoryPage((page) => page + 1); void loadHistory(historyPage + 1); }}>Next</button></div></div>
          </> : history && <div className="lb-catalog-history-empty"><strong>No Excel imports recorded</strong><span>Successful catalog changes will appear here with the operator and workbook details.</span></div>}
      </section>
    </section>
  );
}
