const { createServer } = require("node:http");
const { mkdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { extname, join, normalize, resolve } = require("node:path");
const { app, BrowserWindow } = require("electron");

const repositoryRoot = resolve(__dirname, "..", "..", "..");
const rendererRoot = join(repositoryRoot, "apps", "desktop", "dist", "renderer");
const outputRoot = join(repositoryRoot, "docs", "images");
const surfaces = [
  ["?surface=shell&split=1", "locus-browser-split-view.png", 1440, 940],
  ["?surface=shell&recall=1", "locus-browser-private-recall.png", 1280, 860],
  ["?surface=shell&research=1", "locus-browser-research-board.png", 1440, 940],
  ["?surface=reader", "locus-browser-reader-mode.png", 1080, 940],
  ["?surface=shell&palette=1", "locus-browser-command-palette.png", 1440, 940],
];

let server;
app.whenReady().then(async () => {
  try {
    mkdirSync(outputRoot, { recursive: true });
    server = createServer((request, response) => serveRenderer(request.url || "/", response));
    await new Promise((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Screenshot server did not bind");
    const origin = `http://127.0.0.1:${address.port}/`;
    for (const [query, name, width, height] of surfaces) {
      const window = new BrowserWindow({
        show: false,
        width,
        height,
        backgroundColor: "#f4f2e9",
        webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
      });
      await window.loadURL(`${origin}${query}`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
      const expected = name.includes("split-view") ? ".split-toolbar" : name.includes("private-recall") ? ".recall-search-wrap" : name.includes("research-board") ? ".research-artifact" : name.includes("reader-mode") ? ".reader-article" : ".command-palette";
      const visible = await window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(expected)})?.getBoundingClientRect().width)`);
      if (!visible) throw new Error(`${name} did not render ${expected}`);
      const image = await window.webContents.capturePage();
      writeFileSync(join(outputRoot, name), image.toPNG(), { mode: 0o644 });
      window.destroy();
    }
    process.stdout.write(`Captured ${surfaces.length} public productivity screenshots.\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
    app.exit(1);
  }
});

function serveRenderer(rawUrl, response) {
  const pathname = new URL(rawUrl, "http://127.0.0.1").pathname;
  const requested = pathname === "/" ? "index.html" : normalize(pathname).replace(/^\/+/, "");
  const path = join(rendererRoot, requested);
  if (!path.startsWith(`${rendererRoot}/`)) { response.writeHead(403).end(); return; }
  try {
    if (!statSync(path).isFile()) throw new Error("not file");
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
    response.writeHead(200, { "content-type": `${types[extname(path)] || "application/octet-stream"}; charset=utf-8` });
    response.end(readFileSync(path));
  } catch { response.writeHead(404).end(); }
}

app.on("window-all-closed", () => {});
app.on("before-quit", () => server?.close());
