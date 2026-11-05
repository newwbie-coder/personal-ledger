import type { UserRole } from "@ledger/db";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "./box.js";
import { queryWorkspace } from "./db.js";
import type { WorkspaceRecord } from "./workspaces.js";
import { findWorkspaceById } from "./workspaces.js";

const JWT_SECRET = getJwtSecret;

export interface AuthUser {
  user_id: string;
  username: string;
  role: UserRole;
  name: string;
  workspace_id: string;
  workspace_slug: string;
  assigned_firm_id?: string | null;
  has_pin?: boolean;
}

export type AppRequest = Request & {
  user?: AuthUser;
  workspace?: WorkspaceRecord;
  /** Workspace data encryption key — memory only, never sent to client. */
  dataKey?: Buffer;
  clientIp?: string;
  clientDevice?: string;
};

export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET(), { expiresIn: "7d" });
}

export async function requireAuth(req: AppRequest, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  let payload: AuthUser;
  try {
    payload = jwt.verify(header.slice(7), JWT_SECRET()) as AuthUser;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  const workspace = findWorkspaceById(payload.workspace_id);
  if (!workspace) {
    res.status(401).json({ error: "Workspace not found" });
    return;
  }
  // Role, firm, and active flag come from the database, not the token.
  const current = await queryWorkspace<{
    role: UserRole;
    name: string;
    active: boolean;
    assigned_firm_id: string | null;
  }>(
    workspace,
    `SELECT role, name, active, assigned_firm_id FROM users WHERE user_id = $1`,
    [payload.user_id],
  );
  const row = current.rows[0];
  if (!row || !row.active) {
    res.status(401).json({ error: "Account is disabled" });
    return;
  }
  req.user = {
    ...payload,
    role: row.role,
    name: row.name,
    assigned_firm_id: row.assigned_firm_id,
  };
  req.workspace = workspace;
  next();
}

export function requireRoles(...roles: UserRole[]) {
  return (req: AppRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export function attachClientMeta(req: AppRequest, _res: Response, next: NextFunction) {
  const xf = req.header("x-forwarded-for");
  req.clientIp = xf?.split(",")[0]?.trim() || req.socket.remoteAddress || undefined;
  req.clientDevice = req.header("user-agent")?.slice(0, 300) || undefined;
  next();
}
