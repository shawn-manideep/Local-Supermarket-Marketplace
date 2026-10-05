import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { ApiRequestError, apiRequest } from "./api";
import { supabase, supabaseConfigMissing } from "./supabase";
import { VendorStorePanel } from "./VendorStorePanel";
import { DeliveryPartnerPortal } from "./DeliveryPartnerPortal";
import { DeliveryPartnerLogin } from "./DeliveryPartnerLogin";
import { AdminPortal } from "./admin/AdminPortal";
import { matchesAdminPath } from "./admin/route-access";
import { usernameSchema } from "@workspace/validation";

type Role = "customer" | "vendor" | "admin" | "delivery_partner";
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
  const [partnerMode, setPartnerMode] = useState(() => window.location.pathname.replace(/\/$/, "").endsWith("/delivery-partner"));
  const [adminMode, setAdminMode] = useState(() => isAdminPath(window.location.pathname));
  const selectPortal = (partner: boolean) => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    window.history.pushState(null, "", partner ? `${base}/delivery-partner` : `${base}/`);
    setPartnerMode(partner);
    setAdminMode(false);
  };
  useEffect(() => {
    const syncPortal = () => {
      setPartnerMode(window.location.pathname.replace(/\/$/, "").endsWith("/delivery-partner"));
      setAdminMode(isAdminPath(window.location.pathname));
    };
    window.addEventListener("popstate", syncPortal);
    return () => window.removeEventListener("popstate", syncPortal);
  }, []);

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
      setNotice(null);
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
          if (response.auth.role === "admin") {
            const base = import.meta.env.BASE_URL.replace(/\/$/, "");
            if (!isAdminPath(window.location.pathname)) {
              window.history.replaceState(null, "", `${base}/admin`);
            }
            setAdminMode(true);
            setPartnerMode(false);
          } else if (response.auth.role === "delivery_partner" && !isAdminPath(window.location.pathname)) {
            const base = import.meta.env.BASE_URL.replace(/\/$/, "");
            window.history.replaceState(null, "", `${base}/delivery-partner`);
            setPartnerMode(true);
            setAdminMode(false);
          }
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
      if (!adminMode && !email.trim().includes("@")) {
        const parsed = usernameSchema.safeParse(email);
        if (!parsed.success) {
          setAuthError(parsed.error.issues[0]?.message || "Enter a valid vendor username.");
          setPassword("");
          setAuthLoading(false);
          return;
        }
        const response = await apiRequest<{ session: { access_token: string; refresh_token: string } }>("/api/vendor/login", "", {
          method: "POST",
          body: JSON.stringify({ username: email, password }),
        });
        const { error } = await supabase.auth.setSession(response.session);
        if (error) throw new Error("Your session could not be established. Please sign in again.");
        setPassword("");
        return;
      }
      if (adminMode && !email.trim().includes("@")) {
        setAuthError("Admin sign-in requires your administrator email address.");
        setPassword("");
        setAuthLoading(false);
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setAuthError(error.message);
      } else if (!data.session) {
        setAuthError("Sign-in succeeded without a usable session. Try again.");
      } else {
        setPassword("");
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Sign-in could not reach the authentication service. Try again.");
      setPassword("");
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
    if (partnerMode && !adminMode) return <DeliveryPartnerLogin onCancel={() => selectPortal(false)} onAuthenticated={async tokens => {
      if (!supabase) throw new Error("Authentication is unavailable.");
      const { error } = await supabase.auth.setSession(tokens);
      if (error) throw new Error("Your session could not be established. Please sign in again.");
      setNotice(null);
    }} />;
    return (
      <main className="page"><div className="dashboard-shell"><AuthFrame>
        <form className="auth-form" onSubmit={signIn}>
          <p className="eyebrow">{adminMode ? "Local Basket · Admin" : "Secure operations access"}</p>
          <h1>{adminMode ? "Admin Portal sign in" : "Sign in to store management"}</h1>
          <p className="muted">{adminMode ? "Use your existing administrator email and password. Admin access is verified before the portal opens." : "Use your marketplace account to manage stores, catalog, and orders."}</p>
          {authError && <div className="auth-error" role="alert">{authError}</div>}
          <label>{adminMode ? "Email address" : "Email or vendor username"}<input data-testid="input-email" autoComplete={adminMode || email.includes("@") ? "email" : "username"} onChange={(event) => { setEmail(event.target.value); setAuthError(""); }} type={adminMode ? "email" : "text"} value={email} required /></label>
          <label>Password<input data-testid="input-password" autoComplete="current-password" onChange={(event) => { setPassword(event.target.value); setAuthError(""); }} type="password" value={password} required /></label>
          <button className="primary-button auth-submit" data-testid="button-sign-in" disabled={authLoading} type="submit">{authLoading ? "Signing in…" : "Sign in"}</button>
          {!adminMode && <button className="text-button" onClick={() => selectPortal(true)} type="button">Delivery Partner sign in</button>}
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

  if (adminMode && profile.role !== "admin") {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><AuthState title="Admin access denied" message="This account does not have administrator permissions. Your customer, vendor, or delivery partner portal remains separate from /admin." action={signOut} actionLabel="Sign out" /></AuthFrame></div></main>;
  }

  if (profile.role === "admin") {
    return <AdminPortal key={profile.userId} token={session.access_token} session={session} userId={profile.userId} onLogout={signOut} />;
  }

  if (profile.role === "delivery_partner") {
    return <DeliveryPartnerPortal key={profile.userId} token={session.access_token} onSignOut={signOut} />;
  }
  if (partnerMode) {
    return <main className="page"><AuthFrame><AuthState title="Delivery Partner access required" message="This portal is only available to active Delivery Partner accounts." action={signOut} actionLabel="Sign out" /></AuthFrame></main>;
  }

  if (profile.role === "customer") {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><AuthState title="Management access is unavailable" message="This account is a customer account. Ask a platform administrator for vendor or admin access." action={signOut} actionLabel="Sign out" /></AuthFrame></div></main>;
  }

  if (profile.role === "vendor" && profile.storeId) {
    return (
      <div className="app-root is-vendor">
        <VendorStorePanel 
          onMessage={onMessage} 
          token={session.access_token} 
          profile={profile}
          onSignOut={signOut}
          notice={notice}
          onDismissNotice={() => setNotice(null)}
        />
      </div>
    );
  }

  return (
    <main className="page is-admin">
      <div className="dashboard-shell">
        <header className="topbar">
          <div><p className="eyebrow">Local Supermarket Marketplace</p><h1>Store management</h1></div>
          <div className="topbar-actions"><div className="phase-badge">Phase 9A</div><button className="text-button" data-testid="button-sign-out" onClick={signOut} type="button">Sign out</button></div>
        </header>
        <section className="auth-strip"><div><strong>Protected dashboard session</strong><p className="muted">Vendor workspace · Session refresh is on</p></div><span className="session-status"><i /> Signed in</span></section>
        {notice && <div className={`notice notice-${notice.kind}`} role="status">{notice.message}<button aria-label="Dismiss notification" onClick={() => setNotice(null)} type="button">×</button></div>}
        <div className="empty-state"><strong>No vendor store is linked</strong><span>Your account is approved for vendor access, but no store has been assigned yet.</span></div>
      </div>
    </main>
  );
}

function isAdminPath(pathname: string) {
  return matchesAdminPath(pathname, import.meta.env.BASE_URL);
}

function AuthFrame({ children }: { children: ReactNode }) {
  return <div className="auth-frame"><div className="auth-mark">LS</div>{children}</div>;
}

function AuthState({ title, message, action, actionLabel = "Return to sign in" }: { title: string; message: string; action?: () => void; actionLabel?: string }) {
  return <div className="auth-state"><p className="eyebrow">Local Supermarket Marketplace</p><h1>{title}</h1><p className="muted">{message}</p>{action && <button className="secondary-button" onClick={action} type="button">{actionLabel}</button>}</div>;
}