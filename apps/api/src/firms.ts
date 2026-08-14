import type { PoolClient } from "pg";
import type { WorkspaceRecord } from "./workspaces.js";
import { queryWorkspace } from "./db.js";

export async function requireActiveFirm(
  workspace: WorkspaceRecord,
  firmId: string,
  client?: PoolClient,
) {
  const sql = `SELECT firm_id, firm_name, status, created_at
               FROM firms WHERE firm_id = $1`;
  const result = client
    ? await client.query(sql, [firmId])
    : await queryWorkspace(workspace, sql, [firmId]);

  const firm = result.rows[0];
  if (!firm) {
    throw Object.assign(new Error("Firm not found in this workspace"), { status: 404 });
  }
  if (firm.status !== "active") {
    throw Object.assign(new Error("Firm is archived"), { status: 400 });
  }
  return firm as {
    firm_id: string;
    firm_name: string;
    status: string;
    created_at: string;
  };
}

/** Party balance within one firm (opening + party entries only; transfers excluded). */
export function partyFirmBalanceSql(partyAlias = "p", firmParam = "$FIRM") {
  return `
    COALESCE((
      SELECT o.balance FROM opening_balances o
      WHERE o.party_id = ${partyAlias}.party_id AND o.firm_id = ${firmParam}
    ), 0)
    + COALESCE((
      SELECT SUM(CASE WHEN e.type = 'outgoing' THEN e.amount ELSE -e.amount END)
      FROM ledger_entries e
      WHERE e.party_id = ${partyAlias}.party_id
        AND e.firm_id = ${firmParam}
        AND e.entry_kind = 'party'
    ), 0)
  `;
}

/** Aggregate party balance across all firms (computed, never stored). */
export function partyAggregateBalanceSql(partyAlias = "p") {
  return `
    COALESCE((
      SELECT SUM(o.balance) FROM opening_balances o
      WHERE o.party_id = ${partyAlias}.party_id
    ), 0)
    + COALESCE((
      SELECT SUM(CASE WHEN e.type = 'outgoing' THEN e.amount ELSE -e.amount END)
      FROM ledger_entries e
      WHERE e.party_id = ${partyAlias}.party_id
        AND e.entry_kind = 'party'
    ), 0)
  `;
}

/** Lock opening balance once the first party entry exists for party+firm. */
export async function lockOpeningBalanceIfNeeded(
  client: PoolClient,
  partyId: string,
  firmId: string,
) {
  await client.query(
    `UPDATE opening_balances
     SET locked = TRUE
     WHERE party_id = $1 AND firm_id = $2 AND locked = FALSE`,
    [partyId, firmId],
  );
}

export async function ensureOpeningBalanceRow(
  client: PoolClient,
  input: {
    party_id: string;
    firm_id: string;
    /** Plain number or already-sealed text. */
    balance?: number | string;
    effective_date?: string | null;
    created_by?: string | null;
  },
) {
  const balanceValue =
    typeof input.balance === "string" ? input.balance : String(input.balance ?? 0);
  await client.query(
    `INSERT INTO opening_balances
       (party_id, firm_id, balance, effective_date, created_by, locked)
     VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, FALSE)
     ON CONFLICT (party_id, firm_id) DO NOTHING`,
    [
      input.party_id,
      input.firm_id,
      balanceValue,
      input.effective_date ?? null,
      input.created_by ?? null,
    ],
  );
}
