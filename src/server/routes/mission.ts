import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import { BALANCE } from '../../shared/balance';
import { hashString } from '../../shared/rng';
import type {
  ApiError,
  MissionCompleteRequest,
  MissionCompleteResponse,
  MissionStartResponse,
} from '../../shared/types';
import { bumpRoleRep, effectiveEnergy } from '../game/dayLogic';
import { evaluateMission, type MissionToken } from '../game/missionRules';
import { KEYS } from '../storage/redisKeys';
import { getStore, parseBody } from './api';

export const mission = new Hono();

/**
 * Devvit tx conflict semantics (verified from @devvit/redis RedisClient.js):
 * exec() is typed Promise<any[]> and the client builds the result array from
 * the plugin's response — it NEVER resolves to null/undefined. On a
 * watched-key conflict the RPC either rejects (throw) or carries an empty
 * response array. Every transaction here queues exactly one command whose
 * reply always maps to an array entry (hSet/del reply as `num`), so success
 * is always length 1 — a caught throw OR an empty array means conflict.
 */
const execOrConflict = async (tx: { exec(): Promise<unknown[]> }): Promise<boolean> => {
  try {
    const results = await tx.exec();
    return results.length > 0;
  } catch {
    return false;
  }
};

mission.post('/start', async (c) => {
  const { userId } = context;
  if (!userId) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();
  const city = await store.getCityState();
  if (!city || city.status !== 'alive') {
    return c.json<ApiError>({ status: 'error', message: 'The city is beyond saving.' }, 409);
  }

  // Energy deducted AT START (spec §4): watch players; one mission per day.
  const tx = await redis.watch(KEYS.players);
  const player = await store.getPlayer(userId);
  if (!player) {
    await tx.unwatch();
    return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);
  }
  if (player.energyUsedToday >= effectiveEnergy(player, city.day)) {
    await tx.unwatch();
    return c.json<ApiError>({ status: 'error', message: 'No energy left today.' }, 400);
  }
  const mine = await store.getUserActions(city.day, userId);
  if ((mine as Record<string, number>)['mission']) {
    await tx.unwatch();
    return c.json<ApiError>(
      { status: 'error', message: 'One expedition per day. The ruins will still be there tomorrow.' },
      400,
    );
  }

  const updated = { ...player, energyUsedToday: player.energyUsedToday + 1 };
  await tx.multi();
  await tx.hSet(KEYS.players, { [userId]: JSON.stringify(updated) });
  if (!(await execOrConflict(tx))) {
    return c.json<ApiError>({ status: 'error', message: 'Busy — try again' }, 409);
  }

  // day-shared layout, per-user loot (spec §4)
  const layoutSeed = hashString(`cycle${city.cycle}-day${city.day}`);
  const lootSeed = hashString(`${layoutSeed}-${userId}`);
  const now = Date.now();
  const token: MissionToken = {
    tokenId: `${userId}-${city.day}-${now}`,
    userId,
    day: city.day,
    layoutSeed,
    lootSeed,
    roleAtStart: updated.role,
    startedAtServerMs: now,
    expiresAtServerMs: now + BALANCE.mission.tokenTtlMs,
    consumed: false,
  };
  // Per-token key with TTL (plan deviation 5): abandoned tokens self-clean.
  await redis.set(KEYS.missionToken(token.tokenId), JSON.stringify(token));
  await redis.expire(KEYS.missionToken(token.tokenId), Math.ceil(BALANCE.mission.tokenTtlMs / 1000));

  // mark mission started in the aggregate + per-user day log
  await redis.hIncrBy(KEYS.dayActions(city.day), 'mission_started', 1);
  const rawMine = await redis.hGet(KEYS.dayUserActions(city.day), userId);
  const mineNow: Record<string, number> = rawMine ? JSON.parse(rawMine) : {};
  mineNow['mission'] = 1;
  await redis.hSet(KEYS.dayUserActions(city.day), { [userId]: JSON.stringify(mineNow) });

  return c.json<MissionStartResponse>({
    type: 'mission-start',
    tokenId: token.tokenId,
    layoutSeed,
    lootSeed,
    airSeconds:
      BALANCE.mission.airSeconds +
      (updated.role === 'scout' ? BALANCE.mission.scoutAirBonusSeconds : 0),
    player: updated,
    effectiveEnergy: effectiveEnergy(updated, city.day),
  });
});

mission.post('/complete', async (c) => {
  const { userId } = context;
  if (!userId) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();
  const city = await store.getCityState();
  if (!city || city.status !== 'alive') {
    return c.json<ApiError>({ status: 'error', message: 'The city is beyond saving.' }, 409);
  }

  const body = await parseBody<MissionCompleteRequest>(c);
  if (!body || typeof body.tokenId !== 'string' || !Array.isArray(body.collectedCrateIds)) {
    return c.json<ApiError>({ status: 'error', message: 'Bad request' }, 400);
  }
  const tokenKey = KEYS.missionToken(body.tokenId);

  // Atomic consume: watch the token key so a parallel duplicate /complete
  // (or TTL expiry) between our read and our delete voids this transaction —
  // the loser sees a conflict and cannot double-bank.
  const tx = await redis.watch(tokenKey);
  const rawToken = await redis.get(tokenKey);
  if (!rawToken) {
    await tx.unwatch();
    return c.json<ApiError>({ status: 'error', message: 'Unknown or expired mission token' }, 404);
  }
  const token = JSON.parse(rawToken) as MissionToken;

  const result = evaluateMission(token, body, userId, city.day, city.threat, Date.now());
  if (!result.ok) {
    await tx.unwatch();
    return c.json<ApiError>({ status: 'error', message: result.reason }, 400);
  }

  await tx.multi();
  await tx.del(tokenKey);
  if (!(await execOrConflict(tx))) {
    return c.json<ApiError>({ status: 'error', message: 'Mission already submitted.' }, 409);
  }

  const items =
    (result.banked.food ?? 0) + (result.banked.medicine ?? 0) + (result.banked.scrap ?? 0);

  const player = await store.getPlayer(userId);
  if (!player) return c.json<ApiError>({ status: 'error', message: 'Profile lost' }, 500);
  const contribution = items * BALANCE.contributionPerMissionLoot;
  const updated = {
    ...player,
    totalContribution: player.totalContribution + contribution,
    injuredUntilDay: result.injured ? city.day + BALANCE.mission.injuryDays : player.injuredUntilDay,
  };
  await store.savePlayer(updated);

  // Independent bookkeeping in parallel: day aggregates, contribution mirror,
  // scout leaderboard, and Seekers influence (every run pushes it).
  await Promise.all([
    store.bumpDayMissions(city.day, {
      totalRuns: 1,
      totalFood: result.banked.food ?? 0,
      totalMedicine: result.banked.medicine ?? 0,
      totalScrap: result.banked.scrap ?? 0,
      injuries: result.injured ? 1 : 0,
    }),
    store.addContribution(userId, contribution),
    store.recordScoutHaul(userId, items),
    store.bumpFactionInfluence(
      city.day,
      BALANCE.factionPerMissionRun,
      BALANCE.factionRepPerMissionRun,
    ),
  ]);

  // Rep re-reads the saved player and its result is the response player —
  // must stay after savePlayer and outside the Promise.all.
  const repd = await store.bumpPlayerFactionRep(
    city.cycle,
    userId,
    BALANCE.factionPerMissionRun,
    BALANCE.factionRepPerMissionRun,
  );
  let finalPlayer = repd ?? updated;

  // Role reputation for the run — credited to the role the mission started
  // with (fallback: current role); skipped when both are null.
  let unlockedTitle: string | null = null;
  const repRole = token.roleAtStart ?? finalPlayer.role;
  if (repRole) {
    const repped = bumpRoleRep(finalPlayer, repRole, BALANCE.roleRepPerMission);
    finalPlayer = repped.player;
    unlockedTitle = repped.unlockedTitle;
    await store.savePlayer(finalPlayer);
  }

  // Record per-user mission loot on the day's userActions entry so tomorrow's
  // dawn report can show what this player banked.
  const rawMine = await redis.hGet(KEYS.dayUserActions(city.day), userId);
  const mineNow: Record<string, unknown> = rawMine ? JSON.parse(rawMine) : {};
  mineNow['missionLoot'] = {
    food: result.banked.food ?? 0,
    medicine: result.banked.medicine ?? 0,
    scrap: result.banked.scrap ?? 0,
  };
  await redis.hSet(KEYS.dayUserActions(city.day), { [userId]: JSON.stringify(mineNow) });

  return c.json<MissionCompleteResponse>({
    type: 'mission-complete',
    banked: result.banked,
    injured: result.injured,
    contributionGained: contribution,
    player: finalPlayer,
    unlockedTitle,
  });
});
