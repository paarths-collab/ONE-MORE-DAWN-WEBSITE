import type { WorldCityRecord } from '../game/world';

/**
 * The one cross-installation key (redis.global, RedisKeyScope.GLOBAL):
 * a hash of subredditId -> WorldCityRecord JSON. This module is the ONLY
 * place global-registry keys are touched — Store stays per-installation.
 */
export const GLOBAL_CITIES_KEY = 'global:cities';

/** Structural subset of the global redis client (testable with the fake). */
export type GlobalRedisLike = {
  hSet(key: string, fieldValues: Record<string, string>): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
};

export const upsertWorldCity = async (
  redis: GlobalRedisLike,
  subredditId: string,
  record: WorldCityRecord,
): Promise<void> => {
  await redis.hSet(GLOBAL_CITIES_KEY, { [subredditId]: JSON.stringify(record) });
};

/** All registered cities, keyed by subredditId. Unparseable entries are
 *  skipped — one bad write from any installation must not hide the world. */
export const readWorldCities = async (
  redis: GlobalRedisLike,
): Promise<Record<string, WorldCityRecord>> => {
  const raw = await redis.hGetAll(GLOBAL_CITIES_KEY);
  const out: Record<string, WorldCityRecord> = {};
  for (const [subredditId, json] of Object.entries(raw)) {
    try {
      const rec = JSON.parse(json) as WorldCityRecord;
      if (rec && typeof rec === 'object' && typeof rec.subreddit === 'string') {
        out[subredditId] = rec;
      }
    } catch {
      // skip corrupt registry entries
    }
  }
  return out;
};
