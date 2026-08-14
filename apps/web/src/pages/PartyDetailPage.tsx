import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BottomNav } from "../components/BottomNav";
import { FirmSelector } from "../components/FirmSelector";
import { useAuth } from "../auth";
import { useFirm } from "../firm";
import { api, formatDate, money, ApiError } from "../lib/api";

interface FirmBalance {
  firm_id: string;
  firm_name: string;
  opening_balance: number;
  opening_locked?: boolean;
  effective_date?: string | null;
  current_balance: number;
}

interface Party {
  party_id: string;
  party_name: string;
  phone: string | null;
  current_balance: number;
  firm_balances?: FirmBalance[];
}

interface Entry {
  entry_id: string;
  firm_id: string;
  firm_name?: string;
  date_time: string;
  type: "incoming" | "outgoing";
  amount: number;
  description: string;
  reverse_of_entry: string | null;
}

export function PartyDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { selectedFirmId, selectedFirm, isSummary } = useFirm();
  const canEditParty = user?.role === "owner" || user?.role === "manager";
  const [party, setParty] = useState<Party | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [type, setType] = useState<"incoming" | "outgoing">("incoming");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [editOpening, setEditOpening] = useState("");
  const [editEffective, setEditEffective] = useState(
    () => new Date().toISOString().slice(0, 10),
  );

  async function load() {
    if (!id) return;
    try {
      const qs = selectedFirmId ? `?firm_id=${selectedFirmId}` : "";
      const [p, e] = await Promise.all([
        api<{ party: Party }>(`/parties/${id}${qs}`),
        api<{ entries: Entry[] }>(`/ledger/party/${id}${qs}`),
      ]);
      setParty(p.party);
      setEntries(e.entries);
      setEditName(p.party.party_name);
      setEditPhone(p.party.phone ?? "");
      const firmBal = p.party.firm_balances?.find((fb) => fb.firm_id === selectedFirmId);
      setEditOpening(String(firmBal?.opening_balance ?? 0));
      setEditEffective(firmBal?.effective_date ?? new Date().toISOString().slice(0, 10));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }

  useEffect(() => {
    setShowAdd(false);
    setShowEdit(false);
    void load();
  }, [id, selectedFirmId]);

  async function addEntry(e: FormEvent) {
    e.preventDefault();
    if (!id || !selectedFirmId) return;
    setBusy(true);
    try {
      await api("/ledger/entries", {
        method: "POST",
        body: JSON.stringify({
          firm_id: selectedFirmId,
          party_id: id,
          type,
          amount: Number(amount),
          description,
        }),
      });
      setShowAdd(false);
      setAmount("");
      setDescription("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add");
    } finally {
      setBusy(false);
    }
  }

  async function saveParty(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setBusy(true);
    try {
      await api(`/parties/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          party_name: editName,
          phone: editPhone || null,
        }),
      });
      setShowEdit(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update party");
    } finally {
      setBusy(false);
    }
  }

  async function reverseEntry(entryId: string) {
    if (!confirm("Create a reverse entry? Original stays in history.")) return;
    setBusy(true);
    try {
      await api(`/ledger/entries/${entryId}/reverse`, { method: "POST", body: "{}" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reverse failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveOpening(e: FormEvent) {
    e.preventDefault();
    if (!id || !selectedFirmId) return;
    setBusy(true);
    try {
      await api("/openings", {
        method: "PUT",
        body: JSON.stringify({
          party_id: id,
          firm_id: selectedFirmId,
          balance: Number(editOpening) || 0,
          effective_date: editEffective || undefined,
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update opening");
    } finally {
      setBusy(false);
    }
  }

  const reversedIds = new Set(
    entries.filter((e) => e.reverse_of_entry).map((e) => e.reverse_of_entry as string),
  );

  const selectedFirmBalance = party?.firm_balances?.find((fb) => fb.firm_id === selectedFirmId);
  const openingLocked = Boolean(selectedFirmBalance?.opening_locked) || entries.length > 0;

  return (
    <div className="app-shell">
      <div className="page">
        <Link to="/parties" className="back-link">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5.5 8.5 12l6.5 6.5" />
          </svg>
          Parties
        </Link>
        {party ? (
          <div className="page-head" style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <h1 className="page-title">{party.party_name}</h1>
              {party.phone ? <div className="muted" style={{ marginTop: 4 }}>{party.phone}</div> : null}
            </div>
            {canEditParty ? (
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => setShowEdit((v) => !v)}
              >
                {showEdit ? "Cancel" : "Edit"}
              </button>
            ) : null}
          </div>
        ) : null}

        <FirmSelector />

        {showEdit && canEditParty ? (
          <form className="card-surface" style={{ marginBottom: 12 }} onSubmit={saveParty}>
            <div className="field">
              <label>Name</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Phone</label>
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-block" disabled={busy} type="submit">
              {busy ? "Saving…" : "Save party"}
            </button>
          </form>
        ) : null}

        {party ? (
          <>
            <div className="hero">
              <div className="hero-label">
                {isSummary ? "Total balance" : `${selectedFirm?.firm_name} balance`}
              </div>
              <div className="hero-value">{money(party.current_balance)}</div>
              <div className="hero-meta">
                {party.current_balance >= 0 ? "They owe you" : "You owe them"}
              </div>
            </div>
            {isSummary && party.firm_balances && party.firm_balances.length > 0 ? (
              <div className="card-surface card-flush" style={{ marginTop: 12 }}>
                {party.firm_balances.map((fb) => (
                  <div key={fb.firm_id} className="list-row">
                    <div>
                      <div className="row-title">{fb.firm_name}</div>
                      <div className="row-sub">
                        Opening {money(fb.opening_balance)}
                        {fb.effective_date ? ` · ${fb.effective_date}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {fb.opening_locked ? <span className="badge badge-muted">Locked</span> : null}
                      <div className={`row-amount ${fb.current_balance >= 0 ? "money-in" : "money-out"}`}>
                        {money(fb.current_balance)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {!isSummary && selectedFirmId && canEditParty ? (
              <form className="card-surface" style={{ marginTop: 12 }} onSubmit={saveOpening}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                  <div style={{ fontWeight: 650 }}>Opening balance</div>
                  {openingLocked ? <span className="badge badge-muted">Locked</span> : <span className="badge badge-accent">Editable</span>}
                </div>
                {openingLocked ? (
                  <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                    Locked at {money(selectedFirmBalance?.opening_balance ?? 0)}
                    {selectedFirmBalance?.effective_date
                      ? ` (from ${selectedFirmBalance.effective_date})`
                      : ""}
                    . Corrections require an adjustment entry.
                  </p>
                ) : (
                  <>
                    <div className="field">
                      <label>Opening balance</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editOpening}
                        onChange={(e) => setEditOpening(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label>Effective date</label>
                      <input
                        type="date"
                        value={editEffective}
                        onChange={(e) => setEditEffective(e.target.value)}
                      />
                    </div>
                    <button className="btn btn-secondary btn-block" disabled={busy} type="submit">
                      {busy ? "Saving…" : "Update opening"}
                    </button>
                  </>
                )}
              </form>
            ) : null}
          </>
        ) : null}

        {error ? <div className="error-banner" style={{ marginTop: 12 }}>{error}</div> : null}

        {isSummary ? (
          <p className="muted" style={{ marginTop: 16, fontSize: 14 }}>
            Company total is read-only. Select a firm above to add or reverse entries.
          </p>
        ) : (
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary btn-block" type="button" onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? "Cancel" : "Add entry"}
            </button>
          </div>
        )}

        {showAdd && !isSummary ? (
          <form className="card-surface" style={{ marginTop: 12 }} onSubmit={addEntry}>
            <div className="field">
              <label>Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as "incoming" | "outgoing")}>
                <option value="incoming">Money in</option>
                <option value="outgoing">Money out</option>
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
            <button className="btn btn-primary btn-block" disabled={busy} type="submit">
              {busy ? "Saving…" : "Save entry"}
            </button>
          </form>
        ) : null}

        <div className="section-title">History</div>
        <div className="card-surface card-flush">
          {entries.length === 0 ? (
            <div className="empty-state">No entries yet.</div>
          ) : (
            entries.map((entry) => (
              <div key={entry.entry_id} className="list-row" style={{ alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div className={`row-amount ${entry.type === "incoming" ? "money-in" : "money-out"}`}>
                    {entry.type === "incoming" ? "−" : "+"}
                    {money(entry.amount)}
                  </div>
                  <div className="row-sub">
                    {formatDate(entry.date_time)}
                    {isSummary && entry.firm_name ? ` · ${entry.firm_name}` : ""}
                  </div>
                  {entry.description ? <div style={{ fontSize: 13, marginTop: 4 }}>{entry.description}</div> : null}
                  {entry.reverse_of_entry ? (
                    <span className="badge badge-muted" style={{ marginTop: 6 }}>Reversal</span>
                  ) : reversedIds.has(entry.entry_id) ? (
                    <span className="badge badge-muted" style={{ marginTop: 6 }}>Reversed</span>
                  ) : null}
                </div>
                {!isSummary && !entry.reverse_of_entry && !reversedIds.has(entry.entry_id) ? (
                  <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={() => void reverseEntry(entry.entry_id)}>
                    Reverse
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
