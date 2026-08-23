import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { WorkFileEntryState } from "../shared/types.js";

export const MAX_WORKSPACE_FILES = 600;
export const MAX_WORKSPACE_DEPTH = 7;
export const MAX_WORKSPACE_PREVIEW_BYTES = 512 * 1024;

const ignoredDirectories = new Set([
  ".git", ".hg", ".svn", ".venv", ".mypy_cache", ".pytest_cache", ".ruff_cache", "__pycache__",
  "node_modules", "dist", "build", "coverage", ".next", ".turbo",
]);
const secretExtensions = new Set([".key", ".pem", ".p12", ".pfx", ".mobileprovision"]);
const secretFileNames = new Set([".netrc", ".npmrc", ".pypirc", "credentials.json", "secrets.json", "service-account.json"]);
const binaryExtensions = new Set([
  ".7z", ".a", ".app", ".avi", ".bin", ".class", ".dmg", ".doc", ".docx", ".gif", ".gz", ".heic",
  ".ico", ".icns", ".jar", ".jpeg", ".jpg", ".mov", ".mp3", ".mp4", ".o", ".pdf", ".png", ".pyc",
  ".pyo", ".so", ".tar", ".wasm", ".wav", ".webm", ".webp", ".xls", ".xlsx", ".zip",
]);

export interface WorkFileListing {
  entries: WorkFileEntryState[];
  truncated: boolean;
}

export interface WorkFilePreview {
  path: string;
  content: string;
  truncated: boolean;
}

export async function listWorkspaceFiles(workspace: string): Promise<WorkFileListing> {
  const root = resolve(workspace);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error("The workspace folder is unavailable");
  const entries: WorkFileEntryState[] = [];
  let truncated = false;

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_WORKSPACE_DEPTH || entries.length >= MAX_WORKSPACE_FILES) {
      truncated = true;
      return;
    }
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
    for (const child of children) {
      if (entries.length >= MAX_WORKSPACE_FILES) {
        truncated = true;
        return;
      }
      const childPath = resolve(directory, child.name);
      const relativePath = portableRelative(root, childPath);
      if (child.isDirectory()) {
        if (!ignoredDirectories.has(child.name)) await visit(childPath, depth + 1);
      } else if (child.isFile() && !sensitiveWorkspacePath(relativePath) && !binaryWorkspacePath(relativePath)) {
        const metadata = await stat(childPath);
        entries.push({ path: relativePath, name: child.name, size: metadata.size, modifiedAt: Math.floor(metadata.mtimeMs) });
      }
    }
  };

  await visit(root, 0);
  return { entries, truncated };
}

export async function readWorkspaceFile(workspace: string, requestedPath: string): Promise<WorkFilePreview> {
  const root = resolve(workspace);
  const target = resolveWorkspaceTarget(root, requestedPath);
  const relativePath = portableRelative(root, target);
  if (sensitiveWorkspacePath(relativePath)) throw new Error("That file is protected from Work Mode");
  if (binaryWorkspacePath(relativePath)) throw new Error("Binary files are not previewed in Work Mode");
  const linkMetadata = await lstat(target);
  if (linkMetadata.isSymbolicLink()) throw new Error("Linked files are not previewed in Work Mode");
  const rootRealPath = await realpath(root);
  const targetRealPath = await realpath(target);
  if (targetRealPath !== rootRealPath && !targetRealPath.startsWith(`${rootRealPath}${sep}`)) {
    throw new Error("That file resolves outside the workspace");
  }
  const metadata = await stat(targetRealPath);
  if (!metadata.isFile()) throw new Error("That workspace file is unavailable");

  const handle = await open(targetRealPath, "r");
  try {
    const buffer = Buffer.alloc(Math.min(metadata.size, MAX_WORKSPACE_PREVIEW_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0)) throw new Error("Binary files are not previewed in Work Mode");
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("This file is not valid UTF-8 text");
    }
    return { path: relativePath, content, truncated: metadata.size > bytesRead };
  } finally {
    await handle.close();
  }
}

export function resolveWorkspaceTarget(workspace: string, requestedPath: string): string {
  const root = resolve(workspace);
  const value = requestedPath.trim();
  if (!value || isAbsolute(value)) throw new Error("Choose a file inside the workspace");
  const target = resolve(root, value);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("That file is outside the workspace");
  return target;
}

export function sensitiveWorkspacePath(value: string): boolean {
  const parts = value.split("/").filter(Boolean);
  const name = (parts.at(-1) ?? "").toLowerCase();
  if (parts.some((part) => [".git", ".ssh", ".aws", ".gnupg"].includes(part.toLowerCase()))) return true;
  if (name === ".env" || name.startsWith(".env.") || name.includes("recovery-code")) return true;
  if (secretFileNames.has(name) || /(^|[_-])id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(name) || /[_-]ed25519(\.pub)?$/.test(name)) return true;
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  return secretExtensions.has(extension);
}

function binaryWorkspacePath(value: string): boolean {
  const name = basename(value).toLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  return binaryExtensions.has(extension);
}

function portableRelative(root: string, target: string): string {
  return relative(root, target).split(sep).join("/");
}
