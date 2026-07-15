import type { ActionType, CityState, Role, TimelineEntry } from '../../shared/types';
import { BALANCE } from '../../shared/balance';
import { KEYS } from '../storage/redisKeys';
import type { RedisLike } from '../storage/store';
import { Store } from '../storage/store';
import { newCityState, resolveDay, type DayInputs, type ResolveResult } from './resolver';
import { laborForStatus, selectRaidDamage } from './reconstruction';

/**
 * Turn a resolved raid into persisted post-raid state: drains the dome, marks
 * struck homes into the shared rebuild queue, and returns the timeline entry
 * enriched with the `raidAftermath` the Dawn Report cinematic reads. Shared by
 * the lazy dawn path AND the moderator force-resolve so both produce identical
 * state (force-resolve previously only saved the dome — no casualties/aftermath).
 * `city` is the PRE-resolve city (its day/cycle/seed pick the struck homes).
 */
export const applyRaidAftermath = async (
  store: Store,
  raid: NonNullable<ResolveResult['raid']>,
  city: CityState,
  entry: TimelineEntry,
  domeBefore: number[],
): Promise<TimelineEntry> => {
  // Persist the dome the raid left behind (blocked fireballs drained segments).
  await store.setDomeSegments(raid.segmentsAfter);
  const rows = await store.getHouseRows();
  let destroyedNames: string[] = [];
  let housesDamaged = 0;
  let required = 0;
  if (rows.length > 0) {
    const players = await store.getAllPlayers();
    const nameByUser: Record<string, string> = {};
    for (const p of players) nameByUser[p.userId] = p.username;
    const userByIndex: Record<number, string> = {};
    for (const r of rows) userByIndex[r.index] = r.userId;
    const seed = (city.worldSeed ^ Math.imul(city.cycle, 40503) ^ Math.imul(city.day, 97)) >>> 0;
    const picked = selectRaidDamage(rows.map((r) => r.index), raid.outcome, seed);
    const damageEntries: Record<string, 'destroyed' | 'damaged'> = {};
    for (const idx of picked.destroy) { const u = userByIndex[idx]; if (u) damageEntries[u] = 'destroyed'; }
    for (const idx of picked.damage) { const u = userByIndex[idx]; if (u) damageEntries[u] = 'damaged'; }
    await store.setHouseDamage(damageEntries);
    destroyedNames = picked.destroy.map((idx) => nameByUser[userByIndex[idx] ?? ''] ?? 'a survivor');
    housesDamaged = picked.damage.length;
    required =
      picked.destroy.length * laborForStatus('destroyed') + picked.damage.length * laborForStatus('damaged');
  }
  const aftermath = {
    held: raid.outcome === 'held',
    wallBreached: raid.outcome !== 'held',
    housesDestroyed: destroyedNames,
    housesDamaged,
    reconstructionRequired: required,
    fireballs: raid.fireballs,
    penetrations: raid.penetrations,
    soulsLost: raid.soulsLost,
    segmentsBefore: domeBefore,
    segmentsAfter: raid.segmentsAfter,
  };
  // Persistent casualty record: the soul + home toll rides the timeline entry's
  // events, which feed BOTH the Dawn Report (citySummary) and the timeline view.
  // So the raid's human cost survives past the transient banner and stays legible
  // for anyone who opens the report — souls are shown even when no home was lost.
  const tollBits: string[] = [];
  if (raid.soulsLost > 0) tollBits.push(`${raid.soulsLost} soul${raid.soulsLost === 1 ? '' : 's'}`);
  if (destroyedNames.length > 0) tollBits.push(`${destroyedNames.length} home${destroyedNames.length === 1 ? '' : 's'}`);
  const extra =
    tollBits.length > 0
      ? [`The raid cost the city ${tollBits.join(' and ')}. No citizen rebuilds alone; the recovery has begun.`]
      : [];
  return { ...entry, raidAftermath: aftermath, events: [...entry.events, ...extra] };
};

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
      const keysToDelete: string[] = [
        KEYS.housesIndex, KEYS.housesMeta, KEYS.markedOutcomes,
        // Raid damage, the shared rebuild queue, and the dome reset with the fallen
        // city — the reborn dome reads fresh (getDomeSegments falls back to full).
        KEYS.housesDamage, KEYS.housesRebuild, KEYS.dome,
      ];
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
      actions, missions, crisisVotes, strategyVotes, factionInfluence, roleData,
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
    // The dome's shields going into the raid (charged by daily challenges since the
    // last dawn). Captured before resolve so the aftermath can show before/after.
    const domeBefore = await store.getDomeSegments();
    const inputs: DayInputs = {
      actions,
      missions,
      crisisVotes,
      strategyVotes,
      roleCounts: roleData.roleCounts,
      roleActions: roleData.roleActions,
      activeUserCount: Object.keys(userActions).length,
      factionInfluence,
      markedPledged,
      pledges,
      markedActivePlayers: Object.keys(yesterdayUserActions).length,
      dome: domeBefore,
    };
    const { city: nextCity, entry, marked, raid } = resolveDay(city, inputs);

    // Raid aftermath: a Red Signal deterministically strikes homes. Ownership is
    // never lost — struck homes enter the shared rebuild queue (houses:damage);
    // the whole city restores them via build_city labor. A fallen city's damage
    // is cleared by the next Phoenix pass, so only apply it while still alive.
    let finalEntry = entry;
    if (raid && nextCity.status === 'alive') {
      finalEntry = await applyRaidAftermath(store, raid, city, entry, domeBefore);
    }

    await store.snapshotCity(nextCity);
    await store.appendTimeline(finalEntry);
    await store.setMarkedOutcome(city.day, marked);
    await store.setCityState(nextCity);
    await store.setCityMeta({ lastResolvedDate: today });
    return { city: nextCity, resolving: false };
  } finally {
    await redis.del(KEYS.resolverLock);
  }
};

/**
 * Roll the day's actions up by role. Returns both the flat per-role totals
 * (roleCounts — speaker morale tick) and the per-role, per-action breakdown
 * (roleActions — the specialist production bonus). One profile read, both maps.
 */
const countActionsByRole = async (
  store: Store,
  userActions: Record<string, Partial<Record<ActionType, number>>>,
): Promise<{
  roleCounts: Partial<Record<Role, number>>;
  roleActions: Partial<Record<Role, Record<string, number>>>;
}> => {
  const roleCounts: Partial<Record<Role, number>> = {};
  const roleActions: Partial<Record<Role, Record<string, number>>> = {};
  const userIds = Object.keys(userActions);
  const players = await Promise.all(userIds.map((userId) => store.getPlayer(userId)));
  userIds.forEach((userId, i) => {
    const role = players[i]?.role;
    if (!role) return;
    const bucket = (roleActions[role] ??= {});
    let total = 0;
    for (const [action, n] of Object.entries(userActions[userId] ?? {})) {
      const c = n ?? 0;
      total += c;
      bucket[action] = (bucket[action] ?? 0) + c;
    }
    roleCounts[role] = (roleCounts[role] ?? 0) + total;
  });
  return { roleCounts, roleActions };
};
