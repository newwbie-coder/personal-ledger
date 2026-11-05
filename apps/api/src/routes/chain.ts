import { Router } from "express";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { requireAuth, requireRoles, type AppRequest } from "../auth.js";
import { loadRecoveryKit } from "../box.js";
import { checkCheckpoint, getChainHead, lastChainReport, verifyChain } from "../chain.js";

export const chainRouter = Router();

chainRouter.use(requireAuth);

chainRouter.get("/head", async (_req, res) => {
  res.json({ head: await getChainHead() });
});

const checkSchema = z.object({
  seq: z.coerce.number().int().min(0),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

chainRouter.get("/check", async (req, res) => {
  const parsed = checkSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "seq and hash required" });
    return;
  }
  const head = await getChainHead();
  const ok = parsed.data.seq <= head.seq && (await checkCheckpoint(parsed.data.seq, parsed.data.hash));
  res.json({ ok, head });
});

chainRouter.get("/report", requireRoles("owner", "manager"), (_req, res) => {
  res.json({ report: lastChainReport() });
});

chainRouter.post("/verify", requireRoles("owner"), async (req: AppRequest, res) => {
  const report = await verifyChain();
  await writeAudit(req.workspace!, {
    actor_user_id: req.user!.user_id,
    action: "chain.verify",
    entity_type: "workspace",
    entity_id: req.workspace!.workspace_id,
    detail: { ok: report.ok, problems: report.problems.length, head: report.head.seq },
    ip_address: req.clientIp,
    device: req.clientDevice,
  });
  res.json({ report });
});

export const boxRouter = Router();

boxRouter.use(requireAuth);

/** The kit is encrypted under the owner's recovery passphrase, so it is safe to re-download. */
boxRouter.get("/recovery-kit", requireRoles("owner"), (_req, res) => {
  const kit = loadRecoveryKit();
  if (!kit) {
    res.status(404).json({ error: "No recovery kit on this box" });
    return;
  }
  res.json({ recovery_kit: kit });
});
