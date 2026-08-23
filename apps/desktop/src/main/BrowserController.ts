import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, join } from "node:path";
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
import {
  extensionContentScriptMatches,
  trustedGalleryFingerprints,
  trustedGalleryKeys,
} from "@locus/extensions";
import { z } from "zod";
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
  WorkAttachmentState,
  WorkChangesState,
  WorkConversationState,
  WorkFilesState,
  WorkMessage,
  WorkModelOptionState,
  WorkModelProviderId,
  WorkModelState,
  WorkPlanState,
  WorkTerminalEntryState,
} from "../shared/types.js";
import { AgentRuntime, type AgentEvent } from "./AgentRuntime.js";
import { BrowserDatabase, type StoredDownload, type StoredTab, type StoredTabGroup } from "./BrowserDatabase.js";
import { CredentialVault } from "./CredentialVault.js";
import { credentialAutofillInvocation, credentialObserverSource, parseCredentialCandidate, type PageCredentialCandidate } from "./CredentialPageBridge.js";
import { electronCredentialCipher } from "./ElectronCredentialCipher.js";
import { ExtensionManager, type ExtensionPermissionReview } from "./ExtensionManager.js";
import { GalleryExtensionStore } from "./GalleryExtensionStore.js";
import { TabAccessRegistry } from "./TabAccessRegistry.js";
import { canSleepTab, shouldSleepTab } from "./TabSleepingPolicy.js";
import { SyncAccountManager } from "./SyncAccountManager.js";
import {
  MAX_WORK_ATTACHMENTS,
  attachmentBudgetIssue,
  detectImageMimeType,
  type WorkImageMimeType,
} from "./WorkAttachmentPolicy.js";
import { promptForNativeSecret } from "./NativeSecretPrompt.js";
import {
  WORK_MODEL_PROVIDERS,
  WorkModelProviderStore,
  deduplicatedWorkModels,
  normalizeProviderSetup,
  publishedContextWindow,
  workModelProvider,
  type ConfigurableWorkModelProviderId,
} from "./WorkModelProviders.js";
import { interruptRunningWorkTerminal, updateWorkPlan, updateWorkTerminal } from "./WorkSurfaceEvents.js";
import { listWorkspaceFiles, readWorkspaceFile } from "./WorkWorkspaceBrowser.js";

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
const AgentSessionsSchema = z.object({
  sessions: z.array(z.object({
    id: z.string().min(1).max(255),
    preview: z.string().nullish().transform((value) => value ?? ""),
    mtime: z.number().finite(),
    cwd: z.string().nullish(),
    title: z.string().nullish().transform((value) => value ?? ""),
    archived: z.boolean().optional().default(false),
  })),
  current: z.string().optional().default(""),
});
const AgentSessionInfoSchema = z.object({
  session_id: z.string().min(1).max(255),
  cwd: z.string().nullish().transform((value) => value ?? ""),
});
const AgentSessionResultSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown() })).optional().default([]),
  session_info: AgentSessionInfoSchema,
});
const AgentSessionTranscriptSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown() })).optional().default([]),
});
const AgentNewSessionSchema = z.object({
  session_info: AgentSessionInfoSchema,
});
const AgentConfigSchema = z.object({
  cwd: z.string(),
  session_info: AgentSessionInfoSchema,
});
const AgentProviderStateSchema = z.object({
  provider: z.enum(["ollama", "remote", "chatgpt"]),
  host: z.string().default(""),
  model: z.string().default(""),
  remote_base_url: z.string().default(""),
  remote_model: z.string().default(""),
  has_api_key: z.boolean().default(false),
  account_label: z.string().default(""),
});
const AgentModelsSchema = z.object({
  models: z.array(z.object({
    name: z.string().min(1).max(1_024),
    parameter_size: z.string().optional().default(""),
    vision: z.boolean().nullish(),
  })),
  current: z.string().optional().default(""),
});
const LocalModelsSchema = z.object({
  models: z.array(z.object({
    name: z.string().min(1).max(1_024),
    details: z.object({ parameter_size: z.string().optional() }).optional(),
  })),
});
const ChatGPTAccountSchema = z.object({
  status: z.string(),
  runtime_available: z.boolean().default(false),
  runtime_version: z.string().default(""),
  email: z.string().nullish(),
  plan_type: z.string().nullish(),
  message: z.string().nullish(),
});
const ChatGPTModelsSchema = z.object({
  status: z.string(),
  models: z.array(z.object({
    id: z.string().min(1).max(1_024),
    display_name: z.string().default(""),
    description: z.string().default(""),
    is_default: z.boolean().default(false),
  })).default([]),
});
const ChatGPTLoginSchema = z.object({
  status: z.literal("signing_in"),
  login_id: z.string(),
  auth_url: z.string().url(),
});
const AgentGitStatusSchema = z.object({
  ok: z.boolean(),
  is_repo: z.boolean(),
  error: z.string().nullish(),
  branch: z.string().nullish(),
  detached: z.boolean().default(false),
  ahead: z.number().int().nonnegative().default(0),
  behind: z.number().int().nonnegative().default(0),
  files: z.array(z.object({
    path: z.string().min(1).max(2_048),
    orig_path: z.string().nullish(),
    status: z.string().max(80).default("modified"),
    staged: z.boolean().default(false),
    unstaged: z.boolean().default(false),
    untracked: z.boolean().default(false),
    binary: z.boolean().default(false),
    additions: z.number().int().nonnegative().nullish(),
    deletions: z.number().int().nonnegative().nullish(),
  })).max(2_000).default([]),
});
const AgentGitDiffSchema = z.object({
  ok: z.boolean(),
  path: z.string().max(2_048),
  binary: z.boolean().default(false),
  truncated: z.boolean().default(false),
  raw: z.string().max(220_000).default(""),
  error: z.string().nullish(),
});

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

interface WorkAttachmentRecord extends WorkAttachmentState {
  mimeType: WorkImageMimeType;
  data: string;
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
  readonly #workModelProviders: WorkModelProviderStore;
  readonly #extensions: ExtensionManager | undefined;
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
  #stopRequested = false;
  #messages: WorkMessage[] = [welcomeWorkMessage()];
  #conversations: WorkConversationState[] = [];
  #workspacePath = "";
  #attachments = new Map<string, WorkAttachmentRecord>();
  #workModel: WorkModelState = initialWorkModelState();
  #workModelCatalogs = new Map<WorkModelProviderId, WorkModelOptionState[]>();
  #chatGPTAccount = ChatGPTAccountSchema.parse({ status: "signed_out" });
  #chatGPTPollTimer: NodeJS.Timeout | undefined;
  #chatGPTPollStartedAt = 0;
  #workModelSwitching = false;
  #workModelMessage = "Loading model options…";
  #workPlan: WorkPlanState | undefined;
  #workChanges: WorkChangesState = initialWorkChangesState();
  #workFiles: WorkFilesState = initialWorkFilesState();
  #workTerminal: WorkTerminalEntryState[] = [];
  #runtimeRecovery = { attempt: 0, retrying: false, canRetry: false };
  #runtimeRecoveryTimer: NodeJS.Timeout | undefined;
  #runtimeRecoverySessionId = "";
  #restoringRuntimeSession = false;
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
    this.#workModelProviders = new WorkModelProviderStore(this.#database, electronCredentialCipher, this.#profileId);
    const lastWorkSessionId = this.#database.setting(this.#profileId, "lastWorkSessionId");
    if (!this.#privateWindow && typeof lastWorkSessionId === "string" && lastWorkSessionId.trim()) {
      this.#sessionId = lastWorkSessionId.trim();
      this.#runtimeRecoverySessionId = this.#sessionId;
    }
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
      icon: join(app.getAppPath(), "assets", "icon.png"),
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

    const profileSession = this.#configureProfileSession();
    this.#extensions = this.#privateWindow ? undefined : new ExtensionManager(
      this.#database,
      this.#profileId,
      profileSession.extensions,
      new GalleryExtensionStore(
        join(app.getPath("userData"), "Extension Packages", this.#profileId),
        trustedGalleryFingerprints,
      ),
    );
    if (this.#privateWindow) {
      this.#restoreTabs();
      this.#runtimeState = "offline";
      this.#runtimeMessage = "Work Mode is unavailable in private windows.";
    } else {
      this.#createWorkView(rendererUrl, preloadPath);
      this.#bindRuntime();
      void this.#initializeExtensionsAndRestoreTabs();
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
      extensions: this.#extensions?.state() ?? {
        developerMode: false,
        loading: false,
        installs: [],
        supportedApiCount: 0,
        trustedGalleryKeyCount: 0,
        message: "Extensions are disabled in Private Windows.",
      },
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
        conversations: this.#conversations,
        attachments: [...this.#attachments.values()].map(({ data: _data, ...attachment }) => attachment),
        model: this.#workModel,
        ...(this.#workPlan ? { plan: this.#workPlan } : {}),
        changes: this.#workChanges,
        files: this.#workFiles,
        terminal: this.#workTerminal,
        recovery: this.#runtimeRecovery,
        ...(this.#workspacePath ? { workspace: { name: basename(this.#workspacePath) || this.#workspacePath, path: this.#workspacePath } } : {}),
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
      case "set-extension-developer-mode":
        await this.#setExtensionDeveloperMode(command.enabled);
        break;
      case "install-unpacked-extension":
        await this.#installUnpackedExtension();
        break;
      case "install-signed-extension":
        await this.#installSignedExtension();
        break;
      case "set-extension-enabled":
        await this.#setExtensionEnabled(command.extensionId, command.enabled);
        break;
      case "rollback-extension":
        await this.#rollbackExtension(command.extensionId);
        break;
      case "remove-extension":
        await this.#removeExtension(command.extensionId);
        break;
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
        if (command.panel === "changes") await this.#refreshWorkChanges();
        if (command.panel === "files") await this.#refreshWorkFiles();
        break;
      case "new-work-conversation":
        await this.#newWorkConversation();
        break;
      case "select-work-conversation":
        await this.#selectWorkConversation(command.sessionId);
        break;
      case "choose-workspace":
        await this.#chooseWorkspace();
        break;
      case "request-work-plan":
        this.#requestWorkPlan();
        break;
      case "approve-work-plan":
        this.#approveWorkPlan();
        break;
      case "revise-work-plan":
        this.#reviseWorkPlan();
        break;
      case "refresh-work-changes":
        await this.#refreshWorkChanges();
        break;
      case "select-work-change":
        await this.#selectWorkChange(command.path, command.staged ?? false);
        break;
      case "refresh-work-files":
        await this.#refreshWorkFiles();
        break;
      case "select-work-file":
        await this.#selectWorkFile(command.path);
        break;
      case "clear-work-terminal":
        this.#workTerminal = [];
        break;
      case "restart-work-runtime":
        await this.#restartWorkRuntime(true);
        break;
      case "choose-work-attachments":
        await this.#chooseWorkAttachments();
        break;
      case "remove-work-attachment":
        this.#attachments.delete(command.attachmentId);
        break;
      case "configure-work-provider":
        await this.#configureWorkProvider(command.providerId, command.model, command.baseUrl);
        break;
      case "select-work-model":
        await this.#selectWorkModel(command.providerId, command.model);
        break;
      case "start-chatgpt-login":
        await this.#startChatGPTLogin();
        break;
      case "sign-out-chatgpt":
        await this.#signOutChatGPT();
        break;
      case "refresh-work-models":
        await this.#refreshWorkModelCatalogs(true);
        break;
      case "work-send":
        this.#sendWorkMessage(command.text);
        break;
      case "stop-work":
        this.#stopRequested = true;
        this.#runtime.send({ type: "interrupt" });
        this.#busy = false;
        this.#pendingPermission = undefined;
        this.#workTerminal = interruptRunningWorkTerminal(this.#workTerminal);
        for (const message of this.#messages) {
          if (message.streaming) message.streaming = false;
        }
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
    clearInterval(this.#chatGPTPollTimer);
    clearTimeout(this.#runtimeRecoveryTimer);
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
    void this.#extensions?.initialize().then(() => this.#broadcast());
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

  #configureProfileSession(): Electron.Session {
    const profileSession = session.fromPartition(this.#partitionName);
    this.#hardenSession(profileSession);
    return profileSession;
  }

  async #initializeExtensionsAndRestoreTabs(): Promise<void> {
    try {
      await this.#extensions?.initialize();
    } finally {
      if (this.#disposed) return;
      this.#restoreTabs();
      this.#layout(false);
      this.#broadcast();
    }
  }

  async #setExtensionDeveloperMode(enabled: boolean): Promise<void> {
    if (!this.#extensions || enabled === this.#extensions.developerMode()) return;
    if (enabled) {
      const result = await dialog.showMessageBox(this.window, {
        type: "warning",
        title: "Turn on Extension Developer Mode?",
        message: "Unpacked extensions are trusted local code",
        detail: "Only load folders you created or reviewed. An unpacked extension can read and change pages covered by its approved site permissions. Developer extensions never run in Private Windows and are never synced.",
        buttons: ["Turn On", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (result.response !== 0) return;
    }
    await this.#extensions.setDeveloperMode(enabled);
  }

  async #installUnpackedExtension(): Promise<void> {
    if (!this.#extensions?.developerMode()) throw new Error("Turn on Extension Developer Mode first");
    const result = await dialog.showOpenDialog(this.window, {
      title: "Choose Unpacked Locus Extension",
      properties: ["openDirectory"],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return;
    const review = await this.#extensions.inspectUnpacked(path);
    if (!await this.#confirmExtensionPermissions(review, "Load Extension")) return;
    await this.#extensions.installUnpacked(review);
  }

  async #installSignedExtension(): Promise<void> {
    if (!this.#extensions) return;
    const result = await dialog.showOpenDialog(this.window, {
      title: "Choose Signed Locus Extension",
      properties: ["openFile"],
      filters: [{ name: "Signed Locus extensions", extensions: ["locusx"] }],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return;
    const review = await this.#extensions.inspectGallery(path);
    const existing = this.#extensions.state().installs.find((extension) => extension.id === ("id" in review.inspection ? review.inspection.id : ""));
    const action = existing ? "Verify and Update" : "Verify and Install";
    if (!await this.#confirmExtensionPermissions(review, action)) return;
    await this.#extensions.installGallery(review);
  }

  async #setExtensionEnabled(id: string, enabled: boolean): Promise<void> {
    if (!this.#extensions) return;
    if (!enabled) {
      await this.#extensions.setEnabled(id, false);
      return;
    }
    const review = await this.#extensions.prepareEnable(id);
    if (review.expansion.length && !await this.#confirmExtensionPermissions(review, "Approve and Enable")) return;
    await this.#extensions.setEnabled(id, true, review);
  }

  async #removeExtension(id: string): Promise<void> {
    if (!this.#extensions) return;
    const extension = this.#extensions.state().installs.find((install) => install.id === id);
    if (!extension) return;
    const result = await dialog.showMessageBox(this.window, {
      type: "warning",
      title: `Remove ${extension.name}?`,
      message: "Remove this extension from the current browser profile?",
      detail: extension.source === "developer"
        ? "Locus Browser will unload the extension and forget it. The original developer folder will not be deleted."
        : "Locus Browser will unload this extension and delete its managed package versions from the current profile.",
      buttons: ["Remove", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0) await this.#extensions.remove(id);
  }

  async #rollbackExtension(id: string): Promise<void> {
    if (!this.#extensions) return;
    const review = await this.#extensions.prepareRollback(id);
    if (!await this.#confirmExtensionPermissions(review, `Roll Back to ${review.inspection.manifest.version}`)) return;
    await this.#extensions.rollback(id, review);
  }

  async #confirmExtensionPermissions(review: ExtensionPermissionReview, action: string): Promise<boolean> {
    const manifest = review.inspection.manifest;
    const signedInspection = "publisherFingerprint" in review.inspection ? review.inspection : undefined;
    const apiPermissions = [
      ...manifest.permissions,
      ...manifest.optional_permissions.map((permission) => `${permission} (optional)`),
    ];
    const declaredHosts = new Set([...manifest.host_permissions, ...manifest.optional_host_permissions]);
    const hosts = [
      ...manifest.host_permissions,
      ...manifest.optional_host_permissions.map((permission) => `${permission} (optional)`),
      ...extensionContentScriptMatches(manifest)
        .filter((permission) => !declaredHosts.has(permission))
        .map((permission) => `${permission} (content script)`),
    ];
    const detail = [
      manifest.description || "No description provided.",
      ...(signedInspection ? [
        `Verified publisher: ${signedInspection.publisherFingerprint.slice(0, 16)}`,
        `Gallery key: ${trustedGalleryKeys.find((key) => key.fingerprint === signedInspection.galleryFingerprint)?.name ?? "Trusted Locus gallery"}`,
      ] : []),
      `API access: ${apiPermissions.length ? apiPermissions.join(", ") : "None"}`,
      `Site access: ${hosts.length ? hosts.join(", ") : "None"}`,
      ...(review.expansion.length ? [`New access: ${review.expansion.join(", ")}`] : []),
      `${review.inspection.fileCount} files · ${(review.inspection.totalBytes / 1_048_576).toFixed(2)} MB · ${review.source === "developer" ? `Files stay in ${review.inspection.path}` : "Locus stores a verified private copy for this profile"}`,
    ].join("\n\n");
    const result = await dialog.showMessageBox(this.window, {
      type: review.expansion.length ? "warning" : "info",
      title: `${action}: ${manifest.name}`,
      message: `${manifest.name} ${manifest.version} requests the following access`,
      detail,
      buttons: [action, "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    return result.response === 0;
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
    for (const extension of profileSession.extensions.getAllExtensions()) profileSession.extensions.removeExtension(extension.id);
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
      if (status.status === "online") {
        clearTimeout(this.#runtimeRecoveryTimer);
        this.#runtimeRecoveryTimer = undefined;
        this.#runtimeState = "online";
        this.#runtimeMessage = this.#runtimeRecoverySessionId ? "Restoring your conversation…" : status.message;
        void this.#finishRuntimeConnection();
      } else if (status.status === "offline") {
        this.#handleRuntimeOffline(status.message);
      } else {
        this.#runtimeState = status.status;
        this.#runtimeMessage = status.message;
      }
      this.#broadcast();
    });
    this.#runtime.on("event", (event: AgentEvent) => void this.#handleAgentEvent(event));
  }

  async #handleAgentEvent(event: AgentEvent): Promise<void> {
    const type = String(event.type ?? "");
    const nextPlan = updateWorkPlan(this.#workPlan, event);
    if (nextPlan !== this.#workPlan) this.#workPlan = nextPlan;
    const nextTerminal = updateWorkTerminal(this.#workTerminal, event);
    if (nextTerminal !== this.#workTerminal) this.#workTerminal = nextTerminal;
    if (type === "chatgpt_account_updated") {
      await this.#refreshChatGPTState(true);
      this.#broadcast();
      return;
    }
    if (this.#restoringRuntimeSession && (type === "session_started" || type === "session_info")) return;
    if (type === "session_started") {
      const sessionInfo = event.session_info && typeof event.session_info === "object"
        ? event.session_info as Record<string, unknown>
        : undefined;
      const nextSessionId = String(sessionInfo?.session_id ?? event.session_id ?? "").trim();
      if (nextSessionId) this.#setSessionId(nextSessionId);
      this.#workspacePath = String(sessionInfo?.cwd ?? event.cwd ?? "").trim();
      this.#messages = [welcomeWorkMessage()];
      this.#attachments.clear();
      this.#workPlan = undefined;
      this.#workTerminal = [];
      this.#workChanges = initialWorkChangesState();
      this.#workFiles = initialWorkFilesState();
      this.#workPanel = "chat";
      this.#pendingPermission = undefined;
      this.#busy = false;
      this.#stopRequested = false;
      await this.#refreshConversations();
      if (this.#workspacePath) await Promise.all([this.#refreshWorkChanges(), this.#refreshWorkFiles()]);
      this.#broadcast();
      return;
    }
    if (type === "session_info") {
      const nextSessionId = String(event.session_id ?? event.id ?? "").trim();
      if (nextSessionId) this.#setSessionId(nextSessionId);
      if (typeof event.cwd === "string") this.#workspacePath = event.cwd.trim();
      if (nextSessionId && this.#messages.length === 1 && this.#messages[0]?.text === welcomeWorkMessageText) {
        await this.#restoreCurrentTranscript(nextSessionId);
      }
      await this.#refreshConversations();
      this.#broadcast();
      return;
    }
    if (type === "workspace_changed") {
      await Promise.all([this.#refreshWorkChanges(), this.#refreshWorkFiles()]);
    } else if (type === "browser_action_request") {
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
    } else if (this.#stopRequested && (type === "message_start" || type === "token" || type === "text_delta" || type === "message_delta" || type === "assistant_delta")) {
      return;
    } else if (type === "message_start") {
      this.#busy = true;
      this.#messages.push({ id: String(event.id ?? randomUUID()), role: "assistant", text: "", streaming: true });
    } else if (type === "token" || type === "text_delta" || type === "message_delta" || type === "assistant_delta") {
      const message = [...this.#messages].reverse().find((item) => item.role === "assistant" && item.streaming);
      if (message) message.text += String(event.text ?? event.delta ?? event.content ?? "");
    } else if (type === "message_end" || type === "turn_end" || type === "turn_done") {
      this.#busy = false;
      this.#stopRequested = false;
      const message = [...this.#messages].reverse().find((item) => item.streaming);
      if (message) {
        if (!message.text && event.content) message.text = String(event.content);
        message.streaming = false;
      }
      void this.#refreshConversations();
    } else if (type === "error") {
      this.#busy = false;
      this.#stopRequested = false;
      this.#messages.push({ id: randomUUID(), role: "system", text: String(event.message ?? event.error ?? "Agent error") });
    }
    this.#broadcast();
  }

  #handleRuntimeOffline(message: string): void {
    if (this.#disposed || this.#privateWindow) return;
    const savedSessionId = this.#database.setting(this.#profileId, "lastWorkSessionId");
    if (!this.#runtimeRecoverySessionId && typeof savedSessionId === "string") {
      this.#runtimeRecoverySessionId = savedSessionId.trim();
    }
    this.#runtimeState = "offline";
    this.#busy = false;
    this.#pendingPermission = undefined;
    this.#workTerminal = interruptRunningWorkTerminal(this.#workTerminal);
    clearTimeout(this.#runtimeRecoveryTimer);
    this.#runtimeRecoveryTimer = undefined;
    if (this.#runtimeRecovery.attempt >= 3) {
      this.#runtimeRecovery = { ...this.#runtimeRecovery, retrying: false, canRetry: true };
      this.#runtimeMessage = `${message}. Reconnect when you are ready.`;
      return;
    }
    const attempt = this.#runtimeRecovery.attempt + 1;
    this.#runtimeRecovery = { attempt, retrying: true, canRetry: false };
    this.#runtimeMessage = `${message}. Reconnecting (${attempt}/3)…`;
    const delay = [750, 2_000, 5_000][attempt - 1] ?? 5_000;
    this.#runtimeRecoveryTimer = setTimeout(() => void this.#restartWorkRuntime(false), delay);
  }

  async #restartWorkRuntime(manual: boolean): Promise<void> {
    if (this.#disposed || this.#privateWindow) return;
    clearTimeout(this.#runtimeRecoveryTimer);
    this.#runtimeRecoveryTimer = undefined;
    if (manual) this.#runtimeRecovery = { attempt: 1, retrying: true, canRetry: false };
    this.#runtimeState = "starting";
    this.#runtimeMessage = "Restarting the local agent…";
    this.#broadcast();
    try {
      await this.#runtime.restart();
    } catch (error) {
      this.#handleRuntimeOffline(agentRequestError(error, "The local agent could not restart"));
      this.#broadcast();
    }
  }

  async #finishRuntimeConnection(): Promise<void> {
    const recoverySessionId = this.#runtimeRecoverySessionId;
    this.#restoringRuntimeSession = Boolean(recoverySessionId);
    let recovered = false;
    try {
      if (recoverySessionId) {
        const result = AgentSessionResultSchema.parse(await this.#runtime.resumeSession(recoverySessionId));
        this.#applyRuntimeSession(result);
        recovered = true;
      }
    } catch {
      try {
        const sessions = AgentSessionsSchema.parse(await this.#runtime.listSessions());
        if (sessions.current) {
          const fallback = AgentSessionResultSchema.parse(await this.#runtime.resumeSession(sessions.current));
          this.#applyRuntimeSession(fallback);
        } else {
          const created = AgentNewSessionSchema.parse(await this.#runtime.newSession(this.#workspacePath));
          this.#setSessionId(created.session_info.session_id);
          this.#workspacePath = created.session_info.cwd.trim();
        }
        this.#messages.push({ id: randomUUID(), role: "system", text: "The previous conversation was unavailable, so Locus opened the latest recoverable chat." });
      } catch {
        this.#messages.push({ id: randomUUID(), role: "system", text: "The agent reconnected, but the previous conversation could not be restored." });
      }
    } finally {
      this.#runtimeRecoverySessionId = "";
      this.#restoringRuntimeSession = false;
    }
    this.#runtimeState = "online";
    this.#runtimeRecovery = { attempt: 0, retrying: false, canRetry: false };
    this.#runtimeMessage = recovered ? "Conversation recovered" : "Local agent ready";
    await Promise.all([
      this.#refreshConversations(),
      this.#initializeWorkModels(),
      ...(this.#workspacePath ? [this.#refreshWorkChanges(), this.#refreshWorkFiles()] : []),
    ]);
    this.#broadcast();
  }

  #applyRuntimeSession(result: z.infer<typeof AgentSessionResultSchema>): void {
    this.#setSessionId(result.session_info.session_id);
    this.#workspacePath = result.session_info.cwd.trim();
    const messages = result.messages.map(agentWorkMessage).filter((message): message is WorkMessage => Boolean(message));
    this.#messages = messages.length ? messages : [welcomeWorkMessage()];
    this.#attachments.clear();
    this.#pendingPermission = undefined;
    this.#busy = false;
    this.#stopRequested = false;
  }

  #requestWorkPlan(): void {
    if (this.#busy || this.#runtimeState !== "online") return;
    this.#workMode = "plan";
    this.#workPanel = "chat";
    this.#sendWorkMessage("Create a concise, decision-complete implementation plan for the current request and workspace.");
  }

  #approveWorkPlan(): void {
    if (!this.#workPlan?.pendingApproval || this.#busy || this.#runtimeState !== "online") return;
    this.#workPlan = { ...this.#workPlan, pendingApproval: false };
    this.#workMode = "build";
    this.#workPanel = "chat";
    this.#sendWorkMessage("Implement the plan you just created, in order. Keep the task list updated as you complete each step.");
  }

  #reviseWorkPlan(): void {
    if (!this.#workPlan) return;
    this.#workPlan = { ...this.#workPlan, pendingApproval: false };
    this.#workMode = "plan";
    this.#workPanel = "chat";
  }

  async #refreshWorkChanges(): Promise<void> {
    if (!this.#workspacePath) {
      this.#workChanges = { ...initialWorkChangesState(), error: "Choose a workspace to review changes." };
      return;
    }
    if (this.#runtimeState !== "online") return;
    const selectedPath = this.#workChanges.selectedPath;
    const selectedStaged = this.#workChanges.selectedStaged ?? false;
    this.#workChanges = { ...this.#workChanges, loading: true, error: undefined };
    this.#broadcast();
    try {
      const result = AgentGitStatusSchema.parse(await this.#runtime.gitStatus());
      const files = result.files.map((file) => ({
        path: file.path,
        ...(file.orig_path ? { originalPath: file.orig_path } : {}),
        status: file.status,
        staged: file.staged,
        unstaged: file.unstaged,
        untracked: file.untracked,
        binary: file.binary,
        ...(typeof file.additions === "number" ? { additions: file.additions } : {}),
        ...(typeof file.deletions === "number" ? { deletions: file.deletions } : {}),
      }));
      const keepSelection = selectedPath && files.some((file) => file.path === selectedPath);
      this.#workChanges = {
        loading: false,
        isRepository: result.is_repo,
        ...(result.branch ? { branch: result.branch } : {}),
        detached: result.detached,
        ahead: result.ahead,
        behind: result.behind,
        files,
        ...(!result.ok || result.error ? { error: result.error || "Git status is unavailable" } : {}),
      };
      if (keepSelection) await this.#selectWorkChange(selectedPath, selectedStaged);
    } catch (error) {
      this.#workChanges = { ...initialWorkChangesState(), error: agentRequestError(error, "Could not load workspace changes") };
    }
  }

  async #selectWorkChange(path: string, staged: boolean): Promise<void> {
    if (this.#runtimeState !== "online" || !this.#workChanges.files.some((file) => file.path === path)) return;
    this.#workChanges = { ...this.#workChanges, loading: true, selectedPath: path, selectedStaged: staged, error: undefined };
    this.#broadcast();
    try {
      const result = AgentGitDiffSchema.parse(await this.#runtime.gitDiff(path, staged));
      this.#workChanges = {
        ...this.#workChanges,
        loading: false,
        selectedPath: path,
        selectedStaged: staged,
        diff: result.raw,
        diffBinary: result.binary,
        diffTruncated: result.truncated,
        ...(!result.ok || result.error ? { error: result.error || "That diff is unavailable" } : {}),
      };
    } catch (error) {
      this.#workChanges = { ...this.#workChanges, loading: false, error: agentRequestError(error, "Could not load that diff") };
    }
  }

  async #refreshWorkFiles(): Promise<void> {
    if (!this.#workspacePath) {
      this.#workFiles = { ...initialWorkFilesState(), error: "Choose a workspace to browse files." };
      return;
    }
    const selectedPath = this.#workFiles.selectedPath;
    this.#workFiles = { ...this.#workFiles, loading: true, error: undefined };
    this.#broadcast();
    try {
      const result = await listWorkspaceFiles(this.#workspacePath);
      const keepSelection = selectedPath && result.entries.some((entry) => entry.path === selectedPath);
      this.#workFiles = { loading: false, entries: result.entries, truncated: result.truncated };
      if (keepSelection) await this.#selectWorkFile(selectedPath);
    } catch (error) {
      this.#workFiles = { ...initialWorkFilesState(), error: agentRequestError(error, "Could not browse that workspace") };
    }
  }

  async #selectWorkFile(path: string): Promise<void> {
    if (!this.#workspacePath || !this.#workFiles.entries.some((entry) => entry.path === path)) return;
    this.#workFiles = { ...this.#workFiles, loading: true, selectedPath: path, error: undefined };
    this.#broadcast();
    try {
      const result = await readWorkspaceFile(this.#workspacePath, path);
      this.#workFiles = { ...this.#workFiles, loading: false, selectedPath: result.path, content: result.content, contentTruncated: result.truncated };
    } catch (error) {
      this.#workFiles = { ...this.#workFiles, loading: false, selectedPath: path, content: undefined, error: agentRequestError(error, "Could not preview that file") };
    }
  }

  async #initializeWorkModels(): Promise<void> {
    this.#workModelSwitching = true;
    this.#workModelMessage = "Loading model options…";
    this.#rebuildWorkModelState();
    this.#broadcast();
    try {
      await Promise.all([this.#refreshLocalModelCatalog(), this.#refreshChatGPTState(false)]);
      const current = AgentProviderStateSchema.parse(await this.#runtime.provider());
      const requestedProvider = this.#workModelProviders.activeProvider();
      const stored = this.#workModelProviders.config(requestedProvider);
      const fallbackModel = requestedProvider === "local" && current.provider === "ollama" ? current.model : "";
      const requestedModel = stored?.model || fallbackModel || this.#modelsFor(requestedProvider)[0]?.id || "";
      if (requestedProvider !== "local" && !this.#providerCanConnect(requestedProvider)) {
        throw new Error(`${workModelProvider(requestedProvider).name} needs to be connected again`);
      }
      await this.#applyWorkModelRoute(requestedProvider, requestedModel);
      this.#workModelMessage = "Model options are ready";
    } catch (error) {
      const reason = agentRequestError(error, "Could not restore the selected model");
      try {
        const localModel = this.#workModelProviders.config("local")?.model || this.#modelsFor("local")[0]?.id || "";
        await this.#applyWorkModelRoute("local", localModel);
        this.#workModelMessage = `${reason}. Using local models.`;
      } catch {
        this.#workModelMessage = reason;
      }
    } finally {
      this.#workModelSwitching = false;
      this.#rebuildWorkModelState();
      this.#broadcast();
    }
  }

  async #configureWorkProvider(
    providerId: ConfigurableWorkModelProviderId,
    model: string,
    rawBaseUrl?: string,
  ): Promise<void> {
    if (this.#busy || this.#runtimeState !== "online" || this.#workModelSwitching) return;
    const previousProvider = this.#workModelProviders.activeProvider();
    const previousModel = this.#workModelProviders.config(previousProvider)?.model || this.#workModel.activeModel;
    try {
      const setup = normalizeProviderSetup(providerId, rawBaseUrl, model);
      const definition = workModelProvider(providerId);
      const savedKey = this.#workModelProviders.apiKey(providerId);
      const enteredKey = await promptForNativeSecret({
        title: `Connect ${definition.name}`,
        message: providerId === "vllm"
          ? `Enter this endpoint's API key. Leave it empty for a trusted local vLLM server that does not require one. The key stays encrypted on this Mac.`
          : `Enter your ${definition.name} key. Leave it empty to keep the key already saved on this Mac. Locus Browser never exposes it to webpages or Work Mode.`,
        confirmLabel: "Connect",
      });
      if (enteredKey === undefined) return;
      const apiKey = enteredKey || savedKey;
      if (definition.requiresApiKey && !apiKey) throw new Error(`${definition.name} requires an API key`);

      this.#workModelSwitching = true;
      this.#workModelMessage = `Connecting ${definition.name}…`;
      this.#rebuildWorkModelState();
      this.#broadcast();
      const response = AgentProviderStateSchema.parse(await this.#runtime.configureProvider({
        provider: "remote",
        base_url: setup.baseUrl,
        api_key: apiKey,
        model: setup.model,
        auth_style: definition.authStyle,
        account_label: definition.name,
        lists_models: definition.listsModels,
        published_context_window: publishedContextWindow(providerId, setup.model) ?? 0,
        verify: true,
      }));
      this.#workModelProviders.saveProvider(
        providerId,
        setup,
        enteredKey ? enteredKey : savedKey ? undefined : "",
      );
      this.#workModelProviders.setActive(providerId);
      await this.#refreshActiveAgentCatalog(providerId).catch(() => undefined);
      this.#workModelMessage = `Using ${definition.shortName} · ${response.model || setup.model}`;
    } catch (error) {
      this.#workModelMessage = agentRequestError(error, "Could not connect that model provider");
      await this.#applyWorkModelRoute(previousProvider, previousModel).catch(() => undefined);
    } finally {
      this.#workModelSwitching = false;
      this.#rebuildWorkModelState();
      this.#broadcast();
    }
  }

  async #selectWorkModel(providerId: WorkModelProviderId, model: string): Promise<void> {
    if (this.#busy || this.#runtimeState !== "online" || this.#workModelSwitching) return;
    this.#workModelSwitching = true;
    this.#workModelMessage = `Switching to ${model}…`;
    this.#rebuildWorkModelState();
    this.#broadcast();
    try {
      if (!this.#providerCanConnect(providerId)) {
        const provider = workModelProvider(providerId);
        throw new Error(providerId === "chatgpt-plan" ? "Sign in with ChatGPT first" : `Connect ${provider.name} first`);
      }
      await this.#applyWorkModelRoute(providerId, model);
      await this.#refreshActiveAgentCatalog(providerId).catch(() => undefined);
      this.#workModelMessage = `Using ${workModelProvider(providerId).shortName} · ${model}`;
    } catch (error) {
      this.#workModelMessage = agentRequestError(error, "Could not switch models");
    } finally {
      this.#workModelSwitching = false;
      this.#rebuildWorkModelState();
      this.#broadcast();
    }
  }

  async #applyWorkModelRoute(providerId: WorkModelProviderId, requestedModel: string): Promise<void> {
    const definition = workModelProvider(providerId);
    const model = requestedModel.trim();
    if (providerId === "local") {
      const state = AgentProviderStateSchema.parse(await this.#runtime.configureProvider({ provider: "ollama" }));
      const selected = model || state.model || this.#modelsFor("local")[0]?.id || "";
      if (selected && selected !== state.model) await this.#runtime.setModel(selected);
      this.#workModelProviders.saveProvider("local", { model: selected });
      this.#workModelProviders.setActive("local");
      return;
    }
    if (providerId === "chatgpt-plan") {
      if (this.#chatGPTAccount.status !== "signed_in") throw new Error("Sign in with ChatGPT before selecting a plan model");
      const selected = model || this.#modelsFor(providerId)[0]?.id || "";
      if (!selected) throw new Error("The ChatGPT account did not report any models");
      const state = AgentProviderStateSchema.parse(await this.#runtime.configureProvider({
        provider: "chatgpt",
        account_id: "locus-browser-chatgpt",
        account_label: "ChatGPT Plan",
        model: selected,
      }));
      this.#workModelProviders.saveProvider(providerId, { model: state.model || selected });
      this.#workModelProviders.setActive(providerId);
      return;
    }
    const config = this.#workModelProviders.config(providerId);
    if (!config?.baseUrl) throw new Error(`Connect ${definition.name} before selecting a model`);
    const apiKey = this.#workModelProviders.apiKey(providerId);
    if (definition.requiresApiKey && !apiKey) throw new Error(`${definition.name} needs an API key`);
    const selected = model || config.model;
    if (!selected) throw new Error("Choose a model before switching providers");
    const state = AgentProviderStateSchema.parse(await this.#runtime.configureProvider({
      provider: "remote",
      base_url: config.baseUrl,
      api_key: apiKey,
      model: selected,
      auth_style: definition.authStyle,
      account_label: definition.name,
      lists_models: definition.listsModels,
      published_context_window: publishedContextWindow(providerId, selected) ?? 0,
    }));
    this.#workModelProviders.saveProvider(providerId, { baseUrl: config.baseUrl, model: state.model || selected });
    this.#workModelProviders.setActive(providerId);
  }

  async #startChatGPTLogin(): Promise<void> {
    if (this.#busy || this.#runtimeState !== "online" || this.#workModelSwitching) return;
    try {
      const result = ChatGPTLoginSchema.parse(await this.#runtime.startChatGPTLogin());
      await shell.openExternal(result.auth_url);
      this.#chatGPTAccount = { ...this.#chatGPTAccount, status: "signing_in", message: "Finish signing in in the page that opened." };
      this.#workModelMessage = "Finish signing in with ChatGPT, then return to Locus Browser";
      clearInterval(this.#chatGPTPollTimer);
      this.#chatGPTPollStartedAt = Date.now();
      this.#chatGPTPollTimer = setInterval(() => {
        if (Date.now() - this.#chatGPTPollStartedAt > 120_000) {
          clearInterval(this.#chatGPTPollTimer);
          this.#chatGPTPollTimer = undefined;
          this.#workModelMessage = "ChatGPT sign-in is still pending. Use Refresh when it is complete.";
          this.#rebuildWorkModelState();
          this.#broadcast();
          return;
        }
        void this.#refreshChatGPTState(true).then(() => {
          this.#rebuildWorkModelState();
          this.#broadcast();
        });
      }, 1_500);
    } catch (error) {
      this.#workModelMessage = agentRequestError(error, "Could not start ChatGPT sign-in");
    }
    this.#rebuildWorkModelState();
  }

  async #signOutChatGPT(): Promise<void> {
    if (this.#busy || this.#runtimeState !== "online") return;
    try {
      this.#chatGPTAccount = ChatGPTAccountSchema.parse(await this.#runtime.signOutChatGPT());
      this.#workModelCatalogs.delete("chatgpt-plan");
      if (this.#workModelProviders.activeProvider() === "chatgpt-plan") {
        const localModel = this.#workModelProviders.config("local")?.model || this.#modelsFor("local")[0]?.id || "";
        await this.#applyWorkModelRoute("local", localModel);
      }
      this.#workModelMessage = "Signed out of ChatGPT Plan";
    } catch (error) {
      this.#workModelMessage = agentRequestError(error, "Could not sign out of ChatGPT");
    }
    this.#rebuildWorkModelState();
  }

  async #refreshWorkModelCatalogs(refreshChatGPT: boolean): Promise<void> {
    if (this.#runtimeState !== "online" || this.#workModelSwitching) return;
    this.#workModelMessage = "Refreshing model options…";
    this.#rebuildWorkModelState();
    this.#broadcast();
    const activeProvider = this.#workModelProviders.activeProvider();
    await Promise.all([
      this.#refreshLocalModelCatalog(),
      this.#refreshChatGPTState(refreshChatGPT),
      ...(activeProvider === "local" || activeProvider === "chatgpt-plan"
        ? []
        : [this.#refreshActiveAgentCatalog(activeProvider)]),
    ]);
    this.#workModelMessage = "Model options refreshed";
    this.#rebuildWorkModelState();
  }

  async #refreshLocalModelCatalog(): Promise<void> {
    try {
      const result = LocalModelsSchema.parse(await this.#runtime.localModels());
      this.#workModelCatalogs.set("local", result.models.map((model) => ({
        id: model.name,
        name: model.name,
        ...(model.details?.parameter_size ? { detail: model.details.parameter_size } : {}),
      })));
    } catch {
      this.#workModelCatalogs.set("local", []);
    }
  }

  async #refreshChatGPTState(refresh: boolean): Promise<void> {
    try {
      this.#chatGPTAccount = ChatGPTAccountSchema.parse(await this.#runtime.chatGPTAccount(refresh));
      if (this.#chatGPTAccount.status === "signed_in") {
        const models = ChatGPTModelsSchema.parse(await this.#runtime.chatGPTModels());
        this.#workModelCatalogs.set("chatgpt-plan", models.models.map((model) => ({
          id: model.id,
          name: model.display_name || model.id,
          ...(model.description ? { detail: model.description } : {}),
        })));
        clearInterval(this.#chatGPTPollTimer);
        this.#chatGPTPollTimer = undefined;
        this.#workModelMessage = "ChatGPT Plan is connected";
      } else if (this.#chatGPTAccount.status === "runtime_unavailable") {
        clearInterval(this.#chatGPTPollTimer);
        this.#chatGPTPollTimer = undefined;
      }
    } catch (error) {
      this.#chatGPTAccount = ChatGPTAccountSchema.parse({
        status: "runtime_unavailable",
        message: agentRequestError(error, "ChatGPT Plan is unavailable"),
      });
    }
  }

  async #refreshActiveAgentCatalog(providerId: WorkModelProviderId): Promise<void> {
    if (providerId === "local") {
      await this.#refreshLocalModelCatalog();
      return;
    }
    if (providerId === "chatgpt-plan") {
      await this.#refreshChatGPTState(false);
      return;
    }
    if (this.#workModelProviders.activeProvider() !== providerId) return;
    const result = AgentModelsSchema.parse(await this.#runtime.models());
    const models = result.models
      .filter((model) => modelMatchesProvider(providerId, model.name))
      .map((model) => ({
        id: model.name,
        name: model.name,
        ...(model.parameter_size ? { detail: model.parameter_size } : {}),
        ...(typeof model.vision === "boolean" ? { vision: model.vision } : {}),
      }));
    if (models.length) this.#workModelCatalogs.set(providerId, models);
  }

  #providerCanConnect(providerId: WorkModelProviderId): boolean {
    if (providerId === "local") return true;
    if (providerId === "chatgpt-plan") return this.#chatGPTAccount.status === "signed_in";
    const definition = workModelProvider(providerId);
    const config = this.#workModelProviders.config(providerId);
    return Boolean(config?.baseUrl && config.model && (!definition.requiresApiKey || this.#workModelProviders.hasApiKey(providerId)));
  }

  #modelsFor(providerId: WorkModelProviderId): WorkModelOptionState[] {
    const definition = workModelProvider(providerId);
    const configuredModel = this.#workModelProviders.config(providerId)?.model;
    const values: WorkModelOptionState[] = [
      ...(configuredModel ? [{ id: configuredModel, name: configuredModel }] : []),
      ...(this.#workModelCatalogs.get(providerId) ?? []),
      ...definition.curatedModels.map((name) => ({ id: name, name })),
    ];
    return deduplicatedWorkModels(values);
  }

  #rebuildWorkModelState(): void {
    const activeProvider = this.#workModelProviders.activeProvider();
    const activeModel = this.#workModelProviders.config(activeProvider)?.model || "";
    const activeDefinition = workModelProvider(activeProvider);
    this.#workModel = {
      activeProvider,
      activeModel,
      label: activeModel ? `${activeDefinition.shortName} · ${activeModel}` : activeDefinition.shortName,
      switching: this.#workModelSwitching,
      providers: WORK_MODEL_PROVIDERS.map((definition) => {
        const config = this.#workModelProviders.config(definition.id);
        const models = this.#modelsFor(definition.id);
        if (definition.id === "chatgpt-plan") {
          const signedIn = this.#chatGPTAccount.status === "signed_in";
          const signingIn = this.#chatGPTAccount.status === "signing_in";
          const unavailable = this.#chatGPTAccount.status === "runtime_unavailable";
          const accountDetail = [this.#chatGPTAccount.email, this.#chatGPTAccount.plan_type].filter(Boolean).join(" · ");
          return {
            id: definition.id,
            name: definition.name,
            detail: definition.detail,
            mark: definition.mark,
            configured: signedIn,
            status: signingIn ? "signing-in" as const : signedIn ? "ready" as const : unavailable ? "unavailable" as const : "needs-sign-in" as const,
            statusMessage: signingIn ? "Finish sign-in in your browser" : signedIn ? accountDetail || "Signed in" : this.#chatGPTAccount.message || "Sign in required",
            models,
          };
        }
        if (definition.id === "local") {
          return {
            id: definition.id,
            name: definition.name,
            detail: definition.detail,
            mark: definition.mark,
            configured: models.length > 0,
            status: models.length ? "ready" as const : "unavailable" as const,
            statusMessage: models.length ? `${models.length} installed` : "Ollama is unavailable or has no models",
            models,
          };
        }
        const configured = this.#providerCanConnect(definition.id);
        return {
          id: definition.id,
          name: definition.name,
          detail: definition.detail,
          mark: definition.mark,
          configured,
          status: configured ? "ready" as const : definition.id === "vllm" ? "needs-setup" as const : "needs-key" as const,
          statusMessage: configured ? definition.id === "vllm" ? "Endpoint saved on this Mac" : "Key saved on this Mac" : definition.id === "vllm" ? "Endpoint setup required" : "API key required",
          models,
          ...(config?.baseUrl ? { baseUrl: config.baseUrl } : {}),
        };
      }),
      ...(this.#workModelMessage ? { message: this.#workModelMessage } : {}),
    };
  }

  #sendWorkMessage(text: string): void {
    this.#stopRequested = false;
    this.#messages.push({ id: randomUUID(), role: "user", text });
    const attachments = [...this.#attachments.values()].map((attachment) => ({
      name: attachment.name,
      mime_type: attachment.mimeType,
      data: attachment.data,
    }));
    const sent = this.#runtime.send({
      type: "user_message",
      text,
      mode: this.#workMode,
      ...(attachments.length ? { attachments } : {}),
    });
    if (!sent) {
      this.#messages.push({ id: randomUUID(), role: "system", text: "The local agent is offline. Your message was not sent." });
    } else {
      this.#attachments.clear();
      this.#busy = true;
    }
  }

  async #newWorkConversation(): Promise<void> {
    if (this.#busy || this.#runtimeState !== "online") return;
    try {
      const result = AgentNewSessionSchema.parse(await this.#runtime.newSession(this.#workspacePath));
      this.#setSessionId(result.session_info.session_id);
      this.#workspacePath = result.session_info.cwd.trim();
      this.#messages = [welcomeWorkMessage()];
      this.#attachments.clear();
      this.#workPlan = undefined;
      this.#workTerminal = [];
      this.#workChanges = initialWorkChangesState();
      this.#workFiles = initialWorkFilesState();
      this.#pendingPermission = undefined;
      this.#stopRequested = false;
      this.#workPanel = "chat";
      this.#workOpen = true;
      this.#layout(true);
      await this.#refreshConversations();
      if (this.#workspacePath) await Promise.all([this.#refreshWorkChanges(), this.#refreshWorkFiles()]);
    } catch (error) {
      this.#messages.push({ id: randomUUID(), role: "system", text: agentRequestError(error, "Could not start a new conversation") });
    }
  }

  async #selectWorkConversation(sessionId: string): Promise<void> {
    if (this.#busy || this.#runtimeState !== "online") return;
    if (sessionId === this.#sessionId) {
      this.#workPanel = "chat";
      this.#workOpen = true;
      this.#layout(true);
      return;
    }
    try {
      const result = AgentSessionResultSchema.parse(await this.#runtime.resumeSession(sessionId));
      this.#applyRuntimeSession(result);
      this.#workPlan = undefined;
      this.#workTerminal = [];
      this.#workChanges = initialWorkChangesState();
      this.#workFiles = initialWorkFilesState();
      this.#workPanel = "chat";
      this.#workOpen = true;
      this.#layout(true);
      await this.#refreshConversations();
      if (this.#workspacePath) await Promise.all([this.#refreshWorkChanges(), this.#refreshWorkFiles()]);
    } catch (error) {
      this.#messages.push({ id: randomUUID(), role: "system", text: agentRequestError(error, "Could not resume that conversation") });
    }
  }

  async #refreshConversations(): Promise<void> {
    if (this.#runtimeState !== "online" || this.#disposed) return;
    try {
      const result = AgentSessionsSchema.parse(await this.#runtime.listSessions());
      this.#conversations = result.sessions
        .filter((sessionItem) => !sessionItem.archived)
        .map((sessionItem) => ({
          id: sessionItem.id,
          title: conversationTitle(sessionItem.title, sessionItem.preview),
          preview: sessionItem.preview.trim(),
          updatedAt: Math.floor(sessionItem.mtime),
          current: sessionItem.id === (result.current || this.#sessionId),
          ...(sessionItem.cwd ? { cwd: sessionItem.cwd } : {}),
        }));
      this.#broadcast();
    } catch {
      // Conversation history is secondary to the active WebSocket session.
    }
  }

  async #chooseWorkspace(): Promise<void> {
    if (this.#busy || this.#runtimeState !== "online") return;
    const result = await dialog.showOpenDialog(this.window, {
      title: "Choose a Workspace for Solo Work",
      ...(this.#workspacePath ? { defaultPath: this.#workspacePath } : {}),
      properties: ["openDirectory"],
    });
    const selectedPath = result.filePaths[0];
    if (result.canceled || !selectedPath) return;
    try {
      const config = AgentConfigSchema.parse(await this.#runtime.setWorkspace(selectedPath));
      this.#setSessionId(config.session_info.session_id);
      this.#workspacePath = config.cwd.trim();
      await this.#refreshConversations();
      this.#workChanges = initialWorkChangesState();
      this.#workFiles = initialWorkFilesState();
      await Promise.all([this.#refreshWorkChanges(), this.#refreshWorkFiles()]);
    } catch (error) {
      this.#messages.push({ id: randomUUID(), role: "system", text: agentRequestError(error, "Could not open that workspace") });
    }
  }

  async #chooseWorkAttachments(): Promise<void> {
    if (this.#busy || this.#runtimeState !== "online" || this.#attachments.size >= MAX_WORK_ATTACHMENTS) return;
    const result = await dialog.showOpenDialog(this.window, {
      title: "Attach Images to Solo Work",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    if (result.canceled || !result.filePaths.length) return;
    try {
      const metadata = await Promise.all(result.filePaths.map(async (path) => ({ path, size: (await stat(path)).size })));
      const budgetIssue = attachmentBudgetIssue(
        [...this.#attachments.values()].map((attachment) => attachment.size),
        metadata.map((candidate) => candidate.size),
      );
      if (budgetIssue) throw new Error(budgetIssue);
      const candidates = await Promise.all(metadata.map(async (candidate) => ({ ...candidate, bytes: await readFile(candidate.path) })));
      for (const candidate of candidates) {
        const mimeType = detectImageMimeType(candidate.bytes);
        if (!mimeType) throw new Error(`${basename(candidate.path)} is not a supported image.`);
      }
      for (const candidate of candidates) {
        const mimeType = detectImageMimeType(candidate.bytes)!;
        const id = randomUUID();
        this.#attachments.set(id, {
          id,
          name: basename(candidate.path).slice(0, 255) || "image",
          mimeType,
          size: candidate.bytes.byteLength,
          data: candidate.bytes.toString("base64"),
        });
      }
    } catch (error) {
      this.#messages.push({ id: randomUUID(), role: "system", text: agentRequestError(error, "Could not attach those images") });
    }
  }

  async #restoreCurrentTranscript(sessionId: string): Promise<void> {
    try {
      const result = AgentSessionTranscriptSchema.parse(await this.#runtime.session(sessionId));
      const messages = result.messages.map(agentWorkMessage).filter((message): message is WorkMessage => Boolean(message));
      if (messages.length) this.#messages = messages;
    } catch {
      // A corrupt or oversized saved transcript must not block a fresh chat.
    }
  }

  #setSessionId(sessionId: string): void {
    if (!sessionId || sessionId === this.#sessionId) return;
    this.#grants.revokeSession(this.#sessionId);
    this.#sessionId = sessionId;
    if (!this.#privateWindow) this.#database.setSetting(this.#profileId, "lastWorkSessionId", sessionId);
  }

  #answerPermission(requestId: string, decision: "allow" | "always" | "deny"): void {
    const browserWaiter = this.#permissionWaiters.get(requestId);
    if (browserWaiter) {
      browserWaiter.resolve(decision);
      this.#permissionWaiters.delete(requestId);
      if (decision === "always") this.#screenshotConsentForSession = true;
    } else {
      this.#runtime.send({ type: "permission_decision", request_id: requestId, decision: decision === "allow" ? "once" : decision });
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

function initialWorkModelState(): WorkModelState {
  return {
    activeProvider: "local",
    activeModel: "",
    label: "Local",
    switching: false,
    providers: WORK_MODEL_PROVIDERS.map((provider) => ({
      id: provider.id,
      name: provider.name,
      detail: provider.detail,
      mark: provider.mark,
      configured: false,
      status: provider.id === "chatgpt-plan"
        ? "needs-sign-in"
        : provider.id === "vllm"
          ? "needs-setup"
          : provider.id === "local"
            ? "unavailable"
            : "needs-key",
      statusMessage: "Loading…",
      models: provider.curatedModels.map((name) => ({ id: name, name })),
    })),
    message: "Loading model options…",
  };
}

function initialWorkChangesState(): WorkChangesState {
  return {
    loading: false,
    isRepository: false,
    detached: false,
    ahead: 0,
    behind: 0,
    files: [],
  };
}

function initialWorkFilesState(): WorkFilesState {
  return {
    loading: false,
    entries: [],
    truncated: false,
  };
}

function modelMatchesProvider(providerId: WorkModelProviderId, model: string): boolean {
  const name = model.toLowerCase();
  const excluded = ["embedding", "whisper", "tts", "dall-e", "audio", "realtime", "moderation", "image", "transcribe", "search", "sora"];
  if (excluded.some((part) => name.includes(part))) return false;
  if (providerId === "openai-api") return ["gpt-", "chatgpt-", "codex", "o1", "o3", "o4"].some((prefix) => name.startsWith(prefix));
  if (providerId === "claude-api") return name.startsWith("claude");
  if (providerId === "kimi") return name.startsWith("kimi") || name.startsWith("moonshot");
  return providerId === "vllm";
}

function welcomeWorkMessage(): WorkMessage {
  return {
    id: randomUUID(),
    role: "assistant",
    text: welcomeWorkMessageText,
  };
}

const welcomeWorkMessageText = "Work Mode is ready. Share this tab when you want Locus to read or interact with it.";

function agentWorkMessage(message: { role: string; content: unknown }): WorkMessage | undefined {
  const role = message.role === "user" || message.role === "assistant" || message.role === "system"
    ? message.role
    : undefined;
  if (!role) return undefined;
  const text = agentContentText(message.content).trim();
  if (!text) return undefined;
  return { id: randomUUID(), role, text };
}

function agentContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const value = part as Record<string, unknown>;
    return typeof value.text === "string" ? value.text : typeof value.content === "string" ? value.content : "";
  }).filter(Boolean).join("\n");
}

function conversationTitle(title: string, preview: string): string {
  const value = (title || preview || "New conversation").replace(/\s+/g, " ").trim();
  return value.length > 64 ? `${value.slice(0, 61)}…` : value;
}

function agentRequestError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? `${fallback}: ${error.message}` : `${fallback}.`;
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
