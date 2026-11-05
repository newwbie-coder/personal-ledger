import "./load-env.js";
import { APP_VERSION } from "@ledger/shared";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachClientMeta } from "./auth.js";
import { pruneBackups, runBackup } from "./backup.js";
import { dataDir, getJwtSecret } from "./box.js";
import { lastChainReport, verifyChain } from "./chain.js";
import { getPool, pingDatabase } from "./db.js";
import { requestLogger } from "./middleware.js";
import { runMigrationsOnPool } from "./migrate.js";
import { authRouter } from "./routes/auth.js";
import { boxRouter, chainRouter } from "./routes/chain.js";
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
import { getLocalWorkspace, loadLocalWorkspace } from "./workspaces.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const webDist = path.resolve(process.env.WEB_DIST ?? path.join(repoRoot, "apps/web/dist"));
const tlsDir = path.join(dataDir(), "tls");
const tlsCert = path.join(tlsDir, "server.crt");
const tlsKey = path.join(tlsDir, "server.key");
const caCert = path.join(tlsDir, "ca.crt");
const useTls = fs.existsSync(tlsCert) && fs.existsSync(tlsKey);

const app = express();
app.disable("x-powered-by");

/** Only set in development, when the Vite dev server runs on another port. */
const devOrigins = process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean);
if (devOrigins?.length) app.use(cors({ origin: devOrigins, credentials: true }));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (useTls) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(attachClientMeta);
app.use(requestLogger);

async function healthPayload() {
  const report = lastChainReport();
  return {
    database: (await pingDatabase()) ? ("OK" as const) : ("ERROR" as const),
    setup_complete: Boolean(getLocalWorkspace()),
    chain: report ? (report.ok ? ("OK" as const) : ("BROKEN" as const)) : ("UNCHECKED" as const),
    chain_checked_at: report?.verified_at ?? null,
    version: APP_VERSION,
  };
}

const v1 = express.Router();
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
v1.use("/chain", chainRouter);
v1.use("/box", boxRouter);
app.use("/api/v1", v1);

if (fs.existsSync(caCert)) {
  app.get("/ca.crt", (_req, res) => {
    res.type("application/x-x509-ca-cert").sendFile(caCert);
  });
}

if (fs.existsSync(path.join(webDist, "index.html"))) {
  app.use(express.static(webDist, { index: false }));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const installPage = (host: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install ledger certificate</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:32px auto;padding:0 18px;line-height:1.55;color:#14241c}
a.btn{display:block;text-align:center;padding:14px;border-radius:12px;background:#0f3d2e;color:#fff;text-decoration:none;font-weight:600;margin:14px 0}
li{margin-bottom:6px}</style></head><body>
<h1>Set up this phone</h1>
<p>This office ledger uses its own security certificate. Install it once, then open the app.</p>
<a class="btn" href="/ca.crt">1. Download certificate</a>
<p><strong>Android:</strong></p><ol><li>Settings → Security → Encryption &amp; credentials → Install a certificate → CA certificate</li><li>Pick the downloaded file</li></ol>
<p><strong>iPhone:</strong></p><ol><li>Open this page in Safari and tap Download → Allow</li><li>Settings → Profile Downloaded → Install</li><li>Settings → General → About → Certificate Trust Settings → turn the ledger certificate on</li></ol>
<a class="btn" href="https://${host}/">2. Open the ledger</a>
</body></html>`;

function startServers() {
  if (!useTls) {
    const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
    app.listen(port, () => console.log(`Ledger listening on http://localhost:${port} (no TLS certificate found)`));
    return;
  }
  const httpsPort = Number(process.env.HTTPS_PORT ?? 8443);
  const httpPort = Number(process.env.HTTP_PORT ?? 8080);
  https
    .createServer({ cert: fs.readFileSync(tlsCert), key: fs.readFileSync(tlsKey) }, app)
    .listen(httpsPort, () => console.log(`Ledger listening on https port ${httpsPort}`));

  // Plain HTTP only hands out the CA certificate and the install page; everything else goes to HTTPS.
  http
    .createServer((req, res) => {
      const host = (req.headers.host ?? "").replace(/:\d+$/, "");
      if (req.url === "/ca.crt" && fs.existsSync(caCert)) {
        res.writeHead(200, { "Content-Type": "application/x-x509-ca-cert" });
        fs.createReadStream(caCert).pipe(res);
        return;
      }
      if (req.url === "/" || req.url === "/install") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(installPage(host));
        return;
      }
      res.writeHead(301, { Location: `https://${host}${req.url ?? "/"}` });
      res.end();
    })
    .listen(httpPort, () => console.log(`Certificate install page on http port ${httpPort}`));
}

async function runChainCheck() {
  if (!getLocalWorkspace()) return;
  try {
    const report = await verifyChain();
    if (report.ok) {
      console.log(`Fingerprint chain OK (${report.checked_links} links, head ${report.head.seq})`);
    } else {
      console.error("FINGERPRINT CHAIN BROKEN:", JSON.stringify(report.problems));
    }
  } catch (err) {
    console.error("Chain check failed:", err);
  }
}

async function runNightlyBackup() {
  const dir = process.env.BACKUP_DIR;
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (!dir || !passphrase || !getLocalWorkspace()) return;
  try {
    const file = await runBackup(dir, passphrase);
    pruneBackups(dir, Number(process.env.BACKUP_KEEP ?? 30));
    console.log(`Backup written: ${file}`);
  } catch (err) {
    console.error("Backup failed:", err);
  }
}

function scheduleDaily(hour: number, task: () => Promise<void>) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(() => {
    void task();
    setInterval(() => void task(), 24 * 60 * 60 * 1000);
  }, next.getTime() - now.getTime());
}

async function start() {
  getJwtSecret();
  const migrated = await runMigrationsOnPool(getPool());
  if (migrated.applied.length) console.log(`Applied migrations: ${migrated.applied.join(", ")}`);
  const workspace = await loadLocalWorkspace();
  console.log(workspace ? `Company: ${workspace.company_name}` : "Not set up yet: open the app to run setup");
  startServers();
  await runChainCheck();
  const hour = Number(process.env.NIGHTLY_HOUR ?? 2);
  scheduleDaily(hour, async () => {
    await runChainCheck();
    await runNightlyBackup();
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
