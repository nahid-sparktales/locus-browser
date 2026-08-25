import type { BrowserObservationContext } from "@locus/protocol";

export interface SharedBrowserTab {
  id: string;
  title: string;
  url: string;
  accessLevel: "read" | "interact";
}

export function sharedBrowserContext(
  tab: SharedBrowserTab,
  pageText: string,
  capturedAt = new Date(),
): BrowserObservationContext {
  return {
    recording_id: `shared-tab-${tab.id}`.slice(0, 255),
    captured_at: capturedAt.toISOString(),
    active_tab: {
      id: tab.id,
      title: tab.title.slice(0, 2_048),
      url: tab.url.slice(0, 8_192),
      access_level: tab.accessLevel,
    },
    transcript: [],
    ...(pageText ? { page_text: pageText.slice(0, 12_000) } : {}),
    frames: [],
  };
}

export function referencesCurrentPage(text: string): boolean {
  if (/https?:\/\//i.test(text)) return false;
  return /\b(?:this\s+(?:page|tab|site|website|article)|(?:the\s+)?current\s+(?:page|tab|website|article)|(?:the\s+)?open\s+(?:page|tab|website|article))\b/i.test(text)
    || /\b(?:summari[sz]e|read|explain|analy[sz]e|review)\s+(?:this\s+|the\s+)?page\b/i.test(text);
}
