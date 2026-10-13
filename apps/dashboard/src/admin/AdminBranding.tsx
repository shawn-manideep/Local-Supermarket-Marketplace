import { useEffect, useRef, useState } from "react";
import { BrandingLogo } from "../BrandingLogo";
import { brandingImageUrl, dispatchBrandingRefresh, refreshBranding, uploadBrandingLogo, useBrandingConfig, validateBrandingFile } from "../branding";
import "./branding.css";

export function AdminBranding({ token }: { token: string }) {
  const current = useBrandingConfig();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const configured = brandingImageUrl(current);

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const selectFile = (selected: File | null) => {
    setError("");
    setStatus("");
    if (selected) {
      const validationError = validateBrandingFile(selected);
      if (validationError) {
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        setError(validationError);
        return;
      }
    }
    setFile(selected);
  };

  const save = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await uploadBrandingLogo(token, file);
      await refreshBranding();
      dispatchBrandingRefresh();
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setStatus("Application logo saved. Public branding is refreshed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The application logo could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="lb-branding-settings">
    <section className="lb-branding-preview-panel" aria-label="Application logo preview">
      <div className="lb-branding-panel-label">CURRENT APPLICATION MARK</div>
      <div className="lb-branding-current">
        <BrandingLogo className="lb-branding-logo-large" />
        <div><strong>{current?.logoUrl ? "Custom logo active" : "Local Basket monogram"}</strong><span>Used across Local Basket portals</span></div>
      </div>
      {configured && <img className="lb-branding-current-image" src={configured} alt="Current application logo" />}
      <p>Store identities and product imagery remain separate from this platform-wide mark.</p>
    </section>
    <section className="lb-branding-upload-panel">
      <div className="lb-branding-panel-label">REPLACE APPLICATION LOGO</div>
      <p>Upload a transparent or solid PNG, or a JPEG. Maximum file size: 2 MiB.</p>
      <label className="lb-branding-file">
        <span>{file ? "Choose a different image" : "Choose logo image"}</span>
        <input ref={inputRef} type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={(event) => selectFile(event.currentTarget.files?.[0] ?? null)} />
      </label>
      {preview && <div className="lb-branding-selected-preview"><div><span>SELECTED PREVIEW</span><strong>{file?.name}</strong></div><img src={preview} alt="Selected application logo preview" /></div>}
      {error && <div className="lb-branding-feedback is-error" role="alert">{error}</div>}
      {status && <div className="lb-branding-feedback" role="status">{status}</div>}
      <button className="lb-admin-button primary lb-branding-save" type="button" onClick={() => void save()} disabled={!file || busy}>{busy ? "Saving logo…" : current?.logoUrl ? "Save replacement" : "Save application logo"}</button>
    </section>
  </div>;
}
