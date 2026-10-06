import { useState, type FormEvent, type InputHTMLAttributes } from "react";
import { RECOVERY_CONFIRMATION, resetPasswordSchema, usernameSchema } from "@workspace/validation";
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

export function ForgotPassword({ role, initialIdentity = "" }: { role: AccountRecoveryInput["role"]; initialIdentity?: string }) {
  const [open, setOpen] = useState(false);
  const [identity, setIdentity] = useState(initialIdentity);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const label = role === "admin" ? "Email address" : role === "vendor" ? "Email or vendor username" : "Username";
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if ((role === "customer" || role === "delivery_partner" || !identity.includes("@")) && !usernameSchema.safeParse(identity).success) {
      setError("Enter a valid username."); return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      await apiRequest("/api/auth/recovery", "", { method: "POST", body: JSON.stringify({ role, identity }) });
      setMessage(RECOVERY_CONFIRMATION);
    } catch {
      setError("Reset instructions could not be requested. Please wait and try again.");
    } finally { setBusy(false); }
  };
  return <div className="auth-recovery">
    {!open ? <button type="button" className="text-button" onClick={() => { setIdentity(initialIdentity); setOpen(true); }}>Forgot Password?</button> :
      <form onSubmit={send} aria-label={`${role} password recovery`}>
        <h2>Reset your password</h2><p className="muted">Instructions will go to your registered recovery contact.</p>
        <label>{label}<input type={role === "admin" ? "email" : "text"} autoComplete={role === "admin" ? "email" : "username"} value={identity} maxLength={254} required onChange={event => { setIdentity(event.target.value); setError(""); setMessage(""); }} /></label>
        {message && <p className="auth-success" role="status">{message}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Sending…" : "Send Reset Instructions"}</button>
        <button className="text-button" type="button" disabled={busy} onClick={() => { setOpen(false); setMessage(""); setError(""); }}>Back to sign in</button>
      </form>}
  </div>;
}

export function ResetPassword({ onComplete }: { onComplete: (success: boolean) => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = resetPasswordSchema.safeParse(password);
    if (!result.success || password !== confirmation) { setError(!result.success ? result.error.issues[0]?.message ?? "Enter a valid password." : "Passwords must match."); return; }
    setBusy(true); setError("");
    try {
      if (!supabase) throw new Error();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error();
      setPassword(""); setConfirmation("");
      await supabase.auth.signOut();
      onComplete(true);
    } catch { setError("Your reset link may have expired. Request new instructions and try again."); }
    finally { setBusy(false); }
  };
  return <form className="auth-form" onSubmit={submit}><h1>Choose a new password</h1><p className="muted">Use at least 8 characters.</p><label>New password<PasswordInput autoComplete="new-password" required value={password} onChange={event => setPassword(event.target.value)} maxLength={128} /></label><label>Confirm password<PasswordInput autoComplete="new-password" required value={confirmation} onChange={event => setConfirmation(event.target.value)} maxLength={128} /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? "Updating…" : "Update password"}</button><button type="button" className="text-button" disabled={busy} onClick={async () => { setPassword(""); setConfirmation(""); await supabase?.auth.signOut(); onComplete(false); }}>Cancel reset</button></form>;
}
