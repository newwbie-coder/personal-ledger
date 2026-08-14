import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const FIELD_PREFIX = "v2field";

function dataKeySecret(): string {
  return process.env.DATA_KEY_SECRET ?? process.env.ENCRYPTION_KEY ?? "dev-data-key-secret";
}

/** Derive KEK from platform secret + license binding material. */
export function deriveKek(input: {
  license_id: string;
  company_uuid: string;
  activation_token: string;
}): Buffer {
  const salt = Buffer.from("ledger-envelope-v1", "utf8");
  const info = Buffer.from(
    `${input.license_id}|${input.company_uuid}|${input.activation_token}`,
    "utf8",
  );
  return Buffer.from(hkdfSync("sha256", dataKeySecret(), salt, info, 32));
}

export function generateDek(): Buffer {
  return randomBytes(32);
}

/** Wrap DEK with KEK → store on Control DB. */
export function wrapDek(kek: Buffer, dek: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const enc = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2wrap:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function unwrapDek(kek: Buffer, payload: string): Buffer {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v2wrap" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid wrapped DEK");
  }
  const decipher = createDecipheriv("aes-256-gcm", kek, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
}

export function isSealedField(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(`${FIELD_PREFIX}:`);
}

/** Encrypt a UTF-8 string field with the workspace DEK. */
export function sealField(dek: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${FIELD_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function openField(dek: Buffer, payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== FIELD_PREFIX || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid sealed field");
  }
  const decipher = createDecipheriv("aes-256-gcm", dek, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Seal a money amount (stored as text ciphertext). */
export function sealAmount(dek: Buffer, amount: number): string {
  return sealField(dek, String(amount));
}

/**
 * Open amount: sealed ciphertext, or legacy plaintext NUMERIC/string.
 * Returns NaN only if completely unreadable.
 */
export function openAmount(dek: Buffer | null, raw: unknown): number {
  if (raw == null) return 0;
  const s = String(raw);
  if (isSealedField(s)) {
    if (!dek) throw new Error("DEK required to decrypt amount");
    return Number(openField(dek, s));
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function openText(dek: Buffer | null, raw: unknown): string {
  if (raw == null) return "";
  const s = String(raw);
  if (isSealedField(s)) {
    if (!dek) throw new Error("DEK required to decrypt field");
    return openField(dek, s);
  }
  return s;
}

/** Fingerprint for debugging (never a secret). */
export function dekFingerprint(dek: Buffer): string {
  return createHash("sha256").update(dek).digest("hex").slice(0, 12);
}
