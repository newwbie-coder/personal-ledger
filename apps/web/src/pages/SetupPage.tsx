import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, setWorkspaceSlug } from "../lib/api";

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type Provider = "supabase" | "existing" | "self_hosted";

const PROVIDER_LABEL: Record<Provider, string> = {
  supabase: "Supabase (Recommended)",
  existing: "Existing PostgreSQL",
  self_hosted: "Self-hosted PostgreSQL",
};

export function SetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectionOk, setConnectionOk] = useState(false);
  const [provider, setProvider] = useState<Provider>("supabase");
  const [form, setForm] = useState({
    company_name: "",
    workspace_slug: "",
    license_id: "LIC-DEMO-0001",
    host: "",
    port: "5432",
    database: "postgres",
    username: "postgres",
    password: "",
    owner_name: "",
    owner_username: "",
    owner_password: "",
  });

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    if (["host", "port", "database", "username", "password"].includes(key)) {
      setConnectionOk(false);
    }
  }

  function connectionPayload() {
    return {
      host: form.host.trim(),
      port: Number(form.port) || 5432,
      database: form.database.trim(),
      username: form.username.trim(),
      password: form.password,
      db_provider: provider,
    };
  }

  async function testConnection() {
    setBusy(true);
    setError("");
    try {
      await api("/setup/test-connection", {
        method: "POST",
        body: JSON.stringify(connectionPayload()),
      });
      setConnectionOk(true);
    } catch (err) {
      setConnectionOk(false);
      setError(err instanceof ApiError ? err.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  }

  async function finish(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ workspace: { slug: string } }>("/setup/initialize", {
        method: "POST",
        body: JSON.stringify({
          company_name: form.company_name,
          workspace_slug: form.workspace_slug,
          license_id: form.license_id,
          owner_name: form.owner_name,
          owner_username: form.owner_username,
          owner_password: form.owner_password,
          ...connectionPayload(),
        }),
      });
      setWorkspaceSlug(result.workspace.slug);
      setStep(6);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  const progressStep = step >= 6 ? 5 : step <= 4 ? Math.min(step, 4) : 4;

  return (
    <div className="app-shell">
      <div className="page">
        <div className="page-head" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Create workspace</div>
          <h1 className="page-title">
            {step === 1 && "Company"}
            {step === 2 && "License"}
            {step === 3 && "Where should data live?"}
            {step === 4 && "Connect database"}
            {step === 5 && "Owner account"}
            {step === 6 && "Done"}
          </h1>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
            {step < 6 ? `Step ${progressStep} of 5 · Credentials stay on the server` : "Workspace ready"}
          </p>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 4,
                transition: "background 0.3s var(--ease)",
                background: progressStep >= n
                  ? "linear-gradient(90deg, var(--brand), var(--brand-2))"
                  : "var(--line)",
              }}
            />
          ))}
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        {step === 1 ? (
          <div className="card-surface">
            <div className="field">
              <label>Company name</label>
              <input value={form.company_name} onChange={(e) => update("company_name", e.target.value)} required />
            </div>
            <div className="field">
              <label>Workspace slug</label>
              <input
                value={form.workspace_slug}
                onChange={(e) => update("workspace_slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="acme-traders"
                required
              />
              <span className="field-hint">Used at login. Lowercase letters, numbers, hyphens.</span>
            </div>
            <button
              className="btn btn-primary btn-block"
              type="button"
              disabled={!form.company_name || form.workspace_slug.length < 2}
              onClick={() => {
                setError("");
                setStep(2);
              }}
            >
              Continue
            </button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="card-surface">
            <div className="field">
              <label>License key</label>
              <input value={form.license_id} onChange={(e) => update("license_id", e.target.value)} required />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" type="button" onClick={() => setStep(1)}>Back</button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                type="button"
                disabled={!form.license_id}
                onClick={() => {
                  setError("");
                  setStep(3);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="card-surface">
            <p className="muted" style={{ marginTop: 0 }}>
              You own this database. We only store an encrypted connection so the API can reach it.
            </p>
            {(Object.keys(PROVIDER_LABEL) as Provider[]).map((key) => (
              <label
                key={key}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  padding: "12px 0",
                  borderBottom: "1px solid var(--line)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="provider"
                  checked={provider === key}
                  onChange={() => {
                    setProvider(key);
                    setConnectionOk(false);
                    if (key === "supabase") {
                      setForm((f) => ({
                        ...f,
                        port: "5432",
                        database: "postgres",
                        username: "postgres",
                        host: f.host.includes("supabase") ? f.host : "",
                      }));
                    }
                  }}
                  style={{ marginTop: 4 }}
                />
                <span>
                  <strong>{PROVIDER_LABEL[key]}</strong>
                  {key === "supabase" ? (
                    <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                      Free tier works. Guided setup on the next screen.
                    </div>
                  ) : null}
                  {key === "existing" ? (
                    <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                      Neon, RDS, Railway, or any hosted Postgres.
                    </div>
                  ) : null}
                  {key === "self_hosted" ? (
                    <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                      Your own server or local Postgres.
                    </div>
                  ) : null}
                </span>
              </label>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" type="button" onClick={() => setStep(2)}>Back</button>
              <button className="btn btn-primary" style={{ flex: 1 }} type="button" onClick={() => { setError(""); setStep(4); }}>
                Continue
              </button>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="card-surface">
            {provider === "supabase" ? (
              <>
                <ol className="muted" style={{ marginTop: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.55 }}>
                  <li>Open <a href="https://supabase.com" target="_blank" rel="noreferrer">supabase.com</a> and create a project (wait until it is fully ready)</li>
                  <li>Go to <strong>Project Settings → Database → Connect</strong></li>
                  <li>
                    Choose <strong>Session pooler</strong> (not Direct connection — Direct is IPv6-only and often fails on Windows)
                  </li>
                  <li>Copy Host, Port, Database, User, Password from the pooler connection parameters</li>
                  <li>
                    Pooler username is usually <code>postgres.your-project-ref</code>, not plain <code>postgres</code>
                  </li>
                  <li>Paste each field below (not the full URL)</li>
                </ol>
                <p className="field-hint" style={{ marginBottom: 14 }}>
                  If you see <strong>ENOTFOUND</strong> or connection errors with <code>db….supabase.co</code>, switch to Session pooler — host looks like <code>aws-0-….pooler.supabase.com</code>, port <strong>5432</strong>.
                </p>
              </>
            ) : (
              <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
                Enter your PostgreSQL connection details. We build the secure connection on the server —
                you never need to paste a URI.
              </p>
            )}

            <div className="field">
              <label>Host</label>
              <input
                value={form.host}
                onChange={(e) => update("host", e.target.value)}
                placeholder={provider === "supabase" ? "aws-0-….pooler.supabase.com" : "db.example.com"}
                required
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label>Port</label>
              <input
                value={form.port}
                onChange={(e) => update("port", e.target.value)}
                inputMode="numeric"
                required
              />
            </div>
            <div className="field">
              <label>Database</label>
              <input value={form.database} onChange={(e) => update("database", e.target.value)} required />
            </div>
            <div className="field">
              <label>Username</label>
              <input value={form.username} onChange={(e) => update("username", e.target.value)} required autoComplete="off" />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>

            {connectionOk ? <div className="success-banner">Connection OK</div> : null}
            <button
              className="btn btn-secondary btn-block"
              type="button"
              disabled={busy || !form.host || !form.password}
              onClick={() => void testConnection()}
            >
              {busy ? "Testing…" : "Test connection"}
            </button>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-secondary" type="button" onClick={() => setStep(3)}>Back</button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                type="button"
                disabled={!connectionOk}
                onClick={() => {
                  setError("");
                  setStep(5);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        ) : null}

        {step === 5 ? (
          <form className="card-surface" onSubmit={finish}>
            <div className="field">
              <label>Owner name</label>
              <input value={form.owner_name} onChange={(e) => update("owner_name", e.target.value)} required />
            </div>
            <div className="field">
              <label>Owner username</label>
              <input value={form.owner_username} onChange={(e) => update("owner_username", e.target.value)} required minLength={3} />
            </div>
            <div className="field">
              <label>Owner password</label>
              <input type="password" value={form.owner_password} onChange={(e) => update("owner_password", e.target.value)} required minLength={6} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" type="button" onClick={() => setStep(4)}>Back</button>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} type="submit">
                {busy ? "Initializing…" : "Initialize workspace"}
              </button>
            </div>
          </form>
        ) : null}

        {step === 6 ? (
          <div className="card-surface">
            <div className="success-banner">Workspace ready</div>
            <p style={{ marginTop: 0 }}>
              Sign in with workspace <strong>{form.workspace_slug}</strong> and your owner account.
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Storage: {PROVIDER_LABEL[provider]}
            </p>
            <button className="btn btn-primary btn-block" type="button" onClick={() => navigate("/login", { replace: true })}>
              Go to sign in
            </button>
          </div>
        ) : null}

        {step < 6 ? (
          <p className="muted" style={{ marginTop: 16, textAlign: "center", fontSize: 14 }}>
            Already set up? <Link to="/login">Sign in</Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
