import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../shared/balance';
import { makeRng } from '../../shared/rng';
import type { CityState } from '../../shared/types';
import { checkCityInvariants } from './invariants';
import { runLazyResolution } from './lazyResolve';
import { newCityState, resolveDay, type DayInputs } from './resolver';
import { Store } from '../storage/store';
import { makeFakeRedis } from '../storage/store.test';

/**
 * Scenario matrix + simulations. The property tests (resolver.property.test.ts)
 * prove the game NEVER reaches an invalid state. These prove it behaves the way
 * it is SUPPOSED to in the situations that matter: decline under no play, the
 * effect of each action, the penalty thresholds firing, deterministic
 * tie-breaks, the fall transition, and that balanced play meaningfully beats
 * zero play. Two layers: "can't break" + "behaves intentionally".
 */

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
});

const withInputs = (over: Partial<DayInputs>): DayInputs => ({ ...emptyInputs(), ...over });

describe('scenario matrix — the resolver behaves as specified', () => {
  it('nobody acts → the city declines (food/power down, threat up)', () => {
    const city = newCityState(1);
    const { city: next } = resolveDay(city, emptyInputs());
    expect(next.food).toBeLessThan(city.food); // consumption with no production
    expect(next.power).toBeLessThan(city.power); // passive decay
    expect(next.threat).toBeGreaterThan(city.threat); // passive rise
    expect(next.morale).toBeLessThanOrEqual(city.morale); // Marked lost, no votes
    expect(checkCityInvariants(next)).toEqual([]);
  });

  it('farming raises food vs an otherwise identical day', () => {
    const city = newCityState(1);
    const base = resolveDay(city, withInputs({ activeUserCount: 5 })).city;
    const farmed = resolveDay(
      city,
      withInputs({ activeUserCount: 5, actions: { grow_food: 10 } }),
    ).city;
    expect(farmed.food).toBeGreaterThan(base.food);
    // exactly grow_food count * per-action food, since consumption is identical
    expect(farmed.food - base.food).toBe(10 * (BALANCE.actionEffects.grow_food.food ?? 0));
  });

  it('guarding lowers threat and raises defense', () => {
    const city = newCityState(1);
    const base = resolveDay(city, emptyInputs()).city;
    const guarded = resolveDay(city, withInputs({ actions: { guard_wall: 8 } })).city;
    expect(guarded.threat).toBeLessThan(base.threat);
    expect(guarded.defense).toBeGreaterThan(base.defense);
  });

  it('scouting (mission runs) raises threat via mission noise', () => {
    const city = newCityState(1);
    const base = resolveDay(city, emptyInputs()).city;
    const scouted = resolveDay(city, withInputs({ missions: { totalRuns: 10 } })).city;
    expect(scouted.threat).toBeGreaterThan(base.threat);
  });

  it('no crisis votes → the moment passes unanswered, no winning option', () => {
    const city = newCityState(1);
    const { entry } = resolveDay(city, emptyInputs());
    expect(entry.winningOptionId).toBeNull();
    expect(entry.events.some((e) => /nobody voted/i.test(e))).toBe(true);
  });

  it('a tie crisis vote breaks deterministically by option id (a before b)', () => {
    const city = newCityState(1); // crisisId: first_light
    const r1 = resolveDay(city, withInputs({ crisisVotes: { a: 5, b: 5 } }));
    const r2 = resolveDay(city, withInputs({ crisisVotes: { a: 5, b: 5 } }));
    expect(r1.entry.winningOptionId).toBe('a');
    expect(r1).toEqual(r2); // fully deterministic
    // a b/c tie resolves to b
    expect(resolveDay(city, withInputs({ crisisVotes: { b: 3, c: 3 } })).entry.winningOptionId).toBe('b');
  });

  it('food shortfall → hunger deaths + morale penalty + food clamped to 0', () => {
    const city: CityState = { ...newCityState(1), food: 5, population: 200 };
    const { city: next, entry } = resolveDay(city, emptyInputs());
    // consumption ceil(200*0.15)=30 > food 5 → missing 25 → ceil(25*0.3)=8 deaths
    const consumed = Math.ceil(200 * BALANCE.foodPerPopulation);
    const missing = consumed - 5;
    const deaths = Math.ceil(missing * BALANCE.hunger.deathsPerMissingFood);
    expect(next.food).toBe(0);
    expect(next.population).toBe(200 - deaths);
    expect(entry.events.some((e) => /hunger/i.test(e))).toBe(true);
  });

  it('low power → flicker event + morale penalty', () => {
    const city: CityState = { ...newCityState(1), power: 20 };
    const base = resolveDay(newCityState(1), emptyInputs()).city; // healthy power
    const { city: next, entry } = resolveDay(city, emptyInputs());
    expect(next.power).toBeLessThan(BALANCE.lowPowerThreshold);
    expect(entry.events.some((e) => /flicker|lights|darkness/i.test(e))).toBe(true);
    // the low-power city loses more morale than the healthy one under equal input
    expect(next.morale).toBeLessThan(base.morale);
  });

  it('no medicine → sickness kills, some medicine → it is consumed', () => {
    const noMed: CityState = { ...newCityState(1), medicine: 0, population: 120 };
    const r1 = resolveDay(noMed, emptyInputs());
    expect(r1.city.population).toBe(120 - BALANCE.sickness.deathsIfNone);
    expect(r1.entry.events.some((e) => /sickness/i.test(e))).toBe(true);

    const someMed: CityState = { ...newCityState(1), medicine: 6 }; // >=2, < threshold 10
    const r2 = resolveDay(someMed, emptyInputs());
    expect(r2.city.medicine).toBe(6 - BALANCE.sickness.medicineCostPerDay);
  });

  it('morale collapse → deserters leave', () => {
    const city: CityState = { ...newCityState(1), morale: 10, population: 120 };
    const { city: next, entry } = resolveDay(city, emptyInputs());
    expect(next.population).toBe(120 - BALANCE.morale.desertersPerDay);
    expect(entry.events.some((e) => /slipped away/i.test(e))).toBe(true);
  });

  it('population crossing the fall threshold → city falls', () => {
    const city: CityState = { ...newCityState(1), population: 11, food: 0 };
    const { city: next, entry } = resolveDay(city, emptyInputs());
    expect(next.status).toBe('fallen');
    expect(next.population).toBeLessThanOrEqual(BALANCE.fall.populationThreshold);
    expect(entry.headline).toMatch(/fell/i);
  });

  it('a fallen city holds its memorial for the day, then the Phoenix Dawn rebirths it', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    await runLazyResolution(store, redis, new Date('2026-07-04T10:00:00Z'), 0);
    await store.setCityState({ ...newCityState(1), status: 'fallen' });
    // Same UTC day it fell: the memorial is a stable state, never a same-day loop.
    const sameDay = await runLazyResolution(store, redis, new Date('2026-07-04T21:00:00Z'), 0);
    expect(sameDay.city.status).toBe('fallen');
    // The next UTC dawn: the city rises as a fresh Camp in the next cycle.
    const { city, resolving } = await runLazyResolution(store, redis, new Date('2026-07-05T10:00:00Z'), 0);
    expect(resolving).toBe(false);
    expect(city.status).toBe('alive');
    expect(city.cycle).toBe(2);
    expect(city.day).toBe(1);
  });
});

/** Run a city forward day by day, stopping if it falls. Asserts invariants and
 *  the strict +1 day advance at every single step. */
const runSim = (
  start: CityState,
  inputsForDay: (city: CityState) => DayInputs,
  maxDays: number,
): { city: CityState; daysResolved: number } => {
  let city = start;
  let daysResolved = 0;
  for (let i = 0; i < maxDays; i++) {
    if (city.status !== 'alive') break;
    const before = city.day;
    const { city: next } = resolveDay(city, inputsForDay(city));
    expect(checkCityInvariants(next)).toEqual([]);
    expect(next.day).toBe(before + 1);
    city = next;
    daysResolved += 1;
  }
  return { city, daysResolved };
};

describe('simulations — random and balanced play over many days', () => {
  it('30 days of reproducible RANDOM player behavior never breaks an invariant', () => {
    // A seeded RNG makes the "everyone chooses random things" storm reproducible.
    const rng = makeRng(0xC0FFEE);
    const start = newCityState(1, 4242);
    const { daysResolved } = runSim(
      start,
      () =>
        withInputs({
          actions: {
            grow_food: rng.int(12),
            repair_power: rng.int(12),
            treat_sick: rng.int(8),
            guard_wall: rng.int(12),
          },
          missions: {
            totalFood: rng.int(20),
            totalMedicine: rng.int(12),
            totalScrap: rng.int(20),
            totalRuns: rng.int(8),
            injuries: rng.int(4),
          },
          crisisVotes: { a: rng.int(10), b: rng.int(10), c: rng.int(10) },
          strategyVotes: { stockpile_food: rng.int(6), prepare_raid: rng.int(6), send_scouts: rng.int(6) },
          roleCounts: { speaker: rng.int(6) },
          activeUserCount: rng.int(25),
          factionInfluence: { builders: rng.int(10), wardens: rng.int(10), seekers: rng.int(10) },
          markedPledged: rng.int(120),
          pledges: { stand_vigil: rng.int(8), share_rations: rng.int(8), run_messages: rng.int(8) },
          markedActivePlayers: rng.int(25),
        }),
      30,
    );
    // It either survived all 30 days or fell cleanly — both are valid; the point
    // is no invariant ever broke and the day always advanced by 1.
    expect(daysResolved).toBeGreaterThan(0);
  });

  it('zero play declines, and balanced play outlasts it (balance target)', () => {
    const start = newCityState(1);

    const zero = runSim(start, () => emptyInputs(), 12);
    // zero play strictly loses ground: less food than it started with.
    expect(zero.city.food).toBeLessThan(start.food);

    const balanced = runSim(
      start,
      () =>
        withInputs({
          actions: { grow_food: 8, repair_power: 5, treat_sick: 3, guard_wall: 6 },
          missions: { totalFood: 6, totalMedicine: 4, totalScrap: 6, totalRuns: 3, injuries: 0 },
          crisisVotes: { b: 6 },
          strategyVotes: { stockpile_food: 6 },
          roleCounts: { speaker: 4 },
          activeUserCount: 10,
          markedPledged: 200, // save the Marked → morale bonus
          markedActivePlayers: 10,
          pledges: { stand_vigil: 3, share_rations: 3 },
        }),
      12,
    );

    // Balanced play survives at least as long as zero play...
    expect(balanced.daysResolved).toBeGreaterThanOrEqual(zero.daysResolved);
    // ...and ends the window alive and in better shape.
    expect(balanced.city.status).toBe('alive');
    expect(balanced.city.food).toBeGreaterThan(zero.city.food);
  });

  it('all-guard play keeps threat lower than all-farm play over a week', () => {
    const start = newCityState(1);
    const guard = runSim(start, () => withInputs({ actions: { guard_wall: 10 }, activeUserCount: 10 }), 7);
    const farm = runSim(start, () => withInputs({ actions: { grow_food: 10 }, activeUserCount: 10 }), 7);
    // guarding suppresses threat; farming ignores it, so it climbs
    if (guard.city.status === 'alive' && farm.city.status === 'alive') {
      expect(guard.city.threat).toBeLessThan(farm.city.threat);
    }
  });
});
