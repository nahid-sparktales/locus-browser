import type { LocusBrowserAPI } from "../preload/index.js";
import type { BrowserCommand } from "../shared/ipc.js";
import type { BrowserAppState } from "../shared/types.js";

const previewParams = new URLSearchParams(window.location.search);
const previewOnboarding = previewParams.has("onboarding");
const previewCredential = previewParams.has("credential");
const previewSync = previewParams.has("sync");
const previewPairing = previewParams.has("pairing");
const previewExtensions = previewParams.has("extensions");
const previewRecording = previewParams.has("recording");

const previewState: BrowserAppState = {
  windowId: "preview",
  profileId: "default",
  privateWindow: false,
  tabs: [
    {
      id: "welcome",
      title: "Google",
      url: "https://www.google.com/",
      active: true,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      audible: false,
      muted: false,
      private: false,
      crashed: false,
      sleeping: false,
      mediaPlaying: false,
      mediaAvailable: false,
      groupId: "locus-projects",
      grants: previewRecording ? [{ sessionId: "preview-session", tabId: "welcome", level: "interact", source: "user_share", grantedAt: "2026-08-23T22:00:00.000Z" }] : [],
    },
    {
      id: "platform",
      title: "Locus Platform",
      url: "https://github.com/nahid-sparktales/locus-platform",
      active: false,
      loading: false,
      canGoBack: true,
      canGoForward: false,
      audible: false,
      muted: false,
      private: false,
      crashed: false,
      sleeping: false,
      mediaPlaying: false,
      mediaAvailable: false,
      groupId: "locus-projects",
      grants: [],
    },
  ],
  groups: [{ id: "locus-projects", name: "Locus projects", color: "lime", collapsed: false, position: 0 }],
  profiles: [{ id: "default", name: "Personal", partitionName: "persist:locus-profile-default", createdAt: 1_787_408_000 }],
  currentProfile: { id: "default", name: "Personal", partitionName: "persist:locus-profile-default", createdAt: 1_787_408_000 },
  activeTabId: "welcome",
  sidebarOpen: true,
  sidebarSection: "tabs",
  bookmarks: [
    { id: "locus", title: "Locus Browser", url: "https://github.com/nahid-sparktales/locus-browser", createdAt: 1_787_408_000, updatedAt: 1_787_408_000 },
  ],
  history: [
    { id: "history-1", title: "Locus Platform", url: "https://github.com/nahid-sparktales/locus-platform", visitedAt: 1_787_408_000 },
  ],
  downloads: [],
  sitePermissions: [],
  ...(previewCredential ? { pendingCredential: { origin: "https://github.com", username: "nahid@example.com", action: "save" as const } } : {}),
  credentialSuggestions: [{ id: "demo-login", username: "nahid@example.com" }],
  savedCredentials: [{ id: "demo-login", origin: "https://github.com", username: "nahid@example.com", updatedAt: 1_787_408_000 }],
  passwordManagerAvailable: true,
  extensions: {
    developerMode: previewExtensions,
    loading: false,
    supportedApiCount: 5,
    trustedGalleryKeyCount: 1,
    message: previewExtensions ? "Developer Mode is on. Unpacked extensions can inspect granted sites." : "Developer Mode is off. Unpacked extensions are not loaded.",
    gallery: {
      status: "ready",
      message: "2 verified extensions available.",
      serviceUrl: "https://gallery.locusbrowser.test",
      refreshedAt: 1_787_408_000,
      entries: [{
        id: "dev.locus.reading-notes",
        name: "Reading Notes",
        version: "1.2.0",
        description: "Save selected passages to your local reading notes.",
        permissions: ["storage"],
        hostPermissions: ["https://*.example.com/*"],
        verifiedPublisher: "4f0d27ac918e",
        packageSize: 18_432,
        action: previewExtensions ? "update" : "install",
        ...(previewExtensions ? { installedVersion: "1.1.0" } : {}),
      }, {
        id: "dev.locus.focus-palette",
        name: "Focus Palette",
        version: "1.0.0",
        description: "Give reading pages a calm Locus-inspired palette.",
        permissions: ["storage"],
        hostPermissions: ["https://example.com/*"],
        verifiedPublisher: "a10c34b911d2",
        packageSize: 12_288,
        action: "install",
      }],
    },
    installs: previewExtensions ? [{
      id: "dev.locus.reading-notes",
      name: "Reading Notes",
      version: "1.1.0",
      description: "Save selected passages to your local reading notes.",
      enabled: true,
      loaded: true,
      source: "gallery",
      installPath: "/Users/nahid/Library/Application Support/Locus Browser/Extension Packages/default/dev.locus.reading-notes/1.1.0",
      permissions: ["storage"],
      hostPermissions: ["https://*.example.com/*"],
      verifiedPublisher: "4f0d27ac918e",
      galleryKeyName: "Locus Canary Gallery",
      rollbackVersion: "1.0.0",
      updatedAt: 1_787_408_000,
    }] : [],
  },
  sync: previewSync
    ? {
        status: "connected", serviceUrl: "https://sync.locusbrowser.test", accountId: "account-preview", deviceId: "macbook-local",
        keyVersion: 2, lastSyncedAt: 1_787_408_000, pendingRecords: 0,
        devices: [
          { deviceId: "macbook-local", name: "Nahid’s MacBook · Personal", current: true, keyVersion: 2, createdAt: 1_786_716_000, lastSeenAt: 1_787_408_000 },
          { deviceId: "ipad-7d3e2a", name: "iPad Pro", current: false, keyVersion: 2, createdAt: 1_786_802_400, lastSeenAt: 1_787_404_400 },
          { deviceId: "studio-19a6", name: "Studio Mac · Work", current: false, keyVersion: 2, createdAt: 1_786_975_200, lastSeenAt: 1_787_322_000 },
        ],
      }
    : previewPairing
      ? {
          status: "waiting-for-approval", serviceUrl: "https://sync.locusbrowser.test", pendingRecords: 0, devices: [],
          pendingEnrollment: {
            pairingCode: "LOCUS-DEVICE:8c44d3a0-68ab-4df7-8a6a-874099243345:Xz7x1Sf-P8gF3dWm2Jk5cQ0n",
            expiresAt: 1_787_408_600,
          },
        }
      : { status: "disconnected", pendingRecords: 0, devices: [] },
  remoteTabs: previewSync ? [{ id: "ipad:tab-1", deviceId: "ipad-7d3e2a", title: "Locus protocol notes", url: "https://example.com/protocol", updatedAt: 1_787_408_000 }] : [],
  onboardingRequired: previewOnboarding,
  settings: {
    appearance: "system", searchEngine: "duckduckgo", sleepAfterMinutes: 30,
    downloadDirectory: "/Users/nahid/Downloads", onboardingComplete: !previewOnboarding,
    speech: { engine: "local", language: "auto", localModelStatus: "ready", message: "On-device transcription is ready" },
  },
  activePageBookmarked: false,
  find: { open: false, query: "", matches: 0, activeMatchOrdinal: 0 },
  zoomFactor: 1,
  workOpen: previewRecording,
  workWidth: 420,
  workOverlay: false,
  searchEngine: "duckduckgo",
  recording: previewRecording ? {
    status: "recording", id: "3b31540d-720a-451b-b9f1-a9c31c3e9811", startedAt: Date.now() - 83_000,
    elapsedMs: 83_000, sources: { tabAudio: true, microphone: true }, saveVideo: false,
    activeTabId: "welcome", engine: "local",
    transcriptPreview: [
      { id: "preview-segment-1", recordingId: "3b31540d-720a-451b-b9f1-a9c31c3e9811", source: "tab", startMs: 12_000, endMs: 15_000, text: "Search the web with Google", tabId: "welcome" },
      { id: "preview-segment-2", recordingId: "3b31540d-720a-451b-b9f1-a9c31c3e9811", source: "microphone", startMs: 61_000, endMs: 64_000, text: "Help me compare the clearest sources", tabId: "welcome" },
    ],
    transcripts: [],
  } : {
    status: "idle", elapsedMs: 0, sources: { tabAudio: true, microphone: true }, saveVideo: false,
    transcriptPreview: [], transcripts: [], engine: "local",
  },
  work: {
    sessionId: "preview-session",
    mode: "work",
    panel: "chat",
    runtime: "online",
    runtimeMessage: "Local agent is ready",
    busy: false,
    messages: [{
      id: "welcome-message",
      role: "assistant",
      text: "Work Mode is ready. Share this tab when you want Locus to read or interact with it.",
    }],
    conversations: [
      { id: "preview-session", title: "Research the current page", preview: "Research the current page", updatedAt: 1_787_408_000, current: true },
      { id: "preview-session-2", title: "Plan a focused browser workflow", preview: "Plan a focused browser workflow", updatedAt: 1_787_321_600, current: false },
    ],
    attachments: [],
    workspace: { name: "locus-browser", path: "/Users/nahid/Documents/locus-browser" },
    model: {
      activeProvider: "openai-api",
      activeModel: "gpt-5.6",
      label: "ChatGPT API · gpt-5.6",
      switching: false,
      message: "Model options are ready",
      providers: [
        { id: "chatgpt-plan", name: "ChatGPT Plan", detail: "Use included ChatGPT subscription usage", mark: "P", configured: false, status: "needs-sign-in", statusMessage: "Sign in required", models: [{ id: "gpt-5.3-codex", name: "gpt-5.3-codex" }] },
        { id: "openai-api", name: "ChatGPT API", detail: "OpenAI API key and usage billing", mark: "O", configured: true, status: "ready", statusMessage: "Key saved on this Mac", models: [{ id: "gpt-5.6", name: "gpt-5.6" }, { id: "gpt-5", name: "gpt-5" }] },
        { id: "kimi", name: "Kimi", detail: "Moonshot API models", mark: "K", configured: false, status: "needs-key", statusMessage: "API key required", models: [{ id: "kimi-k3", name: "kimi-k3" }] },
        { id: "claude-api", name: "Claude API", detail: "Anthropic API key", mark: "C", configured: false, status: "needs-key", statusMessage: "API key required", models: [{ id: "claude-sonnet-5", name: "claude-sonnet-5" }] },
        { id: "vllm", name: "vLLM", detail: "Your OpenAI-compatible endpoint", mark: "V", configured: false, status: "needs-setup", statusMessage: "Endpoint setup required", models: [] },
        { id: "local", name: "Local Models", detail: "Models installed in Ollama", mark: "L", configured: true, status: "ready", statusMessage: "2 installed", models: [{ id: "qwen3.6:27b", name: "qwen3.6:27b", detail: "27.8B" }, { id: "gemma3:12b", name: "gemma3:12b", detail: "12.2B" }] },
      ],
    },
    plan: {
      id: "preview-plan",
      title: "Finish the solo browser workflow",
      summary: "Connect the remaining Work panels to the local runtime and verify recovery.",
      steps: [
        { content: "Wire structured plan and change events", status: "completed" },
        { content: "Add safe workspace file previews", status: "in_progress" },
        { content: "Verify runtime recovery", status: "pending" },
      ],
      tests: ["Refresh a Git workspace", "Restart the local runtime"],
      pendingApproval: false,
    },
    changes: {
      loading: false,
      isRepository: true,
      branch: "main",
      detached: false,
      ahead: 0,
      behind: 0,
      files: [
        { path: "apps/desktop/src/renderer/WorkDock.tsx", status: "modified", staged: false, unstaged: true, untracked: false, binary: false, additions: 42, deletions: 8 },
      ],
    },
    files: {
      loading: false,
      truncated: false,
      entries: [
        { path: "README.md", name: "README.md", size: 5_120, modifiedAt: 1_787_408_000_000 },
        { path: "apps/desktop/src/renderer/WorkDock.tsx", name: "WorkDock.tsx", size: 18_200, modifiedAt: 1_787_408_000_000 },
      ],
    },
    terminal: [
      { id: "preview-tool", tool: "bash", summary: "Run desktop tests", detail: "pnpm test", status: "done", result: "57 tests passed", startedAt: 1_787_408_000_000, finishedAt: 1_787_408_002_000 },
    ],
    recovery: { attempt: 0, retrying: false, canRetry: false },
  },
};

export function installPreviewBridge(): void {
  if (typeof window.locusBrowser !== "undefined") return;
  const listeners = new Set<(state: BrowserAppState) => void>();
  const focusListeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener(structuredClone(previewState));
  };
  const api: LocusBrowserAPI = {
    getState: async () => structuredClone(previewState),
    command: async (value) => {
      applyPreviewCommand(value);
      publish();
      return structuredClone(previewState);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onFocusAddress: (listener) => {
      focusListeners.add(listener);
      return () => focusListeners.delete(listener);
    },
  };
  window.locusBrowser = api;
}

function applyPreviewCommand(command: BrowserCommand): void {
  switch (command.type) {
    case "toggle-sidebar":
      previewState.sidebarOpen = !previewState.sidebarOpen;
      break;
    case "set-sidebar-section":
      previewState.sidebarOpen = true;
      previewState.sidebarSection = command.section;
      break;
    case "toggle-work":
      previewState.workOpen = !previewState.workOpen;
      break;
    case "set-work-panel":
      previewState.work.panel = command.panel;
      break;
    case "set-work-mode":
      previewState.work.mode = command.mode;
      break;
    case "new-work-conversation": {
      const id = `preview-session-${previewState.work.conversations.length + 1}`;
      previewState.work.sessionId = id;
      previewState.work.panel = "chat";
      previewState.work.messages = [{ id: `${id}-welcome`, role: "assistant", text: "Work Mode is ready. Share this tab when you want Locus to read or interact with it." }];
      previewState.work.attachments = [];
      delete previewState.work.plan;
      previewState.work.terminal = [];
      previewState.work.conversations = [
        { id, title: "New conversation", preview: "", updatedAt: Math.floor(Date.now() / 1_000), current: true },
        ...previewState.work.conversations.map((conversation) => ({ ...conversation, current: false })),
      ];
      break;
    }
    case "select-work-conversation":
      previewState.work.sessionId = command.sessionId;
      previewState.work.panel = "chat";
      previewState.work.conversations = previewState.work.conversations.map((conversation) => ({ ...conversation, current: conversation.id === command.sessionId }));
      break;
    case "choose-workspace":
      previewState.work.workspace = { name: "locus-browser", path: "/Users/nahid/Documents/locus-browser" };
      break;
    case "request-work-plan":
      previewState.work.mode = "plan";
      previewState.work.panel = "chat";
      break;
    case "approve-work-plan":
      if (previewState.work.plan) previewState.work.plan.pendingApproval = false;
      previewState.work.mode = "build";
      previewState.work.panel = "chat";
      break;
    case "revise-work-plan":
      if (previewState.work.plan) previewState.work.plan.pendingApproval = false;
      previewState.work.mode = "plan";
      previewState.work.panel = "chat";
      break;
    case "refresh-work-changes":
    case "refresh-work-files":
      break;
    case "select-work-change":
      previewState.work.changes.selectedPath = command.path;
      previewState.work.changes.selectedStaged = command.staged ?? false;
      previewState.work.changes.diff = "@@ -1,2 +1,3 @@\n import React from \"react\";\n+import { FileDiff } from \"lucide-react\";";
      break;
    case "select-work-file":
      previewState.work.files.selectedPath = command.path;
      previewState.work.files.content = command.path.endsWith("README.md") ? "# Locus Browser\n\nA browser-first sibling to Locus." : "export function WorkDock() {\n  return <div />;\n}";
      break;
    case "clear-work-terminal":
      previewState.work.terminal = [];
      break;
    case "restart-work-runtime":
      previewState.work.runtime = "online";
      previewState.work.runtimeMessage = "Conversation recovered";
      previewState.work.recovery = { attempt: 0, retrying: false, canRetry: false };
      break;
    case "choose-work-attachments":
      previewState.work.attachments = [...previewState.work.attachments, {
        id: "11111111-1111-4111-8111-111111111111",
        name: "browser-reference.png",
        mimeType: "image/png",
        size: 248_320,
      }];
      break;
    case "remove-work-attachment":
      previewState.work.attachments = previewState.work.attachments.filter((attachment) => attachment.id !== command.attachmentId);
      break;
    case "configure-work-provider":
    case "select-work-model": {
      const provider = previewState.work.model.providers.find((item) => item.id === command.providerId);
      if (provider) {
        provider.configured = true;
        provider.status = "ready";
        provider.statusMessage = command.providerId === "vllm" ? "Endpoint saved on this Mac" : "Key saved on this Mac";
        if (!provider.models.some((model) => model.id === command.model)) provider.models.unshift({ id: command.model, name: command.model });
        if (command.type === "configure-work-provider" && command.baseUrl) provider.baseUrl = command.baseUrl;
        previewState.work.model.activeProvider = command.providerId;
        previewState.work.model.activeModel = command.model;
        previewState.work.model.label = `${provider.name} · ${command.model}`;
      }
      break;
    }
    case "start-chatgpt-login": {
      const provider = previewState.work.model.providers.find((item) => item.id === "chatgpt-plan");
      if (provider) {
        provider.status = "signing-in";
        provider.statusMessage = "Finish sign-in in your browser";
      }
      break;
    }
    case "sign-out-chatgpt": {
      const provider = previewState.work.model.providers.find((item) => item.id === "chatgpt-plan");
      if (provider) {
        provider.configured = false;
        provider.status = "needs-sign-in";
        provider.statusMessage = "Sign in required";
      }
      break;
    }
    case "refresh-work-models":
      previewState.work.model.message = "Model options refreshed";
      break;
    case "toggle-bookmark":
      previewState.activePageBookmarked = !previewState.activePageBookmarked;
      previewState.bookmarks = previewState.activePageBookmarked ? [{
        id: "locus",
        title: "Locus Browser",
        url: "https://github.com/nahid-sparktales/locus-browser",
        createdAt: 1_787_408_000,
        updatedAt: 1_787_408_000,
      }] : [];
      break;
    case "toggle-find":
      previewState.find.open = !previewState.find.open;
      break;
    case "find-in-page":
      previewState.find = { open: true, query: command.query, matches: command.query ? 3 : 0, activeMatchOrdinal: command.query ? 1 : 0 };
      break;
    case "close-find":
      previewState.find = { open: false, query: "", matches: 0, activeMatchOrdinal: 0 };
      break;
    case "zoom-in":
      previewState.zoomFactor = Math.min(previewState.zoomFactor + 0.1, 2);
      break;
    case "zoom-out":
      previewState.zoomFactor = Math.max(previewState.zoomFactor - 0.1, 0.5);
      break;
    case "zoom-reset":
      previewState.zoomFactor = 1;
      break;
    case "select-tab":
      previewState.activeTabId = command.tabId;
      previewState.tabs = previewState.tabs.map((tab) => ({ ...tab, active: tab.id === command.tabId }));
      break;
    case "new-private-window":
      previewState.privateWindow = true;
      previewState.workOpen = false;
      previewState.history = [];
      previewState.tabs = previewState.tabs.map((tab) => ({ ...tab, private: true, grants: [] }));
      break;
    case "create-tab-group": {
      const id = `group-${previewState.groups.length + 1}`;
      previewState.groups.push({ id, name: `Group ${previewState.groups.length + 1}`, color: "blue", collapsed: false, position: previewState.groups.length });
      previewState.tabs = previewState.tabs.map((tab) => tab.id === command.tabId ? { ...tab, groupId: id } : tab);
      break;
    }
    case "toggle-tab-group":
      previewState.groups = previewState.groups.map((group) => group.id === command.groupId ? { ...group, collapsed: !group.collapsed } : group);
      break;
    case "rename-tab-group":
      previewState.groups = previewState.groups.map((group) => group.id === command.groupId ? { ...group, name: command.name } : group);
      break;
    case "set-tab-group":
      previewState.tabs = previewState.tabs.map((tab) => {
        if (tab.id !== command.tabId) return tab;
        const { groupId: _groupId, ...withoutGroup } = tab;
        return command.groupId ? { ...withoutGroup, groupId: command.groupId } : withoutGroup;
      });
      break;
    case "sleep-tab":
      previewState.tabs = previewState.tabs.map((tab) => tab.id === command.tabId ? { ...tab, sleeping: true } : tab);
      break;
    case "set-appearance":
      previewState.settings.appearance = command.appearance;
      break;
    case "set-search-engine":
      previewState.settings.searchEngine = command.searchEngine;
      previewState.searchEngine = command.searchEngine;
      break;
    case "set-sleep-after":
      previewState.settings.sleepAfterMinutes = command.minutes;
      break;
    case "set-extension-developer-mode":
      previewState.extensions.developerMode = command.enabled;
      previewState.extensions.message = command.enabled ? "Developer Mode is on. Unpacked extensions can inspect granted sites." : "Developer Mode is off. Unpacked extensions are not loaded.";
      previewState.extensions.installs = previewState.extensions.installs.map((extension) => ({ ...extension, loaded: command.enabled && extension.enabled }));
      break;
    case "install-unpacked-extension":
      previewState.extensions.installs = [...previewState.extensions.installs, {
        id: "preview-extension", name: "Reading Notes", version: "1.0.0", description: "Save selected passages to your local reading notes.",
        enabled: true, loaded: true, source: "developer", installPath: "/Users/nahid/Developer/reading-notes",
        permissions: ["storage"], hostPermissions: ["https://*.example.com/*"], updatedAt: Math.floor(Date.now() / 1_000),
      }];
      break;
    case "install-signed-extension":
      previewState.extensions.installs = [{
        id: "dev.locus.reading-notes", name: "Reading Notes", version: "1.1.0", description: "Save selected passages to your local reading notes.",
        enabled: true, loaded: true, source: "gallery", installPath: "/managed/dev.locus.reading-notes/1.1.0", permissions: ["storage"], hostPermissions: ["https://*.example.com/*"],
        verifiedPublisher: "4f0d27ac918e", galleryKeyName: "Locus Canary Gallery", rollbackVersion: "1.0.0", updatedAt: Math.floor(Date.now() / 1_000),
      }];
      break;
    case "refresh-extension-gallery":
      if (previewState.extensions.gallery) {
        previewState.extensions.gallery.status = "ready";
        previewState.extensions.gallery.message = `${previewState.extensions.gallery.entries.length} verified extensions available.`;
        previewState.extensions.gallery.refreshedAt = Math.floor(Date.now() / 1_000);
      }
      break;
    case "install-gallery-extension": {
      const entry = previewState.extensions.gallery?.entries.find((extension) => extension.id === command.extensionId);
      if (entry) {
        previewState.extensions.installs = [
          ...previewState.extensions.installs.filter((extension) => extension.id !== entry.id),
          {
            id: entry.id, name: entry.name, version: entry.version, ...(entry.description ? { description: entry.description } : {}),
            enabled: true, loaded: true, source: "gallery", installPath: `/managed/${entry.id}/${entry.version}`,
            permissions: entry.permissions, hostPermissions: entry.hostPermissions, verifiedPublisher: entry.verifiedPublisher,
            galleryKeyName: "Locus Canary Gallery", updatedAt: Math.floor(Date.now() / 1_000),
          },
        ];
        entry.action = "installed";
        entry.installedVersion = entry.version;
      }
      break;
    }
    case "set-extension-enabled":
      previewState.extensions.installs = previewState.extensions.installs.map((extension) => extension.id === command.extensionId ? { ...extension, enabled: command.enabled, loaded: command.enabled } : extension);
      break;
    case "rollback-extension":
      previewState.extensions.installs = previewState.extensions.installs.map((extension) => extension.id === command.extensionId
        ? { ...extension, version: extension.rollbackVersion ?? extension.version, rollbackVersion: extension.version }
        : extension);
      break;
    case "remove-extension":
      previewState.extensions.installs = previewState.extensions.installs.filter((extension) => extension.id !== command.extensionId);
      break;
    case "delete-profile":
      previewState.profiles = previewState.profiles.filter((profile) => profile.id !== command.profileId);
      break;
    case "complete-onboarding":
      previewState.settings = {
        ...previewState.settings,
        searchEngine: command.searchEngine,
        appearance: command.appearance,
        sleepAfterMinutes: command.sleepAfterMinutes,
        onboardingComplete: true,
      };
      previewState.searchEngine = command.searchEngine;
      previewState.onboardingRequired = false;
      break;
    case "dismiss-pending-credential":
    case "save-pending-credential":
      delete previewState.pendingCredential;
      break;
    case "delete-credential":
      previewState.savedCredentials = previewState.savedCredentials.filter((credential) => credential.id !== command.credentialId);
      previewState.credentialSuggestions = previewState.credentialSuggestions.filter((credential) => credential.id !== command.credentialId);
      break;
    case "begin-sync-registration":
    case "begin-sync-sign-in":
      previewState.sync = { status: "connecting", serviceUrl: command.serviceUrl, pendingRecords: 0, devices: [] };
      break;
    case "begin-sync-device-enrollment":
      previewState.sync = {
        status: "waiting-for-approval", serviceUrl: command.serviceUrl, pendingRecords: 0, devices: [],
        pendingEnrollment: {
          pairingCode: "LOCUS-DEVICE:8c44d3a0-68ab-4df7-8a6a-874099243345:Xz7x1Sf-P8gF3dWm2Jk5cQ0n",
          expiresAt: Math.floor(Date.now() / 1_000) + 600,
        },
      };
      break;
    case "cancel-sync-device-enrollment":
      previewState.sync = { status: "disconnected", pendingRecords: 0, devices: [] };
      break;
    case "revoke-sync-device":
      previewState.sync.devices = previewState.sync.devices.filter((device) => device.deviceId !== command.deviceId);
      break;
    case "approve-sync-device":
      previewState.sync.devices = [...previewState.sync.devices, {
        deviceId: "new-device-preview",
        name: "New Mac · Personal",
        current: false,
        keyVersion: previewState.sync.keyVersion ?? 1,
        createdAt: Math.floor(Date.now() / 1_000),
        lastSeenAt: Math.floor(Date.now() / 1_000),
      }];
      break;
    case "rotate-sync-recovery-key": {
      const keyVersion = (previewState.sync.keyVersion ?? 1) + 1;
      previewState.sync = {
        ...previewState.sync,
        keyVersion,
        devices: previewState.sync.devices.map((device) => ({ ...device, keyVersion })),
      };
      break;
    }
    case "sync-now":
      if (previewState.sync.accountId) previewState.sync = { ...previewState.sync, status: "syncing" };
      break;
    case "disconnect-sync":
    case "delete-sync-account":
      previewState.sync = { status: "disconnected", pendingRecords: 0, devices: [] };
      previewState.remoteTabs = [];
      break;
    default:
      break;
  }
}
