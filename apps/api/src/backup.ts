import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import {
  getDataKey,
  installDataKey,
  loadRecoveryKit,
  openRecoveryKit,
  passphraseKey,
  type RecoveryKit,
  saveRecoveryKit,
} from "./box.js";

/**
 * Backup file layout:
 *   "LBK1" | salt (16) | iv (12) | GCM tag (16) | AES-256-GCM( gzip( kitLen (4, BE) | kit JSON | SQL dump ) )
 */
const MAGIC = Buffer.from("LBK1", "ascii");
const HEADER_LEN = 4 + 16 + 12 + 16;
const TAG_OFFSET = 4 + 16 + 12;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  return url;
}

function pgTool(name: "pg_dump" | "psql"): string {
  const bin = process.env.PG_BIN;
  return bin ? path.join(bin, name) : name;
}

function waitForExit(child: ReturnType<typeof spawn>, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${name} failed (exit ${code}): ${stderr.trim().slice(0, 400)}`));
    });
  });
}

export async function runBackup(dir: string, passphrase: string): Promise<string> {
  const kit = loadRecoveryKit();
  if (!kit) throw new Error("No recovery kit on this box; finish setup before backing up");

  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `ledger-${stamp}.lbk`);
  const partial = `${file}.part`;

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", passphraseKey(passphrase, salt), iv);

  const out = fs.createWriteStream(partial, { mode: 0o600 });
  out.write(Buffer.concat([MAGIC, salt, iv, Buffer.alloc(16)]));

  const dump = spawn(
    pgTool("pg_dump"),
    ["--no-owner", "--no-privileges", "--clean", "--if-exists", "--dbname", databaseUrl()],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const dumpDone = waitForExit(dump, "pg_dump");

  const kitBytes = Buffer.from(JSON.stringify(kit), "utf8");
  const lenPrefix = Buffer.alloc(4);
  lenPrefix.writeUInt32BE(kitBytes.length);

  async function* source() {
    yield lenPrefix;
    yield kitBytes;
    for await (const chunk of dump.stdout!) yield chunk as Buffer;
  }

  try {
    await pipeline(source(), zlib.createGzip(), cipher, out);
    await dumpDone;
    const fd = fs.openSync(partial, "r+");
    try {
      fs.writeSync(fd, cipher.getAuthTag(), 0, 16, TAG_OFFSET);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(partial, file);
    return file;
  } catch (err) {
    fs.rmSync(partial, { force: true });
    throw err;
  }
}

function readHeader(file: string) {
  const fd = fs.openSync(file, "r");
  try {
    const header = Buffer.alloc(HEADER_LEN);
    if (fs.readSync(fd, header, 0, HEADER_LEN, 0) !== HEADER_LEN || !header.subarray(0, 4).equals(MAGIC)) {
      throw new Error("Not a ledger backup file");
    }
    return {
      salt: header.subarray(4, 20),
      iv: header.subarray(20, 32),
      tag: header.subarray(32, 48),
    };
  } finally {
    fs.closeSync(fd);
  }
}

/** Splits the decrypted stream into the embedded recovery kit and the SQL that follows. */
class BackupReader extends Writable {
  private head = Buffer.alloc(0);
  private kitLen = -1;
  kit: RecoveryKit | null = null;

  constructor(private readonly sql: (chunk: Buffer) => Promise<void> | void) {
    super();
  }

  override _write(chunk: Buffer, _enc: BufferEncoding, done: (err?: Error) => void) {
    try {
      let rest = chunk;
      if (!this.kit) {
        this.head = Buffer.concat([this.head, chunk]);
        if (this.kitLen < 0 && this.head.length >= 4) this.kitLen = this.head.readUInt32BE(0);
        if (this.kitLen < 0 || this.head.length < 4 + this.kitLen) return done();
        this.kit = JSON.parse(this.head.subarray(4, 4 + this.kitLen).toString("utf8")) as RecoveryKit;
        rest = this.head.subarray(4 + this.kitLen);
        this.head = Buffer.alloc(0);
      }
      Promise.resolve(rest.length ? this.sql(rest) : undefined).then(() => done(), done);
    } catch (err) {
      done(err as Error);
    }
  }
}

function decryptStream(file: string, passphrase: string) {
  const { salt, iv, tag } = readHeader(file);
  const decipher = createDecipheriv("aes-256-gcm", passphraseKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  return [fs.createReadStream(file, { start: HEADER_LEN }), decipher, zlib.createGunzip()] as const;
}

/**
 * Restore a backup into this box's database.
 * The whole file is authenticated first, so a damaged or tampered backup is never partly applied.
 */
export async function restoreBackup(
  file: string,
  backupPassphrase: string,
  recoveryPassphrase: string,
): Promise<{ installed_key: boolean }> {
  const check = new BackupReader(() => undefined);
  try {
    await pipeline(...decryptStream(file, backupPassphrase), check);
  } catch {
    throw new Error("Backup passphrase is wrong or the file is damaged");
  }
  if (!check.kit) throw new Error("Backup has no recovery kit inside");
  const key = openRecoveryKit(check.kit, recoveryPassphrase);

  const existing = getDataKey();
  if (existing && !existing.equals(key)) {
    throw new Error("This box already has a different data key. Restore onto a fresh box.");
  }

  const psql = spawn(
    pgTool("psql"),
    ["--quiet", "--set", "ON_ERROR_STOP=1", "--dbname", databaseUrl()],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  const psqlDone = waitForExit(psql, "psql");
  const writeSql = (chunk: Buffer) =>
    new Promise<void>((resolve, reject) => {
      psql.stdin!.write(chunk, (err) => (err ? reject(err) : resolve()));
    });

  await pipeline(...decryptStream(file, backupPassphrase), new BackupReader(writeSql));
  psql.stdin!.end();
  await psqlDone;

  if (!existing) {
    installDataKey(key);
    saveRecoveryKit(check.kit);
    return { installed_key: true };
  }
  return { installed_key: false };
}

export function pruneBackups(dir: string, keep: number) {
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^ledger-.*\.lbk$/.test(f))
    .sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    fs.rmSync(path.join(dir, f), { force: true });
  }
}
