/**
 * Vendor-only: issue a signed license file for one client.
 *
 * Usage:
 *   node scripts/license/issue.mjs --company "Acme Traders" --users 10 [--edition standard] [--out acme.license.json]
 */
import { createPrivateKey, randomBytes, sign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const company = arg("company");
const users = Number(arg("users", "10"));
if (!company || !Number.isInteger(users) || users < 1) {
  console.error('Usage: node scripts/license/issue.mjs --company "Acme Traders" --users 10');
  process.exit(1);
}

const keyDir = process.env.LEDGER_VENDOR_DIR ?? path.join(os.homedir(), ".ledger-vendor");
const privatePath = path.join(keyDir, "license-signing-key.pem");
if (!fs.existsSync(privatePath)) {
  console.error(`No signing key at ${privatePath}. Run scripts/license/keygen.mjs first.`);
  process.exit(1);
}

const payload = {
  format: "ledger-license-v1",
  license_id: `LIC-${randomBytes(4).toString("hex").toUpperCase()}`,
  company_name: company.trim(),
  max_users: users,
  edition: arg("edition", "standard"),
  issued_at: new Date().toISOString(),
};

const signature = sign(
  null,
  Buffer.from(canonicalJson(payload), "utf8"),
  createPrivateKey(fs.readFileSync(privatePath)),
).toString("base64");

const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client";
const out = arg("out", `${slug}.license.json`);
fs.writeFileSync(out, JSON.stringify({ payload, signature }, null, 2));
console.log(`Issued ${payload.license_id} for ${payload.company_name} (${users} users) -> ${out}`);
