import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  BrowserWindow,
  WebContentsView,
  app,
  clipboard,
  dialog,
  nativeTheme,
  session,
  shell,
  type Rectangle,
} from "electron";
import {
  BrowserActionRequestSchema,
  type BrowserActionRequest,
  type BrowserActionResult,
} from "@locus/protocol";
import { bridgeInvocation, browserBridgeSource } from "@locus/browser-bridge";
import { ipcChannels } from "../shared/channels.js";
import type { BrowserCommand } from "../shared/ipc.js";
import type {
  Appearance,
  BrowserAppState,
  BrowserSettingsState,
  BrowserTabState,
  PendingPermission,
  PendingSitePermission,
  SearchEngine,
  SidebarSection,
  TabGroupState,
  WorkMessage,
} from "../shared/types.js";
import { AgentRuntime, type AgentEvent } from "./AgentRuntime.js";
import { BrowserDatabase, type StoredDownload, type StoredTab, type StoredTabGroup } from "./BrowserDatabase.js";
import { CredentialVault } from "./CredentialVault.js";
import { credentialAutofillInvocation, credentialObserverSource, parseCredentialCandidate, type PageCredentialCandidate } from "./CredentialPageBridge.js";
import { electronCredentialCipher } from "./ElectronCredentialCipher.js";
import { TabAccessRegistry } from "./TabAccessRegistry.js";
import { canSleepTab, shouldSleepTab } from "./TabSleepingPolicy.js";
import { SyncAccountManager } from "./SyncAccountManager.js";

const CHROME_HEIGHT = 92;
const SIDEBAR_WIDTH = 248;
const MIN_PAGE_SPLIT = 640;
const MIN_PAGE_EXPANDED = 520;
const WORK_MIN = 360;
const WORK_DEFAULT = 420;
const WORK_MAX = 720;
const AGENT_DOWNLOAD_CAP = 25 * 1024 * 1024;
const BRIDGE_WORLD = 99_941;
const SITE_PERMISSION_HEIGHT = 46;
const CREDENTIAL_PROMPT_HEIGHT = 46;
const SLEEP_CHECK_INTERVAL = 60_000;
const GROUP_COLORS = ["lime", "blue", "coral", "violet", "gold"];
const ALLOWED_SITE_PERMISSIONS = new Set(["camera", "microphone", "media", "geolocation", "notifications", "clipboard-read"]);

interface TabRecord {
  state: BrowserTabState;
  view: WebContentsView | undefined;
  console: string[];
  network: string[];
  sessionCreatedBy: string | undefined;
  agentDownloadArmedUntil: number;
  lastActiveAt: number;
  credentialBindingName: string;
}

interface BrowserPermissionWaiter {
  resolve: (decision: "allow" | "always" | "deny") => void;
}

interface SitePermissionWaiter {
  callback: (granted: boolean) => void;
  timeout: NodeJS.Timeout;
  contentsId: number;
  origin: string;
  permission: string;
}

interface PendingCredentialRecord extends PageCredentialCandidate {
  tabId: string;
  action: "save" | "update";
}

export interface BrowserControllerOptions {
  privateWindow?: boolean;
  windowId?: string;
  profileId?: string;
  onNewPrivateWindow?: (profileId: string) => void;
  onOpenProfile?: (profileId: string) => void;
  canDeleteProfile?: (profileId: string) => boolean;
}

export class BrowserController {
  readonly window: BrowserWindow;
  readonly #windowId: string;
  readonly #profileId: string;
  readonly #partitionName: string;
  readonly #privateWindow: boolean;
  readonly #onNewPrivateWindow: ((profileId: string) => void) | undefined;
  readonly #onOpenProfile: ((profileId: string) => void) | undefined;
  readonly #canDeleteProfile: ((profileId: string) => boolean) | undefined;
  readonly #database: BrowserDatabase;
  readonly #credentials: CredentialVault;
  readonly #grants = new TabAccessRegistry();
  readonly #tabs = new Map<string, TabRecord>();
  readonly #groups = new Map<string, TabGroupState>();
  readonly #runtime: AgentRuntime;
  readonly #sync: SyncAccountManager | undefined;
  readonly #permissionWaiters = new Map<string, BrowserPermissionWaiter>();
  readonly #sitePermissionWaiters = new Map<string, SitePermissionWaiter>();
  readonly #oneTimeSitePermissions = new Set<string>();
  readonly #activeDownloads = new Map<string, Electron.DownloadItem>();
  readonly #hardenedSessions = new WeakSet<Electron.Session>();
  #sessionId: string = randomUUID();
  #workView: WebContentsView | undefined;
  #activeTabId: string | undefined;
  #sidebarOpen = false;
  #sidebarSection: SidebarSection = "tabs";
  #settings: BrowserSettingsState;
  #workOpen = false;
  #workWidth = WORK_DEFAULT;
  #workOverlay = false;
  #reducedMotion = false;
  #layoutGeneration = 0;
  #screenshotConsentForSession = false;
  #workMode: BrowserAppState["work"]["mode"] = "work";
  #workPanel: BrowserAppState["work"]["panel"] = "chat";
  #runtimeState: BrowserAppState["work"]["runtime"] = "starting";
  #runtimeMessage = "Starting the local agent…";
  #busy = false;
  #messages: WorkMessage[] = [
    {
      id: randomUUID(),
      role: "assistant",
      text: "Work Mode is ready. Share this tab when you want Locus to read or interact with it.",
    },
  ];
  #pendingPermission: PendingPermission | undefined;
  #pendingSitePermission: PendingSitePermission | undefined;
  #pendingCredential: PendingCredentialRecord | undefined;
  #find = { open: false, query: "", matches: 0, activeMatchOrdinal: 0 };
  #saveTimer: NodeJS.Timeout | undefined;
  #sleepTimer: NodeJS.Timeout | undefined;
  #disposed = false;

  constructor(rendererUrl: string, preloadPath: string, platformRoot: string, options: BrowserControllerOptions = {}) {
    this.#privateWindow = Boolean(options.privateWindow);
    this.#onNewPrivateWindow = options.onNewPrivateWindow;
    this.#onOpenProfile = options.onOpenProfile;
    this.#canDeleteProfile = options.canDeleteProfile;
    this.#database = new BrowserDatabase(join(app.getPath("userData"), "browser.sqlite3"));
    const requestedProfileId = options.profileId ?? "default";
    const profile = this.#database.profile(requestedProfileId) ?? this.#database.profile("default")!;
    this.#profileId = profile.id;
    this.#partitionName = profile.partitionName;
    this.#credentials = new CredentialVault(this.#database, electronCredentialCipher, this.#profileId);
    this.#windowId = options.windowId ?? (this.#privateWindow ? `private-${randomUUID()}` : this.#profileId === "default" ? "primary" : `primary-${this.#profileId}`);
    this.#settings = this.#loadSettings();
    this.#runtime = new AgentRuntime(platformRoot, join(app.getPath("userData"), "agent"));
    const stored = this.#privateWindow ? undefined : this.#database.loadWindow(this.#windowId);
    this.#sidebarOpen = Boolean(stored?.sidebarOpen);
    this.#workOpen = Boolean(stored?.workOpen);
    this.#workWidth = clamp(stored?.workWidth ?? WORK_DEFAULT, WORK_MIN, WORK_MAX);

    this.window = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 760,
      minHeight: 560,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 16 },
      backgroundColor: this.#surfaceBackground(),
      title: this.#privateWindow ? `Private — ${profile.name} — Locus Browser` : `${profile.name} — Locus Browser`,
      show: false,
      webPreferences: trustedRendererPreferences(preloadPath),
    });
    this.window.loadURL(surfaceUrl(rendererUrl, "shell"));
    this.window.once("ready-to-show", () => this.window.show());
    this.window.on("resize", () => this.#layout(false));
    this.window.on("close", () => this.#persistNow());
    this.window.on("closed", () => this.dispose());

    this.#sync = this.#privateWindow ? undefined : new SyncAccountManager({
      database: this.#database,
      cipher: electronCredentialCipher,
      profileId: this.#profileId,
      deviceName: `${hostname().split(".")[0] || "This Mac"} · ${profile.name}`,
      parent: this.window,
      onChanged: () => this.#broadcast(),
      onDataApplied: () => this.#applySyncedData(),
      onRecoveryKey: (key) => void this.#showSyncRecoveryKey(key),
    });

    this.#configureProfileSession();
    this.#restoreTabs();
    if (this.#privateWindow) {
      this.#runtimeState = "offline";
      this.#runtimeMessage = "Work Mode is unavailable in private windows.";
    } else {
      this.#createWorkView(rendererUrl, preloadPath);
      this.#bindRuntime();
    }
    this.#layout(false);
    if (!this.#privateWindow) void this.#runtime.start();
    this.#sleepTimer = setInterval(() => this.#sleepEligibleTabs(), SLEEP_CHECK_INTERVAL);
  }

  state(): BrowserAppState {
    const activeUrl = this.#active()?.state.url ?? "";
    const credentialSuggestions = this.#credentialSuggestions(activeUrl);
    return {
      windowId: this.#windowId,
      profileId: this.#profileId,
      privateWindow: this.#privateWindow,
      tabs: [...this.#tabs.values()].map((tab) => ({
        ...tab.state,
        active: tab.state.id === this.#activeTabId,
        grants: this.#grants.grantsForTab(tab.state.id),
      })),
      groups: [...this.#groups.values()].sort((a, b) => a.position - b.position),
      profiles: this.#database.listProfiles(),
      currentProfile: this.#database.profile(this.#profileId)!,
      ...(this.#activeTabId ? { activeTabId: this.#activeTabId } : {}),
      sidebarOpen: this.#sidebarOpen,
      sidebarSection: this.#sidebarSection,
      bookmarks: this.#privateWindow ? [] : this.#database.listBookmarks(this.#profileId),
      history: this.#privateWindow ? [] : this.#database.listHistory(this.#profileId),
      downloads: this.#database.listDownloads(this.#profileId).map((download) => ({
        ...download,
        agentInitiated: Boolean(download.agentInitiated),
      })),
      sitePermissions: this.#privateWindow ? [] : this.#database.listSitePermissions(this.#profileId),
      ...(this.#pendingSitePermission ? { pendingSitePermission: this.#pendingSitePermission } : {}),
      ...(this.#pendingCredential ? {
        pendingCredential: {
          origin: this.#pendingCredential.origin,
          username: this.#pendingCredential.username,
          action: this.#pendingCredential.action,
        },
      } : {}),
      credentialSuggestions,
      savedCredentials: this.#credentials.list(),
      passwordManagerAvailable: this.#credentials.available(),
      sync: this.#sync?.state() ?? { status: "disconnected", pendingRecords: 0, devices: [] },
      remoteTabs: this.#sync?.remoteTabs() ?? [],
      onboardingRequired: !this.#privateWindow && !this.#settings.onboardingComplete,
      settings: this.#settings,
      activePageBookmarked: Boolean(!this.#privateWindow && activeUrl && this.#database.bookmarkForUrl(this.#profileId, activeUrl)),
      find: this.#find,
      zoomFactor: this.#active()?.view?.webContents.getZoomFactor() ?? 1,
      workOpen: this.#workOpen,
      workWidth: this.#workWidth,
      workOverlay: this.#workOverlay,
      searchEngine: this.#settings.searchEngine,
      work: {
        sessionId: this.#sessionId,
        mode: this.#workMode,
        panel: this.#workPanel,
        runtime: this.#runtimeState,
        runtimeMessage: this.#runtimeMessage,
        busy: this.#busy,
        messages: this.#messages,
        ...(this.#pendingPermission ? { pendingPermission: this.#pendingPermission } : {}),
      },
    };
  }

  focusAddress(): void {
    this.window.webContents.send(ipcChannels.focusAddress);
  }

  toggleWork(): void {
    void this.command({ type: "toggle-work" });
  }

  ownsSender(senderId: number): boolean {
    return this.window.webContents.id === senderId || this.#workView?.webContents.id === senderId;
  }

  ownsShellSender(senderId: number): boolean {
    return this.window.webContents.id === senderId;
  }

  async command(command: BrowserCommand): Promise<BrowserAppState> {
    switch (command.type) {
      case "new-tab":
        this.#createTab(command.url ?? searchHome(this.#settings.searchEngine), { active: true, private: this.#privateWindow });
        break;
      case "new-private-window":
        this.#onNewPrivateWindow?.(this.#profileId);
        break;
      case "create-profile": {
        const profile = this.#database.createProfile(command.name);
        this.#onOpenProfile?.(profile.id);
        break;
      }
      case "open-profile":
        if (this.#database.profile(command.profileId)) this.#onOpenProfile?.(command.profileId);
        break;
      case "rename-profile":
        this.#database.renameProfile(command.profileId, command.name);
        if (command.profileId === this.#profileId) {
          this.window.setTitle(this.#privateWindow ? `Private — ${command.name} — Locus Browser` : `${command.name} — Locus Browser`);
        }
        break;
      case "delete-profile":
        await this.#deleteProfile(command.profileId);
        break;
      case "select-tab":
        await this.#selectTab(command.tabId);
        break;
      case "close-tab":
        this.#closeTab(command.tabId);
        break;
      case "reorder-tab":
        this.#reorderTab(command.tabId, command.beforeTabId);
        break;
      case "create-tab-group":
        this.#createTabGroup(command.tabId);
        break;
      case "rename-tab-group": {
        const group = this.#groups.get(command.groupId);
        if (group) group.name = command.name;
        break;
      }
      case "toggle-tab-group": {
        const group = this.#groups.get(command.groupId);
        if (group) group.collapsed = !group.collapsed;
        break;
      }
      case "set-tab-group": {
        const tab = this.#tabs.get(command.tabId);
        if (tab) {
          if (command.groupId && this.#groups.has(command.groupId)) tab.state.groupId = command.groupId;
          else delete tab.state.groupId;
        }
        break;
      }
      case "delete-tab-group":
        this.#deleteTabGroup(command.groupId);
        break;
      case "navigate":
        await this.#navigateActive(command.value);
        break;
      case "back":
        this.#active()?.view?.webContents.navigationHistory.goBack();
        break;
      case "forward":
        this.#active()?.view?.webContents.navigationHistory.goForward();
        break;
      case "reload":
        this.#active()?.view?.webContents.reload();
        break;
      case "stop":
        this.#active()?.view?.webContents.stop();
        break;
      case "toggle-sidebar":
        this.#sidebarOpen = !this.#sidebarOpen;
        this.#layout(true);
        break;
      case "set-sidebar-section":
        this.#sidebarSection = command.section;
        this.#sidebarOpen = true;
        this.#layout(true);
        break;
      case "toggle-bookmark":
        this.#toggleBookmark();
        break;
      case "remove-bookmark":
        this.#database.removeBookmark(this.#profileId, command.bookmarkId);
        break;
      case "open-library-item":
        this.#createTab(command.url, { active: true, private: this.#privateWindow });
        break;
      case "reveal-download": {
        const download = this.#database.listDownloads(this.#profileId).find((entry) => entry.id === command.downloadId);
        if (download?.path) shell.showItemInFolder(download.path);
        break;
      }
      case "cancel-download":
        this.#activeDownloads.get(command.downloadId)?.cancel();
        break;
      case "toggle-find":
        this.#find.open = !this.#find.open;
        if (!this.#find.open) this.#closeFind();
        this.#layout(false);
        break;
      case "find-in-page":
        this.#findInPage(command.query, command.forward ?? true, command.findNext ?? false);
        break;
      case "close-find":
        this.#closeFind();
        this.#layout(false);
        break;
      case "zoom-in":
        this.#setZoom((this.#active()?.view?.webContents.getZoomFactor() ?? 1) + 0.1);
        break;
      case "zoom-out":
        this.#setZoom((this.#active()?.view?.webContents.getZoomFactor() ?? 1) - 0.1);
        break;
      case "zoom-reset":
        this.#setZoom(1);
        break;
      case "print-page":
        await this.#printPage();
        break;
      case "save-page-pdf":
        await this.#savePagePdf();
        break;
      case "toggle-tab-mute": {
        const tab = this.#tabs.get(command.tabId);
        if (tab?.view && !tab.view.webContents.isDestroyed()) {
          tab.view.webContents.setAudioMuted(!tab.view.webContents.isAudioMuted());
          tab.state.muted = tab.view.webContents.isAudioMuted();
        }
        break;
      }
      case "toggle-media-playback":
        await this.#toggleMediaPlayback();
        break;
      case "sleep-tab":
        this.#sleepTab(command.tabId);
        break;
      case "answer-site-permission":
        this.#answerSitePermission(command.requestId, command.decision);
        break;
      case "reset-site-permission":
        this.#database.removeSitePermission(this.#profileId, command.origin, command.permission);
        break;
      case "set-appearance":
        this.#settings = { ...this.#settings, appearance: command.appearance };
        this.#database.setSetting(this.#profileId, "appearance", command.appearance);
        this.window.setBackgroundColor(this.#surfaceBackground());
        this.#workView?.setBackgroundColor(this.#surfaceBackground());
        break;
      case "set-search-engine":
        this.#settings = { ...this.#settings, searchEngine: command.searchEngine };
        this.#database.setSetting(this.#profileId, "searchEngine", command.searchEngine);
        break;
      case "set-sleep-after":
        this.#settings = { ...this.#settings, sleepAfterMinutes: command.minutes };
        this.#database.setSetting(this.#profileId, "sleepAfterMinutes", command.minutes);
        this.#sleepEligibleTabs();
        break;
      case "choose-download-directory": {
        const result = await dialog.showOpenDialog(this.window, {
          title: "Choose Downloads Folder",
          defaultPath: this.#settings.downloadDirectory,
          properties: ["openDirectory", "createDirectory"],
        });
        if (!result.canceled && result.filePaths[0]) {
          this.#settings = { ...this.#settings, downloadDirectory: result.filePaths[0] };
          this.#database.setSetting(this.#profileId, "downloadDirectory", result.filePaths[0]);
        }
        break;
      }
      case "complete-onboarding": {
        const previousHome = searchHome(this.#settings.searchEngine);
        this.#settings = {
          ...this.#settings,
          searchEngine: command.searchEngine,
          appearance: command.appearance,
          sleepAfterMinutes: command.sleepAfterMinutes,
          onboardingComplete: true,
        };
        this.#database.setSetting(this.#profileId, "searchEngine", command.searchEngine);
        this.#database.setSetting(this.#profileId, "appearance", command.appearance);
        this.#database.setSetting(this.#profileId, "sleepAfterMinutes", command.sleepAfterMinutes);
        this.#database.setSetting(this.#profileId, "onboardingComplete", true);
        this.window.setBackgroundColor(this.#surfaceBackground());
        this.#workView?.setBackgroundColor(this.#surfaceBackground());
        const tab = this.#active();
        if (tab && (tab.state.url === "about:blank" || tab.state.url === previousHome)) {
          await this.#navigateActive(searchHome(command.searchEngine));
        }
        this.#layout(false);
        break;
      }
      case "autofill-credential":
        await this.#autofillCredential(command.credentialId);
        break;
      case "save-pending-credential":
        this.#savePendingCredential();
        break;
      case "dismiss-pending-credential":
        this.#pendingCredential = undefined;
        this.#layout(true);
        break;
      case "delete-credential":
        this.#credentials.delete(command.credentialId, true);
        break;
      case "begin-sync-registration":
        this.#sync?.beginRegistration(command.displayName, command.serviceUrl);
        break;
      case "begin-sync-sign-in":
        this.#sync?.beginSignIn(command.recoveryKey, command.serviceUrl);
        break;
      case "begin-sync-device-enrollment":
        await this.#sync?.beginDeviceEnrollment(command.serviceUrl);
        break;
      case "check-sync-device-enrollment":
        this.#sync?.checkDeviceEnrollment();
        break;
      case "cancel-sync-device-enrollment":
        this.#sync?.cancelDeviceEnrollment();
        break;
      case "copy-sync-pairing-code": {
        const pairingCode = this.#sync?.state().pendingEnrollment?.pairingCode;
        if (pairingCode) clipboard.writeText(pairingCode);
        break;
      }
      case "approve-sync-device":
        await this.#sync?.approveDevice(command.pairingCode);
        break;
      case "revoke-sync-device":
        await this.#sync?.revokeDevice(command.deviceId);
        break;
      case "rotate-sync-recovery-key":
        await this.#sync?.rotateRecoveryKey();
        break;
      case "sync-now":
        this.#persistNow();
        this.#sync?.syncNow();
        break;
      case "disconnect-sync":
        this.#sync?.disconnect();
        break;
      case "delete-sync-cloud-data":
        await this.#sync?.deleteCloudData();
        break;
      case "delete-sync-account":
        await this.#sync?.deleteAccount();
        break;
      case "toggle-work":
        if (this.#privateWindow) break;
        this.#workOpen = !this.#workOpen;
        this.#layout(true);
        break;
      case "set-work-width":
        this.#workWidth = clamp(command.width, WORK_MIN, this.#maximumWorkWidth());
        this.#layout(false);
        break;
      case "set-reduced-motion":
        this.#reducedMotion = command.enabled;
        break;
      case "share-active-tab": {
        const tab = this.#active();
        if (tab && !TabAccessRegistry.isProtectedUrl(tab.state.url, tab.state.private)) {
          this.#grants.grant(this.#sessionId, tab.state.id, command.level, "user_share");
        }
        break;
      }
      case "revoke-active-tab":
        if (this.#activeTabId) this.#grants.revoke(this.#sessionId, this.#activeTabId);
        break;
      case "set-work-mode":
        this.#workMode = command.mode;
        break;
      case "set-work-panel":
        this.#workPanel = command.panel;
        break;
      case "work-send":
        this.#sendWorkMessage(command.text);
        break;
      case "stop-work":
        this.#runtime.send({ type: "interrupt" });
        break;
      case "answer-permission":
        this.#answerPermission(command.requestId, command.decision);
        break;
    }
    this.#scheduleSave();
    this.#broadcast();
    return this.state();
  }

  dispose(): void {
    if (this.#disposed) return;
    clearTimeout(this.#saveTimer);
    clearInterval(this.#sleepTimer);
    this.#persistNow();
    this.#disposed = true;
    this.#sync?.dispose();
    this.#runtime.stop();
    this.#grants.revokeSession(this.#sessionId);
    for (const download of this.#activeDownloads.values()) download.cancel();
    this.#activeDownloads.clear();
    for (const waiter of this.#sitePermissionWaiters.values()) {
      clearTimeout(waiter.timeout);
      waiter.callback(false);
    }
    this.#sitePermissionWaiters.clear();
    this.#pendingCredential = undefined;
    for (const tab of this.#tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    this.#tabs.clear();
    this.#workView?.webContents.close();
    this.#workView = undefined;
    this.#database.close();
  }

  #createWorkView(rendererUrl: string, preloadPath: string): void {
    const view = new WebContentsView({ webPreferences: trustedRendererPreferences(preloadPath) });
    view.setBackgroundColor(this.#surfaceBackground());
    view.webContents.loadURL(surfaceUrl(rendererUrl, "work"));
    this.#workView = view;
    this.window.contentView.addChildView(view);
    view.setVisible(this.#workOpen);
  }

  #restoreTabs(): void {
    if (this.#privateWindow) {
      this.#createTab(searchHome(this.#settings.searchEngine), { active: true, private: true });
      return;
    }
    for (const stored of this.#database.loadTabGroups(this.#windowId)) {
      this.#groups.set(stored.id, { ...stored, collapsed: Boolean(stored.collapsed) });
    }
    const tabs = this.#database.loadTabs(this.#windowId);
    if (tabs.length === 0) {
      this.#createTab(this.#settings.onboardingComplete ? searchHome(this.#settings.searchEngine) : "about:blank", { active: true });
      return;
    }
    for (const stored of tabs) {
      this.#createTab(safeRestoreUrl(stored.url), {
        id: stored.id,
        active: Boolean(stored.active),
        title: stored.title,
        private: Boolean(stored.private),
        ...(stored.groupId ? { groupId: stored.groupId } : {}),
      });
    }
    if (!this.#activeTabId) void this.#selectTab(tabs[0]!.id);
  }

  #createTab(
    rawUrl: string,
    options: { id?: string; active?: boolean; title?: string; private?: boolean; sessionId?: string; groupId?: string } = {},
  ): TabRecord {
    const id = options.id ?? randomUUID();
    const privateTab = Boolean(options.private);
    const record: TabRecord = {
      view: undefined,
      console: [],
      network: [],
      sessionCreatedBy: options.sessionId,
      agentDownloadArmedUntil: 0,
      lastActiveAt: Date.now(),
      credentialBindingName: `__locusCredential_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`,
      state: {
        id,
        title: options.title || "New Tab",
        url: "about:blank",
        active: false,
        loading: true,
        canGoBack: false,
        canGoForward: false,
        audible: false,
        muted: false,
        private: privateTab,
        crashed: false,
        sleeping: false,
        mediaPlaying: false,
        mediaAvailable: false,
        ...(options.groupId ? { groupId: options.groupId } : {}),
        grants: [],
      },
    };
    this.#tabs.set(id, record);
    const view = this.#createTabView(record);
    this.window.contentView.addChildView(view, 0);
    view.setVisible(false);
    if (options.sessionId) {
      this.#grants.grant(options.sessionId, id, "interact", "agent_created");
    }
    void view.webContents.loadURL(normalizeNavigation(rawUrl, this.#settings.searchEngine));
    if (options.active !== false) void this.#selectTab(id);
    this.#broadcast();
    return record;
  }

  #createTabView(record: TabRecord): WebContentsView {
    const partition = record.state.private ? `locus-private-${this.window.id}` : this.#partitionName;
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        sandbox: true,
        contextIsolation: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        partition,
        spellcheck: true,
      },
    });
    record.view = view;
    this.#hardenSession(view.webContents.session);
    view.setBackgroundColor("#ffffff");
    this.#wireTab(record);
    return view;
  }

  #wireTab(tab: TabRecord): void {
    const contents = tab.view!.webContents;
    const update = () => {
      tab.state.url = contents.getURL() || tab.state.url;
      tab.state.title = contents.getTitle() || tab.state.title;
      tab.state.loading = contents.isLoading();
      tab.state.canGoBack = contents.navigationHistory.canGoBack();
      tab.state.canGoForward = contents.navigationHistory.canGoForward();
      tab.state.audible = contents.isCurrentlyAudible();
      tab.state.muted = contents.isAudioMuted();
      this.#broadcast();
      this.#scheduleSave();
    };
    contents.on("did-start-loading", () => { tab.state.mediaAvailable = false; tab.state.mediaPlaying = false; update(); });
    contents.on("did-stop-loading", update);
    contents.on("did-navigate", update);
    contents.on("did-navigate-in-page", update);
    contents.on("page-title-updated", update);
    contents.on("media-started-playing", () => { tab.state.mediaAvailable = true; tab.state.mediaPlaying = true; update(); });
    contents.on("media-paused", () => { tab.state.mediaAvailable = true; tab.state.mediaPlaying = false; update(); });
    contents.on("page-favicon-updated", (_event, favicons) => {
      const favicon = favicons.find((url) => /^https?:|^data:image\//.test(url));
      if (favicon) tab.state.faviconUrl = favicon;
      else delete tab.state.faviconUrl;
      this.#broadcast();
    });
    contents.on("render-process-gone", () => {
      tab.state.crashed = true;
      tab.state.loading = false;
      this.#broadcast();
    });
    contents.on("console-message", (details) => {
      const info = details as unknown as { level?: string; message?: string; lineNumber?: number };
      pushBounded(tab.console, `[${info.level ?? "info"}] ${info.message ?? ""}:${info.lineNumber ?? 0}`);
    });
    contents.setWindowOpenHandler((details) => {
      if (isAllowedPageUrl(details.url)) this.#createTab(details.url, {
        active: true,
        private: this.#privateWindow,
        ...(tab.state.groupId ? { groupId: tab.state.groupId } : {}),
      });
      return { action: "deny" };
    });
    contents.on("will-navigate", (details) => {
      const url = (details as unknown as { url: string }).url;
      if (!isAllowedPageUrl(url)) details.preventDefault();
    });
    contents.on("did-finish-load", () => {
      if (!this.#privateWindow) this.#database.recordVisit(this.#profileId, tab.state.id, contents.getURL(), contents.getTitle());
    });
    contents.on("found-in-page", (_event, result) => {
      if (tab.state.id !== this.#activeTabId) return;
      this.#find.matches = result.matches;
      this.#find.activeMatchOrdinal = result.activeMatchOrdinal;
      this.#broadcast();
    });
    void this.#enableNetworkCapture(tab);
  }

  async #enableNetworkCapture(tab: TabRecord): Promise<void> {
    try {
      const contents = tab.view?.webContents;
      if (!contents || contents.isDestroyed()) return;
      if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
      await Promise.all([
        contents.debugger.sendCommand("Network.enable"),
        contents.debugger.sendCommand("Runtime.enable"),
        contents.debugger.sendCommand("Page.enable"),
      ]);
      if (!tab.state.private) {
        const source = credentialObserverSource(tab.credentialBindingName);
        const worldName = `locus-credentials-${tab.state.id}`;
        await contents.debugger.sendCommand("Runtime.addBinding", {
          name: tab.credentialBindingName,
          executionContextName: worldName,
        });
        await contents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
          source,
          worldName,
        });
        await this.#evaluateCredentialScript(tab, source).catch(() => undefined);
      }
      contents.debugger.on("message", (_event, method, params) => {
        if (method === "Network.responseReceived") {
          const response = (params as { response?: { status?: number; url?: string; mimeType?: string } }).response;
          if (response) pushBounded(tab.network, `${response.status ?? 0} ${response.url ?? ""} ${response.mimeType ?? ""}`);
        } else if (method === "Runtime.bindingCalled" && !tab.state.private) {
          const binding = params as { name?: string; payload?: string };
          if (binding.name === tab.credentialBindingName && typeof binding.payload === "string") {
            this.#acceptCredentialPayload(tab, binding.payload);
          }
        }
      });
    } catch {
      pushBounded(tab.network, "Network capture unavailable while developer tools are attached.");
    }
  }

  #closeTab(id: string): void {
    const tab = this.#tabs.get(id);
    if (!tab) return;
    const ids = [...this.#tabs.keys()];
    const index = ids.indexOf(id);
    if (tab.view && !tab.view.webContents.isDestroyed()) {
      this.window.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    }
    this.#tabs.delete(id);
    this.#grants.revoke(this.#sessionId, id);
    if (this.#pendingCredential?.tabId === id) this.#pendingCredential = undefined;
    if (this.#activeTabId === id) {
      this.#activeTabId = undefined;
      const next = ids[index + 1] ?? ids[index - 1];
      if (next && this.#tabs.has(next)) void this.#selectTab(next);
      else this.#createTab(searchHome(this.#settings.searchEngine), { active: true, private: this.#privateWindow });
    }
    this.#layout(false);
  }

  async #selectTab(id: string): Promise<void> {
    const selected = this.#tabs.get(id);
    if (!selected) return;
    this.#active()?.view?.webContents.stopFindInPage("clearSelection");
    this.#find = { open: this.#find.open, query: "", matches: 0, activeMatchOrdinal: 0 };
    for (const tab of this.#tabs.values()) tab.view?.setVisible(false);
    this.#activeTabId = id;
    selected.lastActiveAt = Date.now();
    await this.#wakeTab(selected);
    const selectedView = selected.view;
    if (!selectedView) return;
    selectedView.setVisible(true);
    this.window.contentView.removeChildView(selectedView);
    this.window.contentView.addChildView(selectedView);
    if (this.#workView) {
      this.window.contentView.removeChildView(this.#workView);
      this.window.contentView.addChildView(this.#workView);
    }
    this.#layout(false);
  }

  #reorderTab(id: string, beforeId: string): void {
    if (id === beforeId || !this.#tabs.has(id) || !this.#tabs.has(beforeId)) return;
    const entries = [...this.#tabs.entries()];
    const moving = entries.find(([key]) => key === id)!;
    const rest = entries.filter(([key]) => key !== id);
    rest.splice(rest.findIndex(([key]) => key === beforeId), 0, moving);
    this.#tabs.clear();
    for (const [key, value] of rest) this.#tabs.set(key, value);
  }

  async #navigateActive(value: string): Promise<void> {
    const tab = this.#active();
    if (!tab) return;
    await this.#wakeTab(tab);
    tab.state.crashed = false;
    await tab.view!.webContents.loadURL(normalizeNavigation(value, this.#settings.searchEngine));
  }

  #toggleBookmark(): void {
    const tab = this.#active();
    if (!tab || !/^https?:\/\//.test(tab.state.url)) return;
    if (this.#privateWindow) return;
    const existing = this.#database.bookmarkForUrl(this.#profileId, tab.state.url);
    if (existing) this.#database.removeBookmark(this.#profileId, existing.id);
    else this.#database.addBookmark(this.#profileId, tab.state.title || tab.state.url, tab.state.url);
  }

  #findInPage(query: string, forward: boolean, findNext: boolean): void {
    const contents = this.#active()?.view?.webContents;
    if (!contents) return;
    this.#find.open = true;
    this.#find.query = query;
    if (!query) {
      contents.stopFindInPage("clearSelection");
      this.#find.matches = 0;
      this.#find.activeMatchOrdinal = 0;
      this.#layout(false);
      return;
    }
    contents.findInPage(query, { forward, findNext });
    this.#layout(false);
  }

  #closeFind(): void {
    this.#active()?.view?.webContents.stopFindInPage("clearSelection");
    this.#find = { open: false, query: "", matches: 0, activeMatchOrdinal: 0 };
  }

  #setZoom(value: number): void {
    const contents = this.#active()?.view?.webContents;
    if (!contents) return;
    const zoom = Math.round(Math.min(Math.max(value, 0.5), 2) * 10) / 10;
    contents.setZoomFactor(zoom);
  }

  async #printPage(): Promise<void> {
    const contents = this.#active()?.view?.webContents;
    if (!contents) return;
    await new Promise<void>((resolve, reject) => {
      contents.print({ printBackground: true }, (success, failureReason) => {
        if (success) resolve();
        else reject(new Error(failureReason || "Printing was cancelled."));
      });
    }).catch(() => undefined);
  }

  async #savePagePdf(): Promise<void> {
    const tab = this.#active();
    if (!tab) return;
    const safeTitle = (tab.state.title || "page").replace(/[^a-zA-Z0-9 ._-]/g, "").trim().slice(0, 90) || "page";
    const result = await dialog.showSaveDialog(this.window, {
      title: "Save Page as PDF",
      defaultPath: join(app.getPath("downloads"), `${safeTitle}.pdf`),
      filters: [{ name: "PDF document", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath) return;
    await this.#wakeTab(tab);
    const pdf = await tab.view!.webContents.printToPDF({ printBackground: true });
    await writeFile(result.filePath, pdf);
  }

  #active(): TabRecord | undefined {
    return this.#activeTabId ? this.#tabs.get(this.#activeTabId) : undefined;
  }

  #layout(animate: boolean): void {
    if (this.window.isDestroyed()) return;
    if (!this.#privateWindow && !this.#settings.onboardingComplete) {
      for (const tab of this.#tabs.values()) tab.view?.setVisible(false);
      this.#workView?.setVisible(false);
      this.#workOverlay = false;
      this.#broadcast();
      return;
    }
    const [width = 1, height = 1] = this.window.getContentSize();
    const left = this.#sidebarOpen ? SIDEBAR_WIDTH : 0;
    const availableWidth = Math.max(width - left, 1);
    const targetWork = clamp(this.#workWidth, WORK_MIN, this.#maximumWorkWidth());
    this.#workWidth = targetWork;
    this.#workOverlay = this.#workOpen && availableWidth - targetWork < MIN_PAGE_SPLIT;
    const pageWidth = this.#workOpen && !this.#workOverlay
      ? Math.max(availableWidth - targetWork, MIN_PAGE_EXPANDED)
      : availableWidth;
    const chromeHeight = this.#chromeHeight();
    const pageBounds = { x: left, y: chromeHeight, width: pageWidth, height: Math.max(height - chromeHeight, 1) };
    const activeView = this.#active()?.view;
    activeView?.setBounds(pageBounds);
    activeView?.setVisible(true);

    const openBounds = {
      x: width - targetWork,
      y: chromeHeight,
      width: targetWork,
      height: Math.max(height - chromeHeight, 1),
    };
    const closedBounds = { ...openBounds, x: width };
    const work = this.#workView;
    if (!work) return;
    const target = this.#workOpen ? openBounds : closedBounds;
    if (!animate || this.#reducedMotion) {
      work.setBounds(target);
      work.setVisible(this.#workOpen);
    } else {
      this.#animateWorkBounds(target, this.#workOpen);
    }
    this.#broadcast();
  }

  #animateWorkBounds(target: Rectangle, opening: boolean): void {
    const work = this.#workView;
    if (!work) return;
    const generation = ++this.#layoutGeneration;
    const start = work.getBounds();
    const started = performance.now();
    if (opening) work.setVisible(true);
    const tick = () => {
      if (generation !== this.#layoutGeneration || !this.#workView) return;
      const elapsed = performance.now() - started;
      const progress = Math.min(elapsed / 340, 1);
      const eased = 1 - Math.exp(-9 * progress) * (1 + 9 * progress);
      work.setBounds(interpolateRect(start, target, eased));
      if (progress < 1) setTimeout(tick, 16);
      else {
        work.setBounds(target);
        work.setVisible(opening);
      }
    };
    tick();
  }

  #maximumWorkWidth(): number {
    const [width = 1] = this.window.getContentSize();
    return Math.max(WORK_MIN, Math.min(WORK_MAX, width * 0.6, width - MIN_PAGE_EXPANDED));
  }

  #chromeHeight(): number {
    return CHROME_HEIGHT
      + (this.#find.open ? 38 : 0)
      + (this.#pendingSitePermission ? SITE_PERMISSION_HEIGHT : 0)
      + (this.#pendingCredential ? CREDENTIAL_PROMPT_HEIGHT : 0);
  }

  #broadcast(): void {
    if (this.#disposed) return;
    const state = this.state();
    if (!this.window.isDestroyed()) this.window.webContents.send(ipcChannels.state, state);
    const workContents = this.#workView?.webContents;
    if (workContents && !workContents.isDestroyed()) workContents.send(ipcChannels.state, state);
  }

  #scheduleSave(): void {
    if (this.#disposed) return;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#persistNow();
      this.#sync?.scheduleSync();
    }, 150);
  }

  #applySyncedData(): void {
    this.#settings = this.#loadSettings();
    this.window.setBackgroundColor(this.#surfaceBackground());
    this.#workView?.setBackgroundColor(this.#surfaceBackground());
    this.#sleepEligibleTabs();
    this.#broadcast();
  }

  async #showSyncRecoveryKey(recoveryKey: string): Promise<void> {
    const result = await dialog.showMessageBox(this.window, {
      type: "info",
      title: "Locus Sync recovery key",
      message: "Save your recovery key",
      detail: `${recoveryKey}\n\nThis is the only way to recover encrypted browser data when another approved device is unavailable. Locus shows it once.`,
      buttons: ["Copy recovery key", "I saved it"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0) clipboard.writeText(recoveryKey);
  }

  #persistNow(): void {
    if (!this.#database || this.#privateWindow) return;
    const storedTabs: StoredTab[] = [...this.#tabs.values()]
      .filter((tab) => !tab.state.private)
      .map((tab, position) => ({
        id: tab.state.id,
        windowId: this.#windowId,
        profileId: this.#profileId,
        position,
        url: safeRestoreUrl(tab.state.url),
        title: tab.state.title,
        active: tab.state.id === this.#activeTabId,
        muted: tab.state.muted,
        pinned: false,
        private: false,
        ...(tab.state.groupId ? { groupId: tab.state.groupId } : {}),
      }));
    const storedGroups: StoredTabGroup[] = [...this.#groups.values()].map((group) => ({
      ...group,
      windowId: this.#windowId,
      profileId: this.#profileId,
    }));
    this.#database.saveWindow({
      id: this.#windowId,
      profileId: this.#profileId,
      sidebarOpen: this.#sidebarOpen,
      workOpen: this.#workOpen,
      workWidth: this.#workWidth,
    }, storedTabs, storedGroups);
  }

  #configureProfileSession(): void {
    this.#hardenSession(session.fromPartition(this.#partitionName));
  }

  #hardenSession(browserSession: Electron.Session): void {
    if (this.#hardenedSessions.has(browserSession)) return;
    this.#hardenedSessions.add(browserSession);
    browserSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
      if (!contents || !ALLOWED_SITE_PERMISSIONS.has(permission)) return false;
      const origin = permissionOrigin(requestingOrigin, details);
      if (!origin || !isSecurePermissionOrigin(origin)) return false;
      const onceKey = sitePermissionKey(contents.id, origin, permission);
      if (this.#oneTimeSitePermissions.has(onceKey)) return true;
      if (this.#privateWindow) return false;
      return this.#database.sitePermission(this.#profileId, origin, permission) === "allow";
    });
    browserSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      this.#requestSitePermission(contents, permission, callback, details);
    });
    browserSession.on("will-download", (_event, item, contents) => {
      const tab = [...this.#tabs.values()].find((candidate) => candidate.view?.webContents.id === contents.id);
      const agentInitiated = Boolean(tab && tab.agentDownloadArmedUntil > Date.now());
      const id = randomUUID();
      if (agentInitiated) {
        const safeName = item.getFilename().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "download";
        const directory = join(app.getPath("userData"), "Agent Downloads");
        mkdirSync(directory, { recursive: true });
        item.setSavePath(join(directory, `${randomUUID()}-${safeName}`));
      } else {
        item.setSavePath(join(this.#settings.downloadDirectory, item.getFilename()));
      }
      this.#activeDownloads.set(id, item);
      const save = (state: StoredDownload["state"], finished = false) => {
        if (this.#disposed) return;
        this.#database.saveDownload(this.#profileId, {
          id,
          ...(tab ? { tabId: tab.state.id } : {}),
          filename: item.getFilename(),
          url: item.getURL(),
          path: item.getSavePath(),
          state,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
          agentInitiated,
          startedAt: Math.floor(Date.now() / 1_000),
          ...(finished ? { finishedAt: Math.floor(Date.now() / 1_000) } : {}),
        });
        this.#broadcast();
      };
      save("progressing");
      item.on("updated", (_downloadEvent, state) => {
        if (agentInitiated && item.getReceivedBytes() > AGENT_DOWNLOAD_CAP) item.cancel();
        save(state === "interrupted" ? "interrupted" : "progressing");
      });
      item.once("done", (_downloadEvent, state) => {
        this.#activeDownloads.delete(id);
        save(state, true);
      });
    });
  }

  #loadSettings(): BrowserSettingsState {
    const appearance = this.#database.setting(this.#profileId, "appearance");
    const searchEngine = this.#database.setting(this.#profileId, "searchEngine");
    const sleepAfterMinutes = this.#database.setting(this.#profileId, "sleepAfterMinutes");
    const downloadDirectory = this.#database.setting(this.#profileId, "downloadDirectory");
    const onboardingComplete = this.#database.setting(this.#profileId, "onboardingComplete");
    return {
      appearance: isAppearance(appearance) ? appearance : "system",
      searchEngine: isSearchEngine(searchEngine) ? searchEngine : "duckduckgo",
      sleepAfterMinutes: isSleepInterval(sleepAfterMinutes) ? sleepAfterMinutes : 30,
      downloadDirectory: typeof downloadDirectory === "string" && downloadDirectory ? downloadDirectory : app.getPath("downloads"),
      onboardingComplete: onboardingComplete === true,
    };
  }

  #surfaceBackground(): string {
    const dark = this.#privateWindow || this.#settings.appearance === "dark"
      || (this.#settings.appearance === "system" && nativeTheme.shouldUseDarkColors);
    return dark ? "#1b1b17" : "#f8f6f0";
  }

  #credentialSuggestions(rawUrl: string) {
    if (!this.#credentials.available()) return [];
    try { return this.#credentials.suggestions(rawUrl); } catch { return []; }
  }

  #acceptCredentialPayload(tab: TabRecord, payload: string): void {
    if (this.#privateWindow || !this.#credentials.available() || tab.view?.webContents.isDestroyed()) return;
    let value: unknown;
    try { value = JSON.parse(payload); } catch { return; }
    const candidate = parseCredentialCandidate(value);
    if (!candidate || !isSecurePermissionOrigin(candidate.origin)) return;
    try {
      if (new URL(tab.view!.webContents.getURL()).origin !== candidate.origin) return;
    } catch {
      return;
    }
    if (this.#pendingCredential
      && this.#pendingCredential.origin === candidate.origin
      && this.#pendingCredential.username === candidate.username
      && this.#pendingCredential.password === candidate.password) return;
    const action = this.#credentials.suggestions(candidate.origin)
      .some((credential) => credential.username === candidate.username.trim()) ? "update" : "save";
    this.#pendingCredential = { ...candidate, tabId: tab.state.id, action };
    this.#layout(true);
    this.#broadcast();
  }

  #savePendingCredential(): void {
    const pending = this.#pendingCredential;
    if (!pending || !this.#credentials.available()) return;
    this.#credentials.save(pending.origin, pending.username, pending.password, true);
    this.#pendingCredential = undefined;
    this.#layout(true);
  }

  async #autofillCredential(credentialId: string): Promise<void> {
    const tab = this.#active();
    if (!tab || !this.#credentials.available()) return;
    await this.#wakeTab(tab);
    let password: string;
    let suggestion: { id: string; username: string } | undefined;
    try {
      suggestion = this.#credentials.suggestions(tab.state.url).find((credential) => credential.id === credentialId);
      if (!suggestion) return;
      password = this.#credentials.reveal(tab.state.url, credentialId, true);
    } catch {
      return;
    }
    const result = await this.#evaluateCredentialScript(
      tab,
      credentialAutofillInvocation(suggestion.username, password),
      true,
    ).catch(() => ({ filled: false })) as { filled?: boolean };
    if (!result.filled) {
      await dialog.showMessageBox(this.window, {
        type: "info",
        message: "No password field is available on this page.",
        detail: "Open the site’s sign-in form, then choose the saved login again.",
      });
    }
  }

  async #evaluateCredentialScript(tab: TabRecord, expression: string, userGesture = false): Promise<unknown> {
    const contents = tab.view?.webContents;
    if (!contents || contents.isDestroyed() || !contents.debugger.isAttached()) throw new Error("Credential world is unavailable");
    const frameTree = await contents.debugger.sendCommand("Page.getFrameTree") as { frameTree?: { frame?: { id?: string } } };
    const frameId = frameTree.frameTree?.frame?.id;
    if (!frameId) throw new Error("Credential frame is unavailable");
    const world = await contents.debugger.sendCommand("Page.createIsolatedWorld", {
      frameId,
      worldName: `locus-credentials-${tab.state.id}`,
    }) as { executionContextId?: number };
    if (!world.executionContextId) throw new Error("Credential execution context is unavailable");
    const evaluation = await contents.debugger.sendCommand("Runtime.evaluate", {
      expression,
      contextId: world.executionContextId,
      returnByValue: true,
      userGesture,
    }) as { result?: { value?: unknown }; exceptionDetails?: unknown };
    if (evaluation.exceptionDetails) throw new Error("Credential page script failed");
    return evaluation.result?.value;
  }

  #createTabGroup(tabId?: string): void {
    if (this.#privateWindow) return;
    const id = randomUUID();
    const position = this.#groups.size;
    this.#groups.set(id, {
      id,
      name: `Group ${position + 1}`,
      color: GROUP_COLORS[position % GROUP_COLORS.length]!,
      collapsed: false,
      position,
    });
    const tab = this.#tabs.get(tabId ?? this.#activeTabId ?? "");
    if (tab) tab.state.groupId = id;
  }

  async #deleteProfile(profileId: string): Promise<void> {
    if (profileId === "default" || profileId === this.#profileId) return;
    const profile = this.#database.profile(profileId);
    if (!profile) return;
    if (this.#canDeleteProfile && !this.#canDeleteProfile(profileId)) {
      await dialog.showMessageBox(this.window, {
        type: "info",
        message: `Close every ${profile.name} window first.`,
        detail: "A browser profile cannot be removed while one of its normal or private windows is open.",
      });
      return;
    }
    const profileSession = session.fromPartition(profile.partitionName);
    await Promise.all([profileSession.clearStorageData(), profileSession.clearCache()]);
    this.#database.deleteProfile(profileId);
  }

  #deleteTabGroup(groupId: string): void {
    if (!this.#groups.delete(groupId)) return;
    for (const tab of this.#tabs.values()) {
      if (tab.state.groupId === groupId) delete tab.state.groupId;
    }
  }

  async #toggleMediaPlayback(): Promise<void> {
    const tab = this.#active();
    if (!tab) return;
    await this.#wakeTab(tab);
    const pause = tab.state.mediaPlaying;
    await tab.view!.webContents.executeJavaScript(`
      (() => {
        const media = Array.from(document.querySelectorAll("video, audio"));
        for (const item of media) {
          if (${pause}) item.pause();
          else void item.play().catch(() => undefined);
        }
        return media.length;
      })()
    `, true).catch(() => undefined);
  }

  #requestSitePermission(
    contents: Electron.WebContents,
    permission: string,
    callback: (granted: boolean) => void,
    details: unknown,
  ): void {
    if (!ALLOWED_SITE_PERMISSIONS.has(permission) || contents.isDestroyed()) {
      callback(false);
      return;
    }
    const tab = [...this.#tabs.values()].find((candidate) => candidate.view?.webContents.id === contents.id);
    const origin = permissionOrigin(contents.getURL(), details);
    if (!tab || !origin || !isSecurePermissionOrigin(origin) || !isAllowedPageUrl(tab.state.url)) {
      callback(false);
      return;
    }
    const onceKey = sitePermissionKey(contents.id, origin, permission);
    if (this.#oneTimeSitePermissions.has(onceKey)) {
      callback(true);
      return;
    }
    const stored = this.#privateWindow ? undefined : this.#database.sitePermission(this.#profileId, origin, permission);
    if (stored) {
      callback(stored === "allow");
      return;
    }
    if (this.#pendingSitePermission) {
      callback(false);
      return;
    }
    const requestId = randomUUID();
    const timeout = setTimeout(() => this.#finishSitePermission(requestId, false), 60_000);
    this.#sitePermissionWaiters.set(requestId, { callback, timeout, contentsId: contents.id, origin, permission });
    this.#pendingSitePermission = { requestId, tabId: tab.state.id, origin, permission: displayPermission(permission, details) };
    this.#layout(true);
    this.#broadcast();
  }

  #answerSitePermission(requestId: string, decision: "allow-once" | "always" | "deny"): void {
    const waiter = this.#sitePermissionWaiters.get(requestId);
    if (!waiter) return;
    if (decision === "allow-once") {
      this.#oneTimeSitePermissions.add(sitePermissionKey(waiter.contentsId, waiter.origin, waiter.permission));
    } else if (!this.#privateWindow) {
      this.#database.setSitePermission(this.#profileId, waiter.origin, waiter.permission, decision === "always" ? "allow" : "deny");
    }
    this.#finishSitePermission(requestId, decision !== "deny");
  }

  #finishSitePermission(requestId: string, granted: boolean): void {
    const waiter = this.#sitePermissionWaiters.get(requestId);
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    this.#sitePermissionWaiters.delete(requestId);
    if (this.#pendingSitePermission?.requestId === requestId) this.#pendingSitePermission = undefined;
    waiter.callback(granted);
    this.#layout(true);
    this.#broadcast();
  }

  #sleepEligibleTabs(): void {
    const minutes = this.#settings.sleepAfterMinutes;
    const downloadingTabIds = new Set(this.#database.listDownloads(this.#profileId)
      .flatMap((download) => download.state === "progressing" && download.tabId ? [download.tabId] : []));
    const now = Date.now();
    for (const tab of this.#tabs.values()) {
      if (shouldSleepTab(this.#sleepCandidate(tab, downloadingTabIds.has(tab.state.id)), now, minutes)) this.#discardTab(tab);
    }
  }

  #sleepTab(tabId: string): void {
    const tab = this.#tabs.get(tabId);
    if (!tab || !tab.view) return;
    const downloading = this.#database.listDownloads(this.#profileId).some((download) => download.tabId === tabId && download.state === "progressing");
    if (!canSleepTab(this.#sleepCandidate(tab, downloading))) return;
    this.#discardTab(tab);
  }

  #sleepCandidate(tab: TabRecord, downloading: boolean) {
    return {
      active: tab.state.id === this.#activeTabId,
      sleeping: tab.state.sleeping,
      loading: tab.state.loading,
      audible: tab.state.audible,
      mediaPlaying: tab.state.mediaPlaying,
      granted: this.#grants.grantsForTab(tab.state.id).length > 0,
      downloading,
      lastActiveAt: tab.lastActiveAt,
    };
  }

  #discardTab(tab: TabRecord): void {
    if (!tab.view) return;
    if (!tab.view.webContents.isDestroyed()) {
      this.window.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    }
    tab.view = undefined;
    tab.state.sleeping = true;
    tab.state.loading = false;
    tab.state.audible = false;
    tab.state.mediaPlaying = false;
    tab.state.mediaAvailable = false;
    tab.state.canGoBack = false;
    tab.state.canGoForward = false;
    this.#scheduleSave();
    this.#broadcast();
  }

  async #wakeTab(tab: TabRecord): Promise<void> {
    if (tab.view && !tab.view.webContents.isDestroyed()) return;
    const url = safeRestoreUrl(tab.state.url);
    const muted = tab.state.muted;
    tab.state.sleeping = false;
    tab.state.loading = true;
    tab.state.crashed = false;
    const view = this.#createTabView(tab);
    view.webContents.setAudioMuted(muted);
    this.window.contentView.addChildView(view, 0);
    view.setVisible(false);
    await view.webContents.loadURL(url).catch(() => undefined);
  }

  #bindRuntime(): void {
    this.#runtime.on("status", (status: { status: BrowserAppState["work"]["runtime"]; message: string }) => {
      this.#runtimeState = status.status;
      this.#runtimeMessage = status.message;
      this.#broadcast();
    });
    this.#runtime.on("event", (event: AgentEvent) => void this.#handleAgentEvent(event));
  }

  async #handleAgentEvent(event: AgentEvent): Promise<void> {
    const type = String(event.type ?? "");
    if (type === "session_info") {
      const nextSessionId = String(event.session_id ?? event.id ?? "").trim();
      if (nextSessionId && nextSessionId !== this.#sessionId) {
        this.#grants.revokeSession(this.#sessionId);
        this.#sessionId = nextSessionId;
      }
      this.#broadcast();
      return;
    }
    if (type === "browser_action_request") {
      const parsed = BrowserActionRequestSchema.safeParse(event);
      if (!parsed.success) return;
      const result = await this.#executeBrowserAction(parsed.data);
      this.#runtime.send(result);
      return;
    }
    if (type === "permission_request") {
      const preview = event.preview ?? event.summary ?? "Locus needs your approval.";
      this.#pendingPermission = {
        requestId: String(event.request_id ?? event.id ?? ""),
        tool: String(event.tool ?? "Tool"),
        summary: typeof preview === "string" ? preview : JSON.stringify(preview, null, 2),
      };
      this.#workOpen = true;
      this.#layout(true);
    } else if (type === "message_start") {
      this.#busy = true;
      this.#messages.push({ id: String(event.id ?? randomUUID()), role: "assistant", text: "", streaming: true });
    } else if (type === "token" || type === "text_delta" || type === "message_delta" || type === "assistant_delta") {
      const message = [...this.#messages].reverse().find((item) => item.role === "assistant" && item.streaming);
      if (message) message.text += String(event.text ?? event.delta ?? event.content ?? "");
    } else if (type === "message_end" || type === "turn_end") {
      this.#busy = false;
      const message = [...this.#messages].reverse().find((item) => item.streaming);
      if (message) {
        if (!message.text && event.content) message.text = String(event.content);
        message.streaming = false;
      }
    } else if (type === "error") {
      this.#busy = false;
      this.#messages.push({ id: randomUUID(), role: "system", text: String(event.message ?? event.error ?? "Agent error") });
    }
    this.#broadcast();
  }

  #sendWorkMessage(text: string): void {
    this.#messages.push({ id: randomUUID(), role: "user", text });
    const sent = this.#runtime.send({ type: "user_message", text, mode: this.#workMode });
    if (!sent) {
      this.#messages.push({ id: randomUUID(), role: "system", text: "The local agent is offline. Your message was not sent." });
    } else {
      this.#busy = true;
    }
  }

  #answerPermission(requestId: string, decision: "allow" | "always" | "deny"): void {
    const browserWaiter = this.#permissionWaiters.get(requestId);
    if (browserWaiter) {
      browserWaiter.resolve(decision);
      this.#permissionWaiters.delete(requestId);
      if (decision === "always") this.#screenshotConsentForSession = true;
    } else {
      this.#runtime.send({ type: "permission_decision", request_id: requestId, decision });
    }
    this.#pendingPermission = undefined;
  }

  async #executeBrowserAction(request: BrowserActionRequest): Promise<BrowserActionResult> {
    try {
      const result = await this.#dispatchBrowserAction(request);
      return { type: "browser_action_result", request_id: request.request_id, result };
    } catch (error) {
      return {
        type: "browser_action_result",
        request_id: request.request_id,
        result: { error: error instanceof Error ? error.message : "Browser action failed" },
      };
    }
  }

  async #dispatchBrowserAction(request: BrowserActionRequest): Promise<Record<string, unknown>> {
    const args = request.arguments;
    if (request.tool === "browser_tabs") {
      const tabs = this.#grants.grantsForSession(request.session_id).flatMap((grant) => {
        const tab = this.#tabs.get(grant.tabId);
        return tab ? [{ id: tab.state.id, title: tab.state.title, url: tab.state.url, active: tab.state.id === this.#activeTabId, access: grant.level }] : [];
      });
      return { text: tabs.length ? JSON.stringify(tabs, null, 2) : "No tabs are shared with this work session." };
    }

    const needsInteract = ["browser_navigate", "browser_input", "browser_resize", "browser_javascript"].includes(request.tool);
    const tab = this.#tabForAgent(request.session_id, stringArg(args, "tab_id"), needsInteract);
    if (TabAccessRegistry.isProtectedUrl(tab.state.url, tab.state.private)) throw new Error("This page cannot be shared with Locus.");
    await this.#wakeTab(tab);
    const contents = tab.view!.webContents;

    switch (request.tool) {
      case "browser_navigate": {
        const action = stringArg(args, "url");
        if (!action) throw new Error("'url' is required");
        if (action === "back") contents.navigationHistory.goBack();
        else if (action === "forward") contents.navigationHistory.goForward();
        else if (action === "reload") contents.reload();
        else await contents.loadURL(normalizeNavigation(action, this.#settings.searchEngine));
        return { text: `Opened ${contents.getTitle() || contents.getURL()}. Call browser_read_page to inspect it.` };
      }
      case "browser_read_page": {
        const snapshot = await this.#bridge(tab, bridgeInvocation.snapshot({
          filter: stringArg(args, "filter") || "interactive",
          maxChars: numberArg(args, "max_chars") || 20_000,
        })) as { title?: string; url?: string; text?: string; elements?: unknown[] };
        return { text: `${snapshot.title || "Untitled"} — ${snapshot.url || contents.getURL()}\n\n${snapshot.text || "(no visible text)"}\n\nElements:\n${JSON.stringify(snapshot.elements || [], null, 2)}` };
      }
      case "browser_get_text": {
        const snapshot = await this.#bridge(tab, bridgeInvocation.snapshot({ filter: "all", maxChars: numberArg(args, "max_chars") || 20_000 })) as { title?: string; url?: string; text?: string };
        return { text: `${snapshot.title || "Untitled"} — ${snapshot.url || contents.getURL()}\n\n${snapshot.text || ""}` };
      }
      case "browser_find": {
        const query = stringArg(args, "query");
        if (!query) throw new Error("'query' is required");
        const result = await this.#bridge(tab, bridgeInvocation.find(query));
        return { text: JSON.stringify(result, null, 2) };
      }
      case "browser_screenshot": {
        if (!this.#screenshotConsentForSession) {
          const decision = await this.#requestScreenshotPermission(request.request_id);
          if (decision === "deny") return { text: "Screenshot not shared; the user declined consent." };
        }
        const masked = await this.#bridge(tab, bridgeInvocation.maskSensitive()) as { token?: string };
        let png: Buffer;
        try {
          const image = await contents.capturePage();
          png = image.toPNG();
        } finally {
          if (masked.token) await this.#bridge(tab, bridgeInvocation.unmaskSensitive(masked.token));
        }
        if (png.byteLength > 8 * 1024 * 1024) throw new Error("Screenshot exceeded the 8 MB safety cap.");
        return {
          text: `Captured the visible viewport of ${contents.getURL()}.`,
          screenshot: { mime_type: "image/png", data: png.toString("base64"), description: `Browser viewport for ${contents.getURL()}` },
        };
      }
      case "browser_wait_for": {
        const seconds = Math.min(Math.max(numberArg(args, "seconds") ?? 0, 0), 30);
        if (seconds > 0) {
          await delay(seconds * 1000);
          return { text: `Waited ${seconds.toFixed(1)} seconds.` };
        }
        const expectedText = stringArg(args, "text");
        const selector = stringArg(args, "selector");
        const ref = stringArg(args, "ref");
        const timeout = Math.min(Math.max(numberArg(args, "timeout_ms") ?? 10_000, 50), 30_000);
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          let found = !contents.isLoading();
          if (expectedText) found = Boolean(await contents.executeJavaScript(`Boolean(document.body?.innerText.includes(${JSON.stringify(expectedText)}))`));
          else if (selector) found = Boolean(await contents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`));
          else if (ref) {
            const target = await this.#bridge(tab, bridgeInvocation.target(ref)) as { point?: unknown };
            found = Boolean(target.point);
          }
          if (found) return { text: expectedText ? `The page now contains ${JSON.stringify(expectedText)}.` : "The page reached the requested state." };
          await delay(100);
        }
        return { text: "Still waiting when the timeout ran out." };
      }
      case "browser_input":
        return await this.#browserInput(tab, args);
      case "browser_console":
        return { text: tab.console.length ? tab.console.join("\n") : "No console messages captured." };
      case "browser_network":
        return { text: tab.network.length ? tab.network.join("\n") : "No network responses captured." };
      case "browser_resize": {
        const width = clamp(numberArg(args, "width") ?? 1280, 320, 3840);
        const height = clamp(numberArg(args, "height") ?? 800, 240, 2160);
        const scale = clamp(numberArg(args, "device_scale_factor") ?? 1, 1, 4);
        contents.enableDeviceEmulation({
          screenPosition: "mobile",
          screenSize: { width, height },
          viewPosition: { x: 0, y: 0 },
          deviceScaleFactor: scale,
          viewSize: { width, height },
          scale: 1,
        });
        return { text: `Emulating a ${width}×${height} page viewport at ${scale}× device scale.` };
      }
      case "browser_javascript": {
        const code = stringArg(args, "code") || stringArg(args, "javascript");
        if (!code) throw new Error("'code' is required");
        const hasSensitiveFields = await this.#bridge(tab, bridgeInvocation.hasSensitiveFields());
        if (hasSensitiveFields) throw new Error("JavaScript is disabled while the page contains credential or payment fields.");
        const value = await contents.executeJavaScript(code, false);
        return { text: typeof value === "string" ? value : JSON.stringify(value, null, 2) };
      }
      case "browser_dev_server":
        return { error: "browser_dev_server is owned by the local agent runtime." };
    }
    throw new Error(`Unsupported browser tool: ${request.tool}`);
  }

  #tabForAgent(sessionId: string, requestedId: string, interact: boolean): TabRecord {
    let tabId = requestedId;
    if (!tabId) {
      const activeGrant = this.#activeTabId
        ? this.#grants.access(sessionId, this.#activeTabId)
        : undefined;
      tabId = activeGrant?.tabId || this.#grants.grantsForSession(sessionId)[0]?.tabId || "";
    }
    let tab = tabId ? this.#tabs.get(tabId) : undefined;
    if (!tab && interact) tab = this.#createTab("about:blank", { active: true, sessionId });
    if (!tab) throw new Error("No granted tab is available. Share a tab with this work session first.");
    if (!this.#grants.can(sessionId, tab.state.id, interact ? "interact" : "read")) {
      throw new Error(`This work session does not have ${interact ? "interaction" : "read"} access to that tab.`);
    }
    return tab;
  }

  async #bridge(tab: TabRecord, invocation: string): Promise<unknown> {
    await this.#wakeTab(tab);
    return await tab.view!.webContents.executeJavaScriptInIsolatedWorld(BRIDGE_WORLD, [
      { code: `${browserBridgeSource}\n${invocation}` },
    ]);
  }

  async #browserInput(tab: TabRecord, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const action = (stringArg(args, "action") || "click").toLowerCase();
    await this.#wakeTab(tab);
    const contents = tab.view!.webContents;
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    tab.agentDownloadArmedUntil = Date.now() + 5_000;
    if (action === "set_value") {
      const ref = stringArg(args, "ref");
      if (!ref) throw new Error("'ref' is required");
      const result = await this.#bridge(tab, bridgeInvocation.setValue(ref, stringArg(args, "text") || stringArg(args, "value")));
      if ((result as { protected?: boolean })?.protected) throw new Error("The user must fill credential or payment fields themselves.");
      return { text: "Set the field value. Call browser_read_page to inspect the result." };
    }
    if (action === "type") {
      const ref = stringArg(args, "ref");
      if (ref) {
        const target = await this.#bridge(tab, bridgeInvocation.target(ref)) as { point?: { x: number; y: number }; protected?: boolean };
        if (target.protected) throw new Error("The user must type credential or payment data themselves.");
        if (target.point) await this.#dispatchClick(contents, target.point.x, target.point.y, 1, "left");
      } else {
        const sensitive = await this.#bridge(tab, bridgeInvocation.focusedSensitive()) as { protected?: boolean };
        if (sensitive.protected) throw new Error("The user must type credential or payment data themselves.");
      }
      await contents.debugger.sendCommand("Input.insertText", { text: stringArg(args, "text") || stringArg(args, "value") });
      return { text: "Typed into the page. Call browser_read_page to inspect the result." };
    }
    if (action === "key") {
      const key = stringArg(args, "key") || "Enter";
      await contents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key });
      await contents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key });
      return { text: `Pressed ${key}.` };
    }
    if (action === "scroll") {
      const x = numberArg(args, "x") ?? tab.view!.getBounds().width / 2;
      const y = numberArg(args, "y") ?? tab.view!.getBounds().height / 2;
      await contents.debugger.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseWheel", x, y,
        deltaX: numberArg(args, "delta_x") ?? 0,
        deltaY: numberArg(args, "delta_y") ?? 600,
      });
      return { text: "Scrolled the page." };
    }
    const ref = stringArg(args, "ref");
    let x = numberArg(args, "x");
    let y = numberArg(args, "y");
    const at = Array.isArray(args.at) ? args.at : [];
    x ??= typeof at[0] === "number" ? at[0] : undefined;
    y ??= typeof at[1] === "number" ? at[1] : undefined;
    if (ref) {
      const target = await this.#bridge(tab, bridgeInvocation.target(ref)) as { point?: { x: number; y: number }; protected?: boolean; error?: string };
      if (target.protected) throw new Error("The user must interact with credential or payment fields themselves.");
      if (!target.point) throw new Error(target.error || "That page reference is stale.");
      x = target.point.x;
      y = target.point.y;
    }
    if (x === undefined || y === undefined) throw new Error("Pass a current 'ref' or x/y coordinates.");
    const sensitive = await this.#bridge(tab, bridgeInvocation.sensitiveAt(x, y)) as { protected?: boolean };
    if (sensitive.protected) throw new Error("The user must interact with credential or payment fields themselves.");
    await this.#dispatchClick(contents, x, y, action === "double_click" ? 2 : 1, action === "right_click" ? "right" : "left");
    return { text: `Clicked at (${Math.round(x)}, ${Math.round(y)}). Call browser_read_page to inspect the result.` };
  }

  async #dispatchClick(contents: Electron.WebContents, x: number, y: number, clickCount: number, button: "left" | "right"): Promise<void> {
    await contents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount });
    await contents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount });
  }

  async #requestScreenshotPermission(requestId: string): Promise<"allow" | "always" | "deny"> {
    this.#pendingPermission = {
      requestId,
      tool: "browser_screenshot",
      summary: "Share a screenshot of the current tab with the selected model?",
    };
    this.#workOpen = true;
    this.#layout(true);
    return await new Promise((resolve) => this.#permissionWaiters.set(requestId, { resolve }));
  }
}

function trustedRendererPreferences(preloadPath: string): Electron.WebPreferences {
  return {
    preload: preloadPath,
    nodeIntegration: false,
    sandbox: true,
    contextIsolation: true,
    webSecurity: true,
  };
}

function surfaceUrl(rendererUrl: string, surface: "shell" | "work"): string {
  const url = new URL(rendererUrl);
  url.searchParams.set("surface", surface);
  return url.toString();
}

export function normalizeNavigation(value: string, searchEngine: SearchEngine = "duckduckgo"): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed === "about:blank") return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(trimmed) && !trimmed.includes(" ")) return `https://${trimmed}`;
  return searchUrl(searchEngine, trimmed);
}

function searchHome(searchEngine: SearchEngine): string {
  switch (searchEngine) {
    case "brave": return "https://search.brave.com/";
    case "google": return "https://www.google.com/";
    case "bing": return "https://www.bing.com/";
    case "duckduckgo": return "https://duckduckgo.com/";
  }
}

function searchUrl(searchEngine: SearchEngine, query: string): string {
  const encoded = encodeURIComponent(query);
  switch (searchEngine) {
    case "brave": return `https://search.brave.com/search?q=${encoded}`;
    case "google": return `https://www.google.com/search?q=${encoded}`;
    case "bing": return `https://www.bing.com/search?q=${encoded}`;
    case "duckduckgo": return `https://duckduckgo.com/?q=${encoded}`;
  }
}

function isAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

function isSearchEngine(value: unknown): value is SearchEngine {
  return value === "duckduckgo" || value === "brave" || value === "google" || value === "bing";
}

function isSleepInterval(value: unknown): value is BrowserSettingsState["sleepAfterMinutes"] {
  return value === 0 || value === 15 || value === 30 || value === 60;
}

function permissionOrigin(primary: string | null | undefined, details: unknown): string {
  const info = details as { requestingUrl?: string; securityOrigin?: string } | undefined;
  const value = info?.requestingUrl || info?.securityOrigin || primary || "";
  try { return new URL(value).origin; } catch { return ""; }
}

function isSecurePermissionOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
}

function displayPermission(permission: string, details: unknown): string {
  const mediaTypes = (details as { mediaTypes?: string[] } | undefined)?.mediaTypes;
  if (permission === "media" && mediaTypes?.length) return mediaTypes.join(" and ");
  if (permission === "clipboard-read") return "clipboard";
  return permission;
}

function sitePermissionKey(contentsId: number, origin: string, permission: string): string {
  return `${contentsId}:${origin}:${permission}`;
}

function safeRestoreUrl(url: string): string {
  return isAllowedPageUrl(url) ? url : "https://duckduckgo.com/";
}

function isAllowedPageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" || url === "about:blank";
  } catch {
    return false;
  }
}

function stringArg(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === "string" ? args[key].trim() : "";
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  return typeof args[key] === "number" && Number.isFinite(args[key]) ? args[key] : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.round(Math.min(Math.max(value, minimum), maximum));
}

function interpolateRect(from: Rectangle, to: Rectangle, amount: number): Rectangle {
  return {
    x: Math.round(from.x + (to.x - from.x) * amount),
    y: Math.round(from.y + (to.y - from.y) * amount),
    width: Math.round(from.width + (to.width - from.width) * amount),
    height: Math.round(from.height + (to.height - from.height) * amount),
  };
}

function pushBounded(values: string[], value: string): void {
  values.push(value.slice(0, 4_000));
  if (values.length > 250) values.splice(0, values.length - 250);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function platformRootFromApp(): string {
  return process.env.LOCUS_PLATFORM_ROOT || join(app.getAppPath(), "..", "..", "..", "locus-platform");
}

export function revealAgentDownloads(): void {
  void shell.openPath(join(app.getPath("userData"), "Agent Downloads"));
}
