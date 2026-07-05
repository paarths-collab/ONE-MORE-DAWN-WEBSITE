import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../shared/balance';
import type { WorldCity } from '../../shared/types';
import { newCityState } from './resolver';
import {
  citySummary,
  displaySubredditName,
  rankCities,
  toWorldCity,
  WORLD_RECORD_VERSION,
  worldStatus,
  type WorldCityRecord,
} from './world';

// newCityState(1) vitals: food 60, power 55, medicine 20, morale 60, threat 30.
const vitals = (over: Partial<ReturnType<typeof newCityState>> = {}) => ({
  ...newCityState(1),
  ...over,
});

const wc = (over: Partial<WorldCity>): WorldCity => ({
  subreddit: 'r/a',
  cycle: 1,
  day: 5,
  survivalDays: 5,
  status: 'holding',
  threat: 30,
  population: 100,
  savedCount: 0,
  activePlayers: 3,
  isYou: false,
  ...over,
});

describe('worldStatus', () => {
  it('tags a fallen city fallen, above every other branch', () => {
    expect(worldStatus(vitals({ status: 'fallen', morale: 90, food: 100 }))).toBe('fallen');
    // Even with raid-level threat, fallen wins.
    expect(worldStatus(vitals({ status: 'fallen', threat: 99 }))).toBe('fallen');
  });

  it('tags under_raid when one passive rise crosses the trigger', () => {
    const edge = BALANCE.raid.triggerThreshold - BALANCE.passiveThreatRise; // imminent
    expect(worldStatus(vitals({ threat: edge }))).toBe('under_raid');
    expect(worldStatus(vitals({ threat: edge - 1 }))).not.toBe('under_raid');
    // Precedence over strained: a starving city under raid shows the raid.
    expect(worldStatus(vitals({ threat: edge, food: 0 }))).toBe('under_raid');
  });

  it('tags strained when ANY vital hits its floor', () => {
    expect(worldStatus(vitals({ food: BALANCE.world.strained.food }))).toBe('strained');
    expect(worldStatus(vitals({ power: BALANCE.world.strained.power }))).toBe('strained');
    expect(worldStatus(vitals({ medicine: BALANCE.world.strained.medicine }))).toBe('strained');
    expect(worldStatus(vitals({ morale: BALANCE.world.strained.morale }))).toBe('strained');
  });

  it('tags thriving only when every vital is strong AND threat is low', () => {
    const strong = vitals({ food: 80, power: 70, medicine: 15, morale: 70, threat: 20 });
    expect(worldStatus(strong)).toBe('thriving');
    // One weak vital drops it out of thriving.
    expect(worldStatus({ ...strong, morale: BALANCE.world.thriving.morale - 1 })).toBe('holding');
    expect(worldStatus({ ...strong, threat: BALANCE.world.thriving.maxThreat + 1 })).toBe('holding');
  });

  it('tags the default starting city holding (alive, mid vitals)', () => {
    expect(worldStatus(vitals())).toBe('holding'); // morale 60 < thriving floor 65
  });
});

describe('rankCities', () => {
  it('ranks by survivalDays desc', () => {
    const ranked = rankCities([
      wc({ subreddit: 'r/b', survivalDays: 3 }),
      wc({ subreddit: 'r/a', survivalDays: 9 }),
      wc({ subreddit: 'r/c', survivalDays: 6 }),
    ]);
    expect(ranked.map((c) => c.subreddit)).toEqual(['r/a', 'r/c', 'r/b']);
  });

  it('breaks ties: savedCount desc, then population desc, then subreddit asc', () => {
    const ranked = rankCities([
      wc({ subreddit: 'r/dd', savedCount: 1 }),
      wc({ subreddit: 'r/cc', savedCount: 2, population: 50 }),
      wc({ subreddit: 'r/bb', savedCount: 2, population: 80 }),
      wc({ subreddit: 'r/aa', savedCount: 1 }), // full tie with r/dd -> name asc
    ]);
    expect(ranked.map((c) => c.subreddit)).toEqual(['r/bb', 'r/cc', 'r/aa', 'r/dd']);
  });

  it('does not mutate its input', () => {
    const input = [wc({ subreddit: 'r/b', survivalDays: 1 }), wc({ subreddit: 'r/a', survivalDays: 2 })];
    const snapshot = [...input];
    rankCities(input);
    expect(input).toEqual(snapshot);
  });
});

describe('citySummary', () => {
  it('builds the exact stored record shape (no isYou, plus v/updatedAtDay)', () => {
    const city = { ...newCityState(2), day: 7, population: 111, threat: 42 };
    expect(citySummary('meadowbrook', city, 4, 9)).toEqual({
      subreddit: 'r/meadowbrook',
      cycle: 2,
      day: 7,
      survivalDays: 7,
      status: 'holding',
      threat: 42,
      population: 111,
      savedCount: 4,
      activePlayers: 9,
      v: WORLD_RECORD_VERSION,
      updatedAtDay: 7,
    });
  });

  it('computes the status tag from the city vitals', () => {
    const fallen = { ...newCityState(1), status: 'fallen' as const };
    expect(citySummary('x', fallen, 0, 0).status).toBe('fallen');
  });

  it('keeps an already-prefixed subreddit name as-is', () => {
    expect(citySummary('r/already', newCityState(1), 0, 0).subreddit).toBe('r/already');
    expect(displaySubredditName('plain')).toBe('r/plain');
  });
});

describe('toWorldCity', () => {
  it('drops the storage-only fields and stamps isYou', () => {
    const record: WorldCityRecord = {
      subreddit: 'r/x',
      cycle: 1,
      day: 3,
      survivalDays: 3,
      status: 'thriving',
      threat: 10,
      population: 99,
      savedCount: 2,
      activePlayers: 5,
      v: WORLD_RECORD_VERSION,
      updatedAtDay: 3,
    };
    // toEqual is exact-key: proves v/updatedAtDay never leak into the API shape.
    expect(toWorldCity(record, true)).toEqual({
      subreddit: 'r/x',
      cycle: 1,
      day: 3,
      survivalDays: 3,
      status: 'thriving',
      threat: 10,
      population: 99,
      savedCount: 2,
      activePlayers: 5,
      isYou: true,
    });
  });
});
