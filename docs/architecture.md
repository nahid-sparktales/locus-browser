# Architecture

## Processes and trust boundaries

```text
Trusted local shell renderer ─┐
Trusted local Work renderer ──┼─ schema-validated IPC ─ Electron main broker
                              │                         ├─ tab grants
Sandboxed remote tab views ───┘ (no IPC/preload)       ├─ local agent process
                                                        ├─ safeStorage vault
                                                        └─ WAL browser database

Local sync client ─ XChaCha20-Poly1305 ciphertext ─ sync service ─ PostgreSQL
                                                └──── opaque objects ─ S3 API
```

The visible shell is one trusted `BrowserWindow`. Each live webpage is a
separate sandboxed `WebContentsView`; the resizable Work dock is a second
trusted local view. This allows the dock to overlay narrow windows without
ever placing a webpage above trusted approval controls.

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
manifest. The original Swift app remains a separate native consumer.

## Data boundaries

`Locus Browser` uses a distinct macOS support directory and database. There is
no migration from Locus. Normal browser state is stored in WAL-mode SQLite;
private tabs are not persisted. Password ciphertext and agent download
quarantine remain local. Sync is opt-in and deliberately excludes cookies,
passwords, workspace files, conversations, memories, credentials, and runs.
