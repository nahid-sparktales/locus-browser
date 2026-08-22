# Locus Browser

A browser-first sibling to Locus: a secure Chromium browser with an explicit,
resizable Locus work dock. The page remains the primary canvas and AI sessions
can control only tabs the user shares or tabs the session creates.

This checkout is the executable engine proof and product foundation. See
[`docs/implementation-status.md`](docs/implementation-status.md) for the exact
canary work that remains; it does not claim stable-release parity yet.

## Repository layout

- `apps/desktop` — Electron main process, secure preload, React browser chrome,
  work dock, tab broker, and agent runtime connection.
- `packages/extensions` — curated Manifest V3 capability and signed `.locusx` package checks.
- `packages/sync-crypto` — client-side encrypted sync records and device keys.
- `services/sync` — opaque-record PostgreSQL sync service.

Shared agent and browser-wire contracts come from the sibling
[`locus-platform`](../locus-platform) repository.

## Run the desktop app

```bash
pnpm install
pnpm dev:desktop
```

The browser has its own data directory and does not read or migrate data from
Locus. Set `LOCUS_PLATFORM_ROOT` to override the sibling platform checkout used
for the development agent runtime.

For renderer-only UI work, `pnpm --filter @locus/browser-desktop exec vite`
opens a safe local preview with representative browser state. Production file
builds never install that preview bridge; they require the sandboxed Electron
preload and main-process schema validation.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
```

The first release target is signed/notarized Apple Silicon macOS 14+. The
application is not a Mac App Store target.
