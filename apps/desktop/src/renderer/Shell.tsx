import { useEffect, useRef, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bookmark, Bot, Check, ChevronDown,
  CircleAlert, Clock3, Cloud, CloudOff, Copy, Download, EyeOff, FileDown, FolderPlus, Globe2, History,
  KeyRound, Laptop, Layers3, LayoutList, LockKeyhole, LogIn, LogOut, Minus, Monitor, Moon, MoreHorizontal, PanelLeft,
  Pause, Play, Plus, Printer, Puzzle, RefreshCw, Search, Settings, ShieldCheck,
  Sparkles, Square, Sun, UserRound, UsersRound, Volume2, VolumeX, X,
} from "lucide-react";
import type { BrowserCommand } from "../shared/ipc.js";
import type { Appearance, BrowserAppState, BrowserTabState, SearchEngine, SidebarSection } from "../shared/types.js";
import { useBrowserState } from "./useBrowserState.js";

const searchProviders: Array<{ id: SearchEngine; name: string; detail: string; mark: string }> = [
  { id: "duckduckgo", name: "DuckDuckGo", detail: "Privacy-focused", mark: "D" },
  { id: "brave", name: "Brave Search", detail: "Independent index", mark: "B" },
  { id: "google", name: "Google", detail: "Familiar results", mark: "G" },
  { id: "bing", name: "Bing", detail: "Microsoft search", mark: "B" },
];
const defaultSyncService = import.meta.env.VITE_LOCUS_SYNC_URL ?? "http://localhost:8787";

export function Shell() {
  const state = useBrowserState();
  const [address, setAddress] = useState("");
  const [addressFocused, setAddressFocused] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordMenuOpen, setPasswordMenuOpen] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const active = state?.tabs.find((tab) => tab.id === state.activeTabId);

  useEffect(() => {
    if (!addressFocused) setAddress(active?.url === "about:blank" ? "" : active?.url ?? "");
  }, [active?.url, addressFocused]);

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
    if (!profileOpen && !menuOpen && !passwordMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".toolbar-popover-wrap")) {
        setProfileOpen(false);
        setMenuOpen(false);
        setPasswordMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileOpen(false);
        setMenuOpen(false);
        setPasswordMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen, passwordMenuOpen, profileOpen]);

  if (!state) return <LoadingSurface />;
  if (state.onboardingRequired) return <OnboardingSurface state={state} />;

  const sharedGrant = active?.grants.find((grant) => grant.sessionId === state.work.sessionId);
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
              return <TabItem key={tab.id} tab={tab} {...(groupColor ? { groupColor } : {})} />;
            })}
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
            <button className="chrome-button" title="Back" disabled={!active?.canGoBack} onClick={() => void command({ type: "back" })}><ArrowLeft size={17} /></button>
            <button className="chrome-button" title="Forward" disabled={!active?.canGoForward} onClick={() => void command({ type: "forward" })}><ArrowRight size={17} /></button>
            <button className="chrome-button" title={active?.loading ? "Stop" : "Reload"} onClick={() => void command({ type: active?.loading ? "stop" : "reload" })}>
              {active?.loading ? <Square size={12} fill="currentColor" /> : <RefreshCw size={15} />}
            </button>
          </div>

          <form className={`omnibox ${addressFocused ? "focused" : ""}`} onSubmit={navigate}>
            <span className="site-security" title={state.privateWindow ? "Private window" : active?.url.startsWith("https:") ? "Secure connection" : "Page information"}>
              {state.privateWindow ? <EyeOff size={14} /> : active?.url.startsWith("https:") ? <LockKeyhole size={13} /> : <Globe2 size={14} />}
            </span>
            <input ref={addressRef} value={address} aria-label="Address and search" placeholder="Search or enter a web address" spellCheck={false}
              onFocus={(event) => { setAddressFocused(true); event.currentTarget.select(); }}
              onBlur={() => setAddressFocused(false)} onChange={(event) => setAddress(event.target.value)} />
            {addressFocused ? <Search className="omnibox-search" size={14} /> : (
              <button type="button" className={`omnibox-action ${state.activePageBookmarked ? "bookmarked" : ""}`}
                title={state.activePageBookmarked ? "Remove bookmark" : "Bookmark this page"}
                onClick={() => void command({ type: "toggle-bookmark" })}>
                <Bookmark size={14} fill={state.activePageBookmarked ? "currentColor" : "none"} />
              </button>
            )}
          </form>

          {state.credentialSuggestions.length > 0 && (
            <div className="toolbar-popover-wrap">
              <button className={`chrome-button password-button ${passwordMenuOpen ? "selected" : ""}`} title="Saved logins"
                onClick={() => { setPasswordMenuOpen((open) => !open); setProfileOpen(false); setMenuOpen(false); }}>
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
              onClick={() => { setProfileOpen((open) => !open); setMenuOpen(false); setPasswordMenuOpen(false); }}>
              {state.privateWindow ? <EyeOff size={15} /> : <UserRound size={15} />}<ChevronDown size={11} />
            </button>
            {profileOpen && <ProfileMenu state={state} close={() => setProfileOpen(false)} />}
          </div>
          <button className={`work-button ${workTone} ${state.workOpen ? "open" : ""}`} disabled={state.privateWindow}
            title={state.privateWindow ? "Work Mode is unavailable in private windows" : "Toggle Work Mode (⌘⌥L)"}
            onClick={() => void command({ type: "toggle-work" })}>
            {state.work.pendingPermission ? <CircleAlert size={15} /> : <Sparkles size={15} />}
            <span>Work</span><span className="work-state-dot" aria-label={workTone} />
          </button>
          <div className="toolbar-popover-wrap">
            <button className={`chrome-button ${menuOpen ? "selected" : ""}`} title="Browser menu"
              onClick={() => { setMenuOpen((open) => !open); setProfileOpen(false); setPasswordMenuOpen(false); }}><MoreHorizontal size={18} /></button>
            {menuOpen && <BrowserMenu state={state} close={() => setMenuOpen(false)} />}
          </div>
        </div>
        {state.find.open && <FindBar state={state} />}
        {state.pendingSitePermission && <SitePermissionBar state={state} />}
        {state.pendingCredential && <CredentialSaveBar state={state} />}
      </header>

      {state.sidebarOpen && <BrowserSidebar state={state} top={chromeHeight} />}
      {state.workOpen && state.workOverlay && <div className="dock-scrim" style={{ top: chromeHeight }} aria-hidden="true" />}
      <div className="page-drop-shadow" style={{ left: state.sidebarOpen ? 248 : 0, top: chromeHeight }} aria-hidden="true" />
    </div>
  );
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
      <button role="menuitem" onClick={() => run({ type: "toggle-find" })}><Search size={15} /><span>Find in page</span><kbd>⌘F</kbd></button>
      <button role="menuitem" onClick={() => run({ type: "print-page" })}><Printer size={15} /><span>Print</span><kbd>⌘P</kbd></button>
      <button role="menuitem" onClick={() => run({ type: "save-page-pdf" })}><FileDown size={15} /><span>Save page as PDF</span></button>
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
    <div className={`tab ${tab.active ? "active" : ""} ${tab.grants.length ? "agent-access" : ""} ${groupColor ? `group-${groupColor}` : ""}`}
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
      {tab.grants.length > 0 && <Bot className="tab-agent-indicator" size={12} aria-label="Shared with Locus" />}
      <button className="tab-close" title="Close tab" onClick={(event) => { event.stopPropagation(); void command({ type: "close-tab", tabId: tab.id }); }}><X size={12} /></button>
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
      <button className={`sidebar-settings ${state.sidebarSection === "settings" ? "active" : ""}`} onClick={() => void command({ type: "set-sidebar-section", section: "settings" })}><Settings size={15} /><span>Settings</span></button>
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
    return <SidebarList title={state.privateWindow ? "History hidden" : "Recent history"} count={state.history.length}>{state.history.length ? state.history.map((entry) => (
      <button className="sidebar-row library-row" key={entry.id} onClick={() => void command({ type: "open-library-item", url: entry.url })}>
        <History size={13} /><span><strong>{entry.title || entry.url}</strong><small>{formatTime(entry.visitedAt)}</small></span>
      </button>
    )) : <EmptyLibrary icon={<History size={18} />} text={state.privateWindow ? "History stays hidden in private windows." : "Pages you visit will appear here."} />}</SidebarList>;
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
  if (state.sidebarSection === "settings") return <SettingsPanel state={state} />;
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
    </>
  );
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

function SettingsPanel({ state }: { state: BrowserAppState }) {
  return (
    <div className="settings-panel">
      <div className="sidebar-heading"><span>Settings</span></div>
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
      <ExtensionSettings state={state} />
      {!state.privateWindow ? <SyncSettings state={state} /> : null}
      <div className="settings-subheading">Profiles</div>
      {state.profiles.map((profile) => (
        <div className="permission-setting" key={profile.id}>
          <span><strong>{profile.name}</strong><small>{profile.id === state.profileId ? "Current profile" : "Separate cookies and browsing data"}</small></span>
          {profile.id !== "default" && profile.id !== state.profileId
            ? <button title={`Delete ${profile.name}`} onClick={() => deleteProfile(profile.id, profile.name)}><X size={11} /></button>
            : null}
        </div>
      ))}
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
  return (
    <section className="extension-settings" aria-labelledby="extension-settings-title">
      <div className="settings-subheading" id="extension-settings-title">Extensions</div>
      {state.privateWindow ? (
        <div className="extension-private-note"><EyeOff size={14} /><span><strong>Off in Private Windows</strong><small>Extensions cannot inspect or change private pages.</small></span></div>
      ) : (
        <>
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
          <p className="extension-contract">{manager.message} Locus accepts {manager.supportedApiCount} current engine-backed permission groups and rejects unsupported manifest capabilities or remote executable code.</p>
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
                const status = needsGalleryInstall ? "Not on this Mac" : attention ? "Needs attention" : extension.loaded ? "Loaded" : extension.enabled && !manager.developerMode ? "Developer Mode off" : extension.enabled ? "Waiting" : "Disabled";
                const disableToggle = Boolean(busy) || manager.loading || needsGalleryInstall || (extension.source === "developer" && !manager.developerMode);
                const nextEnabled = attention ? true : !extension.enabled;
                return (
                  <article className={`extension-card ${attention ? "attention" : ""}`} key={extension.id}>
                    <header><span className="extension-icon"><Puzzle size={14} /></span><span><strong>{extension.name}</strong><small>{extension.version} · {extension.source === "developer" ? "Unpacked" : "Gallery"}</small></span><i className={extension.loaded ? "loaded" : attention ? "attention" : ""}>{status}</i></header>
                    {extension.description ? <p>{extension.description}</p> : null}
                    {extension.installPath ? <small className="extension-path" title={extension.installPath}>{extension.installPath}</small> : null}
                    <div className="extension-access"><span>APIs · {extension.permissions.length || "None"}</span><span>Sites · {extension.hostPermissions.length || "None"}</span></div>
                    {attention ? <p className="extension-card-error"><CircleAlert size={11} />{extension.error}</p> : null}
                    <footer>
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
  const [serviceUrl, setServiceUrl] = useState(state.sync.serviceUrl ?? defaultSyncService);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [connectionMethod, setConnectionMethod] = useState<"create" | "recover" | "device">("create");
  const [pairingCode, setPairingCode] = useState("");
  const [formError, setFormError] = useState<string>();
  const busy = state.sync.status === "connecting" || state.sync.status === "syncing";
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
                <label><span>Sync service</span><input type="url" required value={serviceUrl} onChange={(event) => setServiceUrl(event.target.value)} placeholder="https://sync.example.com" /></label>
                {connectionMethod === "recover" && <label><span>Recovery key</span><textarea required rows={3} value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} placeholder="LOCUS-…" autoComplete="off" spellCheck={false} /></label>}
                <p className="sync-method-detail">{connectionMethod === "create" ? "Create an account with a passkey and receive a one-time recovery key." : connectionMethod === "recover" ? "Use your passkey and recovery key on this Mac." : "Get a pairing code and approve this Mac from a connected device—no recovery key needed."}</p>
                {(formError || state.sync.lastError) && <p className="sync-error" role="alert">{formError ?? state.sync.lastError}</p>}
                <button className="sync-connect primary" type="submit" disabled={busy}>
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
