import { SCHEMA_VERSION } from "@ledger/db";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import type { AppRequest } from "../auth.js";
import {
  buildRecoveryKit,
  createDataKey,
  getDataKey,
  saveRecoveryKit,
  type RecoveryKit,
} from "../box.js";
import { getPool } from "../db.js";
import { verifyLicense, type LicenseFile } from "../license.js";
import { getLocalWorkspace, loadLocalWorkspace, publicWorkspace } from "../workspaces.js";

export const setupRouter = Router();

setupRouter.get("/status", (_req, res) => {
  const workspace = getLocalWorkspace();
  res.json({
    setup_complete: Boolean(workspace),
    company_name: workspace?.company_name ?? null,
  });
});

setupRouter.post("/license/check", (req, res) => {
  try {
    const license = verifyLicense(req.body?.license);
    res.json({ ok: true, license: license.payload });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid license" });
  }
});

const initSchema = z.object({
  license: z.unknown(),
  owner_name: z.string().min(1).max(200),
  owner_username: z.string().min(3).max(64),
  owner_password: z.string().min(8).max(128),
  recovery_passphrase: z.string().min(10).max(256),
});

async function createCompany(input: {
  license: LicenseFile;
  owner_name: string;
  owner_username: string;
  password_hash: string;
  recovery_passphrase: string;
}): Promise<{ ownerId: string; recoveryKit: RecoveryKit }> {
  const companyName = input.license.payload.company_name;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(`SELECT 1 FROM companies LIMIT 1`);
    if (existing.rows[0]) {
      throw Object.assign(new Error("This box is already set up"), { status: 409 });
    }
    const company_uuid = randomUUID();
    await client.query(`INSERT INTO companies (company_uuid, company_name) VALUES ($1, $2)`, [
      company_uuid,
      companyName,
    ]);
    const owner = await client.query<{ user_id: string }>(
      `INSERT INTO users (name, username, password_hash, role, active)
       VALUES ($1, $2, $3, 'owner', TRUE)
       RETURNING user_id`,
      [input.owner_name, input.owner_username.toLowerCase(), input.password_hash],
    );
    await client.query(
      `INSERT INTO app_metadata (id, company_uuid, schema_version, license_id, encryption, license)
       VALUES (1, $1, $2, $3, 'envelope_v1', $4)
       ON CONFLICT (id) DO UPDATE SET
         company_uuid = EXCLUDED.company_uuid,
         schema_version = EXCLUDED.schema_version,
         license_id = EXCLUDED.license_id,
         encryption = EXCLUDED.encryption,
         license = EXCLUDED.license`,
      [company_uuid, SCHEMA_VERSION, input.license.payload.license_id, JSON.stringify(input.license)],
    );
    await client.query(
      `INSERT INTO firms (firm_name, status)
       SELECT 'Main Firm', 'active'
       WHERE NOT EXISTS (SELECT 1 FROM firms WHERE status = 'active')`,
    );

    // A key left by an interrupted earlier attempt is reused rather than replaced.
    const dek = getDataKey() ?? createDataKey();
    const recoveryKit = buildRecoveryKit(dek, input.recovery_passphrase, companyName);
    saveRecoveryKit(recoveryKit);

    await client.query("COMMIT");
    return { ownerId: owner.rows[0].user_id, recoveryKit };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

setupRouter.post("/initialize", async (req: AppRequest, res) => {
  if (getLocalWorkspace()) {
    res.status(409).json({ error: "This box is already set up" });
    return;
  }
  const parsed = initSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  let license: LicenseFile;
  try {
    license = verifyLicense(parsed.data.license);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid license" });
    return;
  }

  try {
    const { ownerId, recoveryKit } = await createCompany({
      license,
      owner_name: parsed.data.owner_name,
      owner_username: parsed.data.owner_username,
      password_hash: await bcrypt.hash(parsed.data.owner_password, 12),
      recovery_passphrase: parsed.data.recovery_passphrase,
    });

    const workspace = await loadLocalWorkspace();
    if (!workspace) throw new Error("Setup saved but the workspace could not be loaded");

    await writeAudit(workspace, {
      actor_user_id: ownerId,
      action: "workspace.initialize",
      entity_type: "workspace",
      entity_id: workspace.workspace_id,
      detail: { company_name: workspace.company_name, license_id: license.payload.license_id },
      ip_address: req.clientIp,
      device: req.clientDevice,
    });

    res.status(201).json({
      ok: true,
      workspace: publicWorkspace(workspace),
      maximum_users: license.payload.max_users,
      recovery_kit: recoveryKit,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: e.message ?? "Setup failed" });
  }
});
