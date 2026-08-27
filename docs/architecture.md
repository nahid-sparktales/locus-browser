# Architecture

## Processes and trust boundaries

```text
Trusted local shell renderer ─┐
Trusted local Work renderer ──┼─ schema-validated IPC ─ Electron main broker
Trusted local Reader view ────┤                         ├─ split-pane broker
                              │                         ├─ tab grants
Sandboxed remote tab views ───┘ (no IPC/preload)       ├─ local agent process
                                                        ├─ safeStorage vault
                                                        ├─ WAL browser database
                                                        └─ intelligence utility process
                                                           ├─ encrypted local-content vault
                                                           └─ signed Apple semantic helper

OS-protected account key ─ local sync client ─ XChaCha20-Poly1305 ciphertext
                                           └─ passkey auth ─ Cloudflare Worker
                                                            ├─ Hyperdrive ─ private Supabase schema
                                                            └─ private R2 binding

OS-encrypted delegate key ─ explicit preview/confirm ─ Walrus Memory relayer
                                                   ├─ asynchronous write receipt
                                                   └─ manual recall ─ untrusted Work evidence

OS-encrypted Sui + embedding keys ─ intelligence utility process
                                 ├─ local embedding ─ configured provider
                                 ├─ local SEAL encryption ─ ciphertext/vector ─ relayer
                                 └─ signed research manifest ─ public/encrypted Walrus quilt

Offline gallery signer ─ signed catalog/revocations ─ private R2
                                                   └─ Cloudflare Worker ─ desktop verifier
```

The visible shell is one trusted `BrowserWindow`. Each live webpage is a
separate sandboxed `WebContentsView`; the resizable Work dock is a second
trusted local view. This allows the dock to overlay narrow windows without
ever placing a webpage above trusted approval controls.

Split View assigns two ordinary tabs to primary and secondary panes and gives
each live `WebContentsView` independent bounds. The focused pane alone drives
the omnibox, navigation, find, zoom, sharing, recording, and Reader controls.
Both visible panes are protected from sleeping. Grants remain attached to tabs,
not panes, and recording pauses before a frame from an unshared or protected
focused pane can be accepted. Settings and the command palette hide the page
views without destroying either pane.

The command palette is part of the trusted shell and uses a typed query channel
rather than the continuously broadcast browser state. Main-process ranking
combines current tabs, bookmarks, history, conversations, Research Boards,
Resume Later bundles, Settings routes, allowlisted actions, and—when enabled—
bounded Recall results. Executions are rebound to the current profile and
focused pane; a result cannot provide an arbitrary privileged command.

Reader Mode replaces only the selected pane with a trusted local view. The
isolated DOM bridge excludes forms, inputs, editable or credential-shaped
regions, hidden content, scripts, and inaccessible frames before article
extraction. The host applies a second HTML allowlist, and Reader link clicks
return through validated browser navigation. Installed macOS speech voices run
locally. Article content is discarded on navigation, close, crash, or exit; in
a private window it is never persisted.

## Private intelligence

Private Recall, Research Boards, and Resume Later bundles live in a dedicated
Electron utility process. It owns a WAL-mode SQLite content vault and encrypts
each page, source snapshot, board, and bundle record with XChaCha20-Poly1305.
The random per-profile content key is protected by macOS secure storage. The
trusted shell receives bounded result summaries, never the full vault.

Recall is off until the user enables it. Eligible pages are processed one at a
time after navigation settles and indexing pauses while recording, during
intensive agent work, or under serious thermal pressure. The strict platform
snapshot excludes private windows, internal/local URLs, forms, hidden content,
protected fields, inaccessible frames, and user-excluded origins. A signed
Swift helper uses Apple Natural Language sentence embeddings; unsupported
languages fall back to deterministic keyword and full-text ranking. Existing
history is title/URL searchable but is never revisited in the background.
Content is deduplicated by canonical URL and hash, capped at 500 MB per profile,
and evicts the oldest unbookmarked record first. Per-result deletion, excluded
sites, index-size reporting, and full clearing are main-process operations.

Research captures immutable strict snapshots only from up to ten tabs already
shared with the current Work conversation or created by it. Stable source and
passage IDs, timestamps, URLs, and content hashes survive later navigation or
tab closure. Local passage ranking bounds the complete source input to 120,000
characters. The selected Work model runs a typed, read-only, non-persisted
research request with browser tools disabled and source content explicitly
marked as untrusted evidence. Both `locus-platform` and the browser reject
unknown citations or any factual claim without at least one valid source and
passage reference. Boards and evidence remain encrypted locally and export
through sanitized Markdown footnotes or a rendered PDF.

Tab Steward is provider-independent. Exact canonical URLs and high-confidence
title/host clusters produce only a quiet badge. Every move, group, rename,
duplicate closure, or Resume Later bundle opens a full preview; closing tabs
requires a separate confirmation listing them. Private tabs are absent from
analysis and bundles, and reopening a bundle reuses already-open canonical URLs.

## Portable Walrus Memory

Walrus Memory is optional, experimental, normal-profile-only, and deliberately
separate from Locus encrypted sync. Its hosted first-canary mode uses the pinned
`@mysten-incubation/memwal` SDK and production builds pin the relayer to
`https://relayer.memory.walrus.xyz`; development builds alone may select a
custom or Testnet-compatible relayer. The account ID and namespace are ordinary
profile settings. A revocable delegate private key is collected through the
native hidden-entry prompt, encrypted with macOS `safeStorage`, and never enters
renderer state, logs, crash UI, the agent protocol, or sync.

Connection is not considered usable until SDK/relayer compatibility and an
authenticated bounded recall both pass. The hosted relayer processes plaintext
to create embeddings and encrypt content, so the settings disclosure names that
trust boundary before the native key prompt opens. Recommended client-encrypted
mode instantiates `MemWalManual` only in the private intelligence utility. A
dedicated Ed25519 Sui signer and dedicated embedding credential are collected
through separate native prompts and separately protected with `safeStorage`.
Locus never silently reuses a Work provider credential. Setup runs a bounded
manual recall to prove embedding-vector compatibility before the mode becomes
usable. The embedding provider still receives plaintext, while SEAL encryption
keeps plaintext away from the Walrus relayer. Disconnect destroys both SDK
clients and removes all three local encrypted credentials; remote memories,
quilts, and content-free receipts remain. Delegate revocation is managed through
the owner-controlled Walrus dashboard.

There are no automatic writes or recalls. **Save page** requires a normal
HTTP(S) tab explicitly shared with the current Work conversation, then reuses
the strict snapshot path and displays the exact bounded content, title, URL,
capture time, SHA-256, and optional note before confirmation. **Save research
summary** accepts only a ready local Research Board and omits captured passages,
sending its summary, cited conclusions, source URLs, and optional note. Each
item is capped at 24,000 characters and begins with the stable
`locus-portable-memory-v1` header.

Remember jobs are held open until the relayer reports completion. SQLite keeps
only job/blob ID, namespace, status, and timestamps for recovery and diagnostics.
Manual recall returns at most ten remote results, and index lag is handled with
bounded guidance plus an explicit Restore index action. The main process caches
the current result set; the renderer may attach only a cached blob ID. At most
five records and 12,000 total characters reach a Work turn. `locus-platform`
validates that envelope, preserves blob/source/hash provenance, wraps the text as
untrusted evidence, and never persists or interprets it as instructions.

Ready Research Boards can be packaged as a `locus-research-bundle-v1` Walrus
quilt. The exact preview is built in the trusted main process from `board.json`,
sanitized Markdown, and a PDF rendered from that same Markdown. By default the
artifacts contain claims, citations, source URLs, capture/content hashes, and
passage hashes—but no captured passage text. Enabling passage text changes every
artifact hash and requires both a refreshed preview and a separate native
warning. The private utility verifies all preview hashes, signs a canonical
`manifest.json` personal message, verifies the signature locally, optionally
SEAL-encrypts every file, and uploads the four-file quilt with the dedicated Sui
signer. SQLite retains only board/quilt IDs, visibility, storage duration,
manifest hash, signer address, patch IDs, and timestamps.

The Work renderer presents a focused solo-agent surface. The Electron broker
starts the local Python runtime, communicates over an authenticated loopback
channel, and uses its local session API to create, list, and resume durable
conversations. Only normalized conversation metadata and display-safe message
content cross into the trusted renderer. Workspace changes originate in a
native directory picker and are applied to the authenticated local session;
remote pages and renderer-supplied paths cannot select a workspace.

Model routing is also owned by the Electron broker. The Work renderer may
select only a validated provider/model pair or supply normalized vLLM endpoint
metadata. API keys are collected by a native macOS hidden-entry dialog, then
encrypted with `safeStorage` and persisted per browser profile; no command or
public browser state contains the secret. The broker applies fixed official
endpoints and authentication styles for OpenAI, Kimi, and Anthropic, discovers
Ollama models from the loopback service, and delegates ChatGPT Plan account and
model state to the pinned local runtime component. `locus-platform` owns that
component's versioned artifact contract. Packaging downloads only the exact
Apple Silicon archive from the recorded npm origin, verifies archive and
executable size/hash, architecture, version, and OpenAI signing team, then
embeds only the App Server executable. The packaged agent receives its explicit
path and an app-owned credential home; it never searches the user's `PATH` or
silently substitutes an unreviewed installation.

Work image attachments are also admitted by the main-process broker. It checks
count and byte budgets before loading data, verifies PNG/JPEG/GIF/WebP content
signatures, and retains the encoded payload outside the renderer. The Work UI
receives only an opaque attachment ID, display name, media type, and size; the
broker adds the verified payload only when sending to the authenticated local
agent runtime.

The secondary solo surfaces remain projections of privileged state rather
than new authority boundaries. Plan and Terminal consume bounded agent events;
Changes reads structured status and diffs through the authenticated runtime;
Files accepts only a path already present in a main-process-generated workspace
inventory. File reads re-check lexical and real-path containment, reject
symlinks and secret-shaped or binary paths, and cap UTF-8 previews before any
content reaches the renderer.

The active agent session ID is stored per browser profile. An unexpected
runtime exit clears pending execution UI, settles in-flight tool cards, retries
with bounded backoff, and resumes that session over the new authenticated
loopback connection. Stale process and socket callbacks are ignored through a
runtime generation token, so a previous process cannot mark a replacement
offline. The same restore path runs after a full browser restart.

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

Extension management is also a trusted-shell operation. Each normal profile's
persistent Chromium session has a profile-scoped extension manager; Private
Windows use a separate in-memory partition and never receive extensions. A
signed `.locusx` archive is verified against the versioned package contract,
its Ed25519 publisher signature, and the compiled-in gallery key allowlist.
Archive, expanded-byte, entry-count, individual-file, path, inventory, and
remote-code limits run before any package file enters managed storage. The
reviewed archive is fingerprinted and verified again immediately before an
atomic extraction into a canonical profile-owned directory. Existing managed
copies are byte-for-byte integrity checked before reuse.

Gallery updates are keyed by the signed stable extension ID and must preserve
publisher identity. SQLite retains each verified package version and the active
path, allowing the manager to unload, replace, restore after failure, and roll
back without trusting a newly supplied archive. Removal deletes only those
canonical managed copies. Unpacked Developer Mode follows a separate flow: the
main process resolves the real path, bounds and scans the directory, and never
deletes the developer's source folder. Enabled extensions are restored before
saved webpages open, while new permissions block startup until user review.

The catalog service is intentionally less trusted than the package verifier.
The offline publisher accepts only `.locusx` files that pass the
trusted-gallery contract, publishes the newest semantic version for each stable
ID, and signs the catalog and revocation documents with an offline key. A
read-only Cloudflare Worker at `https://extensions.locushost.co` loads those
documents and immutable packages through a private R2 binding, checks bounded
shape and the compiled signer fingerprint, rate limits public reads, and fails
closed whenever required metadata is absent or inconsistent. The desktop
accepts only the versioned bounded catalog schema over HTTPS (or loopback HTTP),
rejects redirects and cross-origin package paths, and streams each package into
private temporary storage while enforcing the catalog byte count and SHA-256.
The temporary file is then passed through the normal `.locusx` verification,
native permission review, managed extraction, and update/rollback lifecycle.
Neither catalog metadata nor the server's transport trust can authorize an
extension by itself.

The gallery and release-manifest Ed25519 identities are separate. Their public
keys and fingerprints are committed under `docs/keys`; the gallery private key
remains offline while the release private key is available only to the protected
GitHub canary environment. Cloudflare receives signed public documents and
packages, never either private key.

Only gallery extension ID/version/enabled/source metadata participates in
encrypted sync. Developer installs and filesystem paths are excluded at the
database snapshot boundary. The current registry exposes only the
Electron-backed permission groups used by this foundation; action UI, commands,
context menus, notifications, downloads, bookmarks, history, declarative
rules, and MV3 service-worker shims remain explicitly planned rather than being
advertised as compatible.

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
remain local. Recall documents, Research Boards and evidence, Resume Later
bundles, Reader article content, and Tab Steward analysis never enter browser
sync. Walrus delegate credentials, account configuration, receipts, recalled
text, and Work attachments also have no sync collection. Sync is opt-in and
deliberately excludes cookies, passwords, workspace files, conversations,
memories, credentials, and runs. A user-confirmed Walrus upload is the only
portable-memory path and does not make Locus Sync authoritative for it.

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

The production Worker shares the exact request handler used by the local Node
service. Hyperdrive connects through a dedicated runtime role whose SQL is
fully schema-qualified; `locus_sync` is omitted from Supabase's Data API
schemas and every table has RLS defense in depth. R2 is reachable only through
the Worker binding. Larger ciphertext is staged there before PostgreSQL commit,
superseded objects are removed afterward, and a daily grace-period reconciler
removes crash-orphaned objects without touching a newly staged write.
