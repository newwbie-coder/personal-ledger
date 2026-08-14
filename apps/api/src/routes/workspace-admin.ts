import { Router } from "express";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { requireAuth, requireRoles, type AppRequest } from "../auth.js";
import { buildDatabaseUrl, type DbProvider } from "../db-url.js";
import { resetWorkspacePool, testDatabaseUrl } from "../db.js";
import { migrateWorkspaceToEnvelope, verifyWorkspaceDecrypt } from "../encrypt-migrate.js";
import { requireLicense } from "../middleware.js";
import {
  findWorkspaceById,
  swapWorkspaceDatabaseUrl,
  unwrapWorkspaceDek,
} from "../workspaces.js";

export const workspaceAdminRouter = Router();

workspaceAdminRouter.use(requireAuth, requireLicense, requireRoles("owner"));

workspaceAdminRouter.post("/encrypt-migrate", async (req: AppRequest, res) => {
  try {
    const result = await migrateWorkspaceToEnvelope(req.workspace!);
    const fresh = await findWorkspaceById(req.workspace!.workspace_id);
    if (fresh) req.workspace = fresh;
    await writeAudit(req.workspace!, {
      actor_user_id: req.user!.user_id,
      action: "workspace.encrypt_migrate",
      entity_type: "workspace",
      entity_id: req.workspace!.workspace_id,
      detail: result,
      ip_address: req.clientIp,
      device: req.clientDevice,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Encryption migrate failed",
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
  db_provider: z.enum(["supabase", "existing", "self_hosted"]).optional(),
});

workspaceAdminRouter.post("/test-db", async (req: AppRequest, res) => {
  try {
    const parsed = connectionFields.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const url = buildDatabaseUrl(parsed.data);
    await testDatabaseUrl(url, parsed.data.host);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Connection failed",
    });
  }
});

/**
 * Attach an already-copied database (pg_dump/restore done).
 * Keeps the same wrapped DEK — ciphertext must already be on the new host.
 */
workspaceAdminRouter.post("/swap-db", async (req: AppRequest, res) => {
  try {
    const parsed = connectionFields.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if (!req.workspace!.wrapped_data_key) {
      res.status(400).json({
        error: "Run encrypt-migrate on the current database before moving",
      });
      return;
    }

    const url = buildDatabaseUrl(parsed.data);
    await testDatabaseUrl(url, parsed.data.host);

    const updated = await swapWorkspaceDatabaseUrl(
      req.workspace!.workspace_id,
      url,
      (parsed.data.db_provider as DbProvider | undefined) ?? null,
    );
    resetWorkspacePool(updated.workspace_id);

    try {
      unwrapWorkspaceDek(updated);
      await verifyWorkspaceDecrypt(updated);
    } catch (err) {
      res.status(400).json({
        ok: false,
        error:
          err instanceof Error
            ? `Swapped but verify failed: ${err.message}. Restore previous DB URL if needed.`
            : "Swap verify failed",
      });
      return;
    }

    await writeAudit(updated, {
      actor_user_id: req.user!.user_id,
      action: "workspace.swap_db",
      entity_type: "workspace",
      entity_id: updated.workspace_id,
      detail: { host: parsed.data.host, database: parsed.data.database },
      ip_address: req.clientIp,
      device: req.clientDevice,
    });

    res.json({
      ok: true,
      workspace: {
        workspace_id: updated.workspace_id,
        slug: updated.slug,
        company_name: updated.company_name,
      },
      hint: "Old database was not wiped. Decommission it after confirming login works.",
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Swap failed",
    });
  }
});

export const platformAdminRouter = Router();

platformAdminRouter.post("/workspaces/:id/encrypt-migrate", async (req, res) => {
  const secret = req.header("x-admin-secret");
  if (secret !== (process.env.LICENSE_ADMIN_SECRET ?? "dev-admin-secret")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ws = await findWorkspaceById(req.params.id);
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  try {
    const result = await migrateWorkspaceToEnvelope(ws);
    res.json({ ok: true, workspace_id: ws.workspace_id, ...result });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Migrate failed",
    });
  }
});

platformAdminRouter.post("/workspaces/:id/swap-db", async (req, res) => {
  const secret = req.header("x-admin-secret");
  if (secret !== (process.env.LICENSE_ADMIN_SECRET ?? "dev-admin-secret")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ws = await findWorkspaceById(req.params.id);
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  const parsed = connectionFields.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const url = buildDatabaseUrl(parsed.data);
    await testDatabaseUrl(url, parsed.data.host);
    const updated = await swapWorkspaceDatabaseUrl(
      ws.workspace_id,
      url,
      (parsed.data.db_provider as DbProvider | undefined) ?? null,
    );
    resetWorkspacePool(updated.workspace_id);
    await verifyWorkspaceDecrypt(updated);
    res.json({ ok: true, workspace_id: updated.workspace_id });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Swap failed",
    });
  }
});
