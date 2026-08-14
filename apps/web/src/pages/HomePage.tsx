import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BottomNav } from "../components/BottomNav";
import { NotificationBell } from "../components/NotificationBell";
import { useAuth } from "../auth";
import { useFirm } from "../firm";
import { api, ApiError, money } from "../lib/api";

interface Stats {
  today_incoming: number;
  today_outgoing: number;
  outstanding_balance: number;
  today_transaction_count: number;
  firm_name?: string | null;
  view?: string;
}

interface Party {
  party_id: string;
  party_name: string;
}

export function HomePage() {
  const { user, workspace } = useAuth();
  const { selectedFirmId, firms, firmLocked } = useFirm();
  const [stats, setStats] = useState<Stats | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [mode, setMode] = useState<"incoming" | "outgoing" | null>(null);
  const [partyId, setPartyId] = useState("");
  const [entryFirmId, setEntryFirmId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadDashboard() {
    // Company-wide total for owners/managers; employees are scoped by API.
    const data = await api<Stats>("/dashboard");
    setStats(data);
  }

  useEffect(() => {
    setError("");
    setSuccess("");
    setMode(null);
    const defaultFirm = firmLocked
      ? selectedFirmId ?? firms[0]?.firm_id ?? ""
      : firms.length === 1
        ? firms[0].firm_id
        : "";
    setEntryFirmId(defaultFirm);
    Promise.all([
      loadDashboard(),
      api<{ parties: Party[] }>("/parties").then((data) => setParties(data.parties)),
    ]).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [user?.user_id, firmLocked, selectedFirmId, firms]);

  async function addEntry(e: FormEvent) {
    e.preventDefault();
    if (!mode) return;
    const firmId = entryFirmId || selectedFirmId;
    if (!firmId) {
      setError("Choose a firm for this entry");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api("/ledger/entries", {
        method: "POST",
        body: JSON.stringify({
          firm_id: firmId,
          party_id: partyId,
          type: mode,
          amount: Number(amount),
          description,
        }),
      });
      setAmount("");
      setDescription("");
      setMode(null);
      setSuccess(mode === "incoming" ? "Money in saved" : "Money out saved");
      await loadDashboard();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add entry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="page">
        <div className="page-head" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">{workspace?.company_name ?? "Ledger"}</div>
            <h1 className="page-title">Hi, {user?.name.split(" ")[0]}</h1>
          </div>
          <NotificationBell />
        </div>

        {error ? <div className="error-banner">{error}</div> : null}
        {success ? <div className="success-banner">{success}</div> : null}

        <div className="hero">
          <div className="hero-label">Balance</div>
          <div className="hero-value">{stats ? money(stats.outstanding_balance) : "—"}</div>
          <div className="hero-meta">
            {user?.role === "employee"
              ? stats?.firm_name ?? "Your firm"
              : "All firms combined"}
          </div>
        </div>

        <div className="btn-row home-money-row">
          <button
            className={`btn btn-primary home-money-btn${mode === "incoming" ? " active-mode" : ""}`}
            type="button"
            onClick={() => {
              setMode((m) => (m === "incoming" ? null : "incoming"));
              setSuccess("");
            }}
          >
            Money in
          </button>
          <button
            className={`btn btn-secondary home-money-btn${mode === "outgoing" ? " active-mode" : ""}`}
            type="button"
            onClick={() => {
              setMode((m) => (m === "outgoing" ? null : "outgoing"));
              setSuccess("");
            }}
          >
            Money out
          </button>
        </div>

        {mode ? (
          <form className="card-surface" style={{ marginTop: 12 }} onSubmit={addEntry}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>
              {mode === "incoming" ? "Money in" : "Money out"}
            </div>

            {!firmLocked && firms.length > 1 ? (
              <div className="field">
                <label>Firm</label>
                <select
                  value={entryFirmId}
                  onChange={(e) => setEntryFirmId(e.target.value)}
                  required
                >
                  <option value="">Choose a firm</option>
                  {firms.map((f) => (
                    <option key={f.firm_id} value={f.firm_id}>
                      {f.firm_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                Posting to{" "}
                <strong>
                  {firms.find((f) => f.firm_id === (entryFirmId || selectedFirmId))?.firm_name ??
                    "firm"}
                </strong>
              </p>
            )}

            {parties.length > 0 ? (
              <>
                <div className="field">
                  <label>Party</label>
                  <select value={partyId} onChange={(e) => setPartyId(e.target.value)} required>
                    <option value="">Choose party</option>
                    {parties.map((party) => (
                      <option key={party.party_id} value={party.party_id}>
                        {party.party_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Amount</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label>Note</label>
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <button
                  className="btn btn-primary btn-block"
                  disabled={busy || !partyId}
                  type="submit"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <p className="muted" style={{ marginTop: 0 }}>
                No parties yet.{" "}
                <Link to="/parties" style={{ color: "inherit" }}>
                  Add a party
                </Link>
              </p>
            )}
          </form>
        ) : null}
      </div>
      <BottomNav />
    </div>
  );
}
