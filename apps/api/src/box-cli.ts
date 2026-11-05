import "./load-env.js";
import readline from "node:readline";
import QRCode from "qrcode";
import { pruneBackups, restoreBackup, runBackup } from "./backup.js";
import { verifyChain } from "./chain.js";
import { closePool, getPool } from "./db.js";
import { runMigrationsOnPool } from "./migrate.js";

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

async function secret(envName: string, prompt: string): Promise<string> {
  const value = process.env[envName] || (await ask(prompt));
  if (!value) throw new Error(`${envName} is required`);
  return value;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const usage = `Usage: node apps/api/dist/box-cli.js <command>

  migrate                 Apply database migrations
  backup                  Write an encrypted backup to BACKUP_DIR
  restore <file>          Restore a backup onto this box (stop the app first)
  verify-chain            Check the ledger fingerprint chain
  qr                      Print a QR code for the WireGuard config on stdin`;

async function main() {
  const [command, arg] = process.argv.slice(2);
  switch (command) {
    case "migrate": {
      console.log(await runMigrationsOnPool(getPool()));
      break;
    }
    case "backup": {
      const dir = process.env.BACKUP_DIR;
      if (!dir) throw new Error("BACKUP_DIR is not set");
      const file = await runBackup(dir, await secret("BACKUP_PASSPHRASE", "Backup passphrase: "));
      pruneBackups(dir, Number(process.env.BACKUP_KEEP ?? 30));
      console.log(`Backup written: ${file}`);
      break;
    }
    case "restore": {
      if (!arg) throw new Error("Pass the backup file to restore");
      const result = await restoreBackup(
        arg,
        await secret("BACKUP_PASSPHRASE", "Backup passphrase: "),
        await secret("RECOVERY_PASSPHRASE", "Recovery passphrase: "),
      );
      console.log(
        result.installed_key
          ? "Restored. The data key was recovered from the kit inside the backup."
          : "Restored. This box already had the matching data key.",
      );
      const report = await verifyChain();
      console.log(report.ok ? "Fingerprint chain OK." : "Fingerprint chain has problems:", report.problems);
      break;
    }
    case "verify-chain": {
      const report = await verifyChain();
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.ok ? 0 : 2;
      break;
    }
    case "qr": {
      const text = (await readStdin()).trim();
      if (!text) throw new Error("Pipe a WireGuard config into this command");
      console.log(await QRCode.toString(text, { type: "terminal", small: true }));
      break;
    }
    default:
      console.log(usage);
      process.exitCode = command ? 1 : 0;
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void closePool());
