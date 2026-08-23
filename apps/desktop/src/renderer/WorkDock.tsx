import { useRef, useState } from "react";
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  ClipboardList,
  FileCode2,
  FileDiff,
  FolderOpen,
  GitBranch,
  ImageIcon,
  MessageSquareText,
  Paperclip,
  RotateCcw,
  SendHorizontal,
  Share2,
  Shield,
  Sparkles,
  SquarePen,
  TerminalSquare,
  UserRound,
  X,
} from "lucide-react";
import type { BrowserCommand } from "../shared/ipc.js";
import type { BrowserAppState, WorkMode, WorkPanel } from "../shared/types.js";
import { useBrowserState } from "./useBrowserState.js";

const panels: Array<{ id: WorkPanel; label: string; icon: React.ReactNode }> = [
  { id: "chat", label: "Chat", icon: <MessageSquareText size={17} /> },
  { id: "plan", label: "Plan", icon: <ClipboardList size={17} /> },
  { id: "changes", label: "Changes", icon: <FileDiff size={17} /> },
  { id: "files", label: "Files", icon: <FileCode2 size={17} /> },
  { id: "terminal", label: "Terminal", icon: <TerminalSquare size={17} /> },
];

const modes: Array<{ id: WorkMode; label: string }> = [
  { id: "ask", label: "Ask" },
  { id: "work", label: "Work" },
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
    <div className={`work-dock theme-${state.settings.appearance}`}>
      <div className="dock-resize-handle" onPointerDown={startResize} onPointerMove={resize} onPointerUp={stopResize} onPointerCancel={stopResize} />
      <header className="dock-header">
        <div className="dock-title"><span className="locus-mark" aria-hidden="true">L</span><strong>Work</strong></div>
        <div className={`runtime-chip ${state.work.runtime}`}><span />{state.work.runtime === "online" ? "Ready" : state.work.runtime}</div>
        <button className="dock-close" title="Hide Work Mode (⌘⌥L)" onClick={() => void command({ type: "toggle-work" })}><X size={16} /></button>
      </header>

      <div className="dock-body">
        <main className="work-content">
          <div className="panel-toolbar">
            <div><span className="panel-icon">{panel.icon}</span><strong>{panel.label}</strong></div>
            <div className="panel-actions">
              <span className="solo-chip"><UserRound size={11} />Solo</span>
              <button className="new-conversation" type="button" title="New conversation" disabled={state.work.busy || state.work.runtime !== "online"} onClick={() => void command({ type: "new-work-conversation" })}><SquarePen size={14} /></button>
            </div>
          </div>

          {state.work.pendingPermission && <PermissionCard state={state} />}
          {state.work.panel === "chat" ? <ChatPanel state={state} grantLevel={grant?.level} /> : <SurfacePanel panel={state.work.panel} state={state} />}
        </main>

        <nav className="work-rail" aria-label="Work surfaces">
          {panels.map((item) => (
            <button type="button" key={item.id} className={item.id === state.work.panel ? "active" : ""} title={item.label} aria-label={item.label} onClick={() => void command({ type: "set-work-panel", panel: item.id })}>
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
        </nav>
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

      <div className={`workspace-bar ${state.work.workspace ? "selected" : ""}`}>
        <FolderOpen size={13} />
        <span title={state.work.workspace?.path}>{state.work.workspace?.name ?? "No workspace selected"}</span>
        <button type="button" disabled={state.work.busy || state.work.runtime !== "online"} onClick={() => void command({ type: "choose-workspace" })}>
          {state.work.workspace ? "Change" : "Choose folder"}
        </button>
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
          {modes.map((mode) => <button key={mode.id} type="button" role="radio" aria-checked={state.work.mode === mode.id} className={state.work.mode === mode.id ? "active" : ""} onKeyDown={navigateModeRadio} onClick={() => void command({ type: "set-work-mode", mode: mode.id })}>{mode.label}</button>)}
        </div>
        <div className="composer">
          {state.work.attachments.length > 0 ? (
            <div className="attachment-strip" aria-label="Attached images">
              {state.work.attachments.map((attachment) => (
                <span className="attachment-chip" key={attachment.id} title={`${attachment.name} · ${formatBytes(attachment.size)}`}>
                  <ImageIcon size={12} /><span>{attachment.name}</span>
                  <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => void command({ type: "remove-work-attachment", attachmentId: attachment.id })}><X size={11} /></button>
                </span>
              ))}
            </div>
          ) : null}
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
            <button type="button" title="Attach images" aria-label="Attach images" disabled={state.work.busy || state.work.runtime !== "online" || state.work.attachments.length >= 10} onClick={() => void command({ type: "choose-work-attachments" })}><Paperclip size={15} /></button>
            <div className="composer-spacer" />
            <span className="context-meter" title="Context window">8%</span>
            {state.work.busy
              ? <button type="button" className="send-button stop" title="Stop" onClick={() => void command({ type: "stop-work" })}><CircleStop size={17} /></button>
              : <button type="button" className="send-button" title="Send" disabled={!text.trim() || state.work.runtime !== "online"} onClick={submit}><SendHorizontal size={16} /></button>}
          </div>
        </div>
        <div className="composer-foot"><span>{state.work.runtimeMessage}</span><span>↵ send · ⇧↵ newline</span></div>
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

function SurfacePanel({ panel, state }: { panel: Exclude<WorkPanel, "chat">; state: BrowserAppState }) {
  const workspaceName = state.work.workspace?.name;
  const content: Record<Exclude<WorkPanel, "chat">, { title: string; text: string; icon: React.ReactNode; actions: string[] }> = {
    plan: { title: "No plan yet", text: "Choose Plan mode and describe the outcome. Locus will present a decision-ready plan here for approval.", icon: <ClipboardList size={21} />, actions: ["Create a plan", "Review dependencies", "Approve before build"] },
    changes: { title: "No workspace changes", text: "File diffs and hunk-level accept or revert actions appear as Locus edits your workspace.", icon: <FileDiff size={21} />, actions: ["Working tree clean", "Review each edit", "Git handoff ready"] },
    files: { title: workspaceName ?? "Choose a workspace in Chat", text: state.work.workspace?.path ?? "Once a workspace is selected, browse files, inspect edits, and attach context without leaving the webpage.", icon: <FileCode2 size={21} />, actions: [workspaceName ? "Workspace ready" : "No workspace selected", "Search", "Image attachments"] },
    terminal: { title: "Terminal is agent-owned", text: "Commands, dev servers, and their output stay isolated from webpages and stream here during a run.", icon: <TerminalSquare size={21} />, actions: [workspaceName ? `Workspace · ${workspaceName}` : "No workspace selected", "No dev server", "Shell access requires approval"] },
  };
  const item = content[panel];
  return (
    <div className="surface-panel">
      <div className="surface-hero"><span>{item.icon}</span><h2>{item.title}</h2><p>{item.text}</p></div>
      <div className="surface-list">
        {item.actions.map((action, index) => <div key={action}>{index === 0 ? <CheckCircle2 size={15} /> : index === 1 ? <GitBranch size={15} /> : <RotateCcw size={15} />}<span>{action}</span></div>)}
      </div>
    </div>
  );
}

async function command(value: BrowserCommand) {
  return await window.locusBrowser.command(value);
}

function navigateModeRadio(event: React.KeyboardEvent<HTMLButtonElement>): void {
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

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}
