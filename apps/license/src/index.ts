import "./load-env.js";
import cors from "cors";
import express from "express";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { z } from "zod";

const { Pool } = pg;

interface LicenseRecord {
  license_id: string;
  company_uuid: string | null;
  company_name: string | null;
  maximum_users: number;
  edition: string;
  status: "issued" | "active" | "revoked";
  activation_token: string | null;
  last_validation: string | null;
  created_at: string;
}

const ADMIN_SECRET = process.env.LICENSE_ADMIN_SECRET ?? "dev-admin-secret";
const SERVER_SECRET = process.env.LICENSE_SERVER_SECRET ?? "dev-license-secret";
/** Prefer PORT (Railway/Render), then LICENSE_PORT, then 4100. */
const PORT = Number(process.env.PORT ?? process.env.LICENSE_PORT ?? 4100);

function getLicenseDatabaseUrl(): string {
  const url =
    process.env.LICENSE_DATABASE_URL ??
    process.env.CONTROL_DATABASE_URL ??
    process.env.PLATFORM_DATABASE_URL ??
    "";
  if (!url) {
    throw new Error(
      "CONTROL_DATABASE_URL (or LICENSE_DATABASE_URL) is required for the license server.",
    );
  }
  return url;
}

function needsSsl(connectionString: string): boolean {
  const host = (() => {
    try {
      return new URL(connectionString.replace(/^postgresql:/i, "postgres:")).hostname;
    } catch {
      return "";
    }
  })();
  return (
    host.includes("supabase") ||
    host.includes("neon.tech") ||
    host.includes("pooler") ||
    /\.rds\.amazonaws\.com$/i.test(host)
  );
}

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (pool) return pool;
  const connectionString = getLicenseDatabaseUrl();
  pool = new Pool({
    connectionString,
    max: 5,
    ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  return pool;
}

function mapRow(row: Record<string, unknown>): LicenseRecord {
  return {
    license_id: String(row.license_id),
    company_uuid: row.company_uuid ? String(row.company_uuid) : null,
    company_name: row.company_name != null ? String(row.company_name) : null,
    maximum_users: Number(row.maximum_users),
    edition: String(row.edition),
    status: row.status as LicenseRecord["status"],
    activation_token: row.activation_token != null ? String(row.activation_token) : null,
    last_validation: row.last_validation
      ? new Date(String(row.last_validation)).toISOString()
      : null,
    created_at: new Date(String(row.created_at)).toISOString(),
  };
}

async function ensureLicenseSchema(): Promise<void> {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      license_id TEXT PRIMARY KEY,
      company_uuid UUID UNIQUE,
      company_name TEXT,
      maximum_users INT NOT NULL DEFAULT 5,
      edition TEXT NOT NULL DEFAULT 'standard',
      status TEXT NOT NULL DEFAULT 'issued'
        CHECK (status IN ('issued', 'active', 'revoked')),
      activation_token TEXT,
      last_validation TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses (status);
  `);

  const demo = await p.query(`SELECT 1 FROM licenses WHERE license_id = $1`, ["LIC-DEMO-0001"]);
  if (!demo.rowCount) {
    await p.query(
      `INSERT INTO licenses (license_id, maximum_users, edition, status)
       VALUES ('LIC-DEMO-0001', 10, 'standard', 'issued')
       ON CONFLICT (license_id) DO NOTHING`,
    );
  }
}

const app = express();
app.use(cors());
app.use(express.json());

function requireServerSecret(req: express.Request, res: express.Response, next: express.NextFunction) {
  const secret = req.header("x-license-secret");
  if (secret !== SERVER_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const secret = req.header("x-admin-secret");
  if (secret !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.get("/health", async (_req, res) => {
  try {
    await getPool().query("SELECT 1");
    res.json({ ok: true, service: "license", store: "postgres" });
  } catch (err) {
    res.status(503).json({
      ok: false,
      service: "license",
      error: err instanceof Error ? err.message : "db unavailable",
    });
  }
});

const issueSchema = z.object({
  maximum_users: z.number().int().positive().default(5),
  edition: z.string().default("standard"),
  company_name: z.string().optional(),
});

app.post("/admin/issue", requireAdmin, async (req, res) => {
  const parsed = issueSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const license_id = `LIC-${randomBytes(4).toString("hex").toUpperCase()}`;
    const result = await getPool().query(
      `INSERT INTO licenses (license_id, company_name, maximum_users, edition, status)
       VALUES ($1, $2, $3, $4, 'issued')
       RETURNING *`,
      [
        license_id,
        parsed.data.company_name ?? null,
        parsed.data.maximum_users,
        parsed.data.edition,
      ],
    );
    res.status(201).json(mapRow(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Issue failed" });
  }
});

const activateSchema = z.object({
  license_id: z.string().min(1),
  company_uuid: z.string().uuid(),
  company_name: z.string().min(1),
});

app.post("/activate", requireServerSecret, async (req, res) => {
  const parsed = activateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT * FROM licenses WHERE license_id = $1 FOR UPDATE`, [
      parsed.data.license_id,
    ]);
    if (!found.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "License not found" });
      return;
    }
    const license = mapRow(found.rows[0]);
    if (license.status === "revoked") {
      await client.query("ROLLBACK");
      res.status(403).json({ error: "License revoked" });
      return;
    }
    if (license.company_uuid && license.company_uuid !== parsed.data.company_uuid) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "License already bound to another company" });
      return;
    }

    const activation_token = randomBytes(32).toString("hex");
    const updated = await client.query(
      `UPDATE licenses
       SET company_uuid = $2,
           company_name = $3,
           status = 'active',
           activation_token = $4,
           last_validation = NOW()
       WHERE license_id = $1
       RETURNING *`,
      [parsed.data.license_id, parsed.data.company_uuid, parsed.data.company_name, activation_token],
    );
    await client.query("COMMIT");
    const row = mapRow(updated.rows[0]);
    res.json({
      license_id: row.license_id,
      company_uuid: row.company_uuid,
      activation_token: row.activation_token,
      maximum_users: row.maximum_users,
      edition: row.edition,
      status: row.status,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err instanceof Error ? err.message : "Activate failed" });
  } finally {
    client.release();
  }
});

const validateSchema = z.object({
  license_id: z.string().min(1),
  company_uuid: z.string().uuid(),
  activation_token: z.string().min(1),
});

app.post("/validate", requireServerSecret, async (req, res) => {
  const parsed = validateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const found = await getPool().query(`SELECT * FROM licenses WHERE license_id = $1`, [
      parsed.data.license_id,
    ]);
    if (!found.rows[0]) {
      res.status(404).json({ error: "License not found" });
      return;
    }
    const license = mapRow(found.rows[0]);
    if (license.status !== "active") {
      res.status(403).json({ error: "License not active" });
      return;
    }
    if (
      license.company_uuid !== parsed.data.company_uuid ||
      license.activation_token !== parsed.data.activation_token
    ) {
      res.status(403).json({ error: "License mismatch" });
      return;
    }

    const updated = await getPool().query(
      `UPDATE licenses SET last_validation = NOW() WHERE license_id = $1 RETURNING last_validation`,
      [parsed.data.license_id],
    );
    res.json({
      valid: true,
      maximum_users: license.maximum_users,
      edition: license.edition,
      last_validation: new Date(String(updated.rows[0].last_validation)).toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Validate failed" });
  }
});

app.get("/admin/licenses", requireAdmin, async (_req, res) => {
  try {
    const result = await getPool().query(`SELECT * FROM licenses ORDER BY created_at ASC`);
    res.json(result.rows.map(mapRow));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "List failed" });
  }
});

ensureLicenseSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`License server listening on http://localhost:${PORT} (postgres store)`);
    });
  })
  .catch((err) => {
    console.error("Failed to init license schema:", err);
    process.exit(1);
  });
