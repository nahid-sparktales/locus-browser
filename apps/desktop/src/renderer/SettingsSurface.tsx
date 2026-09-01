import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bot, Check, ChevronRight, CircleAlert, Cloud, CloudOff, Copy, Database, ExternalLink,
  EyeOff, FolderPlus, KeyRound, Laptop, LockKeyhole, LogIn, LogOut, Mic, Palette,
  Plus, Puzzle, RefreshCw, Search, Settings, ShieldCheck, Trash2, UserRound, X,
} from "lucide-react";
import type { BrowserCommand } from "../shared/ipc.js";
import type { SettingsPageId } from "../shared/settings.js";
import type { ShellState as BrowserAppState } from "../shared/types.js";
import { ACCENT_OPTIONS, resolveAccentPalette } from "../shared/accent.js";
import { ModelSettings } from "./ModelSettings.js";
import { SettingsDialog, type SettingsConfirmationRequest, type SettingsDialogRequest } from "./SettingsDialog.js";
import { getSettingsPage, searchSettings, SETTINGS_GROUPS, SETTINGS_PAGES, type SettingsSearchItem } from "./settingsCatalog.js";

const pageIcons: Record<SettingsPageId, typeof Settings> = {
  general: Settings,
  appearance: Palette,
  profiles: UserRound,
  models: Bot,
  speech: Mic,
  privacy: ShieldCheck,
  sync: Cloud,
  extensions: Puzzle,
  integrations: Database,
};

export function SettingsSurface({
  state,
  top,
  page,
  onPageChange,
  requestedAnchor,
}: {
  state: BrowserAppState;
  top: number;
  page: SettingsPageId;
  onPageChange: (page: SettingsPageId) => void;
  requestedAnchor?: string;
}) {
  const initialSearch = useMemo(() => new URLSearchParams(window.location.search).get("settingsSearch") ?? "", []);
  const initialDialog = useMemo<SettingsDialogRequest | undefined>(() => {
    if (document.documentElement.dataset.locusPreview !== "true" || new URLSearchParams(window.location.search).get("settingsDialog") !== "provider-removal") return undefined;
    return { kind: "confirmation", title: "Remove Kimi Membership credential?", consequence: "The encrypted credential will be removed from this profile and must be entered again to reconnect.", confirmLabel: "Remove credential", tone: "danger", command: { type: "remove-work-provider-credential", providerId: "kimi" } };
  }, []);
  const [query, setQuery] = useState(initialSearch);
  const [pendingAnchor, setPendingAnchor] = useState<string>();
  const [dialog, setDialog] = useState<SettingsDialogRequest | undefined>(initialDialog);
  const descriptor = getSettingsPage(page);
  const results = useMemo(() => searchSettings(query), [query]);
  const confirm = useCallback((request: SettingsConfirmationRequest) => setDialog({ kind: "confirmation", ...request }), []);
  const addRecallExclusion = useCallback(() => setDialog({
    kind: "input",
    title: "Exclude a website from Recall",
    detail: "Pages from this website will not be added to Private Semantic Recall on this profile.",
    label: "Website address",
    placeholder: "https://example.com",
    submitLabel: "Exclude website",
    validate: (value) => {
      try {
        const url = new URL(value.trim());
        return url.protocol === "http:" || url.protocol === "https:" ? undefined : "Enter an http or https website address.";
      } catch { return "Enter a valid website address."; }
    },
    submit: (value) => ({ type: "add-recall-exclusion", origin: new URL(value).origin }),
  }), []);

  useEffect(() => {
    if (requestedAnchor) setPendingAnchor(requestedAnchor);
  }, [requestedAnchor]);

  useEffect(() => {
    const anchor = pendingAnchor;
    if (!anchor) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(anchor);
      if (!target) return;
      const disclosure = target instanceof HTMLDetailsElement ? target : target.closest("details");
      if (disclosure instanceof HTMLDetailsElement) disclosure.open = true;
      target.scrollIntoView({ block: "center" });
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
      setPendingAnchor(undefined);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [page, pendingAnchor]);

  const selectPage = (next: SettingsPageId) => {
    setQuery("");
    setPendingAnchor(undefined);
    onPageChange(next);
  };
  const openResult = (result: SettingsSearchItem) => {
    setQuery("");
    setPendingAnchor(result.anchor);
    onPageChange(result.page);
  };

  return <main className="settings-surface" style={{ top, right: state.workOpen && !state.workOverlay ? state.workWidth : 0 }} aria-label="Locus Browser settings">
    <div className="settings-page-layout">
      <aside className="settings-sidebar">
        <header className="settings-sidebar-heading"><span className="settings-page-mark"><Settings size={18} /></span><span><h1>Settings</h1><p>Personalize Locus Browser</p></span></header>
        <SearchField value={query} onChange={setQuery} />
        <nav className="settings-page-nav" aria-label="Settings categories">
          {SETTINGS_GROUPS.map((group) => <section key={group.id} aria-labelledby={`settings-group-${group.id}`}>
            <h2 id={`settings-group-${group.id}`}>{group.title}</h2>
            {SETTINGS_PAGES.filter((item) => item.group === group.id).map((item) => {
              const Icon = pageIcons[item.id];
              return <button key={item.id} type="button" aria-current={!query && page === item.id ? "page" : undefined} onClick={() => selectPage(item.id)}><Icon size={15} /><span>{item.title}</span></button>;
            })}
          </section>)}
        </nav>
      </aside>
      <section className="settings-detail" aria-labelledby="settings-detail-title">
        <header className="settings-detail-heading">
          <span><h1 id="settings-detail-title">{query ? "Search settings" : descriptor.title}</h1><p>{query ? `Find controls matching “${query}”.` : descriptor.description}</p></span>
          <button type="button" title="Close settings" aria-label="Close settings" onClick={() => void command({ type: "close-settings" })}><X size={16} /></button>
        </header>
        <div className="settings-compact-controls">
          <label><span>Category</span><select aria-label="Settings category" value={page} onChange={(event) => selectPage(event.target.value as SettingsPageId)}>{SETTINGS_GROUPS.map((group) => <optgroup key={group.id} label={group.title}>{SETTINGS_PAGES.filter((item) => item.group === group.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</optgroup>)}</select></label>
          <SearchField value={query} onChange={setQuery} compact />
        </div>
        <div className="settings-page-scroll">
          {query ? <SettingsSearchResults query={query} results={results} open={openResult} /> : <SettingsPage state={state} page={page} confirm={confirm} addRecallExclusion={addRecallExclusion} />}
        </div>
      </section>
    </div>
    {dialog ? <SettingsDialog request={dialog} onClose={() => setDialog(undefined)} /> : null}
  </main>;
}

function SearchField({ value, onChange, compact = false }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  return <label className={`settings-search ${compact ? "compact" : ""}`}><Search size={14} aria-hidden="true" /><input type="search" aria-label="Search settings" placeholder="Search settings" value={value} onChange={(event) => onChange(event.target.value)} />{value ? <button type="button" title="Clear settings search" onClick={() => onChange("")}><X size={12} /></button> : null}</label>;
}

function SettingsSearchResults({ query, results, open }: { query: string; results: SettingsSearchItem[]; open: (result: SettingsSearchItem) => void }) {
  if (!results.length) return <div className="settings-search-empty"><Search size={25} /><h2>No settings found</h2><p>Try a control name such as “passwords,” “accent,” or “API key.”</p></div>;
  return <div className="settings-search-results" role="list" aria-label={`Settings matching ${query}`}>{results.map((result) => <button type="button" role="listitem" key={result.id} onClick={() => open(result)}><span><strong>{result.title}</strong><small>{result.description}</small><em>{getSettingsPage(result.page).title}</em></span><ChevronRight size={15} /></button>)}</div>;
}

function SettingsPage({ state, page, confirm, addRecallExclusion }: { state: BrowserAppState; page: SettingsPageId; confirm: (request: SettingsConfirmationRequest) => void; addRecallExclusion: () => void }) {
  switch (page) {
    case "general": return <GeneralSettings state={state} />;
    case "appearance": return <AppearanceSettings state={state} />;
    case "profiles": return <ProfileSettings state={state} confirm={confirm} />;
    case "models": return <ModelSettings state={state} confirm={confirm} />;
    case "speech": return <SpeechSettings state={state} />;
    case "privacy": return <PrivacySettings state={state} confirm={confirm} addRecallExclusion={addRecallExclusion} />;
    case "sync": return state.privateWindow ? <PrivateUnavailable feature="Sync" /> : <SyncSettings state={state} confirm={confirm} />;
    case "extensions": return <ExtensionSettings state={state} confirm={confirm} />;
    case "integrations": return state.privateWindow ? <PrivateUnavailable feature="Integrations" /> : <WalrusMemorySettings state={state} confirm={confirm} />;
  }
}

function GeneralSettings({ state }: { state: BrowserAppState }) {
  return <section className="settings-page-section"><div className="settings-card settings-general-grid">
    <SettingRow id="settings-search-engine" label="Search engine" detail="Used for address bar searches"><select value={state.settings.searchEngine} onChange={(event) => void command({ type: "set-search-engine", searchEngine: event.target.value as BrowserAppState["settings"]["searchEngine"] })}><option value="duckduckgo">DuckDuckGo</option><option value="brave">Brave</option><option value="google">Google</option><option value="bing">Bing</option></select></SettingRow>
    <SettingRow id="settings-sleep-tabs" label="Sleep background tabs" detail="Never sleeps audio, downloads, or shared tabs"><select value={state.settings.sleepAfterMinutes} onChange={(event) => void command({ type: "set-sleep-after", minutes: Number(event.target.value) as 0 | 15 | 30 | 60 })}><option value={0}>Never</option><option value={15}>After 15 minutes</option><option value={30}>After 30 minutes</option><option value={60}>After 1 hour</option></select></SettingRow>
    <SettingRow id="settings-downloads" label="Downloads" detail={state.settings.downloadDirectory}><button type="button" onClick={() => void command({ type: "choose-download-directory" })}>Choose folder…</button></SettingRow>
  </div></section>;
}

function AppearanceSettings({ state }: { state: BrowserAppState }) {
  return <section className="settings-page-section"><div className="settings-card settings-appearance-card">
    <SettingRow id="settings-theme" label="Appearance" detail="System follows your Mac automatically"><select value={state.settings.appearance} onChange={(event) => void command({ type: "set-appearance", appearance: event.target.value as BrowserAppState["settings"]["appearance"] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></SettingRow>
    <AccentColorSettings state={state} />
  </div></section>;
}

function ProfileSettings({ state, confirm }: { state: BrowserAppState; confirm: (request: SettingsConfirmationRequest) => void }) {
  return <section className="settings-page-section"><div className="settings-card settings-list-card" id="settings-profile-list">{state.profiles.map((profile) => <div className="permission-setting" key={profile.id}><span><strong>{profile.name}</strong><small>{profile.id === state.profileId ? "Current profile" : "Separate cookies and browsing data"}</small></span>{profile.id !== "default" && profile.id !== state.profileId ? <button title={`Delete ${profile.name}`} onClick={() => confirm({ title: `Delete “${profile.name}” profile?`, consequence: "Its cookies, history, extensions, and other local browsing data will be permanently deleted. This cannot be undone.", confirmLabel: "Delete profile", tone: "danger", command: { type: "delete-profile", profileId: profile.id } })}><Trash2 size={12} /></button> : null}</div>)}</div></section>;
}

function PrivacySettings({ state, confirm, addRecallExclusion }: { state: BrowserAppState; confirm: (request: SettingsConfirmationRequest) => void; addRecallExclusion: () => void }) {
  return <section className="settings-page-section privacy-settings-grid">
    <article className="settings-card settings-list-card" id="settings-recall"><CardHeading title="Recall" detail="An encrypted, local index you explicitly enable." />
      <button type="button" role="switch" aria-checked={state.settings.semanticRecallEnabled} className="local-model-toggle" disabled={state.privateWindow} onClick={() => void command({ type: "set-semantic-recall-enabled", enabled: !state.settings.semanticRecallEnabled })}><span><strong>Recall pages on this Mac</strong><small>Eligible pages visited from now on are encrypted locally. Private pages, fields, local files, and internal pages are excluded.</small></span><span className={`settings-switch ${state.settings.semanticRecallEnabled ? "on" : ""}`} aria-hidden="true"><span /></span></button>
      <div className="recall-settings-status"><span><strong>{state.semanticRecall.documentCount} indexed pages</strong><small>{formatBytes(state.semanticRecall.storageBytes)} of {formatBytes(state.semanticRecall.capBytes)} · {state.semanticRecall.message}</small></span><button type="button" onClick={addRecallExclusion}>Exclude site…</button><button type="button" className="danger" disabled={!state.semanticRecall.documentCount} onClick={() => confirm({ title: "Clear all Recall data?", consequence: "Every encrypted Recall page in this profile will be permanently deleted. Bookmarks and normal history will stay.", confirmLabel: "Clear Recall data", tone: "danger", command: { type: "clear-semantic-recall" } })}>Clear Recall Data</button></div>
      <div id="settings-recall-exclusions">{state.semanticRecall.excludedOrigins.length ? <div className="recall-exclusions">{state.semanticRecall.excludedOrigins.map((origin) => <span key={origin}>{origin}<button title={`Allow recall on ${origin}`} onClick={() => void command({ type: "remove-recall-exclusion", origin })}><X size={10} /></button></span>)}</div> : <p className="settings-empty">No websites are excluded.</p>}</div>
    </article>
    <article className="settings-card settings-list-card" id="settings-passwords"><CardHeading title="Passwords" detail="OS-encrypted and never available to agents." />{!state.passwordManagerAvailable ? <p className="settings-empty">OS-backed password encryption is unavailable on this Mac.</p> : state.savedCredentials.length ? state.savedCredentials.map((credential) => <div className="permission-setting credential-setting" key={credential.id}><span><strong>{credential.username || "No username"}</strong><small>{safeHostname(credential.origin)} · Updated {formatTime(credential.updatedAt)}</small></span><button title={`Delete saved login for ${safeHostname(credential.origin)}`} onClick={() => confirm({ title: `Delete saved login for ${safeHostname(credential.origin)}?`, consequence: "The encrypted username and password will be removed from this profile. This cannot be undone.", confirmLabel: "Delete saved login", tone: "danger", command: { type: "delete-credential", credentialId: credential.id } })}><Trash2 size={12} /></button></div>) : <p className="settings-empty">Saved logins will appear here. Passwords are never shown in browser chrome or Work.</p>}</article>
    <article className="settings-card settings-list-card" id="settings-site-permissions"><CardHeading title="Site permissions" detail="Review what websites can use." />{state.sitePermissions.length ? state.sitePermissions.map((permission) => <div className="permission-setting" key={`${permission.origin}:${permission.permission}`}><span><strong>{safeHostname(permission.origin)}</strong><small>{permission.permission} · {permission.decision}</small></span><button title="Ask again" onClick={() => void command({ type: "reset-site-permission", origin: permission.origin, permission: permission.permission })}><X size={11} /></button></div>) : <p className="settings-empty">Sites you allow or block will appear here.</p>}</article>
  </section>;
}

function CardHeading({ title, detail }: { title: string; detail: string }) {
  return <header className="settings-card-heading"><h2>{title}</h2><p>{detail}</p></header>;
}

function PrivateUnavailable({ feature }: { feature: string }) {
  return <div className="settings-private-unavailable"><EyeOff size={22} /><h2>{feature} is off in Private Windows</h2><p>Open Settings in a regular window to manage this category.</p></div>;
}

function AccentColorSettings({ state }: { state: BrowserAppState }) {
  const selection = state.settings.accent;
  const current = resolveAccentPalette(selection);
  return <div className="accent-settings" id="settings-accent" aria-labelledby="accent-colour-title"><div className="accent-settings-heading"><span className="accent-current-mark" style={{ "--option-logo": current.logoHex, "--option-ink": current.brandInkHex } as React.CSSProperties} aria-hidden="true">L</span><span><strong id="accent-colour-title">Accent colour</strong><small>Buttons, highlights, icons, and Locus marks update together.</small></span></div><div className="accent-option-grid" role="radiogroup" aria-label="Accent colour presets">{ACCENT_OPTIONS.map((option) => { const palette = resolveAccentPalette({ preset: option.id, customHex: selection.customHex }); const selected = selection.preset === option.id; return <button type="button" role="radio" aria-checked={selected} className={selected ? "selected" : ""} key={option.id} onKeyDown={navigateRadioGroup} onClick={() => void command({ type: "set-accent-color", preset: option.id, customHex: selection.customHex })}><span className="accent-option-mark" style={{ "--option-logo": palette.logoHex, "--option-ink": palette.brandInkHex } as React.CSSProperties} aria-hidden="true">L</span><span>{option.title}</span></button>; })}</div><label className={`accent-custom-picker ${selection.preset === "custom" ? "selected" : ""}`}><input type="color" value={`#${selection.customHex}`} onChange={(event) => void command({ type: "set-accent-color", preset: "custom", customHex: event.target.value.replace(/^#/, "") })} aria-label="Choose any accent colour" /><span><strong>Choose any colour</strong><small>Custom · #{selection.customHex}</small></span><span className="accent-custom-swatch" style={{ background: `#${selection.customHex}` }} aria-hidden="true" /></label></div>;
}

function SpeechSettings({ state }: { state: BrowserAppState }) {
  const speech = state.settings.speech;
  const [engine, setEngine] = useState(speech.engine);
  const [baseUrl, setBaseUrl] = useState(speech.customBaseUrl ?? "https://");
  const [model, setModel] = useState(speech.customModel ?? "whisper-1");
  const [error, setError] = useState("");
  const save = async (nextEngine: BrowserAppState["settings"]["speech"]["engine"] = speech.engine) => { setError(""); try { await command({ type: "configure-speech", engine: nextEngine, language: speech.language, ...(nextEngine === "custom" ? { baseUrl, model } : {}) }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Speech settings could not be saved"); } };
  return <section className="settings-page-section"><div className="settings-card"><div className="speech-settings"><div className="speech-card">
    <label id="settings-transcription"><span><strong>Transcription</strong><small>Used only during a visible live recording</small></span><select value={engine} onChange={(event) => { const next = event.target.value as typeof speech.engine; setEngine(next); if (next !== "custom") void save(next); }}><option value="local">On-device</option><option value="openai">OpenAI API</option><option value="custom">Custom endpoint</option></select></label>
    {engine === "local" ? <div className="speech-runtime-row" id="settings-speech-model"><span><strong>{speech.localModelStatus === "ready" ? "Ready on this Mac" : "Model download required"}</strong><small>{speech.message || "A checksummed multilingual Whisper model is stored locally."}</small></span>{speech.localModelStatus !== "ready" ? <button type="button" disabled={speech.localModelStatus === "downloading"} onClick={() => void command({ type: "download-speech-model" })}>{speech.localModelStatus === "downloading" ? `${Math.round((speech.localModelProgress ?? 0) * 100)}%` : "Download"}</button> : <Check size={13} />}</div> : engine === "openai" ? <p>Uses the encrypted OpenAI API credential from the model picker and <code>gpt-4o-mini-transcribe</code>. Short audio chunks leave this Mac; raw audio is never stored.</p> : <form id="settings-speech-endpoint" onSubmit={(event) => { event.preventDefault(); void save("custom"); }}><label><span>HTTPS or loopback URL</span><input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://speech.example.com/v1" /></label><label><span>Model</span><input value={model} onChange={(event) => setModel(event.target.value)} /></label><p>The API key, if needed, is entered in a macOS masked prompt after you choose Save.</p><button type="submit">Save & enter key…</button></form>}
    {error ? <p className="recording-error" role="alert">{error}</p> : null}
  </div></div></div></section>;
}

function ExtensionSettings({ state, confirm }: { state: BrowserAppState; confirm: (request: SettingsConfirmationRequest) => void }) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const run = async (key: string, value: BrowserCommand) => { setBusy(key); setError(undefined); try { await command(value); } catch (caught) { setError(caught instanceof Error ? caught.message : "Extension request failed"); } finally { setBusy(undefined); } };
  const manager = state.extensions;
  const gallery = manager.gallery ?? { status: "disabled" as const, message: "The curated extension gallery is unavailable.", entries: [] };
  return <section className="settings-page-section"><div className="settings-card extension-settings">
    {state.privateWindow ? <div className="extension-private-note"><EyeOff size={14} /><span><strong>Off in Private Windows</strong><small>Extensions cannot inspect or change private pages.</small></span></div> : <>
      <div className="extension-gallery-heading" id="settings-extension-gallery"><span><span className="extension-icon verified"><ShieldCheck size={15} /></span><span><strong>Curated gallery</strong><small>Every download is independently verified before installation.</small></span></span><button type="button" disabled={Boolean(busy) || gallery.status === "loading"} onClick={() => void run("refresh-gallery", { type: "refresh-extension-gallery" })}><RefreshCw size={11} />Refresh</button></div>
      <p className={`extension-gallery-status ${gallery.status === "error" ? "error" : ""}`} role="status" aria-live="polite">{gallery.message}</p>
      {gallery.entries.length ? <div className="extension-gallery-list">{gallery.entries.map((extension) => <article className="extension-gallery-item" key={extension.id}><header><span><strong>{extension.name}</strong><small>{extension.version} · {formatBytes(extension.packageSize)}</small></span><button type="button" disabled={Boolean(busy) || gallery.status !== "ready" || extension.action === "installed"} onClick={() => void run(`gallery-${extension.id}`, { type: "install-gallery-extension", extensionId: extension.id })}>{extension.action === "update" ? `Update from ${extension.installedVersion}` : extension.action === "installed" ? "Installed" : "Install"}</button></header>{extension.description ? <p>{extension.description}</p> : null}<div className="extension-verification"><ShieldCheck size={11} /><span>Publisher {extension.verifiedPublisher}</span></div><div className="extension-access"><span>APIs · {extension.permissions.length || "None"}</span><span>Sites · {extension.hostPermissions.length || "None"}</span></div></article>)}</div> : null}
      <div className="extension-gallery-card"><span className="extension-icon"><FolderPlus size={15} /></span><span><strong>Signed package file</strong><small>Install a trusted `.locusx` file you already downloaded.</small></span><button type="button" disabled={Boolean(busy) || manager.loading || manager.trustedGalleryKeyCount === 0} onClick={() => void run("install-signed", { type: "install-signed-extension" })}>Install…</button></div>
      <details className="settings-disclosure" id="settings-extension-developer"><summary><span><strong>Developer Mode</strong><small>Load reviewed, unpacked MV3 extensions for this profile only.</small></span><ChevronRight size={15} /></summary><div className="extension-developer-tools"><SettingRow label="Developer Mode" detail="Allows locally reviewed unpacked extensions"><button type="button" role="switch" aria-checked={manager.developerMode} aria-label="Extension Developer Mode" className={`settings-switch ${manager.developerMode ? "on" : ""}`} disabled={Boolean(busy) || manager.loading} onClick={() => void run("developer-mode", { type: "set-extension-developer-mode", enabled: !manager.developerMode })}><span /></button></SettingRow><p className="extension-contract">{manager.message} {manager.trustedGalleryKeyCount} trusted gallery key · {manager.supportedApiCount} current engine-backed permission groups. Unsupported capabilities and remote executable code are rejected.</p><button className="extension-load-button" type="button" disabled={!manager.developerMode || Boolean(busy) || manager.loading} onClick={() => void run("install", { type: "install-unpacked-extension" })}><FolderPlus size={13} />Load unpacked extension…</button></div></details>
      {error ? <p className="extension-error" role="alert"><CircleAlert size={12} />{error}</p> : null}
      <div id="settings-installed-extensions">{manager.installs.length ? <div className="extension-list">{manager.installs.map((extension) => { const attention = Boolean(extension.error); const needsGalleryInstall = extension.source === "gallery" && !extension.installPath; const status = needsGalleryInstall ? "Not on this Mac" : attention ? "Needs attention" : extension.loaded ? "Loaded" : extension.source === "developer" && extension.enabled && !manager.developerMode ? "Developer Mode off" : extension.enabled ? "Waiting" : "Disabled"; const disableToggle = Boolean(busy) || manager.loading || needsGalleryInstall || (extension.source === "developer" && !manager.developerMode); return <article className={`extension-card ${attention ? "attention" : ""}`} key={extension.id}><header><span className="extension-icon"><Puzzle size={14} /></span><span><strong>{extension.name}</strong><small>{extension.version} · {extension.source === "developer" ? "Unpacked" : "Gallery"}</small></span><i className={extension.loaded ? "loaded" : attention ? "attention" : ""}>{status}</i></header>{extension.description ? <p>{extension.description}</p> : null}<div className="extension-access"><span>APIs · {extension.permissions.length || "None"}</span><span>Sites · {extension.hostPermissions.length || "None"}</span></div>{attention ? <p className="extension-card-error"><CircleAlert size={11} />{extension.error}</p> : null}<footer>{extension.rollbackVersion ? <button type="button" disabled={Boolean(busy) || manager.loading} onClick={() => void run(`rollback-${extension.id}`, { type: "rollback-extension", extensionId: extension.id })}>Roll back to {extension.rollbackVersion}</button> : null}<button type="button" disabled={disableToggle} onClick={() => void run(extension.id, { type: "set-extension-enabled", extensionId: extension.id, enabled: attention ? true : !extension.enabled })}>{needsGalleryInstall ? "Gallery required" : attention ? "Review & enable" : extension.enabled ? "Disable" : "Enable"}</button><button type="button" className="danger" disabled={Boolean(busy)} onClick={() => confirm({ title: `Remove ${extension.name}?`, consequence: "The extension and its local configuration will be removed from this profile.", confirmLabel: "Remove extension", tone: "danger", command: { type: "remove-extension", extensionId: extension.id } })}>Remove</button></footer></article>; })}</div> : <p className="settings-empty">No extensions installed in this profile.</p>}</div>
    </>}
  </div></section>;
}

function SyncSettings({ state, confirm }: { state: BrowserAppState; confirm: (request: SettingsConfirmationRequest) => void }) {
  const [serviceUrl, setServiceUrl] = useState(state.sync.serviceUrl ?? state.configuredSyncServiceUrl ?? "");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [connectionMethod, setConnectionMethod] = useState<"create" | "recover" | "device">("create");
  const [pairingCode, setPairingCode] = useState("");
  const [formError, setFormError] = useState<string>();
  const busy = state.sync.status === "connecting" || state.sync.status === "syncing";
  const run = async (action: () => Promise<unknown>) => { setFormError(undefined); try { await action(); } catch (error) { setFormError(error instanceof Error ? error.message : "Sync request failed"); } };
  const pending = state.sync.pendingEnrollment;
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (connectionMethod === "create") void run(() => command({ type: "begin-sync-registration", displayName: state.currentProfile.name, serviceUrl })); else if (connectionMethod === "recover") void run(() => command({ type: "begin-sync-sign-in", recoveryKey, serviceUrl })); else void run(() => command({ type: "begin-sync-device-enrollment", serviceUrl })); };
  return <section className="settings-page-section"><div className="settings-card sync-settings" id="settings-encrypted-sync">{state.sync.accountId ? <div className="sync-card">
    <div className="sync-card-heading"><span className={`sync-status-icon ${state.sync.status}`}><Cloud size={15} /></span><span><strong>{state.sync.status === "syncing" ? "Syncing…" : state.sync.status === "error" ? "Sync needs attention" : "End-to-end encrypted"}</strong><small>{state.sync.lastSyncedAt ? `Last synced ${formatTime(state.sync.lastSyncedAt)}` : "Ready for its first sync"}</small></span></div>
    {state.sync.lastError ? <p className="sync-error" role="alert">{state.sync.lastError}</p> : null}<p className="sync-privacy">Bookmarks, history, tab groups, open web tabs, selected settings, and gallery extension metadata. Never passwords, cookies, downloads, workspaces, or Locus sessions.</p><div className="sync-actions"><button className="primary" disabled={busy} onClick={() => void command({ type: "sync-now" })}><Cloud size={12} />Sync now{state.sync.pendingRecords ? ` · ${state.sync.pendingRecords}` : ""}</button><button disabled={busy} onClick={() => confirm({ title: "Disconnect sync?", consequence: "This profile will stop syncing. Local browser data will stay on this Mac.", confirmLabel: "Disconnect", tone: "danger", command: { type: "disconnect-sync" } })}><LogOut size={12} />Disconnect</button></div>
    <div id="settings-sync-devices"><div className="sync-section-heading"><span>Devices</span><small>{state.sync.devices.length}</small></div><div className="sync-device-list">{state.sync.devices.map((device) => <div className="sync-device" key={device.deviceId}><span className="sync-device-icon"><Laptop size={12} /></span><span><strong>{device.name}</strong><small>{device.current ? "This Mac" : `Seen ${formatTime(device.lastSeenAt)}`} · Key v{device.keyVersion}</small></span>{!device.current ? <button title={`Revoke ${device.name}`} disabled={busy} onClick={() => void run(() => command({ type: "revoke-sync-device", deviceId: device.deviceId }))}><X size={11} /></button> : null}</div>)}</div><details className="sync-device-add"><summary><Plus size={11} />Approve another device</summary><form className="sync-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { await command({ type: "approve-sync-device", pairingCode }); setPairingCode(""); }); }}><label><span>Pairing code from the new device</span><textarea required rows={3} value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} placeholder="LOCUS-DEVICE:…" autoComplete="off" spellCheck={false} /></label><button className="sync-connect primary" type="submit" disabled={busy}><ShieldCheck size={12} />Review device</button></form></details></div>
    <div className="sync-recovery-row" id="settings-sync-recovery"><span><strong>Recovery key</strong><small>Version {state.sync.keyVersion ?? 1} · rotating updates every active device</small></span><button disabled={busy} onClick={() => void run(() => command({ type: "rotate-sync-recovery-key" }))}><RefreshCw size={11} />Rotate</button></div>
    <details className="sync-danger settings-disclosure" id="settings-sync-danger"><summary><span><strong>Cloud data controls</strong><small>Permanent cloud and account deletion actions.</small></span><ChevronRight size={15} /></summary><p>Deleting cloud data keeps this Mac connected. Local data can upload again on a later sync.</p><div className="sync-actions"><button disabled={busy} onClick={() => confirm({ title: "Delete encrypted cloud data?", consequence: "All encrypted browser data stored in the cloud will be deleted. It can upload again while this profile remains connected.", confirmLabel: "Delete cloud data", tone: "danger", command: { type: "delete-sync-cloud-data" } })}><CloudOff size={12} />Delete cloud data</button><button className="danger" disabled={busy} onClick={() => confirm({ title: "Permanently delete this sync account?", consequence: "The account, devices, passkeys, and all encrypted cloud data will be deleted. Local browser data will stay on this Mac.", confirmLabel: "Delete sync account", tone: "danger", command: { type: "delete-sync-account" } })}><Trash2 size={12} />Delete account</button></div></details>
  </div> : <div className="sync-card"><div className="sync-card-heading"><span className="sync-status-icon"><ShieldCheck size={15} /></span><span><strong>Optional and private</strong><small>A passkey protects your account. Locus cannot decrypt your browser data.</small></span></div>{pending ? <div className="sync-pairing" aria-live="polite"><span className="sync-pairing-mark"><Laptop size={15} /></span><strong>Approve this Mac from another device</strong><p>Open Sync on a connected device, choose Approve another device, then paste this code.</p><code>{pending.pairingCode}</code><div className="sync-actions"><button className="primary" onClick={() => void command({ type: "copy-sync-pairing-code" })}><Copy size={11} />Copy code</button><button onClick={() => void command({ type: "check-sync-device-enrollment" })}><RefreshCw size={11} />Check again</button><button onClick={() => void command({ type: "cancel-sync-device-enrollment" })}>Cancel</button></div><small>Expires {formatTime(pending.expiresAt)}</small></div> : <><div className="sync-methods" role="radiogroup" aria-label="Connect to Locus Sync">{(["create", "recover", "device"] as const).map((method) => <button key={method} role="radio" aria-checked={connectionMethod === method} className={connectionMethod === method ? "active" : ""} onKeyDown={navigateRadioGroup} onClick={() => { setConnectionMethod(method); setFormError(undefined); }}>{method === "create" ? "New" : method === "recover" ? "Recovery" : "Device"}</button>)}</div><form className="sync-form" onSubmit={submit}><label><span>Sync service</span><input type="url" required readOnly={Boolean(state.configuredSyncServiceUrl)} value={serviceUrl} onChange={(event) => setServiceUrl(event.target.value)} placeholder="Not configured in this build" /></label>{connectionMethod === "recover" ? <label><span>Recovery key</span><textarea required rows={3} value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} placeholder="LOCUS-…" autoComplete="off" spellCheck={false} /></label> : null}<p className="sync-method-detail">{connectionMethod === "create" ? "Create an account with a passkey and receive a one-time recovery key." : connectionMethod === "recover" ? "Use your passkey and recovery key on this Mac." : "Get a pairing code and approve this Mac from a connected device."}</p>{!serviceUrl ? <p className="sync-error" role="status">Encrypted sync is disabled in this build.</p> : null}{(formError || state.sync.lastError) ? <p className="sync-error" role="alert">{formError ?? state.sync.lastError}</p> : null}<button className="sync-connect primary" type="submit" disabled={busy || !serviceUrl}>{connectionMethod === "create" ? <KeyRound size={13} /> : connectionMethod === "recover" ? <LogIn size={13} /> : <Laptop size={13} />}{busy ? "Waiting for passkey…" : connectionMethod === "create" ? "Create sync account" : connectionMethod === "recover" ? "Sign in with recovery key" : "Get pairing code"}</button></form></>}</div>}</div></section>;
}

function WalrusMemorySettings({ state, confirm }: { state: BrowserAppState; confirm: (request: SettingsConfirmationRequest) => void }) {
  const walrus = state.walrusMemory;
  const [accountId, setAccountId] = useState(walrus.accountId ?? "");
  const [namespace, setNamespace] = useState(walrus.namespace);
  const [relayerUrl, setRelayerUrl] = useState(walrus.relayerUrl);
  const [network, setNetwork] = useState<"mainnet" | "testnet">(walrus.network ?? "testnet");
  const [packageId, setPackageId] = useState(walrus.packageId ?? "");
  const [registryId, setRegistryId] = useState(walrus.registryId ?? "");
  const [embeddingApiBase, setEmbeddingApiBase] = useState(walrus.embeddingApiBase ?? "https://api.openai.com/v1");
  const [embeddingModel, setEmbeddingModel] = useState(walrus.embeddingModel ?? "text-embedding-3-small");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (value: BrowserCommand) => { setBusy(true); setError(""); try { await command(value); } catch (caught) { setError(caught instanceof Error ? caught.message : "Walrus Memory request failed"); } finally { setBusy(false); } };
  return <section className="settings-page-section"><div className="settings-card walrus-settings" id="settings-walrus"><header className="walrus-heading"><span><Database size={18} /></span><div><strong>Walrus Memory <i>Experimental</i></strong><small>Portable memory for selected pages and cited research summaries.</small></div><em className={walrus.status}>{walrus.status.replace("-", " ")}</em></header>
    <details className="settings-disclosure walrus-trust-disclosure"><summary><span><strong>How data is handled</strong><small>Review the trust boundary before connecting.</small></span><ChevronRight size={15} /></summary><div className="walrus-disclosure" role="note"><ShieldCheck size={16} /><p><strong>{walrus.mode === "client-encrypted" ? "Client-encrypted mode" : "Hosted mode trust boundary"}</strong>{walrus.mode === "client-encrypted" ? "Locus embeds and SEAL-encrypts in its private process. The embedding provider receives plaintext; the Walrus relayer receives ciphertext and vectors." : "The managed relayer processes plaintext to create embeddings and encrypt content. Every write opens a preview and requires confirmation."}</p></div></details>
    {walrus.usable ? <div className="walrus-connected"><div className="walrus-connection-detail"><span><small>Account</small><strong>{walrus.accountId}</strong></span><span><small>Namespace</small><strong>{walrus.namespace}</strong></span><span><small>Relayer</small><strong>{safeHostname(walrus.relayerUrl)}</strong></span></div><div className="walrus-mode-picker" id="settings-walrus-mode" role="group" aria-label="Walrus Memory encryption mode"><button type="button" className={walrus.mode === "client-encrypted" ? "active" : ""} disabled={busy || !walrus.manualConfigured} onClick={() => void run({ type: "set-walrus-memory-mode", mode: "client-encrypted" })}>Client-encrypted <small>Recommended</small></button><button type="button" className={walrus.mode === "hosted" ? "active" : ""} disabled={busy} onClick={() => void run({ type: "set-walrus-memory-mode", mode: "hosted" })}>Hosted <small>Advanced convenience</small></button></div><p className={`walrus-message ${walrus.status}`} role="status" aria-live="polite">{walrus.message}</p><div className="walrus-actions"><button type="button" disabled={busy || ["checking", "saving", "restoring"].includes(walrus.status)} onClick={() => void run({ type: "restore-walrus-memory" })}><RefreshCw size={12} />Restore index</button><button type="button" onClick={() => void run({ type: "manage-walrus-delegates" })}><ExternalLink size={12} />Manage delegates</button><button type="button" className="danger" disabled={busy} onClick={() => confirm({ title: "Disconnect Walrus Memory?", consequence: "The local connection and its credential will be removed. Remote memories will not be deleted.", confirmLabel: "Disconnect", tone: "danger", command: { type: "disconnect-walrus-memory" } })}>Disconnect</button></div><small className="walrus-receipts">{walrus.receiptCount} content-free local {walrus.receiptCount === 1 ? "receipt" : "receipts"}.</small>
      <details className="settings-disclosure" id="settings-walrus-manual"><summary><span><strong>{walrus.manualConfigured ? "Update client-encrypted mode" : "Set up client-encrypted mode"}</strong><small>Manual network, package, registry, and embedding configuration.</small></span><ChevronRight size={15} /></summary><form className="walrus-manual-config" onSubmit={(event) => { event.preventDefault(); void run({ type: "configure-walrus-client-encrypted", network, packageId, registryId, embeddingApiBase, embeddingModel }); }}><div><label><span>Network</span><select aria-label="Walrus network" value={network} onChange={(event) => setNetwork(event.target.value as typeof network)}><option value="testnet">Testnet</option><option value="mainnet">Mainnet</option></select></label><label><span>Embedding model</span><input aria-label="Embedding model" value={embeddingModel} onChange={(event) => setEmbeddingModel(event.target.value)} /></label></div><label><span>Memory package ID</span><input aria-label="Walrus memory package ID" value={packageId} onChange={(event) => setPackageId(event.target.value)} placeholder="0x…" /></label><label><span>Account registry ID</span><input aria-label="Walrus account registry ID" value={registryId} onChange={(event) => setRegistryId(event.target.value)} placeholder="0x…" /></label><label><span>OpenAI-compatible embedding endpoint</span><input aria-label="Walrus embedding endpoint" type="url" value={embeddingApiBase} onChange={(event) => setEmbeddingApiBase(event.target.value)} /></label><button type="submit" disabled={busy || !packageId.trim() || !registryId.trim() || !embeddingModel.trim()}>{busy ? "Validating…" : "Validate and save…"}</button></form></details>
    </div> : <form className="walrus-connect" onSubmit={(event) => { event.preventDefault(); void run({ type: "connect-walrus-memory", accountId, namespace, ...(walrus.developmentRelayerAllowed ? { relayerUrl } : {}) }); }}><label><span>Walrus account ID</span><input aria-label="Walrus account ID" value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="0x…" /></label><label><span>Namespace</span><input aria-label="Walrus namespace" value={namespace} onChange={(event) => setNamespace(event.target.value)} placeholder="locus-browser-v1" /></label>{walrus.developmentRelayerAllowed ? <label><span>Development relayer</span><input aria-label="Walrus development relayer" value={relayerUrl} onChange={(event) => setRelayerUrl(event.target.value)} /></label> : <p className="walrus-production-pin"><LockKeyhole size={12} />Production builds are pinned to {walrus.relayerUrl}</p>}<p>The delegate key is collected next in a hidden macOS prompt. Use a revocable delegate key, never an owner wallet key.</p><button className="primary" disabled={busy || !accountId.trim() || !namespace.trim()}>{busy ? "Checking…" : "Connect Walrus Memory…"}</button><button type="button" onClick={() => void run({ type: "manage-walrus-delegates" })}><ExternalLink size={12} />Create or manage delegates</button>{walrus.accountId ? <button type="button" className="danger" disabled={busy} onClick={() => confirm({ title: "Remove the saved Walrus connection?", consequence: "The local connection and credential will be removed. Remote memories will not be deleted.", confirmLabel: "Remove connection", tone: "danger", command: { type: "disconnect-walrus-memory" } })}>Remove local connection</button> : null}<p className={`walrus-message ${walrus.status}`} role="status" aria-live="polite">{error || walrus.message}</p></form>}{error && walrus.usable ? <p className="recording-error" role="alert">{error}</p> : null}
  </div></section>;
}

function SettingRow({ id, label, detail, children }: { id?: string; label: string; detail: string; children: ReactNode }) {
  return <label {...(id ? { id } : {})} className="setting-row"><span><strong>{label}</strong><small>{detail}</small></span>{children}</label>;
}

function navigateRadioGroup(event: React.KeyboardEvent<HTMLButtonElement>): void {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const buttons = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button[role='radio']") ?? []);
  if (!buttons.length) return;
  event.preventDefault();
  const current = Math.max(buttons.indexOf(event.currentTarget), 0);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowRight" || event.key === "ArrowDown" ? (current + 1) % buttons.length : (current - 1 + buttons.length) % buttons.length;
  buttons[next]?.focus();
  buttons[next]?.click();
}

function safeHostname(origin: string): string { try { return new URL(origin).hostname || origin; } catch { return origin; } }
function formatTime(timestamp: number): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp * 1_000)); }
function formatBytes(value: number): string { if (value < 1_024) return `${value} B`; if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`; return `${(value / 1_048_576).toFixed(1)} MB`; }
async function command(value: BrowserCommand) { return await window.locusBrowser.command(value); }
