import { createHash } from "node:crypto";
import type { BrowserTabState, TabStewardPreviewState, TabStewardSuggestionState } from "../shared/types.js";

const TRACKING_QUERY = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i;
const GENERIC_TERMS = new Set(["www", "home", "page", "new", "tab", "the", "and", "for", "with", "from"]);

export function canonicalBrowserUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return undefined;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (TRACKING_QUERY.test(key)) url.searchParams.delete(key);
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch { return undefined; }
}

export function buildTabStewardPreview(tabs: BrowserTabState[]): TabStewardPreviewState {
  const eligible = tabs.filter((tab) => !tab.private).flatMap((tab) => {
    const canonical = canonicalBrowserUrl(tab.url);
    return canonical ? [{ tab, canonical, terms: titleTerms(tab) }] : [];
  });
  const suggestions: TabStewardSuggestionState[] = [];
  const duplicateGroups = new Map<string, BrowserTabState[]>();
  for (const item of eligible) duplicateGroups.set(item.canonical, [...(duplicateGroups.get(item.canonical) ?? []), item.tab]);
  for (const [canonical, duplicates] of duplicateGroups) {
    if (duplicates.length < 2) continue;
    suggestions.push({
      id: suggestionId("duplicate", duplicates.map((tab) => tab.id)),
      type: "duplicate", title: `Close ${duplicates.length - 1} duplicate ${duplicates.length === 2 ? "tab" : "tabs"}`,
      detail: canonical, tabIds: duplicates.map((tab) => tab.id), confidence: 1,
    });
  }

  const unassigned = eligible.filter((item) => !(duplicateGroups.get(item.canonical)?.length && duplicateGroups.get(item.canonical)!.length > 1));
  const visited = new Set<string>();
  for (const seed of unassigned) {
    if (visited.has(seed.tab.id)) continue;
    const cluster = unassigned.filter((candidate) => similarity(seed, candidate) >= 0.72);
    if (cluster.length < 3) continue;
    for (const item of cluster) visited.add(item.tab.id);
    const confidence = cluster.reduce((total, item) => total + similarity(seed, item), 0) / cluster.length;
    if (confidence < 0.78) continue;
    const groupName = commonGroupName(cluster);
    suggestions.push({
      id: suggestionId("group", cluster.map((item) => item.tab.id)),
      type: "group", title: `Group ${cluster.length} related tabs`, detail: groupName,
      tabIds: cluster.map((item) => item.tab.id), groupName, confidence,
    });
  }
  return { suggestions: suggestions.sort((left, right) => right.confidence - left.confidence), generatedAt: Date.now() };
}

function similarity(left: { canonical: string; terms: Set<string> }, right: { canonical: string; terms: Set<string> }): number {
  const leftUrl = new URL(left.canonical); const rightUrl = new URL(right.canonical);
  const host = leftUrl.hostname === rightUrl.hostname ? 0.65 : 0;
  const union = new Set([...left.terms, ...right.terms]);
  const intersection = [...left.terms].filter((term) => right.terms.has(term)).length;
  return host + (union.size ? intersection / union.size : 0) * 0.35;
}

function titleTerms(tab: BrowserTabState): Set<string> {
  const values = `${tab.title} ${new URL(tab.url).hostname.replace(/^www\./, "")}`.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  return new Set(values.filter((value) => !GENERIC_TERMS.has(value)));
}

function commonGroupName(items: Array<{ tab: BrowserTabState; canonical: string; terms: Set<string> }>): string {
  const counts = new Map<string, number>();
  for (const item of items) for (const term of item.terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  const common = [...counts.entries()].filter(([, count]) => count >= Math.ceil(items.length * 0.6)).sort((a, b) => b[1] - a[1]).map(([term]) => term);
  if (common[0]) return titleCase(common.slice(0, 3).join(" "));
  return titleCase(new URL(items[0]!.canonical).hostname.replace(/^www\./, "").split(".")[0] || "Related tabs");
}

function suggestionId(type: string, tabIds: string[]): string {
  return createHash("sha256").update(`${type}:${[...tabIds].sort().join(":")}`).digest("hex").slice(0, 20);
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 48);
}
