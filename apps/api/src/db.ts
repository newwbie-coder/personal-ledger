import pg from "pg";
import type { WorkspaceRecord } from "./workspaces.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

/** The box's own Postgres. One company per box, so one pool. */
export function getPool(): pg.Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required (the box's own Postgres).");
  }
  pool = new Pool({ connectionString, max: 10 });
  return pool;
}

export function getWorkspacePool(_workspace?: WorkspaceRecord): pg.Pool {
  return getPool();
}

export async function withWorkspaceClient<T>(
  workspace: WorkspaceRecord,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getWorkspacePool(workspace).connect();
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

export async function queryWorkspace<T extends pg.QueryResultRow = pg.QueryResultRow>(
  workspace: WorkspaceRecord,
  text: string,
  params?: unknown[],
) {
  return getWorkspacePool(workspace).query<T>(text, params);
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closePool() {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}
