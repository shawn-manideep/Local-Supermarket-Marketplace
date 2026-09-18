import { useState } from "react";
import { AdminStorePanel } from "./AdminStorePanel";
import { VendorStorePanel } from "./VendorStorePanel";

export default function App() {
  const [mode, setMode] = useState<"vendor" | "admin">("vendor");
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState<{ message: string; kind: "success" | "error" } | null>(null);

  const onMessage = (message: string, kind: "success" | "error" = "success") => {
    setNotice({ message, kind });
  };

  return (
    <main className="page">
      <div className="dashboard-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local Supermarket Marketplace</p>
            <h1>Store management</h1>
          </div>
          <div className="phase-badge">Phase 4</div>
        </header>

        <section className="auth-strip">
          <div>
            <strong>Protected dashboard session</strong>
            <p className="muted">Use a Supabase access token from the existing Auth flow. It is kept only in this page state.</p>
          </div>
          <input
            aria-label="Supabase access token"
            onChange={(event) => setToken(event.target.value)}
            placeholder="Paste access token to connect"
            type="password"
            value={token}
          />
        </section>

        {notice && (
          <div className={`notice notice-${notice.kind}`} role="status">
            {notice.message}
            <button aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button>
          </div>
        )}

        <nav className="mode-tabs" aria-label="Management role">
          <button className={mode === "vendor" ? "active" : ""} onClick={() => setMode("vendor")}>Vendor store</button>
          <button className={mode === "admin" ? "active" : ""} onClick={() => setMode("admin")}>Admin stores</button>
        </nav>

        {mode === "vendor" ? (
          <VendorStorePanel onMessage={onMessage} token={token} />
        ) : (
          <AdminStorePanel onMessage={onMessage} token={token} />
        )}
      </div>
    </main>
  );
}