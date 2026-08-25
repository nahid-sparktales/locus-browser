# Changelog

## 0.1.0-canary.5 — unreleased

Intelligence and Productivity Canary:

- opt-in Private Semantic Recall with Apple Natural Language embeddings,
  encrypted per-profile content, hybrid ranking, exclusions, deletion controls,
  bounded storage, and keyword fallback;
- encrypted Cited Research Boards made from up to ten explicitly shared tabs,
  with immutable evidence, exact passage citations, strict citation validation,
  and Markdown/PDF export;
- provider-independent AI Tab Steward previews for exact duplicates, related-tab
  groups, and local Resume Later bundles;
- two live webpage panes with focused-pane controls, independent grants/audio,
  persisted 30–70% layout, recording safety, and Reader support in either pane;
- a keyboard-first Command Palette for tabs, history, bookmarks, conversations,
  settings, research, Recall, bundles, and allowlisted browser actions;
- Locus-themed Reader Mode with double-sanitized articles, local preferences,
  installed macOS voices, sentence navigation, and Read Aloud highlighting;
- a dedicated intelligence utility process and OS-key-protected encrypted vault,
  plus a signed Apple-native semantic helper from `locus-platform`;
- twelve responsive accessibility/Reduced Motion fixtures, updated public
  screenshots, and a six-page architecture and feature guide.

## 0.1.0-canary.4 — unreleased

Initial Apple Silicon macOS canary candidate:

- secure browser foundation with Locus-themed normal and private browsing;
- focused Solo Work dock and the native-Locus model/provider choices;
- explicit agent tab grants and protected browser automation;
- signed, revocable curated extensions with a tested MV3 subset;
- optional end-to-end encrypted multi-device browser sync;
- visible live browser recording for explicitly shared tabs, with separate tab
  audio/microphone controls, on-device or optional cloud transcription,
  encrypted local transcripts, `⌘Enter` assistance, and opt-in redacted video;
- signed/notarized packaging, canary updates, rollback snapshots, SBOM, signed
  artifact manifest, and automated security/accessibility/performance gates.
- deterministic Apple Silicon speech-runtime builds that avoid runner-specific
  CPU extensions while retaining Metal acceleration.
- an explicitly generated, checksummed `canary-mac.yml` feed included in the
  signed release manifest for reliable prerelease updates.
- SemVer-compatible `vX.Y.Z-canary.N` release tags that the desktop updater can
  discover through GitHub's release feed.
- parseable public signing-key files, with source gates that verify both
  documented fingerprints against the gallery and release trust roots.

See `docs/implementation-status.md` for scope and `docs/canary-runbook.md` for
the controlled release procedure.
