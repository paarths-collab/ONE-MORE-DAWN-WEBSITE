import type { ActionType, CityState, Role } from '../../shared/types';
import { BALANCE } from '../../shared/balance';
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
 *
 * `worldSeed` (W1) is only consumed on the creation path — it stamps the new
 * city with its per-installation seed and trait. Pass 0 for the neutral path.
 */
export const runLazyResolution = async (
  store: Store,
  redis: RedisLike,
  now: Date,
  worldSeed: number,
): Promise<LazyResolutionResult> => {
  const today = utcDateString(now);
  let city = await store.getCityState();
  const meta = await store.getCityMeta();

  const needsCreate = city === undefined;
  const needsResolve =
    city !== undefined && city.status === 'alive' && meta.lastResolvedDate !== today;
  // Phoenix Dawn: a fallen city mourns for the rest of the real day it fell,
  // then rises at the next UTC dawn as a fresh Camp in the next cycle — no
  // moderator required. Players persist (profiles, titles, streaks, lifetime
  // contribution and therefore house tiers); only the city itself resets.
  const needsRebirth =
    city !== undefined && city.status !== 'alive' && meta.lastResolvedDate !== today;

  if (!needsCreate && !needsResolve && !needsRebirth) {
    return { city: city!, resolving: false };
  }

  // NX set returns 'OK' when acquired. The fake returns '' (falsy) and the
  // Devvit client returns nil-ish when the key exists, so a truthy check
  // covers both (see RedisClient.set in @devvit/redis: Promise<string>).
  // The TTL is set ATOMICALLY with acquisition (not a separate expire call):
  // if this process dies mid-resolution before the finally runs, the lock must
  // still auto-expire, otherwise a TTL-less lock wedges every future /init at
  // resolving:true forever with no recovery path.
  const acquired = Boolean(
    await redis.set(KEYS.resolverLock, today, { nx: true, expiration: LOCK_TTL_SECONDS }),
  );
  if (!acquired) {
    return { city: city ?? newCityState(1, worldSeed), resolving: true };
  }

  try {
    // Re-read inside the lock — another holder may have finished before us.
    city = await store.getCityState();
    const freshMeta = await store.getCityMeta();

    if (city === undefined) {
      city = newCityState(1, worldSeed);
      await store.setCityState(city);
      await store.setCityMeta({ lastResolvedDate: today, schemaVersion: '1' });
      return { city, resolving: false };
    }

    if (freshMeta.lastResolvedDate === today) {
      return { city, resolving: false };
    }

    if (city.status !== 'alive') {
      // --- Phoenix Dawn: rebirth into the next cycle ---
      const fallenDay = city.day;
      const fallenCycle = city.cycle;
      // CLEARED: houses (re-earned instantly at the tier your lifetime
      // contribution has already banked), day-scoped ballots/actions (their
      // day numbers would collide with the new cycle's), marked outcomes.
      // KEPT: player profiles, lifetime contribution + scout leaderboards,
      // and the timeline — the city remembers every cycle, including its falls.
      const keysToDelete: string[] = [KEYS.housesIndex, KEYS.housesMeta, KEYS.markedOutcomes];
      for (let d = 1; d <= fallenDay + 1; d++) {
        keysToDelete.push(
          KEYS.dayActions(d), KEYS.dayUserActions(d), KEYS.dayVotes(d), KEYS.dayVoters(d),
          KEYS.dayMissions(d), KEYS.dayFactionInfluence(d), KEYS.dayStrategyPlan(d),
          KEYS.dayStrategyVoters(d), KEYS.dayMarked(d), KEYS.dayPledgers(d),
          KEYS.dayChallenges(fallenCycle, d),
        );
      }
      for (let i = 0; i < keysToDelete.length; i += 100) {
        await redis.del(...keysToDelete.slice(i, i + 100));
      }
      const players = await store.getAllPlayers();
      await store.savePlayers(
        players.map((player) => {
          const activeAtFall = player.lastActiveDay === fallenDay;
          const deadStreak =
            !activeAtFall && player.streak >= BALANCE.rekindle.minStreak
              ? player.streak
              : 0;
          return {
            ...player,
            energyUsedToday: 0,
            lastActiveDay: activeAtFall ? 0 : -1,
            injuredUntilDay: 0,
            roleChangedDay: 0,
            streak: activeAtFall ? player.streak : 1,
            lapsedStreak: Math.max(player.lapsedStreak ?? 0, deadStreak),
          };
        }),
      );
      const reborn = newCityState(city.cycle + 1, worldSeed);
      await store.setCityState(reborn);
      await store.appendTimeline({
        day: 1,
        cycle: reborn.cycle,
        headline: `FROM THE ASHES — cycle ${reborn.cycle} begins`,
        events: [
          `The city fell after ${city.day} dawns. The survivors regrouped at the old hearth.`,
          'Every title, every deed, and every name carries into the new dawn.',
        ],
        deltas: {},
        crisisId: reborn.crisisId,
        winningOptionId: null,
      });
      await store.setCityMeta({ lastResolvedDate: today });
      return { city: reborn, resolving: false };
    }

    // One hGetAll for userActions (roleCounts needs it), then the independent
    // day inputs in parallel.
    const userActions = await store.getAllUserActions(city.day);
    const [
      actions, missions, crisisVotes, strategyVotes, factionInfluence, roleCounts,
      markedPledged, pledges, yesterdayUserActions,
    ] = await Promise.all([
      store.getDayActions(city.day),
      store.getDayMissions(city.day),
      store.getVoteTally(city.day),
      store.getStrategyTally(city.day),
      store.getFactionInfluence(city.day),
      countActionsByRole(store, userActions),
      store.getMarkedPledge(city.day),
      store.getPledgeKindCounts(city.day),
      // Yesterday's action-takers scale the Marked goal (see BALANCE.marked).
      store.getAllUserActions(city.day - 1),
    ]);
    const inputs: DayInputs = {
      actions,
      missions,
      crisisVotes,
      strategyVotes,
      roleCounts,
      activeUserCount: Object.keys(userActions).length,
      factionInfluence,
      markedPledged,
      pledges,
      markedActivePlayers: Object.keys(yesterdayUserActions).length,
    };
    const { city: nextCity, entry, marked } = resolveDay(city, inputs);

    await store.snapshotCity(nextCity);
    await store.appendTimeline(entry);
    await store.setMarkedOutcome(city.day, marked);
    await store.setCityState(nextCity);
    await store.setCityMeta({ lastResolvedDate: today });
    return { city: nextCity, resolving: false };
  } finally {
    await redis.del(KEYS.resolverLock);
  }
};

/**
 * Slice version: only speakers matter (morale tick). Takes the already-fetched
 * userActions map (no duplicate hGetAll) and reads profiles in parallel.
 */
const countActionsByRole = async (
  store: Store,
  userActions: Record<string, Partial<Record<ActionType, number>>>,
): Promise<Partial<Record<Role, number>>> => {
  const counts: Partial<Record<Role, number>> = {};
  const userIds = Object.keys(userActions);
  const players = await Promise.all(userIds.map((userId) => store.getPlayer(userId)));
  userIds.forEach((userId, i) => {
    const player = players[i];
    if (!player?.role) return;
    const acted = Object.values(userActions[userId] ?? {}).reduce((s, n) => s + (n ?? 0), 0);
    counts[player.role] = (counts[player.role] ?? 0) + acted;
  });
  return counts;
};
