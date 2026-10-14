import type { DocumentVersion } from '@workspace/domain';

/**
 * The history list, newest first.
 *
 * Sorting here rather than trusting the caller: the panel is fed by whoever
 * hosts it, and a list that arrives oldest-first would silently read as "the
 * newest version is at the bottom" — the one ordering a history panel must
 * never get wrong. Copies rather than sorting in place, so the caller's array
 * is not rearranged underneath it.
 */
export function newestFirst(versions: DocumentVersion[]): DocumentVersion[] {
  return [...versions].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
}

/**
 * How long ago a version was marked, as a unit and a count.
 *
 * Returned as data rather than as a formatted string so the panel stays
 * i18n-free: the host turns this into words through its catalog, the same
 * way it resolves every other label.
 */
export type VersionAge =
  { unit: 'now' } | { unit: 'minutes' | 'hours' | 'days'; count: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function versionAge(at: Date, now: Date): VersionAge {
  // A clock that ran backwards (a version marked on another device, a system
  // clock corrected between the two reads) reads as "now" rather than as a
  // negative age.
  const elapsed = Math.max(0, now.getTime() - at.getTime());
  if (elapsed < MINUTE) return { unit: 'now' };
  if (elapsed < HOUR)
    return { unit: 'minutes', count: Math.floor(elapsed / MINUTE) };
  if (elapsed < DAY)
    return { unit: 'hours', count: Math.floor(elapsed / HOUR) };
  return { unit: 'days', count: Math.floor(elapsed / DAY) };
}
