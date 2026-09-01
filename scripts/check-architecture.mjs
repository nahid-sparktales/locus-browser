import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const sourceBudgets = new Map([
  ["apps/desktop/src/main/BrowserController.ts", 5_200],
  ["apps/desktop/src/main/BrowserDatabase.ts", 1_300],
  ["apps/desktop/src/renderer/Shell.tsx", 1_600],
  ["apps/desktop/src/renderer/WorkDock.tsx", 700],
  ["services/sync/src/requestHandler.ts", 430],
  ["packages/extensions/src/index.ts", 80],
  ["packages/sync-crypto/src/index.ts", 80],
]);

for (const [path, limit] of sourceBudgets) {
  const lines = (await readFile(join(root, path), "utf8")).split(/\r?\n/).length;
  if (lines > limit) failures.push(`${path} has ${lines} lines; architecture budget is ${limit}`);
}

const rendererEntry = await readFile(join(root, "apps/desktop/src/renderer/main.tsx"), "utf8");
for (const surface of ["Shell", "WorkDock", "RecorderSurface", "ReaderSurface", "previewBridge"]) {
  if (!rendererEntry.includes(`import("./${surface}.js")`)) failures.push(`renderer ${surface} must remain dynamically imported`);
}
if (/^import\s+.*from\s+["']\.\/(?:Shell|WorkDock|RecorderSurface|ReaderSurface|previewBridge)\.js["']/m.test(rendererEntry)) {
  failures.push("renderer surfaces and preview fixtures must not be statically imported by main.tsx");
}

const viteConfig = await readFile(join(root, "apps/desktop/vite.config.ts"), "utf8");
if (!/emptyOutDir:\s*true/.test(viteConfig)) failures.push("renderer builds must clear stale output with emptyOutDir: true");

const preload = await readFile(join(root, "apps/desktop/src/preload/index.ts"), "utf8");
for (const api of ["getShellState", "getWorkState", "subscribeShellState", "subscribeWorkState"]) {
  if (!preload.includes(api)) failures.push(`preload is missing surface-specific API ${api}`);
}
if (/\bgetState\b|subscribe:\s*\(listener:\s*\(state:/.test(preload)) failures.push("preload must not restore the legacy composite state API");

const graph = await localImportGraph();
for (const cycle of importCycles(graph)) failures.push(`local import cycle: ${cycle.join(" -> ")}`);

if (failures.length) {
  console.error(`Architecture check failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`Architecture check passed for ${graph.size} source modules.`);

async function localImportGraph() {
  const sourceRoots = ["apps", "packages", "services"].map((path) => join(root, path));
  const files = (await Promise.all(sourceRoots.map(walk))).flat()
    .filter((path) => [".ts", ".tsx", ".mts", ".mjs"].includes(extname(path)))
    .filter((path) => !path.includes(`${join("", "dist")}/`) && !path.includes(`${join("", "node_modules")}/`));
  const known = new Set(files.map(normalize));
  const graph = new Map();
  const importPattern = /(?:from\s+|import\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g;
  for (const file of files) {
    const dependencies = [];
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const dependency = resolveImport(file, match[1], known);
      if (dependency) dependencies.push(dependency);
    }
    graph.set(normalize(file), dependencies);
  }
  return graph;
}

function resolveImport(importer, specifier, known) {
  const raw = resolve(dirname(importer), specifier);
  const withoutJavaScript = raw.replace(/\.(?:c|m)?js$/, "");
  for (const candidate of [raw, `${withoutJavaScript}.ts`, `${withoutJavaScript}.tsx`, join(withoutJavaScript, "index.ts")]) {
    if (known.has(normalize(candidate))) return normalize(candidate);
  }
  return undefined;
}

function importCycles(graph) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const visit = (node) => {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      cycles.push([...stack.slice(start), node].map((path) => relative(root, path)));
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of graph.keys()) visit(node);
  return cycles;
}

async function walk(path) {
  if (!(await stat(path)).isDirectory()) return [path];
  const entries = await readdir(path, { withFileTypes: true });
  const children = entries
    .filter((entry) => entry.name !== "dist" && entry.name !== "node_modules")
    .map((entry) => join(path, entry.name));
  return (await Promise.all(children.map(async (child) => (await stat(child)).isDirectory() ? await walk(child) : [child]))).flat();
}
