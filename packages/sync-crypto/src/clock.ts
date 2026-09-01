export class HybridLogicalClock {
  #physical = 0;
  #logical = 0;

  constructor(readonly deviceId: string) {}

  tick(now = Date.now()): string {
    if (now > this.#physical) {
      this.#physical = now;
      this.#logical = 0;
    } else {
      this.#logical += 1;
    }
    return formatClock(this.#physical, this.#logical, this.deviceId);
  }

  observe(remote: string, now = Date.now()): string {
    const parsed = parseClock(remote);
    const maximum = Math.max(now, this.#physical, parsed.physical);
    if (maximum === this.#physical && maximum === parsed.physical) this.#logical = Math.max(this.#logical, parsed.logical) + 1;
    else if (maximum === this.#physical) this.#logical += 1;
    else if (maximum === parsed.physical) this.#logical = parsed.logical + 1;
    else this.#logical = 0;
    this.#physical = maximum;
    return formatClock(this.#physical, this.#logical, this.deviceId);
  }
}

export function compareClocks(left: string, right: string): number {
  return left.localeCompare(right);
}

export function mergePerField<T extends Record<string, { value: unknown; clock: string }>>(left: T, right: T): T {
  const result = { ...left };
  for (const [field, candidate] of Object.entries(right)) {
    const existing = result[field];
    if (!existing || compareClocks(candidate.clock, existing.clock) > 0) result[field as keyof T] = candidate as T[keyof T];
  }
  return result;
}

function formatClock(physical: number, logical: number, deviceId: string): string {
  return `${Math.max(physical, 0).toString().padStart(13, "0")}-${Math.max(logical, 0).toString().padStart(6, "0")}-${deviceId}`;
}

function parseClock(value: string): { physical: number; logical: number } {
  const match = /^(\d{13})-(\d{6})-[A-Za-z0-9_-]+$/.exec(value);
  if (!match) throw new Error("Malformed hybrid logical clock");
  return { physical: Number(match[1]), logical: Number(match[2]) };
}
