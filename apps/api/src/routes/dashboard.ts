import { Router } from "express";
import { requireAuth, type AppRequest } from "../auth.js";
import { computeOutstanding } from "../balances.js";
import { openAmount } from "../data-crypto.js";
import { queryWorkspace } from "../db.js";
import { assertFirmAccess, getAssignedFirmId } from "../firm-access.js";
import { requireActiveFirm } from "../firms.js";
import { requireLicense } from "../middleware.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth, requireLicense);

dashboardRouter.get("/", async (req: AppRequest, res) => {
  let firmId = typeof req.query.firm_id === "string" ? req.query.firm_id : null;
  let firmName: string | null = null;
  const dek = req.dataKey ?? null;

  // Employees always see their assigned firm only (no workspace-wide totals).
  if (req.user!.role === "employee") {
    const assigned = await getAssignedFirmId(req.workspace!, req.user!.user_id);
    if (!assigned) {
      res.status(403).json({ error: "Employee has no assigned firm" });
      return;
    }
    firmId = assigned;
  } else if (firmId) {
    try {
      await assertFirmAccess(req.workspace!, req.user!, firmId);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status ?? 403).json({ error: e.message ?? "Forbidden" });
      return;
    }
  }

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

  const todayRows = await queryWorkspace(
    req.workspace!,
    `SELECT type, amount FROM ledger_entries
     WHERE (date_time AT TIME ZONE 'UTC')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
       ${todayFirmClause}`,
    todayParams,
  );

  let today_incoming = 0;
  let today_outgoing = 0;
  for (const row of todayRows.rows) {
    const amount = openAmount(dek, row.amount);
    if (row.type === "incoming") today_incoming += amount;
    else today_outgoing += amount;
  }

  const outstanding_balance = await computeOutstanding(req.workspace!, dek, firmId);

  res.json({
    today_incoming,
    today_outgoing,
    outstanding_balance,
    today_transaction_count: todayRows.rows.length,
    firm_id: firmId,
    firm_name: firmName,
    view: firmId ? "firm" : "workspace_summary",
  });
});
