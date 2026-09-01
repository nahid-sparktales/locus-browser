# Skill Observation Log

Observations captured during task-oriented work.

**Status key:** OPEN = not yet actioned | ACTIONED (YYYY-MM-DD) = skill
updated/created | DECLINED (YYYY-MM-DD) = user decided not to pursue —
resolved statuses always carry their resolution date

---

## 2026-08-26

- Checkpoint after the first three completed implementation steps: no reusable skill observations.
- ACTIONED (2026-08-26): When a dependency install adds a release-age exception for a just-published package, treat that as a supply-chain signal. Prefer the oldest compatible pinned stable release, remove the exception, then verify the frozen lockfile, required API surface, audit, build, and SBOM.

### Observation 1: Validate documented SDK entry points against the pinned package

**Status:** OPEN
**Date:** 2026-08-26
**Session context:** Integrating a client-side encryption SDK and its peer network clients into a packaged desktop utility process.
**Skill:** New skill candidate: third-party SDK integration hardening
**Type:** open-source
**Phase/Area:** Dependency and runtime compatibility validation

**Issue:** The documented class was available only through a package subpath, while its internal fallback constructed a client API removed by a compatible modern peer release. Type declarations and a compile-only check did not expose the runtime fallback mismatch; inspecting the pinned package implementation showed that an explicitly injected client was required.

**Suggested improvement:** Add a repeatable SDK-integration check that inspects the pinned package exports, reads the exact implementation around dynamic imports/fallback constructors, injects explicit peer clients where supported, and runs both a bundle check and a minimal runtime construction test.

**Principle:** Treat documentation, package exports, declared peer ranges, and runtime fallback code as separate compatibility surfaces; verify all four against the exact pinned dependency graph.

### Observation 2: Check protected-branch requirements before creating a local merge

**Status:** OPEN
**Date:** 2026-08-26
**Session context:** Committing a completed feature, pushing it, and merging it into a protected default branch.
**Skill:** New skill candidate: protected-branch release workflow
**Type:** open-source
**Phase/Area:** Git release and merge sequencing

**Issue:** A local merge commit was created before attempting the default-branch push, but the remote required status checks through a pull request. The pull request produced a second merge commit with the same tree, leaving local and remote default branches divergent until their tree equality was verified and the local reference was aligned to the canonical remote merge.

**Suggested improvement:** Before merging locally, inspect the remote's branch-protection or ruleset requirements. When checks or reviews are required, push the feature branch first, open the pull request, wait for required checks, merge remotely, and only then fast-forward or safely align the local default branch. If redundant merge commits already exist, require exact tree equality and an empty diff before changing the local branch reference.

**Principle:** Let the protected remote create the canonical merge commit; determine branch policy before local merge operations, and prove content equivalence before reconciling duplicate merge metadata.

### Observation 3: Partition desktop state by renderer trust boundary

**Status:** OPEN
**Date:** 2026-09-01
**Session context:** Modularizing an Electron browser whose shell and auxiliary Work renderer both received a large composite application snapshot after every state change.
**Skill:** New skill candidate: Electron IPC state architecture
**Type:** open-source
**Phase/Area:** Renderer state publication and performance

**Issue:** A single state getter and broadcast channel caused every renderer to receive unrelated domain data, repeated database-backed projections for Work-only changes, and exposed a broader preload contract than each surface needed. Synchronous mutations also produced redundant publications.

**Suggested improvement:** Inventory state fields per renderer, define surface-specific state types, authorize getters by sender ownership, publish on separate channels, and coalesce same-turn updates before serialization. Add a focused publisher test so later refactors cannot silently restore duplicate broadcasts.

**Principle:** Treat each renderer as an independent trust and performance boundary; publish the smallest state model it consumes and batch state invalidations before crossing IPC.

### Observation 4: Keep release gates independent of source-file layout

**Status:** OPEN
**Date:** 2026-09-01
**Session context:** Running a canary source gate after splitting a public extension contract from one monolithic entry file into a barrel and responsibility-specific modules.
**Skill:** New skill candidate: refactor-safe release verification
**Type:** open-source
**Phase/Area:** Release contract verification

**Issue:** The runtime export and trust fingerprint remained unchanged, but a readiness check read the old entry file as text and therefore reported a deployment-contract mismatch after the constant moved to its dedicated contract module.

**Suggested improvement:** Make release checks validate built public exports or a named contract source rather than assuming a monolithic file path. When source inspection is unavoidable, keep the source-of-truth path explicit and cover it with the architecture gate so layout changes fail with a precise message.

**Principle:** Release gates should bind to stable contracts and declared sources of truth, not incidental implementation layout.

### Observation 5: Re-render affected PDF pages after every layout correction

**Status:** OPEN
**Date:** 2026-09-01
**Session context:** Extending a generated architecture guide with a new visual refactor page while preserving and reviewing the existing pages.
**Skill:** pdf
**Type:** workspace
**Phase/Area:** PDF visual verification

**Issue:** Text extraction, page metadata, and successful generation did not reveal labels or wrapped captions colliding with nearby diagrams. Fixing one visible collision also changed wrapping elsewhere on the affected page.

**Suggested improvement:** Render every generated page once, inspect the full set, then re-render and inspect each affected page after every copy or geometry correction. Pair that visual pass with page-count and key-text assertions so both layout and content regressions are covered.

**Principle:** A generated PDF is not verified until its final pixels are inspected; source correctness and extractable text cannot substitute for visual QA.

### Observation 6: Make dynamic UI acceptance wait for readiness and report geometry

**Status:** OPEN
**Date:** 2026-09-01
**Session context:** Verifying lazily loaded Electron renderer surfaces on both a local Mac and hosted macOS CI before merging a protected pull request.
**Skill:** New skill candidate: Electron UI acceptance hardening
**Type:** open-source
**Phase/Area:** Cross-environment UI verification

**Issue:** A fixed post-navigation delay passed locally but audited before lazy chunks rendered in CI. After readiness polling was added, hosted macOS exposed two more harness effects: Electron clamped hidden windows to the runner's 1024 px virtual screen, and the document root included a 1–6 px fractional native compositor origin even when the body client and scroll widths were identical. Sequential same-origin windows could also share zoom state.

**Suggested improvement:** Wait for expected surfaces and trigger controls, request content dimensions explicitly with larger-than-screen support, isolate each surface in an ephemeral session, and measure descendant overflow relative to the body layout box. Preserve the strict tolerance and emit root/body/viewport/zoom metrics plus the largest offending element bounds on failure.

**Principle:** UI acceptance should synchronize on observable readiness and measure application layout in the application's coordinate space, not the host compositor's document-root placement.

### Observation 7: Verify product-native tools on every provider route

**Status:** OPEN
**Date:** 2026-09-01
**Session context:** Adding a ChatGPT plan-backed provider to a browser agent whose existing API-provider route already supported native browser tools.
**Skill:** New skill candidate: cross-provider agent capability parity
**Type:** open-source
**Phase/Area:** Provider integration and live acceptance

**Issue:** Text generation and account usage passed end-to-end, while ChatGPT's native parity schema intentionally exposed only coding aliases and omitted the browser tool family. A Kimi browser-tool test and a ChatGPT text-only test therefore both passed even though ChatGPT could not navigate an interaction-enabled shared tab.

**Suggested improvement:** Build a provider-by-capability acceptance matrix and exercise at least one real tool call through every provider-specific transport. Assert the advertised schema contains each product-native tool family, then verify one read action and one permissioned mutation end to end in the packaged app.

**Principle:** Provider parity is behavioral, not just conversational; each transport must prove the product-native capabilities its UI promises.

### Observation 8: Preserve companion binaries and entitlements for pinned native runtimes

**Status:** OPEN
**Date:** 2026-09-01
**Session context:** Packaging a pinned Codex App Server binary for a signed Electron browser after enabling its native Code Mode tool runner.
**Skill:** New skill candidate: managed native runtime packaging
**Type:** open-source
**Phase/Area:** Native dependency staging and macOS code signing

**Issue:** The primary `codex` executable passed version, signature, and login checks, but App Server's tool runner depended on an adjacent `codex-code-mode-host` executable that the single-binary manifest did not stage. After the companion was added, Locus's hardened re-signing pass stripped its upstream JIT entitlements, so it launched and immediately closed stdout when a browser tool ran.

**Suggested improvement:** Model a managed component as a pinned set of executables, verify every member's archive path, size, hash, architecture, and upstream signing team, and stage companions beside the primary binary. During application signing, explicitly preserve required entitlements and add a packaged release gate that inspects the final signatures. Finish with a real native-tool invocation rather than a version-only probe.

**Principle:** A native runtime is the complete signed execution graph, not its entry-point binary; package, sign, and test every executable the entry point can spawn.

### Observation 9: Personalization state must cross every renderer boundary

**Status:** OPEN
**Date:** 2026-09-01
**Session context:** Mirroring one native application's accent personalization across an Electron browser with isolated Shell, Work, and Reader renderers.
**Skill:** apple-design, react-best-practices
**Type:** open-source
**Phase/Area:** Multi-surface theming / accessibility

**Issue:** Replacing a root CSS colour made the main chrome look correct while independently published or query-driven renderer surfaces retained the default brand. A single colour token was also insufficient because bright control fills, readable foreground actions, and logo treatments require different values in light and dark appearances.

**Suggested improvement:** Model personalization as validated persisted state, publish it explicitly to every renderer boundary, and derive separate fill, logo, logo-ink, light-action, and dark-action tokens from one authoritative preset table. Add fixtures for a named preset and a custom colour at normal and enlarged scale, plus a live event path for already-mounted auxiliary surfaces.

**Principle:** Global visual preferences are distributed application state; completeness requires both cross-surface propagation and semantic colour roles, not a root-level hex replacement.

### Observation 10: Responsive UI checks must inspect accessible names

**Status:** OPEN
**Date:** 2026-09-01
**Session context:** Replacing a long Electron Settings surface with labeled category navigation that remains usable at 200% scaling.
**Skill:** apple-design, react-best-practices
**Type:** open-source
**Phase/Area:** Responsive navigation / accessibility acceptance

**Issue:** A compact breakpoint hid every settings-navigation label and left nine icon-only buttons without accessible names. The existing smoke audit still passed because it treated hidden descendant `textContent` as the control name, while the accessibility tree correctly exposed unnamed buttons.

**Suggested improvement:** At every responsive breakpoint, assert names from the accessibility tree or the rendered accessibility-name algorithm rather than raw DOM text. Test the effective CSS viewport produced by application zoom, and require visible labels or explicit accessible names for every navigation control.

**Principle:** Responsive simplification is valid only when both visible orientation and computed accessible names survive the breakpoint.
