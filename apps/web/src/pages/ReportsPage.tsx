import { FormEvent, useEffect, useState } from "react";
import { BottomNav } from "../components/BottomNav";
import { FirmSelector } from "../components/FirmSelector";
import { useAuth } from "../auth";
import { useFirm } from "../firm";
import { api, formatDate, money, ApiError, API_BASE } from "../lib/api";

interface Party {
  party_id: string;
  party_name: string;
}

interface Statement {
  view: string;
  firm_name: string | null;
  party: {
    party_name: string;
    opening_balance: number;
    current_balance: number;
  };
  entries: Array<{
    entry_id: string;
    firm_name?: string;
    date_time: string;
    type: string;
    amount: number;
    description: string;
    balance_after: number;
  }>;
}

export function ReportsPage() {
  const { user } = useAuth();
  const { selectedFirmId, isSummary, selectedFirm } = useFirm();
  const canReport = user?.role === "owner" || user?.role === "manager";
  const [parties, setParties] = useState<Party[]>([]);
  const [partyId, setPartyId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canReport) return;
    api<{ parties: Party[] }>("/parties")
      .then((d) => setParties(d.parties))
      .catch((e) => setError(e.message));
  }, [canReport]);

  function buildParams() {
    const params = new URLSearchParams({ party_id: partyId });
    if (selectedFirmId) params.set("firm_id", selectedFirmId);
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to).toISOString());
    return params;
  }

  async function loadStatement(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api<Statement>(`/reports/statement?${buildParams()}`);
      setStatement(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function downloadPdf() {
    const token = localStorage.getItem("ledger_token");
    void fetch(`${API_BASE}/reports/statement.pdf?${buildParams()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("PDF failed");
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "statement.pdf";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => setError(err.message));
  }

  if (!canReport) {
    return (
      <div className="app-shell">
        <div className="page">
          <h1 className="page-title" style={{ marginTop: 0 }}>Reports</h1>
          <p className="muted">Only owners and managers can view reports.</p>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="page">
        <div className="page-head">
          <div className="eyebrow">Statements</div>
          <h1 className="page-title">Reports</h1>
        </div>
        <FirmSelector />
        <form className="card-surface" onSubmit={loadStatement}>
          {error ? <div className="error-banner">{error}</div> : null}
          <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
            Export scope: {isSummary ? "Workspace Summary" : selectedFirm?.firm_name}
          </div>
          <div className="field">
            <label>Party</label>
            <select value={partyId} onChange={(e) => setPartyId(e.target.value)} required>
              <option value="">Select…</option>
              {parties.map((c) => (
                <option key={c.party_id} value={c.party_id}>{c.party_name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-block" disabled={busy || !partyId} type="submit">
            {busy ? "Loading…" : "View statement"}
          </button>
        </form>

        {statement ? (
          <div className="card-surface" style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: "-0.02em" }}>
              {statement.party.party_name}
            </div>
            <div className="muted" style={{ marginTop: 5, fontSize: 13, lineHeight: 1.5 }}>
              {statement.firm_name ?? "Workspace Summary"} · Opening{" "}
              <span className="amount">{money(statement.party.opening_balance)}</span> · Balance{" "}
              <span className="amount">{money(statement.party.current_balance)}</span>
            </div>
            <button className="btn btn-secondary btn-block" style={{ marginTop: 14 }} type="button" onClick={downloadPdf}>
              Download PDF ({isSummary ? "Workspace Summary" : "Current Firm"})
            </button>
            <div className="divider" />
            <div>
              {statement.entries.map((entry) => (
                <div key={entry.entry_id} className="list-row">
                  <div style={{ minWidth: 0 }}>
                    <div className={`row-amount ${entry.type === "incoming" ? "money-in" : "money-out"}`}>
                      {entry.type === "incoming" ? "−" : "+"}
                      {money(entry.amount)}
                    </div>
                    <div className="row-sub">
                      {formatDate(entry.date_time)}
                      {entry.firm_name ? ` · ${entry.firm_name}` : ""}
                    </div>
                    {entry.description ? <div style={{ fontSize: 13, marginTop: 4 }}>{entry.description}</div> : null}
                  </div>
                  <div className="row-amount">{money(entry.balance_after)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <BottomNav />
    </div>
  );
}
