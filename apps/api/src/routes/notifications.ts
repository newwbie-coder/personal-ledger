import { Router } from "express";
import { requireAuth, type AppRequest } from "../auth.js";
import { queryWorkspace } from "../db.js";
import { requireLicense } from "../middleware.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth, requireLicense);

notificationsRouter.get("/", async (req: AppRequest, res) => {
  const unreadOnly = req.query.unread === "true";
  const result = await queryWorkspace(
    req.workspace!,
    `SELECT notification_id, title, body, entity_type, entity_id, read_at, created_at
     FROM notifications
     WHERE user_id = $1
       ${unreadOnly ? "AND read_at IS NULL" : ""}
     ORDER BY created_at DESC
     LIMIT 100`,
    [req.user!.user_id],
  );
  const unread = await queryWorkspace<{ count: string }>(
    req.workspace!,
    `SELECT COUNT(*)::text AS count FROM notifications
     WHERE user_id = $1 AND read_at IS NULL`,
    [req.user!.user_id],
  );
  res.json({
    notifications: result.rows,
    unread_count: Number(unread.rows[0]?.count ?? 0),
  });
});

notificationsRouter.post("/read-all", async (req: AppRequest, res) => {
  await queryWorkspace(
    req.workspace!,
    `UPDATE notifications SET read_at = NOW()
     WHERE user_id = $1 AND read_at IS NULL`,
    [req.user!.user_id],
  );
  res.json({ ok: true });
});

notificationsRouter.post("/:id/read", async (req: AppRequest, res) => {
  const result = await queryWorkspace(
    req.workspace!,
    `UPDATE notifications SET read_at = NOW()
     WHERE notification_id = $1 AND user_id = $2
     RETURNING notification_id, read_at`,
    [req.params.id, req.user!.user_id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.json({ notification: result.rows[0] });
});
