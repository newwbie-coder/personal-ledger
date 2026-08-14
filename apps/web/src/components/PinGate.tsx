import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../auth";
import { api, ApiError } from "../lib/api";

/**
 * Bank-style PIN gate:
 * - Require a 4–6 digit PIN if none is set
 * - Lock again when the app returns from background / is restored
 */
export function PinGate({ children }: { children: ReactNode }) {
  const { user, setUserPinFlag } = useAuth();
  const [locked, setLocked] = useState(() => {
    if (!user?.has_pin) return false;
    return sessionStorage.getItem("ledger_pin_unlocked") !== "1";
  });
  const [needsSetup, setNeedsSetup] = useState(() => Boolean(user && !user.has_pin));
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) {
      setLocked(false);
      setNeedsSetup(false);
      return;
    }
    setNeedsSetup(!user.has_pin);
    if (user.has_pin) {
      setLocked(sessionStorage.getItem("ledger_pin_unlocked") !== "1");
    } else {
      setLocked(false);
    }
  }, [user?.user_id, user?.has_pin]);

  useEffect(() => {
    if (!user?.has_pin) return;

    const lock = () => {
      sessionStorage.removeItem("ledger_pin_unlocked");
      setLocked(true);
      setPin("");
      setError("");
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") lock();
    };
    const onPageHide = () => lock();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [user?.has_pin, user?.user_id]);

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/pin/verify", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      sessionStorage.setItem("ledger_pin_unlocked", "1");
      setLocked(false);
      setPin("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Wrong PIN");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  async function setup(e: FormEvent) {
    e.preventDefault();
    if (pin !== confirm) {
      setError("PINs do not match");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/auth/pin/set", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      setUserPinFlag(true);
      sessionStorage.setItem("ledger_pin_unlocked", "1");
      setNeedsSetup(false);
      setLocked(false);
      setPin("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not set PIN");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return children;

  if (needsSetup) {
    return (
      <div className="pin-gate">
        <form className="pin-card" onSubmit={setup}>
          <div className="eyebrow">Security</div>
          <h1 className="page-title" style={{ fontSize: 28 }}>Set your PIN</h1>
          <p className="muted" style={{ marginTop: 6, fontSize: 14, lineHeight: 1.5 }}>
            Choose a 4–6 digit PIN. You’ll need it when returning to the app.
          </p>
          {error ? <div className="error-banner">{error}</div> : null}
          <div className="field">
            <label>PIN</label>
            <input
              className="pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              pattern="\d{4,6}"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              autoFocus
            />
          </div>
          <div className="field">
            <label>Confirm PIN</label>
            <input
              className="pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              pattern="\d{4,6}"
              maxLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
          </div>
          <button
            className="btn btn-primary btn-block"
            type="submit"
            disabled={busy || pin.length < 4}
          >
            {busy ? "Saving…" : "Save PIN"}
          </button>
        </form>
      </div>
    );
  }

  if (locked) {
    return (
      <div className="pin-gate">
        <form className="pin-card" onSubmit={verify}>
          <div className="eyebrow">Locked</div>
          <h1 className="page-title" style={{ fontSize: 28 }}>Enter PIN</h1>
          <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
            Hi {user.name.split(" ")[0]} — unlock to continue
          </p>
          {error ? <div className="error-banner">{error}</div> : null}
          <div className="field">
            <label>PIN</label>
            <input
              className="pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{4,6}"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              autoFocus
            />
          </div>
          <button
            className="btn btn-primary btn-block"
            type="submit"
            disabled={busy || pin.length < 4}
          >
            {busy ? "Checking…" : "Unlock"}
          </button>
        </form>
      </div>
    );
  }

  return children;
}
