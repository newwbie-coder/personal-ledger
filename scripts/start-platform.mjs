/**
 * Production start for Railway/Render: license (internal) + API (public PORT).
 * Usage: node scripts/start-platform.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const licensePort = process.env.LICENSE_PORT ?? "4100";
const apiPort = process.env.PORT ?? process.env.API_PORT ?? "4000";

process.env.LICENSE_SERVER_URL =
  process.env.LICENSE_SERVER_URL ?? `http://127.0.0.1:${licensePort}`;
process.env.LICENSE_PORT = licensePort;
process.env.API_PORT = apiPort;
process.env.PORT = apiPort;

function run(name, cwd, args, env = {}) {
  const child = spawn("node", args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    console.error(`[${name}] exited code=${code} signal=${signal}`);
    process.exit(code ?? 1);
  });
  return child;
}

console.log(`Starting license on ${licensePort}, API on ${apiPort}`);
run("license", path.join(root, "apps/license"), ["dist/index.js"], {
  PORT: licensePort,
  LICENSE_PORT: licensePort,
});

setTimeout(() => {
  run("api", path.join(root, "apps/api"), ["dist/index.js"], {
    PORT: apiPort,
    API_PORT: apiPort,
    LICENSE_SERVER_URL: process.env.LICENSE_SERVER_URL,
  });
}, 800);
