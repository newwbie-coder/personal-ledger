import type { WorkspaceRecord } from "./workspaces.js";
import { queryWorkspace } from "./db.js";
import { computePartyFirmBalance, decryptPartyRow } from "./field-crypto.js";
import { openAmount, openText } from "./data-crypto.js";

/** Load openings + party entries and compute balances in-process (ciphertext-safe). */
export async function computeOutstanding(
  workspace: WorkspaceRecord,
  dek: Buffer | null,
  firmId: string | null,
): Promise<number> {
  const parties = await queryWorkspace(
    workspace,
    `SELECT party_id FROM parties WHERE active = TRUE`,
  );
  let total = 0;
  for (const p of parties.rows) {
    total += await computePartyBalance(workspace, dek, String(p.party_id), firmId);
  }
  return total;
}

export async function computePartyBalance(
  workspace: WorkspaceRecord,
  dek: Buffer | null,
  partyId: string,
  firmId: string | null,
): Promise<number> {
  const openingParams: unknown[] = [partyId];
  let openingSql: string;
  if (firmId) {
    openingParams.push(firmId);
    openingSql = `SELECT balance FROM opening_balances WHERE party_id = $1 AND firm_id = $2`;
  } else {
    openingSql = `SELECT balance FROM opening_balances WHERE party_id = $1`;
  }
  const openings = await queryWorkspace(workspace, openingSql, openingParams);
  let opening = 0;
  for (const row of openings.rows) {
    opening += openAmount(dek, row.balance);
  }

  const entryParams: unknown[] = [partyId];
  let firmClause = "";
  if (firmId) {
    entryParams.push(firmId);
    firmClause = `AND firm_id = $2`;
  }
  const entries = await queryWorkspace(
    workspace,
    `SELECT type, amount FROM ledger_entries
     WHERE party_id = $1 AND entry_kind = 'party' ${firmClause}`,
    entryParams,
  );
  return computePartyFirmBalance({
    opening,
    entries: entries.rows.map((e) => ({
      type: String(e.type),
      amount: openAmount(dek, e.amount),
    })),
  });
}

export async function listPartiesWithBalances(
  workspace: WorkspaceRecord,
  dek: Buffer | null,
  input: { q?: string; firmId?: string | null; includeInactive?: boolean },
) {
  const clauses: string[] = [];
  if (!input.includeInactive) clauses.push(`active = TRUE`);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await queryWorkspace(
    workspace,
    `SELECT party_id, party_name, phone, active, created_at
     FROM parties ${where}
     ORDER BY created_at ASC
     LIMIT 500`,
  );

  const q = (input.q ?? "").trim().toLowerCase();
  const parties: Array<Record<string, unknown> & { current_balance: number }> = [];
  for (const raw of result.rows) {
    const row = decryptPartyRow(dek, raw);
    const name = String(row.party_name ?? "").toLowerCase();
    const phone = String(row.phone ?? "");
    if (q && !name.includes(q) && !phone.includes(q)) continue;
    const current_balance = await computePartyBalance(
      workspace,
      dek,
      String(row.party_id),
      input.firmId ?? null,
    );
    parties.push({ ...row, current_balance });
    if (parties.length >= 200) break;
  }

  parties.sort((a, b) =>
    String(a.party_name).localeCompare(String(b.party_name), undefined, {
      sensitivity: "base",
    }),
  );
  return parties;
}

export async function findPartyIdByName(
  workspace: WorkspaceRecord,
  dek: Buffer | null,
  partyName: string,
  client?: {
    query: (
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[] }>;
  },
): Promise<string | null> {
  const target = partyName.trim().toLowerCase();
  const result = client
    ? await client.query(`SELECT party_id, party_name FROM parties`)
    : await queryWorkspace(workspace, `SELECT party_id, party_name FROM parties`);
  for (const raw of result.rows) {
    if (openText(dek, raw.party_name).toLowerCase() === target) {
      return String(raw.party_id);
    }
  }
  return null;
}
