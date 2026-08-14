import { Router } from "express";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { requireAuth, type AppRequest } from "../auth.js";
import { sealAmount, sealField, openAmount } from "../data-crypto.js";
import { queryWorkspace, withTransaction } from "../db.js";
import { decryptLedgerRow } from "../field-crypto.js";
import {
  ensureOpeningBalanceRow,
  lockOpeningBalanceIfNeeded,
  requireActiveFirm,
} from "../firms.js";
import { assertFirmAccess } from "../firm-access.js";
import { requireDataKey, requireLicense } from "../middleware.js";
import { notifyOwners } from "../notify.js";

export const ledgerRouter = Router();

ledgerRouter.use(requireAuth, requireLicense);

ledgerRouter.get("/party/:partyId", async (req: AppRequest, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const firmId = typeof req.query.firm_id === "string" ? req.query.firm_id : null;
  const params: unknown[] = [req.params.partyId];
  const clauses = [`e.party_id = $1`, `e.entry_kind = 'party'`];

  if (firmId) {
    try {
      await requireActiveFirm(req.workspace!, firmId);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status ?? 400).json({ error: e.message ?? "Invalid firm" });
      return;
    }
    params.push(firmId);
    clauses.push(`e.firm_id = $${params.length}`);
  }
  params.push(limit);

  const result = await queryWorkspace(
    req.workspace!,
    `SELECT e.entry_id, e.firm_id, f.firm_name, e.party_id, e.entry_kind,
            e.date_time, e.type, e.amount, e.description, e.created_by,
            e.reverse_of_entry, e.transfer_id, e.created_at,
            u.name AS created_by_name
     FROM ledger_entries e
     JOIN firms f ON f.firm_id = e.firm_id
     JOIN users u ON u.user_id = e.created_by
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.date_time DESC, e.created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  res.json({
    firm_id: firmId,
    view: firmId ? "firm" : "workspace_summary",
    entries: result.rows.map((r) => decryptLedgerRow(req.dataKey ?? null, r)),
  });
});

const createSchema = z.object({
  firm_id: z.string().uuid(),
  party_id: z.string().uuid(),
  type: z.enum(["incoming", "outgoing"]),
  amount: z.number().positive().finite(),
  description: z.string().max(500).default(""),
});

ledgerRouter.post("/entries", requireDataKey, async (req: AppRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const dek = req.dataKey!;

  try {
    await assertFirmAccess(req.workspace!, req.user!, parsed.data.firm_id);
    const entry = await withTransaction(req.workspace!, async (client) => {
      await requireActiveFirm(req.workspace!, parsed.data.firm_id, client);

      const party = await client.query(
        `SELECT party_id, active FROM parties WHERE party_id = $1 FOR UPDATE`,
        [parsed.data.party_id],
      );
      if (!party.rows[0]) throw Object.assign(new Error("Party not found"), { status: 404 });
      if (!party.rows[0].active) {
        throw Object.assign(new Error("Party is inactive"), { status: 400 });
      }

      await ensureOpeningBalanceRow(client, {
        party_id: parsed.data.party_id,
        firm_id: parsed.data.firm_id,
        balance: sealAmount(dek, 0),
        created_by: req.user!.user_id,
      });

      const result = await client.query(
        `INSERT INTO ledger_entries
           (firm_id, party_id, entry_kind, date_time, type, amount, description,
            created_by, reverse_of_entry, transfer_id)
         VALUES ($1, $2, 'party', NOW(), $3, $4, $5, $6, NULL, NULL)
         RETURNING entry_id, firm_id, party_id, entry_kind, date_time, type, amount,
                   description, created_by, reverse_of_entry, transfer_id, created_at`,
        [
          parsed.data.firm_id,
          parsed.data.party_id,
          parsed.data.type,
          sealAmount(dek, parsed.data.amount),
          sealField(dek, parsed.data.description ?? ""),
          req.user!.user_id,
        ],
      );

      await lockOpeningBalanceIfNeeded(client, parsed.data.party_id, parsed.data.firm_id);
      return result.rows[0];
    });

    await writeAudit(req.workspace!, {
      actor_user_id: req.user!.user_id,
      action: "ledger.create",
      entity_type: "ledger_entry",
      entity_id: entry.entry_id,
      detail: {
        firm_id: entry.firm_id,
        party_id: entry.party_id,
        type: entry.type,
        amount: parsed.data.amount,
      },
      ip_address: req.clientIp,
      device: req.clientDevice,
    });
    await notifyOwners(req.workspace!, {
      title: entry.type === "incoming" ? "Money in" : "Money out",
      body: `${req.user!.name} recorded ${parsed.data.amount} (${entry.type})`,
      entity_type: "ledger_entry",
      entity_id: entry.entry_id,
      exclude_user_id: req.user!.user_id,
    });

    res.status(201).json({
      entry: {
        ...entry,
        amount: parsed.data.amount,
        description: parsed.data.description ?? "",
      },
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    throw err;
  }
});

ledgerRouter.post("/entries/:id/reverse", requireDataKey, async (req: AppRequest, res) => {
  const dek = req.dataKey!;
  try {
    const reversal = await withTransaction(req.workspace!, async (client) => {
      const original = await client.query(
        `SELECT * FROM ledger_entries WHERE entry_id = $1 FOR UPDATE`,
        [req.params.id],
      );
      const entry = original.rows[0];
      if (!entry) throw Object.assign(new Error("Entry not found"), { status: 404 });
      if (entry.entry_kind !== "party") {
        throw Object.assign(
          new Error("Transfer entries must be reversed via /transfers/:id/reverse"),
          { status: 400 },
        );
      }

      const already = await client.query(
        `SELECT entry_id FROM ledger_entries WHERE reverse_of_entry = $1 LIMIT 1`,
        [entry.entry_id],
      );
      if (already.rows[0]) {
        throw Object.assign(new Error("Entry already reversed"), { status: 409 });
      }

      await requireActiveFirm(req.workspace!, entry.firm_id, client);

      const reverseType = entry.type === "incoming" ? "outgoing" : "incoming";
      const amountPlain = openAmount(dek, entry.amount);
      const description =
        typeof req.body?.description === "string" && req.body.description.trim()
          ? req.body.description.trim()
          : `Reversal of ${entry.entry_id}`;

      const result = await client.query(
        `INSERT INTO ledger_entries
           (firm_id, party_id, entry_kind, date_time, type, amount, description,
            created_by, reverse_of_entry, transfer_id)
         VALUES ($1, $2, 'party', NOW(), $3, $4, $5, $6, $7, NULL)
         RETURNING entry_id, firm_id, party_id, entry_kind, date_time, type, amount,
                   description, created_by, reverse_of_entry, transfer_id, created_at`,
        [
          entry.firm_id,
          entry.party_id,
          reverseType,
          sealAmount(dek, amountPlain),
          sealField(dek, description),
          req.user!.user_id,
          entry.entry_id,
        ],
      );
      return { row: result.rows[0], amountPlain, description };
    });

    await writeAudit(req.workspace!, {
      actor_user_id: req.user!.user_id,
      action: "ledger.reverse",
      entity_type: "ledger_entry",
      entity_id: reversal.row.entry_id,
      detail: { reverse_of_entry: req.params.id, firm_id: reversal.row.firm_id },
      ip_address: req.clientIp,
      device: req.clientDevice,
    });

    res.status(201).json({
      entry: {
        ...reversal.row,
        amount: reversal.amountPlain,
        description: reversal.description,
      },
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    throw err;
  }
});
