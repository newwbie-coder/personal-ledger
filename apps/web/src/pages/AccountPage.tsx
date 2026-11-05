import { FormEvent, useState } from "react";
import { BottomNav } from "../components/BottomNav";
import { useAuth } from "../auth";
import { api, ApiError } from "../lib/api";
import { useViewMode } from "../view-mode";

export function AccountPage() {
  const { user, logout, setUserPinFlag } = useAuth();
  const { showBalance } = useViewMode();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function changePin(e: FormEvent) {
    e.preventDefault();
    if (pin !== confirm) {
      setError("PINs do not match");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api("/auth/pin/set", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      setUserPinFlag(true);
      setPin("");
      setConfirm("");
      setSuccess("PIN updated");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update PIN");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="page">
        <div className="page-head">
          <div className="eyebrow">Profile</div>
          <h1 className="page-title">Account</h1>
        </div>
        <div className="card-surface">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div className="row-title" style={{ fontSize: 17 }}>{user?.name}</div>
              <div className="row-sub">{user?.username}</div>
            </div>
            <span className="badge badge-accent">{user?.role}</span>
          </div>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 14 }} type="button" onClick={showBalance}>
            Show balance only
          </button>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }} type="button" onClick={logout}>
            Sign out
          </button>
        </div>

        <div className="section-title" style={{ marginTop: 18 }}>App PIN</div>
        <form className="card-surface" onSubmit={changePin}>
          <p className="muted" style={{ marginTop: 0, fontSize: 13, lineHeight: 1.5 }}>
            Required when you return to the app from the background.
            {user?.has_pin ? " Change it below anytime." : " Set a 4–6 digit PIN."}
          </p>
          {error ? <div className="error-banner">{error}</div> : null}
          {success ? <div className="success-banner">{success}</div> : null}
          <div className="field">
            <label>New PIN</label>
            <input
              className="pin-input"
              type="password"
              inputMode="numeric"
              pattern="\d{4,6}"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
          </div>
          <div className="field">
            <label>Confirm</label>
            <input
              className="pin-input"
              type="password"
              inputMode="numeric"
              pattern="\d{4,6}"
              maxLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
          </div>
          <button className="btn btn-primary btn-block" disabled={busy || pin.length < 4} type="submit">
            {busy ? "Saving…" : user?.has_pin ? "Update PIN" : "Set PIN"}
          </button>
        </form>
      </div>
      <BottomNav />
    </div>
  );
}
