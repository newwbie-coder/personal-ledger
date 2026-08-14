# Move database (cutover)

Ledger rows are **ciphertext** sealed with a license-bound workspace key. The key lives on the **Control DB** (`wrapped_data_key`), not in the customer database. Copying the customer DB keeps ciphertext intact — you do **not** need a new license.

Assisted moves by the vendor team are **chargeable** when self-serve is impractical.

## Prerequisites

1. Owner account in the app.
2. Encryption already initialized:
   - New workspaces: created at setup.
   - Older plaintext workspaces: Settings → **Seal / migrate encryption** (or `POST /api/v1/workspace/encrypt-migrate`).
3. Empty (or freshly restored) target Postgres reachable from the API (Session pooler for Supabase).

## Self-serve checklist

1. **Dump source** (from a machine that can reach the old DB):

```bash
pg_dump --format=custom --no-owner --no-acl "$OLD_DATABASE_URL" -f workspace.dump
```

2. **Restore to target**:

```bash
pg_restore --clean --if-exists --no-owner --no-acl -d "$NEW_DATABASE_URL" workspace.dump
```

3. In the app: **Settings → Move database**
   - Enter new Host / Port / Database / Username / Password
   - **Test**
   - **Attach database**

4. Sign out and sign in. Confirm parties, balances, and a new entry.

5. Keep the old DB until you are sure, then decommission it. The app does **not** auto-wipe the old host.

## Team-assisted (chargeable)

Platform admin (uses `x-admin-secret`):

```http
POST /api/v1/admin/workspaces/:workspace_id/encrypt-migrate
POST /api/v1/admin/workspaces/:workspace_id/swap-db
Content-Type: application/json

{
  "host": "...",
  "port": 5432,
  "database": "postgres",
  "username": "postgres.ref",
  "password": "...",
  "db_provider": "supabase"
}
```

Same dump/restore steps; swap only updates the encrypted connection URL and keeps `wrapped_data_key`.

## What does not change

- License ID / activation (still one company)
- Wrapped DEK on Control DB
- User logins (still in the customer DB `users` table — copied with the dump)

## What must never be lost

- Control DB row for the workspace
- `DATA_KEY_SECRET` and `ENCRYPTION_KEY` on the API
- License `activation_token` binding
