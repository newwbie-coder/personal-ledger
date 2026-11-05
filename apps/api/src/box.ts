import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function dataDir(): string {
  return path.resolve(process.env.LEDGER_DATA_DIR ?? path.join(repoRoot, "data"));
}

function keysDir(): string {
  return path.join(dataDir(), "keys");
}

const dataKeyPath = () => path.join(keysDir(), "workspace.key");
const jwtSecretPath = () => path.join(keysDir(), "jwt.secret");
const recoveryKitPath = () => path.join(keysDir(), "recovery-kit.json");

function writePrivate(file: string, contents: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, contents, { mode: 0o600, flag: "wx" });
}

let jwtSecret: string | null = null;

/** Generated on first start; never leaves the box. */
export function getJwtSecret(): string {
  if (jwtSecret) return jwtSecret;
  const file = jwtSecretPath();
  if (!fs.existsSync(file)) {
    writePrivate(file, randomBytes(48).toString("base64"));
  }
  jwtSecret = fs.readFileSync(file, "utf8").trim();
  return jwtSecret;
}

let dataKey: Buffer | null = null;

export function hasDataKey(): boolean {
  return dataKey != null || fs.existsSync(dataKeyPath());
}

export function getDataKey(): Buffer | null {
  if (dataKey) return dataKey;
  const file = dataKeyPath();
  if (!fs.existsSync(file)) return null;
  const key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  if (key.length !== 32) throw new Error("Data key file is corrupt");
  dataKey = key;
  return dataKey;
}

/** Create the workspace data key once, at setup. Refuses to overwrite. */
export function createDataKey(): Buffer {
  if (hasDataKey()) throw new Error("A data key already exists on this box");
  const key = randomBytes(32);
  writePrivate(dataKeyPath(), key.toString("base64"));
  dataKey = key;
  return key;
}

/** Install a key recovered from a recovery kit (restore onto a new box). */
export function installDataKey(key: Buffer) {
  if (key.length !== 32) throw new Error("Recovered key has the wrong length");
  if (hasDataKey()) throw new Error("A data key already exists on this box");
  writePrivate(dataKeyPath(), key.toString("base64"));
  dataKey = key;
}

export interface RecoveryKit {
  format: "ledger-recovery-v1";
  company_name: string;
  created_at: string;
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  iv: string;
  tag: string;
  ciphertext: string;
}

const SCRYPT = { N: 1 << 15, r: 8, p: 1 };

export function passphraseKey(passphrase: string, salt: Buffer, params = SCRYPT): Buffer {
  return scryptSync(passphrase, salt, 32, { ...params, maxmem: 128 * 1024 * 1024 });
}

export function buildRecoveryKit(key: Buffer, passphrase: string, companyName: string): RecoveryKit {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", passphraseKey(passphrase, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
  return {
    format: "ledger-recovery-v1",
    company_name: companyName,
    created_at: new Date().toISOString(),
    kdf: { name: "scrypt", ...SCRYPT, salt: salt.toString("base64") },
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function openRecoveryKit(kit: RecoveryKit, passphrase: string): Buffer {
  if (kit.format !== "ledger-recovery-v1") throw new Error("Not a ledger recovery kit");
  const key = passphraseKey(passphrase, Buffer.from(kit.kdf.salt, "base64"), {
    N: kit.kdf.N,
    r: kit.kdf.r,
    p: kit.kdf.p,
  });
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(kit.iv, "base64"));
  decipher.setAuthTag(Buffer.from(kit.tag, "base64"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(kit.ciphertext, "base64")),
      decipher.final(),
    ]);
  } catch {
    throw new Error("Wrong recovery passphrase");
  }
}

export function saveRecoveryKit(kit: RecoveryKit) {
  fs.mkdirSync(keysDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(recoveryKitPath(), JSON.stringify(kit, null, 2), { mode: 0o600 });
}

export function loadRecoveryKit(): RecoveryKit | null {
  const file = recoveryKitPath();
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as RecoveryKit;
}
