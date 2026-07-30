# PROJECT SPECIFICATION
Version: 1.3
Status: Locked

---

# Project Name

Collaborative Ledger (PWA)

A collaborative cloud ledger for small businesses.

Not an ERP. Not accounting software.

Purpose: multiple users securely maintain a shared party ledger from anywhere, while each business owns its own data workspace.

---

# Locked Architecture Decision

**One Express API deployment serves many customer-owned Workspaces.**

```
Phone PWA (JWT only)
        ↓
   Express API  (/api/v1)
        ↓
 Control Database (yours — metadata only)
   read encrypted DB URL for workspace
        ↓
 Decrypt → connect with pg driver
        ↓
 Customer PostgreSQL (their data only)
```

### Control Database (platform-owned)

Tiny Postgres you operate. Contains **only** routing metadata:

- workspace_id, slug, company_name, company_uuid
- encrypted_database_url
- license_id, activation_token, status
- created_at, last_license_validation

**Never stores:** parties, ledger entries, balances, or any financial data.

Env: `CONTROL_DATABASE_URL`

### Customer Workspace Database

Owned by the customer (Supabase / Neon / RDS / self-hosted). Holds all business data.

- Browser never sees Host/Password/URI after setup.
- Setup collects discrete fields (Host, Port, Database, Username, Password); API builds the URI.
- No Supabase Auth — Postgres is storage only; auth is bcrypt + JWT.
- Externally: **Workspace**. Counterparties: **Party**.

Alternative rejected for v1: one full app deployment per customer.
---

# Core Philosophy

Extremely simple. Extremely fast. Extremely reliable.

If a feature complicates the product, it probably should not exist.

Feels as easy as a paper ledger.

---

# Product Principles

- One-time purchase.
- Customer owns their Workspace database.
- Developer never stores business ledger data in the platform DB.
- Multi-user, cloud accessible, phone-first PWA.
- Immutable accounting.
- One API, many Workspaces.

---

# Technology Stack

Client
- React, TypeScript, TailwindCSS, Vite, PWA

API
- Node.js, Express, TypeScript
- Mounted under `/api/v1`

License
- Separate Express service (license metadata only)

Database (per Workspace)
- PostgreSQL only (Supabase / Neon / self-hosted as hosts)
- No Supabase-specific APIs in app logic

Platform registry
- **Control Database** (`CONTROL_DATABASE_URL`) — workspace metadata + encrypted DB URL only
- Not used for ledger rows

Monorepo
- `apps/web`, `apps/api`, `apps/license`
- `packages/db`, `packages/shared`

---

# Domain Model

## Workspace (external)

- workspace_id
- slug (used at login)
- company_name
- company_uuid
- license binding
- encrypted_database_url (Control DB only — never returned to client)
- status
- db_provider (supabase | existing | self_hosted)

## Firm

- firm_id
- firm_name
- status (`active` | `archived`)
- created_at

Every mutation belongs to exactly one firm. **Workspace Summary** is read-only aggregate view.

## Party (workspace-global)

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
- encrypted database_url (API-only)

## Party (replaces “Customer”)

- party_id
- party_name
- phone (optional)
- opening_balance
- active (soft delete only)
- created_at (server)

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

---

# Accounting Rules

- No edit. No delete. No manual balance edits.
- Corrections = reverse entry (+ optional new entry).
- Balances computed only on the server (opening + signed entry sum).
- Ledger writes use SQL transactions.
- Never trust client timestamps for `created_at` / entry time.

---

# Security

- Browser: JWT only.
- Passwords: bcrypt.
- Login rate-limited.
- Soft-delete parties (`active = false`) — never hard delete.
- Request logging on every API call.
- License revalidate ~30 days; seats via `maximum_users`.

---

# Setup Wizard (professional flow)

1. Company name + Workspace slug  
2. License key  
3. Where do you want to store your data?  
   - Supabase (Recommended) — with click-by-click guide  
   - Existing PostgreSQL  
   - Self-hosted PostgreSQL  
4. Connect database — **discrete fields only**  
   - Host · Port · Database · Username · Password  
   - Test connection  
   - API builds `postgresql://…` server-side  
5. Create owner  
6. Done  

Never ask non-technical users to paste a raw connection URI in the product UI.

Credentials are POSTed once to the API over HTTPS, encrypted into the Control Database, and never returned to the client.
---

# API Surface

Base: `/api/v1`

- `GET /health` → `{ database, license, version, workspaces }`
- Auth, parties, ledger, dashboard, reports, users, setup

---

# UI (phone-first)

Bottom nav: Home · Parties · Reports · Settings

Dashboard: today’s in/out, outstanding, today’s count. No charts.

---

# Out Of Scope

Inventory, invoices, GST, CRM, ERP, AI, charts, Electron, Capacitor/app stores, mixing ledger data across workspaces.

---

# Success Metrics

- Record a transaction in under 5 seconds on a phone.
- Owner sees outstanding balance in under 10 seconds.

---

# Local Development

1. Copy `.env.example` → `.env` (set `CONTROL_DATABASE_URL`, `ENCRYPTION_KEY`, JWT secrets).
2. Start Postgres: `docker compose up -d` (creates `ledger_control` + `ledger_workspace`).
3. `npm install`
4. `dev.bat` or `npm run dev:license` / `dev:api` / `dev:web`
5. Open http://localhost:5173 → create a Workspace via setup.
6. Demo license: `LIC-DEMO-0001`

For local workspace DB during setup use e.g. host `localhost`, port `5432`, database `ledger_workspace`, user/password `postgres`.