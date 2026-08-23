const RECOVERY_WINDOW_MS = 60_000;
const MAX_RECOVERIES = 3;

export interface TrustedSurfaceRecoveryDecision {
  crashes: number[];
  recover: boolean;
  delayMs: number;
}

export function trustedSurfaceRecovery(crashes: readonly number[], now: number): TrustedSurfaceRecoveryDecision {
  const recent = crashes.filter((timestamp) => timestamp >= now - RECOVERY_WINDOW_MS);
  recent.push(now);
  return {
    crashes: recent,
    recover: recent.length <= MAX_RECOVERIES,
    delayMs: Math.min(750, recent.length * 150),
  };
}
