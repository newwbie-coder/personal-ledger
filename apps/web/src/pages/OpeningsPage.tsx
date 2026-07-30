import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BottomNav } from "../components/BottomNav";
import { FirmSelector } from "../components/FirmSelector";
import { useAuth } from "../auth";
import { useFirm } from "../firm";
import { downloadExcelTemplate, fileToImportCsv } from "../lib/spreadsheetImport";
import { api, money, ApiError } from "../lib/api";

interface Opening {
  opening_balance_id: string;
  party_id: string;
  party_name: string;
  firm_id: string;
  firm_name: string;
  balance: number;
  effective_date: string | null;
  locked: boolean;
}

export function OpeningsPage() {
  const { user } = useAuth();
  const { selectedFirmId, selectedFirm, isSummary, firms } = useFirm();
  const canManage = user?.role === "owner" || user?.role === "manager";
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [partyName, setPartyName] = useState("");
  const [phone, setPhone] = useState("");
  const [firmId, setFirmId] = useState("");
  const [balance, setBalance] = useState("0");
  const [effectiveDate, setEffectiveDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const qs = selectedFirmId ? `?firm_id=${selectedFirmId}` : "";
      const data = await api<{ openings: Opening[] }>(`/openings${qs}`);
      setOpenings(data.openings);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    void load();
  }, [selectedFirmId]);

  useEffect(() => {
    setFirmId(selectedFirmId ?? firms[0]?.firm_id ?? "");
  }, [selectedFirmId, firms]);

  async function saveOpening(e: FormEvent) {
    e.preventDefault();
    if (!firmId) {
      setError("Choose a firm");
      return;
    }
    setBusy(true);
    setOkMsg("");
    try {
      await api("/openings", {
        method: "PUT",
        body: JSON.stringify({
          party_name: partyName.trim(),
          phone: phone || null,
          firm_id: firmId,
          balance: Number(balance) || 0,
          effective_date: effectiveDate || undefined,
        }),
      });
      setShowAdd(false);
      setPartyName("");
      setPhone("");
      setBalance("0");
      setOkMsg("Opening balance saved");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    try {
      const token = localStorage.getItem("ledger_token");
      const root = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
      const res = await fetch(`${root}/api/v1/openings/template.csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Could not download template");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "opening-balances-template.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  }

  async function importSpreadsheet(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setOkMsg("");
    try {
      const data = await api<{ imported: number; failed: number; results: Array<{ ok: boolean; error?: string; party_name: string }> }>(
        "/openings/import",
        { method: "POST", body: JSON.stringify({ csv: csvText }) },
      );
      setOkMsg(`Imported ${data.imported}, failed ${data.failed}`);
      if (data.failed > 0) {
        const first = data.results.find((r) => !r.ok);
        if (first?.error) setError(`${first.party_name}: ${first.error}`);
      } else {
        setError("");
        setShowImport(false);
        setCsvText("");
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function onImportFileSelected(file: File | null) {
    if (!file) return;
    setBusy(true);
    setOkMsg("");
    setError("");
    try {
      const csv = await fileToImportCsv(file);
      setCsvText(csv);
      const data = await api<{ imported: number; failed: number; results: Array<{ ok: boolean; error?: string; party_name: string }> }>(
        "/openings/import",
        { method: "POST", body: JSON.stringify({ csv }) },
      );
      setOkMsg(`Imported ${data.imported}, failed ${data.failed}`);
      if (data.failed > 0) {
        const first = data.results.find((r) => !r.ok);
        if (first?.error) setError(`${first.party_name}: ${first.error}`);
      } else {
        setError("");
        setShowImport(false);
        setCsvText("");
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <div className="app-shell">
        <div className="page">
          <h1 className="page-title" style={{ marginTop: 0 }}>Opening balances</h1>
          <p className="muted">Only owners and managers can manage opening balances.</p>
          <BottomNav />
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="page">
        <Link to="/parties" className="back-link">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5.5 8.5 12l6.5 6.5" />
          </svg>
          Parties
        </Link>
        <div className="page-head" style={{ marginTop: 10 }}>
          <div className="eyebrow">Onboarding</div>
          <h1 className="page-title">Opening ledger</h1>
          <p className="muted" style={{ fontSize: 14, marginTop: 8, lineHeight: 1.5 }}>
            Set starting balances for an existing business. Locked after the first transaction for that party in that firm.
          </p>
        </div>

        <FirmSelector />

        <div className="btn-row" style={{ marginBottom: 14 }}>
          <button className="btn btn-primary" type="button" onClick={() => { setShowAdd((v) => !v); setShowImport(false); }}>
            {showAdd ? "Cancel" : "Add / update"}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => { setShowImport((v) => !v); setShowAdd(false); }}>
            {showImport ? "Cancel" : "Import file"}
          </button>
        </div>
        <div className="btn-row" style={{ marginBottom: 16 }}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void downloadTemplate()}>
            CSV template
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => downloadExcelTemplate()}>
            Excel template
          </button>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}
        {okMsg ? <div className="success-banner">{okMsg}</div> : null}

        {showAdd ? (
          <form className="card-surface" style={{ marginBottom: 16 }} onSubmit={saveOpening}>
            <div className="field">
              <label>Party name</label>
              <input value={partyName} onChange={(e) => setPartyName(e.target.value)} required placeholder="ABC Traders" />
            </div>
            <div className="field">
              <label>Phone (optional)</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field">
              <label>Firm</label>
              <select value={firmId} onChange={(e) => setFirmId(e.target.value)} required>
                <option value="">Choose firm</option>
                {firms.map((f) => (
                  <option key={f.firm_id} value={f.firm_id}>{f.firm_name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Opening balance</label>
              <input type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} required />
              <span className="field-hint">Positive = they owe you · Negative = you owe them</span>
            </div>
            <div className="field">
              <label>Effective date</label>
              <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
            </div>
            <button className="btn btn-primary btn-block" disabled={busy} type="submit">
              {busy ? "Saving…" : "Save opening"}
            </button>
          </form>
        ) : null}

        {showImport ? (
          <form className="card-surface" style={{ marginBottom: 16 }} onSubmit={importSpreadsheet}>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Columns: party_name, firm_name, opening_balance, effective_date, phone
            </p>
            <div className="field">
              <label>Upload file (.xlsx, .xls, or .csv)</label>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  void onImportFileSelected(file);
                }}
              />
              <span className="field-hint">
                Same format as the template. Excel dates like 29-07-2026 are supported.
              </span>
            </div>
            <div className="field">
              <label>Or paste CSV</label>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                rows={8}
                placeholder={"party_name,firm_name,opening_balance,effective_date,phone\nABC Traders,Madurai,25000,29-07-2026,"}
                style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 13 }}
              />
            </div>
            <button className="btn btn-primary btn-block" disabled={busy || !csvText.trim()} type="submit">
              {busy ? "Importing…" : "Import pasted CSV"}
            </button>
          </form>
        ) : null}

        <div className="section-title">
          {isSummary ? "All firms" : selectedFirm?.firm_name} · {openings.length} openings
        </div>
        <div className="card-surface card-flush">
          {openings.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 4.5v11" />
                  <path d="m7.5 11 4.5 4.5 4.5-4.5" />
                  <path d="M4.5 19.5h15" />
                </svg>
              </div>
              No opening balances yet. Import from CSV/Excel or add one above so existing parties start correctly.
            </div>
          ) : (
            openings.map((o) => (
              <div key={o.opening_balance_id} className="list-row">
                <div style={{ minWidth: 0 }}>
                  <div className="row-title">{o.party_name}</div>
                  <div className="row-sub">
                    {o.firm_name}
                    {o.effective_date ? ` · from ${o.effective_date}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {o.locked ? <span className="badge badge-muted">Locked</span> : null}
                  <div className={`row-amount ${o.balance >= 0 ? "money-in" : "money-out"}`}>
                    {money(o.balance)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
