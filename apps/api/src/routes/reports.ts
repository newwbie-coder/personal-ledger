import { Router } from "express";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { requireAuth, requireRoles, type AppRequest } from "../auth.js";
import { openAmount, openText } from "../data-crypto.js";
import { queryWorkspace } from "../db.js";
import { requireActiveFirm } from "../firms.js";
import { requireLicense } from "../middleware.js";

export const reportsRouter = Router();

reportsRouter.use(requireAuth, requireLicense);
reportsRouter.use(requireRoles("owner", "manager"));

const statementSchema = z.object({
  party_id: z.string().uuid(),
  firm_id: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

interface StatementEntry {
  entry_id: string;
  firm_id: string;
  firm_name: string;
  date_time: string;
  type: string;
  amount: number;
  description: string;
  reverse_of_entry: string | null;
  created_by_name: string;
  balance_after: number;
}

interface StatementResult {
  view: "firm" | "workspace_summary";
  firm_id: string | null;
  firm_name: string | null;
  party: {
    party_id: string;
    party_name: string;
    phone: string | null;
    opening_balance: number;
    current_balance: number;
    active: boolean;
  };
  entries: StatementEntry[];
  from: string | null;
  to: string | null;
}

async function loadStatement(
  req: AppRequest,
  party_id: string,
  firm_id?: string,
  from?: string,
  to?: string,
): Promise<StatementResult | null> {
  const dek = req.dataKey ?? null;
  let firmName: string | null = null;
  if (firm_id) {
    const firm = await requireActiveFirm(req.workspace!, firm_id);
    firmName = firm.firm_name;
  }

  const partyResult = await queryWorkspace<{
    party_id: string;
    party_name: string;
    phone: string | null;
    active: boolean;
  }>(
    req.workspace!,
    `SELECT party_id, party_name, phone, active FROM parties WHERE party_id = $1`,
    [party_id],
  );
  const rawParty = partyResult.rows[0];
  if (!rawParty) return null;
  const party = {
    party_id: rawParty.party_id,
    party_name: openText(dek, rawParty.party_name),
    phone: rawParty.phone == null || rawParty.phone === "" ? null : openText(dek, rawParty.phone),
    active: rawParty.active,
  };

  const openingParams: unknown[] = [party_id];
  let openingSql: string;
  if (firm_id) {
    openingParams.push(firm_id);
    openingSql = `SELECT balance FROM opening_balances WHERE party_id = $1 AND firm_id = $2`;
  } else {
    openingSql = `SELECT balance FROM opening_balances WHERE party_id = $1`;
  }
  const openingRows = await queryWorkspace(req.workspace!, openingSql, openingParams);
  let openingBalance = 0;
  for (const row of openingRows.rows) {
    openingBalance += openAmount(dek, row.balance);
  }

  const params: unknown[] = [party_id];
  const clauses = [`e.party_id = $1`, `e.entry_kind = 'party'`];
  if (firm_id) {
    params.push(firm_id);
    clauses.push(`e.firm_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    clauses.push(`e.date_time >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    clauses.push(`e.date_time <= $${params.length}::timestamptz`);
  }

  const entries = await queryWorkspace<{
    entry_id: string;
    firm_id: string;
    firm_name: string;
    date_time: string;
    type: string;
    amount: string;
    description: string;
    reverse_of_entry: string | null;
    created_by_name: string;
  }>(
    req.workspace!,
    `SELECT e.entry_id, e.firm_id, f.firm_name, e.date_time, e.type, e.amount,
            e.description, e.reverse_of_entry, u.name AS created_by_name
     FROM ledger_entries e
     JOIN firms f ON f.firm_id = e.firm_id
     JOIN users u ON u.user_id = e.created_by
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.date_time ASC, e.created_at ASC`,
    params,
  );

  let running = openingBalance;
  const rows: StatementEntry[] = entries.rows.map((e) => {
    const amount = openAmount(dek, e.amount);
    running += e.type === "outgoing" ? amount : -amount;
    return {
      entry_id: e.entry_id,
      firm_id: e.firm_id,
      firm_name: e.firm_name,
      date_time: e.date_time,
      type: e.type,
      amount,
      description: openText(dek, e.description ?? ""),
      reverse_of_entry: e.reverse_of_entry,
      created_by_name: e.created_by_name,
      balance_after: running,
    };
  });

  return {
    view: firm_id ? "firm" : "workspace_summary",
    firm_id: firm_id ?? null,
    firm_name: firmName,
    party: {
      party_id: party.party_id,
      party_name: party.party_name,
      phone: party.phone,
      opening_balance: openingBalance,
      current_balance: running,
      active: party.active,
    },
    entries: rows,
    from: from ?? null,
    to: to ?? null,
  };
}

reportsRouter.get("/statement", async (req: AppRequest, res) => {
  const parsed = statementSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const data = await loadStatement(
      req,
      parsed.data.party_id,
      parsed.data.firm_id,
      parsed.data.from,
      parsed.data.to,
    );
    if (!data) {
      res.status(404).json({ error: "Party not found" });
      return;
    }
    res.json(data);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    throw err;
  }
});

reportsRouter.get("/statement.pdf", async (req: AppRequest, res) => {
  const parsed = statementSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const data = await loadStatement(
      req,
      parsed.data.party_id,
      parsed.data.firm_id,
      parsed.data.from,
      parsed.data.to,
    );
    if (!data) {
      res.status(404).json({ error: "Party not found" });
      return;
    }

    const company = await queryWorkspace<{ company_name: string }>(
      req.workspace!,
      `SELECT company_name FROM companies LIMIT 1`,
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="statement-${data.party.party_name.replace(/\s+/g, "-")}.pdf"`,
    );

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(18).text(company.rows[0]?.company_name ?? req.workspace!.company_name);
    doc.moveDown(0.5);
    doc.fontSize(14).text("Party Statement");
    doc.fontSize(11).fillColor("#333");
    doc.text(`Party: ${data.party.party_name}`);
    doc.text(
      data.firm_name
        ? `Firm: ${data.firm_name}`
        : "View: Workspace Summary",
    );
    if (data.party.phone) doc.text(`Phone: ${data.party.phone}`);
    doc.text(`Opening balance: ${data.party.opening_balance.toFixed(2)}`);
    doc.text(`Current balance: ${data.party.current_balance.toFixed(2)}`);
    if (data.from || data.to) {
      doc.text(`Period: ${data.from ?? "…"} → ${data.to ?? "…"}`);
    }
    doc.moveDown();

    doc.fontSize(10).fillColor("#000");
    doc.text("Date", 50, doc.y, { continued: true, width: 80 });
    doc.text("Firm", 130, doc.y, { continued: true, width: 70 });
    doc.text("Type", 200, doc.y, { continued: true, width: 55 });
    doc.text("Amount", 255, doc.y, { continued: true, width: 60 });
    doc.text("Balance", 315, doc.y, { continued: true, width: 60 });
    doc.text("Description", 375, doc.y);
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.3);

    for (const entry of data.entries) {
      if (doc.y > 720) doc.addPage();
      const date = new Date(entry.date_time).toLocaleString();
      doc.fontSize(8);
      doc.text(date, 50, doc.y, { continued: true, width: 80 });
      doc.text(entry.firm_name, 130, doc.y, { continued: true, width: 70 });
      doc.text(String(entry.type), 200, doc.y, { continued: true, width: 55 });
      doc.text(entry.amount.toFixed(2), 255, doc.y, { continued: true, width: 60 });
      doc.text(entry.balance_after.toFixed(2), 315, doc.y, { continued: true, width: 60 });
      doc.text(String(entry.description || "—"), 375, doc.y, { width: 175 });
      doc.moveDown(0.4);
    }

    doc.end();
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    throw err;
  }
});
