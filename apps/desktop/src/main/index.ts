import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Menu, app } from "electron";
import { BrowserController, platformRootFromApp } from "./BrowserController.js";

app.name = "Locus Browser";
app.setPath("userData", join(app.getPath("appData"), "Locus Browser"));

let controller: BrowserController | undefined;

app.on("certificate-error", (event, _contents, _url, _error, _certificate, callback) => {
  event.preventDefault();
  callback(false);
});

app.whenReady().then(() => {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const rendererUrl = process.env.LOCUS_RENDERER_URL
    || new URL(`file://${join(currentDirectory, "..", "renderer", "index.html")}`).toString();
  const preloadPath = join(currentDirectory, "..", "preload", "index.cjs");
  controller = new BrowserController(rendererUrl, preloadPath, platformRootFromApp());
  installMenu();
});

app.on("activate", () => {
  if (!controller) return;
  controller.window.show();
});

app.on("window-all-closed", () => app.quit());

function installMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "about" },
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
        { label: "New Tab", accelerator: "CmdOrCtrl+T", click: () => void controller?.command({ type: "new-tab" }) },
        { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: () => {
          const id = controller?.state().activeTabId;
          if (id) void controller?.command({ type: "close-tab", tabId: id });
        } },
      ],
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "View",
      submenu: [
        { label: "Focus Address Bar", accelerator: "CmdOrCtrl+L", click: () => controller?.focusAddress() },
        { label: "Toggle Work Mode", accelerator: "CmdOrCtrl+Alt+L", click: () => controller?.toggleWork() },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
      ],
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }] },
  ]));
}
