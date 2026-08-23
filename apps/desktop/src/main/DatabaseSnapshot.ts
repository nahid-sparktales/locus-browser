import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const SNAPSHOT_KEEP_COUNT = 2;

export function snapshotDatabaseForVersion(databasePath: string, version: string): string | undefined {
  if (!existsSync(databasePath)) return undefined;
  const root = join(dirname(databasePath), "Database Backups");
  const safeVersion = version.replace(/[^0-9A-Za-z.+-]/g, "-");
  const marker = join(root, `last-version-${safeVersion}`);
  if (existsSync(marker)) return undefined;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const snapshot = join(root, `${Date.now()}-${safeVersion}`);
  mkdirSync(snapshot, { mode: 0o700 });
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = `${databasePath}${suffix}`;
    if (existsSync(source)) copyFileSync(source, join(snapshot, `${basename(databasePath)}${suffix}`));
  }
  writeFileSync(join(snapshot, "VERSION"), `${version}\n`, { mode: 0o600 });
  writeFileSync(marker, `${Date.now()}\n`, { mode: 0o600 });
  const snapshots = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  for (const stale of snapshots.slice(SNAPSHOT_KEEP_COUNT)) rmSync(stale, { recursive: true, force: true });
  return snapshot;
}
