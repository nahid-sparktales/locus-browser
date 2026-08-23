# Implementation status

This repository is an executable engine proof and product foundation, not a
stable browser release. The browser canary is now intentionally scoped around
excellent browsing and one local solo agent instead of reproducing every team,
schedule, and orchestration surface from native Locus.

## Implemented in this baseline

- Electron/React/TypeScript application that builds and launches on macOS.
- Permanent tab strip, navigation controls, omnibox, functional browser
  library sidebar, profile/download controls, and a top-right Work control.
- Sandboxed `WebContentsView` tabs, explicit destruction, popup-to-tab routing,
  strict renderer isolation, brokered site permissions, certificate rejection,
  profile partitions, restoration, history records, and WAL SQLite storage.
- Editable bookmarks, browsable history, a persisted download manager with
  cancel/reveal actions, ephemeral private windows, page find/zoom, native
  printing, and PDF export.
- Create/open/rename/delete profile management with separate Chromium
  partitions and profile-scoped history, bookmarks, downloads, settings, and
  permission decisions. Search provider, appearance, downloads folder, and
  sleeping policy are user-selectable.
- First-run onboarding that keeps remote pages hidden until the user explicitly
  chooses an unsponsored search provider, Locus appearance, and tab-sleep
  policy. No provider is preselected and no Locus data is imported.
- Persisted tab groups with collapse/reorder membership, media pause/resume and
  mute controls, and real background-tab sleeping. Sleeping destroys the tab
  renderer and restores it on selection while protecting active audio,
  downloads, agent grants, loading tabs, and active media.
- The same semantic light/dark palette as native Locus: warm paper surfaces,
  ink typography, lime signal, olive actions, and semantic status colors,
  including Reduced Motion and Reduced Transparency alternatives.
- Locus Browser identity with a single black `L` on the native lime tile,
  exported as PNG/ICNS assets and installed on the macOS window and Dock.
- Right Work dock with split/overlay layout, 360–720 px bounds, 60%/520 px
  expansion limits, interruptible 340 ms resize, Reduced Motion handling, and
  a pinned composer. The focused right-side rail keeps Chat, Plan, Changes,
  Files, and Terminal; secondary native-Locus surfaces are deliberately absent.
- Locus-parity solo model picker for ChatGPT Plan, ChatGPT API, Kimi, Claude
  API, vLLM/OpenAI-compatible endpoints, and dynamically discovered Ollama
  models. The selected route persists per profile; API keys use native hidden
  entry and OS encryption without crossing renderer state or IPC. ChatGPT Plan
  account state, sign-in, model discovery, and sign-out use the managed local
  runtime component.
- Durable local solo-agent conversations with new/resume actions, browser
  sidebar history, transcript restoration, streaming state, permission prompts,
  and immediate Stop feedback while cancellation reaches the runtime safely.
- Native trusted-workspace selection bound to the local runtime session and
  preserved when starting or reopening a conversation.
- Safe image attachments selected in the main process, checked by file size and
  content signature, capped at 10 images/15 MB each/25 MB total, and represented
  in the renderer by metadata only.
- Live local-agent connection and all existing browser tool wire names.
- Explicit per-session tab grants, agent-created tabs, visible indicators,
  one-click revoke, protected URLs/fields, screenshot consent/masking,
  background CDP input, console/network capture, and quarantined downloads.
- Profile-scoped, OS-encrypted credential save/update, explicit account-driven
  autofill, and deletion. Password values move only between the sandboxed
  page's private isolated world and the main process; trusted renderers, Work
  Mode, browser state, and agent APIs receive metadata only. Private windows
  never capture or save credentials.
- Signed `.locusx` verifier, API/permission registry, permission-expansion
  checks, inventory validation, remote-code rules, and dual signatures.
- X25519 device keys, sealed account-key delivery, XChaCha20-Poly1305 records,
  per-record key derivation, checksummed recovery keys, hybrid logical clocks,
  and field-merge helpers.
- Hosted WebAuthn registration and authentication with discoverable passkeys,
  user verification, signature-counter updates, expiring one-use ceremonies,
  one-use desktop claims, strict ceremony-page CSP, and exact production
  relying-party/origin validation.
- Profile-scoped, opt-in encrypted sync connected to bookmarks, history, tab
  groups, ordinary web tabs, selected browser settings, and curated extension
  metadata. Device tokens, private keys, and the account key are protected by
  the OS credential store; generated recovery keys stay in a native
  main-process confirmation instead of crossing the renderer bridge.
- Locus-themed device management lists the current and remote devices, creates
  expiring pairing codes, lets an existing device approve the new X25519 public
  key, supports explicit revocation, and allows a new Mac to claim its wrapped
  account key exactly once.
- Recovery-key rotation decrypts and verifies the full local replica, creates
  a new account key, re-encrypts every record, wraps the new key independently
  for every active device, and commits the records, wraps, and key version in a
  single server transaction. Writes made with an older key version are then
  rejected.
- Durable SQLite outbox/inbox state, per-record encryption, cursoring, hybrid
  logical-clock conflict handling, stale-replay rejection, 90-day tombstones,
  offline retry, periodic sync, remote-device tabs, encrypted recovery-key
  verification before first upload, device revocation, cloud deletion, account
  deletion, PostgreSQL schema, and a container stack.
- Multi-device integration coverage confirms ciphertext-only server storage,
  convergence after concurrent updates, malformed-ciphertext isolation,
  one-use auth claims, replay rejection, revocation, and cloud-data reset.

## Required before canary

- Add S3-backed large opaque envelopes, broader offline/failure simulations,
  production-scale key-rotation migrations, fuzzing, and an external sync
  cryptography review.
- Load verified gallery extensions into profile sessions, add developer-mode
  UI, implement the supported MV3 shims, and ship compatibility/malware/update/
  rollback infrastructure.
- Finish the useful solo adapters behind Plan, Changes, Files, and Terminal;
  add end-to-end local-agent recovery. Team orchestration, schedules,
  checkpoints, and a dedicated `AGENTS.md` panel are outside the initial
  browser canary scope.
- Bundle the Python runtime, implement signed component/app updates, add Forge
  packaging, hardened-runtime entitlements, signing/notarization, canary/beta
  channels, and schema rollback.
- Complete end-to-end, accessibility, crash/restore, performance, fuzzing,
  cryptography, soak, and external security reviews.
