export const locusxContractVersion = 2;
export const extensionGalleryCatalogVersion = 1;
export const extensionGalleryDocumentVersion = 1;

export const trustedGalleryKeys = [{
  id: "locus-canary-2026-08",
  name: "Locus Canary Gallery",
  channel: "canary",
  fingerprint: "d1257f8fe1c98e28efeb83b9fa1755cca4e82aa0360391bb73a7b054b161f10d",
}] as const;

export const trustedGalleryFingerprints = new Set(trustedGalleryKeys.map((key) => key.fingerprint));

export const capabilityRegistry = {
  contractVersion: 3,
  manifestVersion: 3,
  supportedManifestKeys: [
    "manifest_version", "name", "version", "description", "icons", "author",
    "short_name", "default_locale", "minimum_chrome_version", "key", "content_scripts",
    "permissions", "host_permissions", "optional_permissions", "optional_host_permissions",
  ],
  permissions: [
    "activeTab", "scripting", "storage", "tabs", "webRequest",
  ],
} as const;
