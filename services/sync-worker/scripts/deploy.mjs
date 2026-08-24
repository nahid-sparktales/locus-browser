import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const configUrl = new URL("../wrangler.jsonc", import.meta.url);
const config = await readFile(configUrl, "utf8");
const placeholders = [
  "00000000000000000000000000000000",
  "REPLACE_WITH_SYNC_HOSTNAME",
];
const unresolved = placeholders.filter((value) => config.includes(value));
if (unresolved.length) {
  throw new Error("Production Cloudflare bindings are not configured. Run the provisioning checklist before deployment.");
}

const child = spawn("wrangler", ["deploy"], { stdio: "inherit", shell: process.platform === "win32" });
child.once("error", (error) => { throw error; });
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
