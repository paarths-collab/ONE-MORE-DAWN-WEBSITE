import { describe, expect, it } from 'vitest';
import { CRISES, getCrisis, pickNextCrisis } from './crises';
import type { CityState } from './types';

const baseCity: CityState = {
  day: 3, cycle: 1, status: 'alive', worldSeed: 0, trait: 'standard',
  population: 120, food: 60, power: 55, medicine: 20,
  morale: 60, threat: 30, defense: 40,
  crisisId: 'first_light', activeLaw: null, lawExpiresDay: 0,
  cityLevel: 0, buildProgress: 0, unlockedBuildings: [],
};

describe('crisis pool', () => {
  it('every crisis has 2-3 options with unique ids', () => {
    for (const crisis of CRISES) {
      expect(crisis.options.length).toBeGreaterThanOrEqual(2);
      expect(crisis.options.length).toBeLessThanOrEqual(3);
      const ids = crisis.options.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('getCrisis returns the crisis or falls back to first_light', () => {
    expect(getCrisis('refugee_convoy').id).toBe('refugee_convoy');
    expect(getCrisis('nonexistent').id).toBe('first_light');
  });

  it('pickNextCrisis is deterministic and never repeats the current crisis', () => {
    const a = pickNextCrisis(baseCity);
    const b = pickNextCrisis(baseCity);
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(baseCity.crisisId);
  });

  it('hunger crisis only enters the pool when food is low', () => {
    const starving = { ...baseCity, food: 5, day: 9 };
    const picked: string[] = [];
    for (let d = 0; d < 20; d++) {
      picked.push(pickNextCrisis({ ...starving, day: starving.day + d }).id);
    }
    expect(picked).toContain('ration_riots');
    const fed = { ...baseCity, food: 60 };
    for (let d = 0; d < 20; d++) {
      expect(pickNextCrisis({ ...fed, day: fed.day + d }).id).not.toBe('ration_riots');
    }
  });

  it('day-zero crisis exists', () => {
    expect(CRISES.some((c) => c.id === 'first_light')).toBe(true);
  });

  it('different worldSeeds diverge within a 10-day window on the same (day, cycle)', () => {
    // W1: two installations must not live near-identical early games. At least
    // one day in the window must pick a different crisis across worlds.
    const worldA = { ...baseCity, worldSeed: 111111 };
    const worldB = { ...baseCity, worldSeed: 222222 };
    let diverged = false;
    for (let d = 0; d < 10; d++) {
      const a = pickNextCrisis({ ...worldA, day: worldA.day + d });
      const b = pickNextCrisis({ ...worldB, day: worldB.day + d });
      if (a.id !== b.id) diverged = true;
    }
    expect(diverged).toBe(true);
  });

  it('covers every healthy-city crisis over a long run (no short-orbit lock-in)', () => {
    // Audit finding: the old linear-stride picker degenerated to a 3-crisis
    // loop in the healthy case. The seeded picker must cover every crisis
    // eligible under healthy conditions across a 60-day window.
    const healthy = { ...baseCity, food: 60, morale: 60 };
    const seen = new Set<string>();
    let city = { ...healthy };
    for (let d = 0; d < 60; d++) {
      const next = pickNextCrisis({ ...city, day: healthy.day + d });
      seen.add(next.id);
      city = { ...city, crisisId: next.id };
    }
    for (const id of ['first_light', 'refugee_convoy', 'blackout_ward', 'strange_signal']) {
      expect(seen).toContain(id);
    }
  });
});
