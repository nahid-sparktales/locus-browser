import { useEffect, useRef, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bookmark, Bot, ChevronDown,
  CircleAlert, Clock3, Download, EyeOff, FileDown, Globe2, History,
  LayoutList, LockKeyhole, Minus, MoreHorizontal, PanelLeft, Plus, Printer,
  RefreshCw, Search, Settings, ShieldCheck, Sparkles, Square, UserRound,
  UsersRound, X,
} from "lucide-react";
import type { BrowserCommand } from "../shared/ipc.js";
import type { BrowserAppState, BrowserTabState, SidebarSection } from "../shared/types.js";
import { useBrowserState } from "./useBrowserState.js";

export function Shell() {
  const state = useBrowserState();
  const [address, setAddress] = useState("");
  const [addressFocused, setAddressFocused] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
    if (!profileOpen && !menuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".toolbar-popover-wrap")) {
        setProfileOpen(false);
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen, profileOpen]);

  if (!state) return <LoadingSurface />;

  const sharedGrant = active?.grants.find((grant) => grant.sessionId === state.work.sessionId);
  const workTone = state.work.pendingPermission ? "attention" : state.work.busy ? "working" : "idle";
  const chromeHeight = state.find.open ? 130 : 92;
  const navigate = (event: React.FormEvent) => {
    event.preventDefault();
    if (address.trim()) void command({ type: "navigate", value: address });
    addressRef.current?.blur();
  };

  return (
    <div className={`browser-shell ${state.privateWindow ? "private-window" : ""}`}>
      <header className={`browser-chrome ${state.find.open ? "find-open" : ""}`}>
        <div className="tab-row">
          <div className="traffic-light-space" aria-hidden="true" />
          <div className="tab-strip" role="tablist" aria-label="Browser tabs">
            {state.tabs.map((tab) => <TabItem key={tab.id} tab={tab} />)}
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

          {sharedGrant && (
            <button className="access-pill" title="Revoke Locus access" onClick={() => void command({ type: "revoke-active-tab" })}>
              <ShieldCheck size={14} /><span>{sharedGrant.level === "interact" ? "Locus controls" : "Shared"}</span><X size={12} />
            </button>
          )}
          <button className="chrome-button download-button" title="Downloads" onClick={() => void command({ type: "set-sidebar-section", section: "downloads" })}>
            <Download size={16} />
            {state.downloads.some((download) => download.state === "progressing") && <span className="download-dot" />}
          </button>
          <div className="toolbar-popover-wrap">
            <button className={`profile-button ${profileOpen ? "selected" : ""}`} title={state.privateWindow ? "Private profile" : "Personal profile"}
              onClick={() => { setProfileOpen((open) => !open); setMenuOpen(false); }}>
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
              onClick={() => { setMenuOpen((open) => !open); setProfileOpen(false); }}><MoreHorizontal size={18} /></button>
            {menuOpen && <BrowserMenu state={state} close={() => setMenuOpen(false)} />}
          </div>
        </div>
        {state.find.open && <FindBar state={state} />}
      </header>

      {state.sidebarOpen && <BrowserSidebar state={state} top={chromeHeight} />}
      {state.workOpen && state.workOverlay && <div className="dock-scrim" style={{ top: chromeHeight }} aria-hidden="true" />}
      <div className="page-drop-shadow" style={{ left: state.sidebarOpen ? 248 : 0, top: chromeHeight }} aria-hidden="true" />
    </div>
  );
}

function ProfileMenu({ state, close }: { state: BrowserAppState; close: () => void }) {
  return (
    <div className="toolbar-popover profile-menu" role="menu">
      <div className="popover-heading">
        <span className="profile-avatar">{state.privateWindow ? <EyeOff size={15} /> : <UserRound size={15} />}</span>
        <span><strong>{state.privateWindow ? "Private browsing" : "Personal"}</strong><small>{state.privateWindow ? "Activity is not saved" : "Local profile"}</small></span>
      </div>
      <button role="menuitem" onClick={() => { close(); void command({ type: "new-private-window" }); }}>
        <EyeOff size={15} /><span>New private window</span><kbd>⇧⌘N</kbd>
      </button>
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

function TabItem({ tab }: { tab: BrowserTabState }) {
  const dragging = useRef(false);
  return (
    <div className={`tab ${tab.active ? "active" : ""} ${tab.grants.length ? "agent-access" : ""}`}
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
        {tab.private ? <EyeOff size={13} /> : tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : <Globe2 size={13} />}
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
      <button className="sidebar-settings" disabled title="Settings arrive in the next browser-foundation slice"><Settings size={15} /><span>Settings</span></button>
    </aside>
  );
}

function SidebarContent({ state }: { state: BrowserAppState }) {
  if (state.sidebarSection === "tabs") {
    return <SidebarList title="Open tabs" count={state.tabs.length}>{state.tabs.map((tab) => (
      <button key={tab.id} className={`sidebar-row ${tab.active ? "active" : ""}`} onClick={() => void command({ type: "select-tab", tabId: tab.id })}>
        {tab.private ? <EyeOff size={13} /> : <Globe2 size={13} />}<span>{tab.title}</span>{tab.grants.length > 0 && <Sparkles size={11} />}
      </button>
    ))}</SidebarList>;
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
  const spaces = state.sidebarSection === "spaces";
  return <SidebarList title={spaces ? "Spaces" : "Conversations"} count={0}>
    <EmptyLibrary icon={spaces ? <UsersRound size={18} /> : <Clock3 size={18} />}
      text={spaces ? "Profile spaces arrive with multi-profile support." : "Work conversations remain local to Work Mode."} />
  </SidebarList>;
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
