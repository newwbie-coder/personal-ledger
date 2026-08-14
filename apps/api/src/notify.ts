import type { WorkspaceRecord } from "./workspaces.js";
import { queryWorkspace } from "./db.js";

/** Notify all active owners in the workspace (in-app bell). */
export async function notifyOwners(
  workspace: WorkspaceRecord,
  input: {
    title: string;
    body: string;
    entity_type?: string;
    entity_id?: string;
    exclude_user_id?: string;
  },
) {
  const owners = await queryWorkspace<{ user_id: string }>(
    workspace,
    `SELECT user_id FROM users WHERE role = 'owner' AND active = TRUE`,
  );
  for (const owner of owners.rows) {
    if (input.exclude_user_id && owner.user_id === input.exclude_user_id) continue;
    await queryWorkspace(
      workspace,
      `INSERT INTO notifications (user_id, title, body, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        owner.user_id,
        input.title,
        input.body,
        input.entity_type ?? null,
        input.entity_id ?? null,
      ],
    );
  }
}
