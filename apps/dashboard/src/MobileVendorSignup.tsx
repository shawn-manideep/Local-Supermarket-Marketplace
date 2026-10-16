import { useState, type FormEvent } from "react";
import { mobileRegistrationSchema } from "@workspace/validation";
import { vendorRegistrationSchema } from "@workspace/validation/vendor-profile";
import { PasswordInput } from "./AuthControls";

export function MobileVendorSignup({ onLegacy, onBack }: {
  onLegacy: (shopName: string) => void; onBack: () => void;
}) {
  const [shopName, setShopName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);
  const changed = () => { setError(""); setChecked(false); };
  const validate = (event: FormEvent) => {
    event.preventDefault();
    setChecked(false);
    const shop = vendorRegistrationSchema.shape.name.safeParse(shopName);
    const result = mobileRegistrationSchema.safeParse({ mobileNumber, password, confirmation });
    if (!shop.success || !result.success) {
      setError(!shop.success ? shop.error.issues[0]?.message ?? "Enter a valid shop name."
        : !result.success ? result.error.issues[0]?.message ?? "Check your details." : "");
      return;
    }
    setError(""); setChecked(true);
    setPassword(""); setConfirmation("");
    // Never create a signup shell, profile or store before mobile verification.
  };
  return <form className="auth-form" onSubmit={validate} data-testid="vendor-mobile-registration" noValidate>
    <p className="eyebrow">Apna Local Basket · Vendor</p>
    <h1>Create a Vendor account</h1>
    <p className="muted">Email-free registration is not yet available. Your mobile number must be verified before an account can be created.</p>
    <p className="muted">New stores still require Admin approval and mandatory document verification before catalog access.</p>
    <label>Shop Name<input className="vendor-input" autoComplete="organization" required maxLength={120}
      value={shopName} onChange={event => { setShopName(event.target.value); changed(); }} /></label>
    <label>Mobile Number<input type="tel" autoComplete="tel" required maxLength={13} placeholder="Enter your mobile number"
      value={mobileNumber} onChange={event => { setMobileNumber(event.target.value); changed(); }} /></label>
    <p className="muted">Use at least 8 characters, including a letter and a number.</p>
    <label>Password<PasswordInput autoComplete="new-password" required maxLength={128}
      value={password} onChange={event => { setPassword(event.target.value); changed(); }} /></label>
    <label>Confirm Password<PasswordInput autoComplete="new-password" required maxLength={128}
      value={confirmation} onChange={event => { setConfirmation(event.target.value); changed(); }} /></label>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {checked && <p className="muted" role="status">Details are valid, but no account was created. Secure mobile verification is not available yet.</p>}
    <button className="primary-button" type="submit">Check details</button>
    <button className="text-button" type="button" onClick={() => onLegacy(shopName)}>Use current email registration</button>
    <button className="text-button" type="button" onClick={onBack}>Back to sign in</button>
  </form>;
}
