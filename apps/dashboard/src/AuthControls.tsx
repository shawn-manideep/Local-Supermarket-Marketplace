import { useState, type FormEvent, type InputHTMLAttributes } from "react";
import { RECOVERY_CONFIRMATION, resetPasswordSchema, portalResetPasswordSchema, indianMobileSchema, usernameSchema, isPasswordOwner } from "@workspace/validation";
import { apiRequest } from "./api";
import { supabase } from "./supabase";
import type { AccountRecoveryInput } from "../../../lib/api-client-react/src/generated/api.schemas";
import "./auth-controls.css";
import { passwordVisibility } from "@workspace/constants";

export function EyeIcon({ visible }: { visible: boolean }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{visible && <path d="m3 3 18 18" />}</svg>;
}

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  const visibility = passwordVisibility(visible);
  return <div className="auth-password-wrap"><input {...props} type={visibility.inputType} /><button type="button" className="auth-eye" aria-label={visibility.label} aria-pressed={visible} onClick={() => setVisible(value => !value)}><EyeIcon visible={visible} /></button></div>;
}

export function ForgotPassword({ role, initialIdentity = "", identityType = "legacy" }: {
  role: AccountRecoveryInput["role"]; initialIdentity?: string; identityType?: "mobile" | "legacy";
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const checked = (role === "admin" ? resetPasswordSchema : portalResetPasswordSchema).safeParse(password);
    if (!checked.success || password !== confirmation) {
      setError(!checked.success ? checked.error.issues[0]?.message ?? "Enter a valid password." : "Passwords must match."); return;
    }
    const identity = initialIdentity.trim();
    if (!identity) { setError("Enter your account identity on the sign-in screen first, then reopen Forgot Password."); return; }
    if (role !== "admin" && identityType === "mobile" && !indianMobileSchema.safeParse(identity).success) {
      setError("Enter a valid registered mobile number on the sign-in screen first."); return;
    }
    if (identityType !== "mobile" && (role === "customer" || role === "delivery_partner" || !identity.includes("@")) && !usernameSchema.safeParse(identity).success) {
      setError("Enter a valid username."); return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      await apiRequest("/api/auth/recovery", "", { method: "POST", body: JSON.stringify({
        role, identity, ...(role !== "admin" ? { identityType } : {}),
      }) });
      setPassword(""); setConfirmation("");
      setMessage(RECOVERY_CONFIRMATION);
    } catch {
      setError("Reset instructions could not be requested. Please wait and try again.");
    } finally { setBusy(false); }
  };
  return <div className="auth-recovery">
    {!open ? <button type="button" className="text-button" onClick={() => setOpen(true)}>Forgot Password?</button> :
      <form onSubmit={send} aria-label={`${role} password recovery`}>
        <h2>Reset your password</h2><p className="muted">Verify ownership using the recovery link sent for the account entered on sign-in. Your password will only be saved after verification; re-enter it on the verified reset screen.</p>
        {role !== "admin" && <p className="muted">Use at least 8 characters, including a letter and a number. Save Password becomes available after ownership verification. If mobile ownership is not verified yet, use legacy sign-in to request recovery.</p>}
        <label>New Password<PasswordInput autoComplete="new-password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <label>{role === "admin" ? "Re-enter New Password" : "Re-enter Password"}<PasswordInput autoComplete="new-password" required maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        {message && <p className="auth-success" role="status">{message}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Sending…" : role === "admin" ? "Send Reset Instructions" : "Verify account ownership"}</button>
        {role !== "admin" && <button className="primary-button" type="button" disabled title="Complete ownership verification first">Save Password</button>}
        <button className="text-button" type="button" disabled={busy} onClick={() => { setOpen(false); setMessage(""); setError(""); setPassword(""); setConfirmation(""); }}>Back to sign in</button>
      </form>}
  </div>;
}

export function ResetPassword({ role, onComplete }: { role: AccountRecoveryInput["role"]; onComplete: (success: boolean) => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = (role === "admin" ? resetPasswordSchema : portalResetPasswordSchema).safeParse(password);
    if (!result.success || password !== confirmation) { setError(!result.success ? result.error.issues[0]?.message ?? "Enter a valid password." : "Passwords must match."); return; }
    setBusy(true); setError("");
    try {
      if (!supabase) throw new Error();
      const { data: before } = await supabase.auth.getSession();
      if (!before.session) throw new Error();
      const profile = await apiRequest<{ auth?: { role?: string; userId?: string } }>("/api/auth/me", before.session.access_token);
      if (!isPasswordOwner(profile.auth, before.session.user.id, role)) throw new Error();
      const { data: current } = await supabase.auth.getSession();
      if (current.session?.user.id !== before.session.user.id || current.session?.access_token !== before.session.access_token) throw new Error();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error();
      setPassword(""); setConfirmation("");
      await supabase.auth.signOut();
      onComplete(true);
    } catch { setError("Your reset link may have expired. Request new instructions and try again."); }
    finally { setBusy(false); }
  };
  return <form className="auth-form" onSubmit={submit}><h1>Choose a new password</h1><p className="muted">{role === "admin" ? "Use at least 8 characters." : "Use at least 8 characters, including a letter and a number."}</p><label>New Password<PasswordInput autoComplete="new-password" required value={password} onChange={event => setPassword(event.target.value)} maxLength={128} /></label><label>{role === "admin" ? "Re-enter New Password" : "Re-enter Password"}<PasswordInput autoComplete="new-password" required value={confirmation} onChange={event => setConfirmation(event.target.value)} maxLength={128} /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? "Updating…" : role === "admin" ? "Update password" : "Save Password"}</button><button type="button" className="text-button" disabled={busy} onClick={async () => { setPassword(""); setConfirmation(""); await supabase?.auth.signOut(); onComplete(false); }}>Cancel reset</button></form>;
}
