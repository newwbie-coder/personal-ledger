import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { api, money } from "../lib/api";
import { useViewMode } from "../view-mode";

export function BalancePage() {
  const { workspace, logout } = useAuth();
  const { showApp } = useViewMode();
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<{ outstanding_balance: number }>("/dashboard")
      .then((data) => {
        if (!cancelled) setBalance(data.outstanding_balance);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load balance");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-shell">
      <div className="page balance-only">
        <div className="eyebrow">{workspace?.company_name ?? "Ledger"}</div>
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="hero">
          <div className="hero-label">Available balance</div>
          <div className="hero-value">{balance == null ? "—" : money(balance)}</div>
        </div>
        <button className="btn btn-secondary btn-block" type="button" onClick={showApp}>
          Open app
        </button>
        <button className="btn btn-secondary btn-block" type="button" onClick={logout}>
          Sign out
        </button>
      </div>
    </div>
  );
}
