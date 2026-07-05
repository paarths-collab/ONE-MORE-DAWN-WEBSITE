import { BALANCE } from '../../shared/balance';
import { MARKED_POOL, markedName, type MarkedPoolEntry } from '../../shared/names';
import { hashString, makeRng } from '../../shared/rng';
import type { Marked } from '../../shared/types';

/**
 * The Marked (hook layer, Plan 1): a provably-fair daily objective picked from
 * the shared pool. Pure logic — same (worldSeed, cycle, day) always yields the
 * same objective, so /init, /pledge, and the dawn resolver all agree without
 * storing the pick. Same seeded-picker family as crises and mission layouts.
 */

const markedSeed = (worldSeed: number, cycle: number, day: number): number =>
  hashString(`marked:${worldSeed}:c${cycle}:d${day}`);

/**
 * Goal formula (BALANCE.marked): scales with active players so a 3-player sub
 * and a 30-player sub both face a reachable-but-real target. `activePlayers`
 * must be YESTERDAY's action-taker count — frozen once the day starts, so the
 * goal never moves between /init display and dawn judgement.
 */
export const markedGoal = (activePlayers: number): number =>
  Math.min(
    BALANCE.marked.goalMax,
    BALANCE.marked.goalBase +
      Math.ceil(Math.max(0, activePlayers) * BALANCE.marked.goalPerActivePlayer),
  );

/** Raw daily pick: weighted kind roll, then a name from that kind's pool. */
const rawEntry = (worldSeed: number, cycle: number, day: number): MarkedPoolEntry => {
  const seed = markedSeed(worldSeed, cycle, day);
  const kind = makeRng(seed).pick(BALANCE.marked.kindWeights);
  // Salt the name seed so the kind roll and the name roll decorrelate.
  return markedName(hashString(`name:${seed}`), kind);
};

/**
 * Final entry for a day: replays the raw picks from day 1 and shifts any pick
 * that would repeat the previous day's objective to the next pool entry. The
 * walk is O(day) hash+rng steps (microseconds) and guarantees no two
 * consecutive days ever mark the same objective.
 */
const finalEntry = (worldSeed: number, cycle: number, day: number): MarkedPoolEntry => {
  let prev: string | null = null;
  let entry: MarkedPoolEntry = MARKED_POOL[0]!;
  for (let d = 1; d <= day; d++) {
    entry = rawEntry(worldSeed, cycle, d);
    if (entry.id === prev) {
      const idx = MARKED_POOL.findIndex((e) => e.id === entry.id);
      entry = MARKED_POOL[(idx + 1) % MARKED_POOL.length]!;
    }
    prev = entry.id;
  }
  return entry;
};

/**
 * Today's Marked. `pledged` starts 0 (live counter rides in Redis) and
 * `savedYesterday` starts null (the store's outcome record fills it).
 */
export const pickMarked = (
  worldSeed: number,
  cycle: number,
  day: number,
  activePlayers = 0,
): Marked => {
  const entry = finalEntry(worldSeed, cycle, Math.max(1, day));
  return {
    id: `${entry.id}-c${cycle}-d${day}`,
    name: entry.name,
    kind: entry.kind,
    blurb: entry.blurb,
    goal: markedGoal(activePlayers),
    pledged: 0,
    unit: 'resolve',
    savedYesterday: null,
  };
};
