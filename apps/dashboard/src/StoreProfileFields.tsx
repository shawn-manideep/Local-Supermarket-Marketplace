import type { ReactNode } from "react";
import { StoreLocationMap } from "./StoreLocationMap";

export type StoreProfileValues = {
  name?: string | null;
  ownerName?: string | null;
  phone?: string | null;
  email?: string | null;
  description?: string | null;
  logoImageUrl?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  deliveryFee?: string | number | null;
  handlingFee?: string | number | null;
  minimumOrderValue?: string | number | null;
};

type FieldProps = {
  label: string;
  name: keyof StoreProfileValues;
  values: StoreProfileValues;
  disabled: boolean;
  variant: "admin" | "vendor";
  type?: string;
  required?: boolean;
  maxLength?: number;
  value?: string | number | null;
  inputMode?: "decimal" | "tel";
};

function ProfileField({ label, name, values, disabled, variant, type = "text", required = false, maxLength, value, inputMode }: FieldProps) {
  const vendor = variant === "vendor";
  return <label className={vendor ? "vendor-label" : "lb-admin-field"}>
    <span>{label}{required && <span className="lb-required-mark" aria-hidden="true"> *</span>}</span>
    <input className={vendor ? "vendor-input" : ""} name={name} type={type} defaultValue={value ?? values[name] ?? ""} required={required}
      min={type === "number" ? (name === "latitude" ? -90 : name === "longitude" ? -180 : 0) : undefined}
      max={type === "number" ? (name === "latitude" ? 90 : name === "longitude" ? 180 : 1_000_000) : undefined}
      step={type === "number" ? (name === "latitude" || name === "longitude" ? "any" : 0.01) : undefined}
      maxLength={name === "pincode" ? 6 : maxLength} inputMode={name === "pincode" ? "numeric" : inputMode} disabled={disabled}
      {...(name === "pincode" ? { pattern: "[1-9][0-9]{5}", minLength: 6 } : {})}
      {...(name === "logoImageUrl" ? { placeholder: "https://…" } : {})} />
  </label>;
}

type Props = {
  values?: StoreProfileValues;
  disabled?: boolean;
  variant?: "admin" | "vendor";
  children?: ReactNode;
};

export function StoreProfileFields({ values = {}, disabled = false, variant = "admin", children }: Props) {
  const vendor = variant === "vendor";
  const fieldClass = vendor ? "vendor-label" : "lb-admin-field";
  const textareaClass = vendor ? "vendor-textarea" : "";
  const field = (label: string, name: keyof StoreProfileValues, options: Omit<FieldProps, "label" | "name" | "values" | "disabled" | "variant"> = {}) =>
    <ProfileField key={name} label={label} name={name} values={values} disabled={disabled} variant={variant} {...options} />;
  return <div className={`${vendor ? "vendor-profile-fields" : "lb-admin-profile-fields"}`}>
    <div className={vendor ? "vendor-card-heading" : "lb-admin-form-section"}><div><h3>{children ?? "Owner & store profile"}</h3><p>{vendor ? "Keep your customer-facing store details current." : "Owner and customer-facing store information."} <span className="lb-required-note">* Required</span></p></div></div>
    <div className={vendor ? "vendor-profile-fields-grid" : "lb-admin-provision-grid"}>
      {field("Shop name", "name", { required: true, maxLength: 120 })}
      {field("Owner name", "ownerName", { required: true, maxLength: 100 })}
      {field("Mobile number", "phone", { type: "tel", inputMode: "tel" })}
      {field("Email", "email", { type: "email", maxLength: 254 })}
      <label className={`${fieldClass}${vendor ? "" : " wide"}`}>Store description
        <textarea className={textareaClass} name="description" defaultValue={values.description ?? ""} maxLength={2000} rows={3} disabled={disabled} />
      </label>
      {field("Store logo URL", "logoImageUrl", { type: "url", maxLength: 2048 })}
      <div className={vendor ? "vendor-address-group" : "lb-admin-address-group"}>
        <strong className={vendor ? "vendor-address-title" : "lb-admin-form-subhead"}>Store location</strong>
        <div className={vendor ? "vendor-profile-fields-grid" : "lb-admin-provision-grid"}>
          {field("Address line 1", "addressLine1", { required: true, maxLength: 250 })}
          {field("Address line 2 · optional", "addressLine2", { maxLength: 250 })}
          {field("Area / locality", "locality", { required: true, maxLength: 120 })}
          {field("City", "city", { required: true, maxLength: 120 })}
          {field("State", "state", { required: true, maxLength: 120 })}
          {field("Pincode", "pincode", { required: true })}
        </div>
      </div>
      <div className={vendor ? "vendor-address-group" : "lb-admin-address-group"}>
        <strong className={vendor ? "vendor-address-title" : "lb-admin-form-subhead"}>Exact store location · optional</strong>
        {!vendor && <p className="lb-admin-secondary">Review the saved pin or place/drag it to update the exact location.</p>}
        <StoreLocationMap latitude={values.latitude} longitude={values.longitude} editable={!disabled} />
      </div>
      {!vendor && <div className="lb-admin-address-group">
        <strong className={vendor ? "vendor-address-title" : "lb-admin-form-subhead"}>Store operations</strong>
        <div className={vendor ? "vendor-profile-fields-grid" : "lb-admin-provision-grid"}>
          {field("Delivery fee (₹)", "deliveryFee", { type: "number", value: values.deliveryFee, inputMode: "decimal" })}
          {field("Handling fee (₹)", "handlingFee", { type: "number", value: values.handlingFee ?? "0.00", inputMode: "decimal", required: true })}
          {field("Minimum order value (₹)", "minimumOrderValue", { type: "number", value: values.minimumOrderValue, inputMode: "decimal" })}
        </div>
      </div>}
    </div>
  </div>;
}
