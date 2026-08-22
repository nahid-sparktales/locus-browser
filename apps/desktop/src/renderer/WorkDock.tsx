import { useRef, useState } from "react";
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  ClipboardList,
  Code2,
  FileCode2,
  FileDiff,
  GitBranch,
  LayoutDashboard,
  MessageSquareText,
  Milestone,
  NotebookPen,
  Paperclip,
  Play,
  RotateCcw,
  SendHorizontal,
  Share2,
  Shield,
  Sparkles,
  TerminalSquare,
  TimerReset,
  X,
} from "lucide-react";
import type { BrowserCommand } from "../shared/ipc.js";
import type { BrowserAppState, WorkMode, WorkPanel } from "../shared/types.js";
import { useBrowserState } from "./useBrowserState.js";

const panels: Array<{ id: WorkPanel; label: string; icon: React.ReactNode }> = [
  { id: "chat", label: "Chat", icon: <MessageSquareText size={17} /> },
  { id: "overview", label: "Overview", icon: <LayoutDashboard size={17} /> },
  { id: "plan", label: "Plan", icon: <ClipboardList size={17} /> },
  { id: "changes", label: "Changes", icon: <FileDiff size={17} /> },
  { id: "files", label: "Files", icon: <FileCode2 size={17} /> },
  { id: "terminal", label: "Terminal", icon: <TerminalSquare size={17} /> },
  { id: "checkpoints", label: "Checkpoints", icon: <Milestone size={17} /> },
  { id: "runs", label: "Runs", icon: <TimerReset size={17} /> },
  { id: "notes", label: "Notes", icon: <NotebookPen size={17} /> },
  { id: "agents", label: "AGENTS.md", icon: <Bot size={17} /> },
];

const modes: Array<{ id: WorkMode; label: string }> = [
  { id: "ask", label: "Ask" },
  { id: "work", label: "Adaptive Work" },
  { id: "plan", label: "Plan" },
  { id: "build", label: "Build" },
];

export function WorkDock() {
  const state = useBrowserState();
  const resizing = useRef<{ startX: number; startWidth: number } | null>(null);

  if (!state) return <div className="dock-loading"><Sparkles size={20} /></div>;

  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  const grant = active?.grants.find((item) => item.sessionId === state.work.sessionId);
  const panel = panels.find((item) => item.id === state.work.panel) ?? panels[0]!;

  const startResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resizing.current = { startX: event.screenX, startWidth: state.workWidth };
  };
  const resize = (event: React.PointerEvent) => {
    const gesture = resizing.current;
    if (!gesture) return;
    void command({ type: "set-work-width", width: gesture.startWidth + gesture.startX - event.screenX });
  };
  const stopResize = () => { resizing.current = null; };

  return (
    <div className="work-dock">
      <div className="dock-resize-handle" onPointerDown={startResize} onPointerMove={resize} onPointerUp={stopResize} onPointerCancel={stopResize} />
      <header className="dock-header">
        <div className="dock-title"><span className="locus-mark"><Sparkles size={14} /></span><strong>Work</strong></div>
        <div className={`runtime-chip ${state.work.runtime}`}><span />{state.work.runtime === "online" ? "Ready" : state.work.runtime}</div>
        <button className="dock-close" title="Hide Work Mode (⌘⌥L)" onClick={() => void command({ type: "toggle-work" })}><X size={16} /></button>
      </header>

      <div className="dock-body">
        <nav className="work-rail" aria-label="Work surfaces">
          {panels.map((item) => (
            <button key={item.id} className={item.id === state.work.panel ? "active" : ""} title={item.label} onClick={() => void command({ type: "set-work-panel", panel: item.id })}>
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
        </nav>

        <main className="work-content">
          <div className="panel-toolbar">
            <div><span className="panel-icon">{panel.icon}</span><strong>{panel.label}</strong></div>
            <button className="model-picker"><span>Locus Auto</span><ChevronDown size={12} /></button>
          </div>

          {state.work.pendingPermission && <PermissionCard state={state} />}
          {state.work.panel === "chat" ? <ChatPanel state={state} grantLevel={grant?.level} /> : <SurfacePanel panel={state.work.panel} state={state} />}
        </main>
      </div>
    </div>
  );
}

function ChatPanel({ state, grantLevel }: { state: BrowserAppState; grantLevel: "read" | "interact" | undefined }) {
  const [text, setText] = useState("");
  const [shareMenu, setShareMenu] = useState(false);
  const latestId = state.work.messages.at(-1)?.id;

  const submit = () => {
    if (!text.trim()) return;
    void command({ type: "work-send", text });
    setText("");
  };

  return (
    <div className="chat-panel">
      <div className="context-bar">
        <div className="context-copy">
          <span className={`context-dot ${grantLevel ? "shared" : ""}`} />
          <span>{grantLevel ? `Current tab · ${grantLevel}` : "Current tab is private to you"}</span>
        </div>
        <div className="share-wrap">
          <button className={grantLevel ? "shared" : ""} onClick={() => setShareMenu((open) => !open)}>
            {grantLevel ? <Shield size={13} /> : <Share2 size={13} />}{grantLevel ? "Shared" : "Share tab"}<ChevronDown size={11} />
          </button>
          {shareMenu && (
            <div className="share-menu">
              <button onClick={() => { setShareMenu(false); void command({ type: "share-active-tab", level: "read" }); }}><span><strong>Read only</strong><small>Page text and screenshots</small></span>{grantLevel === "read" && <Check size={14} />}</button>
              <button onClick={() => { setShareMenu(false); void command({ type: "share-active-tab", level: "interact" }); }}><span><strong>Allow interaction</strong><small>Click, type, scroll, and navigate</small></span>{grantLevel === "interact" && <Check size={14} />}</button>
              {grantLevel && <button className="revoke" onClick={() => { setShareMenu(false); void command({ type: "revoke-active-tab" }); }}>Revoke access</button>}
            </div>
          )}
        </div>
      </div>

      <div className="messages" aria-live="polite">
        {state.work.messages.map((message) => (
          <article key={message.id} className={`message ${message.role} ${message.id === latestId ? "latest" : ""}`}>
            {message.role !== "user" && <div className="message-avatar">{message.role === "assistant" ? <Sparkles size={13} /> : <Bot size={13} />}</div>}
            <div className="message-bubble">{message.text || (message.streaming ? <span className="typing"><i /><i /><i /></span> : "")}</div>
          </article>
        ))}
      </div>

      <div className="composer-wrap">
        <div className="mode-picker" role="radiogroup" aria-label="Work mode">
          {modes.map((mode) => <button key={mode.id} role="radio" aria-checked={state.work.mode === mode.id} className={state.work.mode === mode.id ? "active" : ""} onClick={() => void command({ type: "set-work-mode", mode: mode.id })}>{mode.label}</button>)}
        </div>
        <div className="composer">
          <textarea
            value={text}
            placeholder={state.work.runtime === "online" ? "Ask Locus to work with you…" : state.work.runtimeMessage}
            aria-label="Message Locus"
            rows={2}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
            }}
          />
          <div className="composer-actions">
            <button title="Attach files"><Paperclip size={15} /></button>
            <div className="composer-spacer" />
            <span className="context-meter" title="Context window">8%</span>
            {state.work.busy
              ? <button className="send-button stop" title="Stop" onClick={() => void command({ type: "stop-work" })}><CircleStop size={17} /></button>
              : <button className="send-button" title="Send" disabled={!text.trim() || state.work.runtime !== "online"} onClick={submit}><SendHorizontal size={16} /></button>}
          </div>
        </div>
        <div className="composer-foot"><span>{state.work.runtimeMessage}</span><span>⌘↵ send · ⇧↵ newline</span></div>
      </div>
    </div>
  );
}

function PermissionCard({ state }: { state: BrowserAppState }) {
  const request = state.work.pendingPermission!;
  return (
    <section className="permission-card" aria-live="assertive">
      <div className="permission-icon"><Shield size={17} /></div>
      <div className="permission-copy"><strong>{request.tool}</strong><p>{request.summary}</p></div>
      <div className="permission-actions">
        <button onClick={() => void command({ type: "answer-permission", requestId: request.requestId, decision: "deny" })}>Deny</button>
        <button onClick={() => void command({ type: "answer-permission", requestId: request.requestId, decision: "allow" })}>Allow once</button>
        <button className="primary" onClick={() => void command({ type: "answer-permission", requestId: request.requestId, decision: "always" })}>Allow for run</button>
      </div>
    </section>
  );
}

function SurfacePanel({ panel, state }: { panel: WorkPanel; state: BrowserAppState }) {
  const content: Record<Exclude<WorkPanel, "chat">, { title: string; text: string; icon: React.ReactNode; actions: string[] }> = {
    overview: { title: "Workspace overview", text: "Run status, evidence, model usage, and the current browser context appear here.", icon: <LayoutDashboard size={21} />, actions: ["Runtime connected", `${state.tabs.length} browser tabs`, "No active schedule"] },
    plan: { title: "No plan yet", text: "Choose Plan mode and describe the outcome. Locus will present a decision-ready plan here for approval.", icon: <ClipboardList size={21} />, actions: ["Create a plan", "Review dependencies", "Approve before build"] },
    changes: { title: "No workspace changes", text: "File diffs and hunk-level accept or revert actions appear as Locus edits your workspace.", icon: <FileDiff size={21} />, actions: ["Working tree clean", "Checkpoints enabled", "Git handoff ready"] },
    files: { title: "Open a workspace in chat", text: "Once a workspace is selected, browse files, inspect edits, and attach context without leaving the webpage.", icon: <FileCode2 size={21} />, actions: ["Files", "Search", "Attachments"] },
    terminal: { title: "Terminal is agent-owned", text: "Commands, dev servers, and their output stay isolated from webpages and stream here during a run.", icon: <TerminalSquare size={21} />, actions: ["No running command", "No dev server", "Shell access requires approval"] },
    checkpoints: { title: "No checkpoints yet", text: "Locus records recoverable workspace checkpoints before material changes.", icon: <Milestone size={21} />, actions: ["Automatic checkpoints", "Compare", "Restore"] },
    runs: { title: "Runs are quiet", text: "Durable work, schedules, teams, recovery, and evidence will collect in this timeline.", icon: <TimerReset size={21} />, actions: ["No active run", "No approval waiting", "Recovery available"] },
    notes: { title: "Notes", text: "Use this space for durable project notes. Notes remain local and are not part of browser sync.", icon: <NotebookPen size={21} />, actions: ["Project notes", "Evidence", "Decisions"] },
    agents: { title: "AGENTS.md", text: "Workspace instructions are shown here when a folder is active. They remain authoritative for every work run.", icon: <Bot size={21} />, actions: ["No workspace selected", "Inheritance", "Per-folder guidance"] },
  };
  const item = content[panel as Exclude<WorkPanel, "chat">];
  return (
    <div className="surface-panel">
      <div className="surface-hero"><span>{item.icon}</span><h2>{item.title}</h2><p>{item.text}</p></div>
      <div className="surface-list">
        {item.actions.map((action, index) => <div key={action}>{index === 0 ? <CheckCircle2 size={15} /> : index === 1 ? <GitBranch size={15} /> : <RotateCcw size={15} />}<span>{action}</span>{index === 0 && panel === "plan" ? <button><Play size={12} /> Start</button> : null}</div>)}
      </div>
    </div>
  );
}

async function command(value: BrowserCommand) {
  return await window.locusBrowser.command(value);
}
