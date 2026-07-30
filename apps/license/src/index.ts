import "./load-env.js";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const STORE_PATH = path.join(DATA_DIR, "licenses.json");

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

interface Store {
  licenses: LicenseRecord[];
}

function ensureStore(): Store {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    const seed: Store = {
      licenses: [
        {
          license_id: "LIC-DEMO-0001",
          company_uuid: null,
          company_name: null,
          maximum_users: 10,
          edition: "standard",
          status: "issued",
          activation_token: null,
          last_validation: null,
          created_at: new Date().toISOString(),
        },
      ],
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(seed, null, 2));
    return seed;
  }
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as Store;
}

function saveStore(store: Store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

const ADMIN_SECRET = process.env.LICENSE_ADMIN_SECRET ?? "dev-admin-secret";
const SERVER_SECRET = process.env.LICENSE_SERVER_SECRET ?? "dev-license-secret";
/** Prefer PORT (Railway/Render), then LICENSE_PORT, then 4100. */
const PORT = Number(process.env.PORT ?? process.env.LICENSE_PORT ?? 4100);

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

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "license" });
});

const issueSchema = z.object({
  maximum_users: z.number().int().positive().default(5),
  edition: z.string().default("standard"),
  company_name: z.string().optional(),
});

app.post("/admin/issue", requireAdmin, (req, res) => {
  const parsed = issueSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const store = ensureStore();
  const license: LicenseRecord = {
    license_id: `LIC-${randomBytes(4).toString("hex").toUpperCase()}`,
    company_uuid: null,
    company_name: parsed.data.company_name ?? null,
    maximum_users: parsed.data.maximum_users,
    edition: parsed.data.edition,
    status: "issued",
    activation_token: null,
    last_validation: null,
    created_at: new Date().toISOString(),
  };
  store.licenses.push(license);
  saveStore(store);
  res.status(201).json(license);
});

const activateSchema = z.object({
  license_id: z.string().min(1),
  company_uuid: z.string().uuid(),
  company_name: z.string().min(1),
});

app.post("/activate", requireServerSecret, (req, res) => {
  const parsed = activateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const store = ensureStore();
  const license = store.licenses.find((l) => l.license_id === parsed.data.license_id);
  if (!license) {
    res.status(404).json({ error: "License not found" });
    return;
  }
  if (license.status === "revoked") {
    res.status(403).json({ error: "License revoked" });
    return;
  }
  if (license.company_uuid && license.company_uuid !== parsed.data.company_uuid) {
    res.status(409).json({ error: "License already bound to another company" });
    return;
  }

  license.company_uuid = parsed.data.company_uuid;
  license.company_name = parsed.data.company_name;
  license.status = "active";
  license.activation_token = randomBytes(32).toString("hex");
  license.last_validation = new Date().toISOString();
  saveStore(store);

  res.json({
    license_id: license.license_id,
    company_uuid: license.company_uuid,
    activation_token: license.activation_token,
    maximum_users: license.maximum_users,
    edition: license.edition,
    status: license.status,
  });
});

const validateSchema = z.object({
  license_id: z.string().min(1),
  company_uuid: z.string().uuid(),
  activation_token: z.string().min(1),
});

app.post("/validate", requireServerSecret, (req, res) => {
  const parsed = validateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const store = ensureStore();
  const license = store.licenses.find((l) => l.license_id === parsed.data.license_id);
  if (!license) {
    res.status(404).json({ error: "License not found" });
    return;
  }
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

  license.last_validation = new Date().toISOString();
  saveStore(store);

  res.json({
    valid: true,
    maximum_users: license.maximum_users,
    edition: license.edition,
    last_validation: license.last_validation,
  });
});

app.get("/admin/licenses", requireAdmin, (_req, res) => {
  const store = ensureStore();
  res.json(store.licenses);
});

app.listen(PORT, () => {
  ensureStore();
  console.log(`License server listening on http://localhost:${PORT}`);
});
