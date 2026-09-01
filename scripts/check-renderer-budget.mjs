import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rendererDirectory = join(root, "apps/desktop/dist/renderer");
const assetDirectory = join(rendererDirectory, "assets");
const assets = await readdir(assetDirectory);
const sizes = await Promise.all(assets.map(async (name) => ({ name, size: (await stat(join(assetDirectory, name))).size })));
const totalBytes = sizes.reduce((total, asset) => total + asset.size, 0);
const failures = [];

if (assets.length > 20) failures.push(`renderer emitted ${assets.length} assets; budget is 20`);
if (totalBytes > 750 * 1024) failures.push(`renderer assets total ${formatBytes(totalBytes)}; budget is 750 KiB`);
if (Math.max(...sizes.filter((asset) => asset.name.endsWith(".js")).map((asset) => asset.size)) > 240 * 1024) {
  failures.push("a renderer JavaScript chunk exceeds the 240 KiB uncompressed budget");
}
for (const chunk of ["Shell-", "WorkDock-", "RecorderSurface-", "ReaderSurface-", "previewBridge-"]) {
  if (!assets.some((asset) => asset.startsWith(chunk))) failures.push(`missing independently loaded ${chunk.slice(0, -1)} chunk`);
}

const indexHtml = await readFile(join(rendererDirectory, "index.html"), "utf8");
if (indexHtml.includes("previewBridge-")) failures.push("production HTML must not eagerly load preview fixtures");

if (failures.length) {
  console.error(`Renderer budget check failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`Renderer budget passed: ${assets.length} assets, ${formatBytes(totalBytes)} total.`);

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
