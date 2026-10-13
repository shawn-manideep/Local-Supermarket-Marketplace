import { useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { resetPasswordSchema, usernameSchema } from "@workspace/validation";
import { vendorRegistrationSchema } from "@workspace/validation/vendor-profile";
import { apiRequest } from "./api";
import { PasswordInput } from "./AuthControls";
import { supabase } from "./supabase";

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
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [fields, setFields] = useState<Registration>(() => ({
    ...empty, username: session?.user.user_metadata?.username ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const begin = async (event: FormEvent) => {
    event.preventDefault();
    const checked = resetPasswordSchema.safeParse(password);
    const name = usernameSchema.safeParse(fields.username);
    if (!checked.success || !name.success || password !== confirmation) {
      setError(!checked.success ? checked.error.issues[0]?.message ?? "Invalid password." :
        !name.success ? name.error.issues[0]?.message ?? "Invalid username." : "Passwords must match.");
      return;
    }
    setBusy(true); setError("");
    try {
      if (!supabase) throw new Error("Sign-up is unavailable.");
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(), password,
        options: {
          data: { vendor_signup: true, username: name.data },
          emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
        },
      });
      if (signUpError) throw signUpError;
      setPassword(""); setConfirmation("");
      if (!data.session) setMessage("Check your email to verify your account, then return here to complete your store registration.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-up could not be completed.");
    } finally { setBusy(false); }
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
  return (
    <form className="auth-form" onSubmit={session ? finish : begin}>
      <p className="eyebrow">Local Basket · Vendor</p>
      <h1>{session ? "Complete your store registration" : "Create a Vendor account"}</h1>
      <p className="muted">{session
        ? "Use your verified email to register a new store. Admin approval and document review are required before catalog access."
        : "Verify your email before setting up your store. Existing customer accounts cannot be converted."}</p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {message && <p className="auth-success" role="status">{message}</p>}
      {input("username", "Vendor username", "username")}
      {!session ? <>
        <label>Email address<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>Password<PasswordInput autoComplete="new-password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <label>Confirm password<PasswordInput autoComplete="new-password" required maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
      </> : <>
        {input("name", "Store name", "organization")}
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
