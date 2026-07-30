import type { NextFunction, Response } from "express";
import type { AppRequest } from "./auth.js";
import { validateWorkspaceLicense } from "./license-client.js";

/** After auth, ensure workspace license is valid (cached ~30 days). */
export async function requireLicense(req: AppRequest, res: Response, next: NextFunction) {
  if (!req.workspace) {
    res.status(401).json({ error: "Workspace required" });
    return;
  }
  const result = await validateWorkspaceLicense(req.workspace, false);
  if (!result.valid) {
    res.status(403).json({ error: result.error ?? "License invalid", code: "LICENSE_INVALID" });
    return;
  }
  next();
}

export function requestLogger(req: AppRequest, res: Response, next: NextFunction) {
  const started = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - started;
    const workspace = req.workspace?.slug ?? "-";
    const user = req.user?.username ?? "-";
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms ws=${workspace} user=${user} ip=${req.clientIp ?? "-"}`,
    );
  });
  next();
}
