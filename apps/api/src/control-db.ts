import pg from "pg";
import { pgPoolOptions } from "./db-url.js";

const { Pool } = pg;

let controlPool: pg.Pool | null = null;

export function getControlDatabaseUrl(): string {
  const url =
    process.env.CONTROL_DATABASE_URL ??
    process.env.PLATFORM_DATABASE_URL ??
    "";
  if (!url) {
    throw new Error(
      "CONTROL_DATABASE_URL is required. This is your tiny platform database (workspace metadata only).",
    );
  }
  return url;
}

export function getControlPool(): pg.Pool {
  if (controlPool) return controlPool;
  const connectionString = getControlDatabaseUrl();
  controlPool = new Pool(
    pgPoolOptions(connectionString, undefined, { max: 5 }) as pg.PoolConfig,
  );
  return controlPool;
}

export async function ensureControlSchema(): Promise<void> {
  const pool = getControlPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      workspace_id UUID PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      company_name TEXT NOT NULL,
      company_uuid UUID NOT NULL UNIQUE,
      encrypted_database_url TEXT NOT NULL,
      license_id TEXT NOT NULL,
      activation_token TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'revoked')),
      db_provider TEXT,
      last_license_validation TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS wrapped_data_key TEXT;

    CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces (slug);
    CREATE INDEX IF NOT EXISTS idx_workspaces_status ON workspaces (status);

    -- License rows also live here (license service shares Control DB by default)
    CREATE TABLE IF NOT EXISTS licenses (
      license_id TEXT PRIMARY KEY,
      company_uuid UUID UNIQUE,
      company_name TEXT,
      maximum_users INT NOT NULL DEFAULT 5,
      edition TEXT NOT NULL DEFAULT 'standard',
      status TEXT NOT NULL DEFAULT 'issued'
        CHECK (status IN ('issued', 'active', 'revoked')),
      activation_token TEXT,
      last_validation TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses (status);
  `);
}

export async function pingControlDatabase(): Promise<boolean> {
  try {
    await getControlPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
