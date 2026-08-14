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

const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many PIN attempts. Try again later." },
});

function publicUser(row: {
  user_id: string;
  name: string;
  username: string;
  role: UserRole;
  assigned_firm_id?: string | null;
  pin_hash?: string | null;
}) {
  return {
    user_id: row.user_id,
    name: row.name,
    username: row.username,
    role: row.role,
    assigned_firm_id: row.assigned_firm_id ?? null,
    has_pin: Boolean(row.pin_hash),
  };
}

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
    assigned_firm_id: string | null;
    pin_hash: string | null;
  }>(
    workspace,
    `SELECT user_id, name, username, password_hash, role, active,
            assigned_firm_id, pin_hash
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

  if (user.role === "employee" && !user.assigned_firm_id) {
    res.status(403).json({
      error: "Employee has no assigned firm. Ask the owner to assign one.",
    });
    return;
  }

  const token = signToken({
    user_id: user.user_id,
    username: user.username,
    role: user.role,
    name: user.name,
    workspace_id: workspace.workspace_id,
    workspace_slug: workspace.slug,
    assigned_firm_id: user.assigned_firm_id,
    has_pin: Boolean(user.pin_hash),
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
    user: publicUser(user),
    workspace: {
      workspace_id: workspace.workspace_id,
      slug: workspace.slug,
      company_name: workspace.company_name,
    },
  });
});

authRouter.get("/me", requireAuth, async (req: AppRequest, res) => {
  const result = await queryWorkspace<{
    user_id: string;
    name: string;
    username: string;
    role: UserRole;
    active: boolean;
    created_at: string;
    assigned_firm_id: string | null;
    pin_hash: string | null;
  }>(
    req.workspace!,
    `SELECT user_id, name, username, role, active, created_at,
            assigned_firm_id, pin_hash
     FROM users WHERE user_id = $1`,
    [req.user!.user_id],
  );
  const user = result.rows[0];
  if (!user || !user.active) {
    res.status(401).json({ error: "User inactive" });
    return;
  }
  res.json({
    user: publicUser(user),
    workspace: {
      workspace_id: req.workspace!.workspace_id,
      slug: req.workspace!.slug,
      company_name: req.workspace!.company_name,
    },
  });
});

const pinSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits"),
});

authRouter.post("/pin/set", requireAuth, async (req: AppRequest, res) => {
  const parsed = pinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "PIN must be 4–6 digits" });
    return;
  }
  const pin_hash = await bcrypt.hash(parsed.data.pin, 10);
  await queryWorkspace(
    req.workspace!,
    `UPDATE users SET pin_hash = $1 WHERE user_id = $2`,
    [pin_hash, req.user!.user_id],
  );
  await writeAudit(req.workspace!, {
    actor_user_id: req.user!.user_id,
    action: "auth.pin_set",
    entity_type: "user",
    entity_id: req.user!.user_id,
    ip_address: req.clientIp,
    device: req.clientDevice,
  });
  res.json({ ok: true, has_pin: true });
});

authRouter.post("/pin/verify", requireAuth, pinLimiter, async (req: AppRequest, res) => {
  const parsed = pinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "PIN must be 4–6 digits" });
    return;
  }
  const result = await queryWorkspace<{ pin_hash: string | null }>(
    req.workspace!,
    `SELECT pin_hash FROM users WHERE user_id = $1`,
    [req.user!.user_id],
  );
  const hash = result.rows[0]?.pin_hash;
  if (!hash) {
    res.status(400).json({ error: "PIN not set yet" });
    return;
  }
  const ok = await bcrypt.compare(parsed.data.pin, hash);
  if (!ok) {
    res.status(401).json({ error: "Wrong PIN" });
    return;
  }
  res.json({ ok: true });
});
