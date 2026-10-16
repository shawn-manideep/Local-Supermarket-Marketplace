import { useState, type FormEvent } from "react";
import { usernameSchema, indianMobileSchema } from "@workspace/validation";
import type { PartnerSessionOutcome } from "../../../lib/api-client-react/src/generated/api.schemas";
import { ApiRequestError, apiRequest } from "./api";
import "./partner.css";
import { PasswordInput, ForgotPassword } from "./AuthControls";
import { BrandingLogo } from "./BrandingLogo";

type Props = {
  onAuthenticated: (session: { access_token: string; refresh_token: string }) => Promise<void>;
};

export function DeliveryPartnerLogin({ onAuthenticated }: Props) {
  const [username, setUsername] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [legacyLogin, setLegacyLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const identity = legacyLogin ? usernameSchema.safeParse(username) : indianMobileSchema.safeParse(mobileNumber);
    if (!identity.success) {
      setError(legacyLogin ? "Enter your delivery partner username." : "Enter a valid registered Indian mobile number.");
      return;
    }
    setBusy(true);
    try {
      const credentials = legacyLogin ? { username: identity.data, password } : { mobileNumber: identity.data, password };
      const outcome = await apiRequest<PartnerSessionOutcome>(
        legacyLogin ? "/api/delivery-partner/login" : "/api/delivery-partner/mobile-login",
        "",
        { method: "POST", body: JSON.stringify(credentials) },
      );
      await onAuthenticated(outcome.session);
      setPassword("");
      setUsername("");
      setMobileNumber("");
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
              <BrandingLogo className="lbp-mark" />
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
              <p>{legacyLogin ? "Use the username issued by your Local Basket administrator." : "Mobile sign-in requires verified ownership. Existing partners can use their administrator-issued username below."}</p>
              {error && <div className="lbp-alert" role="alert" data-testid="status-partner-login-error">{error}</div>}
              <div className="lbp-field">
                <label htmlFor="lbp-identity">{legacyLogin ? "Username" : "Mobile Number"}</label>
                <input id="lbp-identity" data-testid={legacyLogin ? "input-partner-username" : "input-partner-mobile"} type={legacyLogin ? "text" : "tel"} inputMode={legacyLogin ? "text" : "tel"} autoComplete={legacyLogin ? "username" : "tel"} placeholder={legacyLogin ? "Enter your administrator-issued username" : "Enter your registered mobile number"} maxLength={legacyLogin ? 30 : 13} value={legacyLogin ? username : mobileNumber} onChange={(event) => { legacyLogin ? setUsername(event.target.value) : setMobileNumber(event.target.value); setError(""); }} required />
              </div>
              <div className="lbp-field">
                <label htmlFor="lbp-password">Password</label>
                <PasswordInput id="lbp-password" data-testid="input-partner-password" autoComplete="current-password" maxLength={128} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} required />
              </div>
              <button className="lbp-button lbp-button-primary" data-testid="button-partner-sign-in" disabled={busy} type="submit">{busy ? "Checking access…" : "Sign in"}</button>
              <div className="lbp-login-footer"><span>Partner accounts are provided by an administrator.</span></div>
            </form>
            <button type="button" className="text-button" disabled={busy} onClick={() => { setLegacyLogin(value => !value); setPassword(""); setError(""); }}>{legacyLogin ? "Use mobile number instead" : "Use administrator-issued username instead"}</button>
            <ForgotPassword key={legacyLogin ? "legacy" : "mobile"} role="delivery_partner" initialIdentity={legacyLogin ? username : mobileNumber} identityType={legacyLogin ? "legacy" : "mobile"} />
          </section>
        </div>
      </div>
    </main>
  );
}