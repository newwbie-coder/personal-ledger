# Verification checklist

Tracks from the remaining-work plan. Closing-balance snapshots remain a nice-to-have and are **not** required for v1 sellability.

## Credentials (architecture — locked)

| What | Where | Owner |
|------|--------|--------|
| App login (slug + user + password) | `users.password_hash` in **customer workspace** Postgres | Customer |
| JWT | Browser `localStorage` | Signed by API (`JWT_SECRET`) |
| DB Host/Port/User/Pass | Encrypted as `encrypted_database_url` in **Control DB** | Platform |
| License | License service | Platform |

No Supabase Auth. Supabase = Postgres host only.

## 1) Supabase workspace setup

### Local (already proven)

- [x] Session pooler connection (not Direct / IPv6-only `db.*.supabase.co`)
- [x] SSL handled by API (`rejectUnauthorized: false` for cloud hosts)
- [x] Setup wizard: company → license → provider → discrete DB fields → owner
- [x] Migrations apply; default firm created; login with new slug/user works

### Production path (ready now)

| Item | Value |
|------|--------|
| Web | https://ledger-web-ecru.vercel.app |
| Setup | https://ledger-web-ecru.vercel.app/setup |
| API health | https://api-production-fea9.up.railway.app/api/v1/health |
| Fresh license | `LIC-787FC24B` (also in `.license-production.txt`, gitignored) |

**Do on phone or laptop (once):**

1. Open `/setup` on the Vercel URL above.
2. New company + **new** workspace slug.
3. License: `LIC-787FC24B`
4. Connect **customer** Supabase via Session pooler fields (same as local).
5. Create owner → sign in.
6. Smoke: party + opening, one ledger entry, firm switch, openings import.

If the customer DB already has rows from local setup, use a **new username** or truncate app tables first.

Control DB workspaces count starts at `0` until this production setup completes (expected).

## 2) Mobile / PWA

Public HTTPS replaces LAN/ngrok for client testing.

- [x] Production PWA URL (HTTPS)
- [x] API URL baked into web build (`VITE_API_URL`)
- [x] `viewport-fit=cover` + safe-area top/bottom padding
- [x] 16px inputs (avoids iOS zoom-on-focus)
- [x] Bottom nav + firm selector + openings file import in UI
- [ ] Human phone pass: Add to Home Screen, cellular, firm switch, add entry, openings import

## 3) Production deploy

- [x] Control DB = separate Supabase project (Session pooler)
- [x] Railway: API + license (`start-platform.mjs`)
- [x] Vercel: web PWA
- [x] HTTPS both sides
- [x] Production secrets in Railway / `.env.production.local` (not committed)
- [x] `CORS_ORIGIN` locked to `https://ledger-web-ecru.vercel.app`
- [x] Login rate limit (30 / 15 min)

## 4) Hardening / backup guidance

### Customer backup (their workspace DB)

In Supabase: **Project Settings → Database → Backups** (Pro) or periodic `pg_dump` of their project.

Platform never holds ledger rows — if Control DB is lost, customers still have data but must re-register workspace connection (setup again with a new/unused license if needed).

### Platform backup (Control DB)

Back up the small Control Supabase project regularly (workspace metadata + encrypted URIs). Keep `ENCRYPTION_KEY` and `JWT_SECRET` offline — without `ENCRYPTION_KEY`, encrypted DB URLs cannot be decrypted.

### Token strategy

v1 keeps JWT in `localStorage` (PWA-friendly). Cookie/`HttpOnly` is a later upgrade if threat model requires it.
