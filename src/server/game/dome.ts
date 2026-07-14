// The protective energy dome (spec: docs/superpowers/plans/2026-07-14-dome-raid.md).
// Pure + deterministic: the raid volley, the segment charge target, the HUD
// energy, and the auto-repair are all derived with no IO so a re-resolution can
// never double-apply. Segment shields are charged by daily challenges (in /init),
// drained by raids (here, at midnight resolve), and mended by the shared shield
// pool (in /action). "Energy" is just the average segment shield — there is no
// separate global energy to keep in sync.
import { BALANCE } from '../../shared/balance';
import { hashString } from '../../shared/rng';

export type Fireball = { power: number; segment: number; blocked: boolean };
export type DomeVolley = { fireballs: Fireball[]; segmentsAfter: number[]; penetrations: number };

const D = BALANCE.dome;

/** Clamp a raw stored segment array to exactly `segments` values in [0, segmentMax]. */
export const normalizeSegments = (raw: readonly (number | undefined)[]): number[] => {
  const out: number[] = [];
  for (let i = 0; i < D.segments; i++) {
    const v = raw[i];
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : D.segmentStart;
    out.push(Math.max(0, Math.min(D.segmentMax, n)));
  }
  return out;
};

/** A fresh dome: every segment at the starting shield. */
export const freshSegments = (): number[] => Array.from({ length: D.segments }, () => D.segmentStart);

/** Dome "energy" for the HUD: the average segment shield as a 0..100 percent. */
export const energyPct = (segments: number[]): number => {
  if (segments.length === 0) return 0;
  const sum = segments.reduce((a, b) => a + b, 0);
  return Math.round((sum / segments.length / D.segmentMax) * 100);
};

/**
 * Index of the most-damaged panel the repair pool should mend, or null if none.
 * "Damaged" means driven BELOW the baseline shield by a raid — daily challenges
 * do the charging from the baseline up to full, so the pool focuses on genuine
 * raid damage and a fresh dome reports nothing to mend.
 */
export const mostDamagedSegment = (segments: number[]): number | null => {
  let best = -1;
  let bestVal: number = D.segmentStart;
  for (let i = 0; i < segments.length; i++) {
    const v = segments[i]!;
    if (v < bestVal) {
      bestVal = v;
      best = i;
    }
  }
  return best >= 0 ? best : null;
};

/** Which segment a player's daily-challenge completion reinforces (deterministic). */
export const chargeSegmentIndex = (userId: string, day: number, worldSeed: number): number =>
  hashString(`${userId}:${day}:${worldSeed}:dome`) % D.segments;

/**
 * Resolve a raid volley deterministically. `seed` derives the fireball count,
 * each fireball's target segment and its rolled power. A fireball is BLOCKED when
 * its power is at or below the panel's shield AS IT ENTERED THE RAID (so a fully
 * charged dome always holds this raid, no matter how the volley clusters);
 * otherwise it PENETRATES. Blocked hits still wear the panel down (`blockDrain`)
 * for the NEXT raid. Pure: `segments` is never mutated; `segmentsAfter` is a fresh
 * clamped copy reflecting the wear.
 */
export const resolveVolley = (seed: number, segments: number[]): DomeVolley => {
  const entry = normalizeSegments(segments);
  const after = [...entry];
  let state = hashString(`${seed}:domevolley`) >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const span = D.fireballs.max - D.fireballs.min + 1;
  const count = D.fireballs.min + Math.floor(next() * span);
  const powerSpan = D.power.max - D.power.min + 1;
  const fireballs: Fireball[] = [];
  let penetrations = 0;
  for (let i = 0; i < count; i++) {
    const segment = Math.min(D.segments - 1, Math.floor(next() * D.segments));
    const power = D.power.min + Math.floor(next() * powerSpan);
    const blocked = power <= entry[segment]!;
    if (blocked) {
      after[segment] = Math.max(0, after[segment]! - D.blockDrain);
    } else {
      penetrations++;
    }
    fireballs.push({ power, segment, blocked });
  }
  return { fireballs, segmentsAfter: after, penetrations };
};

/**
 * Auto-repair: while the shared shield pool can afford a repair and a damaged
 * segment exists, fully restore the most-damaged segment. Pure — returns fresh
 * arrays plus the segment indices repaired, in the order they were mended.
 */
export const applyRepairs = (
  segments: number[],
  pool: number,
): { segments: number[]; pool: number; repaired: number[] } => {
  const out = normalizeSegments(segments);
  let remaining = Math.max(0, Math.floor(Number.isFinite(pool) ? pool : 0));
  const repaired: number[] = [];
  // Bounded by segment count: each repair fully restores exactly one panel.
  for (let guard = 0; guard < out.length; guard++) {
    if (remaining < D.repairThreshold) break;
    const target = mostDamagedSegment(out);
    if (target === null) break;
    out[target] = D.segmentMax;
    remaining -= D.repairThreshold;
    repaired.push(target);
  }
  return { segments: out, pool: remaining, repaired };
};
