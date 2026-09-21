import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { AdminStorePanel } from "./AdminStorePanel";
import { ApiRequestError, apiRequest } from "./api";
import { supabase, supabaseConfigMissing } from "./supabase";
import { VendorStorePanel } from "./VendorStorePanel";

type Role = "customer" | "vendor" | "admin";
type AuthProfile = { auth: { userId: string; role: Role; storeId: string | null } };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthProfile["auth"] | null>(null);
  const [authLoading, setAuthLoading] = useState(!supabaseConfigMissing);
  const [roleLoading, setRoleLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [notice, setNotice] = useState<{ message: string; kind: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) {
          setSession(data.session);
        }
      })
      .catch(() => {
        if (active) {
          setAuthError("Your saved session could not be restored. Sign in again.");
        }
      })
      .finally(() => {
        if (active) {
          setAuthLoading(false);
        }
      });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setProfile(null);
      setAuthLoading(false);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.access_token) {
      setProfile(null);
      setRoleLoading(false);
      return;
    }
    let active = true;
    setRoleLoading(true);
    setAuthError("");
    void apiRequest<AuthProfile>("/api/auth/me", session.access_token)
      .then((response) => {
        if (active) {
          setProfile(response.auth);
        }
      })
      .catch(async (error) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Your session could not be verified.";
        if (error instanceof ApiRequestError && error.status === 401) {
          await supabase?.auth.signOut();
          setAuthError("Your session expired. Sign in again to continue.");
        } else {
          setAuthError(message);
        }
      })
      .finally(() => {
        if (active) setRoleLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.access_token]);

  const onMessage = (message: string, kind: "success" | "error" = "success") => {
    setNotice({ message, kind });
  };

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    if (!supabase) return;
    setAuthLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setAuthError(error.message);
      } else if (!data.session) {
        setAuthError("Sign-in succeeded without a usable session. Try again.");
      }
    } catch {
      setAuthError("Sign-in could not reach the authentication service. Try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const signOut = async () => {
    setAuthError("");
    await supabase?.auth.signOut();
    setProfile(null);
    setSession(null);
  };

  if (supabaseConfigMissing) {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><AuthState title="Configuration needed" message="Supabase sign-in is not configured for this dashboard. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to continue." /></AuthFrame></div></main>;
  }

  if (authLoading) {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><div className="auth-loading" aria-label="Loading authentication"><span /><span /><span /></div></AuthFrame></div></main>;
  }

  if (!session) {
    return (
      <main className="page"><div className="dashboard-shell"><AuthFrame>
        <form className="auth-form" onSubmit={signIn}>
          <p className="eyebrow">Secure operations access</p>
          <h1>Sign in to store management</h1>
          <p className="muted">Use your marketplace account to manage stores, catalog, and orders.</p>
          {authError && <div className="auth-error" role="alert">{authError}</div>}
          <label>Email address<input data-testid="input-email" autoComplete="email" onChange={(event) => { setEmail(event.target.value); setAuthError(""); }} type="email" value={email} required /></label>
          <label>Password<input data-testid="input-password" autoComplete="current-password" onChange={(event) => { setPassword(event.target.value); setAuthError(""); }} type="password" value={password} required /></label>
          <button className="primary-button auth-submit" data-testid="button-sign-in" disabled={authLoading} type="submit">{authLoading ? "Signing in…" : "Sign in"}</button>
        </form>
      </AuthFrame></div></main>
    );
  }

  if (roleLoading) {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><div className="auth-loading" aria-label="Loading account permissions"><span /><span /><span /></div></AuthFrame></div></main>;
  }

  if (authError || !profile) {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><AuthState title="Could not verify access" message={authError || "The account permissions response was incomplete."} action={signOut} /></AuthFrame></div></main>;
  }

  if (profile.role === "customer") {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><AuthState title="Management access is unavailable" message="This account is a customer account. Ask a platform administrator for vendor or admin access." action={signOut} actionLabel="Sign out" /></AuthFrame></div></main>;
  }

  return (
    <main className="page">
      <div className="dashboard-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local Supermarket Marketplace</p>
            <h1>Store management</h1>
          </div>
          <div className="topbar-actions"><div className="phase-badge">Phase 9A</div><button className="text-button" data-testid="button-sign-out" onClick={signOut} type="button">Sign out</button></div>
        </header>

        <section className="auth-strip">
          <div>
            <strong>Protected dashboard session</strong>
            <p className="muted">{profile.role === "vendor" ? "Vendor workspace" : "Platform admin workspace"} · Session refresh is on</p>
          </div>
          <span className="session-status"><i /> Signed in</span>
        </section>

        {notice && (
          <div className={`notice notice-${notice.kind}`} role="status">
            {notice.message}
             <button aria-label="Dismiss notification" onClick={() => setNotice(null)} type="button">×</button>
          </div>
        )}

        {profile.role === "vendor" ? (
          profile.storeId ? <VendorStorePanel onMessage={onMessage} token={session.access_token} /> : <div className="empty-state"><strong>No vendor store is linked</strong><span>Your account is approved for vendor access, but no store has been assigned yet.</span></div>
        ) : (
          <AdminStorePanel onMessage={onMessage} token={session.access_token} />
        )}
      </div>
    </main>
  );
}

function AuthFrame({ children }: { children: ReactNode }) {
  return <div className="auth-frame"><div className="auth-mark">LS</div>{children}</div>;
}

function AuthState({ title, message, action, actionLabel = "Return to sign in" }: { title: string; message: string; action?: () => void; actionLabel?: string }) {
  return <div className="auth-state"><p className="eyebrow">Local Supermarket Marketplace</p><h1>{title}</h1><p className="muted">{message}</p>{action && <button className="secondary-button" onClick={action} type="button">{actionLabel}</button>}</div>;
}