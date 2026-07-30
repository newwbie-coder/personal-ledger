# Deploy for phone access (Vercel + Railway)

Goal: client opens a public HTTPS URL on their phone and can install the PWA.

```
Phone  →  Vercel (web PWA)
Phone  →  Railway (API + license)
Railway → Control Postgres (Supabase)
Railway → Customer workspace Postgres (your existing Supabase)
```

Local Wi‑Fi hosting is optional. This is the real path.

---

## Before you start

1. Accounts: [Railway](https://railway.app) + [Vercel](https://vercel.com) (GitHub login is easiest).
2. Install Git for Windows if missing: https://git-scm.com/download/win
3. Push this repo to GitHub (Railway/Vercel deploy from Git).

---

## 1) Control database (platform registry)

Create a **separate** Supabase project (or a second DB) named something like `ledger-control`.

In Supabase → **Connect → Session pooler**, copy the URI.

Use that as `CONTROL_DATABASE_URL` on Railway.

Tables are auto-created on API start (`workspaces` only).

**Important:** Your existing customer workspace stays in the other Supabase project. Control DB never holds parties/ledger rows.

Local workspace registrations do **not** copy to cloud. After deploy, run **Setup** once against the production URL (new license + same or fresh workspace DB).

---

## 2) Railway — API + license

1. New Railway project → **Deploy from GitHub** → this repo.
2. Root directory: repo root (where `railway.json` lives).
3. Railway uses `railway.json` (`build:platform` + `start-platform.mjs`).
4. Generate a public domain for the service (Settings → Networking → Generate Domain).  
   Example: `https://ledger-api-production.up.railway.app`

### Railway variables

```env
CONTROL_DATABASE_URL=postgresql://postgres.YOUR_REF:PASSWORD@aws-0-….pooler.supabase.com:5432/postgres
JWT_SECRET=long-random-string
ENCRYPTION_KEY=another-long-random-string
LICENSE_SERVER_SECRET=dev-license-secret
LICENSE_ADMIN_SECRET=dev-admin-secret
LICENSE_PORT=4100
CORS_ORIGIN=https://YOUR_VERCEL_APP.vercel.app
```

After Vercel gives you the URL, set `CORS_ORIGIN` to that exact origin (comma-separated if you have preview + production).

Issue a fresh license after the service is live (from your PC):

```powershell
Invoke-RestMethod -Uri "https://YOUR_RAILWAY_DOMAIN/api/v1/setup/issue-license" `
  -Method POST `
  -Headers @{ "x-admin-secret" = "YOUR_LICENSE_ADMIN_SECRET"; "Content-Type" = "application/json" } `
  -Body '{"maximum_users":10,"edition":"standard"}'
```

Copy the returned `license_id` into `/setup` on Vercel.

Health check: `https://YOUR_RAILWAY_DOMAIN/api/v1/health`

---

## 3) Vercel — web PWA

1. New Vercel project → import same GitHub repo.
2. **Root Directory:** `apps/web`
3. Framework: Vite (auto).
4. Build command: `cd ../.. && npm install && npm run build -w @ledger/web`
5. Output directory: `dist`
6. Install command: `cd ../.. && npm install` (or leave default if Vercel monorepo detects workspaces)

### Vercel env

```env
VITE_API_URL=https://YOUR_RAILWAY_DOMAIN
```

**No trailing slash.** Redeploy after changing this (Vite bakes it in at build time).

---

## 4) First production workspace

1. Open `https://YOUR_VERCEL_APP.vercel.app/setup`
2. New company + new slug
3. Paste a **new** unused license ID
4. Connect customer Supabase (Session pooler fields — same as local)
5. Create owner account
6. Sign in on phone → browser menu → **Add to Home Screen**

If customer Supabase already has users from local setup, use a **new username** or truncate app tables first.

---

## 5) Phone checklist

- [ ] Health OK on Railway
- [ ] Login works on Vercel URL
- [ ] Firm selector + add entry
- [ ] Add to Home Screen
- [ ] Works off Wi‑Fi (cellular)

---

## Quick secrets generator (PowerShell)

```powershell
-join ((48..57 + 65..90 + 97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
```

Run twice for `JWT_SECRET` and `ENCRYPTION_KEY`.
