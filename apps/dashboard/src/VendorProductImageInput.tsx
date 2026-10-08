import { useEffect, useMemo, useRef, useState } from "react";
import { apiAuthorizationHeaders, apiUrl } from "./api";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const acceptedTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function managedReference(value: string) {
  return /^\/api\/product-images\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/.test(value);
}

function validExternalUrl(value: string) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password;
  } catch { return false; }
}

export function isAllowedProductImageReference(value: string) {
  return !value.trim() || managedReference(value.trim()) || validExternalUrl(value.trim());
}

export function VendorProductImageInput({ token, productId, imageUrl, onChange, onUploadingChange, disabled = false }: {
  token: string;
  productId?: string;
  imageUrl: string;
  onChange: (value: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<"url" | "upload">(imageUrl && managedReference(imageUrl) ? "upload" : "url");
  const [preview, setPreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [previewRevision, setPreviewRevision] = useState(0);
  const selection = useMemo(() => imageUrl.trim(), [imageUrl]);

  useEffect(() => {
    if (!selection) { setPreview(""); return; }
    if (!managedReference(selection)) {
      setPreview(validExternalUrl(selection) ? selection : "");
      return;
    }
    let active = true;
    let objectUrl = "";
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(apiUrl(selection), {
          headers: apiAuthorizationHeaders(token),
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("The saved image preview is unavailable.");
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setPreview(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      } catch {
        if (active) setPreview("");
      }
    })();
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selection, token, previewRevision]);

  const chooseSource = (next: "url" | "upload") => {
    if (disabled || uploading || source === next) return;
    setSource(next);
    setError("");
    onChange("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const uploadFile = async (file?: File) => {
    if (!file) return;
    const previousImage = imageUrl;
    setError("");
    const dot = file.name.lastIndexOf(".");
    const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
    if (!acceptedTypes[extension] || file.type !== acceptedTypes[extension]) {
      setError("Choose a JPEG, PNG, or WebP image with a matching file type.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      setError("Images must be no larger than 5 MiB.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setUploading(true);
    onUploadingChange?.(true);
    const localPreview = URL.createObjectURL(file);
    setPreview(localPreview);
    try {
      const query = new URLSearchParams({ fileName: file.name });
      if (productId) query.set("productId", productId);
      const headers = apiAuthorizationHeaders(token, { "Content-Type": file.type });
      const response = await fetch(apiUrl(`/api/vendor/product-images?${query.toString()}`), {
        method: "POST",
        headers,
        body: file,
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => undefined) as { imageUrl?: string; error?: string } | undefined;
      if (!response.ok || !payload?.imageUrl || !managedReference(payload.imageUrl)) {
        throw new Error(payload?.error || "Unable to upload this image. Please try again.");
      }
      onChange(payload.imageUrl);
    } catch (cause) {
      setPreview("");
      setError(cause instanceof Error ? cause.message : "Unable to upload this image.");
      onChange(previousImage);
      if (previousImage) setPreviewRevision(value => value + 1);
    } finally {
      URL.revokeObjectURL(localPreview);
      setUploading(false);
      onUploadingChange?.(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const updateUrl = (value: string) => {
    onChange(value);
    setError(value && !managedReference(value) && !validExternalUrl(value) ? "Enter a valid HTTP or HTTPS image URL." : "");
  };
  const validReference = !selection || managedReference(selection) || validExternalUrl(selection);

  return <div className="vendor-product-image-input">
    <div className="vendor-product-image-heading">
      <div><strong>Product image</strong><span className="vendor-text-muted">Optional · JPEG, PNG, WebP up to 5 MiB</span></div>
    </div>
    <div className="vendor-image-source-tabs" role="tablist" aria-label="Product image source">
      <button type="button" role="tab" aria-selected={source === "url"} className={source === "url" ? "selected" : ""} disabled={disabled || uploading} onClick={() => chooseSource("url")}>Image URL</button>
      <button type="button" role="tab" aria-selected={source === "upload"} className={source === "upload" ? "selected" : ""} disabled={disabled || uploading} onClick={() => chooseSource("upload")}>Upload Image</button>
    </div>
    {source === "url" ? <label className="vendor-label">
      Image URL
      <input className="vendor-input" type="url" inputMode="url" value={managedReference(imageUrl) ? "" : imageUrl} onChange={event => updateUrl(event.target.value)} placeholder="https://example.com/product.jpg" disabled={disabled || uploading} aria-invalid={!validReference} />
    </label> : <div className="vendor-image-upload-control">
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={disabled || uploading} onChange={event => void uploadFile(event.target.files?.[0])} />
      <span className="vendor-text-muted">{uploading ? "Uploading image…" : selection ? "Choose a replacement image" : "Select an image from your device"}</span>
    </div>}
    {!!error && <p className="vendor-image-error" role="alert">{error}</p>}
    {!!preview && <div className="vendor-image-preview-row">
      <img src={preview} alt="Product image preview" />
      <div><strong>{uploading ? "Uploading preview" : "Image preview"}</strong><span>{source === "upload" && selection ? "Uploaded image ready to save" : "Preview"}</span></div>
      {source === "upload" && <button type="button" className="vendor-text-button" disabled={disabled || uploading} onClick={() => inputRef.current?.click()}>{uploading ? "Uploading…" : "Replace"}</button>}
    </div>}
  </div>;
}
