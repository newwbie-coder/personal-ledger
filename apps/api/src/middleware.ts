import type { NextFunction, Response } from "express";
import type { AppRequest } from "./auth.js";
import { getDataKey } from "./box.js";

/** After auth, attach the box's data key for field crypto. The license was verified at load. */
export function requireLicense(req: AppRequest, res: Response, next: NextFunction) {
  if (!req.workspace) {
    res.status(401).json({ error: "Workspace required" });
    return;
  }
  try {
    req.dataKey = getDataKey() ?? undefined;
  } catch (err) {
    res.status(503).json({
      error: err instanceof Error ? err.message : "Cannot unlock workspace data",
      code: "DATA_KEY_INVALID",
    });
    return;
  }
  next();
}

export function requireDataKey(req: AppRequest, res: Response, next: NextFunction) {
  if (!req.dataKey) {
    res.status(503).json({
      error: "This box has no data key. Restore it from the recovery kit.",
      code: "DATA_KEY_MISSING",
    });
    return;
  }
  next();
}

export function requestLogger(req: AppRequest, res: Response, next: NextFunction) {
  const started = Date.now();
  res.on("finish", () => {
    const ms = Date.now();
    const workspace = req.workspace?.slug ?? "-";
    const user = req.user?.username ?? "-";
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms - started}ms ws=${workspace} user=${user} ip=${req.clientIp ?? "-"}`,
    );
  });
  next();
}
