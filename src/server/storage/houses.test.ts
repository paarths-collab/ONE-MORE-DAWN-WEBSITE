import { describe, expect, it } from 'vitest';
import { HOUSE_CAP, HOUSE_TIER_MINS, tierForContribution } from '../../shared/houses';
import { KEYS } from './redisKeys';
import { Store } from './store';
import { makeFakeRedis } from './store.test';

describe('house registry', () => {
  it('registers one house per user in first-contribution order', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);

    await expect(store.registerHouse('t2_first')).resolves.toEqual({ index: 0, isNew: true });
    await expect(store.registerHouse('t2_first')).resolves.toEqual({ index: 0, isNew: false });
    await expect(store.registerHouse('t2_second')).resolves.toEqual({ index: 1, isNew: true });

    expect(await store.getFounderId()).toBe('t2_first');
    expect(await store.getHouseCount()).toBe(2);
    expect(await store.getHouseIndex('t2_first')).toBe(0);
    expect(await store.getHouseIndex('t2_second')).toBe(1);
    expect(await store.getHouseIndex('t2_stranger')).toBeNull();
  });

  it('clears house keys when the cycle-reset cleanup deletes them', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);

    await store.registerHouse('t2_founder');
    await store.registerHouse('t2_neighbor');
    await redis.del(KEYS.lbContribution, KEYS.housesIndex, KEYS.housesMeta);

    expect(await store.getHouseCount()).toBe(0);
    expect(await store.getFounderId()).toBeNull();
    expect(await store.getHouseIndex('t2_founder')).toBeNull();
  });

  it('normalizes inflated sequence gaps and corrupt index fields on read', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);

    await redis.hSet(KEYS.housesMeta, { seq: '5', founder: 't2_founder' });
    await redis.hSet(KEYS.housesIndex, {
      t2_founder: '2',
      t2_neighbor: '4',
      t2_corrupt: 'not-a-number',
    });

    expect(await store.getHouseCount()).toBe(2);
    expect(await store.getFounderId()).toBe('t2_founder');
    expect(await store.getHouseIndex('t2_founder')).toBe(0);
    expect(await store.getHouseIndex('t2_neighbor')).toBe(1);
    expect(await store.getHouseIndex('t2_corrupt')).toBeNull();
  });

  it('repairs a corrupt existing index when that user contributes again', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);

    await redis.hSet(KEYS.housesMeta, { seq: '7' });
    await redis.hSet(KEYS.housesIndex, { t2_bad: 'NaN' });

    await expect(store.registerHouse('t2_bad')).resolves.toEqual({ index: 0, isNew: true });
    expect(await store.getHouseCount()).toBe(1);
    expect(await store.getHouseIndex('t2_bad')).toBe(0);
    expect(await store.getFounderId()).toBe('t2_bad');
  });

  it('keeps the locked contract constants stable', () => {
    expect(HOUSE_CAP).toBe(240);
    expect(HOUSE_TIER_MINS).toEqual([1, 6, 18, 40]);
  });
});

describe('tierForContribution', () => {
  it.each([
    [0, 0],
    [1, 1],
    [5, 1],
    [6, 2],
    [17, 2],
    [18, 3],
    [39, 3],
    [40, 4],
    [999, 4],
  ] as const)('%i contribution -> tier %i', (contribution, tier) => {
    expect(tierForContribution(contribution)).toBe(tier);
  });
});
