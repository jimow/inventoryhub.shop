#!/usr/bin/env node
/**
 * Dev wrapper that picks the port per deployment, same as scripts/start.mjs.
 * Reliable per-shop method: put `PORT=3002` in that folder's .env.local, then
 * `npm run dev`.
 *
 * Port resolution: --port/-p arg → PORT env → PORT in .env.local → 3000.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function fromEnvFile() {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const m = raw.match(/^\s*PORT\s*=\s*(\d+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const argv = process.argv.slice(2);
const argPort = (() => {
  const i = argv.findIndex((a) => a === "-p" || a === "--port");
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith("--port="));
  return eq ? eq.split("=")[1] : null;
})();

const port = String(argPort || process.env.PORT || fromEnvFile() || "3000");

console.log(`\n▶ Starting Next.js (dev) on port ${port}\n`);

const child = spawn("npx", ["next", "dev", "--turbo", "-p", port], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, PORT: port, NODE_OPTIONS: "--max-http-header-size=65536" },
});
child.on("exit", (code) => process.exit(code ?? 0));
