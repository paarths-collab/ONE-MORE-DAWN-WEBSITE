import { describe, expect, it } from 'vitest';
import { CRISES, getCrisis, pickNextCrisis } from './crises';
import type { CityState } from './types';

const baseCity: CityState = {
  day: 3, cycle: 1, status: 'alive',
  population: 120, food: 60, power: 55, medicine: 20,
  morale: 60, threat: 30, defense: 40,
  crisisId: 'first_light', activeLaw: null, lawExpiresDay: 0,
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
});
