import type { NextFunction, Response } from "express";
import type { AppRequest } from "./auth.js";
import { validateWorkspaceLicense } from "./license-client.js";
import { unwrapWorkspaceDek } from "./workspaces.js";

/** After auth, ensure workspace license is valid and attach DEK for field crypto. */
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
  try {
    if (req.workspace.wrapped_data_key) {
      req.dataKey = unwrapWorkspaceDek(req.workspace);
    }
  } catch (err) {
    res.status(403).json({
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
      error: "Workspace encryption not initialized. Ask support to run data migration.",
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
