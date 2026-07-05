import { describe, expect, it } from 'vitest';
import { MARKED_POOL, citizenName, markedName } from './names';

describe('citizenName', () => {
  it('is deterministic per seed', () => {
    expect(citizenName(123)).toBe(citizenName(123));
    expect(citizenName(0)).toBe(citizenName(0));
  });

  it('is reddit-handle-ish: adjective_noun', () => {
    for (let s = 0; s < 20; s++) {
      expect(citizenName(s)).toMatch(/^[a-z]+_[a-z]+$/);
    }
  });

  it('varies across seeds', () => {
    const names = new Set<string>();
    for (let s = 0; s < 60; s++) names.add(citizenName(s * 7919 + 3));
    expect(names.size).toBeGreaterThanOrEqual(40);
  });
});

describe('markedName + MARKED_POOL', () => {
  it('covers all three kinds, each entry with a stakes blurb', () => {
    for (const kind of ['person', 'place', 'symbol'] as const) {
      expect(MARKED_POOL.some((e) => e.kind === kind)).toBe(true);
    }
    expect(MARKED_POOL.length).toBeGreaterThanOrEqual(10);
    for (const e of MARKED_POOL) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.blurb.length).toBeGreaterThan(10);
    }
    // ids and names are unique — the no-repeat walk in marked.ts depends on it
    expect(new Set(MARKED_POOL.map((e) => e.id)).size).toBe(MARKED_POOL.length);
    expect(new Set(MARKED_POOL.map((e) => e.name)).size).toBe(MARKED_POOL.length);
  });

  it('is deterministic and honors the requested kind, always in-pool', () => {
    for (let s = 0; s < 30; s++) {
      const picked = markedName(s, 'place');
      expect(picked).toEqual(markedName(s, 'place'));
      expect(picked.kind).toBe('place');
      expect(MARKED_POOL).toContainEqual(picked);
    }
  });

  it('varies across seeds within a kind', () => {
    const names = new Set<string>();
    for (let s = 0; s < 40; s++) names.add(markedName(s * 2654435761 + 1, 'person').name);
    expect(names.size).toBeGreaterThanOrEqual(3);
  });
});
