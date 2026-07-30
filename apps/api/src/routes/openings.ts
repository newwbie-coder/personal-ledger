import { Router } from "express";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { requireAuth, requireRoles, type AppRequest } from "../auth.js";
import { queryWorkspace, withTransaction } from "../db.js";
import { requireActiveFirm } from "../firms.js";
import { requireLicense } from "../middleware.js";

export const openingsRouter = Router();

openingsRouter.use(requireAuth, requireLicense);

openingsRouter.get("/", requireRoles("owner", "manager"), async (req: AppRequest, res) => {
  const firmId = typeof req.query.firm_id === "string" ? req.query.firm_id : null;
  const params: unknown[] = [];
  let firmClause = "";
  if (firmId) {
    params.push(firmId);
    firmClause = `AND o.firm_id = $${params.length}`;
  }

  const result = await queryWorkspace(
    req.workspace!,
    `SELECT o.opening_balance_id, o.party_id, p.party_name, o.firm_id, f.firm_name,
            o.balance, o.effective_date, o.created_by, o.created_at, o.locked
     FROM opening_balances o
     JOIN parties p ON p.party_id = o.party_id
     JOIN firms f ON f.firm_id = o.firm_id
     WHERE 1=1 ${firmClause}
     ORDER BY p.party_name ASC, f.created_at ASC`,
    params,
  );

  res.json({
    openings: result.rows.map((r) => ({
      ...r,
      balance: Number(r.balance),
      effective_date: r.effective_date
        ? new Date(r.effective_date).toISOString().slice(0, 10)
        : null,
    })),
  });
});

openingsRouter.get("/template.csv", requireRoles("owner", "manager"), (_req, res) => {
  const csv = [
    "party_name,firm_name,opening_balance,effective_date,phone",
    "ABC Traders,Main Firm,25000,2026-07-29,9876543210",
    "XYZ Agencies,Main Firm,-8500,2026-07-29,",
    "Ramesh,Chennai Branch,3000,2026-07-29,",
  ].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="opening-balances-template.csv"');
  res.send(csv);
});

const upsertSchema = z.object({
  party_id: z.string().uuid().optional(),
  party_name: z.string().min(1).max(200).optional(),
  phone: z.string().max(32).optional().nullable(),
  firm_id: z.string().uuid().optional(),
  firm_name: z.string().min(1).max(200).optional(),
  balance: z.number().finite(),
  effective_date: z.string().optional(),
});

openingsRouter.put("/", requireRoles("owner", "manager"), async (req: AppRequest, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!parsed.data.party_id && !parsed.data.party_name) {
    res.status(400).json({ error: "party_id or party_name required" });
    return;
  }
  if (!parsed.data.firm_id && !parsed.data.firm_name) {
    res.status(400).json({ error: "firm_id or firm_name required" });
    return;
  }

  try {
    const row = await withTransaction(req.workspace!, async (client) => {
      let firmId = parsed.data.firm_id;
      if (!firmId) {
        const firm = await client.query(
          `SELECT firm_id FROM firms
           WHERE status = 'active' AND LOWER(firm_name) = LOWER($1)
           LIMIT 1`,
          [parsed.data.firm_name],
        );
        if (!firm.rows[0]) {
          throw Object.assign(new Error(`Firm not found: ${parsed.data.firm_name}`), {
            status: 404,
          });
        }
        firmId = firm.rows[0].firm_id as string;
      }
      if (!firmId) {
        throw Object.assign(new Error("firm_id or firm_name required"), { status: 400 });
      }
      await requireActiveFirm(req.workspace!, firmId, client);

      let partyId = parsed.data.party_id;
      if (!partyId) {
        const existing = await client.query(
          `SELECT party_id FROM parties WHERE LOWER(party_name) = LOWER($1) LIMIT 1`,
          [parsed.data.party_name],
        );
        if (existing.rows[0]) {
          partyId = existing.rows[0].party_id;
        } else {
          const created = await client.query(
            `INSERT INTO parties (party_name, phone, opening_balance, active)
             VALUES ($1, $2, 0, TRUE)
             RETURNING party_id`,
            [parsed.data.party_name!.trim(), parsed.data.phone?.trim() || null],
          );
          partyId = created.rows[0].party_id;
        }
      }

      const current = await client.query(
        `SELECT * FROM opening_balances WHERE party_id = $1 AND firm_id = $2 FOR UPDATE`,
        [partyId, firmId],
      );
      if (current.rows[0]?.locked) {
        throw Object.assign(
          new Error(
            "Opening balance is locked because transactions already exist for this party in this firm",
          ),
          { status: 409 },
        );
      }

      const hasEntries = await client.query(
        `SELECT 1 FROM ledger_entries
         WHERE party_id = $1 AND firm_id = $2 AND entry_kind = 'party'
         LIMIT 1`,
        [partyId, firmId],
      );
      if (hasEntries.rows[0]) {
        await client.query(
          `UPDATE opening_balances SET locked = TRUE WHERE party_id = $1 AND firm_id = $2`,
          [partyId, firmId],
        );
        throw Object.assign(
          new Error(
            "Opening balance is locked because transactions already exist for this party in this firm",
          ),
          { status: 409 },
        );
      }

      const upsert = await client.query(
        `INSERT INTO opening_balances
           (party_id, firm_id, balance, effective_date, created_by, locked)
         VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, FALSE)
         ON CONFLICT (party_id, firm_id) DO UPDATE SET
           balance = EXCLUDED.balance,
           effective_date = EXCLUDED.effective_date,
           created_by = EXCLUDED.created_by
         WHERE opening_balances.locked = FALSE
         RETURNING *`,
        [
          partyId,
          firmId,
          parsed.data.balance,
          parsed.data.effective_date ?? null,
          req.user!.user_id,
        ],
      );

      if (!upsert.rows[0]) {
        throw Object.assign(new Error("Opening balance is locked"), { status: 409 });
      }

      return upsert.rows[0];
    });

    await writeAudit(req.workspace!, {
      actor_user_id: req.user!.user_id,
      action: "opening.upsert",
      entity_type: "opening_balance",
      entity_id: row.opening_balance_id,
      detail: {
        party_id: row.party_id,
        firm_id: row.firm_id,
        balance: Number(row.balance),
      },
      ip_address: req.clientIp,
      device: req.clientDevice,
    });

    res.json({
      opening: {
        ...row,
        balance: Number(row.balance),
        effective_date: new Date(row.effective_date).toISOString().slice(0, 10),
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

const importSchema = z.object({
  csv: z.string().min(1),
});

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/** Accept YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY (common Excel formats). */
function normalizeEffectiveDate(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    const year = dmy[3];
    return `${year}-${month}-${day}`;
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return null;
}

openingsRouter.post("/import", requireRoles("owner", "manager"), async (req: AppRequest, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "csv text required" });
    return;
  }

  const lines = parsed.data.csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    res.status(400).json({ error: "CSV must include a header and at least one data row" });
    return;
  }

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const idx = {
    party_name: header.indexOf("party_name"),
    firm_name: header.indexOf("firm_name"),
    opening_balance: header.findIndex((h) =>
      ["opening_balance", "balance", "amount"].includes(h),
    ),
    effective_date: header.indexOf("effective_date"),
    phone: header.indexOf("phone"),
  };
  if (idx.party_name < 0 || idx.firm_name < 0 || idx.opening_balance < 0) {
    res.status(400).json({
      error: "CSV header must include party_name, firm_name, opening_balance",
    });
    return;
  }

  const results: Array<{
    row: number;
    party_name: string;
    firm_name: string;
    ok: boolean;
    error?: string;
  }> = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const party_name = cells[idx.party_name] ?? "";
    const firm_name = cells[idx.firm_name] ?? "";
    const balanceRaw = cells[idx.opening_balance] ?? "0";
    const effective_date =
      idx.effective_date >= 0
        ? normalizeEffectiveDate(cells[idx.effective_date] || undefined) ?? undefined
        : undefined;
    const phone = idx.phone >= 0 ? cells[idx.phone] || null : null;
    const balance = Number(String(balanceRaw).replace(/,/g, ""));

    if (!party_name || !firm_name || !Number.isFinite(balance)) {
      results.push({
        row: i + 1,
        party_name,
        firm_name,
        ok: false,
        error: "Invalid party_name, firm_name, or opening_balance",
      });
      continue;
    }

    try {
      await withTransaction(req.workspace!, async (client) => {
        const firm = await client.query(
          `SELECT firm_id FROM firms
           WHERE status = 'active' AND LOWER(firm_name) = LOWER($1)
           LIMIT 1`,
          [firm_name],
        );
        if (!firm.rows[0]) {
          throw Object.assign(new Error(`Firm not found: ${firm_name}`), { status: 404 });
        }
        const firmId = firm.rows[0].firm_id as string;

        let partyId: string;
        const existing = await client.query(
          `SELECT party_id FROM parties WHERE LOWER(party_name) = LOWER($1) LIMIT 1`,
          [party_name],
        );
        if (existing.rows[0]) {
          partyId = existing.rows[0].party_id;
        } else {
          const created = await client.query(
            `INSERT INTO parties (party_name, phone, opening_balance, active)
             VALUES ($1, $2, 0, TRUE)
             RETURNING party_id`,
            [party_name.trim(), phone],
          );
          partyId = created.rows[0].party_id;
        }

        const current = await client.query(
          `SELECT locked FROM opening_balances WHERE party_id = $1 AND firm_id = $2 FOR UPDATE`,
          [partyId, firmId],
        );
        if (current.rows[0]?.locked) {
          throw Object.assign(new Error("Opening balance locked"), { status: 409 });
        }
        const hasEntries = await client.query(
          `SELECT 1 FROM ledger_entries
           WHERE party_id = $1 AND firm_id = $2 AND entry_kind = 'party' LIMIT 1`,
          [partyId, firmId],
        );
        if (hasEntries.rows[0]) {
          throw Object.assign(new Error("Opening balance locked (entries exist)"), {
            status: 409,
          });
        }

        await client.query(
          `INSERT INTO opening_balances
             (party_id, firm_id, balance, effective_date, created_by, locked)
           VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, FALSE)
           ON CONFLICT (party_id, firm_id) DO UPDATE SET
             balance = EXCLUDED.balance,
             effective_date = EXCLUDED.effective_date,
             created_by = EXCLUDED.created_by
           WHERE opening_balances.locked = FALSE`,
          [partyId, firmId, balance, effective_date ?? null, req.user!.user_id],
        );
      });
      results.push({ row: i + 1, party_name, firm_name, ok: true });
    } catch (err: unknown) {
      results.push({
        row: i + 1,
        party_name,
        firm_name,
        ok: false,
        error: err instanceof Error ? err.message : "Import failed",
      });
    }
  }

  const imported = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  await writeAudit(req.workspace!, {
    actor_user_id: req.user!.user_id,
    action: "opening.import",
    entity_type: "opening_balance",
    detail: { imported, failed },
    ip_address: req.clientIp,
    device: req.clientDevice,
  });

  res.json({ imported, failed, results });
});
