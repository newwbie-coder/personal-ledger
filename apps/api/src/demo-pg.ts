/**
 * Local demo Postgres bootstrap (no Docker required).
 * Starts embedded PostgreSQL, creates control + workspace DBs.
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const dataDir = path.join(root, "apps/api/data/embedded-pg");
const port = Number(process.env.DEMO_PG_PORT ?? 54329);

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
    onLog: (msg) => process.stdout.write(`[pg] ${msg}`),
    onError: (msg) => process.stderr.write(`[pg:err] ${msg}`),
  });

  const alreadyInit = fs.existsSync(path.join(dataDir, "PG_VERSION"));
  if (!alreadyInit) {
    console.log("Initializing embedded Postgres data directory...");
    await pg.initialise();
  }

  console.log(`Starting embedded Postgres on port ${port}...`);
  await pg.start();

  for (const db of ["ledger_control", "ledger_workspace"]) {
    try {
      await pg.createDatabase(db);
      console.log(`Created database: ${db}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/already exists/i.test(message)) {
        console.log(`Database exists: ${db}`);
      } else {
        throw err;
      }
    }
  }

  console.log("");
  console.log("Embedded Postgres is running.");
  console.log(`CONTROL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${port}/ledger_control`);
  console.log(`Workspace DB host=127.0.0.1 port=${port} database=ledger_workspace user=postgres password=postgres`);
  console.log("");
  console.log("Keep this process open while using the demo. Ctrl+C to stop.");

  const stop = async () => {
    console.log("\nStopping embedded Postgres...");
    try {
      await pg.stop();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());

  // Keep alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
