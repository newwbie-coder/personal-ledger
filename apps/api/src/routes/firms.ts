import { Router } from "express";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { requireAuth, requireRoles, type AppRequest } from "../auth.js";
import { computeOutstanding } from "../balances.js";
import { queryWorkspace, withTransaction } from "../db.js";
import { requireLicense } from "../middleware.js";

export const firmsRouter = Router();

firmsRouter.use(requireAuth, requireLicense);

firmsRouter.get("/", async (req: AppRequest, res) => {
  const includeArchived = req.query.include_archived === "true";
  if (req.user!.role === "employee") {
    const assigned = await queryWorkspace(
      req.workspace!,
      `SELECT f.firm_id, f.firm_name, f.status, f.created_at
       FROM users u
       JOIN firms f ON f.firm_id = u.assigned_firm_id
       WHERE u.user_id = $1 AND f.status = 'active'`,
      [req.user!.user_id],
    );
    res.json({ firms: assigned.rows, locked: true });
    return;
  }
  const result = await queryWorkspace(
    req.workspace!,
    `SELECT firm_id, firm_name, status, created_at
     FROM firms
     ${includeArchived ? "" : "WHERE status = 'active'"}
     ORDER BY created_at ASC`,
  );
  res.json({ firms: result.rows, locked: false });
});

const createSchema = z.object({
  firm_name: z.string().min(1).max(200),
});

firmsRouter.post("/", requireRoles("owner"), async (req: AppRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const result = await queryWorkspace(
    req.workspace!,
    `INSERT INTO firms (firm_name, status)
     VALUES ($1, 'active')
     RETURNING firm_id, firm_name, status, created_at`,
    [parsed.data.firm_name.trim()],
  );
  const firm = result.rows[0];
  await writeAudit(req.workspace!, {
    actor_user_id: req.user!.user_id,
    action: "firm.create",
    entity_type: "firm",
    entity_id: firm.firm_id,
    detail: { firm_name: firm.firm_name },
    ip_address: req.clientIp,
    device: req.clientDevice,
  });
  res.status(201).json({ firm });
});

firmsRouter.post("/:id/archive", requireRoles("owner"), async (req: AppRequest, res) => {
  try {
    const firm = await withTransaction(req.workspace!, async (client) => {
      const existing = await client.query(
        `SELECT firm_id, firm_name, status FROM firms WHERE firm_id = $1 FOR UPDATE`,
        [req.params.id],
      );
      if (!existing.rows[0]) {
        throw Object.assign(new Error("Firm not found"), { status: 404 });
      }
      if (existing.rows[0].status === "archived") {
        return existing.rows[0];
      }

      const activeCount = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM firms WHERE status = 'active'`,
      );
      if (Number(activeCount.rows[0]?.count ?? 0) <= 1) {
        throw Object.assign(new Error("Cannot archive the last active firm"), { status: 400 });
      }

      const outstanding = await computeOutstanding(
        req.workspace!,
        req.dataKey ?? null,
        req.params.id,
      );
      if (outstanding !== 0) {
        throw Object.assign(
          new Error("Cannot archive firm with open party balances. Settle balances first."),
          { status: 400 },
        );
      }

      const updated = await client.query(
        `UPDATE firms SET status = 'archived' WHERE firm_id = $1
         RETURNING firm_id, firm_name, status, created_at`,
        [req.params.id],
      );
      return updated.rows[0];
    });

    await writeAudit(req.workspace!, {
      actor_user_id: req.user!.user_id,
      action: "firm.archive",
      entity_type: "firm",
      entity_id: firm.firm_id,
      ip_address: req.clientIp,
      device: req.clientDevice,
    });
    res.json({ firm });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    throw err;
  }
});

firmsRouter.post("/:id/restore", requireRoles("owner"), async (req: AppRequest, res) => {
  const result = await queryWorkspace(
    req.workspace!,
    `UPDATE firms SET status = 'active' WHERE firm_id = $1
     RETURNING firm_id, firm_name, status, created_at`,
    [req.params.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Firm not found" });
    return;
  }
  await writeAudit(req.workspace!, {
    actor_user_id: req.user!.user_id,
    action: "firm.restore",
    entity_type: "firm",
    entity_id: req.params.id,
    ip_address: req.clientIp,
    device: req.clientDevice,
  });
  res.json({ firm: result.rows[0] });
});
