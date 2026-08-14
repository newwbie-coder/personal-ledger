import { Router } from "express";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { requireAuth, requireRoles, type AppRequest } from "../auth.js";
import { computePartyBalance, listPartiesWithBalances } from "../balances.js";
import { sealAmount, sealField } from "../data-crypto.js";
import { queryWorkspace, withTransaction } from "../db.js";
import { decryptPartyRow } from "../field-crypto.js";
import { openAmount } from "../data-crypto.js";
import { assertFirmAccess, getAssignedFirmId } from "../firm-access.js";
import { requireActiveFirm } from "../firms.js";
import { requireDataKey, requireLicense } from "../middleware.js";
import { notifyOwners } from "../notify.js";

export const partiesRouter = Router();

partiesRouter.use(requireAuth, requireLicense);

partiesRouter.get("/", async (req: AppRequest, res) => {
  const q = String(req.query.q ?? "").trim();
  let firmId = typeof req.query.firm_id === "string" ? req.query.firm_id : null;
  const includeInactive = req.query.include_inactive === "true";

  if (req.user!.role === "employee") {
    const assigned = await getAssignedFirmId(req.workspace!, req.user!.user_id);
    if (!assigned) {
      res.status(403).json({ error: "Employee has no assigned firm" });
      return;
    }
    firmId = assigned;
  }

  if (firmId) {
    try {
      await requireActiveFirm(req.workspace!, firmId);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status ?? 400).json({ error: e.message ?? "Invalid firm" });
      return;
    }
  }

  const parties = await listPartiesWithBalances(req.workspace!, req.dataKey ?? null, {
    q,
    firmId,
    includeInactive,
  });

  res.json({
    firm_id: firmId,
    view: firmId ? "firm" : "workspace_summary",
    parties,
  });
});

partiesRouter.get("/:id", async (req: AppRequest, res) => {
  let firmId = typeof req.query.firm_id === "string" ? req.query.firm_id : null;
  if (req.user!.role === "employee") {
    const assigned = await getAssignedFirmId(req.workspace!, req.user!.user_id);
    if (!assigned) {
      res.status(403).json({ error: "Employee has no assigned firm" });
      return;
    }
    firmId = assigned;
  }
  if (firmId) {
    try {
      await requireActiveFirm(req.workspace!, firmId);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status ?? 400).json({ error: e.message ?? "Invalid firm" });
      return;
    }
  }

  const result = await queryWorkspace(
    req.workspace!,
    `SELECT party_id, party_name, phone, active, created_at FROM parties WHERE party_id = $1`,
    [req.params.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Party not found" });
    return;
  }

  const p = decryptPartyRow(req.dataKey ?? null, result.rows[0]);
  const current_balance = await computePartyBalance(
    req.workspace!,
    req.dataKey ?? null,
    String(p.party_id),
    firmId,
  );

  const breakdown = await queryWorkspace(
    req.workspace!,
    `SELECT f.firm_id, f.firm_name, f.status,
            o.balance AS opening_raw,
            COALESCE(o.locked, FALSE) AS opening_locked,
            o.effective_date
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

  const firm_balances = [];
  for (const r of breakdown.rows) {
    const opening_balance = openAmount(req.dataKey ?? null, r.opening_raw ?? 0);
    const bal = await computePartyBalance(
      req.workspace!,
      req.dataKey ?? null,
      String(req.params.id),
      String(r.firm_id),
    );
    firm_balances.push({
      firm_id: r.firm_id,
      firm_name: r.firm_name,
      status: r.status,
      opening_balance,
      opening_locked: Boolean(r.opening_locked),
      effective_date: r.effective_date
        ? new Date(r.effective_date).toISOString().slice(0, 10)
        : null,
      current_balance: bal,
    });
  }

  res.json({
    firm_id: firmId,
    view: firmId ? "firm" : "workspace_summary",
    party: {
      ...p,
      current_balance,
      firm_balances,
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

partiesRouter.post("/", requireDataKey, async (req: AppRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const dek = req.dataKey!;
  try {
    await assertFirmAccess(req.workspace!, req.user!, parsed.data.firm_id);
    const party = await withTransaction(req.workspace!, async (client) => {
      await requireActiveFirm(req.workspace!, parsed.data.firm_id, client);
      const sealedName = sealField(dek, parsed.data.party_name.trim());
      const sealedPhone = parsed.data.phone?.trim()
        ? sealField(dek, parsed.data.phone.trim())
        : null;
      const created = await client.query(
        `INSERT INTO parties (party_name, phone, opening_balance, active)
         VALUES ($1, $2, 0, TRUE)
         RETURNING party_id, party_name, phone, active, created_at`,
        [sealedName, sealedPhone],
      );
      const row = created.rows[0];
      await client.query(
        `INSERT INTO opening_balances
           (party_id, firm_id, balance, effective_date, created_by, locked)
         VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, FALSE)`,
        [
          row.party_id,
          parsed.data.firm_id,
          sealAmount(dek, parsed.data.opening_balance),
          parsed.data.effective_date ?? null,
          req.user!.user_id,
        ],
      );
      return {
        party_id: row.party_id,
        party_name: parsed.data.party_name.trim(),
        phone: parsed.data.phone?.trim() || null,
        active: true,
        created_at: row.created_at,
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
        firm_id: parsed.data.firm_id,
        opening_balance: parsed.data.opening_balance,
      },
      ip_address: req.clientIp,
      device: req.clientDevice,
    });
    await notifyOwners(req.workspace!, {
      title: "Party added",
      body: `${req.user!.name} added ${party.party_name}`,
      entity_type: "party",
      entity_id: party.party_id,
      exclude_user_id: req.user!.user_id,
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

const updateSchema = z.object({
  party_name: z.string().min(1).max(200).optional(),
  phone: z.string().max(32).optional().nullable(),
});

partiesRouter.patch(
  "/:id",
  requireDataKey,
  requireRoles("owner", "manager"),
  async (req: AppRequest, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if (parsed.data.party_name === undefined && parsed.data.phone === undefined) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    const dek = req.dataKey!;
    const existing = await queryWorkspace(
      req.workspace!,
      `SELECT party_id FROM parties WHERE party_id = $1`,
      [req.params.id],
    );
    if (!existing.rows[0]) {
      res.status(404).json({ error: "Party not found" });
      return;
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (parsed.data.party_name !== undefined) {
      params.push(sealField(dek, parsed.data.party_name.trim()));
      sets.push(`party_name = $${params.length}`);
    }
    if (parsed.data.phone !== undefined) {
      params.push(
        parsed.data.phone?.trim() ? sealField(dek, parsed.data.phone.trim()) : null,
      );
      sets.push(`phone = $${params.length}`);
    }
    params.push(req.params.id);
    const result = await queryWorkspace(
      req.workspace!,
      `UPDATE parties SET ${sets.join(", ")} WHERE party_id = $${params.length}
       RETURNING party_id, party_name, phone, active, created_at`,
      params,
    );
    const party = decryptPartyRow(dek, result.rows[0]);
    await writeAudit(req.workspace!, {
      actor_user_id: req.user!.user_id,
      action: "party.update",
      entity_type: "party",
      entity_id: req.params.id,
      ip_address: req.clientIp,
      device: req.clientDevice,
    });
    await notifyOwners(req.workspace!, {
      title: "Party edited",
      body: `${req.user!.name} edited ${String(party.party_name)}`,
      entity_type: "party",
      entity_id: req.params.id,
      exclude_user_id: req.user!.user_id,
    });
    res.json({ party });
  },
);

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
  res.json({ party: decryptPartyRow(req.dataKey ?? null, result.rows[0]) });
});
