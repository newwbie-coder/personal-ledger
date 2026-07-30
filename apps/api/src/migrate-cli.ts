import "./load-env.js";
import { ensureControlSchema } from "./control-db.js";
import { findWorkspaceBySlug, listWorkspaces } from "./workspaces.js";
import { getWorkspacePool } from "./db.js";
import { runMigrationsOnPool } from "./migrate.js";

const slug = process.argv[2];

async function main() {
  await ensureControlSchema();
  const targets = slug
    ? [await findWorkspaceBySlug(slug)].filter(Boolean)
    : await listWorkspaces();

  if (!targets.length) {
    console.log("No workspaces found. Pass a slug or create one via setup.");
    process.exit(0);
  }

  for (const ws of targets) {
    if (!ws) continue;
    console.log(`Migrating workspace ${ws.slug}...`);
    const pool = getWorkspacePool(ws);
    const result = await runMigrationsOnPool(pool);
    console.log(`  done:`, result);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
