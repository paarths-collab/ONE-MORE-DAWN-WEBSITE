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
    await store.savePlayer(freshPlayer('t2_vet', 'veteran', 9));
    await store.addContribution('t2_vet', 120); // lifetime score → house tier legacy
    await store.registerHouse('t2_vet');
    await redis.hSet(KEYS.dayVoters(9), { t2_vet: 'a' });

    const { city, resolving } = await runLazyResolution(store, redis, new Date('2026-07-05T10:00:00Z'), 77);
    expect(resolving).toBe(false);
    expect(city.status).toBe('alive');
    expect(city.cycle).toBe(3); // next cycle
    expect(city.day).toBe(1); // fresh Camp
    expect(city.unlockedBuildings).toEqual([]);

    // Legacy kept: profile + lifetime contribution survive the fall.
    expect((await store.getPlayer('t2_vet'))?.username).toBe('veteran');
    expect(await store.getContributionScore('t2_vet')).toBe(120);
    // City reset: houses and day-scoped ballots cleared.
    expect(await store.getHouseCount()).toBe(0);
    expect(await store.getVoteTally(9)).toEqual({});
    // The city remembers: a FROM THE ASHES entry heads the kept timeline.
    const timeline = await store.getTimeline(3);
    expect(timeline[0]?.headline).toContain('FROM THE ASHES');
    expect(timeline[0]?.cycle).toBe(3);
    // Idempotent for the rest of the day.
    const again = await runLazyResolution(store, redis, new Date('2026-07-05T12:00:00Z'), 77);
    expect(again.city.cycle).toBe(3);
    expect(again.city.day).toBe(1);
  });
});
