import type { AuthUser } from "./auth.js";
import type { WorkspaceRecord } from "./workspaces.js";
import { queryWorkspace } from "./db.js";

/** Resolve which firm an employee is locked to (from DB, not only JWT). */
export async function getAssignedFirmId(
  workspace: WorkspaceRecord,
  userId: string,
): Promise<string | null> {
  const result = await queryWorkspace<{ assigned_firm_id: string | null }>(
    workspace,
    `SELECT assigned_firm_id FROM users WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0]?.assigned_firm_id ?? null;
}

/**
 * Employees may only use their assigned firm.
 * Managers/owners may use any active firm.
 */
export async function assertFirmAccess(
  workspace: WorkspaceRecord,
  user: AuthUser,
  firmId: string,
): Promise<void> {
  if (user.role !== "employee") return;
  const assigned = await getAssignedFirmId(workspace, user.user_id);
  if (!assigned) {
    throw Object.assign(new Error("Employee has no assigned firm. Ask the owner."), {
      status: 403,
    });
  }
  if (assigned !== firmId) {
    throw Object.assign(new Error("You can only work in your assigned firm"), { status: 403 });
  }
}
