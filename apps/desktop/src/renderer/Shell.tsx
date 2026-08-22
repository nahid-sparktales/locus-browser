import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Bot,
  ChevronDown,
  CircleAlert,
  Clock3,
  Download,
  Globe2,
  History,
  LayoutList,
  LockKeyhole,
  MoreHorizontal,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import type { BrowserCommand } from "../shared/ipc.js";
import type { BrowserAppState, BrowserTabState } from "../shared/types.js";
import { useBrowserState } from "./useBrowserState.js";

export function Shell() {
  const state = useBrowserState();
  const [address, setAddress] = useState("");
  const [addressFocused, setAddressFocused] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const active = useMemo(
    () => state?.tabs.find((tab) => tab.id === state.activeTabId),
    [state?.activeTabId, state?.tabs],
  );

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

  if (!state) return <LoadingSurface />;

  const sharedGrant = active?.grants.find((grant) => grant.sessionId === state.work.sessionId);
  const workTone = state.work.pendingPermission ? "attention" : state.work.busy ? "working" : "idle";

  const navigate = (event: React.FormEvent) => {
    event.preventDefault();
    if (address.trim()) void command({ type: "navigate", value: address });
    addressRef.current?.blur();
  };

  return (
    <div className="browser-shell">
      <header className="browser-chrome">
        <div className="tab-row">
          <div className="traffic-light-space" aria-hidden="true" />
          <div className="tab-strip" role="tablist" aria-label="Browser tabs">
            {state.tabs.map((tab) => (
              <TabItem key={tab.id} tab={tab} />
            ))}
            <button className="chrome-button new-tab" title="New tab (⌘T)" onClick={() => void command({ type: "new-tab" })}>
              <Plus size={15} strokeWidth={2.2} />
            </button>
          </div>
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
            <span className="site-security" title={active?.url.startsWith("https:") ? "Secure connection" : "Page information"}>
              {active?.url.startsWith("https:") ? <LockKeyhole size={13} /> : <Globe2 size={14} />}
            </span>
            <input
              ref={addressRef}
              value={address}
              aria-label="Address and search"
              placeholder="Search or enter a web address"
              spellCheck={false}
              onFocus={(event) => { setAddressFocused(true); event.currentTarget.select(); }}
              onBlur={() => setAddressFocused(false)}
              onChange={(event) => setAddress(event.target.value)}
            />
            {addressFocused ? <Search className="omnibox-search" size={14} /> : <button type="button" className="omnibox-action" title="Bookmark"><Bookmark size={14} /></button>}
          </form>

          {sharedGrant && (
            <button className="access-pill" title="Revoke Locus access" onClick={() => void command({ type: "revoke-active-tab" })}>
              <ShieldCheck size={14} />
              <span>{sharedGrant.level === "interact" ? "Locus controls" : "Shared"}</span>
              <X size={12} />
            </button>
          )}
          <button className="chrome-button" title="Downloads"><Download size={16} /></button>
          <button className="profile-button" title="Personal profile"><UserRound size={15} /><ChevronDown size={11} /></button>
          <button className={`work-button ${workTone} ${state.workOpen ? "open" : ""}`} onClick={() => void command({ type: "toggle-work" })}>
            {state.work.pendingPermission ? <CircleAlert size={15} /> : <Sparkles size={15} />}
            <span>Work</span>
            <span className="work-state-dot" aria-label={workTone} />
          </button>
          <button className="chrome-button" title="Browser menu"><MoreHorizontal size={18} /></button>
        </div>
      </header>

      {state.sidebarOpen && <BrowserSidebar state={state} />}
      {state.workOpen && state.workOverlay && <div className="dock-scrim" aria-hidden="true" />}
      <div className="page-drop-shadow" style={{ left: state.sidebarOpen ? 248 : 0 }} aria-hidden="true" />
    </div>
  );
}

function TabItem({ tab }: { tab: BrowserTabState }) {
  const dragging = useRef(false);
  return (
    <div
      className={`tab ${tab.active ? "active" : ""} ${tab.grants.length ? "agent-access" : ""}`}
      role="tab"
      aria-selected={tab.active}
      tabIndex={tab.active ? 0 : -1}
      draggable
      onClick={() => { if (!dragging.current) void command({ type: "select-tab", tabId: tab.id }); }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void command({ type: "select-tab", tabId: tab.id });
        }
      }}
      onDragStart={(event) => { dragging.current = true; event.dataTransfer.setData("text/locus-tab", tab.id); }}
      onDragEnd={() => { dragging.current = false; }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const moving = event.dataTransfer.getData("text/locus-tab");
        if (moving) void command({ type: "reorder-tab", tabId: moving, beforeTabId: tab.id });
      }}
    >
      <span className="tab-icon">
        {tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : <Globe2 size={13} />}
        {tab.loading && <span className="loading-ring" />}
      </span>
      <span className="tab-title">{tab.title || "New Tab"}</span>
      {tab.grants.length > 0 && <Bot className="tab-agent-indicator" size={12} aria-label="Shared with Locus" />}
      <button className="tab-close" title="Close tab" onClick={(event) => { event.stopPropagation(); void command({ type: "close-tab", tabId: tab.id }); }}><X size={12} /></button>
    </div>
  );
}

function BrowserSidebar({ state }: { state: BrowserAppState }) {
  return (
    <aside className="browser-sidebar" aria-label="Browser sidebar">
      <nav className="sidebar-nav">
        <SidebarItem active icon={<LayoutList size={16} />} label="Tabs" />
        <SidebarItem icon={<Bookmark size={16} />} label="Bookmarks" />
        <SidebarItem icon={<History size={16} />} label="History" />
        <SidebarItem icon={<Download size={16} />} label="Downloads" />
        <div className="sidebar-rule" />
        <SidebarItem icon={<UsersRound size={16} />} label="Spaces" />
        <SidebarItem icon={<Clock3 size={16} />} label="Conversations" />
      </nav>
      <div className="sidebar-heading"><span>Open tabs</span><span>{state.tabs.length}</span></div>
      <div className="sidebar-tabs">
        {state.tabs.map((tab) => (
          <button key={tab.id} className={tab.active ? "active" : ""} onClick={() => void command({ type: "select-tab", tabId: tab.id })}>
            <Globe2 size={13} /><span>{tab.title}</span>{tab.grants.length > 0 && <Sparkles size={11} />}
          </button>
        ))}
      </div>
      <button className="sidebar-settings"><Settings size={15} /><span>Settings</span></button>
    </aside>
  );
}

function SidebarItem({ icon, label, active = false }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return <button className={active ? "active" : ""}>{icon}<span>{label}</span></button>;
}

function LoadingSurface() {
  return <div className="loading-surface"><Sparkles size={22} /><span>Opening Locus Browser…</span></div>;
}

async function command(value: BrowserCommand) {
  return await window.locusBrowser.command(value);
}
