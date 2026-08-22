import type { TabAccessGrant, TabAccessLevel } from "@locus/protocol";

const protectedProtocols = new Set(["file:", "chrome:", "devtools:", "chrome-extension:", "locus:"]);
const protectedHosts = new Set(["settings", "passwords", "extensions"]);

export class TabAccessRegistry {
  readonly #grants = new Map<string, Map<string, TabAccessGrant>>();

  grant(
    sessionId: string,
    tabId: string,
    level: TabAccessLevel,
    source: TabAccessGrant["source"],
  ): TabAccessGrant {
    const grant: TabAccessGrant = {
      sessionId,
      tabId,
      level,
      source,
      grantedAt: new Date().toISOString(),
    };
    const sessionGrants = this.#grants.get(sessionId) ?? new Map<string, TabAccessGrant>();
    sessionGrants.set(tabId, grant);
    this.#grants.set(sessionId, sessionGrants);
    return grant;
  }

  revoke(sessionId: string, tabId: string): boolean {
    const sessionGrants = this.#grants.get(sessionId);
    if (!sessionGrants) return false;
    const removed = sessionGrants.delete(tabId);
    if (sessionGrants.size === 0) this.#grants.delete(sessionId);
    return removed;
  }

  revokeSession(sessionId: string): void {
    this.#grants.delete(sessionId);
  }

  grantsForSession(sessionId: string): TabAccessGrant[] {
    return [...(this.#grants.get(sessionId)?.values() ?? [])];
  }

  grantsForTab(tabId: string): TabAccessGrant[] {
    const result: TabAccessGrant[] = [];
    for (const grants of this.#grants.values()) {
      const grant = grants.get(tabId);
      if (grant) result.push(grant);
    }
    return result;
  }

  access(sessionId: string, tabId: string): TabAccessGrant | undefined {
    return this.#grants.get(sessionId)?.get(tabId);
  }

  can(sessionId: string, tabId: string, level: TabAccessLevel): boolean {
    const grant = this.access(sessionId, tabId);
    if (!grant) return false;
    return level === "read" || grant.level === "interact";
  }

  static isProtectedUrl(rawUrl: string, isPrivate: boolean): boolean {
    if (isPrivate) return true;
    try {
      const url = new URL(rawUrl);
      return protectedProtocols.has(url.protocol) || protectedHosts.has(url.hostname);
    } catch {
      return true;
    }
  }
}
