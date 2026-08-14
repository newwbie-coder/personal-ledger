import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import type { UserRole } from "@ledger/db";
import { writeAudit } from "../audit.js";
import { requireAuth, requireRoles, type AppRequest } from "../auth.js";
import { queryWorkspace } from "../db.js";
import { validateWorkspaceLicense } from "../license-client.js";
import { requireLicense } from "../middleware.js";

export const usersRouter = Router();

usersRouter.use(requireAuth, requireLicense);

usersRouter.get("/", requireRoles("owner"), async (req: AppRequest, res) => {
  const result = await queryWorkspace(
    req.workspace!,
    `SELECT user_id, name, username, role, active, created_at, assigned_firm_id
     FROM users ORDER BY created_at ASC`,
  );
  res.json({ users: result.rows });
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  username: z.string().min(3).max(64),
  password: z.string().min(6).max(128),
  role: z.enum(["owner", "manager", "employee"]),
  assigned_firm_id: z.string().uuid().optional().nullable(),
});

usersRouter.post("/", requireRoles("owner"), async (req: AppRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (parsed.data.role === "employee" && !parsed.data.assigned_firm_id) {
    res.status(400).json({ error: "Employees must be assigned to one firm" });
    return;
  }
  if (parsed.data.role !== "employee" && parsed.data.assigned_firm_id) {
    res.status(400).json({ error: "Only employees use assigned_firm_id" });
    return;
  }
  if (parsed.data.assigned_firm_id) {
    const firm = await queryWorkspace(
      req.workspace!,
      `SELECT firm_id FROM firms WHERE firm_id = $1 AND status = 'active'`,
      [parsed.data.assigned_firm_id],
    );
    if (!firm.rows[0]) {
      res.status(400).json({ error: "Assigned firm not found or archived" });
      return;
    }
  }

  const license = await validateWorkspaceLicense(req.workspace!, true);
  const maxUsers = license.maximum_users ?? 5;
  const count = await queryWorkspace<{ count: string }>(
    req.workspace!,
    `SELECT COUNT(*)::text AS count FROM users WHERE active = TRUE`,
  );
  if (Number(count.rows[0]?.count ?? 0) >= maxUsers) {
    res.status(403).json({ error: `License allows at most ${maxUsers} active users` });
    return;
  }

  const password_hash = await bcrypt.hash(parsed.data.password, 12);
  try {
    const result = await queryWorkspace(
      req.workspace!,
      `INSERT INTO users (name, username, password_hash, role, active, assigned_firm_id)
       VALUES ($1, $2, $3, $4, TRUE, $5)
       RETURNING user_id, name, username, role, active, created_at, assigned_firm_id`,
      [
        parsed.data.name,
        parsed.data.username.toLowerCase(),
        password_hash,
        parsed.data.role as UserRole,
        parsed.data.role === "employee" ? parsed.data.assigned_firm_id : null,
      ],
    );
    const user = result.rows[0];
    await writeAudit(req.workspace!, {
      actor_user_id: req.user!.user_id,
      action: "user.create",
      entity_type: "user",
      entity_id: user.user_id,
      detail: {
        username: user.username,
        role: user.role,
        assigned_firm_id: user.assigned_firm_id,
      },
      ip_address: req.clientIp,
      device: req.clientDevice,
    });
    res.status(201).json({ user });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "23505") {
      res.status(409).json({ error: "Username already exists" });
      return;
    }
    throw err;
  }
});

usersRouter.patch("/:id/assignment", requireRoles("owner"), async (req: AppRequest, res) => {
  const schema = z.object({
    assigned_firm_id: z.string().uuid().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "assigned_firm_id required (uuid or null)" });
    return;
  }

  const target = await queryWorkspace<{ user_id: string; role: UserRole }>(
    req.workspace!,
    `SELECT user_id, role FROM users WHERE user_id = $1`,
    [req.params.id],
  );
  if (!target.rows[0]) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (target.rows[0].role !== "employee") {
    res.status(400).json({ error: "Only employees can be assigned to a firm" });
    return;
  }
  if (!parsed.data.assigned_firm_id) {
    res.status(400).json({ error: "Employees must keep one assigned firm" });
    return;
  }

  const firm = await queryWorkspace(
    req.workspace!,
    `SELECT firm_id FROM firms WHERE firm_id = $1 AND status = 'active'`,
    [parsed.data.assigned_firm_id],
  );
  if (!firm.rows[0]) {
    res.status(400).json({ error: "Assigned firm not found or archived" });
    return;
  }

  const result = await queryWorkspace(
    req.workspace!,
    `UPDATE users SET assigned_firm_id = $1 WHERE user_id = $2
     RETURNING user_id, name, username, role, active, created_at, assigned_firm_id`,
    [parsed.data.assigned_firm_id, req.params.id],
  );
  await writeAudit(req.workspace!, {
    actor_user_id: req.user!.user_id,
    action: "user.assign_firm",
    entity_type: "user",
    entity_id: req.params.id,
    detail: { assigned_firm_id: parsed.data.assigned_firm_id },
    ip_address: req.clientIp,
    device: req.clientDevice,
  });
  res.json({ user: result.rows[0] });
});

usersRouter.patch("/:id/active", requireRoles("owner"), async (req: AppRequest, res) => {
  const schema = z.object({ active: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "active boolean required" });
    return;
  }
  if (req.params.id === req.user!.user_id && !parsed.data.active) {
    res.status(400).json({ error: "Cannot deactivate yourself" });
    return;
  }
  const result = await queryWorkspace(
    req.workspace!,
    `UPDATE users SET active = $1 WHERE user_id = $2
     RETURNING user_id, name, username, role, active, created_at`,
    [parsed.data.active, req.params.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  await writeAudit(req.workspace!, {
    actor_user_id: req.user!.user_id,
    action: parsed.data.active ? "user.activate" : "user.deactivate",
    entity_type: "user",
    entity_id: req.params.id,
    ip_address: req.clientIp,
    device: req.clientDevice,
  });
  res.json({ user: result.rows[0] });
});

usersRouter.post("/:id/reset-password", requireRoles("owner"), async (req: AppRequest, res) => {
  const schema = z.object({ password: z.string().min(6).max(128) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "password required (min 6)" });
    return;
  }

  const target = await queryWorkspace(
    req.workspace!,
    `SELECT user_id, role FROM users WHERE user_id = $1`,
    [req.params.id],
  );
  if (!target.rows[0]) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const password_hash = await bcrypt.hash(parsed.data.password, 12);
  await queryWorkspace(
    req.workspace!,
    `UPDATE users SET password_hash = $1 WHERE user_id = $2`,
    [password_hash, req.params.id],
  );

  await writeAudit(req.workspace!, {
    actor_user_id: req.user!.user_id,
    action: "user.reset_password",
    entity_type: "user",
    entity_id: req.params.id,
    ip_address: req.clientIp,
    device: req.clientDevice,
  });

  res.json({ ok: true });
});

usersRouter.get("/license-status", requireRoles("owner", "manager"), async (req: AppRequest, res) => {
  const validation = await validateWorkspaceLicense(req.workspace!, false);
  res.json({
    license_id: req.workspace!.license_id,
    company_uuid: req.workspace!.company_uuid,
    workspace_slug: req.workspace!.slug,
    last_validation: req.workspace!.last_license_validation,
    valid: validation.valid,
    maximum_users: validation.maximum_users,
  });
});
