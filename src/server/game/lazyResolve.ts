import type { CityState, Role } from '../../shared/types';
import { KEYS } from '../storage/redisKeys';
import type { RedisLike } from '../storage/store';
import { Store } from '../storage/store';
import { newCityState, resolveDay, type DayInputs } from './resolver';

export const utcDateString = (now: Date): string => now.toISOString().slice(0, 10);

const LOCK_TTL_SECONDS = 30;

export type LazyResolutionResult = { city: CityState; resolving: boolean };

/**
 * Spec §2 resolver flow. Creates the city on first call; resolves the previous
 * day when the UTC date has rolled over; both under an NX lock so concurrent
 * midnight requests cannot double-resolve.
 */
export const runLazyResolution = async (
  store: Store,
  redis: RedisLike,
  now: Date,
): Promise<LazyResolutionResult> => {
  const today = utcDateString(now);
  let city = await store.getCityState();
  const meta = await store.getCityMeta();

  const needsCreate = city === undefined;
  const needsResolve =
    city !== undefined && city.status === 'alive' && meta.lastResolvedDate !== today;

  if (!needsCreate && !needsResolve) {
    return { city: city!, resolving: false };
  }

  // NX set returns 'OK' when acquired. The fake returns '' (falsy) and the
  // Devvit client returns nil-ish when the key exists, so a truthy check
  // covers both (see RedisClient.set in @devvit/redis: Promise<string>).
  const acquired = Boolean(await redis.set(KEYS.resolverLock, today, { nx: true }));
  if (!acquired) {
    return { city: city ?? newCityState(1), resolving: true };
  }

  try {
    await redis.expire(KEYS.resolverLock, LOCK_TTL_SECONDS);
    // Re-read inside the lock — another holder may have finished before us.
    city = await store.getCityState();
    const freshMeta = await store.getCityMeta();

    if (city === undefined) {
      city = newCityState(1);
      await store.setCityState(city);
      await store.setCityMeta({ lastResolvedDate: today, schemaVersion: '1' });
      return { city, resolving: false };
    }

    if (city.status !== 'alive' || freshMeta.lastResolvedDate === today) {
      return { city, resolving: false };
    }

    const userActions = await store.getAllUserActions(city.day);
    const inputs: DayInputs = {
      actions: await store.getDayActions(city.day),
      missions: await store.getDayMissions(city.day),
      crisisVotes: await store.getVoteTally(city.day),
      roleCounts: await countActionsByRole(store, city.day),
      activeUserCount: Object.keys(userActions).length,
      factionInfluence: await store.getFactionInfluence(city.day),
    };
    const { city: nextCity, entry } = resolveDay(city, inputs);

    await store.snapshotCity(nextCity);
    await store.appendTimeline(entry);
    await store.setCityState(nextCity);
    await store.setCityMeta({ lastResolvedDate: today });
    return { city: nextCity, resolving: false };
  } finally {
    await redis.del(KEYS.resolverLock);
  }
};

/**
 * Slice version: only speakers matter (morale tick). Bounded: one hGetAll of
 * today's userActions, then per-user profile reads.
 */
const countActionsByRole = async (
  store: Store,
  day: number,
): Promise<Partial<Record<Role, number>>> => {
  const counts: Partial<Record<Role, number>> = {};
  const userActions = await store.getAllUserActions(day);
  for (const userId of Object.keys(userActions)) {
    const player = await store.getPlayer(userId);
    if (!player?.role) continue;
    const acted = Object.values(userActions[userId] ?? {}).reduce((s, n) => s + (n ?? 0), 0);
    counts[player.role] = (counts[player.role] ?? 0) + acted;
  }
  return counts;
};
