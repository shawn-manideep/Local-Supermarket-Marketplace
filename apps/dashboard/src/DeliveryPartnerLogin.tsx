import { useState, type FormEvent } from "react";
import { usernameSchema } from "@workspace/validation";
import type { PartnerCredentials, PartnerSessionOutcome } from "../../../lib/api-client-react/src/generated/api.schemas";
import { ApiRequestError, apiRequest } from "./api";
import "./partner.css";
import { PasswordInput, ForgotPassword } from "./AuthControls";

type Props = {
  onAuthenticated: (session: { access_token: string; refresh_token: string }) => Promise<void>;
  onCancel: () => void;
};

export function DeliveryPartnerLogin({ onAuthenticated, onCancel }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!usernameSchema.safeParse(username).success) {
      setError("Enter your delivery partner username.");
      return;
    }
    setBusy(true);
    try {
      const credentials: PartnerCredentials = { username, password };
      const outcome = await apiRequest<PartnerSessionOutcome>(
        "/api/delivery-partner/login",
        "",
        { method: "POST", body: JSON.stringify(credentials) },
      );
      await onAuthenticated(outcome.session);
      setPassword("");
      setUsername("");
    } catch (reason) {
      setPassword("");
      setError(reason instanceof ApiRequestError && reason.status === 403 ? reason.message : "We could not sign you in with those details. Check them and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="lbp">
      <div className="lbp-frame">
        <div className="lbp-login-shell">
          <section className="lbp-login-intro" aria-label="Delivery partner access">
            <div className="lbp-brand">
              <span className="lbp-mark" aria-hidden="true">LB</span>
              <div className="lbp-brand-copy"><strong>Local Basket</strong><span>Partner operations</span></div>
            </div>
            <div>
              <p className="lbp-kicker">Delivery partner portal</p>
              <h1>Your route starts here.</h1>
              <p>A quiet place to check your daily delivery totals, assigned work, and partner profile.</p>
            </div>
          </section>
          <section className="lbp-login-form-wrap">
            <form className="lbp-login-form" onSubmit={submit}>
              <p className="lbp-kicker">Secure access</p>
              <h2>Partner sign in</h2>
              <p>Use the username issued by your Local Basket administrator.</p>
              {error && <div className="lbp-alert" role="alert" data-testid="status-partner-login-error">{error}</div>}
              <div className="lbp-field">
                <label htmlFor="lbp-username">Username</label>
                <input id="lbp-username" data-testid="input-partner-username" autoComplete="username" maxLength={30} value={username} onChange={(event) => { setUsername(event.target.value); setError(""); }} required />
              </div>
              <div className="lbp-field">
                <label htmlFor="lbp-password">Password</label>
                <PasswordInput id="lbp-password" data-testid="input-partner-password" autoComplete="current-password" maxLength={128} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} required />
              </div>
              <button className="lbp-button lbp-button-primary" data-testid="button-partner-sign-in" disabled={busy} type="submit">{busy ? "Checking access…" : "Sign in"}</button>
              <div className="lbp-login-footer"><span>Partner accounts are provided by an administrator.</span><button className="lbp-button lbp-button-quiet" data-testid="button-partner-login-cancel" onClick={onCancel} type="button">Cancel</button></div>
            </form>
            <ForgotPassword role="delivery_partner" initialIdentity={username} />
          </section>
        </div>
      </div>
    </main>
  );
}