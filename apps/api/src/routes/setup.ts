import { SCHEMA_VERSION } from "@ledger/db";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import type { AppRequest } from "../auth.js";
import { getWorkspacePool, testDatabaseUrl } from "../db.js";
import { buildDatabaseUrl, pgPoolOptions, type DbProvider } from "../db-url.js";
import { activateLicense, issueLicense } from "../license-client.js";
import { runMigrationsOnPool } from "../migrate.js";
import {
  createWorkspace,
  findWorkspaceBySlug,
  publicWorkspace,
} from "../workspaces.js";

export const setupRouter = Router();

/** Issue a fresh license for production setup. Requires x-admin-secret. */
setupRouter.post("/issue-license", async (req, res) => {
  const secret = req.header("x-admin-secret");
  const expected = process.env.LICENSE_ADMIN_SECRET ?? "dev-admin-secret";
  if (secret !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const license = await issueLicense({
      maximum_users: Number(req.body?.maximum_users) || 10,
      edition: typeof req.body?.edition === "string" ? req.body.edition : "standard",
      company_name:
        typeof req.body?.company_name === "string" ? req.body.company_name : undefined,
    });
    res.status(201).json(license);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to issue license",
    });
  }
});

const connectionFields = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(5432),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  ssl: z.boolean().optional(),
});

function resolveDatabaseUrl(body: unknown): { url: string; fields?: z.infer<typeof connectionFields> } {
  const asFields = connectionFields.safeParse(body);
  if (asFields.success) {
    return { url: buildDatabaseUrl(asFields.data), fields: asFields.data };
  }
  // Backward-compatible: allow URI for support/migration tools only
  const asUri = z.object({ database_url: z.string().min(1) }).safeParse(body);
  if (asUri.success) {
    return { url: asUri.data.database_url };
  }
  throw new Error("Provide host, port, database, username, and password");
}

setupRouter.post("/test-connection", async (req, res) => {
  try {
    const { url, fields } = resolveDatabaseUrl(req.body);
    await testDatabaseUrl(url, fields?.host);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Connection failed",
    });
  }
});

setupRouter.get("/slug-available", async (req, res) => {
  const slug = String(req.query.slug ?? "").toLowerCase().trim();
  if (!slug) {
    res.status(400).json({ error: "slug required" });
    return;
  }
  const existing = await findWorkspaceBySlug(slug);
  res.json({ available: !existing });
});

const initSchema = z.object({
  company_name: z.string().min(1).max(200),
  workspace_slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  license_id: z.string().min(1),
  owner_name: z.string().min(1).max(200),
  owner_username: z.string().min(3).max(64),
  owner_password: z.string().min(6).max(128),
  db_provider: z.enum(["supabase", "existing", "self_hosted"]).default("supabase"),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(5432),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  ssl: z.boolean().optional(),
});

setupRouter.post("/initialize", async (req: AppRequest, res) => {
  const parsed = initSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  if (await findWorkspaceBySlug(data.workspace_slug)) {
    res.status(409).json({ error: "Workspace slug already taken" });
    return;
  }

  let database_url: string;
  try {
    database_url = buildDatabaseUrl({
      host: data.host,
      port: data.port,
      database: data.database,
      username: data.username,
      password: data.password,
      ssl: data.ssl,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid database fields" });
    return;
  }

  try {
    await testDatabaseUrl(database_url, data.host);

    const { Pool } = await import("pg");
    const pool = new Pool(
      pgPoolOptions(database_url, data.host) as import("pg").PoolConfig,
    );

    try {
      const { schema_version } = await runMigrationsOnPool(pool);
      const company_uuid = randomUUID();
      const password_hash = await bcrypt.hash(data.owner_password, 12);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO companies (company_uuid, company_name) VALUES ($1, $2)`,
          [company_uuid, data.company_name],
        );
        const userResult = await client.query<{ user_id: string }>(
          `INSERT INTO users (name, username, password_hash, role, active)
           VALUES ($1, $2, $3, 'owner', TRUE)
           RETURNING user_id`,
          [data.owner_name, data.owner_username.toLowerCase(), password_hash],
        );
        await client.query(
          `INSERT INTO app_metadata (id, company_uuid, schema_version, license_id)
           VALUES (1, $1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET
             company_uuid = EXCLUDED.company_uuid,
             schema_version = EXCLUDED.schema_version,
             license_id = EXCLUDED.license_id`,
          [company_uuid, schema_version || SCHEMA_VERSION, data.license_id],
        );
        // Ensure a default firm exists (migration 3 also seeds one if empty)
        await client.query(
          `INSERT INTO firms (firm_name, status)
           SELECT 'Main Firm', 'active'
           WHERE NOT EXISTS (SELECT 1 FROM firms WHERE status = 'active')`,
        );
        await client.query("COMMIT");

        const activation = await activateLicense({
          license_id: data.license_id,
          company_uuid,
          company_name: data.company_name,
        });

        const workspace = await createWorkspace({
          slug: data.workspace_slug,
          company_name: data.company_name,
          company_uuid,
          database_url,
          license_id: data.license_id,
          activation_token: activation.activation_token,
          db_provider: data.db_provider as DbProvider,
        });

        getWorkspacePool(workspace);

        await writeAudit(workspace, {
          actor_user_id: userResult.rows[0]?.user_id,
          action: "workspace.initialize",
          entity_type: "workspace",
          entity_id: workspace.workspace_id,
          detail: {
            slug: workspace.slug,
            company_name: data.company_name,
            db_provider: data.db_provider,
            host: data.host,
          },
          ip_address: req.clientIp,
          device: req.clientDevice,
        });

        res.status(201).json({
          ok: true,
          workspace: publicWorkspace(workspace),
          maximum_users: activation.maximum_users,
          schema_version,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Setup failed",
    });
  }
});
