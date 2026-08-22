export interface TabSleepCandidate {
  active: boolean;
  sleeping: boolean;
  loading: boolean;
  audible: boolean;
  mediaPlaying: boolean;
  granted: boolean;
  downloading: boolean;
}

export function canSleepTab(candidate: TabSleepCandidate): boolean {
  return !candidate.active
    && !candidate.sleeping
    && !candidate.loading
    && !candidate.audible
    && !candidate.mediaPlaying
    && !candidate.granted
    && !candidate.downloading;
}

export function shouldSleepTab(
  candidate: TabSleepCandidate & { lastActiveAt: number },
  now: number,
  afterMinutes: 0 | 15 | 30 | 60,
): boolean {
  return afterMinutes > 0
    && candidate.lastActiveAt <= now - afterMinutes * 60_000
    && canSleepTab(candidate);
}
