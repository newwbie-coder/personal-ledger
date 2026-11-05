import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { LICENSE_PUBLIC_KEY_PEM } from "./license-key.js";

const payloadSchema = z.object({
  format: z.literal("ledger-license-v1"),
  license_id: z.string().min(1),
  company_name: z.string().min(1).max(200),
  max_users: z.number().int().min(1),
  edition: z.string().min(1),
  issued_at: z.string().min(1),
});

const fileSchema = z.object({
  payload: payloadSchema,
  signature: z.string().min(1),
});

export type LicensePayload = z.infer<typeof payloadSchema>;
export type LicenseFile = z.infer<typeof fileSchema>;

/** Same canonical form the issue script signs: keys sorted, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Verify a license file offline against the public key built into the app. */
export function verifyLicense(input: unknown): LicenseFile {
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) throw new Error("This is not a valid license file");
  const ok = verify(
    null,
    Buffer.from(canonicalJson(parsed.data.payload), "utf8"),
    createPublicKey(LICENSE_PUBLIC_KEY_PEM),
    Buffer.from(parsed.data.signature, "base64"),
  );
  if (!ok) throw new Error("License signature is invalid");
  return parsed.data;
}
