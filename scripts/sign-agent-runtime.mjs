import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

export default async function signAgentRuntime(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const runtime = join(app, "Contents", "Resources", "AgentRuntime");
  if (!existsSync(runtime)) throw new Error("Packaged agent runtime is missing");
  const identity = process.env.CSC_NAME || developerIdIdentity() || "-";
  const candidates = walk(runtime).filter((path) => {
    const name = path.split("/").at(-1) || "";
    return name === "codex" || name === "whisper-cli" || name === "locus-semantic-helper"
      || name.endsWith(".so") || name.endsWith(".dylib") || /^python3(?:\.\d+)?$/.test(name);
  });
  for (const path of candidates.sort((left, right) => right.length - left.length)) {
    const arguments_ = ["--force", "--options", "runtime", "--sign", identity];
    if (identity !== "-") arguments_.push("--timestamp");
    arguments_.push(path);
    execFileSync("/usr/bin/codesign", arguments_, { stdio: "pipe" });
  }
  process.stdout.write(`  • signed bundled agent runtime  files=${candidates.length}\n`);
}

function developerIdIdentity() {
  try {
    const output = execFileSync("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
    return /\"(Developer ID Application: [^\"]+)\"/.exec(output)?.[1];
  } catch {
    return undefined;
  }
}

function walk(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile() && lstatSync(path).size > 0) files.push(path);
  }
  return files;
}
