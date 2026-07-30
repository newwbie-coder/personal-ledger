import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyBytes(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? "dev-encryption-key-change-me";
  return createHash("sha256").update(raw).digest();
}

/** Encrypt a secret string for platform storage. Never send ciphertext to the browser. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
