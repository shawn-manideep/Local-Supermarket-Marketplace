import { useState, type FormEvent } from "react";
import { portalLoginIdentifierSchema } from "@workspace/validation";
import type { PartnerSessionOutcome } from "../../../lib/api-client-react/src/generated/api.schemas";
import { apiRequest } from "./api";
import "./partner.css";
import { PasswordInput, ForgotPassword } from "./AuthControls";
import { BrandingLogo } from "./BrandingLogo";
import { useSignInLanguage } from "./sign-in-language";

type Props = {
  onAuthenticated: (session: { access_token: string; refresh_token: string }) => Promise<void>;
};

export function DeliveryPartnerLogin({ onAuthenticated }: Props) {
  const [username, setUsername] = useState("");
  const { t, language, languageControl } = useSignInLanguage();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const identity = portalLoginIdentifierSchema.safeParse(username);
    if (!identity.success) {
      setError("Enter a valid username or email address.");
      return;
    }
    setBusy(true);
    try {
      const credentials = { username: identity.data, password };
      const outcome = await apiRequest<PartnerSessionOutcome>(
        "/api/delivery-partner/login",
        "",
        { method: "POST", body: JSON.stringify(credentials) },
      );
      await onAuthenticated(outcome.session);
      setPassword("");
      setUsername("");
    } catch {
      setPassword("");
      setError("Unable to sign in. Check your details and try again.");
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
              <div className="lbp-brand-copy"><strong>Apna Local Basket</strong><span>{t("Partner operations")}</span></div>
            </div>
            <div>
              <p className="lbp-kicker">{t("Delivery partner portal")}</p>
              <h1>{t("Your route starts here.")}</h1>
              <p>{t("A quiet place to check your daily delivery totals, assigned work, and partner profile.")}</p>
            </div>
          </section>
          <section className="lbp-login-form-wrap">
            <form className="lbp-login-form" onSubmit={submit}>
              {languageControl}
              <p className="lbp-kicker">{t("Secure access")}</p>
              <h2>{t("Partner sign in")}</h2>
              <p>{t("Use your registered username or email address and password.")}</p>
              {error && <div className="lbp-alert" role="alert" data-testid="status-partner-login-error">{t(error)}</div>}
              <div className="lbp-field">
                <label htmlFor="lbp-identity">{t("Username or email address")}</label>
                <input id="lbp-identity" data-testid="input-partner-username" type="text" autoComplete="username" placeholder={t("Enter your username or email address")} maxLength={254} value={username} onChange={(event) => { setUsername(event.target.value); setError(""); }} required />
              </div>
              <div className="lbp-field">
                <label htmlFor="lbp-password">{t("Password")}</label>
                <PasswordInput language={language} id="lbp-password" data-testid="input-partner-password" autoComplete="current-password" maxLength={128} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} required />
              </div>
              <button className="lbp-button lbp-button-primary" data-testid="button-partner-sign-in" disabled={busy} type="submit">{t(busy ? "Signing in…" : "Sign in")}</button>
              <div className="lbp-login-footer"><span>{t("Partner accounts are provided by an administrator.")}</span></div>
            </form>
            <ForgotPassword language={language} role="delivery_partner" initialIdentity={username} identityType="legacy" />
          </section>
        </div>
      </div>
    </main>
  );
}