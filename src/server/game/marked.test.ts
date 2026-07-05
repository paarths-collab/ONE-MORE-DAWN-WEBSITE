import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../shared/balance';
import { MARKED_POOL } from '../../shared/names';
import { markedGoal, pickMarked } from './marked';

describe('pickMarked', () => {
  it('is deterministic per (worldSeed, cycle, day, actives)', () => {
    expect(pickMarked(42, 1, 5, 3)).toEqual(pickMarked(42, 1, 5, 3));
    expect(pickMarked(0, 2, 17)).toEqual(pickMarked(0, 2, 17));
  });

  it('draws from the shared pool with matching kind/blurb and fresh counters', () => {
    for (let day = 1; day <= 20; day++) {
      const m = pickMarked(7, 1, day);
      const entry = MARKED_POOL.find((e) => e.name === m.name);
      expect(entry).toBeDefined();
      expect(m.kind).toBe(entry!.kind);
      expect(m.blurb).toBe(entry!.blurb);
      expect(m.id).toBe(`${entry!.id}-c1-d${day}`);
      expect(m.pledged).toBe(0);
      expect(m.unit).toBe('resolve');
      expect(m.savedYesterday).toBeNull();
    }
  });

  it('varies across days and across world seeds', () => {
    const acrossDays = new Set<string>();
    for (let day = 1; day <= 12; day++) acrossDays.add(pickMarked(42, 1, day).name);
    expect(acrossDays.size).toBeGreaterThanOrEqual(5);

    const acrossWorlds = new Set<string>();
    for (let ws = 1; ws <= 20; ws++) acrossWorlds.add(pickMarked(ws, 1, 3).name);
    expect(acrossWorlds.size).toBeGreaterThanOrEqual(3);
  });

  it('never marks the same objective on consecutive days', () => {
    for (const ws of [1, 7, 99, 12345]) {
      let prev = '';
      for (let day = 1; day <= 40; day++) {
        const name = pickMarked(ws, 1, day).name;
        expect(name).not.toBe(prev);
        prev = name;
      }
    }
  });

  it('goal scales with active players and caps at goalMax', () => {
    expect(markedGoal(0)).toBe(BALANCE.marked.goalBase);
    expect(markedGoal(5)).toBe(
      BALANCE.marked.goalBase + Math.ceil(5 * BALANCE.marked.goalPerActivePlayer),
    );
    expect(markedGoal(10)).toBeGreaterThan(markedGoal(5));
    expect(markedGoal(10_000)).toBe(BALANCE.marked.goalMax);
    expect(markedGoal(-5)).toBe(BALANCE.marked.goalBase); // defensive clamp
    expect(pickMarked(42, 1, 5, 5).goal).toBe(markedGoal(5));
  });
});
