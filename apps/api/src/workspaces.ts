import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { getControlPool } from "./control-db.js";
import type { DbProvider } from "./db-url.js";

export interface WorkspaceRecord {
  workspace_id: string;
  slug: string;
  company_name: string;
  company_uuid: string;
  database_url_encrypted: string;
  license_id: string;
  activation_token: string;
  status: "active" | "suspended" | "revoked";
  db_provider: DbProvider | null;
  last_license_validation: string | null;
  created_at: string;
}

function mapRow(row: Record<string, unknown>): WorkspaceRecord {
  return {
    workspace_id: String(row.workspace_id),
    slug: String(row.slug),
    company_name: String(row.company_name),
    company_uuid: String(row.company_uuid),
    database_url_encrypted: String(row.encrypted_database_url),
    license_id: String(row.license_id),
    activation_token: String(row.activation_token),
    status: row.status as WorkspaceRecord["status"],
    db_provider: (row.db_provider as DbProvider | null) ?? null,
    last_license_validation: row.last_license_validation
      ? new Date(String(row.last_license_validation)).toISOString()
      : null,
    created_at: new Date(String(row.created_at)).toISOString(),
  };
}

export async function listWorkspaces(): Promise<WorkspaceRecord[]> {
  const result = await getControlPool().query(
    `SELECT * FROM workspaces ORDER BY created_at ASC`,
  );
  return result.rows.map(mapRow);
}

export async function countWorkspaces(): Promise<number> {
  const result = await getControlPool().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM workspaces`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function findWorkspaceBySlug(
  slug: string,
): Promise<WorkspaceRecord | undefined> {
  const result = await getControlPool().query(
    `SELECT * FROM workspaces WHERE slug = $1 LIMIT 1`,
    [slug.toLowerCase()],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}

export async function findWorkspaceById(
  id: string,
): Promise<WorkspaceRecord | undefined> {
  const result = await getControlPool().query(
    `SELECT * FROM workspaces WHERE workspace_id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}

export function getWorkspaceDatabaseUrl(workspace: WorkspaceRecord): string {
  return decryptSecret(workspace.database_url_encrypted);
}

export async function createWorkspace(input: {
  slug: string;
  company_name: string;
  company_uuid: string;
  database_url: string;
  license_id: string;
  activation_token: string;
  db_provider?: DbProvider;
}): Promise<WorkspaceRecord> {
  const slug = input.slug.toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
    throw new Error("Workspace slug must be 2–63 chars: lowercase letters, numbers, hyphens");
  }

  const existing = await findWorkspaceBySlug(slug);
  if (existing) throw new Error("Workspace slug already taken");

  const workspace_id = randomUUID();
  const encrypted = encryptSecret(input.database_url);

  const result = await getControlPool().query(
    `INSERT INTO workspaces (
       workspace_id, slug, company_name, company_uuid,
       encrypted_database_url, license_id, activation_token,
       status, db_provider, last_license_validation
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8, NOW())
     RETURNING *`,
    [
      workspace_id,
      slug,
      input.company_name,
      input.company_uuid,
      encrypted,
      input.license_id,
      input.activation_token,
      input.db_provider ?? null,
    ],
  );

  return mapRow(result.rows[0]);
}

export async function touchLicenseValidation(workspaceId: string) {
  await getControlPool().query(
    `UPDATE workspaces SET last_license_validation = NOW() WHERE workspace_id = $1`,
    [workspaceId],
  );
}

export function publicWorkspace(w: WorkspaceRecord) {
  return {
    workspace_id: w.workspace_id,
    slug: w.slug,
    company_name: w.company_name,
  };
}
