<p align="center">
  <img src="apps/desktop/assets/icon.png" width="88" alt="Locus Browser icon: a black L on a lime tile">
</p>

<h1 align="center">Locus Browser</h1>

<p align="center">
  A private, browser-first home for Locus and its solo AI agent.
</p>

<p align="center">
  <a href="https://github.com/nahid-sparktales/locus-browser/actions/workflows/ci.yml"><img alt="Browser CI" src="https://github.com/nahid-sparktales/locus-browser/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="Apache 2.0 license" src="https://img.shields.io/badge/license-Apache--2.0-8fbf27"></a>
  <img alt="macOS 14 or newer" src="https://img.shields.io/badge/macOS-14%2B-111111">
  <img alt="Apple Silicon" src="https://img.shields.io/badge/Apple%20Silicon-arm64-111111">
</p>

![Locus Browser on Google with a visible live-context timer and the Solo Work dock](docs/images/locus-browser-recording.png)

Locus Browser keeps a normal Chromium browser as the main experience. Press
**Work** when you want an AI agent beside the current page, then close the dock
when you are done. Tabs stay where they are, browser controls stay visible, and
active work continues safely in the background.

> [!IMPORTANT]
> Locus Browser is an early canary project. The source is available and tested,
> but a signed public download has not been released yet. Follow
> [GitHub Releases](https://github.com/nahid-sparktales/locus-browser/releases)
> for the first notarized Apple Silicon build.

## What it does

- **A browser first.** Tabs, groups, profiles, private windows, history,
  bookmarks, downloads, permissions, passwords, media controls, find, zoom,
  printing, restore, and tab sleeping are built into the desktop app.
- **Solo Work on demand.** A resizable right dock provides Chat, Plan, Changes,
  Files, and Terminal without replacing the webpage.
- **Explicit tab sharing.** An agent can use only tabs you share with its
  conversation or tabs that conversation creates. Every controlled tab has a
  visible indicator and one-click revoke control.
- **Live help with what you see and hear.** Record webpage context, tab audio,
  and microphone input with an always-visible timer. Press **⌘Enter** to ask for
  help with the current moment. Optional redacted video export is off by
  default.
- **Your choice of model.** Use ChatGPT Plan, ChatGPT API, Kimi, Claude API,
  vLLM or another OpenAI-compatible endpoint, or local models through Ollama.
- **The Locus look and feel.** Light and dark themes share the native Locus
  palette, motion, spacing, and lime **L** identity.
- **Optional encrypted sync.** Browser records are encrypted on the device
  before reaching the sync service. Passwords, cookies, workspaces, provider
  credentials, AI conversations, and recordings never sync.

### Browse normally

![Locus Browser browsing Google with Work closed](docs/images/locus-browser-browse.png)

### Open Solo Work when you need it

![Locus Browser showing Google beside the Solo Work dock](docs/images/locus-browser-work.png)

## Live context and privacy

Recording is deliberately visible and user-controlled. It captures only the
webpage canvas of an eligible shared tab—not browser chrome, another app, or
the whole display. Private windows, internal pages, local files, revoked tabs,
and credential or payment fields are excluded. If redaction cannot be trusted,
capture pauses before another frame is accepted.

Tab audio and microphone controls remain separate. Raw audio is never retained.
On-device Whisper is the default speech engine; OpenAI transcription and a
validated OpenAI-compatible endpoint are optional. Transcripts are encrypted
per record using a random local key protected by macOS, stay on the device until
you delete them, and never enter browser sync. Frames are shared with a hosted
vision model only after the existing screenshot-consent prompt.

Read the complete threat model in [SECURITY.md](SECURITY.md).

## Project status

The current target is a signed and notarized direct-download canary for Apple
Silicon Macs running macOS 14 or newer. The automated source gate covers the
browser, agent contracts, live-context recording, extension isolation,
encrypted sync, accessibility, performance, fuzzing, and release artifacts.

The first public binary still requires the controlled production extension
gallery, Apple notarization credentials, release signing, and clean-Mac release
acceptance. Stable parity, Windows/Linux builds, team orchestration, arbitrary
Chrome Web Store compatibility, and AI-session or password sync are not claimed.

- [Exact implementation status](docs/implementation-status.md)
- [Architecture and trust boundaries](docs/architecture.md)
- [Canary release runbook](docs/canary-runbook.md)
- [Extension package format](docs/locusx-format.md)
- [Encrypted sync deployment](docs/sync-deployment.md)

## Build from source

Locus Browser currently supports development on macOS. Install Node.js 24,
pnpm 11.19, and Python 3.13, then keep the browser and shared platform checkouts
next to one another:

```bash
git clone https://github.com/nahid-sparktales/locus-platform.git
git clone https://github.com/nahid-sparktales/locus-browser.git

cd locus-platform
pnpm install --frozen-lockfile
pnpm build

cd ../locus-browser
pnpm install --frozen-lockfile
pnpm dev:desktop
```

Development uses a separate browser data directory and does not read or migrate
native Locus data. Set `LOCUS_PLATFORM_ROOT` only when the platform checkout is
not the sibling directory shown above.

## Verify a change

```bash
pnpm canary:check
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @locus/browser-desktop compat:extensions
pnpm --filter @locus/browser-desktop acceptance:ui
pnpm audit --prod --audit-level high
```

The Browser CI workflow runs the same source gate against the immutable
[`locus-platform` v0.1.0-canary.4 tag](https://github.com/nahid-sparktales/locus-platform/tree/v0.1.0-canary.4).

## Repository layout

- `apps/desktop` — Electron main process, sandboxed browser surfaces, trusted
  shell, React UI, Work dock, recording coordinator, and agent connection.
- `packages/extensions` — tested MV3 capability registry and signed `.locusx`
  verification.
- `packages/sync-crypto` — client-side encrypted sync records and device keys.
- `services/gallery` — fail-closed curated extension catalog and package
  delivery.
- `services/sync` and `services/sync-worker` — opaque sync API, Supabase
  Postgres repository, Cloudflare Worker, Hyperdrive, and private R2 storage.
- `supabase` — private sync schema, least-privilege runtime role, and permission
  tests.

Shared runtime code, browser automation contracts, generated clients, fixtures,
and compatibility manifests live in
[`locus-platform`](https://github.com/nahid-sparktales/locus-platform).

## Contributing and security

This project is moving quickly while the first canary is prepared. Before
opening a change, run the verification commands above and keep the browser's
security boundaries intact. Use a public GitHub issue for reproducible bugs or
feature proposals.

For vulnerabilities, use GitHub's private vulnerability reporting. Do not put
credentials, browsing data, decrypted sync records, or private transcripts in
a public issue. See [SECURITY.md](SECURITY.md) for details.

## License

Locus Browser is licensed under the [Apache License 2.0](LICENSE).
