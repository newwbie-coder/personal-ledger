import type { WorkspaceRecord } from "./workspaces.js";
import { queryWorkspace } from "./db.js";

export async function writeAudit(
  workspace: WorkspaceRecord,
  input: {
    actor_user_id?: string | null;
    action: string;
    entity_type?: string;
    entity_id?: string;
    detail?: unknown;
    ip_address?: string;
    device?: string;
  },
) {
  try {
    await queryWorkspace(
      workspace,
      `INSERT INTO audit_logs
         (actor_user_id, action, entity_type, entity_id, detail, ip_address, device)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.actor_user_id ?? null,
        input.action,
        input.entity_type ?? null,
        input.entity_id ?? null,
        input.detail ? JSON.stringify(input.detail) : null,
        input.ip_address ?? null,
        input.device ?? null,
      ],
    );
  } catch (err) {
    console.error("Audit log failed:", err);
  }
}
