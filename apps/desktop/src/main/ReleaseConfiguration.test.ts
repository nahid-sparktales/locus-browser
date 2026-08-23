import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadReleaseConfiguration } from "./ReleaseConfiguration.js";

describe("release configuration", () => {
  it("loads signed-package service origins and ignores environment overrides", () => {
    const resourcesPath = mkdtempSync(join(tmpdir(), "locus-release-config-"));
    writeFileSync(join(resourcesPath, "release-config.json"), JSON.stringify({
      contractVersion: 1,
      galleryUrl: "https://extensions.example.com",
      syncUrl: "https://sync.example.com",
    }));
    expect(loadReleaseConfiguration({
      packaged: true,
      resourcesPath,
      environment: { LOCUS_EXTENSION_GALLERY_URL: "https://attacker.example" },
    })).toEqual({
      galleryUrl: "https://extensions.example.com",
      syncUrl: "https://sync.example.com",
    });
  });

  it("fails closed for missing or unsafe packaged configuration", () => {
    const missing = mkdtempSync(join(tmpdir(), "locus-release-config-missing-"));
    expect(loadReleaseConfiguration({ packaged: true, resourcesPath: missing })).toEqual({});
    writeFileSync(join(missing, "release-config.json"), JSON.stringify({
      contractVersion: 1,
      galleryUrl: "http://extensions.example.com",
      syncUrl: "https://sync.example.com/path",
    }));
    expect(loadReleaseConfiguration({ packaged: true, resourcesPath: missing })).toEqual({});
  });

  it("allows explicit loopback defaults only in development", () => {
    expect(loadReleaseConfiguration({ packaged: false, resourcesPath: "/unused", environment: {} })).toEqual({
      galleryUrl: "http://127.0.0.1:8790",
      syncUrl: "http://127.0.0.1:8787",
    });
  });
});
