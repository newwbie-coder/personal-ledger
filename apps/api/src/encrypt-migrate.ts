import type { Pool, PoolClient } from "pg";
import {
  deriveKek,
  generateDek,
  isSealedField,
  sealAmount,
  sealField,
  wrapDek,
} from "./data-crypto.js";
import { getWorkspacePool } from "./db.js";
import { runMigrationsOnPool } from "./migrate.js";
import {
  setWorkspaceWrappedDataKey,
  type WorkspaceRecord,
} from "./workspaces.js";

async function sealColumnIfPlain(
  client: PoolClient,
  table: string,
  idCol: string,
  id: string,
  col: string,
  plain: string,
  dek: Buffer,
  asAmount: boolean,
) {
  if (isSealedField(plain)) return;
  const sealed = asAmount ? sealAmount(dek, Number(plain)) : sealField(dek, plain ?? "");
  await client.query(`UPDATE ${table} SET ${col} = $1 WHERE ${idCol} = $2`, [sealed, id]);
}

/**
 * One-time: ensure DEK exists on control row, seal plaintext business fields,
 * mark app_metadata.encryption = envelope_v1.
 */
export async function migrateWorkspaceToEnvelope(
  workspace: WorkspaceRecord,
): Promise<{ sealed_rows: number; created_dek: boolean }> {
  await runMigrationsOnPool(getWorkspacePool(workspace));

  let dek: Buffer;
  let created_dek = false;
  if (workspace.wrapped_data_key) {
    const { unwrapWorkspaceDek } = await import("./workspaces.js");
    dek = unwrapWorkspaceDek(workspace);
  } else {
    dek = generateDek();
    const kek = deriveKek({
      license_id: workspace.license_id,
      company_uuid: workspace.company_uuid,
      activation_token: workspace.activation_token,
    });
    const wrapped = wrapDek(kek, dek);
    await setWorkspaceWrappedDataKey(workspace.workspace_id, wrapped);
    workspace.wrapped_data_key = wrapped;
    created_dek = true;
  }

  const pool = getWorkspacePool(workspace);
  const client = await pool.connect();
  let sealed_rows = 0;
  try {
    await client.query("BEGIN");

    const parties = await client.query(`SELECT party_id, party_name, phone FROM parties`);
    for (const row of parties.rows) {
      if (!isSealedField(String(row.party_name))) {
        await sealColumnIfPlain(
          client,
          "parties",
          "party_id",
          row.party_id,
          "party_name",
          String(row.party_name),
          dek,
          false,
        );
        sealed_rows++;
      }
      if (row.phone != null && row.phone !== "" && !isSealedField(String(row.phone))) {
        await sealColumnIfPlain(
          client,
          "parties",
          "party_id",
          row.party_id,
          "phone",
          String(row.phone),
          dek,
          false,
        );
        sealed_rows++;
      }
    }

    const entries = await client.query(
      `SELECT entry_id, amount, description FROM ledger_entries`,
    );
    for (const row of entries.rows) {
      if (!isSealedField(String(row.amount))) {
        await sealColumnIfPlain(
          client,
          "ledger_entries",
          "entry_id",
          row.entry_id,
          "amount",
          String(row.amount),
          dek,
          true,
        );
        sealed_rows++;
      }
      if (!isSealedField(String(row.description ?? ""))) {
        await sealColumnIfPlain(
          client,
          "ledger_entries",
          "entry_id",
          row.entry_id,
          "description",
          String(row.description ?? ""),
          dek,
          false,
        );
        sealed_rows++;
      }
    }

    const openings = await client.query(
      `SELECT opening_balance_id, balance FROM opening_balances`,
    );
    for (const row of openings.rows) {
      if (!isSealedField(String(row.balance))) {
        await sealColumnIfPlain(
          client,
          "opening_balances",
          "opening_balance_id",
          row.opening_balance_id,
          "balance",
          String(row.balance),
          dek,
          true,
        );
        sealed_rows++;
      }
    }

    const transfers = await client.query(
      `SELECT transfer_id, amount, description FROM transfers`,
    );
    for (const row of transfers.rows) {
      if (!isSealedField(String(row.amount))) {
        await sealColumnIfPlain(
          client,
          "transfers",
          "transfer_id",
          row.transfer_id,
          "amount",
          String(row.amount),
          dek,
          true,
        );
        sealed_rows++;
      }
      if (!isSealedField(String(row.description ?? ""))) {
        await sealColumnIfPlain(
          client,
          "transfers",
          "transfer_id",
          row.transfer_id,
          "description",
          String(row.description ?? ""),
          dek,
          false,
        );
        sealed_rows++;
      }
    }

    await client.query(
      `UPDATE app_metadata SET encryption = 'envelope_v1' WHERE id = 1`,
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { sealed_rows, created_dek };
}

/** After attach: verify we can open the DEK and read one party row. */
export async function verifyWorkspaceDecrypt(workspace: WorkspaceRecord): Promise<boolean> {
  const { unwrapWorkspaceDek } = await import("./workspaces.js");
  const { openText } = await import("./data-crypto.js");
  const dek = unwrapWorkspaceDek(workspace);
  const pool = getWorkspacePool(workspace);
  const result = await pool.query(`SELECT party_name FROM parties LIMIT 1`);
  if (!result.rows[0]) return true;
  openText(dek, result.rows[0].party_name);
  return true;
}

export async function prepareEmptyTarget(pool: Pool): Promise<void> {
  await runMigrationsOnPool(pool);
}
