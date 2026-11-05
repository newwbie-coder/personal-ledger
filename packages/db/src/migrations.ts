export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS companies (
  company_uuid UUID PRIMARY KEY,
  company_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'employee')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  customer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL,
  phone TEXT,
  opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(customer_id),
  date_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type TEXT NOT NULL CHECK (type IN ('incoming', 'outgoing')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(user_id),
  reverse_of_entry UUID REFERENCES ledger_entries(entry_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_metadata (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_uuid UUID NOT NULL REFERENCES companies(company_uuid),
  schema_version INTEGER NOT NULL,
  license_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(user_id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (LOWER(customer_name));
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers (active);
CREATE INDEX IF NOT EXISTS idx_ledger_customer ON ledger_entries (customer_id, date_time DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger_entries (date_time DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_type_date ON ledger_entries (type, date_time);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);
`,
  },
  {
    version: 2,
    name: "parties_and_audit_enrichment",
    sql: `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customers'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'parties'
  ) THEN
    ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_customer_id_fkey;
    ALTER TABLE customers RENAME TO parties;
    ALTER TABLE parties RENAME COLUMN customer_id TO party_id;
    ALTER TABLE parties RENAME COLUMN customer_name TO party_name;
    ALTER TABLE ledger_entries RENAME COLUMN customer_id TO party_id;
    ALTER TABLE ledger_entries
      ADD CONSTRAINT ledger_entries_party_id_fkey
      FOREIGN KEY (party_id) REFERENCES parties(party_id);
  END IF;
END $$;

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS device TEXT;

DROP INDEX IF EXISTS idx_customers_name;
DROP INDEX IF EXISTS idx_customers_active;
DROP INDEX IF EXISTS idx_ledger_customer;

CREATE INDEX IF NOT EXISTS idx_parties_name ON parties (LOWER(party_name));
CREATE INDEX IF NOT EXISTS idx_parties_active ON parties (active);
CREATE INDEX IF NOT EXISTS idx_ledger_party ON ledger_entries (party_id, date_time DESC);

UPDATE app_metadata SET schema_version = 2 WHERE id = 1;
`,
  },
  {
    version: 3,
    name: "firms_transfers_and_snapshots",
    sql: `
CREATE TABLE IF NOT EXISTS firms (
  firm_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS party_firm_opening_balances (
  party_id UUID NOT NULL REFERENCES parties(party_id),
  firm_id UUID NOT NULL REFERENCES firms(firm_id),
  opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (party_id, firm_id)
);

CREATE TABLE IF NOT EXISTS transfers (
  transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_firm_id UUID NOT NULL REFERENCES firms(firm_id),
  destination_firm_id UUID NOT NULL REFERENCES firms(firm_id),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(user_id),
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transfers_different_firms CHECK (source_firm_id <> destination_firm_id)
);

CREATE TABLE IF NOT EXISTS firm_closing_snapshots (
  firm_id UUID NOT NULL REFERENCES firms(firm_id),
  snapshot_date DATE NOT NULL,
  party_outstanding NUMERIC(14, 2) NOT NULL DEFAULT 0,
  transfer_net NUMERIC(14, 2) NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (firm_id, snapshot_date)
);

-- Default firm for existing workspaces
INSERT INTO firms (firm_id, firm_name, status)
SELECT gen_random_uuid(), 'Main Firm', 'active'
WHERE NOT EXISTS (SELECT 1 FROM firms);

-- Move legacy opening balances onto the default firm
INSERT INTO party_firm_opening_balances (party_id, firm_id, opening_balance)
SELECT p.party_id, f.firm_id, COALESCE(p.opening_balance, 0)
FROM parties p
CROSS JOIN LATERAL (SELECT firm_id FROM firms ORDER BY created_at ASC LIMIT 1) f
ON CONFLICT (party_id, firm_id) DO NOTHING;

-- Firm-scoped ledger columns
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS firm_id UUID REFERENCES firms(firm_id);
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS entry_kind TEXT;
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS transfer_id UUID REFERENCES transfers(transfer_id);

UPDATE ledger_entries
SET firm_id = (SELECT firm_id FROM firms ORDER BY created_at ASC LIMIT 1)
WHERE firm_id IS NULL;

UPDATE ledger_entries
SET entry_kind = 'party'
WHERE entry_kind IS NULL;

ALTER TABLE ledger_entries ALTER COLUMN firm_id SET NOT NULL;
ALTER TABLE ledger_entries ALTER COLUMN entry_kind SET NOT NULL;

-- Allow NULL party only for transfers; party entries must have a party
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_party_id_fkey;
ALTER TABLE ledger_entries ALTER COLUMN party_id DROP NOT NULL;
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_party_id_fkey
  FOREIGN KEY (party_id) REFERENCES parties(party_id);

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_kind_check;
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_entry_kind_check
  CHECK (entry_kind IN ('party', 'transfer'));

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_party_kind_check;
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_party_kind_check
  CHECK (
    (entry_kind = 'party' AND party_id IS NOT NULL AND transfer_id IS NULL)
    OR
    (entry_kind = 'transfer' AND party_id IS NULL AND transfer_id IS NOT NULL)
  );

-- opening_balance on parties is legacy; keep column but stop using it for new logic
CREATE INDEX IF NOT EXISTS idx_firms_status ON firms (status);
CREATE INDEX IF NOT EXISTS idx_ledger_firm_date ON ledger_entries (firm_id, date_time DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_party_firm ON ledger_entries (party_id, firm_id, date_time DESC)
  WHERE party_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_transfer ON ledger_entries (transfer_id)
  WHERE transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transfers_created ON transfers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_party_firm_openings ON party_firm_opening_balances (firm_id);

UPDATE app_metadata SET schema_version = 3 WHERE id = 1;
`,
  },
  {
    version: 4,
    name: "opening_balances_ledger",
    sql: `
CREATE TABLE IF NOT EXISTS opening_balances (
  opening_balance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES parties(party_id),
  firm_id UUID NOT NULL REFERENCES firms(firm_id),
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (party_id, firm_id)
);

-- Migrate from party_firm_opening_balances
INSERT INTO opening_balances (party_id, firm_id, balance, effective_date, locked)
SELECT
  pfo.party_id,
  pfo.firm_id,
  pfo.opening_balance,
  COALESCE(pfo.created_at::date, CURRENT_DATE),
  EXISTS (
    SELECT 1 FROM ledger_entries e
    WHERE e.party_id = pfo.party_id
      AND e.firm_id = pfo.firm_id
      AND e.entry_kind = 'party'
  )
FROM party_firm_opening_balances pfo
ON CONFLICT (party_id, firm_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_opening_balances_firm ON opening_balances (firm_id);
CREATE INDEX IF NOT EXISTS idx_opening_balances_party ON opening_balances (party_id);
CREATE INDEX IF NOT EXISTS idx_opening_balances_locked ON opening_balances (locked);

UPDATE app_metadata SET schema_version = 4 WHERE id = 1;
`,
  },
  {
    version: 5,
    name: "envelope_ciphertext_columns",
    sql: `
-- Drop numeric CHECKs before converting amounts to text ciphertext.
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_amount_check;
ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_amount_check;

-- Store sealed fields as text (v2field:…). Legacy NUMERIC values remain readable until migrate.
ALTER TABLE parties ALTER COLUMN party_name TYPE TEXT USING party_name::text;
ALTER TABLE parties ALTER COLUMN phone TYPE TEXT USING phone::text;

ALTER TABLE ledger_entries ALTER COLUMN amount TYPE TEXT USING amount::text;
ALTER TABLE ledger_entries ALTER COLUMN description TYPE TEXT USING description::text;

ALTER TABLE opening_balances ALTER COLUMN balance TYPE TEXT USING balance::text;

ALTER TABLE transfers ALTER COLUMN amount TYPE TEXT USING amount::text;
ALTER TABLE transfers ALTER COLUMN description TYPE TEXT USING COALESCE(description, '')::text;

ALTER TABLE app_metadata ADD COLUMN IF NOT EXISTS encryption TEXT;
UPDATE app_metadata SET encryption = COALESCE(encryption, 'none') WHERE id = 1;

UPDATE app_metadata SET schema_version = 5 WHERE id = 1;
`,
  },
  {
    version: 6,
    name: "roles_pin_notifications",
    sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_firm_id UUID REFERENCES firms(firm_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT;

CREATE TABLE IF NOT EXISTS notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  entity_type TEXT,
  entity_id TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_assigned_firm ON users (assigned_firm_id);

UPDATE app_metadata SET schema_version = 6 WHERE id = 1;
`,
  },
  {
    version: 7,
    name: "fingerprint_chain",
    sql: `
CREATE TABLE IF NOT EXISTS chain_log (
  seq BIGINT PRIMARY KEY,
  record_table TEXT NOT NULL,
  record_id UUID NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('backfill', 'insert', 'update', 'delete')),
  record_digest TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chain_record ON chain_log (record_table, record_id, seq DESC);

-- Fixed column list per table so later schema additions do not change old digests.
CREATE OR REPLACE FUNCTION chain_row_digest(tbl TEXT, r JSONB) RETURNS TEXT
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  cols TEXT[];
  picked JSONB := '{}'::jsonb;
  c TEXT;
BEGIN
  cols := CASE tbl
    WHEN 'ledger_entries' THEN ARRAY['entry_id','firm_id','party_id','entry_kind','date_time','type','amount','description','created_by','reverse_of_entry','transfer_id','created_at']
    WHEN 'transfers' THEN ARRAY['transfer_id','source_firm_id','destination_firm_id','amount','description','created_by','status','created_at']
    WHEN 'opening_balances' THEN ARRAY['opening_balance_id','party_id','firm_id','balance','effective_date','created_by','created_at','locked']
  END;
  IF cols IS NULL THEN
    RAISE EXCEPTION 'chain: unknown table %', tbl;
  END IF;
  FOREACH c IN ARRAY cols LOOP
    picked := picked || jsonb_build_object(c, r -> c);
  END LOOP;
  RETURN encode(sha256(convert_to(picked::text, 'UTF8')), 'hex');
END
$fn$;

CREATE OR REPLACE FUNCTION chain_append(tbl TEXT, rid UUID, op TEXT, d TEXT) RETURNS VOID
LANGUAGE plpgsql AS $fn$
DECLARE
  last_seq BIGINT;
  last_hash TEXT;
  new_seq BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(7413001);
  SELECT seq, hash INTO last_seq, last_hash FROM chain_log ORDER BY seq DESC LIMIT 1;
  IF last_seq IS NULL THEN
    last_seq := 0;
    last_hash := repeat('0', 64);
  END IF;
  new_seq := last_seq + 1;
  INSERT INTO chain_log (seq, record_table, record_id, op, record_digest, prev_hash, hash)
  VALUES (
    new_seq, tbl, rid, op, d, last_hash,
    encode(sha256(convert_to(
      new_seq::text || '|' || last_hash || '|' || tbl || '|' || rid::text || '|' || op || '|' || d,
      'UTF8')), 'hex')
  );
END
$fn$;

-- TimeZone is pinned so timestamps always serialize the same way.
CREATE OR REPLACE FUNCTION chain_track() RETURNS TRIGGER
LANGUAGE plpgsql SET TimeZone = 'UTC' AS $fn$
DECLARE
  pk TEXT := TG_ARGV[0];
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM chain_append(TG_TABLE_NAME, (to_jsonb(OLD) ->> pk)::uuid, 'delete', 'deleted');
    RETURN OLD;
  END IF;
  PERFORM chain_append(
    TG_TABLE_NAME,
    (to_jsonb(NEW) ->> pk)::uuid,
    lower(TG_OP),
    chain_row_digest(TG_TABLE_NAME, to_jsonb(NEW))
  );
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION chain_reject_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION '% rows cannot be changed or deleted', TG_TABLE_NAME;
END
$fn$;

CREATE OR REPLACE FUNCTION chain_guard_transfer() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transfers cannot be deleted';
  END IF;
  IF OLD.status <> 'posted' OR NEW.status <> 'reversed'
     OR (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'a transfer can only be marked reversed';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION chain_guard_opening() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'opening balances cannot be deleted';
  END IF;
  IF OLD.locked THEN
    RAISE EXCEPTION 'opening balance is locked';
  END IF;
  RETURN NEW;
END
$fn$;

SET LOCAL TimeZone = 'UTC';
DO $do$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (
      SELECT 'opening_balances'::text AS tbl, o.opening_balance_id AS rid, to_jsonb(o) AS j, o.created_at
      FROM opening_balances o
      UNION ALL
      SELECT 'transfers', t.transfer_id, to_jsonb(t), t.created_at FROM transfers t
      UNION ALL
      SELECT 'ledger_entries', e.entry_id, to_jsonb(e), e.created_at FROM ledger_entries e
    ) rows_to_chain
    ORDER BY created_at, rid
  LOOP
    PERFORM chain_append(rec.tbl, rec.rid, 'backfill', chain_row_digest(rec.tbl, rec.j));
  END LOOP;
END
$do$;

DROP TRIGGER IF EXISTS ledger_entries_immutable ON ledger_entries;
CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION chain_reject_change();

DROP TRIGGER IF EXISTS chain_log_immutable ON chain_log;
CREATE TRIGGER chain_log_immutable
  BEFORE UPDATE OR DELETE ON chain_log
  FOR EACH ROW EXECUTE FUNCTION chain_reject_change();

DROP TRIGGER IF EXISTS ledger_entries_chain ON ledger_entries;
CREATE TRIGGER ledger_entries_chain
  AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION chain_track('entry_id');

DROP TRIGGER IF EXISTS transfers_chain ON transfers;
CREATE TRIGGER transfers_chain
  AFTER INSERT OR UPDATE OR DELETE ON transfers
  FOR EACH ROW EXECUTE FUNCTION chain_track('transfer_id');

DROP TRIGGER IF EXISTS transfers_guard ON transfers;
CREATE TRIGGER transfers_guard
  BEFORE UPDATE OR DELETE ON transfers
  FOR EACH ROW EXECUTE FUNCTION chain_guard_transfer();

DROP TRIGGER IF EXISTS opening_balances_guard ON opening_balances;
CREATE TRIGGER opening_balances_guard
  BEFORE UPDATE OR DELETE ON opening_balances
  FOR EACH ROW EXECUTE FUNCTION chain_guard_opening();

DROP TRIGGER IF EXISTS opening_balances_chain ON opening_balances;
CREATE TRIGGER opening_balances_chain
  AFTER INSERT OR UPDATE OR DELETE ON opening_balances
  FOR EACH ROW EXECUTE FUNCTION chain_track('opening_balance_id');

ALTER TABLE app_metadata ADD COLUMN IF NOT EXISTS license JSONB;

UPDATE app_metadata SET schema_version = 7 WHERE id = 1;
`,
  },
];
