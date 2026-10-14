import type { FssaiStatus } from "../../../lib/api-client-react/src/generated/api.schemas";

export function formatFssaiExpiryDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00+05:30`);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "Asia/Kolkata" }).format(date);
}

export function FssaiExpiryStatus({ value }: { value: FssaiStatus }) {
  const label = value.status === "DATE_REQUIRED" ? "Expiry date required" : value.status.replaceAll("_", " ");
  const expiryDate = formatFssaiExpiryDate(value.expiryDate);
  return <div className={`vendor-fssai-status is-${value.status.toLowerCase()}`} role={value.status === "EXPIRED" ? "alert" : "status"} data-testid="status-fssai-expiry">
    <div><strong>FSSAI license · {label}</strong>
      <span>{expiryDate
        ? `Expires ${expiryDate}${value.daysRemaining != null && value.daysRemaining >= 0 ? ` · ${value.daysRemaining} days remaining` : ""}`
        : "No expiry date has been provided; status is unknown until the actual date is entered."}</span>
    </div>
    {value.status === "EXPIRED" && <strong>Expired · compliance action required</strong>}
  </div>;
}
