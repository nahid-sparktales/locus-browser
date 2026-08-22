import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  BrowserWindow,
  WebContentsView,
  app,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
  type Rectangle,
} from "electron";
import {
  BrowserActionRequestSchema,
  type BrowserActionRequest,
  type BrowserActionResult,
} from "@locus/protocol";
import { bridgeInvocation, browserBridgeSource } from "@locus/browser-bridge";
import { BrowserCommandSchema, ipcChannels, type BrowserCommand } from "../shared/ipc.js";
import type {
  BrowserAppState,
  BrowserTabState,
  PendingPermission,
  WorkMessage,
} from "../shared/types.js";
import { AgentRuntime, type AgentEvent } from "./AgentRuntime.js";
import { BrowserDatabase, type StoredTab } from "./BrowserDatabase.js";
import { TabAccessRegistry } from "./TabAccessRegistry.js";

const CHROME_HEIGHT = 92;
const SIDEBAR_WIDTH = 248;
const MIN_PAGE_SPLIT = 640;
const MIN_PAGE_EXPANDED = 520;
const WORK_MIN = 360;
const WORK_DEFAULT = 420;
const WORK_MAX = 720;
const AGENT_DOWNLOAD_CAP = 25 * 1024 * 1024;
const BRIDGE_WORLD = 99_941;

interface TabRecord {
  state: BrowserTabState;
  view: WebContentsView;
  console: string[];
  network: string[];
  sessionCreatedBy: string | undefined;
  agentDownloadArmedUntil: number;
}

interface BrowserPermissionWaiter {
  resolve: (decision: "allow" | "always" | "deny") => void;
}

export class BrowserController {
  readonly window: BrowserWindow;
  readonly #windowId = "primary";
  readonly #profileId = "default";
  readonly #database: BrowserDatabase;
  readonly #grants = new TabAccessRegistry();
  readonly #tabs = new Map<string, TabRecord>();
  readonly #runtime: AgentRuntime;
  readonly #permissionWaiters = new Map<string, BrowserPermissionWaiter>();
  readonly #hardenedSessions = new WeakSet<Electron.Session>();
  #sessionId: string = randomUUID();
  #workView: WebContentsView | undefined;
  #activeTabId: string | undefined;
  #sidebarOpen = false;
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
  #saveTimer: NodeJS.Timeout | undefined;

  constructor(rendererUrl: string, preloadPath: string, platformRoot: string) {
    this.#database = new BrowserDatabase(join(app.getPath("userData"), "browser.sqlite3"));
    this.#runtime = new AgentRuntime(platformRoot, join(app.getPath("userData"), "agent"));
    const stored = this.#database.loadWindow(this.#windowId);
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
      backgroundColor: "#f6f6f4",
      show: false,
      webPreferences: trustedRendererPreferences(preloadPath),
    });
    this.window.loadURL(surfaceUrl(rendererUrl, "shell"));
    this.window.once("ready-to-show", () => this.window.show());
    this.window.on("resize", () => this.#layout(false));
    this.window.on("close", () => this.#persistNow());
    this.window.on("closed", () => this.dispose());

    this.#configureProfileSession();
    this.#restoreTabs();
    this.#createWorkView(rendererUrl, preloadPath);
    this.#bindRuntime();
    this.#installIpc();
    this.#layout(false);
    void this.#runtime.start();
  }

  state(): BrowserAppState {
    return {
      windowId: this.#windowId,
      profileId: this.#profileId,
      tabs: [...this.#tabs.values()].map((tab) => ({
        ...tab.state,
        active: tab.state.id === this.#activeTabId,
        grants: this.#grants.grantsForTab(tab.state.id),
      })),
      ...(this.#activeTabId ? { activeTabId: this.#activeTabId } : {}),
      sidebarOpen: this.#sidebarOpen,
      workOpen: this.#workOpen,
      workWidth: this.#workWidth,
      workOverlay: this.#workOverlay,
      searchEngine: "duckduckgo",
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

  async command(command: BrowserCommand): Promise<BrowserAppState> {
    switch (command.type) {
      case "new-tab":
        this.#createTab(command.url ?? "https://duckduckgo.com/", { active: true });
        break;
      case "select-tab":
        this.#selectTab(command.tabId);
        break;
      case "close-tab":
        this.#closeTab(command.tabId);
        break;
      case "reorder-tab":
        this.#reorderTab(command.tabId, command.beforeTabId);
        break;
      case "navigate":
        await this.#navigateActive(command.value);
        break;
      case "back":
        this.#active()?.view.webContents.navigationHistory.goBack();
        break;
      case "forward":
        this.#active()?.view.webContents.navigationHistory.goForward();
        break;
      case "reload":
        this.#active()?.view.webContents.reload();
        break;
      case "stop":
        this.#active()?.view.webContents.stop();
        break;
      case "toggle-sidebar":
        this.#sidebarOpen = !this.#sidebarOpen;
        this.#layout(true);
        break;
      case "toggle-work":
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
    clearTimeout(this.#saveTimer);
    this.#persistNow();
    this.#runtime.stop();
    this.#grants.revokeSession(this.#sessionId);
    for (const tab of this.#tabs.values()) tab.view.webContents.close();
    this.#tabs.clear();
    this.#workView?.webContents.close();
    this.#workView = undefined;
    this.#database.close();
    ipcMain.removeHandler(ipcChannels.getState);
    ipcMain.removeHandler(ipcChannels.command);
  }

  #installIpc(): void {
    ipcMain.handle(ipcChannels.getState, (event) => {
      this.#assertTrustedSender(event);
      return this.state();
    });
    ipcMain.handle(ipcChannels.command, async (event, raw) => {
      this.#assertTrustedSender(event);
      return await this.command(BrowserCommandSchema.parse(raw));
    });
  }

  #assertTrustedSender(event: IpcMainInvokeEvent): void {
    const allowed = new Set([
      this.window.webContents.id,
      this.#workView?.webContents.id,
    ]);
    if (!allowed.has(event.sender.id)) throw new Error("Untrusted IPC sender");
  }

  #createWorkView(rendererUrl: string, preloadPath: string): void {
    const view = new WebContentsView({ webPreferences: trustedRendererPreferences(preloadPath) });
    view.setBackgroundColor("#f6f6f4");
    view.webContents.loadURL(surfaceUrl(rendererUrl, "work"));
    this.#workView = view;
    this.window.contentView.addChildView(view);
    view.setVisible(this.#workOpen);
  }

  #restoreTabs(): void {
    const tabs = this.#database.loadTabs(this.#windowId);
    if (tabs.length === 0) {
      this.#createTab("https://duckduckgo.com/", { active: true });
      return;
    }
    for (const stored of tabs) {
      this.#createTab(safeRestoreUrl(stored.url), {
        id: stored.id,
        active: Boolean(stored.active),
        title: stored.title,
        private: Boolean(stored.private),
      });
    }
    if (!this.#activeTabId) this.#selectTab(tabs[0]!.id);
  }

  #createTab(
    rawUrl: string,
    options: { id?: string; active?: boolean; title?: string; private?: boolean; sessionId?: string } = {},
  ): TabRecord {
    const id = options.id ?? randomUUID();
    const privateTab = Boolean(options.private);
    const partition = privateTab
      ? `locus-private-${this.window.id}`
      : "persist:locus-profile-default";
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
    this.#hardenSession(view.webContents.session);
    view.setBackgroundColor("#ffffff");
    const record: TabRecord = {
      view,
      console: [],
      network: [],
      sessionCreatedBy: options.sessionId,
      agentDownloadArmedUntil: 0,
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
        grants: [],
      },
    };
    this.#tabs.set(id, record);
    this.window.contentView.addChildView(view, 0);
    view.setVisible(false);
    this.#wireTab(record);
    if (options.sessionId) {
      this.#grants.grant(options.sessionId, id, "interact", "agent_created");
    }
    void view.webContents.loadURL(normalizeNavigation(rawUrl));
    if (options.active !== false) this.#selectTab(id);
    this.#broadcast();
    return record;
  }

  #wireTab(tab: TabRecord): void {
    const contents = tab.view.webContents;
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
    contents.on("did-start-loading", update);
    contents.on("did-stop-loading", update);
    contents.on("did-navigate", update);
    contents.on("did-navigate-in-page", update);
    contents.on("page-title-updated", update);
    contents.on("media-started-playing", update);
    contents.on("media-paused", update);
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
      if (isAllowedPageUrl(details.url)) this.#createTab(details.url, { active: true });
      return { action: "deny" };
    });
    contents.on("will-navigate", (details) => {
      const url = (details as unknown as { url: string }).url;
      if (!isAllowedPageUrl(url)) details.preventDefault();
    });
    contents.on("did-finish-load", () => {
      this.#database.recordVisit(tab.state.id, contents.getURL(), contents.getTitle());
    });
    void this.#enableNetworkCapture(tab);
  }

  async #enableNetworkCapture(tab: TabRecord): Promise<void> {
    try {
      if (!tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.attach("1.3");
      await tab.view.webContents.debugger.sendCommand("Network.enable");
      tab.view.webContents.debugger.on("message", (_event, method, params) => {
        if (method === "Network.responseReceived") {
          const response = (params as { response?: { status?: number; url?: string; mimeType?: string } }).response;
          if (response) pushBounded(tab.network, `${response.status ?? 0} ${response.url ?? ""} ${response.mimeType ?? ""}`);
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
    this.window.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    this.#tabs.delete(id);
    this.#grants.revoke(this.#sessionId, id);
    if (this.#activeTabId === id) {
      this.#activeTabId = undefined;
      const next = ids[index + 1] ?? ids[index - 1];
      if (next && this.#tabs.has(next)) this.#selectTab(next);
      else this.#createTab("https://duckduckgo.com/", { active: true });
    }
    this.#layout(false);
  }

  #selectTab(id: string): void {
    const selected = this.#tabs.get(id);
    if (!selected) return;
    for (const tab of this.#tabs.values()) tab.view.setVisible(false);
    this.#activeTabId = id;
    selected.view.setVisible(true);
    this.window.contentView.removeChildView(selected.view);
    this.window.contentView.addChildView(selected.view);
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
    tab.state.crashed = false;
    await tab.view.webContents.loadURL(normalizeNavigation(value));
  }

  #active(): TabRecord | undefined {
    return this.#activeTabId ? this.#tabs.get(this.#activeTabId) : undefined;
  }

  #layout(animate: boolean): void {
    if (this.window.isDestroyed()) return;
    const [width = 1, height = 1] = this.window.getContentSize();
    const left = this.#sidebarOpen ? SIDEBAR_WIDTH : 0;
    const availableWidth = Math.max(width - left, 1);
    const targetWork = clamp(this.#workWidth, WORK_MIN, this.#maximumWorkWidth());
    this.#workWidth = targetWork;
    this.#workOverlay = this.#workOpen && availableWidth - targetWork < MIN_PAGE_SPLIT;
    const pageWidth = this.#workOpen && !this.#workOverlay
      ? Math.max(availableWidth - targetWork, MIN_PAGE_EXPANDED)
      : availableWidth;
    const pageBounds = { x: left, y: CHROME_HEIGHT, width: pageWidth, height: Math.max(height - CHROME_HEIGHT, 1) };
    this.#active()?.view.setBounds(pageBounds);

    const openBounds = {
      x: width - targetWork,
      y: CHROME_HEIGHT,
      width: targetWork,
      height: Math.max(height - CHROME_HEIGHT, 1),
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

  #broadcast(): void {
    const state = this.state();
    if (!this.window.isDestroyed()) this.window.webContents.send(ipcChannels.state, state);
    const workContents = this.#workView?.webContents;
    if (workContents && !workContents.isDestroyed()) workContents.send(ipcChannels.state, state);
  }

  #scheduleSave(): void {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.#persistNow(), 150);
  }

  #persistNow(): void {
    if (!this.#database) return;
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
      }));
    this.#database.saveWindow({
      id: this.#windowId,
      profileId: this.#profileId,
      sidebarOpen: this.#sidebarOpen,
      workOpen: this.#workOpen,
      workWidth: this.#workWidth,
    }, storedTabs);
  }

  #configureProfileSession(): void {
    this.#hardenSession(session.fromPartition("persist:locus-profile-default"));
  }

  #hardenSession(browserSession: Electron.Session): void {
    if (this.#hardenedSessions.has(browserSession)) return;
    this.#hardenedSessions.add(browserSession);
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browserSession.on("will-download", (_event, item, contents) => {
      const tab = [...this.#tabs.values()].find((candidate) => candidate.view.webContents.id === contents.id);
      const agentInitiated = Boolean(tab && tab.agentDownloadArmedUntil > Date.now());
      if (agentInitiated) {
        const safeName = item.getFilename().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "download";
        item.setSavePath(join(app.getPath("userData"), "Agent Downloads", `${randomUUID()}-${safeName}`));
        item.on("updated", () => {
          if (item.getReceivedBytes() > AGENT_DOWNLOAD_CAP) item.cancel();
        });
      }
    });
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
    const contents = tab.view.webContents;

    switch (request.tool) {
      case "browser_navigate": {
        const action = stringArg(args, "url");
        if (!action) throw new Error("'url' is required");
        if (action === "back") contents.navigationHistory.goBack();
        else if (action === "forward") contents.navigationHistory.goForward();
        else if (action === "reload") contents.reload();
        else await contents.loadURL(normalizeNavigation(action));
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
    return await tab.view.webContents.executeJavaScriptInIsolatedWorld(BRIDGE_WORLD, [
      { code: `${browserBridgeSource}\n${invocation}` },
    ]);
  }

  async #browserInput(tab: TabRecord, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const action = (stringArg(args, "action") || "click").toLowerCase();
    const contents = tab.view.webContents;
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
      const x = numberArg(args, "x") ?? tab.view.getBounds().width / 2;
      const y = numberArg(args, "y") ?? tab.view.getBounds().height / 2;
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

function normalizeNavigation(value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed === "about:blank") return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(trimmed) && !trimmed.includes(" ")) return `https://${trimmed}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
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
