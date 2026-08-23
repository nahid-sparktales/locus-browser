import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listWorkspaceFiles, readWorkspaceFile, resolveWorkspaceTarget } from "./WorkWorkspaceBrowser.js";

describe("Work workspace browser", () => {
  it("lists bounded text files without exposing secrets, dependencies, or symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "locus-workspace-"));
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await mkdir(join(root, "src", "__pycache__"));
    await writeFile(join(root, "src", "app.ts"), "export const ready = true;\n");
    await writeFile(join(root, ".env"), "SECRET=not-for-renderer\n");
    await writeFile(join(root, "github_cowork_ed25519"), "PRIVATE KEY\n");
    await writeFile(join(root, "node_modules", "package.js"), "ignored\n");
    await writeFile(join(root, "src", "__pycache__", "app.pyc"), "ignored\n");
    await symlink(join(root, ".env"), join(root, "src", "linked-secret"));

    const result = await listWorkspaceFiles(root);
    expect(result.entries.map((entry) => entry.path)).toEqual(["src/app.ts"]);
    await expect(readWorkspaceFile(root, "src/linked-secret")).rejects.toThrow("Linked files");
  });

  it("reads UTF-8 files while rejecting traversal and protected paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "locus-workspace-"));
    await writeFile(join(root, "README.md"), "Hello workspace\n");
    await writeFile(join(root, ".env.local"), "TOKEN=secret\n");

    await expect(readWorkspaceFile(root, "README.md")).resolves.toMatchObject({ content: "Hello workspace\n", truncated: false });
    await expect(readWorkspaceFile(root, ".env.local")).rejects.toThrow("protected");
    expect(() => resolveWorkspaceTarget(root, "../../etc/passwd")).toThrow("outside");
    expect(() => resolveWorkspaceTarget(root, "/etc/passwd")).toThrow("inside");
  });
});
