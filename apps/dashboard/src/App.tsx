import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { ApiRequestError, apiRequest } from "./api";
import { supabase, supabaseConfigMissing } from "./supabase";
import { VendorStorePanel } from "./VendorStorePanel";
import { DeliveryPartnerPortal } from "./DeliveryPartnerPortal";
import { DeliveryPartnerLogin } from "./DeliveryPartnerLogin";
import { AdminPortal } from "./admin/AdminPortal";
import { usernameSchema, indianMobileSchema } from "@workspace/validation";
import { PasswordInput, ForgotPassword, ResetPassword } from "./AuthControls";
import { VendorSignup } from "./VendorSignup";
import { isCurrentSessionFailure, keepVendorProfile, keepVerifiedPortalOnTransientCheckFailure } from "./vendor-session";
import { BrandingLogo } from "./BrandingLogo";
import { dashboardForRole, legacyPortalEntryFromPath, loginForDashboard, portalRouteFromPath, portalRouteMatchesRole, portalRoutePath, type PortalRoute } from "./portal-routes";

type Role = "customer" | "vendor" | "admin" | "delivery_partner";
type AuthProfile = { auth: { userId: string; role: Role; storeId: string | null } };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthProfile["auth"] | null>(null);
  const [authLoading, setAuthLoading] = useState(!supabaseConfigMissing);
  const [roleLoading, setRoleLoading] = useState(false);
  const [profileCheckRevision, setProfileCheckRevision] = useState(0);
  const [email, setEmail] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [legacyVendorLogin, setLegacyVendorLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(() => new URLSearchParams(window.location.search).get("recovery") === "1");
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [notice, setNotice] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const [vendorSignup, setVendorSignup] = useState(false);
  const vendorProfileRef = useRef<AuthProfile["auth"] | null>(null);
  const latestSessionRef = useRef<Session | null>(null);
  const basePath = import.meta.env.BASE_URL;
  const initialPath = window.location.pathname;
  const [portalRoute, setPortalRoute] = useState<PortalRoute>(() => portalRouteFromPath(initialPath, basePath));
  const legacyEntryRef = useRef(legacyPortalEntryFromPath(initialPath, basePath));
  const partnerMode = portalRoute === "delivery-login" || portalRoute === "delivery-dashboard";
  const vendorMode = portalRoute === "vendor-login" || portalRoute === "vendor-dashboard";
  const adminMode = portalRoute === "admin";
  const navigatePortal = (route: PortalRoute, replace = false) => {
    const path = `${portalRoutePath(route, basePath)}${window.location.search}${window.location.hash}`;
    if (replace) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
    setPortalRoute(route);
    legacyEntryRef.current = null;
  };
  useEffect(() => {
    const syncPortal = () => {
      const pathname = window.location.pathname;
      const route = portalRouteFromPath(pathname, basePath);
      const legacy = legacyPortalEntryFromPath(pathname, basePath);
      legacyEntryRef.current = legacy;
      if (legacy !== null && route !== "not-found") {
        window.history.replaceState(null, "", `${portalRoutePath(route, basePath)}${window.location.search}${window.location.hash}`);
      }
      setPortalRoute(route);
    };
    syncPortal();
    window.addEventListener("popstate", syncPortal);
    return () => window.removeEventListener("popstate", syncPortal);
  }, []);

  useEffect(() => {
    if (authLoading || session || recoveryMode) return;
    const loginRoute = loginForDashboard(portalRoute);
    if (loginRoute) navigatePortal(loginRoute, true);
    else if (portalRoute === "not-found") navigatePortal("vendor-login", true);
  }, [authLoading, session, recoveryMode, portalRoute]);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let sessionEventSeen = false;
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active && !sessionEventSeen) {
          latestSessionRef.current = data.session;
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
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      sessionEventSeen = true;
      latestSessionRef.current = nextSession;
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(true);
        window.history.replaceState(null, "", `${window.location.pathname}?recovery=1`);
      } else if (event === "SIGNED_IN" && !new URLSearchParams(window.location.search).has("recovery")) {
        setRecoveryMode(false);
        setAuthError("");
      }
      const sameVendor = keepVendorProfile(vendorProfileRef.current, nextSession?.user.id);
      setSession(nextSession);
      if (!sameVendor) {
        vendorProfileRef.current = null;
        setProfile(null);
        setNotice(null);
      }
      setAuthLoading(false);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Re-check authorization after a tab/app interruption or network recovery.
  // Supabase owns secure token persistence and refresh; focus never signs out.
  useEffect(() => {
    if (!session?.user.id) return;
    let timer: number | undefined;
    const scheduleCheck = () => {
      if (document.visibilityState !== "visible") return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => setProfileCheckRevision(value => value + 1), 200);
    };
    window.addEventListener("focus", scheduleCheck);
    window.addEventListener("online", scheduleCheck);
    document.addEventListener("visibilitychange", scheduleCheck);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", scheduleCheck);
      window.removeEventListener("online", scheduleCheck);
      document.removeEventListener("visibilitychange", scheduleCheck);
    };
  }, [session?.user.id]);

  useEffect(() => {
    if (!session?.access_token) {
      setProfile(null);
      setRoleLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    if (profile?.userId !== session.user.id) setRoleLoading(true);
    setAuthError("");
    void apiRequest<AuthProfile>("/api/auth/me", session.access_token, { signal: controller.signal })
      .then((response) => {
        if (active) {
          setProfile(response.auth);
          vendorProfileRef.current = response.auth.role === "vendor" ? response.auth : null;
        }
      })
      .catch(async (error) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Your session could not be verified.";
        const status = error instanceof ApiRequestError ? error.status : undefined;
        if (status === 401 || status === 403) {
          try {
            const { data } = await supabase!.auth.getSession();
            if (controller.signal.aborted) return;
            if (data.session?.user.id === session.user.id && data.session.access_token !== session.access_token) {
              latestSessionRef.current = data.session;
              setSession(data.session);
              return;
            }
          } catch {
            // Use the latest session event below if storage could not be read.
          }
          if (!isCurrentSessionFailure(session.access_token, latestSessionRef.current?.access_token)) return;
          vendorProfileRef.current = null;
          setProfile(null);
          setAuthError(status === 403
            ? "This portal account is no longer active. Sign in again or contact your administrator."
            : "Your session has expired. Sign in again to continue.");
          await supabase?.auth.signOut();
        } else if (keepVerifiedPortalOnTransientCheckFailure(profile?.userId, session.user.id, status)) {
          // A temporary API/network outage is not an authentication failure.
          // Keep the already verified same-user portal; protected APIs still
          // enforce the current role and account status on every operation.
          setAuthError("");
        } else {
          vendorProfileRef.current = null;
          setProfile(null);
          setAuthError(message);
        }
      })
      .finally(() => {
        if (active) setRoleLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [session?.access_token, profileCheckRevision]);

  useEffect(() => {
    if (!session || !profile || roleLoading || recoveryMode) return;
    if (profile.role === "admin") {
      if (portalRoute !== "admin") navigatePortal("admin", true);
      return;
    }
    if (profile.role !== "vendor" && profile.role !== "delivery_partner") return;
    if (legacyEntryRef.current === "home" || (legacyEntryRef.current === "delivery" && profile.role === "delivery_partner") || portalRoute === "not-found") {
      navigatePortal(dashboardForRole(profile.role), true);
      return;
    }
    if (profile.role === "vendor" && portalRoute === "vendor-login")
      navigatePortal("vendor-dashboard", true);
    else if (profile.role === "delivery_partner" && portalRoute === "delivery-login")
      navigatePortal("delivery-dashboard", true);
  }, [session?.user.id, profile?.userId, profile?.role, roleLoading, recoveryMode, portalRoute]);

  const onMessage = (message: string, kind: "success" | "error" = "success") => {
    setNotice({ message, kind });
  };

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    setAuthSuccess("");
    if (!supabase) return;
    setAuthLoading(true);
    try {
      if (!adminMode && !legacyVendorLogin) {
        const parsed = indianMobileSchema.safeParse(mobileNumber);
        if (!parsed.success) {
          setAuthError("Enter a valid registered Indian mobile number.");
          setPassword("");
          return;
        }
        const response = await apiRequest<{ session: { access_token: string; refresh_token: string } }>("/api/vendor/mobile-login", "", {
          method: "POST", body: JSON.stringify({ mobileNumber: parsed.data, password }),
        });
        const { error } = await supabase.auth.setSession(response.session);
        if (error) throw new Error("Your session could not be established. Please sign in again.");
        setPassword("");
        return;
      }
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
    vendorProfileRef.current = null;
    latestSessionRef.current = null;
    setProfile(null);
    setSession(null);
    navigatePortal(adminMode ? "admin" : partnerMode ? "delivery-login" : "vendor-login", true);
  };

  if (supabaseConfigMissing) {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><AuthState title="Configuration needed" message="Supabase sign-in is not configured for this dashboard. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to continue." /></AuthFrame></div></main>;
  }

  if (authLoading) {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><div className="auth-loading" aria-label="Loading authentication"><span /><span /><span /></div></AuthFrame></div></main>;
  }

  if (recoveryMode && session) {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><ResetPassword role={adminMode ? "admin" : partnerMode ? "delivery_partner" : "vendor"} onComplete={success => {
      setRecoveryMode(false); setSession(null); setProfile(null); setPassword("");
      window.history.replaceState(null, "", window.location.pathname);
      setAuthError("");
      setAuthSuccess(success ? "Password updated. Sign in with your new password." : "Password reset cancelled.");
    }} /></AuthFrame></div></main>;
  }

  if (!session && loginForDashboard(portalRoute)) {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><div className="auth-loading" aria-label="Opening portal sign in"><span /><span /><span /></div></AuthFrame></div></main>;
  }

  if (!session) {
    if (portalRoute === "delivery-login") return <DeliveryPartnerLogin onAuthenticated={async tokens => {
      if (!supabase) throw new Error("Authentication is unavailable.");
      const { error } = await supabase.auth.setSession(tokens);
      if (error) throw new Error("Your session could not be established. Please sign in again.");
      setNotice(null);
    }} />;
    return (
      <main className="page"><div className="dashboard-shell"><AuthFrame>
        {!adminMode && vendorSignup ? <VendorSignup onBack={() => setVendorSignup(false)} /> : <>
        <form className="auth-form" onSubmit={signIn}>
          <p className="eyebrow">{adminMode ? "Apna Local Basket · Admin" : "Vendor Portal"}</p>
          <h1>{adminMode ? "Admin Portal sign in" : "Vendor sign in"}</h1>
          <p className="muted">{adminMode ? "Use your existing administrator email and password. Admin access is verified before the portal opens." : legacyVendorLogin ? "Use your existing account sign-in details until mobile ownership is verified." : "Mobile sign-in requires verified ownership. Existing vendors can use legacy sign-in below."}</p>
          {authError && <div className="auth-error" role="alert">{authError}</div>}
          {authSuccess && <div className="auth-success" role="status">{authSuccess}</div>}
          {adminMode ? <label>Email address<input data-testid="input-email" autoComplete="email" onChange={(event) => { setEmail(event.target.value); setAuthError(""); }} type="email" value={email} required /></label> : legacyVendorLogin ? <label>Legacy account identifier<input data-testid="input-vendor-legacy" autoComplete="username" placeholder="Enter your existing sign-in identifier" onChange={(event) => { setEmail(event.target.value); setAuthError(""); }} type="text" value={email} required /></label> : <label>Mobile Number<input data-testid="input-vendor-mobile" type="tel" inputMode="tel" autoComplete="tel" maxLength={13} placeholder="Enter your registered mobile number" value={mobileNumber} onChange={event => { setMobileNumber(event.target.value); setAuthError(""); }} required /></label>}
          <label>Password<PasswordInput data-testid="input-password" autoComplete="current-password" onChange={(event) => { setPassword(event.target.value); setAuthError(""); }} value={password} required /></label>
          <button className="primary-button auth-submit" data-testid="button-sign-in" disabled={authLoading} type="submit">{authLoading ? "Signing in…" : "Sign in"}</button>
          {!adminMode && <button className="text-button" type="button" onClick={() => setVendorSignup(true)}>Sign Up as Vendor</button>}
        </form>
        {!adminMode && <button type="button" className="text-button" disabled={authLoading} onClick={() => { setLegacyVendorLogin(value => !value); setPassword(""); setAuthError(""); setAuthSuccess(""); }}>{legacyVendorLogin ? "Use mobile number instead" : "Use legacy sign-in instead"}</button>}
        <ForgotPassword key={adminMode ? "admin" : legacyVendorLogin ? "vendor-legacy" : "vendor-mobile"} role={adminMode ? "admin" : "vendor"} initialIdentity={adminMode || legacyVendorLogin ? email : mobileNumber} identityType={adminMode || legacyVendorLogin ? "legacy" : "mobile"} />
        </>}
      </AuthFrame></div></main>
    );
  }

  if (roleLoading) {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><div className="auth-loading" aria-label="Loading account permissions"><span /><span /><span /></div></AuthFrame></div></main>;
  }

  if (authError || !profile) {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><AuthState title="Could not verify access" message={authError || "The account permissions response was incomplete."} action={signOut} actionLabel="Sign out" retry={() => { setAuthError(""); setProfileCheckRevision(value => value + 1); }} retryLabel="Retry access check" /></AuthFrame></div></main>;
  }

  if (profile.role === "customer" && session.user.user_metadata?.vendor_signup === true && vendorMode) {
    return <main className="page"><div className="dashboard-shell"><AuthFrame>
      <VendorSignup session={session} onBack={signOut} onCompleted={() => {
        setProfile(null); setRoleLoading(true);
        void apiRequest<AuthProfile>("/api/auth/me", session.access_token).then(result => {
          setProfile(result.auth);
          vendorProfileRef.current = result.auth.role === "vendor" ? result.auth : null;
        }).catch(error => setAuthError(error instanceof Error ? error.message : "Unable to verify the new store."))
          .finally(() => setRoleLoading(false));
      }} />
      <button className="text-button" type="button" onClick={signOut}>Sign out</button>
    </AuthFrame></div></main>;
  }

  if (adminMode && profile.role !== "admin") {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><AuthState title="Admin access denied" message="This account does not have administrator permissions. Your customer, vendor, or delivery partner portal remains separate from /admin." action={signOut} actionLabel="Sign out" /></AuthFrame></div></main>;
  }

  if (profile.role === "admin") {
    return <AdminPortal key={profile.userId} token={session.access_token} session={session} userId={profile.userId} onLogout={signOut} />;
  }

  if (profile.role === "customer") {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><AuthState title="Management access is unavailable" message="This account is a customer account. Ask a platform administrator for vendor or admin access." action={signOut} actionLabel="Sign out" /></AuthFrame></div></main>;
  }

  if (!portalRouteMatchesRole(profile.role, portalRoute)) {
    const ownDashboard = dashboardForRole(profile.role);
    const title = profile.role === "vendor" ? "Vendor portal access required" : "Delivery Partner portal access required";
    const message = profile.role === "vendor"
      ? "This account is a Vendor. Vendor store and order tools are not available from the Delivery Partner portal."
      : "This account is a Delivery Partner. Delivery assignments and partner tools are not available from the Vendor portal.";
    return <main className="page"><div className="dashboard-shell"><AuthFrame><AuthState title={title} message={message} action={() => navigatePortal(ownDashboard, true)} actionLabel={profile.role === "vendor" ? "Open Vendor portal" : "Open Delivery Partner portal"} secondaryAction={signOut} secondaryActionLabel="Sign out" /></AuthFrame></div></main>;
  }

  if ((profile.role === "vendor" && portalRoute === "vendor-login") || (profile.role === "delivery_partner" && portalRoute === "delivery-login")) {
    return <main className="page"><div className="dashboard-shell"><AuthFrame><div className="auth-loading" aria-label="Opening dashboard"><span /><span /><span /></div></AuthFrame></div></main>;
  }

  if (profile.role === "delivery_partner" && portalRoute === "delivery-dashboard") {
    return <DeliveryPartnerPortal key={profile.userId} token={session.access_token} onSignOut={signOut} />;
  }

  if (profile.role === "vendor" && portalRoute === "vendor-dashboard" && profile.storeId) {
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

function AuthFrame({ children }: { children: ReactNode }) {
  return <div className="auth-frame"><BrandingLogo className="auth-mark" />{children}</div>;
}

function AuthState({ title, message, action, actionLabel = "Return to sign in", secondaryAction, secondaryActionLabel = "Sign out", retry, retryLabel = "Retry" }: { title: string; message: string; action?: () => void; actionLabel?: string; secondaryAction?: () => void; secondaryActionLabel?: string; retry?: () => void; retryLabel?: string }) {
  return <div className="auth-state"><p className="eyebrow">Local Supermarket Marketplace</p><h1>{title}</h1><p className="muted">{message}</p>{retry && <button className="text-button" onClick={retry} type="button">{retryLabel}</button>}{action && <button className="secondary-button" onClick={action} type="button">{actionLabel}</button>}{secondaryAction && <button className="text-button" onClick={secondaryAction} type="button">{secondaryActionLabel}</button>}</div>;
}