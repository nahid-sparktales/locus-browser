import { strFromU8 } from "fflate";
import { z } from "zod";
import { capabilityRegistry } from "./contract.js";

const ContentScriptsSchema = z.array(z.object({
  matches: z.array(z.string()).min(1).max(200),
  exclude_matches: z.array(z.string()).max(200).optional(),
  js: z.array(z.string()).max(200).optional(),
  css: z.array(z.string()).max(200).optional(),
  run_at: z.enum(["document_start", "document_end", "document_idle"]).optional(),
  all_frames: z.boolean().optional(),
  match_about_blank: z.boolean().optional(),
}).strict()).max(200);

const ManifestSchema = z.object({
  manifest_version: z.literal(3),
  name: z.string().trim().min(1).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  description: z.string().max(500).optional(),
  icons: z.record(z.string(), z.string()).optional(),
  author: z.string().max(200).optional(),
  short_name: z.string().trim().min(1).max(40).optional(),
  default_locale: z.string().regex(/^[A-Za-z0-9_-]{2,20}$/).optional(),
  minimum_chrome_version: z.string().regex(/^\d+(?:\.\d+){0,3}$/).optional(),
  key: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(8_192).optional(),
  content_scripts: ContentScriptsSchema.default([]),
  permissions: z.array(z.string()).max(200).default([]),
  optional_permissions: z.array(z.string()).max(200).default([]),
  host_permissions: z.array(z.string()).max(200).default([]),
  optional_host_permissions: z.array(z.string()).max(200).default([]),
}).passthrough();

export type LocusExtensionManifest = z.infer<typeof ManifestSchema>;

export function validateManifest(raw: unknown): LocusExtensionManifest {
  const parsed = ManifestSchema.parse(raw);
  const unknownKeys = Object.keys(parsed).filter(
    (key) => !capabilityRegistry.supportedManifestKeys.includes(key as never),
  );
  if (unknownKeys.length) throw new Error(`Unsupported manifest keys: ${unknownKeys.join(", ")}`);
  const unsupportedPermissions = [...parsed.permissions, ...parsed.optional_permissions].filter(
    (permission) => !capabilityRegistry.permissions.includes(permission as never),
  );
  if (unsupportedPermissions.length) {
    throw new Error(`Unsupported extension permissions: ${[...new Set(unsupportedPermissions)].join(", ")}`);
  }
  for (const pattern of [...parsed.host_permissions, ...parsed.optional_host_permissions]) validateHostPattern(pattern);
  for (const script of parsed.content_scripts) {
    for (const pattern of [...script.matches, ...(script.exclude_matches ?? [])]) validateHostPattern(pattern);
    for (const path of [...(script.js ?? []), ...(script.css ?? [])]) validateRelativeExtensionPath(path);
    if (!(script.js?.length || script.css?.length)) throw new Error("Content scripts must include local JavaScript or CSS files");
  }
  if (parsed.icons !== undefined) {
    for (const [size, path] of Object.entries(parsed.icons)) {
      if (!/^\d{1,4}$/.test(size)) throw new Error("Extension icons must use numeric sizes and local paths");
      validateRelativeExtensionPath(path);
    }
  }
  return parsed;
}

export function permissionExpansion(previous: LocusExtensionManifest, next: LocusExtensionManifest): string[] {
  const existing = new Set([
    ...previous.permissions,
    ...previous.optional_permissions,
    ...previous.host_permissions,
    ...previous.optional_host_permissions,
    ...extensionContentScriptMatches(previous),
  ]);
  return [...new Set([
    ...next.permissions,
    ...next.optional_permissions,
    ...next.host_permissions,
    ...next.optional_host_permissions,
    ...extensionContentScriptMatches(next),
  ].filter((permission) => !existing.has(permission)))];
}

export function extensionContentScriptMatches(manifest: LocusExtensionManifest): string[] {
  return [...new Set(manifest.content_scripts.flatMap((script) => script.matches))];
}

export function extensionLocalResources(manifest: LocusExtensionManifest): string[] {
  return [...new Set([
    ...manifest.content_scripts.flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])]),
    ...Object.values(manifest.icons ?? {}),
  ])];
}

export function validateArchivePath(path: string): void {
  const segments = path.split("/");
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe extension path: ${path}`);
  }
}

function validateHostPattern(pattern: string): void {
  if (pattern === "<all_urls>") return;
  if (!/^(https?|\*):\/\/(?:\*|\*\.[A-Za-z0-9.-]+|[A-Za-z0-9.-]+)\/.*$/.test(pattern)) {
    throw new Error(`Unsupported host permission pattern: ${pattern}`);
  }
}

function validateRelativeExtensionPath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new Error(`Unsafe extension resource path: ${path}`);
  }
}

export function validateExtensionFile(path: string, bytes: Uint8Array): void {
  if (!/\.(?:js|mjs|cjs|html|json)$/i.test(path)) return;
  const source = strFromU8(bytes);
  if (/\b(?:eval|Function)\s*\(/.test(source)) throw new Error(`Dynamic code execution is forbidden in ${path}`);
  if (/https?:\/\/[^\s"']+\.(?:js|mjs)(?:[?"']|$)/i.test(source)) throw new Error(`Remote executable code is forbidden in ${path}`);
  if (/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//i.test(source)) throw new Error(`Remote executable code is forbidden in ${path}`);
  if (/\b(?:import\s*\(|from\s+)["']https?:\/\//i.test(source)) throw new Error(`Remote executable code is forbidden in ${path}`);
}
