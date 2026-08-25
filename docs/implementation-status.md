# Implementation status

The repository is a source-complete canary candidate for Apple Silicon macOS
14+. It is intentionally scoped around normal browsing and one excellent solo
agent rather than every team and orchestration surface in native Locus.

## Canary product scope

- Secure Electron/React/TypeScript browser with permanent browser chrome,
  sandboxed `WebContentsView` tabs, profile partitions, crash/session restore,
  private windows, tab groups and sleeping, history, bookmarks, downloads,
  permissions, zoom/find, printing/PDF, media controls, and OS-encrypted
  gesture-gated passwords.
- Locus light/dark semantic theme, the lime **L** app identity, keyboard and
  VoiceOver semantics, Reduced Motion/Transparency behavior, and 200% text
  scaling checks.
- Two live webpage panes with independent tab state, audio, grants, Reader
  surfaces, and a persisted 30–70% divider. The focused pane drives browser and
  recording controls, and neither visible pane sleeps.
- Universal Command Palette search across open tabs, bookmarks, history,
  conversations, Settings, Research Boards, Resume Later bundles, allowlisted
  actions, and optional Recall results, with canonical-URL tab reuse.
- Reader Mode with isolated extraction, a second host sanitization pass, Locus,
  paper and dark appearances, adjustable typography, validated link routing,
  installed macOS voices, sentence navigation, and Read Aloud highlighting.
- Opt-in Private Semantic Recall with a dedicated utility process, strict
  content extraction, Apple Natural Language sentence embeddings, keyword
  fallback, XChaCha20-Poly1305 per-record encryption, OS-protected profile
  keys, 500 MB eviction, exclusions, result deletion, and full clearing.
- Cited Research Boards with up to ten explicitly shared current-window tabs,
  immutable encrypted snapshots, 120,000-character local passage bounds,
  typed read-only model requests, mandatory exact passage citations, and local
  Markdown/PDF export.
- Provider-independent AI Tab Steward suggestions for exact duplicates and
  high-confidence clusters, full mutation previews, separate close
  confirmations, and encrypted local Resume Later bundles.
- A resizable right Work dock focused on Chat, Plan, Changes, Files, and
  Terminal. It preserves the page canvas, keeps active work alive while hidden,
  and restores the exact conversation after a runtime or browser restart.
- ChatGPT Plan, ChatGPT API, Kimi, Claude API, and vLLM/OpenAI-compatible as the
  primary providers. Ollama Work models are optional and disabled until enabled
  in Settings; Private Recall and Read Aloud do not depend on Ollama. Provider
  secrets use native entry and macOS-backed encryption and never cross renderer
  state or IPC.
- Explicit per-session tab grants, visible control indicators and revoke,
  protected credential/payment fields, hosted-screenshot consent, background
  input, console/network capture, and quarantined agent downloads.
- One application-wide, always-visible live recording session for explicitly
  shared eligible tabs, with independent tab-audio and microphone controls,
  protected-field/frame redaction, consented changed keyframes, and `⌘Enter`
  assistance. On-device Whisper is the default; OpenAI and validated custom
  transcription endpoints are optional. Per-record encrypted transcripts stay
  local, and optional redacted video requires deliberate export.
- Native workspace choice, bounded image attachments, plan approval, live Git
  changes/diffs, containment-checked file previews, permission-aware terminal
  activity, Stop/steering, and bounded local-agent restart.

## Canary release and security foundation

- A self-contained pinned Python agent runtime and the pinned OpenAI Codex App
  Server for ChatGPT Plan are embedded in the signed app. Download size/hash,
  executable size/hash, Apple Silicon architecture, exact version, and upstream
  signing identity are verified before nested Mach-O files are signed under the
  app's hardened runtime identity.
- A signed Apple-native semantic helper is built from the tagged
  `locus-platform` Swift package, staged with the agent runtime, verified as an
  Apple Silicon Mach-O, and probed by the release gate. Unsupported embedding
  languages degrade to deterministic local keyword ranking.
- Apple Silicon DMG/ZIP packaging, Developer ID signing, notarization/stapling
  hooks, canary update checks, install-on-quit, database snapshots, and two-
  version rollback retention.
- Browser CI and protected tag release workflows run typechecking, the complete
  unit/integration/fuzz suite,
  production builds, native extension compatibility, UI/accessibility/performance
  acceptance, dependency audit, code-sign/Gatekeeper checks, SBOM generation,
  and signed release-manifest verification.
- Trusted shell/work crash recovery, 1,000 malformed IPC-envelope cases,
  extension-archive fuzzing, sync-envelope fuzzing, offline replay simulations,
  and ciphertext/associated-data tamper checks.
- Recording policy, trusted-recorder sender binding, tab-grant revocation,
  protected URL/field redaction, transcript encryption, endpoint validation,
  context bounds, media fallback, and interrupted-video recovery fixtures.
- The packaged app ignores service-origin environment overrides. Gallery and
  sync HTTPS origins are sealed into the signed release and fail closed if the
  release configuration is missing or invalid.

## Extensions in canary

- Signed `.locusx` packages have independent Ed25519 publisher and gallery
  signatures, a SHA-256 inventory, bounded extraction, stable IDs, publisher
  continuity, native permission review, managed storage, update, rollback, and
  restart restoration.
- Signed catalog and revocation documents, offline retention of the last
  verified security notice, deterministic staged rollout, rate limiting,
  production fail-closed metadata loading, and immediate disable/unload of
  revoked installs.
- The production gallery is live at `https://extensions.locushost.co` on a
  read-only Cloudflare Worker backed by private R2. Its canary catalog is signed
  with an offline key and intentionally contains zero extensions until a package
  completes publisher enrollment, automated analysis, and human review.
- Developer Mode supports reviewed local unpacked extensions and is off in
  private profiles. Developer paths/storage never sync.
- The pinned Electron 43.4.1 contract proves `runtime`, content scripts, and
  `storage.local`; it verifies permission admission for `activeTab`, `scripting`,
  `tabs`, and `webRequest`. Broader Chrome-style APIs are explicitly post-canary
  until native fixtures prove them.

## Encrypted sync in canary

- Passkey accounts, X25519 device approval, XChaCha20-Poly1305 records,
  per-record key derivation, checksummed one-time recovery keys, OS-protected
  device/account keys, key-version gates, recovery proof before first write,
  and transactional full-replica key rotation.
- A Cloudflare Worker exposes the production API with per-device/public rate
  limits, strict response headers, dependency readiness, and daily orphan
  reconciliation. Hyperdrive connects to a dedicated least-privilege role in a
  private, RLS-protected Supabase schema. Large ciphertext uses private R2 with
  staged cleanup around database commits, size verification, encrypted-object
  metadata, rotation cleanup, and complete account deletion.
- The canary deployment is live at `https://sync.locushost.co`. Cloudflare is
  authoritative for `locushost.co`, the custom domain is the Worker's only
  public route, and the live dependency verifier passes against Supabase and
  private R2.
- Durable local outbox/inbox, hybrid logical clocks, deterministic field merge,
  cursoring, offline retry, replay rejection, 90-day tombstones, remote-device
  tabs, device revocation, and cloud/account deletion.
- Only bookmarks, history, groups, ordinary tabs, selected settings, and curated
  extension metadata sync. Passwords, cookies, site storage, workspaces, AI
  sessions, memory, provider credentials, and run records remain local.

## Automated gate status

The local candidate currently passes its unit/integration/fuzz suites, the full
production build, the Electron compatibility fixture, twelve responsive UI
surfaces, warm tab switching under the 150 ms p95 gate, Reduced Motion, 200%
scaling, a complete dependency-graph audit with no high/critical findings, and a
CycloneDX 1.6 SBOM. A locally signed app also passed deep code-sign verification
and launched with its embedded Python runtime.

## External launch gates

These steps cannot be completed by source changes alone and remain required
before inviting canary users:

- Add the Developer ID certificate export password directly to the protected
  GitHub `canary` environment, then run the tag workflow so the public
  DMG/ZIP is notarized, stapled, Gatekeeper-assessed, manifest-signed, and
  published from CI.
- Complete independent desktop security, encrypted-sync cryptography, and
  accessibility reviews; resolve every critical/high finding.
- Run clean-Mac acceptance, a 24-hour internal cohort, long-session soak,
  service backup/restore, and update/rollback rehearsals.

The exact credential setup, tag flow, acceptance checklist, and rollback steps
are in [`canary-runbook.md`](canary-runbook.md).

## Post-canary work

Team orchestration, schedules, checkpoints, a dedicated `AGENTS.md` surface,
broader Chrome-extension API shims, Windows/Linux releases, AI-session sync,
cookie/password sync, the Mac App Store, and arbitrary Chrome Web Store
compatibility remain intentionally outside the initial canary.
