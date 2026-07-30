import { Router } from "express";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { requireAuth, requireRoles, type AppRequest } from "../auth.js";
import { queryWorkspace, withTransaction } from "../db.js";
import {
  partyAggregateBalanceSql,
  partyFirmBalanceSql,
  requireActiveFirm,
} from "../firms.js";
import { requireLicense } from "../middleware.js";

export const partiesRouter = Router();

partiesRouter.use(requireAuth, requireLicense);

partiesRouter.get("/", async (req: AppRequest, res) => {
  const q = String(req.query.q ?? "").trim();
  const firmId = typeof req.query.firm_id === "string" ? req.query.firm_id : null;
  const includeInactive = req.query.include_inactive === "true";
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (!includeInactive) clauses.push(`p.active = TRUE`);
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    clauses.push(
      `(LOWER(p.party_name) LIKE $${params.length} OR COALESCE(p.phone, '') LIKE $${params.length})`,
    );
  }

  let balanceExpr: string;
  if (firmId) {
    try {
      await requireActiveFirm(req.workspace!, firmId);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status ?? 400).json({ error: e.message ?? "Invalid firm" });
      return;
    }
    params.push(firmId);
    balanceExpr = partyFirmBalanceSql("p", `$${params.length}`);
  } else {
    balanceExpr = partyAggregateBalanceSql("p");
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await queryWorkspace(
    req.workspace!,
    `SELECT p.party_id, p.party_name, p.phone, p.active, p.created_at,
            (${balanceExpr}) AS current_balance
     FROM parties p
     ${where}
     ORDER BY p.party_name ASC
     LIMIT 200`,
    params,
  );

  res.json({
    firm_id: firmId,
    view: firmId ? "firm" : "workspace_summary",
    parties: result.rows.map((r) => ({
      ...r,
      current_balance: Number(r.current_balance),
    })),
  });
});

partiesRouter.get("/:id", async (req: AppRequest, res) => {
  const firmId = typeof req.query.firm_id === "string" ? req.query.firm_id : null;
  const params: unknown[] = [req.params.id];
  let balanceExpr: string;
  if (firmId) {
    try {
      await requireActiveFirm(req.workspace!, firmId);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status ?? 400).json({ error: e.message ?? "Invalid firm" });
      return;
    }
    params.push(firmId);
    balanceExpr = partyFirmBalanceSql("p", `$${params.length}`);
  } else {
    balanceExpr = partyAggregateBalanceSql("p");
  }

  const result = await queryWorkspace(
    req.workspace!,
    `SELECT p.party_id, p.party_name, p.phone, p.active, p.created_at,
            (${balanceExpr}) AS current_balance
     FROM parties p WHERE p.party_id = $1`,
    params,
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Party not found" });
    return;
  }

  const breakdown = await queryWorkspace(
    req.workspace!,
    `SELECT f.firm_id, f.firm_name, f.status,
            COALESCE(o.balance, 0) AS opening_balance,
            COALESCE(o.locked, FALSE) AS opening_locked,
            o.effective_date,
            (
              COALESCE(o.balance, 0)
              + COALESCE((
                SELECT SUM(CASE WHEN e.type = 'outgoing' THEN e.amount ELSE -e.amount END)
                FROM ledger_entries e
                WHERE e.party_id = $1 AND e.firm_id = f.firm_id AND e.entry_kind = 'party'
              ), 0)
            ) AS current_balance
     FROM firms f
     LEFT JOIN opening_balances o
       ON o.firm_id = f.firm_id AND o.party_id = $1
     WHERE f.status = 'active'
        OR EXISTS (
          SELECT 1 FROM ledger_entries e
          WHERE e.party_id = $1 AND e.firm_id = f.firm_id AND e.entry_kind = 'party'
        )
        OR o.party_id IS NOT NULL
     ORDER BY f.created_at ASC`,
    [req.params.id],
  );

  const p = result.rows[0];
  res.json({
    firm_id: firmId,
    view: firmId ? "firm" : "workspace_summary",
    party: {
      ...p,
      current_balance: Number(p.current_balance),
      firm_balances: breakdown.rows.map((r) => ({
        firm_id: r.firm_id,
        firm_name: r.firm_name,
        status: r.status,
        opening_balance: Number(r.opening_balance),
        opening_locked: Boolean(r.opening_locked),
        effective_date: r.effective_date
          ? new Date(r.effective_date).toISOString().slice(0, 10)
          : null,
        current_balance: Number(r.current_balance),
      })),
    },
  });
});

const createSchema = z.object({
  party_name: z.string().min(1).max(200),
  phone: z.string().max(32).optional().nullable(),
  firm_id: z.string().uuid(),
  opening_balance: z.number().finite().default(0),
  effective_date: z.string().optional(),
});

partiesRouter.post("/", requireRoles("owner", "manager"), async (req: AppRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const party = await withTransaction(req.workspace!, async (client) => {
      await requireActiveFirm(req.workspace!, parsed.data.firm_id, client);
      const created = await client.query(
        `INSERT INTO parties (party_name, phone, opening_balance, active)
         VALUES ($1, $2, 0, TRUE)
         RETURNING party_id, party_name, phone, active, created_at`,
        [parsed.data.party_name.trim(), parsed.data.phone?.trim() || null],
      );
      const row = created.rows[0];
      await client.query(
        `INSERT INTO opening_balances
           (party_id, firm_id, balance, effective_date, created_by, locked)
         VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, FALSE)`,
        [
          row.party_id,
          parsed.data.firm_id,
          parsed.data.opening_balance,
          parsed.data.effective_date ?? null,
          req.user!.user_id,
        ],
      );
      return {
        ...row,
        opening_balance: parsed.data.opening_balance,
        current_balance: parsed.data.opening_balance,
        firm_id: parsed.data.firm_id,
      };
    });

    await writeAudit(req.workspace!, {
      actor_user_id: req.user!.user_id,
      action: "party.create",
      entity_type: "party",
      entity_id: party.party_id,
      detail: {
        party_name: party.party_name,
        firm_id: parsed.data.firm_id,
        opening_balance: parsed.data.opening_balance,
      },
      ip_address: req.clientIp,
      device: req.clientDevice,
    });
    res.status(201).json({ party });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    throw err;
  }
});

partiesRouter.patch("/:id/active", requireRoles("owner", "manager"), async (req: AppRequest, res) => {
  const schema = z.object({ active: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "active boolean required" });
    return;
  }
  const result = await queryWorkspace(
    req.workspace!,
    `UPDATE parties SET active = $1 WHERE party_id = $2
     RETURNING party_id, party_name, phone, active, created_at`,
    [parsed.data.active, req.params.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Party not found" });
    return;
  }
  await writeAudit(req.workspace!, {
    actor_user_id: req.user!.user_id,
    action: parsed.data.active ? "party.activate" : "party.deactivate",
    entity_type: "party",
    entity_id: req.params.id,
    ip_address: req.clientIp,
    device: req.clientDevice,
  });
  res.json({ party: result.rows[0] });
});
