import type { Clock } from '../ports/clock.js';

/** Format epoch-ms as an ISO-8601 string. */
export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Format nullable epoch-ms as ISO-8601, preserving null. */
export function toIsoOrNull(ms: number | null): string | null {
  return ms === null ? null : toIso(ms);
}

/** Current time as ISO-8601, sourced from a Clock (test-friendly). */
export function nowIso(clock: Clock): string {
  return toIso(clock.now());
}
