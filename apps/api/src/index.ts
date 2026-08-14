import "./load-env.js";
import { APP_VERSION } from "@ledger/shared";
import cors from "cors";
import express from "express";
import { attachClientMeta } from "./auth.js";
import { ensureControlSchema, pingControlDatabase } from "./control-db.js";
import { requestLogger } from "./middleware.js";
import { pingLicenseServer } from "./license-client.js";
import { authRouter } from "./routes/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { firmsRouter } from "./routes/firms.js";
import { ledgerRouter } from "./routes/ledger.js";
import { notificationsRouter } from "./routes/notifications.js";
import { openingsRouter } from "./routes/openings.js";
import { partiesRouter } from "./routes/parties.js";
import { reportsRouter } from "./routes/reports.js";
import { setupRouter } from "./routes/setup.js";
import { transfersRouter } from "./routes/transfers.js";
import { usersRouter } from "./routes/users.js";
import {
  platformAdminRouter,
  workspaceAdminRouter,
} from "./routes/workspace-admin.js";
import { countWorkspaces } from "./workspaces.js";

/** Railway/Render set PORT; local defaults to API_PORT or 4000. */
const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
const v1 = express.Router();

function corsOrigin(): cors.CorsOptions["origin"] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw || raw === "*") return true;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length === 1 ? list[0] : list;
}

const app = express();
app.use(cors({ origin: corsOrigin(), credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(attachClientMeta);
app.use(requestLogger);

async function healthPayload() {
  const database = (await pingControlDatabase()) ? "OK" : "ERROR";
  const licenseOk = await pingLicenseServer();
  let workspaces = 0;
  if (database === "OK") {
    try {
      workspaces = await countWorkspaces();
    } catch {
      workspaces = 0;
    }
  }
  return {
    database,
    license: licenseOk ? ("OK" as const) : ("DEGRADED" as const),
    version: APP_VERSION,
    workspaces,
  };
}

app.get("/health", async (_req, res) => {
  res.json(await healthPayload());
});

v1.get("/health", async (_req, res) => {
  res.json(await healthPayload());
});

v1.use("/setup", setupRouter);
v1.use("/auth", authRouter);
v1.use("/users", usersRouter);
v1.use("/firms", firmsRouter);
v1.use("/parties", partiesRouter);
v1.use("/openings", openingsRouter);
v1.use("/ledger", ledgerRouter);
v1.use("/transfers", transfersRouter);
v1.use("/dashboard", dashboardRouter);
v1.use("/reports", reportsRouter);
v1.use("/notifications", notificationsRouter);
v1.use("/workspace", workspaceAdminRouter);
v1.use("/admin", platformAdminRouter);

app.use("/api/v1", v1);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function start() {
  await ensureControlSchema();
  const count = await countWorkspaces();
  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
    console.log(`API base: http://localhost:${PORT}/api/v1`);
    console.log(`Control DB ready · workspaces: ${count}`);
  });
}

start().catch((err) => {
  console.error("Failed to start API:", err);
  process.exit(1);
});
