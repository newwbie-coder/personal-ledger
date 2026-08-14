# Deploy for phone access (Vercel + Railway)

**Live (current)**

| Piece | URL |
|-------|-----|
| Phone / PWA | https://ledger-web-ecru.vercel.app |
| Setup wizard | https://ledger-web-ecru.vercel.app/setup |
| API | https://api-production-fea9.up.railway.app |
| Health | https://api-production-fea9.up.railway.app/api/v1/health |

Production license for first cloud workspace: see `.license-production.txt` or `VERIFICATION.md`.

```
Phone  →  Vercel (web PWA)
Phone  →  Railway (API + license)
Railway → Control Postgres (Supabase)
Railway → Customer workspace Postgres (customer Supabase)
```

Local Wi‑Fi hosting is optional. This is the real path.

See also: [VERIFICATION.md](VERIFICATION.md) for credentials model + checklist.

---

## Before you start

1. Accounts: [Railway](https://railway.app) + [Vercel](https://vercel.com) (GitHub login is easiest).
2. Install Git for Windows if missing: https://git-scm.com/download/win
3. Push this repo to GitHub (optional — CLI deploy also works).

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

1. New Railway project → deploy from this repo (or `railway up`).
2. Root directory: repo root (where `railway.json` lives).
3. Railway uses `railway.json` / `scripts/start-platform.mjs`.
4. Generate a public domain for the service.

### Railway variables

```env
CONTROL_DATABASE_URL=postgresql://postgres.YOUR_REF:PASSWORD@aws-….pooler.supabase.com:5432/postgres
JWT_SECRET=long-random-string
ENCRYPTION_KEY=another-long-random-string
LICENSE_SERVER_SECRET=…
LICENSE_ADMIN_SECRET=…
LICENSE_PORT=4100
CORS_ORIGIN=https://ledger-web-ecru.vercel.app
```

Issue a fresh license after the service is live (from your PC):

```powershell
$secret = (Get-Content .env.production.local | Where-Object { $_ -like "LICENSE_ADMIN_SECRET=*" }).Substring(22)
Invoke-RestMethod -Uri "https://api-production-fea9.up.railway.app/api/v1/setup/issue-license" `
  -Method POST `
  -Headers @{ "x-admin-secret" = $secret; "Content-Type" = "application/json" } `
  -Body '{"maximum_users":10,"edition":"standard"}'
```

Copy the returned `license_id` into `/setup` on Vercel.

---

## 3) Vercel — web PWA

Root: monorepo (`vercel.json` at repo root).

```env
VITE_API_URL=https://api-production-fea9.up.railway.app
```

**No trailing slash.** Redeploy after changing this (Vite bakes it in at build time).

---

## 4) First production workspace

1. Open https://ledger-web-ecru.vercel.app/setup
2. New company + new slug
3. Paste a **new** unused license ID
4. Connect customer Supabase (Session pooler fields — same as local)
5. Create owner account
6. Sign in on phone → browser menu → **Add to Home Screen**

If customer Supabase already has users from local setup, use a **new username** or truncate app tables first.

---

## 5) Phone checklist

- [x] Health OK on Railway
- [ ] Login works on Vercel URL (after production `/setup`)
- [ ] Firm selector + add entry
- [ ] Add to Home Screen
- [ ] Works off Wi‑Fi (cellular)

---

## Customer backup (short)

- Workspace data: customer backs up **their** Supabase project (`pg_dump` or Supabase backups).
- Control DB: you back up the small platform Supabase project + keep `ENCRYPTION_KEY` safe offline.

---

## Quick secrets generator (PowerShell)

```powershell
-join ((48..57 + 65..90 + 97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
```

Run twice for `JWT_SECRET` and `ENCRYPTION_KEY`.
