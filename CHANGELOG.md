# Changelog

## 0.1.0-canary.3 — unreleased

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

See `docs/implementation-status.md` for scope and `docs/canary-runbook.md` for
the controlled release procedure.
