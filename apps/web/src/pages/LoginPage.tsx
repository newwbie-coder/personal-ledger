import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth, getWorkspaceSlug } from "../auth";
import { ApiError } from "../lib/api";

export function LoginPage() {
  const { login, user, loading } = useAuth();
  const [workspace, setWorkspace] = useState(getWorkspaceSlug());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(workspace.trim(), username.trim(), password);
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
          <div className="eyebrow">Collaborative Ledger</div>
          <h1 className="page-title" style={{ fontSize: 34 }}>Sign in</h1>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            Enter your workspace and account.
          </p>
        </div>
        <form className="card-surface" onSubmit={onSubmit}>
          {error ? <div className="error-banner">{error}</div> : null}
          <div className="field">
            <label htmlFor="workspace">Workspace</label>
            <input
              id="workspace"
              autoComplete="organization"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value.toLowerCase())}
              placeholder="your-company"
              required
            />
          </div>
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
        <p className="muted" style={{ marginTop: 16, textAlign: "center", fontSize: 14 }}>
          New business? <Link to="/setup">Create a workspace</Link>
        </p>
      </div>
    </div>
  );
}
