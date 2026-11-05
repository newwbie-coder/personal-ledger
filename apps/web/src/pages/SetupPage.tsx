import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api, ApiError, downloadJson } from "../lib/api";

type Step = 1 | 2 | 3 | 4;

interface LicenseInfo {
  license_id: string;
  company_name: string;
  max_users: number;
  edition: string;
}

const STEP_TITLE: Record<Step, string> = {
  1: "License",
  2: "Owner account",
  3: "Recovery passphrase",
  4: "Save your recovery kit",
};

export function SetupPage() {
  const navigate = useNavigate();
  const [alreadySetUp, setAlreadySetUp] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [licenseFile, setLicenseFile] = useState<unknown>(null);
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [owner, setOwner] = useState({ name: "", username: "", password: "" });
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [recoveryKit, setRecoveryKit] = useState<unknown>(null);
  const [kitSaved, setKitSaved] = useState(false);

  useEffect(() => {
    api<{ setup_complete: boolean }>("/setup/status")
      .then((s) => setAlreadySetUp(s.setup_complete && step !== 4))
      .catch(() => undefined);
  }, [step]);

  if (alreadySetUp) return <Navigate to="/login" replace />;

  async function onLicenseFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError("");
    setLicense(null);
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const result = await api<{ license: LicenseInfo }>("/setup/license/check", {
        method: "POST",
        body: JSON.stringify({ license: parsed }),
      });
      setLicenseFile(parsed);
      setLicense(result.license);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else if (err instanceof SyntaxError) setError("That file is not a valid license");
      else {
        setError(
          "The browser blocked the connection because it does not trust this box yet. Install ca.crt as a trusted root, restart the browser, then choose the file again.",
        );
      }
    }
  }

  async function finish(e: FormEvent) {
    e.preventDefault();
    if (passphrase !== passphraseConfirm) {
      setError("Passphrases do not match");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{ recovery_kit: unknown }>("/setup/initialize", {
        method: "POST",
        body: JSON.stringify({
          license: licenseFile,
          owner_name: owner.name,
          owner_username: owner.username,
          owner_password: owner.password,
          recovery_passphrase: passphrase,
        }),
      });
      setRecoveryKit(result.recovery_kit);
      setStep(4);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="page">
        <div className="page-head" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Set up this office box</div>
          <h1 className="page-title">{STEP_TITLE[step]}</h1>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
            Step {step} of 4 · Everything stays on this box
          </p>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 4,
                transition: "background 0.3s var(--ease)",
                background:
                  step >= n ? "linear-gradient(90deg, var(--brand), var(--brand-2))" : "var(--line)",
              }}
            />
          ))}
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        {step === 1 ? (
          <div className="card-surface">
            <div className="field">
              <label>License file</label>
              <input type="file" accept=".json,application/json" onChange={(e) => void onLicenseFile(e)} />
              <span className="field-hint">
                The .license.json file you received. It is checked on this box; nothing is sent anywhere.
              </span>
            </div>
            {license ? (
              <div className="success-banner">
                {license.company_name} · up to {license.max_users} users · {license.license_id}
              </div>
            ) : null}
            <button
              className="btn btn-primary btn-block"
              type="button"
              disabled={!license}
              onClick={() => {
                setError("");
                setStep(2);
              }}
            >
              Continue
            </button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="card-surface">
            <div className="field">
              <label>Owner name</label>
              <input value={owner.name} onChange={(e) => setOwner({ ...owner, name: e.target.value })} required />
            </div>
            <div className="field">
              <label>Owner username</label>
              <input
                value={owner.username}
                onChange={(e) => setOwner({ ...owner, username: e.target.value })}
                autoComplete="username"
                minLength={3}
                required
              />
            </div>
            <div className="field">
              <label>Owner password</label>
              <input
                type="password"
                value={owner.password}
                onChange={(e) => setOwner({ ...owner, password: e.target.value })}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <span className="field-hint">At least 8 characters.</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" type="button" onClick={() => setStep(1)}>
                Back
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                type="button"
                disabled={!owner.name || owner.username.length < 3 || owner.password.length < 8}
                onClick={() => {
                  setError("");
                  setStep(3);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <form className="card-surface" onSubmit={finish}>
            <p className="muted" style={{ marginTop: 0, fontSize: 14, lineHeight: 1.55 }}>
              Your books are encrypted with a key that only this box holds. The recovery passphrase
              protects a copy of that key, so you can rebuild on a new machine if this one dies.
              <strong> Nobody, including the app maker, can recover it for you.</strong> Write it down
              and keep it away from the office.
            </p>
            <div className="field">
              <label>Recovery passphrase</label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="new-password"
                minLength={10}
                required
              />
              <span className="field-hint">At least 10 characters. A short sentence works well.</span>
            </div>
            <div className="field">
              <label>Confirm passphrase</label>
              <input
                type="password"
                value={passphraseConfirm}
                onChange={(e) => setPassphraseConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" type="button" onClick={() => setStep(2)}>
                Back
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={busy || passphrase.length < 10}
                type="submit"
              >
                {busy ? "Setting up…" : "Finish setup"}
              </button>
            </div>
          </form>
        ) : null}

        {step === 4 ? (
          <div className="card-surface">
            <div className="success-banner">{license?.company_name} is set up</div>
            <p style={{ marginTop: 0, fontSize: 14, lineHeight: 1.55 }}>
              Download the recovery kit and store it off this box (a USB drive at home, or printed).
              Restoring needs the kit and your recovery passphrase.
            </p>
            <button
              className="btn btn-secondary btn-block"
              type="button"
              onClick={() => {
                downloadJson(recoveryKit, "ledger-recovery-kit.json");
                setKitSaved(true);
              }}
            >
              Download recovery kit
            </button>
            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: 8 }}
              type="button"
              disabled={!kitSaved}
              onClick={() => navigate("/login", { replace: true })}
            >
              Go to sign in
            </button>
          </div>
        ) : null}

        {step < 4 ? (
          <p className="muted" style={{ marginTop: 16, textAlign: "center", fontSize: 14 }}>
            Already set up? <Link to="/login">Sign in</Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
