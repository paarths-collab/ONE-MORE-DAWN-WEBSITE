import { describe, expect, it } from 'vitest';
import { KEYS } from '../storage/redisKeys';
import { Store } from '../storage/store';
import { makeFakeRedis } from '../storage/store.test';
import { freshPlayer } from './dayLogic';
import { runLazyResolution, utcDateString } from './lazyResolve';
import { newCityState } from './resolver';

describe('utcDateString', () => {
  it('formats a UTC calendar date', () => {
    expect(utcDateString(new Date('2026-07-04T23:59:00Z'))).toBe('2026-07-04');
    expect(utcDateString(new Date('2026-07-05T00:01:00Z'))).toBe('2026-07-05');
  });
});

describe('runLazyResolution', () => {
  it('creates the city on first ever call', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    const { city } = await runLazyResolution(store, redis, new Date('2026-07-04T10:00:00Z'), 0);
    expect(city.day).toBe(1);
    expect(city.worldSeed).toBe(0);
    expect(city.trait).toBe('standard'); // worldSeed 0 = neutral path
    expect((await store.getCityMeta()).lastResolvedDate).toBe('2026-07-04');
  });

  it('stamps the created city with the caller\'s worldSeed and its rolled trait', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    const { city } = await runLazyResolution(store, redis, new Date('2026-07-04T10:00:00Z'), 123456);
    expect(city.worldSeed).toBe(123456);
    expect(city.trait).toBe(newCityState(1, 123456).trait); // deterministic roll
    // Persisted, not just returned.
    expect((await store.getCityState())!.worldSeed).toBe(123456);
  });

  it('does not resolve twice on the same UTC date', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    await runLazyResolution(store, redis, new Date('2026-07-04T10:00:00Z'), 0);
    const { city } = await runLazyResolution(store, redis, new Date('2026-07-04T22:00:00Z'), 0);
    expect(city.day).toBe(1);
  });

  it('resolves exactly one day when the date rolls over', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    await runLazyResolution(store, redis, new Date('2026-07-04T10:00:00Z'), 0);
    const { city } = await runLazyResolution(store, redis, new Date('2026-07-06T09:00:00Z'), 0);
    expect(city.day).toBe(2); // forgiving: multiple missed dates = one resolution
    expect((await store.getCityMeta()).lastResolvedDate).toBe('2026-07-06');
    const timeline = await store.getTimeline(5);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.day).toBe(1);
  });

  it('returns resolving=true without resolving when the lock is held', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    await runLazyResolution(store, redis, new Date('2026-07-04T10:00:00Z'), 0);
    await redis.set('resolver:lock', 'held', { nx: true });
    const { city, resolving } = await runLazyResolution(store, redis, new Date('2026-07-05T10:00:00Z'), 0);
    expect(resolving).toBe(true);
    expect(city.day).toBe(1); // untouched
  });

  it('holds the memorial on the day the city fell (no same-day rebirth)', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    await runLazyResolution(store, redis, new Date('2026-07-04T10:00:00Z'), 0);
    const fallen = { ...newCityState(1), day: 9, status: 'fallen' as const };
    await store.setCityState(fallen);
    // Same UTC date as the resolution that felled it — the memorial holds.
    const { city } = await runLazyResolution(store, redis, new Date('2026-07-04T22:00:00Z'), 0);
    expect(city.status).toBe('fallen');
    expect(city.day).toBe(9);
  });

  it('Phoenix Dawn: a fallen city rises next dawn — players persist, the city resets', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    await runLazyResolution(store, redis, new Date('2026-07-04T10:00:00Z'), 0);
    // A lived-in cycle-2 city that fell on day 9.
    await store.setCityState({ ...newCityState(2), day: 9, status: 'fallen' as const });
    await store.savePlayer({
      ...freshPlayer('t2_vet', 'veteran', 9),
      energyUsedToday: 3,
      injuredUntilDay: 10,
      roleChangedDay: 8,
      streak: 7,
      coins: 18,
      coinsEarnedToday: 5,
      coinsEarnedCycle: 2,
      coinsEarnedDay: 9,
      ownedCosmetics: ['hearth_lantern'],
      equippedCosmetics: { light: 'hearth_lantern' },
    });
    await store.addContribution('t2_vet', 120); // lifetime score → house tier legacy
    await store.registerHouse('t2_vet');
    await redis.hSet(KEYS.dayVoters(9), { t2_vet: 'a' });
    await redis.hSet(KEYS.landFunding, { outer_fields: '120', river_ward: '40' });

    const { city, resolving } = await runLazyResolution(store, redis, new Date('2026-07-05T10:00:00Z'), 77);
    expect(resolving).toBe(false);
    expect(city.status).toBe('alive');
    expect(city.cycle).toBe(3); // next cycle
    expect(city.day).toBe(1); // fresh Camp
    expect(city.unlockedBuildings).toEqual([]);

    // Legacy kept: profile + lifetime contribution survive the fall.
    expect(await store.getPlayer('t2_vet')).toMatchObject({
      username: 'veteran',
      energyUsedToday: 0,
      lastActiveDay: 0,
      injuredUntilDay: 0,
      roleChangedDay: 0,
      streak: 7,
      coins: 18,
      ownedCosmetics: ['hearth_lantern'],
      equippedCosmetics: { light: 'hearth_lantern' },
    });
    expect(await store.getContributionScore('t2_vet')).toBe(120);
    // City reset: houses and day-scoped ballots cleared.
    expect(await store.getHouseCount()).toBe(0);
    expect(await store.getVoteTally(9)).toEqual({});
    expect(await store.getLandExpansionState()).toMatchObject({
      activeProjectId: 'river_ward',
      unlocked: ['outer_fields'],
    });
    // The city remembers: a FROM THE ASHES entry heads the kept timeline.
    const timeline = await store.getTimeline(3);
    expect(timeline[0]?.headline).toContain('FROM THE ASHES');
    expect(timeline[0]?.cycle).toBe(3);
    // Idempotent for the rest of the day.
    const again = await runLazyResolution(store, redis, new Date('2026-07-05T12:00:00Z'), 77);
    expect(again.city.cycle).toBe(3);
    expect(again.city.day).toBe(1);
  });

  it('a triggered raid persists house damage, a worn dome, and the casualty aftermath', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    await runLazyResolution(store, redis, new Date('2026-07-04T10:00:00Z'), 0);
    // Prime a city that will raid at the next dawn: at the trigger threshold, a
    // shattered dome (every fireball penetrates), and real homes to strike.
    await store.setCityState({ ...newCityState(1), day: 1, threat: 100, food: 200, population: 120, defense: 0 });
    const homes: [string, string][] = [['t2_a', 'ana'], ['t2_b', 'ben'], ['t2_c', 'cid'], ['t2_d', 'dee'], ['t2_e', 'eli']];
    for (const [id, name] of homes) {
      await store.savePlayer(freshPlayer(id, name, 1));
      await store.registerHouse(id);
    }
    await store.setDomeSegments([0, 0, 0, 0, 0, 0]);

    const { city } = await runLazyResolution(store, redis, new Date('2026-07-05T10:00:00Z'), 0);
    expect(city.day).toBe(2);
    expect(city.status).toBe('alive'); // survives the raid, does not fall

    // The dawn timeline carries the aftermath the Dawn Report cinematic reads.
    const dawnEntry = (await store.getTimeline(3))[0]!;
    const aftermath = dawnEntry.raidAftermath;
    expect(aftermath).toBeTruthy();
    expect(aftermath!.held).toBe(false);
    expect(aftermath!.penetrations).toBeGreaterThan(0);
    expect(aftermath!.soulsLost).toBeGreaterThan(0);
    expect(aftermath!.housesDestroyed.length).toBeGreaterThan(0);
    expect(aftermath!.reconstructionRequired).toBeGreaterThan(0);
    // The casualty toll is PERSISTED in the entry's events (feeds the Dawn Report
    // citySummary + timeline), so it survives past the transient raid banner.
    expect(dawnEntry.events.some((e) => /raid cost the city/i.test(e) && /soul/i.test(e))).toBe(true);

    // Persisted: the dome wore down to the reported after-state, and the struck
    // homes entered the shared rebuild queue.
    expect(await store.getDomeSegments()).toEqual(aftermath!.segmentsAfter);
    expect(Object.keys(await store.getHouseDamage()).length).toBeGreaterThan(0);
  });

  it('Phoenix Dawn: a lapsed veteran banks a rekindle-able flame across the new cycle', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    await runLazyResolution(store, redis, new Date('2026-07-04T10:00:00Z'), 0);
    await store.setCityState({ ...newCityState(2), day: 9, status: 'fallen' as const });
    // Active at the fall (lastActiveDay === fallenDay) -> keeps the live streak.
    await store.savePlayer({ ...freshPlayer('t2_here', 'present', 9), streak: 7 });
    // Lapsed BEFORE the fall with streak >= rekindle.minStreak -> the live streak
    // breaks, but is banked as a rekindle-able lapsedStreak, not lost.
    await store.savePlayer({ ...freshPlayer('t2_gone', 'lapsed', 5), streak: 6, lapsedStreak: 0 });

    await runLazyResolution(store, redis, new Date('2026-07-05T10:00:00Z'), 0);

    expect(await store.getPlayer('t2_here')).toMatchObject({ streak: 7, lastActiveDay: 0 });
    expect(await store.getPlayer('t2_gone')).toMatchObject({
      streak: 1, // live streak broken by the lapse
      lapsedStreak: 6, // ...but preserved to rekindle in the new cycle
      lastActiveDay: -1,
    });
  });
});
