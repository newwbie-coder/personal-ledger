import type { UserRole } from "@ledger/db";
import bcrypt from "bcryptjs";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { requireAuth, signToken, type AppRequest } from "../auth.js";
import { queryWorkspace } from "../db.js";
import { findWorkspaceBySlug } from "../workspaces.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

const loginSchema = z.object({
  workspace: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/login", loginLimiter, async (req: AppRequest, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Workspace, username and password required" });
    return;
  }

  const workspace = await findWorkspaceBySlug(parsed.data.workspace);
  if (!workspace || workspace.status !== "active") {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const result = await queryWorkspace<{
    user_id: string;
    name: string;
    username: string;
    password_hash: string;
    role: UserRole;
    active: boolean;
  }>(
    workspace,
    `SELECT user_id, name, username, password_hash, role, active
     FROM users WHERE LOWER(username) = LOWER($1)`,
    [parsed.data.username],
  );

  const user = result.rows[0];
  if (!user || !user.active) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const ok = await bcrypt.compare(parsed.data.password, user.password_hash);
  if (!ok) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = signToken({
    user_id: user.user_id,
    username: user.username,
    role: user.role,
    name: user.name,
    workspace_id: workspace.workspace_id,
    workspace_slug: workspace.slug,
  });

  await writeAudit(workspace, {
    actor_user_id: user.user_id,
    action: "auth.login",
    entity_type: "user",
    entity_id: user.user_id,
    ip_address: req.clientIp,
    device: req.clientDevice,
  });

  res.json({
    token,
    user: {
      user_id: user.user_id,
      name: user.name,
      username: user.username,
      role: user.role,
    },
    workspace: {
      workspace_id: workspace.workspace_id,
      slug: workspace.slug,
      company_name: workspace.company_name,
    },
  });
});

authRouter.get("/me", requireAuth, async (req: AppRequest, res) => {
  const result = await queryWorkspace(
    req.workspace!,
    `SELECT user_id, name, username, role, active, created_at
     FROM users WHERE user_id = $1`,
    [req.user!.user_id],
  );
  const user = result.rows[0];
  if (!user || !user.active) {
    res.status(401).json({ error: "User inactive" });
    return;
  }
  res.json({
    user,
    workspace: {
      workspace_id: req.workspace!.workspace_id,
      slug: req.workspace!.slug,
      company_name: req.workspace!.company_name,
    },
  });
});
