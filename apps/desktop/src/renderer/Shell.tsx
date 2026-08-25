import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bookmark, Bot, Check, ChevronDown,
  CircleAlert, Clock3, Cloud, CloudOff, Copy, Download, EyeOff, FileDown, FolderPlus, Globe2, History,
  KeyRound, Laptop, Layers3, LayoutList, LockKeyhole, LogIn, LogOut, Minus, Monitor, Moon, MoreHorizontal, PanelLeft,
  BookOpenText, Columns2, Command as CommandIcon, LibraryBig, Mic, Pause, Play, Plus, Printer, Puzzle, RefreshCw, Search, Settings, ShieldCheck,
  Sparkles, Square, Sun, Trash2, UserRound, UsersRound, Video, Volume2, VolumeX, X,
} from "lucide-react";
import type { BrowserCommand } from "../shared/ipc.js";
import type { Appearance, BrowserAppState, BrowserTabState, PaletteResultState, ResearchBoardState, SearchEngine, SemanticRecallResultState, SidebarSection, TabStewardPreviewState } from "../shared/types.js";
import { useBrowserState } from "./useBrowserState.js";

const searchProviders: Array<{ id: SearchEngine; name: string; detail: string; mark: string }> = [
  { id: "duckduckgo", name: "DuckDuckGo", detail: "Privacy-focused", mark: "D" },
  { id: "brave", name: "Brave Search", detail: "Independent index", mark: "B" },
  { id: "google", name: "Google", detail: "Familiar results", mark: "G" },
  { id: "bing", name: "Bing", detail: "Microsoft search", mark: "B" },
];

export function Shell() {
  const state = useBrowserState();
  const [address, setAddress] = useState("");
  const [addressFocused, setAddressFocused] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordMenuOpen, setPasswordMenuOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const active = state?.tabs.find((tab) => tab.id === state.activeTabId);

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
    <div className={`browser-shell theme-${state.settings.appearance} ${state.privateWindow ? "private-window" : ""}`}>
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
      {state.internalSurface?.type === "settings" ? <SettingsSurface state={state} top={chromeHeight} /> : null}
      {state.internalSurface?.type === "research" ? <ResearchSurface state={state} top={chromeHeight} {...(state.internalSurface.boardId ? { boardId: state.internalSurface.boardId } : {})} /> : null}
      {state.internalSurface?.type === "tab-steward" ? <TabStewardSurface state={state} top={chromeHeight} /> : null}
      {state.paletteOpen ? <CommandPalette state={state} top={chromeHeight} /> : null}
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
    <main className={`onboarding-shell theme-${appearance}`}>
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
    </div> : <ResearchArtifact board={board} />}
  </main>;
}

function ResearchArtifact({ board }: { board: ResearchBoardState }) {
  const sources = new Map(board.sources.map((source) => [source.sourceId, source]));
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
    <aside className="research-evidence"><header><h2>Evidence</h2><div><button disabled={board.status !== "ready"} onClick={() => void command({ type: "export-research-board", boardId: board.id, format: "markdown" })}>Markdown</button><button disabled={board.status !== "ready"} onClick={() => void command({ type: "export-research-board", boardId: board.id, format: "pdf" })}>PDF</button></div></header>{board.sources.map((source, index) => <details key={source.sourceId} id={`source-${source.sourceId}`}><summary><span>{index + 1}</span><span><strong>{source.title}</strong><small>{safeHostname(source.url)} · captured {new Date(source.capturedAt).toLocaleString()}</small></span><ChevronDown size={13} /></summary>{source.passages.map((passage) => <blockquote key={passage.passageId} id={passage.passageId}>{passage.text}</blockquote>)}</details>)}</aside>
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

function SettingsSurface({ state, top }: { state: BrowserAppState; top: number }) {
  const openSection = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start" });
  return (
    <main className="settings-surface" style={{ top, right: state.workOpen && !state.workOverlay ? state.workWidth : 0 }} aria-label="Locus Browser settings">
      <header className="settings-page-heading">
        <span className="settings-page-mark"><Settings size={19} /></span>
        <span><h1>Settings</h1><p>Personalize Locus Browser and control what runs on this Mac.</p></span>
        <button type="button" title="Close settings" onClick={() => void command({ type: "close-settings" })}><X size={16} /></button>
      </header>
      <div className="settings-page-layout">
        <nav className="settings-page-nav" aria-label="Settings sections">
          <button type="button" onClick={() => openSection("settings-general")}><Settings size={15} /><span>General</span></button>
          <button type="button" onClick={() => openSection("settings-models")}><Bot size={15} /><span>AI models</span></button>
          <button type="button" onClick={() => openSection("settings-speech")}><Mic size={15} /><span>Speech</span></button>
          <button type="button" onClick={() => openSection("settings-extensions")}><Puzzle size={15} /><span>Extensions</span></button>
          <button type="button" onClick={() => openSection("settings-profiles")}><UserRound size={15} /><span>Profiles</span></button>
          <button type="button" onClick={() => openSection("settings-privacy")}><ShieldCheck size={15} /><span>Privacy</span></button>
          {!state.privateWindow ? <button type="button" onClick={() => openSection("settings-sync")}><Cloud size={15} /><span>Sync</span></button> : null}
        </nav>
        <div className="settings-page-scroll">
          <section className="settings-page-section" id="settings-general">
            <SettingsSectionHeading title="General" detail="Browser appearance, search, downloads, and background tabs." />
            <div className="settings-card settings-general-grid">
              <SettingRow label="Appearance" detail="Uses the Locus palette">
                <select value={state.settings.appearance} onChange={(event) => void command({ type: "set-appearance", appearance: event.target.value as BrowserAppState["settings"]["appearance"] })}>
                  <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
                </select>
              </SettingRow>
              <SettingRow label="Search engine" detail="Used for omnibox searches">
                <select value={state.settings.searchEngine} onChange={(event) => void command({ type: "set-search-engine", searchEngine: event.target.value as BrowserAppState["settings"]["searchEngine"] })}>
                  <option value="duckduckgo">DuckDuckGo</option><option value="brave">Brave</option><option value="google">Google</option><option value="bing">Bing</option>
                </select>
              </SettingRow>
              <SettingRow label="Sleep background tabs" detail="Never sleeps audio, downloads, or shared tabs">
                <select value={state.settings.sleepAfterMinutes} onChange={(event) => void command({ type: "set-sleep-after", minutes: Number(event.target.value) as 0 | 15 | 30 | 60 })}>
                  <option value={0}>Never</option><option value={15}>After 15 minutes</option><option value={30}>After 30 minutes</option><option value={60}>After 1 hour</option>
                </select>
              </SettingRow>
              <SettingRow label="Downloads" detail={state.settings.downloadDirectory}>
                <button type="button" onClick={() => void command({ type: "choose-download-directory" })}>Choose folder…</button>
              </SettingRow>
            </div>
          </section>

          <ModelSettings state={state} />

          <section className="settings-page-section settings-component-section" id="settings-speech">
            <SettingsSectionHeading title="Speech" detail="Choose how live browser audio is transcribed." />
            <div className="settings-card"><SpeechSettings state={state} /></div>
          </section>

          <section className="settings-page-section settings-component-section" id="settings-extensions">
            <SettingsSectionHeading title="Extensions" detail="Manage verified gallery extensions and Developer Mode." />
            <div className="settings-card"><ExtensionSettings state={state} /></div>
          </section>

          <section className="settings-page-section" id="settings-profiles">
            <SettingsSectionHeading title="Profiles" detail="Keep cookies, browsing data, and extensions separate." />
            <div className="settings-card settings-list-card">
              {state.profiles.map((profile) => (
                <div className="permission-setting" key={profile.id}>
                  <span><strong>{profile.name}</strong><small>{profile.id === state.profileId ? "Current profile" : "Separate cookies and browsing data"}</small></span>
                  {profile.id !== "default" && profile.id !== state.profileId
                    ? <button title={`Delete ${profile.name}`} onClick={() => deleteProfile(profile.id, profile.name)}><X size={11} /></button>
                    : null}
                </div>
              ))}
            </div>
          </section>

          <section className="settings-page-section" id="settings-privacy">
            <SettingsSectionHeading title="Privacy and security" detail="Passwords stay OS-encrypted and are never available to agents." />
            <div className="settings-card settings-list-card">
              <div className="settings-subheading">Private Semantic Recall</div>
              <button type="button" role="switch" aria-checked={state.settings.semanticRecallEnabled} className="local-model-toggle" disabled={state.privateWindow} onClick={() => void command({ type: "set-semantic-recall-enabled", enabled: !state.settings.semanticRecallEnabled })}>
                <span><strong>Recall pages on this Mac</strong><small>Opt-in. Eligible pages visited from now on are encrypted locally; private pages, fields, local files, and internal pages are excluded.</small></span>
                <span className={`settings-switch ${state.settings.semanticRecallEnabled ? "on" : ""}`} aria-hidden="true"><span /></span>
              </button>
              <div className="recall-settings-status"><span><strong>{state.semanticRecall.documentCount} indexed pages</strong><small>{formatBytes(state.semanticRecall.storageBytes)} of {formatBytes(state.semanticRecall.capBytes)} · {state.semanticRecall.message}</small></span><button type="button" onClick={() => addRecallExclusion()}>Exclude site…</button><button type="button" className="danger" disabled={!state.semanticRecall.documentCount} onClick={() => clearRecallData()}>Clear Recall Data</button></div>
              {state.semanticRecall.excludedOrigins.length ? <div className="recall-exclusions">{state.semanticRecall.excludedOrigins.map((origin) => <span key={origin}>{origin}<button title={`Allow recall on ${origin}`} onClick={() => void command({ type: "remove-recall-exclusion", origin })}><X size={10} /></button></span>)}</div> : null}
              <div className="settings-subheading">Passwords</div>
              {!state.passwordManagerAvailable && <p className="settings-empty">OS-backed password encryption is unavailable on this Mac.</p>}
              {state.savedCredentials.length ? state.savedCredentials.map((credential) => (
                <div className="permission-setting credential-setting" key={credential.id}>
                  <span><strong>{credential.username || "No username"}</strong><small>{safeHostname(credential.origin)} · Updated {formatTime(credential.updatedAt)}</small></span>
                  <button title={`Delete saved login for ${safeHostname(credential.origin)}`} onClick={() => deleteCredential(credential.id, credential.origin)}><X size={11} /></button>
                </div>
              )) : state.passwordManagerAvailable ? <p className="settings-empty">Saved logins will appear here. Passwords are never shown in browser chrome or Work Mode.</p> : null}
              <div className="settings-subheading">Site permissions</div>
              {state.sitePermissions.length ? state.sitePermissions.map((permission) => (
                <div className="permission-setting" key={`${permission.origin}:${permission.permission}`}>
                  <span><strong>{safeHostname(permission.origin)}</strong><small>{permission.permission} · {permission.decision}</small></span>
                  <button title="Ask again" onClick={() => void command({ type: "reset-site-permission", origin: permission.origin, permission: permission.permission })}><X size={11} /></button>
                </div>
              )) : <p className="settings-empty">Sites you allow or block will appear here.</p>}
            </div>
          </section>

          {!state.privateWindow ? (
            <section className="settings-page-section settings-component-section" id="settings-sync">
              <SettingsSectionHeading title="Locus encrypted sync" detail="Optional end-to-end encrypted sync for browser data." />
              <div className="settings-card"><SyncSettings state={state} /></div>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function SettingsSectionHeading({ title, detail }: { title: string; detail: string }) {
  return <header className="settings-section-heading"><h2>{title}</h2><p>{detail}</p></header>;
}

function ModelSettings({ state }: { state: BrowserAppState }) {
  const primaryProviders = state.work.model.providers.filter((provider) => provider.id !== "local");
  return (
    <section className="settings-page-section" id="settings-models">
      <SettingsSectionHeading title="AI models" detail="Choose which model sources appear in Work Mode." />
      <div className="settings-card model-settings-card">
        <div className="model-context-guidance" role="note">
          <CircleAlert size={16} />
          <span><strong>Use a large-context model for browser work</strong><small>128K context is the practical minimum for shorter sessions. 200K or more is recommended for long pages, recordings, and multi-step work.</small></span>
        </div>
        <div className="primary-model-sources" aria-label="Primary model sources">
          {primaryProviders.map((provider) => <span key={provider.id}><i>{provider.mark}</i>{provider.name}</span>)}
        </div>
        <button type="button" role="switch" aria-checked={state.settings.localModelsEnabled} className="local-model-toggle" onClick={() => void command({ type: "set-local-models-enabled", enabled: !state.settings.localModelsEnabled })}>
          <span><strong>Local Work models</strong><small>Show Ollama models in the Work model picker. Off by default because local inference can slow browsing.</small></span>
          <span className={`settings-switch ${state.settings.localModelsEnabled ? "on" : ""}`} aria-hidden="true"><span /></span>
        </button>
        <p className="local-model-note">This setting affects Work Mode only. On-device speech transcription remains available separately.</p>
      </div>
    </section>
  );
}

function SpeechSettings({ state }: { state: BrowserAppState }) {
  const speech = state.settings.speech;
  const [engine, setEngine] = useState(speech.engine);
  const [baseUrl, setBaseUrl] = useState(speech.customBaseUrl ?? "https://");
  const [model, setModel] = useState(speech.customModel ?? "whisper-1");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const save = async (engine: BrowserAppState["settings"]["speech"]["engine"] = speech.engine) => {
    setError("");
    try {
      await command({
        type: "configure-speech", engine, language: speech.language,
        ...(engine === "custom" ? { baseUrl, model, ...(apiKey ? { apiKey } : {}) } : {}),
      });
      setApiKey("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Speech settings could not be saved");
    }
  };
  return (
    <section className="speech-settings" aria-labelledby="speech-settings-title">
      <div className="settings-subheading" id="speech-settings-title">Speech</div>
      <div className="speech-card">
        <label><span><strong>Transcription</strong><small>Used only during a visible live recording</small></span><select value={engine} onChange={(event) => { const next = event.target.value as typeof speech.engine; setEngine(next); if (next !== "custom") void save(next); }}><option value="local">On-device</option><option value="openai">OpenAI API</option><option value="custom">Custom endpoint</option></select></label>
        {engine === "local" ? (
          <div className="speech-runtime-row"><span><strong>{speech.localModelStatus === "ready" ? "Ready on this Mac" : "Model download required"}</strong><small>{speech.message || "A checksummed multilingual Whisper model is stored locally."}</small></span>{speech.localModelStatus !== "ready" ? <button type="button" disabled={speech.localModelStatus === "downloading"} onClick={() => void command({ type: "download-speech-model" })}>{speech.localModelStatus === "downloading" ? `${Math.round((speech.localModelProgress ?? 0) * 100)}%` : "Download"}</button> : <Check size={13} />}</div>
        ) : engine === "openai" ? (
          <p>Uses the encrypted OpenAI API credential from the model picker and <code>gpt-4o-mini-transcribe</code>. Short audio chunks leave this Mac; raw audio is never stored.</p>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void save("custom"); }}>
            <label><span>HTTPS or loopback URL</span><input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://speech.example.com/v1" /></label>
            <label><span>Model</span><input value={model} onChange={(event) => setModel(event.target.value)} /></label>
            <label><span>API key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Leave blank to keep saved key" autoComplete="off" /></label>
            <button type="submit">Save custom speech</button>
          </form>
        )}
        {error ? <p className="recording-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}

function ExtensionSettings({ state }: { state: BrowserAppState }) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const run = async (key: string, value: BrowserCommand) => {
    setBusy(key);
    setError(undefined);
    try {
      await command(value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Extension request failed");
    } finally {
      setBusy(undefined);
    }
  };
  const manager = state.extensions;
  const gallery = manager.gallery ?? {
    status: "disabled" as const,
    message: "The curated extension gallery is unavailable.",
    entries: [],
  };
  return (
    <section className="extension-settings" aria-labelledby="extension-settings-title">
      <div className="settings-subheading" id="extension-settings-title">Extensions</div>
      {state.privateWindow ? (
        <div className="extension-private-note"><EyeOff size={14} /><span><strong>Off in Private Windows</strong><small>Extensions cannot inspect or change private pages.</small></span></div>
      ) : (
        <>
          <div className="extension-gallery-heading">
            <span><span className="extension-icon verified"><ShieldCheck size={15} /></span><span><strong>Curated gallery</strong><small>Every download is independently verified before installation.</small></span></span>
            <button
              type="button"
              disabled={Boolean(busy) || gallery.status === "loading"}
              onClick={() => void run("refresh-gallery", { type: "refresh-extension-gallery" })}
            ><RefreshCw size={11} />Refresh</button>
          </div>
          <p className={`extension-gallery-status ${gallery.status === "error" ? "error" : ""}`} role={gallery.status === "error" ? "alert" : undefined}>{gallery.message}</p>
          {gallery.entries.length ? (
            <div className="extension-gallery-list">
              {gallery.entries.map((extension) => (
                <article className="extension-gallery-item" key={extension.id}>
                  <header><span><strong>{extension.name}</strong><small>{extension.version} · {formatBytes(extension.packageSize)}</small></span><button
                    type="button"
                    disabled={Boolean(busy) || gallery.status !== "ready" || extension.action === "installed"}
                    onClick={() => void run(`gallery-${extension.id}`, { type: "install-gallery-extension", extensionId: extension.id })}
                  >{extension.action === "update" ? `Update from ${extension.installedVersion}` : extension.action === "installed" ? "Installed" : "Install"}</button></header>
                  {extension.description ? <p>{extension.description}</p> : null}
                  <div className="extension-verification"><ShieldCheck size={11} /><span>Publisher {extension.verifiedPublisher}</span></div>
                  <div className="extension-access"><span>APIs · {extension.permissions.length || "None"}</span><span>Sites · {extension.hostPermissions.length || "None"}</span></div>
                </article>
              ))}
            </div>
          ) : null}
          <div className="extension-gallery-card">
            <span className="extension-icon"><FolderPlus size={15} /></span>
            <span><strong>Signed package file</strong><small>Install a trusted `.locusx` file you already downloaded.</small></span>
            <button
              type="button"
              disabled={Boolean(busy) || manager.loading || manager.trustedGalleryKeyCount === 0}
              onClick={() => void run("install-signed", { type: "install-signed-extension" })}
            >Install…</button>
          </div>
          <div className="extension-developer-card">
            <span className="extension-icon"><Puzzle size={15} /></span>
            <span><strong>Developer Mode</strong><small>Load reviewed, unpacked MV3 extensions for this profile only.</small></span>
            <button
              type="button"
              role="switch"
              aria-checked={manager.developerMode}
              aria-label="Extension Developer Mode"
              className={`settings-switch ${manager.developerMode ? "on" : ""}`}
              disabled={Boolean(busy) || manager.loading}
              onClick={() => void run("developer-mode", { type: "set-extension-developer-mode", enabled: !manager.developerMode })}
            ><span /></button>
          </div>
          <p className="extension-contract">{manager.message} {manager.trustedGalleryKeyCount} trusted gallery key · {manager.supportedApiCount} current engine-backed permission groups. Unsupported capabilities and remote executable code are rejected.</p>
          {error ? <p className="extension-error" role="alert"><CircleAlert size={12} />{error}</p> : null}
          <button
            className="extension-load-button"
            type="button"
            disabled={!manager.developerMode || Boolean(busy) || manager.loading}
            onClick={() => void run("install", { type: "install-unpacked-extension" })}
          ><FolderPlus size={13} />Load unpacked extension…</button>
          {manager.installs.length ? (
            <div className="extension-list">
              {manager.installs.map((extension) => {
                const attention = Boolean(extension.error);
                const needsGalleryInstall = extension.source === "gallery" && !extension.installPath;
                const status = needsGalleryInstall ? "Not on this Mac" : attention ? "Needs attention" : extension.loaded ? "Loaded" : extension.source === "developer" && extension.enabled && !manager.developerMode ? "Developer Mode off" : extension.enabled ? "Waiting" : "Disabled";
                const disableToggle = Boolean(busy) || manager.loading || needsGalleryInstall || (extension.source === "developer" && !manager.developerMode);
                const nextEnabled = attention ? true : !extension.enabled;
                return (
                  <article className={`extension-card ${attention ? "attention" : ""}`} key={extension.id}>
                    <header><span className="extension-icon"><Puzzle size={14} /></span><span><strong>{extension.name}</strong><small>{extension.version} · {extension.source === "developer" ? "Unpacked" : "Gallery"}</small></span><i className={extension.loaded ? "loaded" : attention ? "attention" : ""}>{status}</i></header>
                    {extension.description ? <p>{extension.description}</p> : null}
                    {extension.source === "developer" && extension.installPath ? <small className="extension-path" title={extension.installPath}>{extension.installPath}</small> : null}
                    {extension.source === "gallery" && extension.galleryKeyName ? <div className="extension-verification"><ShieldCheck size={11} /><span>{extension.galleryKeyName}{extension.verifiedPublisher ? ` · Publisher ${extension.verifiedPublisher}` : ""}</span></div> : null}
                    <div className="extension-access"><span>APIs · {extension.permissions.length || "None"}</span><span>Sites · {extension.hostPermissions.length || "None"}</span></div>
                    {attention ? <p className="extension-card-error"><CircleAlert size={11} />{extension.error}</p> : null}
                    <footer>
                      {extension.rollbackVersion ? <button type="button" disabled={Boolean(busy) || manager.loading} onClick={() => void run(`rollback-${extension.id}`, { type: "rollback-extension", extensionId: extension.id })}>Roll back to {extension.rollbackVersion}</button> : null}
                      <button type="button" disabled={disableToggle} onClick={() => void run(extension.id, { type: "set-extension-enabled", extensionId: extension.id, enabled: nextEnabled })}>{needsGalleryInstall ? "Gallery required" : attention ? "Review & enable" : extension.enabled ? "Disable" : "Enable"}</button>
                      <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => void run(`remove-${extension.id}`, { type: "remove-extension", extensionId: extension.id })}>Remove</button>
                    </footer>
                  </article>
                );
              })}
            </div>
          ) : <p className="settings-empty">No extensions installed in this profile.</p>}
        </>
      )}
    </section>
  );
}

function SyncSettings({ state }: { state: BrowserAppState }) {
  const [serviceUrl, setServiceUrl] = useState(state.sync.serviceUrl ?? state.configuredSyncServiceUrl ?? "");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [connectionMethod, setConnectionMethod] = useState<"create" | "recover" | "device">("create");
  const [pairingCode, setPairingCode] = useState("");
  const [formError, setFormError] = useState<string>();
  const busy = state.sync.status === "connecting" || state.sync.status === "syncing";
  const serviceConfigured = Boolean(serviceUrl);
  const connected = Boolean(state.sync.accountId);
  const run = async (action: () => Promise<unknown>) => {
    setFormError(undefined);
    try { await action(); } catch (error) { setFormError(error instanceof Error ? error.message : "Sync request failed"); }
  };
  const register = (event: React.FormEvent) => {
    event.preventDefault();
    void run(() => command({ type: "begin-sync-registration", displayName: state.currentProfile.name, serviceUrl }));
  };
  const signIn = (event: React.FormEvent) => {
    event.preventDefault();
    void run(() => command({ type: "begin-sync-sign-in", recoveryKey, serviceUrl }));
  };
  const enroll = (event: React.FormEvent) => {
    event.preventDefault();
    void run(() => command({ type: "begin-sync-device-enrollment", serviceUrl }));
  };
  const approve = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await command({ type: "approve-sync-device", pairingCode });
      setPairingCode("");
    });
  };
  const pendingEnrollment = state.sync.pendingEnrollment;
  return (
    <section className="sync-settings" aria-labelledby="sync-settings-title">
      <div className="settings-subheading" id="sync-settings-title">Locus encrypted sync</div>
      {connected ? (
        <div className="sync-card">
          <div className="sync-card-heading">
            <span className={`sync-status-icon ${state.sync.status}`}><Cloud size={15} /></span>
            <span><strong>{state.sync.status === "syncing" ? "Syncing…" : state.sync.status === "error" ? "Sync needs attention" : "End-to-end encrypted"}</strong>
              <small>{state.sync.lastSyncedAt ? `Last synced ${formatTime(state.sync.lastSyncedAt)}` : "Ready for its first sync"}</small></span>
          </div>
          {state.sync.lastError && <p className="sync-error" role="alert">{state.sync.lastError}</p>}
          <p className="sync-privacy">Bookmarks, history, tab groups, open web tabs, selected settings, and gallery extension metadata. Never passwords, cookies, downloads, workspaces, or Locus sessions.</p>
          <div className="sync-actions">
            <button className="primary" disabled={busy} onClick={() => void command({ type: "sync-now" })}><Cloud size={12} /> Sync now{state.sync.pendingRecords ? ` · ${state.sync.pendingRecords}` : ""}</button>
            <button disabled={busy} onClick={() => disconnectSync()}><LogOut size={12} /> Disconnect</button>
          </div>
          <div className="sync-section-heading"><span>Devices</span><small>{state.sync.devices.length}</small></div>
          <div className="sync-device-list">
            {state.sync.devices.map((device) => (
              <div className="sync-device" key={device.deviceId}>
                <span className="sync-device-icon"><Laptop size={12} /></span>
                <span><strong>{device.name}</strong><small>{device.current ? "This Mac" : `Seen ${formatTime(device.lastSeenAt)}`} · Key v{device.keyVersion}</small></span>
                {!device.current && <button title={`Revoke ${device.name}`} disabled={busy} onClick={() => void run(() => command({ type: "revoke-sync-device", deviceId: device.deviceId }))}><X size={11} /></button>}
              </div>
            ))}
          </div>
          <details className="sync-device-add">
            <summary><Plus size={11} /> Approve another device</summary>
            <form className="sync-form" onSubmit={approve}>
              <label><span>Pairing code from the new device</span><textarea required rows={3} value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} placeholder="LOCUS-DEVICE:…" autoComplete="off" spellCheck={false} /></label>
              <button className="sync-connect primary" type="submit" disabled={busy}><ShieldCheck size={12} /> Review device</button>
            </form>
          </details>
          <div className="sync-recovery-row">
            <span><strong>Recovery key</strong><small>Version {state.sync.keyVersion ?? 1} · rotating updates every active device</small></span>
            <button disabled={busy} onClick={() => void run(() => command({ type: "rotate-sync-recovery-key" }))}><RefreshCw size={11} /> Rotate</button>
          </div>
          <details className="sync-danger">
            <summary>Cloud data controls</summary>
            <p>Deleting cloud data keeps this Mac connected. Local data can upload again on a later sync.</p>
            <div className="sync-actions">
              <button disabled={busy} onClick={() => deleteSyncCloudData()}><CloudOff size={12} /> Delete cloud data</button>
              <button className="danger" disabled={busy} onClick={() => deleteSyncAccount()}><X size={12} /> Delete account</button>
            </div>
          </details>
        </div>
      ) : (
        <div className="sync-card">
          <div className="sync-card-heading"><span className="sync-status-icon"><ShieldCheck size={15} /></span><span><strong>Optional and private</strong><small>A passkey protects your account. Locus cannot decrypt your browser data.</small></span></div>
          {pendingEnrollment ? (
            <div className="sync-pairing" aria-live="polite">
              <span className="sync-pairing-mark"><Laptop size={15} /></span>
              <strong>Approve this Mac from another device</strong>
              <p>On an already connected device, open Settings → Locus encrypted sync → Approve another device, then paste this code.</p>
              <code>{pendingEnrollment.pairingCode}</code>
              {(formError || state.sync.lastError) && <p className="sync-error" role="alert">{formError ?? state.sync.lastError}</p>}
              <div className="sync-actions">
                <button className="primary" onClick={() => void command({ type: "copy-sync-pairing-code" })}><Copy size={11} /> Copy code</button>
                <button onClick={() => void command({ type: "check-sync-device-enrollment" })}><RefreshCw size={11} /> Check again</button>
                <button onClick={() => void command({ type: "cancel-sync-device-enrollment" })}>Cancel</button>
              </div>
              <small>Expires {formatTime(pendingEnrollment.expiresAt)}</small>
            </div>
          ) : (
            <>
              <div className="sync-methods" role="radiogroup" aria-label="Connect to Locus Sync">
                {(["create", "recover", "device"] as const).map((method) => (
                  <button key={method} role="radio" aria-checked={connectionMethod === method} className={connectionMethod === method ? "active" : ""} onKeyDown={navigateRadioGroup} onClick={() => { setConnectionMethod(method); setFormError(undefined); }}>
                    {method === "create" ? "New" : method === "recover" ? "Recovery" : "Device"}
                  </button>
                ))}
              </div>
              <form className="sync-form" onSubmit={connectionMethod === "create" ? register : connectionMethod === "recover" ? signIn : enroll}>
                <label><span>Sync service</span><input type="url" required readOnly={Boolean(state.configuredSyncServiceUrl)} value={serviceUrl} onChange={(event) => setServiceUrl(event.target.value)} placeholder="Not configured in this build" /></label>
                {connectionMethod === "recover" && <label><span>Recovery key</span><textarea required rows={3} value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} placeholder="LOCUS-…" autoComplete="off" spellCheck={false} /></label>}
                <p className="sync-method-detail">{connectionMethod === "create" ? "Create an account with a passkey and receive a one-time recovery key." : connectionMethod === "recover" ? "Use your passkey and recovery key on this Mac." : "Get a pairing code and approve this Mac from a connected device—no recovery key needed."}</p>
                {!serviceConfigured && <p className="sync-error" role="status">Encrypted sync is disabled in this build.</p>}
                {(formError || state.sync.lastError) && <p className="sync-error" role="alert">{formError ?? state.sync.lastError}</p>}
                <button className="sync-connect primary" type="submit" disabled={busy || !serviceConfigured}>
                  {connectionMethod === "create" ? <KeyRound size={13} /> : connectionMethod === "recover" ? <LogIn size={13} /> : <Laptop size={13} />}
                  {busy ? "Waiting for passkey…" : connectionMethod === "create" ? "Create sync account" : connectionMethod === "recover" ? "Sign in with recovery key" : "Get pairing code"}
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function SettingRow({ label, detail, children }: { label: string; detail: string; children: React.ReactNode }) {
  return <label className="setting-row"><span><strong>{label}</strong><small>{detail}</small></span>{children}</label>;
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

function deleteProfile(profileId: string, name: string): void {
  if (window.confirm(`Delete the “${name}” profile and its local browsing data? This cannot be undone.`)) {
    void command({ type: "delete-profile", profileId });
  }
}

function deleteCredential(credentialId: string, origin: string): void {
  if (window.confirm(`Delete the saved login for ${safeHostname(origin)}? This cannot be undone.`)) {
    void command({ type: "delete-credential", credentialId });
  }
}

function deleteRecordingTranscript(recordingId: string): void {
  if (window.confirm("Delete this encrypted transcript from this Mac? This cannot be undone.")) {
    void command({ type: "delete-recording-transcript", recordingId });
  }
}

function addRecallExclusion(): void {
  const value = window.prompt("Exclude a website from Private Recall", "https://");
  if (!value?.trim()) return;
  try { void command({ type: "add-recall-exclusion", origin: new URL(value.trim()).origin }); }
  catch { window.alert("Enter a valid http or https website address."); }
}

function clearRecallData(): void {
  if (window.confirm("Delete every encrypted Private Recall page from this profile? Bookmarks and normal history will stay.")) void command({ type: "clear-semantic-recall" });
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

function disconnectSync(): void {
  if (window.confirm("Disconnect sync from this profile? Local browser data will stay on this Mac.")) void command({ type: "disconnect-sync" });
}

function deleteSyncCloudData(): void {
  if (window.confirm("Delete all encrypted browser data stored in the cloud? It can upload again if this profile remains connected.")) void command({ type: "delete-sync-cloud-data" });
}

function deleteSyncAccount(): void {
  if (window.confirm("Permanently delete this sync account, its devices, passkeys, and all encrypted cloud data? Local browser data will stay on this Mac.")) void command({ type: "delete-sync-account" });
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
