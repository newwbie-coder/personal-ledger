import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BottomNav } from "../components/BottomNav";
import { useAuth } from "../auth";
import { useFirm } from "../firm";
import { api, ApiError } from "../lib/api";

interface AppUser {
  user_id: string;
  name: string;
  username: string;
  role: string;
  active: boolean;
  assigned_firm_id?: string | null;
}

interface LicenseStatus {
  license_id: string | null;
  company_uuid: string | null;
  workspace_slug?: string;
  last_validation: string | null;
  valid: boolean;
  maximum_users?: number;
}

interface FirmRow {
  firm_id: string;
  firm_name: string;
  status: string;
}

export function SettingsPage() {
  const { user, workspace, logout } = useAuth();
  const { refreshFirms } = useFirm();
  const isOwner = user?.role === "owner";
  const canManageFirms = user?.role === "owner" || user?.role === "manager";
  const canTransfer = canManageFirms;
  const [users, setUsers] = useState<AppUser[]>([]);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [firms, setFirms] = useState<FirmRow[]>([]);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showNewFirm, setShowNewFirm] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [firmName, setFirmName] = useState("");
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [form, setForm] = useState({
    name: "",
    username: "",
    password: "",
    role: "employee",
    assigned_firm_id: "",
  });
  const [transfer, setTransfer] = useState({
    source_firm_id: "",
    destination_firm_id: "",
    amount: "",
    description: "",
  });
  const [busy, setBusy] = useState(false);
  const [installHint, setInstallHint] = useState(false);
  const [moveMsg, setMoveMsg] = useState("");
  const [showMove, setShowMove] = useState(false);
  const [moveForm, setMoveForm] = useState({
    host: "",
    port: "5432",
    database: "postgres",
    username: "postgres",
    password: "",
    db_provider: "supabase" as "supabase" | "existing" | "self_hosted",
  });

  async function load() {
    try {
      const firmData = await api<{ firms: FirmRow[] }>("/firms?include_archived=true");
      setFirms(firmData.firms);
      if (isOwner) {
        const [u, l] = await Promise.all([
          api<{ users: AppUser[] }>("/users"),
          api<LicenseStatus>("/users/license-status"),
        ]);
        setUsers(u.users);
        setLicense(l);
      } else if (canManageFirms) {
        const l = await api<LicenseStatus>("/users/license-status");
        setLicense(l);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  useEffect(() => {
    void load();
    const dismissed = localStorage.getItem("ledger_install_hint");
    if (!dismissed) setInstallHint(true);
  }, [isOwner, canManageFirms]);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        username: form.username,
        password: form.password,
        role: form.role,
      };
      if (form.role === "employee") {
        payload.assigned_firm_id = form.assigned_firm_id || null;
      }
      await api("/users", { method: "POST", body: JSON.stringify(payload) });
      setShowNew(false);
      setForm({ name: "", username: "", password: "", role: "employee", assigned_firm_id: "" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function createTransfer(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/transfers", {
        method: "POST",
        body: JSON.stringify({
          source_firm_id: transfer.source_firm_id,
          destination_firm_id: transfer.destination_firm_id,
          amount: Number(transfer.amount),
          description: transfer.description,
        }),
      });
      setTransfer({ source_firm_id: "", destination_firm_id: "", amount: "", description: "" });
      setShowTransfer(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  async function reassignFirm(userId: string, firmId: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/users/${userId}/assignment`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_firm_id: firmId }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function createFirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/firms", {
        method: "POST",
        body: JSON.stringify({ firm_name: firmName }),
      });
      setFirmName("");
      setShowNewFirm(false);
      await load();
      await refreshFirms();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function archiveFirm(id: string) {
    if (!confirm("Archive this firm? It must have zero open party balances.")) return;
    setBusy(true);
    setError("");
    try {
      await api(`/firms/${id}/archive`, { method: "POST", body: "{}" });
      await load();
      await refreshFirms();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function restoreFirm(id: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/firms/${id}/restore`, { method: "POST", body: "{}" });
      await load();
      await refreshFirms();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(id: string, active: boolean) {
    setBusy(true);
    try {
      await api(`/users/${id}/active`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function doResetPassword(e: FormEvent) {
    e.preventDefault();
    if (!resetFor) return;
    setBusy(true);
    setError("");
    try {
      await api(`/users/${resetFor}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: resetPassword }),
      });
      setResetFor(null);
      setResetPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function runEncryptMigrate() {
    if (!confirm("Seal existing ledger fields with license-bound encryption? Safe to re-run.")) {
      return;
    }
    setBusy(true);
    setError("");
    setMoveMsg("");
    try {
      const r = await api<{ sealed_rows: number; created_dek: boolean }>(
        "/workspace/encrypt-migrate",
        { method: "POST", body: "{}" },
      );
      setMoveMsg(
        `Encryption ready. Sealed fields: ${r.sealed_rows}${r.created_dek ? " (new data key created)" : ""}.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Encrypt migrate failed");
    } finally {
      setBusy(false);
    }
  }

  async function testMoveDb() {
    setBusy(true);
    setError("");
    setMoveMsg("");
    try {
      await api("/workspace/test-db", {
        method: "POST",
        body: JSON.stringify({
          ...moveForm,
          port: Number(moveForm.port) || 5432,
        }),
      });
      setMoveMsg("Connection OK. After pg_dump/restore into this DB, use Attach.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Test failed");
    } finally {
      setBusy(false);
    }
  }

  async function swapMoveDb(e: FormEvent) {
    e.preventDefault();
    if (
      !confirm(
        "Point this workspace at the new database? Ciphertext must already be copied (see MOVE_DATABASE.md).",
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMoveMsg("");
    try {
      const r = await api<{ hint?: string }>("/workspace/swap-db", {
        method: "POST",
        body: JSON.stringify({
          ...moveForm,
          port: Number(moveForm.port) || 5432,
        }),
      });
      setMoveMsg(r.hint ?? "Database attached. Sign out and back in to confirm.");
      setShowMove(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Attach failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="page">
        <div className="page-head">
          <div className="eyebrow">Workspace</div>
          <h1 className="page-title">Settings</h1>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}

        {installHint ? (
          <div className="card-surface" style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700 }}>Install on phone</div>
            <p className="muted" style={{ margin: "6px 0 12px", fontSize: 14 }}>
              Browser menu → Add to Home Screen for a full-screen app icon.
            </p>
            <button
              className="btn btn-secondary btn-block"
              type="button"
              onClick={() => {
                localStorage.setItem("ledger_install_hint", "1");
                setInstallHint(false);
              }}
            >
              Got it
            </button>
          </div>
        ) : null}

        <div className="card-surface" style={{ marginBottom: 14 }}>
          <div className="list-row">
            <div>
              <div className="row-title">{workspace?.company_name}</div>
              <div className="row-sub">slug: {workspace?.slug}</div>
            </div>
            <span className="badge">Workspace</span>
          </div>
          <div className="list-row">
            <div>
              <div className="row-title">{user?.name}</div>
              <div className="row-sub">{user?.username}</div>
            </div>
            <span className="badge badge-accent">{user?.role}</span>
          </div>
          <Link to="/account" className="btn btn-secondary btn-block" style={{ marginTop: 14, textDecoration: "none" }}>
            App PIN &amp; profile
          </Link>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }} type="button" onClick={logout}>
            Sign out
          </button>
        </div>

        {license ? (
          <div className="card-surface" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontWeight: 700 }}>License</div>
              <span className={`badge ${license.valid ? "badge-ok" : "badge-danger"}`}>
                {license.valid ? "Valid" : "Invalid"}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              {license.license_id ?? "—"}
              {license.maximum_users != null ? ` · Max users: ${license.maximum_users}` : ""}
            </div>
          </div>
        ) : null}

        {canManageFirms ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div className="section-title" style={{ margin: "8px 0" }}>Firms</div>
              <div style={{ display: "flex", gap: 8 }}>
                {canTransfer && firms.filter((f) => f.status === "active").length >= 2 ? (
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowTransfer((v) => !v)}>
                    {showTransfer ? "Cancel" : "Transfer"}
                  </button>
                ) : null}
                {isOwner ? (
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowNewFirm((v) => !v)}>
                    {showNewFirm ? "Cancel" : "Add firm"}
                  </button>
                ) : null}
              </div>
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 0, lineHeight: 1.5 }}>
              {isOwner
                ? <>After creating a firm, import opening balances from{" "}
                  <Link to="/openings" style={{ color: "inherit" }}>Opening ledger</Link>.</>
                : "Managers can post entries and transfers. Only the owner can add firms."}
            </p>
            {showTransfer ? (
              <form className="card-surface" style={{ marginBottom: 12 }} onSubmit={createTransfer}>
                <div className="field">
                  <label>From firm</label>
                  <select
                    value={transfer.source_firm_id}
                    onChange={(e) => setTransfer({ ...transfer, source_firm_id: e.target.value })}
                    required
                  >
                    <option value="">Select…</option>
                    {firms.filter((f) => f.status === "active").map((f) => (
                      <option key={f.firm_id} value={f.firm_id}>{f.firm_name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>To firm</label>
                  <select
                    value={transfer.destination_firm_id}
                    onChange={(e) => setTransfer({ ...transfer, destination_firm_id: e.target.value })}
                    required
                  >
                    <option value="">Select…</option>
                    {firms
                      .filter((f) => f.status === "active" && f.firm_id !== transfer.source_firm_id)
                      .map((f) => (
                        <option key={f.firm_id} value={f.firm_id}>{f.firm_name}</option>
                      ))}
                  </select>
                </div>
                <div className="field">
                  <label>Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={transfer.amount}
                    onChange={(e) => setTransfer({ ...transfer, amount: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Note</label>
                  <input
                    value={transfer.description}
                    onChange={(e) => setTransfer({ ...transfer, description: e.target.value })}
                    placeholder="Optional"
                  />
                </div>
                <button className="btn btn-primary btn-block" disabled={busy} type="submit">
                  Post transfer
                </button>
              </form>
            ) : null}
            {showNewFirm && isOwner ? (
              <form className="card-surface" style={{ marginBottom: 12 }} onSubmit={createFirm}>
                <div className="field">
                  <label>Firm name</label>
                  <input value={firmName} onChange={(e) => setFirmName(e.target.value)} required placeholder="Madurai Branch" />
                </div>
                <button className="btn btn-primary btn-block" disabled={busy} type="submit">Create firm</button>
              </form>
            ) : null}
            <div className="card-surface card-flush" style={{ marginBottom: 14 }}>
              {firms.map((f) => (
                <div key={f.firm_id} className="list-row">
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <div className="row-title">{f.firm_name}</div>
                    <span className={`badge ${f.status === "active" ? "badge-ok" : "badge-muted"}`}>
                      {f.status}
                    </span>
                  </div>
                  {isOwner ? (
                    f.status === "active" ? (
                      <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => void archiveFirm(f.firm_id)}>
                        Archive
                      </button>
                    ) : (
                      <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => void restoreFirm(f.firm_id)}>
                        Restore
                      </button>
                    )
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}

        {isOwner ? (
          <>
            <div className="section-title" style={{ margin: "8px 0" }}>Data protection</div>
            <p className="muted" style={{ fontSize: 13, marginTop: 0, lineHeight: 1.5 }}>
              Ledger fields are sealed with a license-bound key. Without a valid license activation,
              database dumps are not useful. Moving host does not require a new license.
            </p>
            {moveMsg ? <div className="success-banner">{moveMsg}</div> : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void runEncryptMigrate()}>
                Seal / migrate encryption
              </button>
              <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => setShowMove((v) => !v)}>
                {showMove ? "Cancel move" : "Move database"}
              </button>
            </div>
            {showMove ? (
              <form className="card-surface" style={{ marginBottom: 14 }} onSubmit={swapMoveDb}>
                <p className="field-hint" style={{ marginTop: 0 }}>
                  1) Copy data with pg_dump/restore (see MOVE_DATABASE.md). 2) Test connection. 3) Attach.
                  Assisted moves by our team are chargeable when self-serve is impractical.
                </p>
                <div className="field">
                  <label>Provider</label>
                  <select
                    value={moveForm.db_provider}
                    onChange={(e) =>
                      setMoveForm({
                        ...moveForm,
                        db_provider: e.target.value as typeof moveForm.db_provider,
                      })
                    }
                  >
                    <option value="supabase">Supabase</option>
                    <option value="existing">Existing PostgreSQL</option>
                    <option value="self_hosted">Self-hosted</option>
                  </select>
                </div>
                <div className="field">
                  <label>Host</label>
                  <input
                    value={moveForm.host}
                    onChange={(e) => setMoveForm({ ...moveForm, host: e.target.value })}
                    required
                    placeholder="aws-0-….pooler.supabase.com"
                  />
                </div>
                <div className="field">
                  <label>Port</label>
                  <input
                    value={moveForm.port}
                    onChange={(e) => setMoveForm({ ...moveForm, port: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Database</label>
                  <input
                    value={moveForm.database}
                    onChange={(e) => setMoveForm({ ...moveForm, database: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Username</label>
                  <input
                    value={moveForm.username}
                    onChange={(e) => setMoveForm({ ...moveForm, username: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Password</label>
                  <input
                    type="password"
                    value={moveForm.password}
                    onChange={(e) => setMoveForm({ ...moveForm, password: e.target.value })}
                    required
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void testMoveDb()}>
                    Test
                  </button>
                  <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} type="submit">
                    Attach database
                  </button>
                </div>
              </form>
            ) : null}
          </>
        ) : null}

        {isOwner ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="section-title" style={{ margin: "8px 0" }}>Users</div>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowNew((v) => !v)}>
                {showNew ? "Cancel" : "Add user"}
              </button>
            </div>
            {showNew ? (
              <form className="card-surface" style={{ marginBottom: 12 }} onSubmit={createUser}>
                <div className="field">
                  <label>Name</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="field">
                  <label>Username</label>
                  <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
                </div>
                <div className="field">
                  <label>Password</label>
                  <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
                </div>
                <div className="field">
                  <label>Role</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value, assigned_firm_id: "" })}
                  >
                    <option value="employee">Employee (one firm)</option>
                    <option value="manager">Manager (all firms)</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
                {form.role === "employee" ? (
                  <div className="field">
                    <label>Assigned firm</label>
                    <select
                      value={form.assigned_firm_id}
                      onChange={(e) => setForm({ ...form, assigned_firm_id: e.target.value })}
                      required
                    >
                      <option value="">Choose firm</option>
                      {firms.filter((f) => f.status === "active").map((f) => (
                        <option key={f.firm_id} value={f.firm_id}>{f.firm_name}</option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <button className="btn btn-primary btn-block" disabled={busy} type="submit">Create</button>
              </form>
            ) : null}

            {resetFor ? (
              <form className="card-surface" style={{ marginBottom: 12 }} onSubmit={doResetPassword}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Reset password</div>
                <div className="field">
                  <label>New password</label>
                  <input type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} required minLength={6} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-secondary" type="button" onClick={() => setResetFor(null)}>Cancel</button>
                  <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} type="submit">Save password</button>
                </div>
              </form>
            ) : null}

            <div className="card-surface card-flush">
              {users.map((u) => (
                <div key={u.user_id} className="list-row" style={{ alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row-title">{u.name}</div>
                    <div className="row-sub">{u.username}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
                      <span className="badge badge-accent">{u.role}</span>
                      {u.active ? null : <span className="badge badge-muted">Inactive</span>}
                    </div>
                    {u.role === "employee" ? (
                      <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                        <label style={{ fontSize: 11 }}>Assigned firm</label>
                        <select
                          value={u.assigned_firm_id ?? ""}
                          disabled={busy}
                          onChange={(e) => void reassignFirm(u.user_id, e.target.value)}
                        >
                          <option value="" disabled>Choose firm</option>
                          {firms.filter((f) => f.status === "active").map((f) => (
                            <option key={f.firm_id} value={f.firm_id}>{f.firm_name}</option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                  {u.user_id !== user?.user_id ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => setResetFor(u.user_id)}>
                        Reset pw
                      </button>
                      <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => void toggleActive(u.user_id, !u.active)}>
                        {u.active ? "Disable" : "Enable"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <BottomNav />
    </div>
  );
}
