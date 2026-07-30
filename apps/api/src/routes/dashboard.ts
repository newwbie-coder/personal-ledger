import { Router } from "express";
import { requireAuth, type AppRequest } from "../auth.js";
import { queryWorkspace } from "../db.js";
import { requireActiveFirm } from "../firms.js";
import { requireLicense } from "../middleware.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth, requireLicense);

dashboardRouter.get("/", async (req: AppRequest, res) => {
  const firmId = typeof req.query.firm_id === "string" ? req.query.firm_id : null;
  let firmName: string | null = null;

  if (firmId) {
    try {
      const firm = await requireActiveFirm(req.workspace!, firmId);
      firmName = firm.firm_name;
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status ?? 400).json({ error: e.message ?? "Invalid firm" });
      return;
    }
  }

  const todayParams: unknown[] = [];
  let todayFirmClause = "";
  if (firmId) {
    todayParams.push(firmId);
    todayFirmClause = `AND firm_id = $1`;
  }

  const today = await queryWorkspace<{
    today_incoming: string;
    today_outgoing: string;
    today_transaction_count: string;
  }>(
    req.workspace!,
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'incoming' THEN amount ELSE 0 END), 0)::text AS today_incoming,
       COALESCE(SUM(CASE WHEN type = 'outgoing' THEN amount ELSE 0 END), 0)::text AS today_outgoing,
       COUNT(*)::text AS today_transaction_count
     FROM ledger_entries
     WHERE (date_time AT TIME ZONE 'UTC')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
       ${todayFirmClause}`,
    todayParams,
  );

  // Outstanding = sum of party balances (transfers excluded). Always computed.
  let outstandingSql: string;
  const outstandingParams: unknown[] = [];
  if (firmId) {
    outstandingParams.push(firmId);
    outstandingSql = `
      SELECT COALESCE(SUM(
        COALESCE(o.balance, 0)
        + COALESCE((
          SELECT SUM(CASE WHEN e.type = 'outgoing' THEN e.amount ELSE -e.amount END)
          FROM ledger_entries e
          WHERE e.party_id = p.party_id
            AND e.firm_id = $1
            AND e.entry_kind = 'party'
        ), 0)
      ), 0)::text AS outstanding_balance
      FROM parties p
      LEFT JOIN opening_balances o
        ON o.party_id = p.party_id AND o.firm_id = $1
      WHERE p.active = TRUE
    `;
  } else {
    outstandingSql = `
      SELECT COALESCE(SUM(
        COALESCE((
          SELECT SUM(o.balance) FROM opening_balances o
          WHERE o.party_id = p.party_id
        ), 0)
        + COALESCE((
          SELECT SUM(CASE WHEN e.type = 'outgoing' THEN e.amount ELSE -e.amount END)
          FROM ledger_entries e
          WHERE e.party_id = p.party_id AND e.entry_kind = 'party'
        ), 0)
      ), 0)::text AS outstanding_balance
      FROM parties p
      WHERE p.active = TRUE
    `;
  }

  const outstanding = await queryWorkspace<{ outstanding_balance: string }>(
    req.workspace!,
    outstandingSql,
    outstandingParams,
  );

  const row = today.rows[0];
  res.json({
    today_incoming: Number(row?.today_incoming ?? 0),
    today_outgoing: Number(row?.today_outgoing ?? 0),
    outstanding_balance: Number(outstanding.rows[0]?.outstanding_balance ?? 0),
    today_transaction_count: Number(row?.today_transaction_count ?? 0),
    firm_id: firmId,
    firm_name: firmName,
    view: firmId ? "firm" : "workspace_summary",
  });
});
