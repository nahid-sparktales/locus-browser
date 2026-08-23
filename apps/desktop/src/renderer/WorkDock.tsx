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
  KeyRound,
  LogOut,
  MessageSquareText,
  Paperclip,
  RotateCcw,
  RefreshCw,
  SendHorizontal,
  Server,
  Share2,
  Shield,
  Sparkles,
  SquarePen,
  TerminalSquare,
  UserRound,
  X,
} from "lucide-react";
import type { BrowserCommand } from "../shared/ipc.js";
import type { BrowserAppState, WorkMode, WorkModelProviderId, WorkModelProviderState, WorkPanel } from "../shared/types.js";
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
  const [modelOpen, setModelOpen] = useState(false);
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
              <div className="model-picker-wrap">
                <button className="model-chip" type="button" aria-expanded={modelOpen} title={`Model: ${state.work.model.label}`} onClick={() => setModelOpen((open) => !open)}>
                  <Bot size={12} /><span>{state.work.model.label}</span><ChevronDown size={11} />
                </button>
                {modelOpen ? <ModelPicker state={state} close={() => setModelOpen(false)} /> : null}
              </div>
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

function ModelPicker({ state, close }: { state: BrowserAppState; close: () => void }) {
  const [providerId, setProviderId] = useState<WorkModelProviderId>(state.work.model.activeProvider);
  const initialVllm = state.work.model.providers.find((provider) => provider.id === "vllm");
  const [vllmUrl, setVllmUrl] = useState(initialVllm?.baseUrl ?? "http://127.0.0.1:8000/v1");
  const [vllmModel, setVllmModel] = useState(initialVllm?.models[0]?.id ?? "");
  const provider = state.work.model.providers.find((item) => item.id === providerId) ?? state.work.model.providers[0]!;
  const disabled = state.work.busy || state.work.runtime !== "online" || state.work.model.switching;

  const chooseModel = (model: string) => {
    if (provider.id === "openai-api" || provider.id === "kimi" || provider.id === "claude-api") {
      const type = provider.configured ? "select-work-model" as const : "configure-work-provider" as const;
      void command({ type, providerId: provider.id, model });
    } else {
      void command({ type: "select-work-model", providerId: provider.id, model });
    }
    close();
  };

  const reconnectProvider = () => {
    if (provider.id !== "openai-api" && provider.id !== "kimi" && provider.id !== "claude-api") return;
    const model = provider.models.find((item) => item.id === state.work.model.activeModel)?.id ?? provider.models[0]?.id;
    if (!model) return;
    void command({ type: "configure-work-provider", providerId: provider.id, model });
    close();
  };

  return (
    <section className="model-popover" aria-label="Choose a model">
      <header className="model-popover-header">
        <div><strong>Model</strong><small>Solo agent</small></div>
        <div>
          <button type="button" aria-label="Refresh models" title="Refresh models" disabled={disabled} onClick={() => void command({ type: "refresh-work-models" })}><RefreshCw size={13} /></button>
          <button type="button" aria-label="Close model picker" onClick={close}><X size={14} /></button>
        </div>
      </header>

      <div className="model-provider-grid" role="radiogroup" aria-label="Model providers">
        {state.work.model.providers.map((item) => (
          <button key={item.id} type="button" role="radio" aria-checked={provider.id === item.id} className={provider.id === item.id ? "selected" : ""} onKeyDown={navigateModeRadio} onClick={() => setProviderId(item.id)}>
            <span className="model-provider-mark">{item.mark}</span>
            <span><strong>{item.name}</strong><small>{providerStatusLabel(item)}</small></span>
            <i className={`provider-status-dot ${item.status}`} />
          </button>
        ))}
      </div>

      <div className="model-provider-detail">
        <div className="model-provider-heading">
          <span className="model-provider-mark large">{provider.mark}</span>
          <span><strong>{provider.name}</strong><small>{provider.detail}</small></span>
        </div>
        <p className={`model-provider-status ${provider.status}`}>{provider.statusMessage}</p>

        {provider.id === "chatgpt-plan" && provider.status !== "ready" ? (
          <div className="model-setup-card">
            <p>Use the models and included usage available through your ChatGPT subscription. This is separate from API billing.</p>
            <button type="button" className="model-primary-action" disabled={disabled || provider.status === "signing-in" || provider.status === "unavailable"} onClick={() => void command({ type: "start-chatgpt-login" })}>
              <KeyRound size={14} />{provider.status === "signing-in" ? "Waiting for sign-in…" : "Sign in with ChatGPT"}
            </button>
          </div>
        ) : provider.id === "vllm" ? (
          <div className="model-setup-card vllm-setup">
            <label>Endpoint URL<input value={vllmUrl} onChange={(event) => setVllmUrl(event.target.value)} placeholder="http://127.0.0.1:8000/v1" /></label>
            <label>Model name<input value={vllmModel} onChange={(event) => setVllmModel(event.target.value)} placeholder="organization/model" /></label>
            <button type="button" className="model-primary-action" disabled={disabled || !vllmUrl.trim() || !vllmModel.trim()} onClick={() => {
              void command({ type: "configure-work-provider", providerId: "vllm", baseUrl: vllmUrl, model: vllmModel });
              close();
            }}><Server size={14} />{provider.configured ? "Update endpoint" : "Connect endpoint"}</button>
          </div>
        ) : null}

        {provider.models.length > 0 && (provider.id !== "chatgpt-plan" || provider.status === "ready") ? (
          <div className="model-option-list" role="radiogroup" aria-label={`${provider.name} models`}>
            {provider.models.map((model) => {
              const selected = provider.id === state.work.model.activeProvider && model.id === state.work.model.activeModel;
              return (
                <button key={model.id} type="button" role="radio" aria-checked={selected} className={selected ? "selected" : ""} disabled={disabled || (provider.id === "vllm" && !provider.configured)} onKeyDown={navigateModeRadio} onClick={() => chooseModel(model.id)}>
                  <span className="model-radio">{selected ? <Check size={12} /> : null}</span>
                  <span><strong>{model.name}</strong>{model.name !== model.id ? <small>{model.id}</small> : model.detail ? <small>{model.detail}</small> : null}</span>
                </button>
              );
            })}
          </div>
        ) : provider.id !== "vllm" && provider.status === "ready" ? <p className="model-empty">No models were reported. Refresh to try again.</p> : null}

        {(provider.id === "openai-api" || provider.id === "kimi" || provider.id === "claude-api") && provider.configured ? (
          <button type="button" className="model-secondary-action" disabled={disabled} onClick={reconnectProvider}><KeyRound size={13} />Update API key</button>
        ) : null}
        {provider.id === "chatgpt-plan" && provider.status === "ready" ? (
          <button type="button" className="model-secondary-action danger" disabled={disabled} onClick={() => void command({ type: "sign-out-chatgpt" })}><LogOut size={13} />Sign out</button>
        ) : null}
      </div>

      <footer className="model-popover-foot"><span>{state.work.model.switching ? "Switching model…" : state.work.model.message}</span><small>Keys stay encrypted on this Mac</small></footer>
    </section>
  );
}

function providerStatusLabel(provider: WorkModelProviderState): string {
  switch (provider.status) {
    case "ready": return provider.id === "local" ? provider.statusMessage : "Ready";
    case "needs-key": return "Add key";
    case "needs-setup": return "Set up";
    case "needs-sign-in": return "Sign in";
    case "signing-in": return "Signing in";
    case "unavailable": return "Unavailable";
  }
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
