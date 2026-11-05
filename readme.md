# PROJECT SPECIFICATION
Version: 2.0
Status: Locked

---

# Project Name

Collaborative Ledger (PWA)

A shared party ledger for small businesses that runs on a computer in the business's own office.

Not an ERP. Not accounting software.

Purpose: several staff keep one party ledger from their phones, anywhere, while the books never leave the owner's premises and the app maker has no way in.

---

# Locked Architecture Decision

**One box per company, in the company's office. No cloud provider, no vendor server.**

```
Staff phone (PWA)
   │  WireGuard tunnel (encrypted, only enrolled phones)
   ▼
Office router ── forwards UDP 51820 only
   ▼
Office box (Linux or Windows PC)
   ├─ app container: HTTPS API + web app, keys in ./data
   └─ Postgres container: no published port
```

- The box holds the database, the data key, the HTTPS certificate authority and the JWT secret. All are created on the box at first start.
- The app maker issues a signed license file once. The box checks it offline with an embedded public key. There is no phone-home, no expiry, no kill switch.
- Phones reach the box only through WireGuard. Nothing else is exposed to the internet.

See [OFFICE_SETUP.md](OFFICE_SETUP.md) for installing a box.

---

# Core Philosophy

Extremely simple. Extremely fast. Extremely reliable.

If a feature complicates the product, it probably should not exist.

Feels as easy as a paper ledger.

---

# Product Principles

- One-time purchase.
- The customer owns the hardware, the data and every key.
- The app maker cannot read, change, lock or switch off a customer's books.
- Multi-user, reachable from anywhere over the office VPN, phone-first PWA.
- Immutable accounting, provable with a fingerprint chain.

---

# Technology Stack

Client
- React, TypeScript, Vite, PWA

API
- Node.js, Express, TypeScript, mounted under `/api/v1`
- Serves the built web app on the same HTTPS origin

Database
- PostgreSQL 16 on the box (docker compose)

Network
- WireGuard for remote access; HTTPS with the office's own certificate authority

Monorepo
- `apps/web`, `apps/api`
- `packages/db` (migrations), `packages/shared`
- `scripts/license` (vendor-only signing tools), `scripts/wireguard` (box VPN tools)

---

# Domain Model

## Company (one per box)

- company_name, company_uuid
- license (signed file: license_id, max_users, edition)

## Firm

- firm_id
- firm_name
- status (`active` | `archived`)
- created_at

Every mutation belongs to exactly one firm. **Workspace Summary** is read-only aggregate view.

## Party (company-wide)

- party_id, party_name, phone, active
- Opening ledger: `opening_balances` (party + firm required) with balance, effective_date, locked
- Editable only until the first party ledger entry for that firm; then locked
- CSV import supported (`POST /openings/import`)
- Aggregate totals are always **computed** as SUM(firm balances), never stored

## Transfer

- Dedicated `transfers` table (source_firm, destination_firm, amount, status)
- Two linked `ledger_entries` with `entry_kind = transfer`, `party_id NULL` (CHECK-enforced)
- Same-firm transfers rejected
- Reversal reverses both sides atomically

## Ledger Entry

- entry_id
- party_id
- date_time (server-generated)
- type (incoming | outgoing)
- amount
- description
- created_by
- reverse_of_entry
- created_at (server)

## Users / Roles

Owner · Manager · Employee (unchanged permissions)

Owner can reset employee passwords. Employees cannot reset anyone’s.

## Audit Log

- log_id
- actor_user_id
- action
- entity_type
- entity_id
- detail
- ip_address
- device
- created_at (server)

## Chain Log (fingerprint chain)

- seq, table_name, record_id, op, record_digest, prev_hash, hash, created_at
- One link per insert or change to ledger entries, transfers and opening balances

---

# Accounting Rules

- No edit. No delete. No manual balance edits.
- Corrections = reverse entry (+ optional new entry).
- Balances computed only on the server (opening + signed entry sum).
- Ledger writes use SQL transactions.
- Never trust client timestamps for `created_at` / entry time.
- The database itself enforces this: ledger entries and the chain log reject UPDATE and DELETE, a transfer may only change from posted to reversed, and a locked opening balance cannot change.

---

# Security

Network
- The box is not reachable from the internet except through WireGuard (UDP 51820). Postgres has no published port.
- Each phone has its own WireGuard key and a preshared key, and can reach only the box address `10.8.0.1`, not the office LAN.
- A lost phone is cut off with one command (`remove-phone`), and its ledger account can be disabled in Settings.

Transport
- HTTPS on the box, using a certificate authority created on that box. Phones install `ca.crt` once from the box's install page.
- Strict-Transport-Security, no-sniff and frame-deny headers. CORS is off in production (same origin).

Data at rest
- Party names, phones, amounts and descriptions are sealed with AES-256-GCM using a data key generated on the box.
- The data key is copied into a recovery kit encrypted with the owner's recovery passphrase (scrypt + AES-256-GCM). Nobody else can open it.
- Nightly backups are encrypted with the backup passphrase and include the recovery kit, so a backup plus both passphrases rebuilds the company on new hardware.

Integrity
- Every ledger change is linked into a SHA-256 hash chain by database triggers in the same transaction.
- `Verify ledger` (Settings) and the nightly check recompute every link and every record fingerprint.
- Each phone stores the last chain point it saw and re-checks it every few minutes. If history is rolled back or rewritten, the phone shows a red "Ledger history changed" banner, even if someone recomputed all hashes on the box.

Accounts
- Passwords: bcrypt. Login rate-limited. JWT secret generated on the box.
- Every request re-reads the user's role and active flag, so disabling an account takes effect immediately.
- Request logging and an audit log for every mutation.

Honest limits
- Whoever controls the box's operating system (for example, an IT person with admin rights) can read data and can disable triggers. They cannot hide an edit from the chain check or from phones that already saw the record.
- If the box is stolen while running, the data key is on its disk. Use full-disk encryption (BitLocker or LUKS) and a locked room.
- If both the box and every backup are lost, or the recovery passphrase is forgotten, the books are gone. No one, including the app maker, can recover them.

---

# Setup Wizard

1. Upload the license file (checked on the box, nothing sent anywhere).
2. Create the owner account.
3. Choose a recovery passphrase (entered twice).
4. Download the recovery kit and store it off the box.

---

# Where secrets live

| What | Where | Who can use it |
|------|-------|----------------|
| Staff passwords | bcrypt hashes in the box's `users` table | Nobody can reverse them |
| Session tokens | Phone `localStorage`, signed with `data/keys/jwt.secret` | The box |
| Data key | `data/keys/workspace.key` on the box | The box |
| Recovery kit | `data/keys/recovery-kit.json` plus the owner's downloaded copy | Only with the recovery passphrase |
| HTTPS CA key | `data/tls/ca.key` on the box | The box |
| WireGuard keys | `/etc/wireguard` or `C:\ProgramData\LedgerBox\wireguard` on the box; each phone holds its own | Box and that phone |
| License signing key | The app maker's PC only (`~/.ledger-vendor`) | App maker, to issue new license files |

---

# API Surface

Base: `/api/v1`

- `GET /health` → `{ database, setup_complete, chain, chain_checked_at, version }`
- `setup`, `auth`, `users`, `firms`, `parties`, `openings`, `ledger`, `transfers`, `dashboard`, `reports`, `notifications`
- `chain`: `GET /head`, `GET /check?seq&hash`, `GET /report`, `POST /verify`
- `box`: `GET /recovery-kit`

Box commands (inside the app container): `node apps/api/dist/box-cli.js migrate | backup | restore <file> | verify-chain | qr`

---

# UI (phone-first)

Bottom nav: Home · Parties · Reports · Settings

Dashboard: today’s in/out, outstanding, today’s count. No charts.

Balance-only mode: one screen with the available balance and an "Open app" button, switchable from Settings or Account.

---

# Out Of Scope

Inventory, invoices, GST, CRM, ERP, AI, charts, Electron, Capacitor/app stores, cloud hosting.

---

# Success Metrics

- Record a transaction in under 5 seconds on a phone.
- Owner sees outstanding balance in under 10 seconds.

---

# Local Development

1. `npm install`
2. Copy `.env.example` → `.env` and uncomment the development block (`DATABASE_URL`, `CORS_ORIGIN`, `VITE_API_URL`).
3. `dev.bat` (embedded Postgres on 54329, API on 4000, web on 5173), or run `npm run demo:pg -w @ledger/api`, `npm run dev:api`, `npm run dev:web` separately.
4. Issue a test license: `npm run license:issue -- --company "Test Co" --users 5 --out test.license.json` (run `npm run license:keygen` once first).
5. Open http://localhost:5173 and upload the license in setup.
