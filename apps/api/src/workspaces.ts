import { getPool } from "./db.js";
import { verifyLicense, type LicensePayload } from "./license.js";

/** The single company that lives on this box. */
export interface WorkspaceRecord {
  workspace_id: string;
  slug: string;
  company_name: string;
  company_uuid: string;
  status: "active";
  created_at: string;
  license: LicensePayload;
}

let current: WorkspaceRecord | null = null;

export async function loadLocalWorkspace(): Promise<WorkspaceRecord | null> {
  const result = await getPool().query<{
    company_uuid: string;
    company_name: string;
    created_at: Date;
    license: unknown;
  }>(
    `SELECT c.company_uuid, c.company_name, c.created_at, m.license
     FROM companies c
     JOIN app_metadata m ON m.company_uuid = c.company_uuid
     ORDER BY c.created_at ASC
     LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row || !row.license) {
    current = null;
    return null;
  }
  const license = verifyLicense(row.license);
  current = {
    workspace_id: row.company_uuid,
    slug: "main",
    company_name: row.company_name,
    company_uuid: row.company_uuid,
    status: "active",
    created_at: new Date(row.created_at).toISOString(),
    license: license.payload,
  };
  return current;
}

export function getLocalWorkspace(): WorkspaceRecord | null {
  return current;
}

export function findWorkspaceById(id: string): WorkspaceRecord | undefined {
  return current && current.workspace_id === id ? current : undefined;
}

export function publicWorkspace(w: WorkspaceRecord) {
  return {
    workspace_id: w.workspace_id,
    slug: w.slug,
    company_name: w.company_name,
  };
}
