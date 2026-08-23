# Architecture

## Processes and trust boundaries

```text
Trusted local shell renderer ─┐
Trusted local Work renderer ──┼─ schema-validated IPC ─ Electron main broker
                              │                         ├─ tab grants
Sandboxed remote tab views ───┘ (no IPC/preload)       ├─ local agent process
                                                        ├─ safeStorage vault
                                                        └─ WAL browser database

OS-protected account key ─ local sync client ─ XChaCha20-Poly1305 ciphertext
                                           └─ passkey auth ─ sync service
                                                            ├─ PostgreSQL
                                                            └─ S3 API
```

The visible shell is one trusted `BrowserWindow`. Each live webpage is a
separate sandboxed `WebContentsView`; the resizable Work dock is a second
trusted local view. This allows the dock to overlay narrow windows without
ever placing a webpage above trusted approval controls.

The Work renderer presents a focused solo-agent surface. The Electron broker
starts the local Python runtime, communicates over an authenticated loopback
channel, and uses its local session API to create, list, and resume durable
conversations. Only normalized conversation metadata and display-safe message
content cross into the trusted renderer.

Site camera, microphone, location, notification, and clipboard requests are
resolved by the main-process broker. Unknown decisions appear only in trusted
browser chrome; allow/block choices are scoped to the active browser profile,
and private-window choices are never persisted.

Credential observation runs in a named isolated world with a DevTools binding
scoped only to that world. A candidate password is held only in main-process
memory until the user accepts the trusted-chrome prompt. `safeStorage`
encryption, reveal, autofill, and deletion are profile scoped and require an
explicit browser-chrome action; the password is never serialized into renderer
state or any Work/agent protocol.

## Tab ownership

Browser tabs are independent of conversations. `TabAccessRegistry` grants one
session `read` or `interact` access to one tab. A session may also own a tab it
created. The broker rechecks the live grant, page URL, private state, and
requested access level for every action. Ending or replacing a session revokes
its grants without closing tabs.

## Shared platform

The sibling `locus-platform` repository owns the Python runtime, JSON Schema,
OpenAPI description, TypeScript and Swift protocol clients, browser tool
fixtures, the engine-neutral isolated-world DOM bridge, and the stable parity
manifest. The original Swift app remains a separate native consumer. The
shared protocol can describe the broader native product while Locus Browser's
first canary exposes the smaller solo-agent subset documented above.

## Data boundaries

`Locus Browser` uses a distinct macOS support directory and database. There is
no migration from Locus. Normal browser state is stored in WAL-mode SQLite;
private windows use an ephemeral Chromium partition and do not persist tabs or
history. Work Mode is unavailable there, and the broker independently rejects
all private-tab grants. Password ciphertext and agent download quarantine
remain local. Sync is opt-in and deliberately excludes cookies,
passwords, workspace files, conversations, memories, credentials, and runs.

Each normal profile has its own persistent Chromium partition and SQLite-scoped
library records, settings, tab groups, and permission decisions. Sleeping a
background tab explicitly destroys its `webContents`; selecting the tab creates
a fresh sandboxed view at the last committed URL. Tabs with audio, media,
downloads, loading work, or agent access are excluded from sleeping.

Sync registration and sign-in open a separate ephemeral, sandboxed passkey
window restricted to the configured service origin and the private callback
scheme. The account key, device private key, and device token are encrypted by
the OS credential store before persistence. The trusted renderer receives only
account status and collection metadata; a generated recovery key is displayed
once by a native main-process dialog. A new device must decrypt the account's
encrypted key-verifier record before it may upload any local data. Durable
local outbox/inbox state permits offline retries without retaining plaintext
payloads on the service. Existing devices approve newcomers by wrapping the
account key to the new device's X25519 public key. Recovery-key rotation
re-encrypts the complete replica and advances its account-key version in the
same transaction that replaces every active device wrap, preventing a stale
client from writing mixed-key ciphertext.
