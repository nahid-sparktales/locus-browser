import { dialog, type BrowserWindow, type MessageBoxOptions, type MessageBoxReturnValue } from "electron";
import { createRequire } from "node:module";
import type { UpdateInfo } from "electron-updater";

const { autoUpdater } = createRequire(import.meta.url)("electron-updater") as typeof import("electron-updater");

export class AppUpdater {
  #initialized = false;
  #checking = false;
  #window: (() => BrowserWindow | undefined) | undefined;

  initialize(window: () => BrowserWindow | undefined): void {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#window = window;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = true;
    autoUpdater.channel = "canary";
    autoUpdater.on("update-available", (info) => void this.#offerDownload(info, window()));
    autoUpdater.on("update-not-available", () => {
      if (this.#checking) void showMessageBox(window(), {
        type: "info",
        title: "Locus Browser is up to date",
        message: "You already have the newest canary.",
      });
      this.#checking = false;
    });
    autoUpdater.on("update-downloaded", (info) => void this.#offerRestart(info, window()));
    autoUpdater.on("error", (error) => {
      if (!this.#checking) return;
      this.#checking = false;
      void showMessageBox(window(), {
        type: "error",
        title: "Couldn’t check for updates",
        message: "Locus Browser could not verify the canary update feed.",
        detail: error.message.slice(0, 1_000),
      });
    });
  }

  async check(manual = false): Promise<void> {
    if (!this.#initialized || this.#checking) return;
    this.#checking = manual;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      const shouldReport = manual && this.#checking;
      this.#checking = false;
      if (shouldReport) {
        void showMessageBox(this.#window?.(), {
          type: "error",
          title: "Couldn’t check for updates",
          message: "Locus Browser could not verify the canary update feed.",
          detail: (error instanceof Error ? error.message : "Unknown update error").slice(0, 1_000),
        });
      }
    }
  }

  async #offerDownload(info: UpdateInfo, window?: BrowserWindow): Promise<void> {
    this.#checking = false;
    const result = await showMessageBox(window, {
      type: "info",
      buttons: ["Download Update", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Locus Browser update available",
      message: `Canary ${info.version} is ready to download.`,
      detail: "The download is signed and will be verified by macOS before installation.",
    });
    if (result.response === 0) await autoUpdater.downloadUpdate();
  }

  async #offerRestart(info: UpdateInfo, window?: BrowserWindow): Promise<void> {
    const result = await showMessageBox(window, {
      type: "info",
      buttons: ["Restart and Install", "Install on Quit"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `Locus Browser ${info.version} has been verified and is ready.`,
    });
    if (result.response === 0) autoUpdater.quitAndInstall(false, true);
  }
}

function showMessageBox(window: BrowserWindow | undefined, options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
}
