import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CityState } from '../../shared/types';
import {
  assertCityInvariants,
  assertResolveInvariants,
  checkCityInvariants,
} from './invariants';
import { resolveDay, type DayInputs } from './resolver';

/**
 * Property-based resolver tests. Instead of enumerating the billions of ways a
 * subreddit's players could act, we generate thousands of random-but-valid
 * (city, inputs) pairs and assert the rules ALWAYS hold: no invalid state ever
 * comes out, and the resolver is perfectly deterministic. This is the concrete
 * answer to "how do I make sure random player behavior can't break the game".
 */

const nat = (max: number) => fc.integer({ min: 0, max });

// A valid ALIVE city: percentages in 0..100, stocks within their caps, and
// population strictly above the fall threshold (an alive city below it would
// itself violate an invariant — the generator must not produce illegal inputs).
const cityArb: fc.Arbitrary<CityState> = fc.record({
  day: fc.integer({ min: 1, max: 60 }),
  cycle: fc.integer({ min: 1, max: 12 }),
  status: fc.constant('alive'),
  worldSeed: fc.integer({ min: 0, max: 2_000_000_000 }),
  trait: fc.constantFrom('standard', 'frozen', 'crowded', 'militarized', 'sick'),
  population: fc.integer({ min: 11, max: 600 }), // > fall threshold (10)
  food: fc.integer({ min: 0, max: 300 }),
  power: fc.integer({ min: 0, max: 100 }),
  medicine: fc.integer({ min: 0, max: 120 }),
  morale: fc.integer({ min: 0, max: 100 }),
  threat: fc.integer({ min: 0, max: 100 }),
  defense: fc.integer({ min: 0, max: 100 }),
  crisisId: fc.constantFrom(
    'first_light',
    'refugee_convoy',
    'blackout_ward',
    'ration_riots',
    'strange_signal',
    'sickness_spreads',
  ),
  activeLaw: fc.constantFrom(null, 'builders', 'wardens', 'seekers', 'hearth'),
  lawExpiresDay: fc.integer({ min: 0, max: 62 }),
  // Build-from-zero (V1): buildings unlock in list order, so a valid unlocked
  // set is always an in-order prefix. cityLevel/buildProgress are free-ranging;
  // the resolver recomputes the stage and never trusts the incoming level.
  cityLevel: fc.integer({ min: 0, max: 4 }),
  buildProgress: fc.integer({ min: 0, max: 60 }),
  unlockedBuildings: fc
    .nat({ max: 7 })
    .map((n) =>
      ['shelter', 'farm', 'clinic', 'watchtower', 'storehouse', 'wall', 'council_hall'].slice(0, n),
    ),
}) as fc.Arbitrary<CityState>;

const dayInputsArb: fc.Arbitrary<DayInputs> = fc.record({
  actions: fc.record({
    grow_food: nat(40),
    repair_power: nat(40),
    treat_sick: nat(40),
    guard_wall: nat(40),
  }),
  missions: fc.record({
    totalFood: nat(60),
    totalMedicine: nat(60),
    totalScrap: nat(60),
    totalRuns: nat(30),
    injuries: nat(30),
  }),
  crisisVotes: fc.record({ a: nat(100), b: nat(100), c: nat(100) }),
  strategyVotes: fc.record({
    stockpile_food: nat(50),
    repair_power: nat(50),
    prepare_raid: nat(50),
    send_scouts: nat(50),
    treat_sick: nat(50),
  }),
  roleCounts: fc.record({
    scout: nat(20),
    engineer: nat(20),
    medic: nat(20),
    farmer: nat(20),
    guard: nat(20),
    speaker: nat(20),
  }),
  activeUserCount: nat(80),
  factionInfluence: fc.record({
    builders: nat(30),
    wardens: nat(30),
    seekers: nat(30),
    hearth: nat(30),
  }),
  markedPledged: nat(400),
  pledges: fc.record({
    stand_vigil: nat(50),
    share_rations: nat(50),
    run_messages: nat(50),
    back_council: nat(50),
  }),
  markedActivePlayers: nat(80),
}) as fc.Arbitrary<DayInputs>;

describe('resolver — property based', () => {
  it('never produces an invalid city state from any valid inputs (2000 runs)', () => {
    fc.assert(
      fc.property(cityArb, dayInputsArb, (city, inputs) => {
        // the generator itself must only produce valid alive cities
        assertCityInvariants(city, 'generated-input');
        const result = resolveDay(city, inputs);
        // the whole transition holds: valid next city, day+1, entry, no NaN
        assertResolveInvariants(city, result);
      }),
      { numRuns: 2000 },
    );
  });

  it('advances the day by exactly 1 on every run', () => {
    fc.assert(
      fc.property(cityArb, dayInputsArb, (city, inputs) => {
        expect(resolveDay(city, inputs).city.day).toBe(city.day + 1);
      }),
      { numRuns: 1000 },
    );
  });

  it('is fully deterministic — same (city, inputs) yields an identical result', () => {
    fc.assert(
      fc.property(cityArb, dayInputsArb, (city, inputs) => {
        expect(resolveDay(city, inputs)).toEqual(resolveDay(city, inputs));
      }),
      { numRuns: 1000 },
    );
  });

  it('produces zero invariant violations across the whole sample (report form)', () => {
    fc.assert(
      fc.property(cityArb, dayInputsArb, (city, inputs) => {
        return checkCityInvariants(resolveDay(city, inputs).city).length === 0;
      }),
      { numRuns: 1000 },
    );
  });

  it('drives a city that crosses the fall threshold to fallen, never a live sub-threshold city', () => {
    fc.assert(
      fc.property(cityArb, dayInputsArb, (city, inputs) => {
        const { city: next } = resolveDay(city, inputs);
        // the core continuity rule: alive => above threshold; at/below => fallen
        if (next.status === 'alive') return next.population > 10;
        return true;
      }),
      { numRuns: 1500 },
    );
  });
});
