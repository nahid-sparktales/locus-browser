import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, Menu, app, ipcMain, nativeImage, type IpcMainInvokeEvent } from "electron";
import { AppUpdater } from "./AppUpdater.js";
import { BrowserController, platformRootFromApp } from "./BrowserController.js";
import { snapshotDatabaseForVersion } from "./DatabaseSnapshot.js";
import { requiresShellSender } from "./BrowserCommandPolicy.js";
import { BrowserCommandSchema, ipcChannels } from "../shared/ipc.js";

app.name = "Locus Browser";
app.setPath("userData", process.env.LOCUS_BROWSER_USER_DATA || join(app.getPath("appData"), "Locus Browser"));

const controllers = new Set<BrowserController>();
const updater = new AppUpdater();
let rendererUrl = "";
let preloadPath = "";
let platformRoot = "";

app.on("certificate-error", (event, _contents, _url, _error, _certificate, callback) => {
  event.preventDefault();
  callback(false);
});

app.whenReady().then(() => {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  rendererUrl = process.env.LOCUS_RENDERER_URL
    || new URL(`file://${join(currentDirectory, "..", "renderer", "index.html")}`).toString();
  preloadPath = join(currentDirectory, "..", "preload", "index.cjs");
  platformRoot = platformRootFromApp();
  snapshotDatabaseForVersion(join(app.getPath("userData"), "browser.sqlite3"), app.getVersion());
  installAppIcon();
  installIpc();
  createWindow(false, "default");
  installMenu();
  if (app.isPackaged) {
    updater.initialize(() => focusedController()?.window);
    setTimeout(() => void updater.check(false), 15_000);
  }
});

function installAppIcon(): void {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), "assets", "icon.png"));
  if (!icon.isEmpty() && process.platform === "darwin") app.dock?.setIcon(icon);
}

app.on("activate", () => {
  const existing = [...controllers][0];
  if (existing) existing.window.show();
  else createWindow(false, "default");
});

app.on("window-all-closed", () => app.quit());

function installMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { label: "Check for Updates…", enabled: app.isPackaged, click: () => void updater.check(true) },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Tab", accelerator: "CmdOrCtrl+T", click: () => void focusedController()?.command({ type: "new-tab" }) },
        { label: "New Private Window", accelerator: "CmdOrCtrl+Shift+N", click: () => {
          const profileId = focusedController()?.state().profileId ?? "default";
          createWindow(true, profileId);
        } },
        { type: "separator" },
        { label: "Save Page as PDF…", click: () => void focusedController()?.command({ type: "save-page-pdf" }) },
        { label: "Print…", accelerator: "CmdOrCtrl+P", click: () => void focusedController()?.command({ type: "print-page" }) },
        { type: "separator" },
        { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: () => {
          const controller = focusedController();
          const id = controller?.state().activeTabId;
          if (id) void controller.command({ type: "close-tab", tabId: id });
        } },
      ],
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "View",
      submenu: [
        { label: "Focus Address Bar", accelerator: "CmdOrCtrl+L", click: () => focusedController()?.focusAddress() },
        { label: "Find in Page", accelerator: "CmdOrCtrl+F", click: () => void focusedController()?.command({ type: "toggle-find" }) },
        { label: "Toggle Work Mode", accelerator: "CmdOrCtrl+Alt+L", click: () => focusedController()?.toggleWork() },
        { type: "separator" },
        { label: "Reload Page", accelerator: "CmdOrCtrl+R", click: () => void focusedController()?.command({ type: "reload" }) },
        { role: "toggleDevTools" },
        { type: "separator" },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: () => void focusedController()?.command({ type: "zoom-reset" }) },
        { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: () => void focusedController()?.command({ type: "zoom-in" }) },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => void focusedController()?.command({ type: "zoom-out" }) },
        { role: "togglefullscreen" },
      ],
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }] },
  ]));
}

function createWindow(privateWindow: boolean, profileId: string): BrowserController {
  const controller = new BrowserController(rendererUrl, preloadPath, platformRoot, {
    privateWindow,
    profileId,
    onNewPrivateWindow: (requestedProfileId) => createWindow(true, requestedProfileId),
    onOpenProfile: (requestedProfileId) => {
      const existing = [...controllers].find((candidate) => !candidate.state().privateWindow && candidate.state().profileId === requestedProfileId);
      if (existing) {
        existing.window.show();
        existing.window.focus();
      } else {
        createWindow(false, requestedProfileId);
      }
    },
    canDeleteProfile: (requestedProfileId) => ![...controllers].some((candidate) => candidate.state().profileId === requestedProfileId),
  });
  controllers.add(controller);
  controller.window.once("closed", () => controllers.delete(controller));
  return controller;
}

function focusedController(): BrowserController | undefined {
  const focused = BrowserWindow.getFocusedWindow();
  if (!focused) return [...controllers][0];
  return [...controllers].find((controller) => controller.window.id === focused.id);
}

function controllerForSender(event: IpcMainInvokeEvent): BrowserController {
  const controller = [...controllers].find((candidate) => candidate.ownsSender(event.sender.id));
  if (!controller) throw new Error("Untrusted IPC sender");
  return controller;
}

function installIpc(): void {
  ipcMain.handle(ipcChannels.getState, (event) => controllerForSender(event).state());
  ipcMain.handle(ipcChannels.command, async (event, raw) => {
    const controller = controllerForSender(event);
    const command = BrowserCommandSchema.parse(raw);
    if (requiresShellSender(command) && !controller.ownsShellSender(event.sender.id)) {
      throw new Error("This command requires trusted browser chrome");
    }
    return await controller.command(command);
  });
}
