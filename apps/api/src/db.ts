import pg from "pg";
import type { WorkspaceRecord } from "./workspaces.js";
import { pgPoolOptions } from "./db-url.js";
import { getWorkspaceDatabaseUrl } from "./workspaces.js";

const { Pool } = pg;

const pools = new Map<string, pg.Pool>();

export function getWorkspacePool(workspace: WorkspaceRecord): pg.Pool {
  const existing = pools.get(workspace.workspace_id);
  if (existing) return existing;

  const connectionString = getWorkspaceDatabaseUrl(workspace);
  const pool = new Pool(
    pgPoolOptions(connectionString, undefined, { max: 10 }) as pg.PoolConfig,
  );
  pools.set(workspace.workspace_id, pool);
  return pool;
}

/** Drop cached pool after DB URL swap so next query uses the new host. */
export function resetWorkspacePool(workspaceId: string) {
  const existing = pools.get(workspaceId);
  if (existing) {
    pools.delete(workspaceId);
    void existing.end().catch(() => undefined);
  }
}

export async function withWorkspaceClient<T>(
  workspace: WorkspaceRecord,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getWorkspacePool(workspace);
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  workspace: WorkspaceRecord,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withWorkspaceClient(workspace, async (client) => {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  });
}

export async function testDatabaseUrl(connectionString: string, host?: string): Promise<void> {
  const pool = new Pool(
    pgPoolOptions(connectionString, host, { connectionTimeoutMillis: 8000 }) as pg.PoolConfig,
  );
  try {
    await pool.query("SELECT 1 AS ok");
  } finally {
    await pool.end();
  }
}

export async function queryWorkspace<T extends pg.QueryResultRow = pg.QueryResultRow>(
  workspace: WorkspaceRecord,
  text: string,
  params?: unknown[],
) {
  return getWorkspacePool(workspace).query<T>(text, params);
}

export async function closeAllPools() {
  const pending = [...pools.values()].map((p) => p.end());
  pools.clear();
  await Promise.all(pending);
}
