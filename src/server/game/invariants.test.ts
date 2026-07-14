import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../shared/balance';
import type { CityState } from '../../shared/types';
import {
  assertCityInvariants,
  assertResolveInvariants,
  checkCityInvariants,
  checkResolveInvariants,
} from './invariants';
import { newCityState, resolveDay, type DayInputs, type ResolveResult } from './resolver';

const emptyInputs = (): DayInputs => ({
  actions: {},
  missions: {},
  crisisVotes: {},
  strategyVotes: {},
  roleCounts: {},
  activeUserCount: 0,
  factionInfluence: {},
  markedPledged: 0,
  pledges: {},
  markedActivePlayers: 0,
  dome: [0, 0, 0, 0, 0, 0],
});

describe('checkCityInvariants — valid states pass', () => {
  it('a freshly created city is valid for every trait/world seed', () => {
    for (const seed of [0, 1, 42, 123456, 999999]) {
      for (let cycle = 1; cycle <= 3; cycle++) {
        expect(checkCityInvariants(newCityState(cycle, seed))).toEqual([]);
      }
    }
  });

  it('a resolved city (one full day from fresh) is valid', () => {
    const city = newCityState(1);
    const { city: next } = resolveDay(city, emptyInputs());
    expect(checkCityInvariants(next)).toEqual([]);
  });
});

describe('checkCityInvariants — each violation is actually caught', () => {
  const base = (): CityState => newCityState(1);

  it('flags a negative stock (food below 0)', () => {
    const v = checkCityInvariants({ ...base(), food: -1 });
    expect(v.some((m) => /food/.test(m))).toBe(true);
  });

  it('flags a stock above its store cap (food > 300)', () => {
    const v = checkCityInvariants({ ...base(), food: BALANCE.scaling.foodStoreCap + 1 });
    expect(v.some((m) => /food.*above max/.test(m))).toBe(true);
  });

  it('flags medicine above its store cap (> 120)', () => {
    const v = checkCityInvariants({ ...base(), medicine: BALANCE.scaling.medicineStoreCap + 5 });
    expect(v.some((m) => /medicine.*above max/.test(m))).toBe(true);
  });

  it('flags a percentage vital out of 0..100 (threat = 101)', () => {
    expect(checkCityInvariants({ ...base(), threat: 101 }).some((m) => /threat/.test(m))).toBe(true);
    expect(checkCityInvariants({ ...base(), morale: -1 }).some((m) => /morale/.test(m))).toBe(true);
    expect(checkCityInvariants({ ...base(), power: 100.5 }).some((m) => /power/.test(m))).toBe(true);
    expect(checkCityInvariants({ ...base(), defense: 200 }).some((m) => /defense/.test(m))).toBe(true);
  });

  it('flags NaN and Infinity', () => {
    expect(checkCityInvariants({ ...base(), food: NaN }).some((m) => /food.*finite/.test(m))).toBe(true);
    expect(checkCityInvariants({ ...base(), power: Infinity }).some((m) => /power/.test(m))).toBe(true);
  });

  it('flags a non-integer vital', () => {
    expect(checkCityInvariants({ ...base(), population: 12.5 }).some((m) => /population.*integer/.test(m))).toBe(
      true,
    );
  });

  it('flags day/cycle below 1', () => {
    expect(checkCityInvariants({ ...base(), day: 0 }).some((m) => /day/.test(m))).toBe(true);
    expect(checkCityInvariants({ ...base(), cycle: 0 }).some((m) => /cycle/.test(m))).toBe(true);
  });

  it('flags an empty crisisId', () => {
    expect(checkCityInvariants({ ...base(), crisisId: '' }).some((m) => /crisisId/.test(m))).toBe(true);
  });

  it('flags an invalid status / trait / activeLaw', () => {
    expect(
      checkCityInvariants({ ...base(), status: 'zombie' as CityState['status'] }).some((m) => /status/.test(m)),
    ).toBe(true);
    expect(
      checkCityInvariants({ ...base(), trait: 'cursed' as CityState['trait'] }).some((m) => /trait/.test(m)),
    ).toBe(true);
    expect(
      checkCityInvariants({ ...base(), activeLaw: 'wizards' as CityState['activeLaw'] }).some((m) =>
        /activeLaw/.test(m),
      ),
    ).toBe(true);
  });

  it('flags an ALIVE city at/below the fall threshold (the key cross-field rule)', () => {
    const v = checkCityInvariants({
      ...base(),
      status: 'alive',
      population: BALANCE.fall.populationThreshold,
    });
    expect(v.some((m) => /fall threshold/.test(m))).toBe(true);
  });

  it('does NOT flag a FALLEN city at/below the fall threshold (that is legal)', () => {
    const v = checkCityInvariants({
      ...base(),
      status: 'fallen',
      population: BALANCE.fall.populationThreshold,
    });
    expect(v).toEqual([]);
  });
});

describe('assertCityInvariants', () => {
  it('does not throw on a valid city', () => {
    expect(() => assertCityInvariants(newCityState(1))).not.toThrow();
  });
  it('throws with a descriptive message on an invalid city', () => {
    expect(() => assertCityInvariants({ ...newCityState(1), food: -5 }, 'unit')).toThrow(/unit.*food/);
  });
});

describe('checkResolveInvariants — the transition rules', () => {
  it('a real resolveDay transition satisfies every resolve invariant', () => {
    const city = newCityState(1);
    const result = resolveDay(city, emptyInputs());
    expect(checkResolveInvariants(city, result)).toEqual([]);
    expect(() => assertResolveInvariants(city, result)).not.toThrow();
  });

  it('catches a day that does not advance by exactly 1', () => {
    const city = newCityState(1);
    const result = resolveDay(city, emptyInputs());
    // forge a bad result: day jumped by 2
    const bad: ResolveResult = { ...result, city: { ...result.city, day: city.day + 2 } };
    expect(checkResolveInvariants(city, bad).some((m) => /exactly 1/.test(m))).toBe(true);
  });

  it('catches a cycle / worldSeed / trait mutation during resolve', () => {
    const city = newCityState(1, 777);
    const result = resolveDay(city, emptyInputs());
    expect(
      checkResolveInvariants(city, {
        ...result,
        city: { ...result.city, cycle: city.cycle + 1 },
      }).some((m) => /cycle changed/.test(m)),
    ).toBe(true);
    expect(
      checkResolveInvariants(city, {
        ...result,
        city: { ...result.city, worldSeed: city.worldSeed + 1 },
      }).some((m) => /worldSeed changed/.test(m)),
    ).toBe(true);
  });

  it('catches a timeline entry that describes the wrong day', () => {
    const city = newCityState(1);
    const result = resolveDay(city, emptyInputs());
    const bad: ResolveResult = { ...result, entry: { ...result.entry, day: city.day + 5 } };
    expect(checkResolveInvariants(city, bad).some((m) => /timeline entry day/.test(m))).toBe(true);
  });
});
