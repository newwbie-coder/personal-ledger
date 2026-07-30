import { MIGRATIONS, SCHEMA_VERSION } from "@ledger/db";
import type { Pool } from "pg";

export async function runMigrationsOnPool(
  pool: Pool,
): Promise<{ applied: number[]; schema_version: number }> {
  const client = await pool.connect();
  const applied: number[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    const existing = await client.query<{ version: number }>(
      `SELECT version FROM schema_migrations ORDER BY version`,
    );
    const done = new Set(existing.rows.map((r) => r.version));

    for (const migration of MIGRATIONS) {
      if (done.has(migration.version)) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`,
          [migration.version, migration.name],
        );
        await client.query("COMMIT");
        applied.push(migration.version);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    return { applied, schema_version: SCHEMA_VERSION };
  } finally {
    client.release();
  }
}
