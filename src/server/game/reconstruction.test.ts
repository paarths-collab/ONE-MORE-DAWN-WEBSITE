import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../shared/balance';
import {
  damagedHouses,
  laborForStatus,
  nextRebuildTarget,
  reconstructionQueue,
  reconstructionState,
  selectRaidDamage,
  type HouseRow,
} from './reconstruction';

const rows = (n: number): HouseRow[] =>
  Array.from({ length: n }, (_, i) => ({ userId: `t2_${i}`, index: i, username: `u${i}` }));

describe('selectRaidDamage', () => {
  it('picks counts within the balance range for the outcome', () => {
    const indices = rows(10).map((r) => r.index);
    for (const seed of [1, 7, 42, 999, 12345]) {
      const breach = selectRaidDamage(indices, 'breach', seed);
      const [dLo, dHi] = BALANCE.reconstruction.select.breach.destroy;
      const [gLo, gHi] = BALANCE.reconstruction.select.breach.damage;
      expect(breach.destroy.length).toBeGreaterThanOrEqual(dLo);
      expect(breach.destroy.length).toBeLessThanOrEqual(dHi);
      expect(breach.damage.length).toBeGreaterThanOrEqual(gLo);
      expect(breach.damage.length).toBeLessThanOrEqual(gHi);
      // destroy and damage never overlap
      expect(breach.destroy.filter((i) => breach.damage.includes(i))).toEqual([]);
    }
  });

  it('held never destroys a home', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(selectRaidDamage(rows(8).map((r) => r.index), 'held', seed).destroy).toEqual([]);
    }
  });

  it('spares the founder (index 0) from destruction', () => {
    const indices = rows(6).map((r) => r.index);
    for (const seed of [1, 5, 9, 20, 33, 77]) {
      expect(selectRaidDamage(indices, 'fallen', seed).destroy).not.toContain(0);
    }
  });

  it('is deterministic for the same seed and inputs', () => {
    const indices = rows(12).map((r) => r.index);
    const a = selectRaidDamage(indices, 'breach', 4242);
    const b = selectRaidDamage(indices, 'breach', 4242);
    expect(a).toEqual(b);
  });

  it('handles a city with no houses', () => {
    expect(selectRaidDamage([], 'breach', 1)).toEqual({ destroy: [], damage: [] });
  });
});

describe('reconstruction queue + state', () => {
  const base = rows(4);
  const damage = { t2_1: 'destroyed' as const, t2_3: 'damaged' as const };

  it('orders the queue by house index and derives labor needs', () => {
    const q = reconstructionQueue(base, damage, {});
    expect(q.map((i) => i.index)).toEqual([1, 3]);
    expect(q[0]).toMatchObject({ status: 'destroyed', needed: BALANCE.reconstruction.laborPerDestroyed, done: 0 });
    expect(q[1]).toMatchObject({ status: 'damaged', needed: BALANCE.reconstruction.laborPerDamaged, done: 0 });
  });

  it('drops a home from the queue once its labor is met (restored)', () => {
    const progress = { t2_1: BALANCE.reconstruction.laborPerDestroyed };
    const q = reconstructionQueue(base, damage, progress);
    expect(q.map((i) => i.index)).toEqual([3]); // t2_1 restored, only the damaged home remains
    expect(nextRebuildTarget(base, damage, progress)?.index).toBe(3);
    expect(damagedHouses(base, damage, progress).map((d) => d.index)).toEqual([3]);
  });

  it('computes required/contributed and the active flag', () => {
    const progress = { t2_1: 4 };
    const s = reconstructionState(base, damage, progress);
    expect(s.active).toBe(true);
    expect(s.required).toBe(BALANCE.reconstruction.laborPerDestroyed + BALANCE.reconstruction.laborPerDamaged);
    expect(s.contributed).toBe(4);
    expect(s.destroyed).toBe(1);
    expect(s.damaged).toBe(1);
    expect(s.next).toMatchObject({ username: 'u1', index: 1, status: 'destroyed', done: 4 });
  });

  it('reports inactive with no damage', () => {
    const s = reconstructionState(base, {}, {});
    expect(s).toEqual({ active: false, required: 0, contributed: 0, destroyed: 0, damaged: 0, next: null });
    expect(damagedHouses(base, {}, {})).toEqual([]);
    expect(nextRebuildTarget(base, {}, {})).toBeNull();
  });
});

describe('laborForStatus', () => {
  it('maps status to its labor cost', () => {
    expect(laborForStatus('destroyed')).toBe(BALANCE.reconstruction.laborPerDestroyed);
    expect(laborForStatus('damaged')).toBe(BALANCE.reconstruction.laborPerDamaged);
    expect(laborForStatus('standing')).toBe(0);
  });
});
