import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BottomNav } from "../components/BottomNav";
import { FirmSelector } from "../components/FirmSelector";
import { useAuth } from "../auth";
import { useFirm } from "../firm";
import { api, money, ApiError } from "../lib/api";

interface Party {
  party_id: string;
  party_name: string;
  phone: string | null;
  current_balance: number;
  active: boolean;
}

export function PartiesPage() {
  const { user } = useAuth();
  const { selectedFirmId, selectedFirm, isSummary, firms, firmLocked } = useFirm();
  const canOpenings = user?.role === "owner" || user?.role === "manager";
  const [q, setQ] = useState("");
  const [parties, setParties] = useState<Party[]>([]);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [opening, setOpening] = useState("0");
  const [effectiveDate, setEffectiveDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [createFirmId, setCreateFirmId] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(search = q) {
    try {
      const qs = new URLSearchParams({ q: search });
      if (selectedFirmId) qs.set("firm_id", selectedFirmId);
      const data = await api<{ parties: Party[] }>(`/parties?${qs}`);
      setParties(data.parties);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void load(q), 200);
    return () => clearTimeout(t);
  }, [q, selectedFirmId]);

  useEffect(() => {
    setCreateFirmId(selectedFirmId ?? firms[0]?.firm_id ?? "");
  }, [selectedFirmId, firms]);

  async function createParty(e: FormEvent) {
    e.preventDefault();
    if (!createFirmId) {
      setError("Choose a firm for the opening balance");
      return;
    }
    setBusy(true);
    try {
      await api("/parties", {
        method: "POST",
        body: JSON.stringify({
          party_name: name,
          phone: phone || null,
          firm_id: createFirmId,
          opening_balance: Number(opening) || 0,
          effective_date: effectiveDate || undefined,
        }),
      });
      setShowNew(false);
      setName("");
      setPhone("");
      setOpening("0");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="page">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18, gap: 10 }}>
          <div>
            <div className="eyebrow">Ledger</div>
            <h1 className="page-title">Parties</h1>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {canOpenings ? (
              <Link to="/openings" className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}>
                Openings
              </Link>
            ) : null}
            <button className="btn btn-primary btn-sm" type="button" onClick={() => setShowNew((v) => !v)}>
              {showNew ? "Cancel" : "Add"}
            </button>
          </div>
        </div>

        <FirmSelector />

        <div className="field">
          <label htmlFor="search">Search</label>
          <input id="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or phone" />
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        {showNew ? (
          <form className="card-surface" style={{ marginBottom: 16 }} onSubmit={createParty}>
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Phone (optional)</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field">
              <label>Opening firm</label>
              {firmLocked || firms.length === 1 ? (
                <>
                  <input
                    value={firms.find((f) => f.firm_id === createFirmId)?.firm_name ?? ""}
                    disabled
                    readOnly
                  />
                  <span className="field-hint">Opening balance is recorded against this firm.</span>
                </>
              ) : (
                <>
                  <select value={createFirmId} onChange={(e) => setCreateFirmId(e.target.value)} required>
                    <option value="">Choose firm</option>
                    {firms.map((f) => (
                      <option key={f.firm_id} value={f.firm_id}>{f.firm_name}</option>
                    ))}
                  </select>
                  <span className="field-hint">
                    Opening balance is recorded against this firm only.
                  </span>
                </>
              )}
            </div>
            <div className="field">
              <label>Opening balance</label>
              <input type="number" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} />
              <span className="field-hint">
                Use the real outstanding amount if this business already has history.
              </span>
            </div>
            <div className="field">
              <label>Effective date</label>
              <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
            </div>
            <button className="btn btn-primary btn-block" disabled={busy} type="submit">
              {busy ? "Saving…" : "Create party"}
            </button>
          </form>
        ) : null}
        <div className="section-title">
          {isSummary ? "Workspace Summary" : selectedFirm?.firm_name} · {parties.length} parties
        </div>
        <div className="card-surface card-flush">
          {parties.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m16 16 4 4" />
                </svg>
              </div>
              No parties found.
            </div>
          ) : (
            parties.map((p) => (
              <Link key={p.party_id} to={`/parties/${p.party_id}`} className="list-row">
                <div>
                  <div className="row-title">{p.party_name}</div>
                  {p.phone ? <div className="row-sub">{p.phone}</div> : null}
                </div>
                <div className={`row-amount ${p.current_balance >= 0 ? "money-in" : "money-out"}`}>
                  {money(p.current_balance)}
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
