import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotDatabaseForVersion } from "./DatabaseSnapshot.js";

describe("database release snapshots", () => {
  it("copies the database once per version and retains two rollback points", () => {
    const root = mkdtempSync(join(tmpdir(), "locus-browser-snapshot-"));
    mkdirSync(root, { recursive: true });
    const database = join(root, "browser.sqlite3");
    writeFileSync(database, "one");
    expect(snapshotDatabaseForVersion(database, "0.1.0-canary.1")).toBeTruthy();
    expect(snapshotDatabaseForVersion(database, "0.1.0-canary.1")).toBeUndefined();
    expect(snapshotDatabaseForVersion(database, "0.1.0-canary.2")).toBeTruthy();
    expect(snapshotDatabaseForVersion(database, "0.1.0-canary.3")).toBeTruthy();
  });
});
