import { describe, expect, it } from 'vitest';
import { citySummary, type WorldCityRecord } from '../game/world';
import { newCityState } from '../game/resolver';
import { makeFakeRedis } from './store.test';
import { GLOBAL_CITIES_KEY, readWorldCities, upsertWorldCity } from './worldRegistry';

describe('world registry (global:cities glue over a fake redis)', () => {
  it('round-trips an upserted record keyed by subredditId', async () => {
    const redis = makeFakeRedis();
    const record = citySummary('meadowbrook', { ...newCityState(1), day: 4 }, 2, 6);
    await upsertWorldCity(redis, 't5_abc', record);

    const cities = await readWorldCities(redis);
    expect(cities).toEqual({ t5_abc: record });
  });

  it('upsert overwrites the previous record for the same subreddit', async () => {
    const redis = makeFakeRedis();
    await upsertWorldCity(redis, 't5_abc', citySummary('a', newCityState(1), 0, 0));
    const fresh: WorldCityRecord = citySummary('a', { ...newCityState(1), day: 9 }, 3, 2);
    await upsertWorldCity(redis, 't5_abc', fresh);

    const cities = await readWorldCities(redis);
    expect(Object.keys(cities)).toEqual(['t5_abc']);
    expect(cities['t5_abc']).toEqual(fresh);
  });

  it('skips corrupt or foreign registry entries instead of failing the read', async () => {
    const redis = makeFakeRedis();
    const good = citySummary('good', newCityState(1), 1, 1);
    await upsertWorldCity(redis, 't5_good', good);
    await redis.hSet(GLOBAL_CITIES_KEY, {
      t5_bad: 'not json{',
      t5_shapeless: JSON.stringify({ hello: 'world' }),
    });

    expect(await readWorldCities(redis)).toEqual({ t5_good: good });
  });

  it('returns an empty map when nothing is registered', async () => {
    expect(await readWorldCities(makeFakeRedis())).toEqual({});
  });
});
