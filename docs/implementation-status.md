# Implementation status

This repository is an executable engine proof and product foundation, not a
stable browser release. The stable gates in the product plan remain the source
of truth.

## Implemented in this baseline

- Electron/React/TypeScript application that builds and launches on macOS.
- Permanent tab strip, navigation controls, omnibox, functional browser
  library sidebar, profile/download controls, and a top-right Work control.
- Sandboxed `WebContentsView` tabs, explicit destruction, popup-to-tab routing,
  strict renderer isolation, denied page permissions, certificate rejection,
  profile partitions, restoration, history records, and WAL SQLite storage.
- Editable bookmarks, browsable history, a persisted download manager with
  cancel/reveal actions, ephemeral private windows, page find/zoom, native
  printing, and PDF export.
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
- OS-encrypted credential vault boundary requiring a user gesture.
- Signed `.locusx` verifier, API/permission registry, permission-expansion
  checks, inventory validation, remote-code rules, and dual signatures.
- X25519 device keys, sealed account-key delivery, XChaCha20-Poly1305 records,
  per-record key derivation, checksummed recovery keys, hybrid logical clocks,
  and field-merge helpers.
- Opaque sync push/pull, cursoring, enrollment/approval/claim, device revoke,
  cloud deletion, account deletion, PostgreSQL schema, and a container stack.

## Required before canary

- Finish standard browser product surfaces: tab groups/sleeping, site
  permission prompts, media controls, and complete settings/profile
  management.
- Connect the credential vault to user-driven save/autofill UI and add passkey
  account ceremony. The current sync service starts at authenticated device
  tokens; the production passkey registration/authentication edge is not yet
  implemented.
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
