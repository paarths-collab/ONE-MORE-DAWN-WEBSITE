import { BALANCE } from '../../shared/balance';
import { hashString } from '../../shared/rng';
import type { DamagedHouse, HouseStatus, ReconstructionState } from '../../shared/types';

export type HouseRow = { userId: string; index: number; username: string };
type DamageMap = Record<string, 'destroyed' | 'damaged'>;
type ProgressMap = Record<string, number>;

type QueueItem = { userId: string; index: number; username: string; status: 'destroyed' | 'damaged'; done: number; needed: number };

/** Ordered (by house index) list of homes still needing labor. */
export const reconstructionQueue = (rows: HouseRow[], damage: DamageMap, progress: ProgressMap): QueueItem[] =>
  rows
    .filter((r) => damage[r.userId] === 'destroyed' || damage[r.userId] === 'damaged')
    .map((r) => {
      const status = damage[r.userId]!;
      const needed = laborForStatus(status);
      const done = Math.min(needed, progress[r.userId] ?? 0);
      return { userId: r.userId, index: r.index, username: r.username, status, done, needed };
    })
    .filter((item) => item.done < item.needed) // restored homes drop out of the queue
    .sort((a, b) => a.index - b.index);

/** The next home the city's labor should rebuild, or null when the queue is clear. */
export const nextRebuildTarget = (rows: HouseRow[], damage: DamageMap, progress: ProgressMap): QueueItem | null =>
  reconstructionQueue(rows, damage, progress)[0] ?? null;

/** Wire view of the whole shared rebuild effort. */
export const reconstructionState = (rows: HouseRow[], damage: DamageMap, progress: ProgressMap): ReconstructionState => {
  const queue = reconstructionQueue(rows, damage, progress);
  const required = queue.reduce((sum, i) => sum + i.needed, 0);
  const contributed = queue.reduce((sum, i) => sum + i.done, 0);
  const next = queue[0];
  return {
    active: queue.length > 0,
    required,
    contributed,
    destroyed: queue.filter((i) => i.status === 'destroyed').length,
    damaged: queue.filter((i) => i.status === 'damaged').length,
    next: next
      ? { username: next.username, index: next.index, status: next.status, done: next.done, needed: next.needed }
      : null,
  };
};

/** Homes still showing as ruins in the scene (damaged/destroyed, not yet restored). */
export const damagedHouses = (rows: HouseRow[], damage: DamageMap, progress: ProgressMap): DamagedHouse[] =>
  reconstructionQueue(rows, damage, progress).map((i) => ({ index: i.index, username: i.username, status: i.status }));

/** A raid classifies into one of these; the resolver decides, we apply. */
export type RaidOutcome = 'held' | 'breach' | 'fallen';

export type RaidDamage = { destroy: number[]; damage: number[] }; // house indices

/**
 * Deterministically choose which houses a raid destroys/damages. Pure and
 * seeded (same seed -> same picks) so a re-resolution can never double-apply.
 * The founder house (index 0) is spared destruction so the city keeps its
 * origin landmark; it can still be lightly damaged when no other target exists.
 * Never personally targeted: picks are seeded-random across the house list.
 */
export const selectRaidDamage = (
  houseIndices: number[],
  outcome: RaidOutcome,
  seed: number,
): RaidDamage => {
  const cfg = BALANCE.reconstruction.select[outcome];
  const indices = [...new Set(houseIndices)].filter((i) => Number.isInteger(i) && i >= 0).sort((a, b) => a - b);
  if (indices.length === 0) return { destroy: [], damage: [] };

  // A small deterministic PRNG stream off the seed.
  let state = hashString(`${seed}:raiddmg:${outcome}`) >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const pickCount = ([lo, hi]: readonly [number, number] | number[]) =>
    Math.min(indices.length, lo + Math.floor(next() * (hi - lo + 1)));

  // Destroy targets: exclude the founder (index 0); shuffle the rest, take N.
  const destroyable = indices.filter((i) => i !== 0);
  const shuffled = [...destroyable];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const destroy = shuffled.slice(0, pickCount(cfg.destroy)).sort((a, b) => a - b);

  // Damage targets: from the remaining houses (founder may be damaged), take N.
  const remaining = indices.filter((i) => !destroy.includes(i));
  const shuffledDmg = [...remaining];
  for (let i = shuffledDmg.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [shuffledDmg[i], shuffledDmg[j]] = [shuffledDmg[j]!, shuffledDmg[i]!];
  }
  const damage = shuffledDmg.slice(0, pickCount(cfg.damage)).sort((a, b) => a - b);

  return { destroy, damage };
};

/** Labor a given house status needs to be fully restored. */
export const laborForStatus = (status: HouseStatus): number =>
  status === 'destroyed'
    ? BALANCE.reconstruction.laborPerDestroyed
    : status === 'damaged'
      ? BALANCE.reconstruction.laborPerDamaged
      : 0;
