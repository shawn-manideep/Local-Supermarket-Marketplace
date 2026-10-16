import { useBrandingConfig, brandingImageUrl } from "./branding";
import { useEffect, useState } from "react";

type Props = { className?: string; decorative?: boolean };

export function BrandingLogo({ className = "", decorative = false }: Props) {
  const branding = useBrandingConfig();
  const src = brandingImageUrl(branding);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const label = decorative ? undefined : "Apna Local Basket";
  return (
    <span className={`lb-branding-logo ${className}`.trim()} aria-label={label} role={decorative ? undefined : "img"}>
      {src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : <span aria-hidden="true">ALB</span>}
    </span>
  );
}
