import { useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { portalLoginIdentifierSchema, portalResetPasswordSchema, usernameSchema } from "@workspace/validation";
import { vendorRegistrationSchema } from "@workspace/validation/vendor-profile";
import { apiRequest } from "./api";
import { PasswordInput } from "./AuthControls";
import { supabase } from "./supabase";
import { MobileVendorSignup } from "./MobileVendorSignup";
import { portalRoutePath } from "./portal-routes";

type Registration = {
  username: string; name: string; ownerName: string; phone: string;
  addressLine1: string; locality: string; city: string; state: string; pincode: string;
};
const empty: Registration = {
  username: "", name: "", ownerName: "", phone: "", addressLine1: "",
  locality: "", city: "", state: "", pincode: "",
};

export function VendorSignup({ session, onBack, onCompleted }: {
  session?: Session;
  onBack: () => void;
  onCompleted?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [legacyRegistration, setLegacyRegistration] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [fields, setFields] = useState<Registration>(() => ({
    ...empty, username: session?.user.user_metadata?.username ?? "",
    name: session?.user.user_metadata?.shop_name ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const signupState = useRef<"idle" | "sending" | "pending">("idle");
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  const begin = async (event: FormEvent) => {
    event.preventDefault();
    if (signupState.current !== "idle") return;
    if (!legacyRegistration) return;
    const signupEmail = email.trim();
    // Require the shared identifier schema's email branch, not a valid username.
    if (!signupEmail.includes("@") || !portalLoginIdentifierSchema.safeParse(signupEmail).success) {
      setError("Enter a valid email address."); return;
    }
    const checked = portalResetPasswordSchema.safeParse(password);
    const name = usernameSchema.safeParse(fields.username);
    const shop = vendorRegistrationSchema.shape.name.safeParse(fields.name);
    if (!shop.success) {
      setError(shop.error.issues[0]?.message ?? "Enter a valid shop name."); return;
    }
    if (!checked.success || !name.success || password !== confirmation) {
      setError(!checked.success ? checked.error.issues[0]?.message ?? "Invalid password." :
        !name.success ? name.error.issues[0]?.message ?? "Invalid username." : "Passwords must match.");
      return;
    }
    signupState.current = "sending";
    setBusy(true); setError("");
    try {
      if (!supabase) throw new Error("Sign-up is unavailable.");
      const { error: signUpError } = await supabase.auth.signUp({
        email: signupEmail, password,
        options: {
          data: { vendor_signup: true, username: name.data, shop_name: fields.name.trim() },
          emailRedirectTo: `${window.location.origin}${portalRoutePath("vendor-login", import.meta.env.BASE_URL)}`,
        },
      });
      if (signUpError) throw signUpError;
      signupState.current = "pending";
      setConfirmationEmail(signupEmail);
      setPassword(""); setConfirmation("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-up could not be completed.");
    } finally {
      if (signupState.current === "sending") signupState.current = "idle";
      setBusy(false);
    }
  };

  const finish = async (event: FormEvent) => {
    event.preventDefault();
    if (!session) return;
    const checked = vendorRegistrationSchema.safeParse(fields);
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? "Check the required store details."); return;
    }
    setBusy(true); setError("");
    try {
      await apiRequest("/api/vendor/register", session.access_token, {
        method: "POST", body: JSON.stringify(checked.data),
      });
      setMessage("Registration submitted. Your store is pending Admin approval and document verification.");
      onCompleted?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Registration could not be completed.");
    } finally { setBusy(false); }
  };

  const input = (key: keyof Registration, label: string, autoComplete?: string) => (
    <label key={key}>{label}<input className="vendor-input" required maxLength={key === "addressLine1" ? 250 : 120}
      autoComplete={autoComplete} value={fields[key]}
      onChange={event => { setFields(old => ({ ...old, [key]: event.target.value })); setError(""); }} /></label>
  );
  if (!session && confirmationEmail) return <div className="auth-form">
    <h1>Email confirmation requested</h1>
    <p className="muted">Check your inbox to verify your email, then return here to complete your store registration.</p>
    <p role="status">{confirmationEmail}</p>
    <p className="muted">If this address is incorrect, change it before submitting again. This does not change an existing account.</p>
    <button className="text-button" type="button" onClick={() => {
      signupState.current = "idle";
      setConfirmationEmail(null);
      setEmail(confirmationEmail);
      setPassword(""); setConfirmation(""); setError(""); setMessage("");
    }}>Change email address</button>
    <button className="text-button" type="button" onClick={onBack}>Back to sign in</button>
  </div>;
  if (!session && !legacyRegistration) return <MobileVendorSignup onBack={onBack} onLegacy={shopName => {
    setFields(old => ({ ...old, name: shopName })); setLegacyRegistration(true);
    setError(""); setMessage(""); setPassword(""); setConfirmation("");
  }} />;
  return (
    <form className="auth-form" onSubmit={session ? finish : begin}>
      <p className="eyebrow">Apna Local Basket · Vendor</p>
      <h1>{session ? "Complete your store registration" : "Create a Vendor account"}</h1>
      <p className="muted">{session
        ? "Use your verified email to register a new store. Admin approval and document review are required before catalog access."
        : "Verify your email before setting up your store. Existing customer accounts cannot be converted."}</p>
      {!session && <p className="muted">Registration still requires a recovery email until secure mobile ownership enrollment is available. A store contact number is not a verified login number.</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {message && <p className="auth-success" role="status">{message}</p>}
      {input("name", "Shop Name", "organization")}
      {input("username", "Vendor username", "username")}
      {!session ? <>
        <label>Email address<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>Password<PasswordInput autoComplete="new-password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <label>Confirm Password<PasswordInput autoComplete="new-password" required maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
      </> : <>
        {input("ownerName", "Owner name", "name")}
        {input("phone", "Contact number", "tel")}
        {input("addressLine1", "Store street address", "street-address")}
        {input("locality", "Locality")}
        {input("city", "City", "address-level2")}
        {input("state", "State", "address-level1")}
        {input("pincode", "PIN code", "postal-code")}
      </>}
      <button className="primary-button" disabled={busy} type="submit">{busy ? "Please wait…" : session ? "Submit registration" : "Verify email & continue"}</button>
      {!session && <button className="text-button" type="button" onClick={onBack}>Back to sign in</button>}
    </form>
  );
}
