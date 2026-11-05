import { FormEvent, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import { api, ApiError } from "../lib/api";

export function LoginPage() {
  const { login, user, loading } = useAuth();
  const [companyName, setCompanyName] = useState("");
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ setup_complete: boolean; company_name: string | null }>("/setup/status")
      .then((s) => {
        setSetupComplete(s.setup_complete);
        setCompanyName(s.company_name ?? "");
      })
      .catch(() => setSetupComplete(true));
  }, []);

  if (!loading && user) return <Navigate to="/" replace />;
  if (setupComplete === false) return <Navigate to="/setup" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="page" style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ marginBottom: 26 }}>
          <div
            aria-hidden="true"
            style={{
              display: "grid",
              placeItems: "center",
              width: 54,
              height: 54,
              marginBottom: 18,
              borderRadius: 17,
              color: "var(--brand-ink)",
              background: "linear-gradient(140deg, var(--brand) 0%, var(--brand-2) 100%)",
              boxShadow: "var(--shadow-brand)",
            }}
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 3.5h9.5L19 7v13.5H6z" />
              <path d="M9.5 8.5h6M9.5 12h6M9.5 15.5h3.5" />
            </svg>
          </div>
          <div className="eyebrow">{companyName || "Collaborative Ledger"}</div>
          <h1 className="page-title" style={{ fontSize: 34 }}>Sign in</h1>
        </div>
        <form className="card-surface" onSubmit={onSubmit}>
          {error ? <div className="error-banner">{error}</div> : null}
          <div className="field">
            <label htmlFor="username">Username</label>
            <input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn btn-primary btn-block" disabled={busy} type="submit">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
