import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BottomNav } from "../components/BottomNav";
import { FirmSelector } from "../components/FirmSelector";
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
  const { selectedFirmId, selectedFirm, isSummary, firms } = useFirm();
  const canTransfer = user?.role === "owner" || user?.role === "manager";
  const [stats, setStats] = useState<Stats | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [partyId, setPartyId] = useState("");
  const [entryFirmId, setEntryFirmId] = useState("");
  const [type, setType] = useState<"incoming" | "outgoing">("incoming");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [sourceFirmId, setSourceFirmId] = useState("");
  const [destFirmId, setDestFirmId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadDashboard() {
    const qs = selectedFirmId ? `?firm_id=${selectedFirmId}` : "";
    const data = await api<Stats>(`/dashboard${qs}`);
    setStats(data);
  }

  useEffect(() => {
    setError("");
    setSuccess("");
    setShowAdd(false);
    setEntryFirmId(selectedFirmId ?? "");
    Promise.all([
      loadDashboard(),
      api<{ parties: Party[] }>("/parties").then((data) => setParties(data.parties)),
    ]).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [selectedFirmId]);

  async function addEntry(e: FormEvent) {
    e.preventDefault();
    const firmId = isSummary ? entryFirmId : selectedFirmId;
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
          type,
          amount: Number(amount),
          description,
        }),
      });
      setAmount("");
      setDescription("");
      setSuccess("Entry saved");
      await loadDashboard();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add entry");
    } finally {
      setBusy(false);
    }
  }

  async function createTransfer(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api("/transfers", {
        method: "POST",
        body: JSON.stringify({
          source_firm_id: sourceFirmId,
          destination_firm_id: destFirmId,
          amount: Number(transferAmount),
          description: transferNote,
        }),
      });
      setTransferAmount("");
      setTransferNote("");
      setShowTransfer(false);
      setSuccess("Transfer posted");
      await loadDashboard();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="page">
        <div className="page-head">
          <div className="eyebrow">{workspace?.company_name ?? "Ledger"}</div>
          <h1 className="page-title">Hi, {user?.name.split(" ")[0]}</h1>
        </div>

        <FirmSelector />

        {error ? <div className="error-banner">{error}</div> : null}
        {success ? <div className="success-banner">{success}</div> : null}

        <div className="hero">
          <div className="hero-label">Outstanding</div>
          <div className="hero-value">{stats ? money(stats.outstanding_balance) : "—"}</div>
          <div className="hero-meta">
            {isSummary ? "All firms combined" : selectedFirm?.firm_name}
            {stats ? ` · ${stats.today_transaction_count} entries today` : ""}
          </div>
        </div>

        <div className="stat-grid" style={{ marginTop: 12 }}>
          <div className="stat">
            <div className="label">Received today</div>
            <div className="value money-in">{stats ? money(stats.today_incoming) : "—"}</div>
          </div>
          <div className="stat">
            <div className="label">Given today</div>
            <div className="value money-out">{stats ? money(stats.today_outgoing) : "—"}</div>
          </div>
        </div>

        <div className="btn-row" style={{ marginTop: 18 }}>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setShowAdd((v) => !v);
              setShowTransfer(false);
              setSuccess("");
            }}
          >
            {showAdd ? "Cancel" : "Add entry"}
          </button>
          {canTransfer && firms.length >= 2 ? (
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => {
                setShowTransfer((v) => !v);
                setShowAdd(false);
                setSuccess("");
              }}
            >
              {showTransfer ? "Cancel" : "Transfer"}
            </button>
          ) : null}
        </div>

        {showAdd ? (
          <form className="card-surface" style={{ marginTop: 12 }} onSubmit={addEntry}>
            {isSummary ? (
              <div className="field">
                <label>Firm</label>
                <select
                  value={entryFirmId}
                  onChange={(e) => setEntryFirmId(e.target.value)}
                  required
                >
                  <option value="">Choose a firm</option>
                  {firms.map((f) => (
                    <option key={f.firm_id} value={f.firm_id}>{f.firm_name}</option>
                  ))}
                </select>
                <span className="field-hint">
                  Workspace Summary is read-only. Pick one firm to post.
                </span>
              </div>
            ) : (
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                Posting to <strong>{selectedFirm?.firm_name}</strong>
              </p>
            )}

            {parties.length > 0 ? (
              <>
                <div className="field">
                  <label>Party</label>
                  <select value={partyId} onChange={(e) => setPartyId(e.target.value)} required>
                    <option value="">Choose an existing party</option>
                    {parties.map((party) => (
                      <option key={party.party_id} value={party.party_id}>
                        {party.party_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Type</label>
                  <select value={type} onChange={(e) => setType(e.target.value as "incoming" | "outgoing")}>
                    <option value="incoming">Received (reduces outstanding)</option>
                    <option value="outgoing">Gave / credit (increases outstanding)</option>
                  </select>
                </div>
                <div className="field">
                  <label>Amount</label>
                  <input type="number" inputMode="decimal" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                </div>
                <div className="field">
                  <label>Description</label>
                  <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional note" />
                </div>
                <button className="btn btn-primary btn-block" disabled={busy || !partyId} type="submit">
                  {busy ? "Saving…" : "Save entry"}
                </button>
              </>
            ) : (
              <p className="muted" style={{ marginTop: 0 }}>There are no parties yet.</p>
            )}

            <Link to="/parties" className="btn btn-ghost btn-block" style={{ marginTop: 10, textDecoration: "none" }}>
              {parties.length > 0 ? "Manage parties" : "Create a party"}
            </Link>
          </form>
        ) : null}

        {showTransfer ? (
          <form className="card-surface" style={{ marginTop: 12 }} onSubmit={createTransfer}>
            <div className="field">
              <label>From firm</label>
              <select value={sourceFirmId} onChange={(e) => setSourceFirmId(e.target.value)} required>
                <option value="">Select…</option>
                {firms.map((f) => (
                  <option key={f.firm_id} value={f.firm_id}>{f.firm_name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>To firm</label>
              <select value={destFirmId} onChange={(e) => setDestFirmId(e.target.value)} required>
                <option value="">Select…</option>
                {firms.filter((f) => f.firm_id !== sourceFirmId).map((f) => (
                  <option key={f.firm_id} value={f.firm_id}>{f.firm_name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Amount</label>
              <input type="number" inputMode="decimal" step="0.01" min="0.01" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} required />
            </div>
            <div className="field">
              <label>Description</label>
              <input value={transferNote} onChange={(e) => setTransferNote(e.target.value)} placeholder="Optional note" />
            </div>
            <button className="btn btn-primary btn-block" disabled={busy} type="submit">
              {busy ? "Posting…" : "Post transfer"}
            </button>
          </form>
        ) : null}
      </div>
      <BottomNav />
    </div>
  );
}
