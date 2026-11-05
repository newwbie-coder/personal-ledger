import { createHash } from "node:crypto";
import { getPool } from "./db.js";

const GENESIS = "0".repeat(64);
const BATCH = 5000;
const MAX_PROBLEMS = 50;

const TRACKED: Array<{ table: string; pk: string }> = [
  { table: "ledger_entries", pk: "entry_id" },
  { table: "transfers", pk: "transfer_id" },
  { table: "opening_balances", pk: "opening_balance_id" },
];

export interface ChainHead {
  seq: number;
  hash: string;
}

export interface ChainProblem {
  kind: "broken_link" | "altered" | "missing" | "untracked";
  table?: string;
  record_id?: string;
  seq?: number;
}

export interface ChainReport {
  ok: boolean;
  checked_links: number;
  checked_records: number;
  head: ChainHead;
  problems: ChainProblem[];
  verified_at: string;
}

export function linkHash(
  seq: string | number,
  prevHash: string,
  table: string,
  recordId: string,
  op: string,
  digest: string,
): string {
  return createHash("sha256")
    .update(`${seq}|${prevHash}|${table}|${recordId}|${op}|${digest}`, "utf8")
    .digest("hex");
}

export async function getChainHead(): Promise<ChainHead> {
  const result = await getPool().query<{ seq: string; hash: string }>(
    `SELECT seq, hash FROM chain_log ORDER BY seq DESC LIMIT 1`,
  );
  const row = result.rows[0];
  return row ? { seq: Number(row.seq), hash: row.hash } : { seq: 0, hash: GENESIS };
}

/** Does the point a phone saw earlier still exist, unchanged, in the chain? */
export async function checkCheckpoint(seq: number, hash: string): Promise<boolean> {
  if (seq === 0) return hash === GENESIS;
  const result = await getPool().query<{ hash: string }>(
    `SELECT hash FROM chain_log WHERE seq = $1`,
    [seq],
  );
  return result.rows[0]?.hash === hash;
}

export async function verifyChain(): Promise<ChainReport> {
  const pool = getPool();
  const problems: ChainProblem[] = [];
  const add = (p: ChainProblem) => {
    if (problems.length < MAX_PROBLEMS) problems.push(p);
  };

  let expectedSeq = 1;
  let prevHash = GENESIS;
  let checkedLinks = 0;
  let lastSeq = 0;
  for (;;) {
    const batch = await pool.query<{
      seq: string;
      record_table: string;
      record_id: string;
      op: string;
      record_digest: string;
      prev_hash: string;
      hash: string;
    }>(
      `SELECT seq, record_table, record_id, op, record_digest, prev_hash, hash
       FROM chain_log WHERE seq > $1 ORDER BY seq ASC LIMIT $2`,
      [lastSeq, BATCH],
    );
    if (batch.rows.length === 0) break;
    for (const row of batch.rows) {
      const seq = Number(row.seq);
      const expected = linkHash(
        row.seq,
        row.prev_hash,
        row.record_table,
        row.record_id,
        row.op,
        row.record_digest,
      );
      if (seq !== expectedSeq || row.prev_hash !== prevHash || row.hash !== expected) {
        add({ kind: "broken_link", seq, table: row.record_table, record_id: row.record_id });
      }
      prevHash = row.hash;
      expectedSeq = seq + 1;
      lastSeq = seq;
      checkedLinks++;
    }
  }

  const latest = await pool.query<{
    record_table: string;
    record_id: string;
    op: string;
    record_digest: string;
  }>(
    `SELECT DISTINCT ON (record_table, record_id) record_table, record_id, op, record_digest
     FROM chain_log
     ORDER BY record_table, record_id, seq DESC`,
  );
  const recorded = new Map<string, { op: string; digest: string }>();
  for (const row of latest.rows) {
    recorded.set(`${row.record_table}:${row.record_id}`, {
      op: row.op,
      digest: row.record_digest,
    });
  }

  let checkedRecords = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL TimeZone = 'UTC'");
    for (const { table, pk } of TRACKED) {
      const rows = await client.query<{ rid: string; digest: string }>(
        `SELECT t.${pk}::text AS rid, chain_row_digest('${table}', to_jsonb(t)) AS digest
         FROM ${table} t`,
      );
      for (const row of rows.rows) {
        checkedRecords++;
        const key = `${table}:${row.rid}`;
        const rec = recorded.get(key);
        recorded.delete(key);
        if (!rec || rec.op === "delete") {
          add({ kind: "untracked", table, record_id: row.rid });
        } else if (rec.digest !== row.digest) {
          add({ kind: "altered", table, record_id: row.rid });
        }
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  for (const [key, rec] of recorded) {
    if (rec.op === "delete") continue;
    const [table, recordId] = key.split(":");
    add({ kind: "missing", table, record_id: recordId });
  }

  const report: ChainReport = {
    ok: problems.length === 0,
    checked_links: checkedLinks,
    checked_records: checkedRecords,
    head: lastSeq ? { seq: lastSeq, hash: prevHash } : { seq: 0, hash: GENESIS },
    problems,
    verified_at: new Date().toISOString(),
  };
  lastReport = report;
  return report;
}

let lastReport: ChainReport | null = null;

export function lastChainReport(): ChainReport | null {
  return lastReport;
}
