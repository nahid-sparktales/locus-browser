import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Clock3,
  ClipboardList,
  Database,
  FileCode2,
  FileDiff,
  FolderOpen,
  FolderTree,
  GitBranch,
  ImageIcon,
  KeyRound,
  LogOut,
  MessageSquareText,
  Mic,
  Paperclip,
  Play,
  RotateCcw,
  RefreshCw,
  Search,
  SendHorizontal,
  Server,
  Share2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  TerminalSquare,
  Trash2,
  UserRound,
  Volume2,
  Wrench,
  X,
} from "lucide-react";
import type { BrowserCommand } from "../shared/ipc.js";
import type { ThinkingVisibility, ToolActivityVisibility, WalrusMemoryResultState, WorkDockState as BrowserAppState, WorkMessage, WorkMode, WorkModelProviderId, WorkModelProviderState, WorkPanel, WorkTerminalEntryState } from "../shared/types.js";
import { accentCssVariables } from "../shared/accent.js";
import { useWorkState } from "./useSurfaceState.js";

const panels: Array<{ id: WorkPanel; label: string; icon: React.ReactNode }> = [
  { id: "chat", label: "Chat", icon: <MessageSquareText size={17} /> },
  { id: "plan", label: "Plan", icon: <ClipboardList size={17} /> },
  { id: "changes", label: "Changes", icon: <FileDiff size={17} /> },
  { id: "files", label: "Files", icon: <FileCode2 size={17} /> },
  { id: "terminal", label: "Terminal", icon: <TerminalSquare size={17} /> },
];

const modes: Array<{ id: WorkMode; label: string; detail: string }> = [
  { id: "ask", label: "Ask", detail: "Chat and summarize shared context without tools" },
  { id: "work", label: "Work", detail: "Use browser and workspace tools with approvals" },
  { id: "plan", label: "Plan", detail: "Research and prepare a plan without changing pages or files" },
  { id: "build", label: "Build", detail: "Use tools to implement an approved plan" },
];

export function WorkDock() {
  const state = useWorkState();
  const [modelOpen, setModelOpen] = useState(false);
  const resizing = useRef<{ startX: number; startWidth: number } | null>(null);

  if (!state) return <div className="dock-loading"><Sparkles size={20} /></div>;

  const grant = state.activeTabGrants.find((item) => item.sessionId === state.work.sessionId);
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
    <div className={`work-dock theme-${state.settings.appearance}`} style={accentCssVariables(state.settings.accent) as React.CSSProperties}>
      <div className="dock-resize-handle" onPointerDown={startResize} onPointerMove={resize} onPointerUp={stopResize} onPointerCancel={stopResize} />
      <header className="dock-header">
        <div className="dock-title"><span className="locus-mark" aria-hidden="true">L</span><strong>Work</strong></div>
        <div className={`runtime-chip ${state.work.runtime}`}><span />{state.work.runtime === "online" ? "Ready" : state.work.runtime}</div>
        <button className="dock-close" type="button" title="Hide Work Mode (⌘⌥L)" onClick={() => void command({ type: "toggle-work" })}><X size={16} /></button>
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

          {state.work.runtime !== "online" ? <RuntimeRecoveryBanner state={state} /> : null}
          {state.work.pendingPermission ? <PermissionCard state={state} /> : null}
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

      <p className="model-context-advice"><AlertTriangle size={13} /><span><strong>Large context recommended</strong><small>Use at least 128K context; 200K+ is best for long browser sessions.</small></span></p>

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
          <button type="button" className="model-secondary-action" disabled={disabled} onClick={reconnectProvider}><KeyRound size={13} />{provider.id === "kimi" ? "Update membership key" : "Update API key"}</button>
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
  const [displayMenu, setDisplayMenu] = useState(false);
  const [walrusOpen, setWalrusOpen] = useState(false);
  const visibleMessages = state.work.messages.filter((message) => message.text || message.streaming || (message.reasoningText && state.settings.thinkingVisibility !== "hidden"));
  const latestId = visibleMessages.at(-1)?.id;
  const activeProvider = state.work.model.providers.find((provider) => provider.id === state.work.model.activeProvider);
  const modelReady = Boolean(activeProvider?.configured);

  useEffect(() => {
    if (state.walrusMemory.searchRequestedAt) setWalrusOpen(true);
  }, [state.walrusMemory.searchRequestedAt]);

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
          <button className={grantLevel ? "shared" : ""} type="button" onClick={() => setShareMenu((open) => !open)}>
            {grantLevel ? <Shield size={13} /> : <Share2 size={13} />}{grantLevel ? "Shared" : "Share tab"}<ChevronDown size={11} />
          </button>
          {shareMenu && (
            <div className="share-menu">
              <button type="button" onClick={() => { setShareMenu(false); void command({ type: "share-active-tab", level: "read" }); }}><span><strong>Read only</strong><small>Page text and screenshots</small></span>{grantLevel === "read" ? <Check size={14} /> : null}</button>
              <button type="button" onClick={() => { setShareMenu(false); void command({ type: "share-active-tab", level: "interact" }); }}><span><strong>Allow interaction</strong><small>Click, type, scroll, and navigate</small></span>{grantLevel === "interact" ? <Check size={14} /> : null}</button>
              {grantLevel ? <button className="revoke" type="button" onClick={() => { setShareMenu(false); void command({ type: "revoke-active-tab" }); }}>Revoke access</button> : null}
            </div>
          )}
        </div>
      </div>

      {state.recording.id || state.recording.transcriptPreview.length ? <LiveContextCard state={state} /> : null}

      <div className={`workspace-bar ${state.work.workspace ? "selected" : ""}`}>
        <FolderOpen size={13} />
        <span title={state.work.workspace?.path}>{state.work.workspace?.name ?? "No workspace selected"}</span>
        <button type="button" disabled={state.work.busy || state.work.runtime !== "online"} onClick={() => void command({ type: "choose-workspace" })}>
          {state.work.workspace ? "Change" : "Choose folder"}
        </button>
      </div>

      <div className="messages" aria-live="polite">
        {visibleMessages.map((message) => (
          <article key={message.id} className={`message ${message.role} ${message.id === latestId ? "latest" : ""}`}>
            {message.role !== "user" && <div className="message-avatar">{message.role === "assistant" ? <Sparkles size={13} /> : <Bot size={13} />}</div>}
            <div className="message-bubble">
              <ThinkingBlock key={`${message.id}:${state.settings.thinkingVisibility}`} message={message} visibility={state.settings.thinkingVisibility} />
              {message.text || (message.streaming && (!message.reasoningText || state.settings.thinkingVisibility === "hidden") ? <span className="typing"><i /><i /><i /></span> : "")}
            </div>
          </article>
        ))}
        <ChatToolActivity state={state} />
      </div>

      <div className="composer-wrap">
        <div className="mode-picker" role="radiogroup" aria-label="Work mode">
          {modes.map((mode) => <button key={mode.id} type="button" role="radio" aria-checked={state.work.mode === mode.id} className={state.work.mode === mode.id ? "active" : ""} title={mode.detail} onKeyDown={navigateModeRadio} onClick={() => void command({ type: "set-work-mode", mode: mode.id })}>{mode.label}</button>)}
        </div>
        <div className="composer">
          {walrusOpen ? <WalrusMemoryPicker state={state} close={() => setWalrusOpen(false)} /> : null}
          {state.work.portableMemory.length > 0 ? (
            <div className="portable-memory-strip" aria-label="Attached portable memories">
              {state.work.portableMemory.map((memory) => <span key={memory.blobId} className="portable-memory-chip" title={`${memory.characters.toLocaleString()} characters · ${memory.blobId}`}><Database size={12} /><span>{memory.title}</span><button type="button" aria-label={`Remove ${memory.title}`} onClick={() => void command({ type: "remove-walrus-memory-attachment", blobId: memory.blobId })}><X size={11} /></button></span>)}
            </div>
          ) : null}
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
            placeholder={state.work.runtime !== "online" ? state.work.runtimeMessage : modelReady ? "Ask Locus to work with you…" : `Connect ${activeProvider?.name ?? "a model provider"} to begin…`}
            aria-label="Message Locus"
            rows={2}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.metaKey) { event.preventDefault(); void command({ type: "recording-assist" }); return; }
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
            }}
          />
          <div className="composer-actions">
            <button type="button" title="Attach images" aria-label="Attach images" disabled={state.work.busy || state.work.runtime !== "online" || state.work.attachments.length >= 10} onClick={() => void command({ type: "choose-work-attachments" })}><Paperclip size={15} /></button>
            <button type="button" className={walrusOpen ? "active" : ""} title={state.walrusMemory.usable ? "Search Walrus Memory" : "Connect Walrus Memory in Settings"} aria-label="Search Walrus Memory" disabled={state.work.busy} onClick={() => setWalrusOpen((open) => !open)}><Database size={15} /></button>
            {state.work.busy ? <span className={`composer-activity ${state.work.activity.phase}`} role="status"><i />{state.work.activity.label}</span> : null}
            <div className="composer-spacer" />
            <div className="display-preferences-wrap">
              <button type="button" title="Thinking and tool display" aria-label="Thinking and tool display" aria-expanded={displayMenu} onClick={() => setDisplayMenu((open) => !open)}><SlidersHorizontal size={14} /></button>
            </div>
            <span className="context-meter" title="Context window">8%</span>
            {state.work.busy
              ? <button type="button" className="send-button stop" title="Stop" onClick={() => void command({ type: "stop-work" })}><CircleStop size={17} /></button>
              : <button type="button" className="send-button" title="Send" disabled={!text.trim() || state.work.runtime !== "online" || !modelReady} onClick={submit}><SendHorizontal size={16} /></button>}
          </div>
        </div>
        {displayMenu ? <DisplayPreferences state={state} /> : null}
        <div className="composer-foot"><span>{state.work.busy ? state.work.activity.label : state.work.runtimeMessage}</span><span>{state.work.mode === "ask" ? "Ask uses shared context without tools" : "⌘↵ live help · ↵ send"}</span></div>
      </div>
    </div>
  );
}

function WalrusMemoryPicker({ state, close }: { state: BrowserAppState; close: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WalrusMemoryResultState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const connected = state.walrusMemory.usable && !["checking", "saving", "restoring", "publishing"].includes(state.walrusMemory.status);
  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim() || !connected) return;
    setLoading(true); setError("");
    try {
      const value = await window.locusBrowser.query({ type: "walrus-memory-search", query, limit: 10 });
      setResults(value as WalrusMemoryResultState[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Walrus Memory search failed");
    } finally { setLoading(false); }
  };
  const attach = async (blobId: string) => {
    setError("");
    try { await command({ type: "attach-walrus-memory", blobIds: [blobId] }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "This memory could not be attached"); }
  };
  return <section className="walrus-memory-picker" aria-label="Search Walrus Memory">
    <header><span><Database size={14} /><strong>Walrus Memory</strong><small>{state.walrusMemory.namespace}</small></span><button type="button" aria-label="Close Walrus Memory search" onClick={close}><X size={13} /></button></header>
    {!connected ? <div className="walrus-picker-disconnected"><p>{state.walrusMemory.message} Open browser Settings → Integrations to connect.</p></div> : <>
      <form onSubmit={search}><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search remote memories" aria-label="Walrus Memory query" /><button disabled={loading || !query.trim()}>{loading ? "Searching…" : "Search"}</button></form>
      <div className="walrus-result-list">
        {results.map((result) => <article key={result.blobId}><div><strong>{result.title}</strong><small title={result.blobId}>{Math.round(result.relevance * 100)}% relevance · blob {shortBlobId(result.blobId)}</small><p>{result.snippet}</p>{result.sourceUrl ? <i>{result.sourceUrl}</i> : null}</div><footer>{result.sourceUrl ? <button type="button" onClick={() => void command({ type: "open-walrus-memory-source", blobId: result.blobId })}>Open source</button> : null}<button type="button" className="primary" disabled={state.work.portableMemory.some((item) => item.blobId === result.blobId)} onClick={() => void attach(result.blobId)}>{state.work.portableMemory.some((item) => item.blobId === result.blobId) ? "Attached" : "Attach to Work"}</button></footer></article>)}
        {!loading && query.trim() && !results.length && !error ? <p className="walrus-picker-empty">No indexed matches yet. Recent saves can lag; Restore index is available in Settings.</p> : null}
      </div>
      {error ? <p className="walrus-picker-error" role="alert">{error}</p> : null}
    </>}
  </section>;
}

function ThinkingBlock({ message, visibility }: { message: WorkMessage; visibility: ThinkingVisibility }) {
  const [open, setOpen] = useState(visibility === "expanded");
  if (message.role !== "assistant" || !message.reasoningText || visibility === "hidden") return null;
  return (
    <details className="message-thinking" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><BrainCircuit size={12} />Thinking</summary>
      <p>{message.reasoningText}</p>
    </details>
  );
}

function ChatToolActivity({ state }: { state: BrowserAppState }) {
  const visibility = state.settings.toolActivityVisibility;
  const entries = state.work.terminal.slice(-5);
  if (visibility === "hidden" || !entries.length) return null;
  return (
    <section className={`chat-tool-activity ${visibility}`} aria-label="Recent tool activity">
      <header><Wrench size={12} /><span>Tool activity</span><small>{entries.length} recent</small></header>
      {entries.map((entry) => <ChatToolActivityEntry key={`${entry.id}:${visibility}:${entry.status}`} entry={entry} visibility={visibility} />)}
    </section>
  );
}

function ChatToolActivityEntry({ entry, visibility }: { entry: WorkTerminalEntryState; visibility: Exclude<ToolActivityVisibility, "hidden"> }) {
  const shouldOpen = visibility === "verbose" || entry.status === "running" || entry.status === "waiting";
  const [open, setOpen] = useState(shouldOpen);
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><i className={entry.status} />{displayToolLabel(entry.tool)}<small>{entry.status}</small></summary>
      <p>{entry.summary}</p>
      {visibility === "verbose" && entry.detail ? <pre>{entry.detail}</pre> : null}
      {visibility === "verbose" && entry.result ? <pre>{entry.result}</pre> : null}
    </details>
  );
}

function DisplayPreferences({ state }: { state: BrowserAppState }) {
  return (
    <section className="display-preferences" aria-label="Thinking and tool display preferences">
      <label><span><BrainCircuit size={13} /><i><strong>Thinking</strong><small>Reasoning in chat</small></i></span>
        <select value={state.settings.thinkingVisibility} onChange={(event) => void command({ type: "set-thinking-visibility", visibility: event.target.value as ThinkingVisibility })}>
          <option value="hidden">Hidden</option><option value="collapsed">Collapsed</option><option value="expanded">Expanded</option>
        </select>
      </label>
      <label><span><Wrench size={13} /><i><strong>Tool activity</strong><small>Runs in chat</small></i></span>
        <select value={state.settings.toolActivityVisibility} onChange={(event) => void command({ type: "set-tool-activity-visibility", visibility: event.target.value as ToolActivityVisibility })}>
          <option value="verbose">Verbose</option><option value="collapsed">Collapsed</option><option value="hidden">Hidden</option>
        </select>
      </label>
      <small>These defaults are also available in Settings.</small>
    </section>
  );
}

function LiveContextCard({ state }: { state: BrowserAppState }) {
  const active = Boolean(state.recording.id);
  const [expanded, setExpanded] = useState(active);
  return (
    <details className={`live-context-card ${state.recording.status}`} open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        <span className="live-context-pulse" />
        <span><strong>{active ? `Live context · ${formatRecordingDuration(state.recording.elapsedMs)}` : "Saved live transcript"}</strong><small>{state.recording.pausedReason || `${state.recording.transcriptPreview.length} recent transcript segments`}</small></span>
        <ChevronDown size={12} />
      </summary>
      <div className="live-transcript" aria-live="polite">
        {state.recording.transcriptPreview.length ? state.recording.transcriptPreview.slice(-5).map((segment) => (
          <p key={segment.id}><span>{segment.source === "microphone" ? <Mic size={11} /> : <Volume2 size={11} />}{segment.source === "microphone" ? "You" : "Tab"}</span>{segment.text}</p>
        )) : <p className="live-transcript-empty">Listening for speech. Raw audio is never saved.</p>}
      </div>
      {active ? <button type="button" className="live-assist" onClick={() => void command({ type: "recording-assist" })}><Sparkles size={12} />Help with this now <kbd>⌘↵</kbd></button> : null}
      {state.recording.error ? <p className="live-context-error">{state.recording.error}</p> : null}
    </details>
  );
}

function PermissionCard({ state }: { state: BrowserAppState }) {
  const request = state.work.pendingPermission!;
  return (
    <section className="permission-card" aria-live="assertive">
      <div className="permission-icon"><Shield size={17} /></div>
      <div className="permission-copy"><strong>{request.tool}</strong><p>{request.summary}</p></div>
      <div className="permission-actions">
        <button type="button" onClick={() => void command({ type: "answer-permission", requestId: request.requestId, decision: "deny" })}>Deny</button>
        <button type="button" onClick={() => void command({ type: "answer-permission", requestId: request.requestId, decision: "allow" })}>Allow once</button>
        <button className="primary" type="button" onClick={() => void command({ type: "answer-permission", requestId: request.requestId, decision: "always" })}>Allow for run</button>
      </div>
    </section>
  );
}

function RuntimeRecoveryBanner({ state }: { state: BrowserAppState }) {
  return (
    <section className={`runtime-recovery ${state.work.recovery.retrying ? "retrying" : ""}`} aria-live="assertive">
      <AlertTriangle size={15} />
      <span><strong>{state.work.recovery.retrying ? "Reconnecting local agent" : "Local agent is offline"}</strong><small>{state.work.runtimeMessage}</small></span>
      {state.work.recovery.canRetry ? <button type="button" onClick={() => void command({ type: "restart-work-runtime" })}><RotateCcw size={12} />Reconnect</button> : null}
    </section>
  );
}

function SurfacePanel({ panel, state }: { panel: Exclude<WorkPanel, "chat">; state: BrowserAppState }) {
  if (panel === "plan") return <PlanPanel state={state} />;
  if (panel === "changes") return <ChangesPanel state={state} />;
  if (panel === "files") return <FilesPanel state={state} />;
  return <TerminalPanel state={state} />;
}

function PlanPanel({ state }: { state: BrowserAppState }) {
  const plan = state.work.plan;
  const disabled = state.work.busy || state.work.runtime !== "online";
  if (!plan) {
    return <EmptyWorkSurface icon={<ClipboardList size={22} />} title={state.work.busy && state.work.mode === "plan" ? "Planning…" : "No plan yet"} text="Ask the solo agent for a decision-ready plan, then approve it before any build work starts."><button type="button" disabled={disabled} onClick={() => void command({ type: "request-work-plan" })}><ClipboardList size={13} />Create a plan</button></EmptyWorkSurface>;
  }
  const completed = plan.steps.filter((step) => step.status === "completed").length;
  return (
    <div className="work-surface plan-surface">
      <div className="work-surface-head">
        <span><small>{plan.pendingApproval ? "READY FOR APPROVAL" : state.work.busy ? "IN PROGRESS" : "SAVED PLAN"}</small><strong>{plan.title}</strong></span>
        <i>{completed}/{plan.steps.length}</i>
      </div>
      {plan.summary ? <p className="plan-summary">{plan.summary}</p> : null}
      <div className="plan-steps" role="list" aria-label="Plan steps">
        {plan.steps.map((step, index) => <div key={`${index}-${step.content}`} role="listitem" className={step.status}>
          <span>{step.status === "completed" ? <Check size={12} /> : step.status === "in_progress" ? <Clock3 size={12} /> : index + 1}</span>
          <p>{step.content}</p>
        </div>)}
      </div>
      {plan.tests.length ? <details className="plan-tests"><summary>Verification · {plan.tests.length}</summary>{plan.tests.map((test, index) => <p key={`${index}-${test}`}>{test}</p>)}</details> : null}
      {plan.pendingApproval ? <div className="plan-decision"><button type="button" disabled={disabled} onClick={() => void command({ type: "revise-work-plan" })}>Keep planning</button><button type="button" className="primary" disabled={disabled} onClick={() => void command({ type: "approve-work-plan" })}><Play size={13} />Build this plan</button></div> : <button type="button" className="surface-secondary" disabled={disabled} onClick={() => void command({ type: "request-work-plan" })}>Create a new plan</button>}
    </div>
  );
}

function ChangesPanel({ state }: { state: BrowserAppState }) {
  const changes = state.work.changes;
  const selected = changes.files.find((file) => file.path === changes.selectedPath);
  return (
    <div className="work-surface changes-surface">
      <div className="work-surface-head compact">
        <span><small>{changes.isRepository ? changes.branch ?? "DETACHED HEAD" : "WORKSPACE"}</small><strong>{changes.loading ? "Refreshing changes…" : `${changes.files.length} changed ${changes.files.length === 1 ? "file" : "files"}`}</strong></span>
        <button type="button" title="Refresh changes" aria-label="Refresh changes" disabled={changes.loading || state.work.runtime !== "online"} onClick={() => void command({ type: "refresh-work-changes" })}><RefreshCw size={13} /></button>
      </div>
      {changes.error ? <SurfaceNotice text={changes.error} /> : !changes.isRepository ? <EmptyWorkSurface icon={<GitBranch size={22} />} title="Git not detected" text="Choose a Git workspace to review the agent's edits here." /> : changes.files.length === 0 ? <EmptyWorkSurface icon={<CheckCircle2 size={22} />} title="Working tree clean" text="Edits made by the solo agent will appear here automatically." /> : <>
        <div className="change-file-list">
          {changes.files.map((file) => <button type="button" key={file.path} className={file.path === changes.selectedPath ? "selected" : ""} onClick={() => void command({ type: "select-work-change", path: file.path, staged: false })}>
            <span className={`change-status ${file.status}`}>{file.status.slice(0, 1).toUpperCase()}</span><span><strong>{file.path}</strong><small>{file.staged ? "Staged" : file.untracked ? "Untracked" : file.status}{typeof file.additions === "number" ? ` · +${file.additions}` : ""}{typeof file.deletions === "number" ? ` −${file.deletions}` : ""}</small></span>
          </button>)}
        </div>
        {selected ? <div className="diff-view">
          <div className="diff-head"><strong>{selected.path}</strong>{selected.staged && selected.unstaged ? <span><button type="button" className={!changes.selectedStaged ? "active" : ""} onClick={() => void command({ type: "select-work-change", path: selected.path, staged: false })}>Working</button><button type="button" className={changes.selectedStaged ? "active" : ""} onClick={() => void command({ type: "select-work-change", path: selected.path, staged: true })}>Staged</button></span> : null}</div>
          {changes.diffBinary ? <SurfaceNotice text="Binary file changed; no text diff is available." /> : changes.diff ? <pre>{changes.diff.split("\n").map((line, index) => <code key={index} className={line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : line.startsWith("@@") ? "hunk" : ""}>{line || " "}{"\n"}</code>)}</pre> : <p className="surface-muted">Select a changed file to inspect its diff.</p>}
          {changes.diffTruncated ? <small className="truncated-note">Diff preview was truncated for safety.</small> : null}
        </div> : null}
      </>}
    </div>
  );
}

function FilesPanel({ state }: { state: BrowserAppState }) {
  const [query, setQuery] = useState("");
  const files = state.work.files;
  const visible = files.entries.filter((entry) => entry.path.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 200);
  return (
    <div className="work-surface files-surface">
      <div className="work-surface-head compact"><span><small>{state.work.workspace?.name ?? "WORKSPACE"}</small><strong>{files.loading ? "Loading files…" : `${files.entries.length} text files`}</strong></span><button type="button" title="Refresh files" aria-label="Refresh files" disabled={files.loading || !state.work.workspace} onClick={() => void command({ type: "refresh-work-files" })}><RefreshCw size={13} /></button></div>
      {!state.work.workspace ? <EmptyWorkSurface icon={<FolderTree size={22} />} title="Choose a workspace" text="Select a trusted folder in Chat before browsing project files." /> : files.error ? <SurfaceNotice text={files.error} /> : <>
        <label className="file-filter"><span>Filter files</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search paths" /></label>
        <div className="workspace-file-list">
          {visible.map((file) => <button type="button" key={file.path} className={file.path === files.selectedPath ? "selected" : ""} onClick={() => void command({ type: "select-work-file", path: file.path })}><FileCode2 size={13} /><span><strong>{file.path}</strong><small>{formatBytes(file.size)}</small></span></button>)}
          {!visible.length ? <p className="surface-muted">No matching text files.</p> : null}
        </div>
        {files.selectedPath ? <div className="file-preview"><div><strong>{files.selectedPath}</strong></div>{files.content !== undefined ? <pre><code>{files.content}</code></pre> : <SurfaceNotice text={files.error ?? "Loading preview…"} />}{files.contentTruncated ? <small className="truncated-note">Preview limited to 512 KB.</small> : null}</div> : null}
        {files.truncated ? <small className="truncated-note">File list limited to the first 600 safe text files.</small> : null}
      </>}
    </div>
  );
}

function TerminalPanel({ state }: { state: BrowserAppState }) {
  const entries = state.work.terminal;
  return (
    <div className="work-surface terminal-surface">
      <div className="work-surface-head compact"><span><small>SOLO AGENT</small><strong>{entries.length ? `${entries.length} tool ${entries.length === 1 ? "run" : "runs"}` : "No tool activity"}</strong></span>{entries.length ? <button type="button" title="Clear activity" aria-label="Clear activity" onClick={() => void command({ type: "clear-work-terminal" })}><Trash2 size={13} /></button> : null}</div>
      {!entries.length ? <EmptyWorkSurface icon={<TerminalSquare size={22} />} title="Agent activity appears here" text="Commands, dev servers, and tool output stream here while the solo agent works. Shell actions still require permission." /> : <div className="terminal-feed" aria-live="polite">
        {entries.map((entry) => <article key={entry.id} className={entry.status}>
          <header><span>{entry.status === "done" ? <Check size={11} /> : entry.status === "error" || entry.status === "denied" ? <X size={11} /> : <Clock3 size={11} />}</span><strong>{entry.tool}</strong><small>{entry.status}</small></header>
          <p>{entry.summary}</p>{entry.detail ? <pre>{entry.detail}</pre> : null}{entry.result ? <pre className="result">{entry.result}</pre> : null}
        </article>)}
      </div>}
    </div>
  );
}

function EmptyWorkSurface({ icon, title, text, children }: { icon: React.ReactNode; title: string; text: string; children?: React.ReactNode }) {
  return <div className="surface-empty"><span>{icon}</span><h2>{title}</h2><p>{text}</p>{children ? <div>{children}</div> : null}</div>;
}

function SurfaceNotice({ text }: { text: string }) {
  return <p className="surface-notice"><AlertTriangle size={13} />{text}</p>;
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

function formatRecordingDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function displayToolLabel(value: string): string {
  return value.replace(/^browser_/, "Browser ").replaceAll("_", " ");
}

function shortBlobId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value;
}
