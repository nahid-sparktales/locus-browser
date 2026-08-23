import { capabilityRegistry, extensionContentScriptMatches, permissionExpansion, validateManifest, type LocusExtensionManifest } from "@locus/extensions";
import type { ExtensionManagerState } from "../shared/types.js";
import { BrowserDatabase, type StoredExtensionInstall } from "./BrowserDatabase.js";
import { inspectUnpackedExtension, type UnpackedExtensionInspection } from "./UnpackedExtensionInspector.js";

export interface LoadedExtension {
  id: string;
  name: string;
  path: string;
  version: string;
}

export interface ExtensionRuntime {
  getExtension(id: string): LoadedExtension | null;
  loadExtension(path: string, options?: { allowFileAccess?: boolean }): Promise<LoadedExtension>;
  removeExtension(id: string): void;
}

export interface ExtensionPermissionReview {
  inspection: UnpackedExtensionInspection;
  expansion: string[];
}

export class ExtensionManager {
  readonly #database: BrowserDatabase;
  readonly #profileId: string;
  readonly #runtime: ExtensionRuntime;
  #loading = false;

  constructor(database: BrowserDatabase, profileId: string, runtime: ExtensionRuntime) {
    this.#database = database;
    this.#profileId = profileId;
    this.#runtime = runtime;
  }

  state(): ExtensionManagerState {
    const developerMode = this.developerMode();
    const installs = this.#database.listExtensionInstalls(this.#profileId).map((install) => {
      const manifest = storedManifest(install);
      return {
        id: install.id,
        name: install.name || manifest?.name || "Extension from another device",
        version: install.version,
        ...(manifest?.description ? { description: manifest.description } : {}),
        enabled: install.enabled,
        loaded: Boolean(install.runtimeId && this.#runtime.getExtension(install.runtimeId)),
        source: install.source,
        ...(install.installPath ? { installPath: install.installPath } : {}),
        permissions: [...(manifest?.permissions ?? []), ...(manifest?.optional_permissions ?? [])],
        hostPermissions: manifest ? [...new Set([
          ...manifest.host_permissions,
          ...manifest.optional_host_permissions,
          ...extensionContentScriptMatches(manifest),
        ])] : [],
        ...(install.lastError ? { error: install.lastError } : {}),
        updatedAt: install.updatedAt ?? 0,
      };
    });
    return {
      developerMode,
      loading: this.#loading,
      installs,
      supportedApiCount: capabilityRegistry.permissions.length,
      message: this.#loading
        ? "Checking profile extensions…"
        : installs.some((install) => install.error)
          ? "One or more extensions need attention."
          : developerMode
            ? "Developer Mode is on. Unpacked extensions can inspect granted sites."
            : "Developer Mode is off. Unpacked extensions are not loaded.",
    };
  }

  developerMode(): boolean {
    return this.#database.setting(this.#profileId, "extensionDeveloperMode") === true;
  }

  async initialize(): Promise<void> {
    this.#loading = true;
    try {
      for (const install of this.#database.listExtensionInstalls(this.#profileId)) {
        if (!install.enabled) {
          this.#unload(install);
          continue;
        }
        if (install.source === "developer" && !this.developerMode()) {
          this.#unload(install);
          continue;
        }
        await this.#loadStored(install);
      }
    } finally {
      this.#loading = false;
    }
  }

  async setDeveloperMode(enabled: boolean): Promise<void> {
    this.#database.setSetting(this.#profileId, "extensionDeveloperMode", enabled);
    const developerInstalls = this.#database.listExtensionInstalls(this.#profileId).filter((install) => install.source === "developer");
    if (!enabled) {
      for (const install of developerInstalls) this.#unload(install);
      return;
    }
    for (const install of developerInstalls) {
      if (install.enabled) await this.#loadStored(install);
    }
  }

  async inspectUnpacked(path: string): Promise<ExtensionPermissionReview> {
    const inspection = await inspectUnpackedExtension(path);
    const existing = this.#database.listExtensionInstalls(this.#profileId).find((install) => install.installPath === inspection.path);
    const previous = existing ? storedManifest(existing) : undefined;
    return { inspection, expansion: previous ? permissionExpansion(previous, inspection.manifest) : [] };
  }

  async installUnpacked(review: ExtensionPermissionReview): Promise<void> {
    if (!this.developerMode()) throw new Error("Turn on Extension Developer Mode first");
    const inspection = await inspectUnpackedExtension(review.inspection.path);
    if (inspection.fingerprint !== review.inspection.fingerprint) {
      throw new Error("Extension files changed while permissions were being reviewed");
    }
    const installs = this.#database.listExtensionInstalls(this.#profileId);
    const existingByPath = installs.find((install) => install.installPath === inspection.path);
    if (existingByPath) this.#unload(existingByPath);
    try {
      const loaded = await this.#runtime.loadExtension(inspection.path, { allowFileAccess: false });
      const developerId = `developer:${loaded.id}`;
      const existingById = installs.find((install) => install.id === developerId);
      const id = existingByPath?.id ?? existingById?.id ?? developerId;
      if (existingById && existingById.id !== existingByPath?.id) this.#database.deleteExtensionInstall(this.#profileId, existingById.id);
      this.#database.saveExtensionInstall(this.#profileId, {
        id,
        runtimeId: loaded.id,
        name: inspection.manifest.name,
        version: inspection.manifest.version,
        enabled: true,
        source: "developer",
        installPath: inspection.path,
        manifestJson: JSON.stringify(inspection.manifest),
      });
    } catch (error) {
      if (existingByPath) this.#database.setExtensionLoadState(this.#profileId, existingByPath.id, true, existingByPath.runtimeId, extensionError(error));
      throw error;
    }
  }

  async prepareEnable(id: string): Promise<ExtensionPermissionReview> {
    const install = this.#install(id);
    if (!install.installPath) throw new Error("Install this gallery extension on this Mac before enabling it");
    const inspection = await inspectUnpackedExtension(install.installPath);
    const previous = storedManifest(install);
    return { inspection, expansion: previous ? permissionExpansion(previous, inspection.manifest) : [] };
  }

  async setEnabled(id: string, enabled: boolean, review?: ExtensionPermissionReview): Promise<void> {
    const install = this.#install(id);
    if (!enabled) {
      this.#unload(install);
      this.#database.setExtensionLoadState(this.#profileId, id, false, install.runtimeId);
      return;
    }
    if (install.source === "developer" && !this.developerMode()) throw new Error("Turn on Extension Developer Mode first");
    if (!review) throw new Error("Review extension permissions before enabling it");
    const inspection = await inspectUnpackedExtension(review.inspection.path);
    if (inspection.fingerprint !== review.inspection.fingerprint || inspection.path !== install.installPath) {
      throw new Error("Extension files changed while permissions were being reviewed");
    }
    const { lastError: _lastError, ...cleanInstall } = install;
    await this.#loadStored({
      ...cleanInstall,
      name: inspection.manifest.name,
      version: inspection.manifest.version,
      manifestJson: JSON.stringify(inspection.manifest),
      enabled: true,
    });
  }

  remove(id: string): void {
    const install = this.#install(id);
    this.#unload(install);
    this.#database.deleteExtensionInstall(this.#profileId, id);
  }

  #install(id: string): StoredExtensionInstall {
    const install = this.#database.listExtensionInstalls(this.#profileId).find((item) => item.id === id);
    if (!install) throw new Error("Extension is no longer installed in this profile");
    return install;
  }

  async #loadStored(install: StoredExtensionInstall): Promise<void> {
    if (!install.installPath) {
      this.#database.setExtensionLoadState(this.#profileId, install.id, install.enabled, install.runtimeId, "Install this extension from the gallery on this Mac.");
      return;
    }
    try {
      const inspection = await inspectUnpackedExtension(install.installPath);
      const previous = storedManifest(install);
      const expansion = previous ? permissionExpansion(previous, inspection.manifest) : [];
      if (expansion.length) throw new Error(`New permissions require review: ${expansion.join(", ")}`);
      if (install.runtimeId && this.#runtime.getExtension(install.runtimeId)) return;
      const loaded = await this.#runtime.loadExtension(inspection.path, { allowFileAccess: false });
      const { lastError: _lastError, ...cleanInstall } = install;
      this.#database.saveExtensionInstall(this.#profileId, {
        ...cleanInstall,
        runtimeId: loaded.id,
        name: inspection.manifest.name,
        version: inspection.manifest.version,
        manifestJson: JSON.stringify(inspection.manifest),
        enabled: true,
      });
    } catch (error) {
      this.#database.setExtensionLoadState(this.#profileId, install.id, install.enabled, install.runtimeId, extensionError(error));
    }
  }

  #unload(install: StoredExtensionInstall): void {
    if (install.runtimeId && this.#runtime.getExtension(install.runtimeId)) this.#runtime.removeExtension(install.runtimeId);
  }
}

function storedManifest(install: StoredExtensionInstall): LocusExtensionManifest | undefined {
  try {
    return validateManifest(JSON.parse(install.manifestJson));
  } catch {
    return undefined;
  }
}

function extensionError(error: unknown): string {
  return (error instanceof Error ? error.message : "Extension could not be loaded").slice(0, 1_000);
}
