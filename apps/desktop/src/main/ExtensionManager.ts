import {
  capabilityRegistry,
  extensionContentScriptMatches,
  permissionExpansion,
  trustedGalleryKeys,
  validateManifest,
  type LocusExtensionManifest,
} from "@locus/extensions";
import type { ExtensionManagerState } from "../shared/types.js";
import { BrowserDatabase, type StoredExtensionInstall, type StoredExtensionPackage } from "./BrowserDatabase.js";
import { GalleryExtensionStore, type SignedExtensionInspection } from "./GalleryExtensionStore.js";
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
  inspection: UnpackedExtensionInspection | SignedExtensionInspection;
  expansion: string[];
  source: "developer" | "gallery" | "rollback";
  rollbackPackage?: StoredExtensionPackage;
}

export class ExtensionManager {
  readonly #database: BrowserDatabase;
  readonly #profileId: string;
  readonly #runtime: ExtensionRuntime;
  readonly #galleryStore: GalleryExtensionStore | undefined;
  #loading = false;

  constructor(database: BrowserDatabase, profileId: string, runtime: ExtensionRuntime, galleryStore?: GalleryExtensionStore) {
    this.#database = database;
    this.#profileId = profileId;
    this.#runtime = runtime;
    this.#galleryStore = galleryStore;
  }

  state(): ExtensionManagerState {
    const developerMode = this.developerMode();
    const installs = this.#database.listExtensionInstalls(this.#profileId).map((install) => {
      const manifest = storedManifest(install);
      const packages = install.source === "gallery" ? this.#database.listExtensionPackages(this.#profileId, install.id) : [];
      const activePackage = packages.find((extensionPackage) => extensionPackage.installPath === install.installPath);
      const rollbackPackage = packages.find((extensionPackage) => extensionPackage.installPath !== install.installPath);
      const galleryKey = activePackage
        ? trustedGalleryKeys.find((key) => key.fingerprint === activePackage.galleryFingerprint)
        : undefined;
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
        ...(activePackage ? { verifiedPublisher: activePackage.publisherFingerprint.slice(0, 12) } : {}),
        ...(activePackage ? { galleryKeyName: galleryKey?.name ?? "Trusted Locus gallery" } : {}),
        ...(rollbackPackage ? { rollbackVersion: rollbackPackage.version } : {}),
        ...(install.lastError ? { error: install.lastError } : {}),
        updatedAt: install.updatedAt ?? 0,
      };
    });
    return {
      developerMode,
      loading: this.#loading,
      installs,
      supportedApiCount: capabilityRegistry.permissions.length,
      trustedGalleryKeyCount: this.#galleryStore?.trustedKeyCount ?? 0,
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
    return { inspection, expansion: previous ? permissionExpansion(previous, inspection.manifest) : [], source: "developer" };
  }

  async inspectGallery(path: string): Promise<ExtensionPermissionReview> {
    if (!this.#galleryStore) throw new Error("Signed extension storage is unavailable");
    const inspection = await this.#galleryStore.inspect(path);
    const existing = this.#database.listExtensionInstalls(this.#profileId).find((install) => install.id === inspection.id);
    const previous = existing ? storedManifest(existing) : undefined;
    return { inspection, expansion: previous ? permissionExpansion(previous, inspection.manifest) : [], source: "gallery" };
  }

  async installUnpacked(review: ExtensionPermissionReview): Promise<void> {
    if (review.source !== "developer") throw new Error("Expected an unpacked extension review");
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

  async installGallery(review: ExtensionPermissionReview): Promise<void> {
    const inspection = review.inspection;
    if (!this.#galleryStore || review.source !== "gallery" || !("id" in inspection)) {
      throw new Error("Expected a signed gallery extension review");
    }
    const existing = this.#database.listExtensionInstalls(this.#profileId).find((install) => install.id === inspection.id);
    const activePackage = existing?.installPath
      ? this.#database.listExtensionPackages(this.#profileId, existing.id).find((item) => item.installPath === existing.installPath)
      : undefined;
    if (activePackage && activePackage.publisherFingerprint !== inspection.publisherFingerprint) {
      throw new Error("Extension updates must keep the same verified publisher");
    }
    if (activePackage) {
      const order = compareExtensionVersions(inspection.manifest.version, activePackage.version);
      if (order < 0) throw new Error(`Use Roll back to return to ${inspection.manifest.version}`);
      if (order === 0 && activePackage.packageFingerprint !== inspection.fingerprint) {
        throw new Error("A different package with this version is already installed");
      }
    }

    const installed = await this.#galleryStore.install(inspection);
    const packageRecord: StoredExtensionPackage = {
      extensionId: installed.id,
      version: installed.manifest.version,
      installPath: installed.installPath,
      packageFingerprint: installed.fingerprint,
      publisherFingerprint: installed.publisherFingerprint,
      galleryFingerprint: installed.galleryFingerprint,
      installedAt: Math.floor(Date.now() / 1_000),
    };
    let loaded: LoadedExtension | undefined;
    try {
      loaded = await this.#replaceLoadedExtension(existing, installed.installPath);
      this.#database.saveExtensionInstall(this.#profileId, {
        id: installed.id,
        runtimeId: loaded.id,
        name: installed.manifest.name,
        version: installed.manifest.version,
        enabled: true,
        source: "gallery",
        installPath: installed.installPath,
        manifestJson: JSON.stringify(installed.manifest),
      });
      this.#database.saveExtensionPackage(this.#profileId, packageRecord);
    } catch (error) {
      if (loaded && this.#runtime.getExtension(loaded.id)) this.#runtime.removeExtension(loaded.id);
      if (!existing) this.#database.deleteExtensionInstall(this.#profileId, installed.id);
      await this.#restoreAfterFailedReplacement(existing);
      await this.#galleryStore.removeManagedVersion(installed.installPath);
      throw error;
    }
  }

  async prepareEnable(id: string): Promise<ExtensionPermissionReview> {
    const install = this.#install(id);
    if (!install.installPath) throw new Error("Install this gallery extension on this Mac before enabling it");
    const inspection = await inspectUnpackedExtension(install.installPath);
    const previous = storedManifest(install);
    return { inspection, expansion: previous ? permissionExpansion(previous, inspection.manifest) : [], source: install.source };
  }

  async prepareRollback(id: string): Promise<ExtensionPermissionReview> {
    const install = this.#install(id);
    if (install.source !== "gallery") throw new Error("Only signed gallery extensions can be rolled back");
    const rollbackPackage = this.#database.listExtensionPackages(this.#profileId, id)
      .find((extensionPackage) => extensionPackage.installPath !== install.installPath);
    if (!rollbackPackage) throw new Error("No verified rollback version is available");
    const inspection = await inspectUnpackedExtension(rollbackPackage.installPath);
    const previous = storedManifest(install);
    return {
      inspection,
      expansion: previous ? permissionExpansion(previous, inspection.manifest) : [],
      source: "rollback",
      rollbackPackage,
    };
  }

  async rollback(id: string, review: ExtensionPermissionReview): Promise<void> {
    const install = this.#install(id);
    const rollbackPackage = review.rollbackPackage;
    if (install.source !== "gallery" || review.source !== "rollback" || !rollbackPackage || rollbackPackage.extensionId !== id) {
      throw new Error("Expected a verified rollback review");
    }
    const inspection = await inspectUnpackedExtension(rollbackPackage.installPath);
    if (inspection.fingerprint !== review.inspection.fingerprint || inspection.path !== rollbackPackage.installPath) {
      throw new Error("Rollback extension files changed while permissions were being reviewed");
    }
    let loaded: LoadedExtension | undefined;
    try {
      loaded = await this.#replaceLoadedExtension(install, inspection.path);
      this.#database.saveExtensionInstall(this.#profileId, {
        ...install,
        runtimeId: loaded.id,
        name: inspection.manifest.name,
        version: rollbackPackage.version,
        installPath: rollbackPackage.installPath,
        manifestJson: JSON.stringify(inspection.manifest),
        enabled: true,
      });
    } catch (error) {
      if (loaded && this.#runtime.getExtension(loaded.id)) this.#runtime.removeExtension(loaded.id);
      await this.#restoreAfterFailedReplacement(install);
      throw error;
    }
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

  async remove(id: string): Promise<void> {
    const install = this.#install(id);
    this.#unload(install);
    if (install.source === "gallery" && this.#galleryStore) {
      const packages = this.#database.listExtensionPackages(this.#profileId, id);
      for (const extensionPackage of packages) await this.#galleryStore.removeManagedVersion(extensionPackage.installPath);
      this.#database.deleteExtensionPackages(this.#profileId, id);
    }
    this.#database.deleteExtensionInstall(this.#profileId, id);
  }

  async #replaceLoadedExtension(existing: StoredExtensionInstall | undefined, installPath: string): Promise<LoadedExtension> {
    if (existing) this.#unload(existing);
    return this.#runtime.loadExtension(installPath, { allowFileAccess: false });
  }

  async #restoreAfterFailedReplacement(existing: StoredExtensionInstall | undefined): Promise<void> {
    if (!existing?.installPath) return;
    if (!existing.enabled) {
      this.#database.saveExtensionInstall(this.#profileId, existing);
      return;
    }
    try {
      const loaded = await this.#runtime.loadExtension(existing.installPath, { allowFileAccess: false });
      const { lastError: _lastError, ...cleanInstall } = existing;
      this.#database.saveExtensionInstall(this.#profileId, { ...cleanInstall, runtimeId: loaded.id, enabled: true });
    } catch (restoreError) {
      this.#database.setExtensionLoadState(
        this.#profileId,
        existing.id,
        true,
        existing.runtimeId,
        `Update failed and the previous version could not be restored: ${extensionError(restoreError)}`,
      );
    }
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

function compareExtensionVersions(left: string, right: string): number {
  const [leftRelease, leftPrerelease] = left.split("+", 1)[0]!.split("-", 2);
  const [rightRelease, rightPrerelease] = right.split("+", 1)[0]!.split("-", 2);
  const leftParts = leftRelease!.split(".").map(Number);
  const rightParts = rightRelease!.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  if (leftPrerelease === rightPrerelease) return 0;
  if (leftPrerelease === undefined) return 1;
  if (rightPrerelease === undefined) return -1;
  return leftPrerelease.localeCompare(rightPrerelease, undefined, { numeric: true });
}
