import { useEffect, useState, type ReactNode } from "react";
import { CircleAlert, KeyRound, LogIn, LogOut, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import type { BrowserCommand } from "../shared/ipc.js";
import type { ShellState as BrowserAppState, WorkModelProviderState } from "../shared/types.js";
import type { SettingsConfirmationRequest } from "./SettingsDialog.js";

type ManagedCredentialProviderId = "openai-api" | "kimi" | "claude-api" | "vllm";

function isManagedCredentialProvider(provider: WorkModelProviderState): provider is WorkModelProviderState & { id: ManagedCredentialProviderId } {
  return provider.id === "openai-api" || provider.id === "kimi" || provider.id === "claude-api" || provider.id === "vllm";
}

export function ModelSettings({ state, confirm }: { state: BrowserAppState; confirm: (request: SettingsConfirmationRequest) => void }) {
  const chatGPT = state.work.model.providers.find((provider) => provider.id === "chatgpt-plan");
  const credentialProviders = state.work.model.providers.filter(isManagedCredentialProvider);
  const disabled = state.work.busy || state.work.runtime !== "online" || state.work.model.switching;
  const vllm = credentialProviders.find((provider) => provider.id === "vllm");
  const standardCredentials = credentialProviders.filter((provider) => provider.id !== "vllm");
  const activeProvider = state.work.model.providers.find((provider) => provider.id === state.work.model.activeProvider);
  const providerCard = (provider: WorkModelProviderState, featured = false) => provider.id === "chatgpt-plan"
    ? <ChatGPTAccountCard key={provider.id} provider={provider} active activeModel={state.work.model.activeModel} disabled={disabled} confirm={confirm} featured={featured} />
    : isManagedCredentialProvider(provider)
      ? <CredentialProviderCard key={provider.id} provider={provider} active activeModel={state.work.model.activeModel} disabled={disabled} confirm={confirm} featured={featured} />
      : null;
  return (
    <section className="settings-page-section settings-models-page" id="settings-provider-accounts">
      <div className="model-context-guidance" role="note"><CircleAlert size={16} /><span><strong>Use a large-context model for browser work</strong><small>128K context is the practical minimum. 200K or more is recommended for long pages and multi-step work.</small></span></div>
      {activeProvider && activeProvider.id !== "local" ? <div className="provider-account-featured" aria-label="Active AI provider">{providerCard(activeProvider, true)}</div> : null}
      <div className="provider-account-grid">
        {chatGPT && activeProvider?.id !== chatGPT.id ? <ChatGPTAccountCard provider={chatGPT} active={false} activeModel={state.work.model.activeModel} disabled={disabled} confirm={confirm} /> : null}
        {standardCredentials.filter((provider) => activeProvider?.id !== provider.id).map((provider) => <CredentialProviderCard key={provider.id} provider={provider} active={false} activeModel={state.work.model.activeModel} disabled={disabled} confirm={confirm} />)}
      </div>
      {vllm && activeProvider?.id !== "vllm" ? <details className="settings-disclosure advanced-provider-disclosure" id="settings-advanced-providers"><summary><span><strong>Advanced providers</strong><small>Connect a local or remote vLLM-compatible endpoint.</small></span><span aria-hidden="true">›</span></summary><div className="provider-account-grid"><CredentialProviderCard provider={vllm} active={false} activeModel={state.work.model.activeModel} disabled={disabled} confirm={confirm} /></div></details> : null}
      <p className="model-settings-message" role="status">{state.work.model.message || "Choose a provider to use in Work."}</p>
      <div className="settings-card model-settings-card model-preferences-card">
        <div className="model-context-guidance" role="note"><ShieldCheck size={16} /><span><strong>Write-only credentials</strong><small>Add and replace keys through the macOS masked prompt. Locus never sends key values through renderer messages.</small></span></div>
        <button id="settings-local-models" type="button" role="switch" aria-checked={state.settings.localModelsEnabled} className="local-model-toggle" onClick={() => void command({ type: "set-local-models-enabled", enabled: !state.settings.localModelsEnabled })}>
          <span><strong>Local Work models</strong><small>Show Ollama models in the Work model picker. Off by default because local inference can slow browsing.</small></span>
          <span className={`settings-switch ${state.settings.localModelsEnabled ? "on" : ""}`} aria-hidden="true"><span /></span>
        </button>
        <p className="local-model-note">This setting affects Work Mode only. On-device speech transcription remains available separately.</p>
        <div className="ai-display-settings">
          <SettingRow id="settings-thinking" label="Thinking" detail="How model reasoning appears in Chat"><select value={state.settings.thinkingVisibility} onChange={(event) => void command({ type: "set-thinking-visibility", visibility: event.target.value as BrowserAppState["settings"]["thinkingVisibility"] })}><option value="hidden">Hidden</option><option value="collapsed">Collapsed</option><option value="expanded">Expanded</option></select></SettingRow>
          <SettingRow id="settings-tool-activity" label="Tool activity" detail="How agent tool runs appear in Chat"><select value={state.settings.toolActivityVisibility} onChange={(event) => void command({ type: "set-tool-activity-visibility", visibility: event.target.value as BrowserAppState["settings"]["toolActivityVisibility"] })}><option value="verbose">Verbose</option><option value="collapsed">Collapsed</option><option value="hidden">Hidden</option></select></SettingRow>
        </div>
      </div>
    </section>
  );
}

function ChatGPTAccountCard({ provider, active, activeModel, disabled, confirm, featured = false }: { provider: WorkModelProviderState; active: boolean; activeModel: string; disabled: boolean; confirm: (request: SettingsConfirmationRequest) => void; featured?: boolean }) {
  const account = provider.account;
  return <article className={`provider-account-card ${active ? "active" : ""} ${featured ? "featured" : ""}`} data-provider="chatgpt-plan">
    <header><span className="provider-account-mark">{provider.mark}</span><span><strong>{provider.name}</strong><small>{provider.detail}</small></span><i className={`provider-account-status ${provider.status}`}>{provider.status === "ready" ? active ? "In use" : "Connected" : provider.status === "signing-in" ? "Signing in" : "Not connected"}</i></header>
    {provider.status === "ready" ? <>
      <dl className="provider-account-meta">{account?.email ? <div><dt>Account</dt><dd>{account.email}</dd></div> : null}{account?.plan ? <div><dt>Plan</dt><dd>{humanizePlan(account.plan)}</dd></div> : null}{account?.runtimeVersion ? <div><dt>Runtime</dt><dd>{account.runtimeVersion}</dd></div> : null}</dl>
      <label className="provider-model-field"><span>Model</span><select value={active ? activeModel : provider.models[0]?.id || ""} disabled={disabled || !provider.models.length} onChange={(event) => void command({ type: "select-work-model", providerId: "chatgpt-plan", model: event.target.value })}>{provider.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
      {provider.usage?.windows.length ? <div className="chatgpt-usage-list" aria-label="ChatGPT plan usage">{provider.usage.windows.map((window) => <div key={window.id}><span><strong>{window.label}</strong><small>{window.resetsAt ? `Resets ${formatUsageReset(window.resetsAt)}` : window.windowDurationMinutes ? `${formatUsageDuration(window.windowDurationMinutes)} allowance` : "Current allowance"}</small></span><span>{Math.round(window.usedPercent)}% used</span><progress max={100} value={window.usedPercent} aria-label={`${window.label}: ${Math.round(window.usedPercent)} percent used`} /></div>)}</div> : <p className="provider-account-note">Usage details will appear when the account reports them.</p>}
      <footer className="provider-account-actions"><button type="button" disabled={disabled} onClick={() => void command({ type: "refresh-work-models" })}><RefreshCw size={12} />Refresh</button><button type="button" className="danger" disabled={disabled} onClick={() => confirm({ title: "Sign out of ChatGPT Plan?", consequence: "Work will lose access to this ChatGPT account until you sign in again. Your browser data will stay on this Mac.", confirmLabel: "Sign out", tone: "danger", command: { type: "sign-out-chatgpt" } })}><LogOut size={12} />Sign out</button></footer>
    </> : <><p className="provider-account-note">Sign in through the pinned Codex App Server to use your ChatGPT plan allowance. This does not use OpenAI API billing.</p><footer className="provider-account-actions"><button type="button" className="primary" disabled={disabled || provider.status === "signing-in" || provider.status === "unavailable"} onClick={() => void command({ type: "start-chatgpt-login" })}><LogIn size={12} />{provider.status === "signing-in" ? "Waiting for sign-in…" : "Sign in & use"}</button><button type="button" disabled={disabled} onClick={() => void command({ type: "refresh-work-models" })}><RefreshCw size={12} />Refresh</button></footer></>}
  </article>;
}

function CredentialProviderCard({ provider, active, activeModel, disabled, confirm, featured = false }: { provider: WorkModelProviderState & { id: ManagedCredentialProviderId }; active: boolean; activeModel: string; disabled: boolean; confirm: (request: SettingsConfirmationRequest) => void; featured?: boolean }) {
  const [model, setModel] = useState(active && activeModel ? activeModel : provider.models[0]?.id || "");
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl || "http://127.0.0.1:8000/v1");
  useEffect(() => { if (active && activeModel) setModel(activeModel); }, [active, activeModel]);
  const connect = () => command({ type: "configure-work-provider", providerId: provider.id, model, ...(provider.id === "vllm" ? { baseUrl } : {}) });
  const test = () => command({ type: "test-work-provider-credential", providerId: provider.id, model, ...(provider.id === "vllm" ? { baseUrl } : {}) });
  const selectModel = (next: string) => { setModel(next); if (provider.configured) void command({ type: "select-work-model", providerId: provider.id, model: next }); };
  return <article className={`provider-account-card ${active ? "active" : ""} ${featured ? "featured" : ""}`} data-provider={provider.id}>
    <header><span className="provider-account-mark">{provider.mark}</span><span><strong>{provider.name}</strong><small>{provider.detail}</small></span><i className={`provider-account-status ${provider.status}`}>{provider.configured ? active ? "In use" : "Connected" : "Not connected"}</i></header>
    {provider.id === "kimi" ? <p className="provider-account-note">Uses Kimi Code membership—not Moonshot pay-as-you-go API credit. HighSpeed requires Allegretto or higher.</p> : null}
    {provider.id === "vllm" ? <label className="provider-model-field"><span>Endpoint</span><input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://127.0.0.1:8000/v1" /></label> : null}
    <label className="provider-model-field"><span>Model</span>{provider.id === "vllm" ? <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="organization/model" /> : <select value={model} onChange={(event) => selectModel(event.target.value)}>{provider.models.map((option) => <option key={option.id} value={option.id}>{option.name}{option.detail ? ` — ${option.detail}` : ""}</option>)}</select>}</label>
    <p className="provider-account-note">{provider.statusMessage}</p>
    <footer className="provider-account-actions"><button type="button" className={provider.configured ? "" : "primary"} disabled={disabled || !model.trim() || (provider.id === "vllm" && !baseUrl.trim())} onClick={() => void connect()}><KeyRound size={12} />{provider.configured ? provider.id === "vllm" ? "Update" : "Replace key" : provider.id === "vllm" ? "Connect" : "Add key & use"}</button><button type="button" disabled={disabled || !model.trim() || (!provider.configured && provider.id !== "vllm")} onClick={() => void test()}><ShieldCheck size={12} />Test</button>{provider.configured ? <button type="button" className="danger" disabled={disabled} onClick={() => confirm({ title: provider.id === "vllm" ? "Disconnect vLLM?" : `Remove ${provider.name} credential?`, consequence: active ? "This is the active Work provider. Its stored credential and in-memory connection will be cleared, and Work will disconnect until you choose another provider." : provider.id === "vllm" ? "The endpoint and its optional credential will be removed from this profile." : "The encrypted credential will be removed from this profile and must be entered again to reconnect.", confirmLabel: provider.id === "vllm" ? "Disconnect" : "Remove credential", tone: "danger", command: { type: "remove-work-provider-credential", providerId: provider.id } })}><Trash2 size={12} />{provider.id === "vllm" ? "Disconnect" : "Remove"}</button> : null}</footer>
  </article>;
}

function SettingRow({ id, label, detail, children }: { id?: string; label: string; detail: string; children: ReactNode }) {
  return <label {...(id ? { id } : {})} className="setting-row"><span><strong>{label}</strong><small>{detail}</small></span>{children}</label>;
}

function humanizePlan(plan: string): string { return plan.replace(/[_-]+/g, " ").replace(/\b\w/g, (value) => value.toUpperCase()); }
function formatUsageReset(timestampSeconds: number): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestampSeconds * 1_000)); }
function formatUsageDuration(minutes: number): string {
  if (minutes % 10_080 === 0) return `${minutes / 10_080} week`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440} day`;
  if (minutes % 60 === 0) return `${minutes / 60} hour`;
  return `${minutes} minute`;
}
async function command(value: BrowserCommand) { return await window.locusBrowser.command(value); }
