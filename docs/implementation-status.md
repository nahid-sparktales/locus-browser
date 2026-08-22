# Implementation status

This repository is an executable engine proof and product foundation, not a
stable browser release. The stable gates in the product plan remain the source
of truth.

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
- Right Work dock with split/overlay layout, 360–720 px bounds, 60%/520 px
  expansion limits, interruptible 340 ms resize, Reduced Motion handling,
  pinned composer, modes, surfaces, progress, and approvals.
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
- Opaque sync push/pull, cursoring, enrollment/approval/claim, device revoke,
  cloud deletion, account deletion, PostgreSQL schema, and a container stack.

## Required before canary

- Add the production passkey account ceremony. The current sync service starts
  at authenticated device tokens; its registration/authentication edge is not
  yet implemented.
- Connect encrypted sync queues to desktop collections and add 90-day
  tombstone cleanup, rotation UI, S3-backed large opaque envelopes, replay
  protection, and full multi-device simulations.
- Load verified gallery extensions into profile sessions, add developer-mode
  UI, implement the supported MV3 shims, and ship compatibility/malware/update/
  rollback infrastructure.
- Port the remaining native Locus panels and state adapters beyond their Work
  surfaces, then make every parity-manifest entry executable in CI.
- Bundle the Python runtime, implement signed component/app updates, add Forge
  packaging, hardened-runtime entitlements, signing/notarization, canary/beta
  channels, and schema rollback.
- Complete end-to-end, accessibility, crash/restore, performance, fuzzing,
  cryptography, soak, and external security reviews.
