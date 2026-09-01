import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bookmark, Bot, Check, ChevronDown,
  CircleAlert, Clock3, Copy, Database, Download, ExternalLink, EyeOff, FileDown, Globe2, History,
  KeyRound, Laptop, Layers3, LayoutList, LockKeyhole, Minus, Monitor, Moon, MoreHorizontal, PanelLeft,
  BookOpenText, Columns2, Command as CommandIcon, LibraryBig, Mic, Pause, Play, Plus, Printer, RefreshCw, Search, Settings, ShieldCheck,
  Sparkles, Square, Sun, Trash2, UserRound, UsersRound, Video, Volume2, VolumeX, X,
} from "lucide-react";
import type { BrowserCommand } from "../shared/ipc.js";
import type { SettingsPageId } from "../shared/settings.js";
import type { Appearance, BrowserTabState, PaletteResultState, ResearchBoardState, SearchEngine, SemanticRecallResultState, ShellState as BrowserAppState, SidebarSection, TabStewardPreviewState } from "../shared/types.js";
import { accentCssVariables } from "../shared/accent.js";
import { useShellState } from "./useSurfaceState.js";
import { SettingsSurface } from "./SettingsSurface.js";
import { resolveSessionSettingsPage } from "./settingsCatalog.js";

const searchProviders: Array<{ id: SearchEngine; name: string; detail: string; mark: string }> = [
  { id: "duckduckgo", name: "DuckDuckGo", detail: "Privacy-focused", mark: "D" },
  { id: "brave", name: "Brave Search", detail: "Independent index", mark: "B" },
  { id: "google", name: "Google", detail: "Familiar results", mark: "G" },
  { id: "bing", name: "Bing", detail: "Microsoft search", mark: "B" },
];

export function Shell() {
  const state = useShellState();
  const [address, setAddress] = useState("");
  const [addressFocused, setAddressFocused] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordMenuOpen, setPasswordMenuOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPageId>("general");
  const addressRef = useRef<HTMLInputElement>(null);
  const active = state?.tabs.find((tab) => tab.id === state.activeTabId);

  useEffect(() => {
    if (state?.internalSurface?.type === "settings") setSettingsPage((current) => resolveSessionSettingsPage(current, state.internalSurface?.type === "settings" ? state.internalSurface.page : undefined));
  }, [state?.internalSurface]);

  useEffect(() => {
    if (!addressFocused) setAddress(state?.internalSurface?.type === "settings" ? "locus://settings" : state?.internalSurface?.type === "research" ? `locus://research/${state.internalSurface.boardId || "new"}` : state?.internalSurface?.type === "tab-steward" ? "locus://tabs/steward" : active?.url === "about:blank" ? "" : active?.url ?? "");
  }, [active?.url, addressFocused, state?.internalSurface]);

  useEffect(() => window.locusBrowser.onFocusAddress(() => {
    addressRef.current?.focus();
    addressRef.current?.select();
  }), []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => void command({ type: "set-reduced-motion", enabled: query.matches });
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!profileOpen && !menuOpen && !passwordMenuOpen && !recordOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".toolbar-popover-wrap")) {
        setProfileOpen(false);
        setMenuOpen(false);
        setPasswordMenuOpen(false);
        setRecordOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileOpen(false);
        setMenuOpen(false);
        setPasswordMenuOpen(false);
        setRecordOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen, passwordMenuOpen, profileOpen, recordOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        void command({ type: state?.paletteOpen ? "close-command-palette" : "open-command-palette" });
      } else if (event.key === "Escape" && state?.paletteOpen) {
        event.preventDefault(); void command({ type: "close-command-palette" });
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [state?.paletteOpen]);

  if (!state) return <LoadingSurface />;
  if (state.onboardingRequired) return <OnboardingSurface state={state} />;

  const sharedGrant = state.settingsOpen ? undefined : active?.grants.find((grant) => grant.sessionId === state.work.sessionId);
  const workTone = state.work.pendingPermission ? "attention" : state.work.busy ? "working" : "idle";
  const chromeHeight = 92
    + (state.find.open ? 38 : 0)
    + (state.pendingSitePermission ? 46 : 0)
    + (state.pendingCredential ? 46 : 0);
  const visibleTabs = state.tabs.filter((tab) => {
    const group = tab.groupId ? state.groups.find((candidate) => candidate.id === tab.groupId) : undefined;
    return !group?.collapsed || tab.active;
  });
  const navigate = (event: React.FormEvent) => {
    event.preventDefault();
    if (address.trim()) void command({ type: "navigate", value: address });
    addressRef.current?.blur();
  };

  return (
    <div
      className={`browser-shell theme-${state.settings.appearance} ${state.privateWindow ? "private-window" : ""}`}
      style={accentCssVariables(state.settings.accent) as React.CSSProperties}
    >
      <header className={`browser-chrome ${state.find.open ? "find-open" : ""} ${state.pendingSitePermission ? "permission-open" : ""}`} style={{ height: chromeHeight }}>
        <div className="tab-row">
          <div className="traffic-light-space" aria-hidden="true" />
          <div className="tab-strip" role="tablist" aria-label="Browser tabs">
            {visibleTabs.map((tab) => {
              const groupColor = state.groups.find((group) => group.id === tab.groupId)?.color;
              return <TabItem key={tab.id} tab={state.settingsOpen && tab.active ? { ...tab, active: false } : tab} {...(groupColor ? { groupColor } : {})} />;
            })}
            {state.settingsOpen ? <SettingsTab /> : null}
            <button className="chrome-button new-tab" title="New tab (⌘T)" onClick={() => void command({ type: "new-tab" })}>
              <Plus size={15} strokeWidth={2.2} />
            </button>
          </div>
          {state.privateWindow && <div className="private-title"><EyeOff size={13} /> Private</div>}
          <div className="window-drag-fill" />
        </div>

        <div className="toolbar">
          <button className={`chrome-button ${state.sidebarOpen ? "selected" : ""}`} title="Browser sidebar" onClick={() => void command({ type: "toggle-sidebar" })}>
            <PanelLeft size={17} />
          </button>
          <div className="nav-controls">
            <button className="chrome-button" title="Back" disabled={!state.settingsOpen && !active?.canGoBack} onClick={() => void command({ type: "back" })}><ArrowLeft size={17} /></button>
            <button className="chrome-button" title="Forward" disabled={state.settingsOpen || !active?.canGoForward} onClick={() => void command({ type: "forward" })}><ArrowRight size={17} /></button>
            <button className="chrome-button" title={active?.loading ? "Stop" : "Reload"} disabled={state.settingsOpen} onClick={() => void command({ type: active?.loading ? "stop" : "reload" })}>
              {active?.loading ? <Square size={12} fill="currentColor" /> : <RefreshCw size={15} />}
            </button>
          </div>

          <form className={`omnibox ${addressFocused ? "focused" : ""}`} onSubmit={navigate}>
            <span className="site-security" title={state.settingsOpen ? "Locus Browser settings" : state.privateWindow ? "Private window" : active?.url.startsWith("https:") ? "Secure connection" : "Page information"}>
              {state.settingsOpen ? <Settings size={14} /> : state.privateWindow ? <EyeOff size={14} /> : active?.url.startsWith("https:") ? <LockKeyhole size={13} /> : <Globe2 size={14} />}
            </span>
            <input ref={addressRef} value={address} aria-label="Address and search" placeholder="Search or enter a web address" spellCheck={false}
              onFocus={(event) => { setAddressFocused(true); event.currentTarget.select(); }}
              onBlur={() => setAddressFocused(false)} onChange={(event) => setAddress(event.target.value)} />
            {addressFocused ? <Search className="omnibox-search" size={14} /> : state.settingsOpen ? null : (
              <button type="button" className={`omnibox-action ${state.activePageBookmarked ? "bookmarked" : ""}`}
                title={state.activePageBookmarked ? "Remove bookmark" : "Bookmark this page"}
                onClick={() => void command({ type: "toggle-bookmark" })}>
                <Bookmark size={14} fill={state.activePageBookmarked ? "currentColor" : "none"} />
              </button>
            )}
          </form>

          <button className={`chrome-button ${state.splitView.enabled ? "selected" : ""}`} title="Two-page Split View" onClick={() => void command({ type: "toggle-split-view" })}><Columns2 size={16} /></button>
          {state.splitView.enabled ? <div className="split-toolbar" aria-label="Split View controls">
            {(["primary", "secondary"] as const).map((pane) => <button key={pane} className={state.splitView.focusedPane === pane ? "active" : ""} onClick={() => void command({ type: "focus-pane", pane })} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const tabId = event.dataTransfer.getData("text/locus-tab"); if (tabId) void command({ type: "assign-tab-to-pane", tabId, pane }); }}>{pane === "primary" ? "L" : "R"}</button>)}
            <input type="range" min="0.3" max="0.7" step="0.01" value={state.splitView.ratio} onChange={(event) => void command({ type: "set-split-ratio", ratio: Number(event.target.value) })} aria-label="Split View divider" />
          </div> : null}
          <button className={`chrome-button ${state.reader.active ? "selected" : ""}`} disabled={!state.reader.available && !state.reader.active || state.settingsOpen} title={state.reader.message || "Reader Mode with Read Aloud"} onClick={() => void command({ type: "toggle-reader" })}><BookOpenText size={16} /></button>
          {!state.privateWindow ? <button className="chrome-button steward-button" title="AI Tab Steward" onClick={() => void command({ type: "open-tab-steward" })}><Layers3 size={16} />{state.tabSteward.suggestionCount ? <span>{state.tabSteward.suggestionCount}</span> : null}</button> : null}
          <button className={`chrome-button ${state.paletteOpen ? "selected" : ""}`} title="Command Palette (⌘K)" onClick={() => void command({ type: "open-command-palette" })}><CommandIcon size={16} /></button>

          {state.credentialSuggestions.length > 0 && (
            <div className="toolbar-popover-wrap">
              <button className={`chrome-button password-button ${passwordMenuOpen ? "selected" : ""}`} title="Saved logins"
                onClick={() => { setPasswordMenuOpen((open) => !open); setProfileOpen(false); setMenuOpen(false); setRecordOpen(false); }}>
                <KeyRound size={15} />
              </button>
              {passwordMenuOpen && <PasswordMenu state={state} close={() => setPasswordMenuOpen(false)} />}
            </div>
          )}

          {sharedGrant && (
            <button className="access-pill" title="Revoke Locus access" onClick={() => void command({ type: "revoke-active-tab" })}>
              <ShieldCheck size={14} /><span>{sharedGrant.level === "interact" ? "Locus controls" : "Shared"}</span><X size={12} />
            </button>
          )}
          {active?.mediaAvailable && (
            <button className="chrome-button" title={active.mediaPlaying ? "Pause media" : "Resume media"} onClick={() => void command({ type: "toggle-media-playback" })}>
              {active.mediaPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>
          )}
          {(active?.audible || active?.muted) && (
            <button className="chrome-button" title={active.muted ? "Unmute tab" : "Mute tab"} onClick={() => void command({ type: "toggle-tab-mute", tabId: active.id })}>
              {active.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          )}
          <button className="chrome-button download-button" title="Downloads" onClick={() => void command({ type: "set-sidebar-section", section: "downloads" })}>
            <Download size={16} />
            {state.downloads.some((download) => download.state === "progressing") && <span className="download-dot" />}
          </button>
          <div className="toolbar-popover-wrap">
            <button className={`profile-button ${profileOpen ? "selected" : ""}`} title={state.privateWindow ? `Private ${state.currentProfile.name} profile` : `${state.currentProfile.name} profile`}
              onClick={() => { setProfileOpen((open) => !open); setMenuOpen(false); setPasswordMenuOpen(false); setRecordOpen(false); }}>
              {state.privateWindow ? <EyeOff size={15} /> : <UserRound size={15} />}<ChevronDown size={11} />
            </button>
            {profileOpen && <ProfileMenu state={state} close={() => setProfileOpen(false)} />}
          </div>
          <div className="toolbar-popover-wrap">
            <button
              className={`record-button ${state.recording.status} ${recordOpen ? "open" : ""}`}
              type="button"
              disabled={state.privateWindow}
              aria-expanded={recordOpen}
              title={state.privateWindow ? "Recording is unavailable in private windows" : "Live browser recording"}
              onClick={() => {
                setRecordOpen((open) => !open);
                setProfileOpen(false);
                setMenuOpen(false);
                setPasswordMenuOpen(false);
              }}>
              <span className="record-dot" aria-hidden="true" />
              <span>{state.recording.status === "idle" ? "Record" : formatRecordingDuration(state.recording.elapsedMs)}</span>
            </button>
            {recordOpen ? <RecordingMenu state={state} close={() => setRecordOpen(false)} /> : null}
          </div>
          <button className={`work-button ${workTone} ${state.workOpen ? "open" : ""}`} disabled={state.privateWindow}
            title={state.privateWindow ? "Work Mode is unavailable in private windows" : "Toggle Work Mode (⌘⌥L)"}
            onClick={() => void command({ type: "toggle-work" })}>
            {state.work.pendingPermission ? <CircleAlert size={15} /> : <Sparkles size={15} />}
            <span>Work</span><span className="work-state-dot" aria-label={workTone} />
          </button>
          <div className="toolbar-popover-wrap">
            <button className={`chrome-button ${menuOpen ? "selected" : ""}`} title="Browser menu"
              onClick={() => { setMenuOpen((open) => !open); setProfileOpen(false); setPasswordMenuOpen(false); setRecordOpen(false); }}><MoreHorizontal size={18} /></button>
            {menuOpen && <BrowserMenu state={state} close={() => setMenuOpen(false)} />}
          </div>
        </div>
        {state.find.open && <FindBar state={state} />}
        {state.pendingSitePermission && <SitePermissionBar state={state} />}
        {state.pendingCredential && <CredentialSaveBar state={state} />}
      </header>

      {document.documentElement.dataset.locusPreview === "true" && !state.internalSurface && !state.paletteOpen
        ? <PreviewPageCanvas state={state} top={chromeHeight} /> : null}
      {state.internalSurface?.type === "settings" ? <SettingsSurface state={state} top={chromeHeight} page={settingsPage} onPageChange={setSettingsPage} {...(state.internalSurface.anchor ? { requestedAnchor: state.internalSurface.anchor } : {})} /> : null}
      {state.internalSurface?.type === "research" ? <ResearchSurface state={state} top={chromeHeight} {...(state.internalSurface.boardId ? { boardId: state.internalSurface.boardId } : {})} /> : null}
      {state.internalSurface?.type === "tab-steward" ? <TabStewardSurface state={state} top={chromeHeight} /> : null}
      {state.paletteOpen ? <CommandPalette state={state} top={chromeHeight} /> : null}
      {state.walrusMemory.draft ? <WalrusMemoryPreview state={state} /> : null}
      {state.research.bundleDraft ? <ResearchBundlePreview state={state} /> : null}
      {state.sidebarOpen && !state.internalSurface && !state.paletteOpen && <BrowserSidebar state={state} top={chromeHeight} />}
      {state.workOpen && state.workOverlay && <div className="dock-scrim" style={{ top: chromeHeight }} aria-hidden="true" />}
      {!state.internalSurface && !state.paletteOpen ? <div className="page-drop-shadow" style={{ left: state.sidebarOpen ? 248 : 0, top: chromeHeight }} aria-hidden="true" /> : null}
    </div>
  );
}

function PreviewPageCanvas({ state, top }: { state: BrowserAppState; top: number }) {
  const left = state.sidebarOpen ? 248 : 0;
  const pages = state.splitView.enabled ? ["Search privately with Locus", "private AI browser research"] : ["Search privately with Locus"];
  return <div className={`preview-page-canvas ${state.splitView.enabled ? "split" : ""}`} style={{ top, left }} aria-hidden="true">
    {pages.map((query, index) => <section key={query} className={index === 0 && state.splitView.focusedPane === "primary" || index === 1 && state.splitView.focusedPane === "secondary" ? "focused" : ""}>
      <nav><span>About</span><span>Store</span><i /><span>Gmail</span><span>Images</span><b>G</b></nav>
      <div className="preview-google"><h2><i>G</i><i>o</i><i>o</i><i>g</i><i>l</i><i>e</i></h2><p><Search size={17} /><span>{query}</span><Mic size={15} /></p>{index === 1 ? <div className="preview-search-results"><strong>Private AI browser research</strong><span>Compare sources with local evidence and exact citations.</span><strong>Locus Browser Intelligence</strong><span>Recall, Research Boards, Split View, Reader and a universal palette.</span></div> : <div className="preview-google-actions"><span>Google Search</span><span>I'm Feeling Lucky</span></div>}</div>
    </section>)}
  </div>;
}

function RecordingMenu({ state, close }: { state: BrowserAppState; close: () => void }) {
  const [tabAudio, setTabAudio] = useState(true);
  const [microphone, setMicrophone] = useState(true);
  const [saveVideo, setSaveVideo] = useState(false);
  const [shareLevel, setShareLevel] = useState<"read" | "interact">("read");
  const [error, setError] = useState("");
  const active = state.recording.status !== "idle";
  const localModelMissing = state.settings.speech.engine === "local"
    && state.settings.speech.localModelStatus !== "ready"
    && (tabAudio || microphone);
  const run = async (value: BrowserCommand) => {
    setError("");
    try { await command(value); } catch (caught) { setError(caught instanceof Error ? caught.message : "Recording request failed"); }
  };

  return (
    <section className="toolbar-popover recording-menu" aria-label="Live recording controls">
      <header>
        <span className={`recording-mark ${state.recording.status}`}><span /></span>
        <span>
          <strong>{active ? formatRecordingDuration(state.recording.elapsedMs) : "Live context"}</strong>
          <small>{active ? recordingStatusLabel(state) : "Your shared browser tab only"}</small>
        </span>
        <button type="button" aria-label="Close recording controls" onClick={close}><X size={13} /></button>
      </header>

      {!active ? (
        <>
          <p className="recording-privacy">Locus captures the webpage canvas—not browser chrome or other apps. Protected fields and inaccessible frames are masked before capture.</p>
          <label className="recording-choice"><span><Volume2 size={14} /><span><strong>Tab audio</strong><small>Transcribe sound from this tab</small></span></span><input type="checkbox" checked={tabAudio} onChange={(event) => setTabAudio(event.target.checked)} /></label>
          <label className="recording-choice"><span><Mic size={14} /><span><strong>Microphone</strong><small>Transcribe your voice</small></span></span><input type="checkbox" checked={microphone} onChange={(event) => setMicrophone(event.target.checked)} /></label>
          <label className="recording-choice"><span><Video size={14} /><span><strong>Save video</strong><small>Off by default · asks where to save on stop</small></span></span><input type="checkbox" checked={saveVideo} onChange={(event) => setSaveVideo(event.target.checked)} /></label>
          <label className="recording-access"><span>Tab access</span><select value={shareLevel} onChange={(event) => setShareLevel(event.target.value as "read" | "interact")}><option value="read">Read only</option><option value="interact">Allow interaction</option></select></label>
          <p className="recording-speech-note">{speechPrivacyLabel(state)}</p>
          {localModelMissing ? (
            <button className="recording-download" type="button" disabled={state.settings.speech.localModelStatus === "downloading"} onClick={() => void run({ type: "download-speech-model" })}>
              {state.settings.speech.localModelStatus === "downloading" ? `Downloading ${Math.round((state.settings.speech.localModelProgress ?? 0) * 100)}%` : "Download on-device speech model"}
            </button>
          ) : null}
          <button className="recording-primary" type="button" disabled={localModelMissing} onClick={() => void run({ type: "start-recording", shareLevel, tabAudio, microphone, saveVideo })}>Start live recording</button>
        </>
      ) : (
        <>
          {state.recording.pausedReason ? <p className="recording-paused"><Pause size={13} />{state.recording.pausedReason}</p> : null}
          <button className="recording-choice action" type="button" onClick={() => void run({ type: "set-recording-source", source: "tabAudio", enabled: !state.recording.sources.tabAudio })}><span><Volume2 size={14} /><span><strong>Tab audio</strong><small>{state.recording.sources.tabAudio ? "On" : "Off"}</small></span></span><span className={`settings-switch ${state.recording.sources.tabAudio ? "on" : ""}`}><span /></span></button>
          <button className="recording-choice action" type="button" onClick={() => void run({ type: "set-recording-source", source: "microphone", enabled: !state.recording.sources.microphone })}><span><Mic size={14} /><span><strong>Microphone</strong><small>{state.recording.sources.microphone ? "On" : "Off"}</small></span></span><span className={`settings-switch ${state.recording.sources.microphone ? "on" : ""}`}><span /></span></button>
          <div className="recording-actions">
            {state.recording.status === "paused"
              ? <button type="button" onClick={() => void run({ type: "resume-recording" })}><Play size={13} />Resume</button>
              : <button type="button" onClick={() => void run({ type: "pause-recording" })}><Pause size={13} />Pause</button>}
            <button className="stop" type="button" onClick={() => void run({ type: "stop-recording" })}><Square size={11} fill="currentColor" />Stop</button>
          </div>
        </>
      )}
      {state.recording.error ? <p className="recording-error" role="alert">{state.recording.error}</p> : null}
      {error ? <p className="recording-error" role="alert">{error}</p> : null}
    </section>
  );
}

function speechPrivacyLabel(state: BrowserAppState): string {
  if (state.settings.speech.engine === "local") return "Speech is transcribed on this Mac. Raw audio is discarded after each short chunk.";
  if (state.settings.speech.engine === "openai") return "Short audio chunks are sent to OpenAI for transcription. Raw audio is never saved.";
  return `Short audio chunks are sent to ${state.settings.speech.customBaseUrl || "your custom endpoint"}. Raw audio is never saved.`;
}

function recordingStatusLabel(state: BrowserAppState): string {
  if (state.recording.status === "paused") return "Paused · no tab media is being accepted";
  if (state.recording.status === "error") return "Needs attention";
  if (state.recording.status === "starting") return "Connecting to the shared tab…";
  if (state.recording.status === "stopping") return "Finishing securely…";
  return "Recording the shared tab";
}

function OnboardingSurface({ state }: { state: BrowserAppState }) {
  const [searchEngine, setSearchEngine] = useState<SearchEngine | null>(null);
  const [appearance, setAppearance] = useState<Appearance>(state.settings.appearance);
  const [sleepAfterMinutes, setSleepAfterMinutes] = useState<0 | 15 | 30 | 60>(state.settings.sleepAfterMinutes);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!searchEngine) return;
    void command({ type: "complete-onboarding", searchEngine, appearance, sleepAfterMinutes });
  };
  return (
    <main className={`onboarding-shell theme-${appearance}`} style={accentCssVariables(state.settings.accent) as React.CSSProperties}>
      <form className="onboarding-card" onSubmit={submit}>
        <header className="onboarding-heading">
          <span className="onboarding-mark" aria-hidden="true">L</span>
          <div><p>Welcome to</p><h1>Locus Browser</h1></div>
        </header>
        <p className="onboarding-intro">A calm, private browser with Locus ready when you turn on Work Mode. Your browser data stays separate from the Locus app.</p>

        <fieldset className="onboarding-section">
          <legend>Choose your search engine</legend>
          <p>No provider paid for placement. You can change this anytime.</p>
          <div className="provider-grid" role="radiogroup" aria-label="Search engine">
            {searchProviders.map((provider) => (
              <button type="button" role="radio" aria-checked={searchEngine === provider.id} className={searchEngine === provider.id ? "selected" : ""}
                tabIndex={searchEngine ? (searchEngine === provider.id ? 0 : -1) : (provider.id === searchProviders[0]!.id ? 0 : -1)}
                key={provider.id} onClick={() => setSearchEngine(provider.id)} onKeyDown={navigateRadioGroup}>
                <span className="provider-mark">{provider.mark}</span><span><strong>{provider.name}</strong><small>{provider.detail}</small></span>
                {searchEngine === provider.id ? <Check size={15} /> : null}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="onboarding-preferences">
          <fieldset className="onboarding-section compact">
            <legend>Appearance</legend>
            <div className="appearance-picker" role="radiogroup" aria-label="Appearance">
              {(["system", "light", "dark"] as const).map((option) => (
                <button type="button" role="radio" aria-checked={appearance === option} className={appearance === option ? "selected" : ""}
                  tabIndex={appearance === option ? 0 : -1} key={option} onClick={() => setAppearance(option)} onKeyDown={navigateRadioGroup}>
                  {option === "system" ? <Monitor size={14} /> : option === "light" ? <Sun size={14} /> : <Moon size={14} />}
                  <span>{option[0]!.toUpperCase() + option.slice(1)}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <label className="onboarding-section compact sleep-choice">
            <strong>Sleep background tabs</strong>
            <select value={sleepAfterMinutes} onChange={(event) => setSleepAfterMinutes(Number(event.target.value) as 0 | 15 | 30 | 60)}>
              <option value={15}>After 15 minutes</option><option value={30}>After 30 minutes</option><option value={60}>After 1 hour</option><option value={0}>Never</option>
            </select>
          </label>
        </div>

        <footer className="onboarding-footer">
          <span><ShieldCheck size={14} /> Passwords stay encrypted on this Mac.</span>
          <button className="onboarding-continue" type="submit" disabled={!searchEngine}>Start browsing <ArrowRight size={15} /></button>
        </footer>
      </form>
    </main>
  );
}

function PasswordMenu({ state, close }: { state: BrowserAppState; close: () => void }) {
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  return (
    <div className="toolbar-popover password-menu" role="menu">
      <div className="popover-heading">
        <span className="profile-avatar"><KeyRound size={15} /></span>
        <span><strong>Saved logins</strong><small>{active ? safeHostname(active.url) : "Current page"}</small></span>
      </div>
      {state.credentialSuggestions.map((credential) => (
        <button role="menuitem" key={credential.id} onClick={() => { close(); void command({ type: "autofill-credential", credentialId: credential.id }); }}>
          <UserRound size={15} /><span>{credential.username || "No username"}</span><ArrowRight size={12} />
        </button>
      ))}
      <div className="password-menu-foot">Filled only when you choose an account.</div>
    </div>
  );
}

function CredentialSaveBar({ state }: { state: BrowserAppState }) {
  const pending = state.pendingCredential!;
  return (
    <div className="credential-save-bar" role="status" aria-live="polite">
      <KeyRound size={15} />
      <span><strong>{pending.action === "update" ? "Update" : "Save"} password for {safeHostname(pending.origin)}?</strong><small>{pending.username || "No username"} · Password hidden</small></span>
      <button onClick={() => void command({ type: "dismiss-pending-credential" })}>Not now</button>
      <button className="primary" disabled={!state.passwordManagerAvailable} onClick={() => void command({ type: "save-pending-credential" })}>
        {pending.action === "update" ? "Update" : "Save"}
      </button>
    </div>
  );
}

function ProfileMenu({ state, close }: { state: BrowserAppState; close: () => void }) {
  const createProfile = () => {
    const name = window.prompt("Name this browser profile", "Work");
    if (name?.trim()) {
      close();
      void command({ type: "create-profile", name: name.trim() });
    }
  };
  const renameCurrent = () => {
    const name = window.prompt("Rename this browser profile", state.currentProfile.name);
    if (name?.trim()) void command({ type: "rename-profile", profileId: state.profileId, name: name.trim() });
  };
  return (
    <div className="toolbar-popover profile-menu" role="menu">
      <div className="popover-heading">
        <span className="profile-avatar">{state.privateWindow ? <EyeOff size={15} /> : <UserRound size={15} />}</span>
        <span><strong>{state.privateWindow ? `Private · ${state.currentProfile.name}` : state.currentProfile.name}</strong><small>{state.privateWindow ? "Activity is not saved" : "Local profile"}</small></span>
      </div>
      <div className="popover-rule" />
      {state.profiles.map((profile) => (
        <button key={profile.id} role="menuitem" className={profile.id === state.profileId ? "current" : ""}
          onClick={() => { close(); if (profile.id !== state.profileId || state.privateWindow) void command({ type: "open-profile", profileId: profile.id }); }}>
          <UserRound size={15} /><span>{profile.name}</span>{profile.id === state.profileId && !state.privateWindow ? <Check size={13} /> : null}
        </button>
      ))}
      {!state.privateWindow && <button role="menuitem" onClick={renameCurrent}><Settings size={15} /><span>Rename profile…</span></button>}
      <button role="menuitem" onClick={createProfile}><Plus size={15} /><span>New profile…</span></button>
      <div className="popover-rule" />
      <button role="menuitem" onClick={() => { close(); void command({ type: "new-private-window" }); }}>
        <EyeOff size={15} /><span>New private window</span><kbd>⇧⌘N</kbd>
      </button>
    </div>
  );
}

function SitePermissionBar({ state }: { state: BrowserAppState }) {
  const request = state.pendingSitePermission!;
  const host = safeHostname(request.origin);
  const answer = (decision: "allow-once" | "always" | "deny") => void command({ type: "answer-site-permission", requestId: request.requestId, decision });
  return (
    <div className="site-permission-bar" role="alert" aria-live="assertive" aria-label="Site permission request">
      <ShieldCheck size={15} />
      <span><strong>{host}</strong> wants to use your {request.permission}.</span>
      <button onClick={() => answer("deny")}>Block</button>
      <button onClick={() => answer("allow-once")}>Allow once</button>
      {!state.privateWindow && <button className="primary" onClick={() => answer("always")}>Always allow</button>}
    </div>
  );
}

function BrowserMenu({ state, close }: { state: BrowserAppState; close: () => void }) {
  const run = (value: BrowserCommand) => { close(); void command(value); };
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  const canSaveToWalrus = state.walrusMemory.usable && Boolean(
    active && /^https?:\/\//.test(active.url) && active.grants.some((grant) => grant.sessionId === state.work.sessionId),
  );
  return (
    <div className="toolbar-popover browser-menu" role="menu">
      <div className="zoom-row">
        <span>Zoom</span>
        <button title="Zoom out" onClick={() => void command({ type: "zoom-out" })}><Minus size={14} /></button>
        <button className="zoom-value" title="Reset zoom" onClick={() => void command({ type: "zoom-reset" })}>{Math.round(state.zoomFactor * 100)}%</button>
        <button title="Zoom in" onClick={() => void command({ type: "zoom-in" })}><Plus size={14} /></button>
      </div>
      <div className="popover-rule" />
      <button role="menuitem" onClick={() => run({ type: "open-command-palette" })}><CommandIcon size={15} /><span>Command Palette</span><kbd>⌘K</kbd></button>
      <button role="menuitem" onClick={() => run({ type: "toggle-split-view" })}><Columns2 size={15} /><span>{state.splitView.enabled ? "Exit Split View" : "Split View"}</span></button>
      <button role="menuitem" disabled={!state.reader.available && !state.reader.active} onClick={() => run({ type: "toggle-reader" })}><BookOpenText size={15} /><span>Reader Mode</span></button>
      {!state.privateWindow ? <button role="menuitem" onClick={() => run({ type: "open-research-board" })}><LibraryBig size={15} /><span>Research Board</span></button> : null}
      {!state.privateWindow ? <button role="menuitem" onClick={() => run({ type: "open-tab-steward" })}><Layers3 size={15} /><span>Tab Steward</span></button> : null}
      {!state.privateWindow && state.walrusMemory.status !== "disconnected" ? <button role="menuitem" disabled={!canSaveToWalrus} title={canSaveToWalrus ? "Preview this shared page before uploading" : "Connect Walrus and share this HTTP(S) tab first"} onClick={() => run({ type: "begin-walrus-page-memory" })}><Database size={15} /><span>Save page to Walrus Memory</span></button> : null}
      <div className="popover-rule" />
      <button role="menuitem" onClick={() => run({ type: "toggle-find" })}><Search size={15} /><span>Find in page</span><kbd>⌘F</kbd></button>
      <button role="menuitem" onClick={() => run({ type: "print-page" })}><Printer size={15} /><span>Print</span><kbd>⌘P</kbd></button>
      <button role="menuitem" onClick={() => run({ type: "save-page-pdf" })}><FileDown size={15} /><span>Save page as PDF</span></button>
      <div className="popover-rule" />
      <button role="menuitem" onClick={() => run({ type: "open-settings" })}><Settings size={15} /><span>Settings</span><kbd>⌘,</kbd></button>
    </div>
  );
}

function FindBar({ state }: { state: BrowserAppState }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const search = (forward: boolean) => void command({ type: "find-in-page", query: state.find.query, forward, findNext: true });
  return (
    <div className="find-bar" role="search">
      <Search size={14} />
      <input ref={inputRef} value={state.find.query} placeholder="Find in page" aria-label="Find in page"
        onChange={(event) => void command({ type: "find-in-page", query: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") search(!event.shiftKey);
          if (event.key === "Escape") void command({ type: "close-find" });
        }} />
      <span className="find-count">{state.find.query ? `${state.find.activeMatchOrdinal} of ${state.find.matches}` : ""}</span>
      <button title="Previous match" disabled={!state.find.query} onClick={() => search(false)}><ArrowUp size={14} /></button>
      <button title="Next match" disabled={!state.find.query} onClick={() => search(true)}><ArrowDown size={14} /></button>
      <button title="Close find" onClick={() => void command({ type: "close-find" })}><X size={14} /></button>
    </div>
  );
}

function TabItem({ tab, groupColor }: { tab: BrowserTabState; groupColor?: string }) {
  const dragging = useRef(false);
  return (
    <div className={`tab ${tab.active ? "active" : ""} ${tab.pane ? `pane-${tab.pane}` : ""} ${tab.grants.length ? "agent-access" : ""} ${groupColor ? `group-${groupColor}` : ""}`}
      role="tab" aria-selected={tab.active} tabIndex={tab.active ? 0 : -1} draggable
      onClick={() => { if (!dragging.current) void command({ type: "select-tab", tabId: tab.id }); }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void command({ type: "select-tab", tabId: tab.id }); }
      }}
      onDragStart={(event) => { dragging.current = true; event.dataTransfer.setData("text/locus-tab", tab.id); }}
      onDragEnd={() => { dragging.current = false; }} onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const moving = event.dataTransfer.getData("text/locus-tab");
        if (moving) void command({ type: "reorder-tab", tabId: moving, beforeTabId: tab.id });
      }}>
      <span className="tab-icon">
        {tab.sleeping ? <Moon size={13} /> : tab.private ? <EyeOff size={13} /> : tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : <Globe2 size={13} />}
        {tab.loading && <span className="loading-ring" />}
      </span>
      <span className="tab-title">{tab.title || "New Tab"}</span>
      {tab.pane ? <span className="tab-pane-mark" title={`${tab.pane} Split View pane`}>{tab.pane === "primary" ? "L" : "R"}</span> : null}
      {tab.grants.length > 0 && <Bot className="tab-agent-indicator" size={12} aria-label="Shared with Locus" />}
      <button className="tab-close" title="Close tab" onClick={(event) => { event.stopPropagation(); void command({ type: "close-tab", tabId: tab.id }); }}><X size={12} /></button>
    </div>
  );
}

function SettingsTab() {
  return (
    <div className="tab active settings-tab" role="tab" aria-selected="true" tabIndex={0}>
      <span className="tab-icon"><Settings size={13} /></span>
      <span className="tab-title">Settings</span>
      <button className="tab-close" title="Close settings" onClick={() => void command({ type: "close-settings" })}><X size={12} /></button>
    </div>
  );
}

function BrowserSidebar({ state, top }: { state: BrowserAppState; top: number }) {
  return (
    <aside className="browser-sidebar" style={{ top }} aria-label="Browser sidebar">
      <nav className="sidebar-nav">
        <SidebarItem section="tabs" active={state.sidebarSection === "tabs"} icon={<LayoutList size={16} />} label="Tabs" />
        <SidebarItem section="bookmarks" active={state.sidebarSection === "bookmarks"} icon={<Bookmark size={16} />} label="Bookmarks" />
        <SidebarItem section="history" active={state.sidebarSection === "history"} icon={<History size={16} />} label="History" />
        <SidebarItem section="downloads" active={state.sidebarSection === "downloads"} icon={<Download size={16} />} label="Downloads" />
        <div className="sidebar-rule" />
        <SidebarItem section="spaces" active={state.sidebarSection === "spaces"} icon={<UsersRound size={16} />} label="Spaces" />
        <SidebarItem section="conversations" active={state.sidebarSection === "conversations"} icon={<Clock3 size={16} />} label="Conversations" />
      </nav>
      <SidebarContent state={state} />
      <button className="sidebar-settings" onClick={() => void command({ type: "open-settings" })}><Settings size={15} /><span>Settings</span></button>
    </aside>
  );
}

function SidebarContent({ state }: { state: BrowserAppState }) {
  if (state.sidebarSection === "tabs") {
    return <TabsPanel state={state} />;
  }
  if (state.sidebarSection === "bookmarks") {
    return <SidebarList title="Bookmarks" count={state.bookmarks.length}>{state.bookmarks.length ? state.bookmarks.map((bookmark) => (
      <div className="sidebar-row with-action" key={bookmark.id}>
        <button title={`Open ${bookmark.title}`} onClick={() => void command({ type: "open-library-item", url: bookmark.url })}><Bookmark size={13} /><span>{bookmark.title}</span></button>
        <button className="row-action" title="Remove bookmark" onClick={() => void command({ type: "remove-bookmark", bookmarkId: bookmark.id })}><X size={12} /></button>
      </div>
    )) : <EmptyLibrary icon={<Bookmark size={18} />} text="Bookmark a page to keep it here." />}</SidebarList>;
  }
  if (state.sidebarSection === "history") {
    return <HistoryRecallPanel state={state} />;
  }
  if (state.sidebarSection === "downloads") {
    return <SidebarList title="Downloads" count={state.downloads.length}>{state.downloads.length ? state.downloads.map((download) => (
      <div className="download-row" key={download.id}>
        <span className="download-icon"><FileDown size={14} /></span>
        <span className="download-copy"><strong>{download.filename || "Download"}</strong><small>{download.state === "progressing" ? formatProgress(download.receivedBytes, download.totalBytes) : download.state}</small></span>
        {download.state === "progressing"
          ? <button title="Cancel download" onClick={() => void command({ type: "cancel-download", downloadId: download.id })}><X size={12} /></button>
          : <button title="Show in Finder" disabled={!download.path} onClick={() => void command({ type: "reveal-download", downloadId: download.id })}><Search size={12} /></button>}
      </div>
    )) : <EmptyLibrary icon={<Download size={18} />} text="Your downloads will appear here." />}</SidebarList>;
  }
  const spaces = state.sidebarSection === "spaces";
  if (spaces) {
    return <SidebarList title="Profiles" count={state.profiles.length}>{state.profiles.map((profile) => (
      <button className={`sidebar-row ${profile.id === state.profileId ? "active" : ""}`} key={profile.id}
        onClick={() => void command({ type: "open-profile", profileId: profile.id })}>
        <UserRound size={13} /><span>{profile.name}</span>{profile.id === state.profileId && <Check size={12} />}
      </button>
    ))}</SidebarList>;
  }
  return (
    <>
      <div className="sidebar-heading with-button">
        <span>Conversations</span><span>{state.work.conversations.length}</span>
        <button type="button" title="New conversation" disabled={state.work.busy || state.work.runtime !== "online"} onClick={() => void command({ type: "new-work-conversation" })}><Plus size={13} /></button>
      </div>
      <div className="sidebar-list">
        {state.work.conversations.length ? state.work.conversations.map((conversation) => (
          <button type="button" className={`sidebar-row library-row conversation-row ${conversation.current ? "active" : ""}`} key={conversation.id} onClick={() => void command({ type: "select-work-conversation", sessionId: conversation.id })}>
            <Clock3 size={13} />
            <span><strong>{conversation.title}</strong><small>{conversation.current ? "Current conversation" : formatTime(conversation.updatedAt)}</small></span>
          </button>
        )) : <EmptyLibrary icon={<Clock3 size={18} />} text={state.work.runtime === "online" ? "Start a conversation in Work Mode." : "Conversation history appears when the local agent is ready."} />}
      </div>
      {state.recording.transcripts.length ? (
        <section className="recording-history">
          <div className="sidebar-heading"><span>Live transcripts</span><span>{state.recording.transcripts.length}</span></div>
          {state.recording.transcripts.map((recording) => (
            <details key={recording.id} className="recording-history-card">
              <summary><span className="recording-history-dot" /><span><strong>{formatRecordingDuration(recording.durationMs)}</strong><small>{new Date(recording.startedAt).toLocaleString()} · {recording.segmentCount} segments</small></span><ChevronDown size={11} /></summary>
              <p>Encrypted on this Mac and linked to {recording.workSessionId === state.work.sessionId ? "this conversation" : "an earlier conversation"}. It is never synced.</p>
              {recording.videoPath ? <button type="button" onClick={() => void command({ type: "reveal-recording-video", recordingId: recording.id })}>Show recovered video</button> : null}
              <button type="button" disabled={recording.id === state.recording.id} onClick={() => deleteRecordingTranscript(recording.id)}>Delete transcript</button>
            </details>
          ))}
        </section>
      ) : null}
    </>
  );
}

function HistoryRecallPanel({ state }: { state: BrowserAppState }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SemanticRecallResultState[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!query.trim() || state.privateWindow) { setResults([]); return; }
    let alive = true; setLoading(true);
    const timer = setTimeout(() => void window.locusBrowser.query({ type: "semantic-recall-search", query, limit: 30 }).then((value) => {
      if (alive) setResults(value as SemanticRecallResultState[]);
    }).finally(() => { if (alive) setLoading(false); }), 160);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, state.privateWindow, state.semanticRecall.documentCount]);
  if (state.privateWindow) return <SidebarList title="History hidden" count={0}><EmptyLibrary icon={<History size={18} />} text="History and Private Recall stay hidden in private windows." /></SidebarList>;
  const openResult = (result: SemanticRecallResultState) => result.openTabId
    ? command({ type: "select-tab", tabId: result.openTabId }) : command({ type: "open-library-item", url: result.url });
  return <>
    <div className="sidebar-heading"><span>History & Recall</span><span>{state.history.length}</span></div>
    <div className="recall-search-wrap"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={state.semanticRecall.enabled ? "Find something you read…" : "Search title or URL…"} aria-label="Search history with Private Recall" />{loading ? <span className="loading-ring" /> : null}</div>
    {state.semanticRecall.enabled ? <p className="recall-status"><ShieldCheck size={11} />{state.semanticRecall.documentCount} private pages · {formatBytes(state.semanticRecall.storageBytes)}</p> : <button className="recall-opt-in" onClick={() => void command({ type: "set-semantic-recall-enabled", enabled: true })}><Sparkles size={12} /><span>Enable on-device Private Recall</span></button>}
    <div className="sidebar-list">
      {query.trim() ? results.map((result) => <div className="recall-result" key={result.id}>
        <button onClick={() => void openResult(result)}><span><strong>{result.title}</strong><small>{result.snippet}</small><i>{result.source === "open-tab" ? "Open tab" : result.source === "bookmark" ? "Bookmark" : new Date(result.visitedAt).toLocaleDateString()}</i></span></button>
        {!result.id.startsWith("tab:") && !result.id.startsWith("bookmark:") && !result.id.startsWith("history:") ? <button title="Delete this recalled page" onClick={() => void command({ type: "delete-recall-document", documentId: result.id })}><Trash2 size={11} /></button> : null}
      </div>) : state.history.length ? state.history.map((entry) => (
        <button className="sidebar-row library-row" key={entry.id} onClick={() => void command({ type: "open-library-item", url: entry.url })}>
          <History size={13} /><span><strong>{entry.title || entry.url}</strong><small>{formatTime(entry.visitedAt)}</small></span>
        </button>
      )) : <EmptyLibrary icon={<History size={18} />} text="Pages you visit will appear here." />}
      {query.trim() && !loading && !results.length ? <EmptyLibrary icon={<Search size={18} />} text="No matching page was found." /> : null}
    </div>
  </>;
}

function TabsPanel({ state }: { state: BrowserAppState }) {
  const ungrouped = state.tabs.filter((tab) => !tab.groupId);
  return (
    <>
      <div className="sidebar-heading with-button">
        <span>Open tabs</span><span>{state.tabs.length}</span>
        {!state.privateWindow && <button title="Group the active tab" onClick={() => void command({ type: "create-tab-group", ...(state.activeTabId ? { tabId: state.activeTabId } : {}) })}><Layers3 size={13} /></button>}
      </div>
      <div className="sidebar-list tab-groups">
        {state.groups.map((group) => {
          const tabs = state.tabs.filter((tab) => tab.groupId === group.id);
          return (
            <section className="tab-group" key={group.id}>
              <div className="tab-group-heading">
                <button title={group.collapsed ? "Expand group" : "Collapse group"} onClick={() => void command({ type: "toggle-tab-group", groupId: group.id })}>
                  <ChevronDown className={group.collapsed ? "collapsed" : ""} size={13} /><i className={`group-dot group-${group.color}`} /><span>{group.name}</span><small>{tabs.length}</small>
                </button>
                <button title="Rename group" onClick={() => renameGroup(group.id, group.name)}><Settings size={11} /></button>
                <button title="Delete group" onClick={() => deleteGroup(group.id, group.name)}><X size={11} /></button>
              </div>
              {!group.collapsed && tabs.map((tab) => <SidebarTabRow key={tab.id} state={state} tab={tab} />)}
            </section>
          );
        })}
        {ungrouped.map((tab) => <SidebarTabRow key={tab.id} state={state} tab={tab} />)}
      </div>
      {state.remoteTabs.length > 0 && (
        <section className="remote-tabs">
          <div className="sidebar-heading"><span>Other devices</span><span>{state.remoteTabs.length}</span></div>
          {state.remoteTabs.map((tab) => (
            <button className="remote-tab-row" key={tab.id} onClick={() => void command({ type: "open-library-item", url: tab.url })}>
              <Laptop size={13} /><span><strong>{tab.title}</strong><small>{safeHostname(tab.url)} · {shortDevice(tab.deviceId)}</small></span><ArrowRight size={11} />
            </button>
          ))}
        </section>
      )}
    </>
  );
}

function SidebarTabRow({ state, tab }: { state: BrowserAppState; tab: BrowserTabState }) {
  return (
    <div className={`sidebar-tab-row ${tab.active ? "active" : ""}`}>
      <button className="sidebar-tab-main" onClick={() => void command({ type: "select-tab", tabId: tab.id })}>
        {tab.sleeping ? <Moon size={13} /> : tab.private ? <EyeOff size={13} /> : <Globe2 size={13} />}
        <span>{tab.title}</span>{tab.grants.length > 0 && <Sparkles size={11} />}
      </button>
      {!state.privateWindow && (
        <select aria-label={`Group ${tab.title}`} value={tab.groupId ?? ""} onChange={(event) => void command({ type: "set-tab-group", tabId: tab.id, groupId: event.target.value || null })}>
          <option value="">No group</option>{state.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      )}
      {!tab.active && !tab.sleeping && <button className="sleep-tab" title="Sleep tab" onClick={() => void command({ type: "sleep-tab", tabId: tab.id })}><Moon size={11} /></button>}
    </div>
  );
}

function CommandPalette({ state, top }: { state: BrowserAppState; top: number }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PaletteResultState[]>([]);
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => void window.locusBrowser.query({ type: "palette-search", query, limit: 30 }).then((value) => {
      if (alive) { setResults(value as PaletteResultState[]); setSelected(0); }
    }), 45);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, state.tabs.length, state.semanticRecall.documentCount]);
  const execute = (result?: PaletteResultState) => result && void command({ type: "execute-palette-action", action: result.action });
  return <div className="palette-surface" style={{ top }} onMouseDown={(event) => { if (event.target === event.currentTarget) void command({ type: "close-command-palette" }); }}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="Universal command palette">
      <header><Search size={18} /><input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tabs, history, settings, conversations, or run a command…" aria-label="Command palette search" onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => Math.min(results.length - 1, value + 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)); }
        if (event.key === "Enter") { event.preventDefault(); execute(results[selected]); }
        if (event.key === "Escape") { event.preventDefault(); void command({ type: "close-command-palette" }); }
      }} /><kbd>⌘K</kbd></header>
      <div className="palette-results" role="listbox">
        {results.map((result, index) => <button key={result.id} className={index === selected ? "selected" : ""} role="option" aria-selected={index === selected} onMouseEnter={() => setSelected(index)} onClick={() => execute(result)}>
          <span className={`palette-kind kind-${result.kind}`}>{result.kind === "tab" ? <Globe2 size={14} /> : result.kind === "recall" ? <Sparkles size={14} /> : result.kind === "command" ? <CommandIcon size={14} /> : result.kind === "research" ? <LibraryBig size={14} /> : <Search size={14} />}</span>
          <span><strong>{result.label}</strong><small>{result.detail}</small></span><i>{result.kind.replace("-", " ")}</i>
        </button>)}
        {!results.length ? <div className="palette-empty">No matching command or browser item.</div> : null}
      </div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span>Private Recall stays on this Mac</span></footer>
    </section>
  </div>;
}

function ResearchSurface({ state, top, boardId }: { state: BrowserAppState; top: number; boardId?: string }) {
  const [board, setBoard] = useState<ResearchBoardState>();
  const [prompt, setPrompt] = useState("Compare these sources and produce a concise, decision-useful brief.");
  const [format, setFormat] = useState<ResearchBoardState["format"]>("comparison");
  const eligible = useMemo(() => state.tabs.filter((tab) => !tab.private && /^https?:\/\//.test(tab.url) && tab.grants.some((grant) => grant.sessionId === state.work.sessionId)), [state.tabs, state.work.sessionId]);
  const [selected, setSelected] = useState<string[]>(() => eligible.slice(0, 10).map((tab) => tab.id));
  const [error, setError] = useState("");
  useEffect(() => {
    if (!boardId) { setBoard(undefined); return; }
    let alive = true;
    void window.locusBrowser.query({ type: "research-board-get", boardId }).then((value) => { if (alive) setBoard(value as ResearchBoardState | undefined); });
    return () => { alive = false; };
  }, [boardId, state.research.boards.find((item) => item.id === boardId)?.updatedAt]);
  const generate = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    try { await command({ type: "generate-research-board", tabIds: selected, prompt, format }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Research could not start"); }
  };
  return <main className="internal-page research-surface" style={{ top, right: state.workOpen && !state.workOverlay ? state.workWidth : 0 }}>
    <header className="internal-page-heading"><span className="research-mark"><LibraryBig size={20} /></span><span><h1>{board?.title || "Research Board"}</h1><p>{board ? `${board.sources.length} immutable local source snapshots` : "A cited, persistent brief built from explicitly shared tabs."}</p></span><button title="Close Research Board" onClick={() => void command({ type: "close-internal-surface" })}><X size={16} /></button></header>
    {!board ? <div className="research-create-layout">
      <form className="research-create-card" onSubmit={generate}>
        <label><span>Research goal</span><textarea rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={20_000} /></label>
        <label><span>Artifact</span><select value={format} onChange={(event) => setFormat(event.target.value as ResearchBoardState["format"])}><option value="comparison">Comparison</option><option value="brief">Research brief</option><option value="evidence">Evidence board</option></select></label>
        <fieldset><legend>Shared sources · up to 10</legend>{eligible.map((tab) => <label key={tab.id} className="research-source-choice"><input type="checkbox" aria-label={`Use ${tab.title} as research evidence`} checked={selected.includes(tab.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, tab.id].slice(0, 10) : current.filter((id) => id !== tab.id))} /><Globe2 size={13} /><span><strong>{tab.title}</strong><small>{tab.url}</small></span></label>)}</fieldset>
        {!eligible.length ? <p className="research-empty"><ShieldCheck size={14} />Share tabs with the current Work conversation before adding them as evidence.</p> : null}
        {error ? <p className="recording-error">{error}</p> : null}
        <button className="research-generate" disabled={!selected.length || state.work.runtime !== "online"}><Sparkles size={14} />Generate cited board</button>
      </form>
      <aside className="research-board-list"><h2>Saved boards</h2>{state.research.boards.map((item) => <button key={item.id} onClick={() => void command({ type: "open-research-board", boardId: item.id })}><span><strong>{item.title}</strong><small>{item.sourceCount} sources · {new Date(item.updatedAt).toLocaleDateString()}</small></span><i className={item.status}>{item.status}</i></button>)}</aside>
    </div> : <ResearchArtifact board={board} state={state} />}
  </main>;
}

function ResearchArtifact({ board, state }: { board: ResearchBoardState; state: BrowserAppState }) {
  const sources = new Map(board.sources.map((source) => [source.sourceId, source]));
  const bundleReceipts = state.research.bundleReceipts.filter((receipt) => receipt.boardId === board.id);
  return <div className="research-artifact-layout">
    <article className="research-artifact">
      {board.status === "generating" ? <div className="research-progress"><span className="loading-ring" /><strong>Building a cited artifact</strong><p>{board.message}</p></div> : board.status === "error" ? <div className="research-progress error"><CircleAlert size={20} /><strong>Research stopped</strong><p>{board.message}</p></div> : <>
        <p className="research-summary">{board.summary}</p>
        {board.sections.map((section, sectionIndex) => <section key={`${section.heading}-${sectionIndex}`}><h2>{section.heading}</h2>{section.claims.map((claim, claimIndex) => <p className="research-claim" key={claimIndex}>{claim.text} <span>{claim.citations.map((citation, citationIndex) => {
          const source = sources.get(citation.sourceId); const number = board.sources.findIndex((item) => item.sourceId === citation.sourceId) + 1;
          return <a key={`${citation.passageId}-${citationIndex}`} href={`#source-${citation.sourceId}`} title={source?.passages.find((passage) => passage.passageId === citation.passageId)?.text}>[{number}]</a>;
        })}</span></p>)}</section>)}
      </>}
    </article>
    <aside className="research-evidence"><header><h2>Evidence</h2><div>{state.walrusMemory.usable ? <button disabled={board.status !== "ready"} title="Preview summary and cited conclusions before uploading" onClick={() => void command({ type: "begin-walrus-research-memory", boardId: board.id })}>Memory</button> : null}{state.walrusMemory.usable && state.walrusMemory.mode === "client-encrypted" ? <button disabled={board.status !== "ready" || state.walrusMemory.status === "publishing"} title="Package a signed, hash-verifiable Walrus quilt" onClick={() => void command({ type: "prepare-walrus-research-bundle", boardId: board.id, visibility: "public", includePassages: false, epochs: 5 })}>Publish bundle…</button> : null}<button disabled={board.status !== "ready"} onClick={() => void command({ type: "export-research-board", boardId: board.id, format: "markdown" })}>Markdown</button><button disabled={board.status !== "ready"} onClick={() => void command({ type: "export-research-board", boardId: board.id, format: "pdf" })}>PDF</button></div></header>{board.sources.map((source, index) => <details key={source.sourceId} id={`source-${source.sourceId}`}><summary><span>{index + 1}</span><span><strong>{source.title}</strong><small>{safeHostname(source.url)} · captured {new Date(source.capturedAt).toLocaleString()}</small></span><ChevronDown size={13} /></summary>{source.passages.map((passage) => <blockquote key={passage.passageId} id={passage.passageId}>{passage.text}</blockquote>)}</details>)}{bundleReceipts.length ? <section className="research-bundle-receipts"><h3>Published bundles</h3>{bundleReceipts.map((receipt) => <div key={receipt.id}><span><strong>{receipt.visibility === "public" ? "Public quilt" : "SEAL-encrypted quilt"}</strong><small>{receipt.network} · {receipt.epochs} epochs · {new Date(receipt.createdAt).toLocaleString()}</small><code title={receipt.quiltId}>{receipt.quiltId}</code></span><button type="button" title="Copy quilt ID" onClick={() => void navigator.clipboard.writeText(receipt.quiltId)}><Copy size={11} /></button></div>)}</section> : null}</aside>
  </div>;
}

function TabStewardSurface({ state, top }: { state: BrowserAppState; top: number }) {
  const [preview, setPreview] = useState<TabStewardPreviewState>({ suggestions: [], generatedAt: Date.now() });
  const [selected, setSelected] = useState<string[]>([]);
  const [bundleName, setBundleName] = useState("Resume later");
  const [bundleTabs, setBundleTabs] = useState<string[]>([]);
  const [bundles, setBundles] = useState<Array<{ id: string; name: string; tabCount: number; createdAt: number }>>([]);
  useEffect(() => { void Promise.all([window.locusBrowser.query({ type: "tab-steward-preview" }), window.locusBrowser.query({ type: "resume-bundles" })]).then(([suggestions, saved]) => { setPreview(suggestions as TabStewardPreviewState); setBundles(saved as typeof bundles); }); }, [state.tabs.length, state.groups.length, state.tabSteward.bundleCount]);
  return <main className="internal-page steward-surface" style={{ top, right: state.workOpen && !state.workOverlay ? state.workWidth : 0 }}>
    <header className="internal-page-heading"><span className="steward-mark"><Layers3 size={20} /></span><span><h1>AI Tab Steward</h1><p>Private, local suggestions. Nothing is moved or closed without your review.</p></span><button title="Close Tab Steward" onClick={() => void command({ type: "close-internal-surface" })}><X size={16} /></button></header>
    <div className="steward-layout"><section><h2>Suggestions <span>{preview.suggestions.length}</span></h2>{preview.suggestions.length ? preview.suggestions.map((suggestion) => <label className="steward-suggestion" key={suggestion.id}><input type="checkbox" aria-label={`Select ${suggestion.title}`} checked={selected.includes(suggestion.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, suggestion.id] : current.filter((id) => id !== suggestion.id))} /><span className={`steward-type ${suggestion.type}`}><Layers3 size={15} /></span><span><strong>{suggestion.title}</strong><small>{suggestion.detail} · {Math.round(suggestion.confidence * 100)}% confidence</small><i>{suggestion.tabIds.map((id) => state.tabs.find((tab) => tab.id === id)?.title).filter(Boolean).join(" · ")}</i></span></label>) : <div className="steward-empty"><Check size={22} /><strong>Your tabs look tidy</strong><p>Suggestions appear only for exact duplicates or high-confidence groups of at least three.</p></div>}<button className="steward-apply" disabled={!selected.length} onClick={() => void command({ type: "apply-tab-steward", suggestionIds: selected }).then(() => setSelected([]))}>Preview and apply {selected.length || ""}</button></section>
      <aside><h2>Resume Later</h2><input value={bundleName} onChange={(event) => setBundleName(event.target.value)} aria-label="Bundle name" /> <div className="bundle-tab-list">{state.tabs.filter((tab) => !tab.private && /^https?:\/\//.test(tab.url)).map((tab) => <label key={tab.id}><input type="checkbox" aria-label={`Include ${tab.title} in Resume Later bundle`} checked={bundleTabs.includes(tab.id)} onChange={(event) => setBundleTabs((current) => event.target.checked ? [...current, tab.id] : current.filter((id) => id !== tab.id))} /><span>{tab.title}</span></label>)}</div><div className="bundle-actions"><button disabled={!bundleTabs.length} onClick={() => void command({ type: "save-resume-bundle", name: bundleName, tabIds: bundleTabs, closeAfter: false }).then(() => setBundleTabs([]))}>Save bundle</button><button disabled={!bundleTabs.length} onClick={() => void command({ type: "save-resume-bundle", name: bundleName, tabIds: bundleTabs, closeAfter: true }).then(() => setBundleTabs([]))}>Save & close…</button></div><div className="saved-bundles">{bundles.map((bundle) => <div key={bundle.id}><button onClick={() => void command({ type: "open-resume-bundle", bundleId: bundle.id })}><strong>{bundle.name}</strong><small>{bundle.tabCount} tabs</small></button><button title="Delete bundle" onClick={() => void command({ type: "delete-resume-bundle", bundleId: bundle.id })}><Trash2 size={11} /></button></div>)}</div></aside>
    </div>
  </main>;
}

function WalrusMemoryPreview({ state }: { state: BrowserAppState }) {
  const draft = state.walrusMemory.draft!;
  const [note, setNote] = useState(draft.note);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true); setError("");
    try { await command({ type: "save-walrus-memory-draft", draftId: draft.id, note }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Walrus Memory could not save this preview"); }
    finally { setSaving(false); }
  };
  return <div className="walrus-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) void command({ type: "cancel-walrus-memory-draft" }); }}>
    <section className="walrus-preview" role="dialog" aria-modal="true" aria-labelledby="walrus-preview-title">
      <header><span><Database size={18} /></span><div><h2 id="walrus-preview-title">Save to Walrus Memory</h2><p>Review the exact bounded content before anything is uploaded.</p></div><button type="button" disabled={saving} aria-label="Close Walrus preview" onClick={() => void command({ type: "cancel-walrus-memory-draft" })}><X size={15} /></button></header>
      <dl><div><dt>Type</dt><dd>{draft.type === "page" ? "Shared page" : "Research summary"}</dd></div><div><dt>Title</dt><dd>{draft.title}</dd></div><div><dt>Source</dt><dd>{draft.sourceUrl}</dd></div><div><dt>Captured</dt><dd>{new Date(draft.capturedAt).toLocaleString()}</dd></div><div><dt>SHA-256</dt><dd><code>{draft.contentSha256}</code></dd></div></dl>
      <div className="walrus-preview-content"><span>Content to upload</span><pre>{draft.content}</pre></div>
      <label className="walrus-preview-note"><span>Optional note <small>{note.length}/{draft.maxNoteChars}</small></span><textarea rows={4} value={note} maxLength={draft.maxNoteChars} onChange={(event) => setNote(event.target.value)} placeholder="Add context that should travel with this memory…" /></label>
      <p className="walrus-preview-warning"><CircleAlert size={14} />{state.walrusMemory.mode === "client-encrypted" ? "Your embedding provider receives this plaintext; Locus encrypts it before the Walrus relayer receives it." : "The hosted relayer receives this plaintext after you click Save."}</p>
      {error ? <p className="recording-error" role="alert">{error}</p> : null}
      <footer><button type="button" disabled={saving} onClick={() => void command({ type: "cancel-walrus-memory-draft" })}>Cancel</button><button type="button" className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Waiting for Walrus…" : "Save to Walrus Memory"}</button></footer>
    </section>
  </div>;
}

function ResearchBundlePreview({ state }: { state: BrowserAppState }) {
  const draft = state.research.bundleDraft!;
  const [visibility, setVisibility] = useState(draft.visibility);
  const [includePassages, setIncludePassages] = useState(draft.includePassages);
  const [epochs, setEpochs] = useState(draft.epochs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = visibility !== draft.visibility || includePassages !== draft.includePassages || epochs !== draft.epochs;
  const refresh = async () => {
    setBusy(true); setError("");
    try { await command({ type: "prepare-walrus-research-bundle", boardId: draft.boardId, visibility, includePassages, epochs }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The research-bundle preview could not be prepared"); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    setBusy(true); setError("");
    try { await command({ type: "publish-walrus-research-bundle", draftId: draft.id }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The research bundle could not be published"); }
    finally { setBusy(false); }
  };
  return <div className="walrus-preview-backdrop" role="presentation">
    <section className="walrus-preview research-bundle-preview" role="dialog" aria-modal="true" aria-labelledby="bundle-preview-title">
      <header><span><ShieldCheck size={18} /></span><div><h2 id="bundle-preview-title">Publish verifiable research bundle</h2><p>Review the sanitized artifacts and their hashes before Locus signs and uploads one Walrus quilt.</p></div><button type="button" disabled={busy} aria-label="Close research bundle preview" onClick={() => void command({ type: "cancel-walrus-research-bundle" })}><X size={15} /></button></header>
      <div className="bundle-options"><label><span>Visibility</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="public">Public</option><option value="seal-encrypted">SEAL encrypted</option></select></label><label><span>Storage epochs</span><input aria-label="Walrus storage epochs" type="number" min={1} max={53} value={epochs} onChange={(event) => setEpochs(Math.max(1, Math.min(53, Number(event.target.value) || 1)))} /></label></div>
      <label className="bundle-passage-option"><input aria-label="Include captured passage text" type="checkbox" checked={includePassages} onChange={(event) => setIncludePassages(event.target.checked)} /><span><strong>Include captured passage text</strong><small>Off by default. Claims, citations, URLs, content hashes, and passage hashes are included either way.</small></span></label>
      {dirty ? <div className="bundle-refresh"><p>Options changed. Refresh the preview to recalculate every artifact hash.</p><button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "Preparing…" : "Refresh exact preview"}</button></div> : <>
        <dl><div><dt>Network</dt><dd>{draft.network}</dd></div><div><dt>Unsigned manifest SHA-256</dt><dd><code>{draft.unsignedManifestSha256}</code></dd></div></dl>
        <div className="bundle-file-list">{draft.files.map((file) => <div key={file.identifier}><span><strong>{file.identifier}</strong><small>{file.mediaType} · {file.bytes.toLocaleString()} bytes</small></span><code>{file.sha256}</code></div>)}</div>
        <div className="walrus-preview-content"><span>Sanitized Markdown preview</span><pre>{draft.previewMarkdown}</pre></div>
      </>}
      <p className="walrus-preview-warning"><CircleAlert size={14} />{visibility === "public" ? "Public bundles remain readable for the selected storage lifetime. Disconnecting Locus does not remove them." : "SEAL encryption protects file bytes, but account delegates are an authorization boundary—not separate namespace principals."} The dedicated signer must have enough SUI and WAL; final cost depends on network pricing and artifact size.</p>
      {includePassages ? <p className="bundle-passage-warning" role="alert"><CircleAlert size={14} />Captured source text is included. Locus will require one more explicit confirmation before publishing.</p> : null}
      {error ? <p className="recording-error" role="alert">{error}</p> : null}
      <footer><button type="button" disabled={busy} onClick={() => void command({ type: "cancel-walrus-research-bundle" })}>Cancel</button><button type="button" className="primary" disabled={busy || dirty} onClick={() => void publish()}>{busy || state.walrusMemory.status === "publishing" ? "Signing and publishing…" : "Sign and publish quilt"}</button></footer>
    </section>
  </div>;
}

function SidebarList({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <><div className="sidebar-heading"><span>{title}</span><span>{count}</span></div><div className="sidebar-list">{children}</div></>;
}

function EmptyLibrary({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div className="sidebar-empty">{icon}<span>{text}</span></div>;
}

function SidebarItem({ icon, label, section, active }: { icon: React.ReactNode; label: string; section: SidebarSection; active: boolean }) {
  return <button className={active ? "active" : ""} onClick={() => void command({ type: "set-sidebar-section", section })}>{icon}<span>{label}</span></button>;
}

function renameGroup(groupId: string, currentName: string): void {
  const name = window.prompt("Rename tab group", currentName);
  if (name?.trim()) void command({ type: "rename-tab-group", groupId, name: name.trim() });
}

function deleteGroup(groupId: string, name: string): void {
  if (window.confirm(`Delete “${name}”? Its tabs will stay open.`)) void command({ type: "delete-tab-group", groupId });
}

function deleteRecordingTranscript(recordingId: string): void {
  if (window.confirm("Delete this encrypted transcript from this Mac? This cannot be undone.")) {
    void command({ type: "delete-recording-transcript", recordingId });
  }
}

function navigateRadioGroup(event: React.KeyboardEvent<HTMLButtonElement>): void {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const buttons = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button[role='radio']") ?? []);
  if (!buttons.length) return;
  event.preventDefault();
  const current = Math.max(buttons.indexOf(event.currentTarget), 0);
  const nextIndex = event.key === "Home" ? 0
    : event.key === "End" ? buttons.length - 1
    : event.key === "ArrowRight" || event.key === "ArrowDown" ? (current + 1) % buttons.length
    : (current - 1 + buttons.length) % buttons.length;
  buttons[nextIndex]?.focus();
  buttons[nextIndex]?.click();
}

function safeHostname(origin: string): string {
  try { return new URL(origin).hostname || origin; } catch { return origin; }
}

function shortDevice(deviceId: string): string {
  return `Device ${deviceId.slice(0, 6)}`;
}

function formatTime(timestamp: number): string {
  return historyDateFormatter.format(new Date(timestamp * 1_000));
}

function formatProgress(received: number, total: number): string {
  if (total <= 0) return `${formatBytes(received)} downloaded`;
  return `${Math.min(Math.round((received / total) * 100), 100)}% · ${formatBytes(total)}`;
}

function formatRecordingDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function LoadingSurface() {
  return <div className="loading-surface"><Sparkles size={22} /><span>Opening Locus Browser…</span></div>;
}

async function command(value: BrowserCommand) {
  return await window.locusBrowser.command(value);
}

const historyDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
