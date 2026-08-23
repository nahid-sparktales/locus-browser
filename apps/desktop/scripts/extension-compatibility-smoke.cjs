const { createServer } = require("node:http");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { app, BrowserWindow, session } = require("electron");

const repositoryRoot = resolve(__dirname, "..", "..", "..");
const fixture = join(repositoryRoot, "fixtures", "extensions", "canary-compatibility");
const registry = JSON.parse(readFileSync(join(repositoryRoot, "packages", "extensions", "registry.json"), "utf8"));
const warnings = [];
let server;

app.whenReady().then(async () => {
  try {
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body>Compatibility fixture</body></html>");
    });
    await new Promise((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Compatibility server did not bind");
    const profile = session.fromPartition(`persist:locus-extension-compat-${Date.now()}`);
    const extension = await profile.extensions.loadExtension(fixture, { allowFileAccess: false });
    const window = new BrowserWindow({
      show: false,
      webPreferences: { session: profile, sandbox: true, nodeIntegration: false, contextIsolation: true },
    });
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: false }));
    window.webContents.on("console-message", (details) => {
      const message = typeof details === "object" ? details.message : String(details);
      if (/extension|manifest|permission/i.test(message)) warnings.push(message);
    });
    await window.loadURL(`http://127.0.0.1:${address.port}/`);
    const deadline = Date.now() + 10_000;
    let exercised;
    while (Date.now() < deadline) {
      exercised = await window.webContents.executeJavaScript("document.documentElement.dataset.locusCompatibility || ''");
      if (exercised) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    if (!exercised) throw new Error("Canary extension content script did not run");
    const capabilities = JSON.parse(exercised);
    for (const name of ["runtime", "storageLocal", "contentScript"]) {
      if (capabilities[name] !== true) throw new Error(`Extension capability failed: ${name}`);
    }
    const unsupported = warnings.filter((message) => /unknown|unsupported|unrecognized|not implemented/i.test(message));
    if (unsupported.length) throw new Error(`Electron rejected the canary contract: ${unsupported.join(" | ")}`);
    const output = join(repositoryRoot, "release", "extension-compatibility.json");
    mkdirSync(join(repositoryRoot, "release"), { recursive: true });
    writeFileSync(output, `${JSON.stringify({
      contractVersion: registry.contractVersion,
      electron: process.versions.electron,
      extension: { id: extension.id, name: extension.name, version: extension.version },
      exercised: registry.canaryEngine.exercised,
      permissionAdmission: registry.canaryEngine.permissionAdmission,
      warnings,
      passedAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 });
    window.destroy();
    process.stdout.write(`Canary extension compatibility passed on Electron ${process.versions.electron}.\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
    app.exit(1);
  }
});

app.on("window-all-closed", () => {});
app.on("before-quit", () => server?.close());
