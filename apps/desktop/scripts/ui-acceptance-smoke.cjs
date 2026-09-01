const { createServer } = require("node:http");
const { mkdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { extname, join, normalize, resolve } = require("node:path");
const { app, BrowserWindow } = require("electron");

app.commandLine.appendSwitch("force-prefers-reduced-motion", "reduce");

const repositoryRoot = resolve(__dirname, "..", "..", "..");
const rendererRoot = join(repositoryRoot, "apps", "desktop", "dist", "renderer");
const results = [];
let server;

app.whenReady().then(async () => {
  try {
    server = createServer((request, response) => serveRenderer(request.url || "/", response));
    await new Promise((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("UI acceptance server did not bind");
    const origin = `http://127.0.0.1:${address.port}`;
    await inspectSurface(`${origin}/?surface=shell`, "shell", 1440, 940, 1, ".browser-shell");
    await inspectSurface(`${origin}/?surface=shell&settings=1`, "shell-settings", 1440, 940, 1, ".settings-surface");
    await inspectSurface(`${origin}/?surface=shell&settings=1&chatgpt=signed-in&providers=connected`, "settings-provider-accounts", 1440, 940, 1, ".provider-account-grid");
    await inspectSurface(`${origin}/?surface=shell&settings=1&chatgpt=signed-in&providers=connected`, "settings-provider-accounts-200-percent", 1440, 940, 2, ".provider-account-grid");
    await inspectSurface(`${origin}/?surface=shell&settings=1&walrus=connected`, "walrus-connected", 1440, 940, 1, ".walrus-disclosure");
    await inspectSurface(`${origin}/?surface=shell&settings=1&walrus=connected&walrus-manual=1`, "walrus-client-encrypted", 1440, 940, 1, ".walrus-mode-picker .active");
    await inspectSurface(`${origin}/?surface=shell&settings=1&walrus=failure`, "walrus-failure", 1440, 940, 1, ".walrus-message.error");
    await inspectSurface(`${origin}/?surface=shell&settings=1&walrus=progress`, "walrus-progress", 1440, 940, 1, ".walrus-heading > em.saving");
    await inspectSurface(`${origin}/?surface=shell&walrus=connected&walrus-preview=1`, "walrus-preview", 1180, 840, 1, ".walrus-preview");
    await inspectSurface(`${origin}/?surface=shell&research=1&walrus=connected&walrus-manual=1&walrus-bundle=1`, "walrus-research-bundle", 1280, 900, 1, ".research-bundle-preview");
    await inspectSurface(`${origin}/?surface=shell&research=1&walrus=connected&walrus-manual=1&walrus-bundle=1`, "walrus-research-bundle-200-percent", 1440, 940, 2, ".research-bundle-preview");
    await inspectSurface(`${origin}/?surface=shell&recording=1`, "shell-recording", 1440, 940, 1, ".record-button.recording");
    await inspectSurface(`${origin}/?surface=shell&split=1`, "shell-split", 1440, 940, 1, ".split-toolbar");
    await inspectSurface(`${origin}/?surface=shell&palette=1`, "shell-palette", 1440, 940, 1, ".command-palette");
    await inspectSurface(`${origin}/?surface=shell&recall=1`, "shell-recall", 1180, 840, 1, ".recall-search-wrap");
    await inspectSurface(`${origin}/?surface=shell&research=1`, "shell-research", 1440, 940, 1, ".research-surface");
    await inspectSurface(`${origin}/?surface=shell&steward=1`, "shell-steward", 1180, 840, 1, ".steward-surface");
    await inspectSurface(`${origin}/?surface=reader`, "reader", 900, 940, 1, ".reader-article");
    await inspectSurface(`${origin}/?surface=work`, "work", 720, 940, 1, ".work-dock");
    await inspectSurface(`${origin}/?surface=work&busy=1`, "work-activity", 520, 940, 1, ".composer-activity.thinking");
    await inspectSurface(`${origin}/?surface=work`, "work-display-preferences", 520, 940, 1, ".display-preferences", ".display-preferences-wrap > button");
    await inspectSurface(`${origin}/?surface=work&recording=1`, "work-recording", 520, 940, 1, ".live-context-card");
    await inspectSurface(`${origin}/?surface=work&walrus=connected&walrus-search=1`, "work-walrus-search", 520, 940, 1, ".walrus-memory-picker");
    await inspectSurface(`${origin}/?surface=work&walrus=connected&walrus-attached=1`, "work-walrus-attachment", 520, 940, 1, ".portable-memory-chip");
    await inspectSurface(`${origin}/?surface=work`, "work-200-percent", 720, 940, 2, ".work-dock");
    const failures = results.flatMap((result) => result.issues.map((issue) => `${result.surface}: ${issue}`));
    const output = join(repositoryRoot, "release", "ui-acceptance.json");
    mkdirSync(join(repositoryRoot, "release"), { recursive: true });
    writeFileSync(output, `${JSON.stringify({ passed: failures.length === 0, results, checkedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
    if (failures.length) throw new Error(`UI acceptance failed:\n${failures.join("\n")}`);
    process.stdout.write(`UI acceptance passed for ${results.length} responsive surfaces.\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
    app.exit(1);
  }
});

async function inspectSurface(url, surface, width, height, zoom, expectedSelector, triggerSelector) {
  const consoleErrors = [];
  const window = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    enableLargerThanScreen: true,
    webPreferences: { partition: `ui-acceptance-${surface}`, sandbox: true, nodeIntegration: false, contextIsolation: true },
  });
  window.webContents.on("console-message", (details) => {
    const level = typeof details === "object" ? details.level : "";
    const message = typeof details === "object" ? details.message : String(details);
    if (level === "error" || /uncaught|unhandled/i.test(message)) consoleErrors.push(message);
  });
  await window.loadURL(url);
  window.setContentSize(width, height, false);
  window.webContents.setZoomFactor(zoom);
  if (triggerSelector) {
    await waitForVisible(window.webContents, triggerSelector);
    await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(triggerSelector)})?.click()`);
  }
  const expectedVisible = await waitForVisible(window.webContents, expectedSelector);
  const audit = await window.webContents.executeJavaScript(`(${pageAudit.toString()})()`);
  const durations = [];
  if (surface === "shell") {
    for (let index = 0; index < 60; index += 1) {
      const started = performance.now();
      await window.webContents.executeJavaScript(`document.querySelectorAll('[role="tab"]')[${index % 2}]?.click()`);
      durations.push(performance.now() - started);
    }
  }
  const ordered = durations.toSorted((left, right) => left - right);
  const p95 = ordered.length ? ordered[Math.floor((ordered.length - 1) * 0.95)] : 0;
  const issues = [...audit.issues, ...consoleErrors.map((message) => `console error: ${message}`)];
  if (!expectedVisible) issues.unshift(`expected surface ${expectedSelector} is not visible`);
  if (p95 > 150) issues.push(`warm tab interaction p95 ${p95.toFixed(1)} ms exceeds 150 ms`);
  results.push({ surface, width, height, zoom, viewportWidth: audit.viewportWidth, viewportHeight: audit.viewportHeight, viewportOffsetLeft: audit.viewportOffsetLeft, bodyLeft: audit.bodyLeft, bodyClientWidth: audit.bodyClientWidth, bodyScrollWidth: audit.bodyScrollWidth, rootScrollWidth: audit.rootScrollWidth, reducedMotion: audit.reducedMotion, focusable: audit.focusable, p95TabInteractionMs: p95, issues });
  window.destroy();
}

async function waitForVisible(webContents, selector, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const visible = await webContents.executeJavaScript(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"; })()`);
    if (visible) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  return false;
}

function pageAudit() {
  const issues = [];
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const interactive = [...document.querySelectorAll("button, input, select, textarea, a[href], [role='button'], [role='tab']")].filter(visible);
  for (const element of interactive) {
    const name = element.getAttribute("aria-label") || element.getAttribute("title")
      || element.getAttribute("placeholder") || element.textContent?.trim();
    if (!name) issues.push(`unnamed interactive ${element.tagName.toLowerCase()}`);
  }
  const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
  for (const id of new Set(ids)) if (ids.filter((candidate) => candidate === id).length > 1) issues.push(`duplicate id ${id}`);
  for (const image of document.querySelectorAll("img")) if (!image.hasAttribute("alt")) issues.push("image without alt text");
  if (!document.documentElement.lang) issues.push("document language is missing");
  const bodyRect = document.body.getBoundingClientRect();
  const horizontalOverflow = document.body.scrollWidth - document.body.clientWidth;
  if (horizontalOverflow > 2) {
    const offenders = [...document.querySelectorAll("*")]
      .filter(visible)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.left < bodyRect.left - 2 || rect.right > bodyRect.right + 2)
      .sort((left, right) => Math.max(right.rect.right - bodyRect.right, bodyRect.left - right.rect.left) - Math.max(left.rect.right - bodyRect.right, bodyRect.left - left.rect.left))
      .slice(0, 3)
      .map(({ element, rect }) => {
        const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
        return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}[${rect.left.toFixed(1)},${rect.right.toFixed(1)}]`;
      });
    issues.push(`horizontal overflow ${horizontalOverflow}px (root ${document.documentElement.clientWidth}/${document.documentElement.scrollWidth}, body ${document.body.clientWidth}/${document.body.scrollWidth} at ${bodyRect.left.toFixed(1)}, inner ${window.innerWidth}, zoom ${window.devicePixelRatio}; ${offenders.join(", ") || "no overflowing element"})`);
  }
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const moving = [...document.querySelectorAll("*")].filter(visible).filter((element) => {
      const style = getComputedStyle(element);
      const seconds = (value) => value.split(",").some((part) => {
        const duration = part.trim();
        return duration.endsWith("ms") ? Number.parseFloat(duration) > 100 : Number.parseFloat(duration) > 0.1;
      });
      return seconds(style.animationDuration) || seconds(style.transitionDuration);
    });
    if (moving.length) issues.push(`${moving.length} visible elements still animate with Reduced Motion`);
  }
  return {
    issues,
    focusable: interactive.length,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    viewportOffsetLeft: window.visualViewport?.offsetLeft || 0,
    bodyLeft: bodyRect.left,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
  };
}

function serveRenderer(rawUrl, response) {
  const pathname = new URL(rawUrl, "http://127.0.0.1").pathname;
  const requested = pathname === "/" ? "index.html" : normalize(pathname).replace(/^\/+/, "");
  const path = join(rendererRoot, requested);
  if (!path.startsWith(`${rendererRoot}/`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (!statSync(path).isFile()) throw new Error("not file");
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
    response.writeHead(200, { "content-type": `${types[extname(path)] || "application/octet-stream"}; charset=utf-8` });
    response.end(readFileSync(path));
  } catch {
    response.writeHead(404).end();
  }
}

app.on("window-all-closed", () => {});
app.on("before-quit", () => server?.close());
