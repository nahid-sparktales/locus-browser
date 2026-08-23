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
- A resizable right Work dock focused on Chat, Plan, Changes, Files, and
  Terminal. It preserves the page canvas, keeps active work alive while hidden,
  and restores the exact conversation after a runtime or browser restart.
- ChatGPT Plan, ChatGPT API, Kimi, Claude API, vLLM/OpenAI-compatible, and
  discovered Ollama models. Provider secrets use native entry and macOS-backed
  encryption and never cross renderer state or IPC.
- Explicit per-session tab grants, visible control indicators and revoke,
  protected credential/payment fields, hosted-screenshot consent, background
  input, console/network capture, and quarantined agent downloads.
- Native workspace choice, bounded image attachments, plan approval, live Git
  changes/diffs, containment-checked file previews, permission-aware terminal
  activity, Stop/steering, and bounded local-agent restart.

## Canary release and security foundation

- A self-contained pinned Python agent runtime is embedded in the signed app;
  nested Mach-O files are signed explicitly under hardened runtime.
- Apple Silicon DMG/ZIP packaging, Developer ID signing, notarization/stapling
  hooks, canary update checks, install-on-quit, database snapshots, and two-
  version rollback retention.
- Browser CI and protected tag release workflows run typechecking, 145 tests,
  production builds, native extension compatibility, UI/accessibility/performance
  acceptance, dependency audit, code-sign/Gatekeeper checks, SBOM generation,
  and signed release-manifest verification.
- Trusted shell/work crash recovery, 1,000 malformed IPC-envelope cases,
  extension-archive fuzzing, sync-envelope fuzzing, offline replay simulations,
  and ciphertext/associated-data tamper checks.
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
- PostgreSQL stores opaque routing metadata and small ciphertext. Large
  ciphertext uses S3-compatible storage with staged cleanup around database
  commits, size verification, encrypted-object metadata, rotation cleanup, and
  complete account deletion.
- Durable local outbox/inbox, hybrid logical clocks, deterministic field merge,
  cursoring, offline retry, replay rejection, 90-day tombstones, remote-device
  tabs, device revocation, and cloud/account deletion.
- Only bookmarks, history, groups, ordinary tabs, selected settings, and curated
  extension metadata sync. Passwords, cookies, site storage, workspaces, AI
  sessions, memory, provider credentials, and run records remain local.

## Automated gate status

The local candidate currently passes 145 unit/integration/fuzz tests, the full
production build, the Electron compatibility fixture, three responsive UI
surfaces, warm tab switching under the 150 ms p95 gate, Reduced Motion, 200%
scaling, a production dependency audit with no known vulnerabilities, and a
CycloneDX 1.6 SBOM. A locally signed app also passed deep code-sign verification
and launched with its embedded Python runtime.

## External launch gates

These steps cannot be completed by source changes alone and remain required
before inviting canary users:

- Deploy the controlled gallery, sync, PostgreSQL, and S3-compatible services;
  complete the offline production gallery/release key ceremonies and configure
  the protected GitHub `canary` environment.
- Run the tag workflow with Apple App Store Connect credentials so the public
  DMG/ZIP is notarized, stapled, Gatekeeper-assessed, manifest-signed, and
  published from CI.
- Publish the pinned managed ChatGPT Plan component used by the packaged agent
  runtime, or keep that route visibly unavailable for the first cohort.
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
