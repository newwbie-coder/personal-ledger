import { type ReactNode, useEffect, useState } from "react";
import { useAuth } from "../auth";
import { api } from "../lib/api";

const CHECKPOINT_KEY = "ledger_chain_checkpoint";
const ALERT_KEY = "ledger_chain_alert";
const INTERVAL_MS = 5 * 60 * 1000;

interface Head {
  seq: number;
  hash: string;
}

function readCheckpoint(): Head | null {
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY);
    return raw ? (JSON.parse(raw) as Head) : null;
  } catch {
    return null;
  }
}

/**
 * Each phone keeps the last chain point it saw. If that point later disappears or changes,
 * the box's history was rewritten, even if someone recomputed every fingerprint.
 */
export function ChainGuard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [alert, setAlert] = useState(() => localStorage.getItem(ALERT_KEY) === "1");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (localStorage.getItem(ALERT_KEY) === "1") return;
      try {
        const saved = readCheckpoint();
        if (saved) {
          const r = await api<{ ok: boolean; head: Head }>(
            `/chain/check?seq=${saved.seq}&hash=${saved.hash}`,
          );
          if (cancelled) return;
          if (!r.ok) {
            localStorage.setItem(ALERT_KEY, "1");
            setAlert(true);
            return;
          }
          localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(r.head));
        } else {
          const r = await api<{ head: Head }>("/chain/head");
          if (!cancelled) localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(r.head));
        }
      } catch {
        // Offline or box unreachable: try again on the next tick.
      }
    }

    void check();
    const timer = setInterval(() => void check(), INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user?.user_id]);

  function acknowledge() {
    localStorage.removeItem(ALERT_KEY);
    localStorage.removeItem(CHECKPOINT_KEY);
    setAlert(false);
  }

  return (
    <>
      {alert ? (
        <div className="chain-alert" role="alert">
          <strong>Ledger history changed.</strong> Records this phone already saw on the box are
          different or gone. Tell the owner before trusting any balance.
          {user?.role === "owner" ? (
            <button className="btn btn-secondary btn-sm" type="button" onClick={acknowledge}>
              I have checked this. Reset this phone.
            </button>
          ) : null}
        </div>
      ) : null}
      {children}
    </>
  );
}
