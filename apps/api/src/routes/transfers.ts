import { Router } from "express";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { requireAuth, requireRoles, type AppRequest } from "../auth.js";
import { openAmount, sealAmount, sealField } from "../data-crypto.js";
import { withTransaction } from "../db.js";
import { decryptTransferRow } from "../field-crypto.js";
import { requireActiveFirm } from "../firms.js";
import { requireDataKey, requireLicense } from "../middleware.js";

export const transfersRouter = Router();

transfersRouter.use(requireAuth, requireLicense);

transfersRouter.get("/", requireRoles("owner", "manager"), async (req: AppRequest, res) => {
  const { queryWorkspace } = await import("../db.js");
  const result = await queryWorkspace(
    req.workspace!,
    `SELECT t.transfer_id, t.source_firm_id, sf.firm_name AS source_firm_name,
            t.destination_firm_id, df.firm_name AS destination_firm_name,
            t.amount, t.description, t.created_by, u.name AS created_by_name,
            t.status, t.created_at
     FROM transfers t
     JOIN firms sf ON sf.firm_id = t.source_firm_id
     JOIN firms df ON df.firm_id = t.destination_firm_id
     JOIN users u ON u.user_id = t.created_by
     ORDER BY t.created_at DESC
     LIMIT 200`,
  );
  res.json({
    transfers: result.rows.map((r) => decryptTransferRow(req.dataKey ?? null, r)),
  });
});

const createSchema = z.object({
  source_firm_id: z.string().uuid(),
  destination_firm_id: z.string().uuid(),
  amount: z.number().positive().finite(),
  description: z.string().max(500).default(""),
});

transfersRouter.post(
  "/",
  requireDataKey,
  requireRoles("owner", "manager"),
  async (req: AppRequest, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if (parsed.data.source_firm_id === parsed.data.destination_firm_id) {
      res.status(400).json({ error: "Source and destination firms must be different" });
      return;
    }
    const dek = req.dataKey!;

    try {
      const result = await withTransaction(req.workspace!, async (client) => {
        const source = await requireActiveFirm(
          req.workspace!,
          parsed.data.source_firm_id,
          client,
        );
        const destination = await requireActiveFirm(
          req.workspace!,
          parsed.data.destination_firm_id,
          client,
        );

        const sealedAmount = sealAmount(dek, parsed.data.amount);
        const note =
          parsed.data.description?.trim() ||
          `Transfer ${source.firm_name} → ${destination.firm_name}`;
        const sealedNote = sealField(dek, note);

        const transfer = await client.query(
          `INSERT INTO transfers
             (source_firm_id, destination_firm_id, amount, description, created_by, status)
           VALUES ($1, $2, $3, $4, $5, 'posted')
           RETURNING transfer_id, source_firm_id, destination_firm_id, amount,
                     description, created_by, status, created_at`,
          [
            source.firm_id,
            destination.firm_id,
            sealedAmount,
            sealedNote,
            req.user!.user_id,
          ],
        );
        const t = transfer.rows[0];

        const out = await client.query(
          `INSERT INTO ledger_entries
             (firm_id, party_id, entry_kind, date_time, type, amount, description,
              created_by, reverse_of_entry, transfer_id)
           VALUES ($1, NULL, 'transfer', NOW(), 'outgoing', $2, $3, $4, NULL, $5)
           RETURNING entry_id`,
          [source.firm_id, sealedAmount, sealedNote, req.user!.user_id, t.transfer_id],
        );
        const inn = await client.query(
          `INSERT INTO ledger_entries
             (firm_id, party_id, entry_kind, date_time, type, amount, description,
              created_by, reverse_of_entry, transfer_id)
           VALUES ($1, NULL, 'transfer', NOW(), 'incoming', $2, $3, $4, NULL, $5)
           RETURNING entry_id`,
          [destination.firm_id, sealedAmount, sealedNote, req.user!.user_id, t.transfer_id],
        );

        return {
          transfer: {
            ...t,
            amount: parsed.data.amount,
            description: note,
          },
          entries: {
            outgoing_entry_id: out.rows[0].entry_id,
            incoming_entry_id: inn.rows[0].entry_id,
          },
        };
      });

      await writeAudit(req.workspace!, {
        actor_user_id: req.user!.user_id,
        action: "transfer.create",
        entity_type: "transfer",
        entity_id: result.transfer.transfer_id,
        detail: { amount: parsed.data.amount },
        ip_address: req.clientIp,
        device: req.clientDevice,
      });

      res.status(201).json(result);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      if (e.status) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      throw err;
    }
  },
);

transfersRouter.post(
  "/:id/reverse",
  requireDataKey,
  requireRoles("owner", "manager"),
  async (req: AppRequest, res) => {
    const dek = req.dataKey!;
    try {
      const result = await withTransaction(req.workspace!, async (client) => {
        const transferRes = await client.query(
          `SELECT * FROM transfers WHERE transfer_id = $1 FOR UPDATE`,
          [req.params.id],
        );
        const transfer = transferRes.rows[0];
        if (!transfer) {
          throw Object.assign(new Error("Transfer not found"), { status: 404 });
        }
        if (transfer.status === "reversed") {
          throw Object.assign(new Error("Transfer already reversed"), { status: 409 });
        }

        const entries = await client.query(
          `SELECT * FROM ledger_entries WHERE transfer_id = $1 FOR UPDATE`,
          [transfer.transfer_id],
        );
        if (entries.rows.length !== 2) {
          throw Object.assign(new Error("Transfer entries incomplete"), { status: 500 });
        }

        for (const entry of entries.rows) {
          const already = await client.query(
            `SELECT entry_id FROM ledger_entries WHERE reverse_of_entry = $1 LIMIT 1`,
            [entry.entry_id],
          );
          if (already.rows[0]) {
            throw Object.assign(new Error("Transfer already reversed"), { status: 409 });
          }
        }

        const reverseNote = sealField(dek, `Reversal of transfer ${transfer.transfer_id}`);
        const created: string[] = [];
        for (const entry of entries.rows) {
          const reverseType = entry.type === "incoming" ? "outgoing" : "incoming";
          const amountPlain = openAmount(dek, entry.amount);
          const r = await client.query(
            `INSERT INTO ledger_entries
               (firm_id, party_id, entry_kind, date_time, type, amount, description,
                created_by, reverse_of_entry, transfer_id)
             VALUES ($1, NULL, 'transfer', NOW(), $2, $3, $4, $5, $6, $7)
             RETURNING entry_id`,
            [
              entry.firm_id,
              reverseType,
              sealAmount(dek, amountPlain),
              reverseNote,
              req.user!.user_id,
              entry.entry_id,
              transfer.transfer_id,
            ],
          );
          created.push(r.rows[0].entry_id);
        }

        await client.query(`UPDATE transfers SET status = 'reversed' WHERE transfer_id = $1`, [
          transfer.transfer_id,
        ]);

        return {
          transfer_id: transfer.transfer_id,
          reversal_entry_ids: created,
        };
      });

      await writeAudit(req.workspace!, {
        actor_user_id: req.user!.user_id,
        action: "transfer.reverse",
        entity_type: "transfer",
        entity_id: result.transfer_id,
        detail: result,
        ip_address: req.clientIp,
        device: req.clientDevice,
      });

      res.status(201).json(result);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      if (e.status) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      throw err;
    }
  },
);
