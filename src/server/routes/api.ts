import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import { BALANCE } from '../../shared/balance';
import { getCrisis } from '../../shared/crises';
import type {
  ActionRequest,
  ActionResponse,
  ApiError,
  FactionId,
  InitResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  RoleRequest,
  RoleResponse,
  StrategyRequest,
  StrategyResponse,
  TimelineResponse,
  VoteRequest,
  VoteResponse,
} from '../../shared/types';
import { validateAction, validateRoleChange } from '../game/actionRules';
import { effectiveEnergy, freshPlayer, resetPlayerForDay } from '../game/dayLogic';
import { runLazyResolution } from '../game/lazyResolve';
import { KEYS } from '../storage/redisKeys';
import { Store, type RedisLike } from '../storage/store';

export const api = new Hono();

/**
 * Devvit tx conflict semantics (verified from @devvit/redis RedisClient.js):
 * exec() is typed Promise<any[]> and never null. Success = length > 0; a
 * caught throw or an empty array means the watched key was modified.
 */
const execOrConflict = async (tx: { exec(): Promise<unknown[]> }): Promise<boolean> => {
  try {
    const results = await tx.exec();
    return results.length > 0;
  } catch {
    return false;
  }
};

/**
 * Structural adapter: the Devvit client's SetOptions.expiration is a Date and
 * its ZRangeOptions.by is required, while RedisLike speaks seconds / optional
 * `by`. Delegates 1:1 otherwise — no behavior of its own.
 */
export const redisLike: RedisLike = {
  get: (key) => redis.get(key),
  set: (key, value, options) =>
    redis.set(
      key,
      value,
      options && {
        nx: options.nx,
        expiration:
          options.expiration === undefined
            ? undefined
            : new Date(Date.now() + options.expiration * 1000),
      },
    ),
  del: (...keys) => redis.del(...keys),
  expire: (key, seconds) => redis.expire(key, seconds),
  hGet: (key, field) => redis.hGet(key, field),
  hSet: (key, fieldValues) => redis.hSet(key, fieldValues),
  hGetAll: (key) => redis.hGetAll(key),
  hIncrBy: (key, field, value) => redis.hIncrBy(key, field, value),
  hDel: async (key, fields) => {
    await redis.hDel(key, fields);
  },
  zIncrBy: (key, member, value) => redis.zIncrBy(key, member, value),
  zAdd: (key, ...members) => redis.zAdd(key, ...members),
  zRange: (key, start, stop, options) =>
    redis.zRange(
      key,
      start,
      stop,
      options && { by: options.by ?? 'rank', reverse: options.reverse },
    ),
};

export const getStore = () => new Store(redisLike);

export const requireUser = (): { userId: string } | undefined => {
  const { userId } = context;
  return userId ? { userId } : undefined;
};

api.get('/init', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ApiError>({ status: 'error', message: 'postId missing from context' }, 400);
  }
  const user = requireUser();
  if (!user) {
    return c.json<ApiError>({ status: 'error', message: 'Log in to Reddit to play' }, 401);
  }

  const store = getStore();
  const { city, resolving } = await runLazyResolution(store, redisLike, new Date());

  const username = (await reddit.getCurrentUsername()) ?? 'citizen';
  let player = (await store.getPlayer(user.userId)) ?? freshPlayer(user.userId, username, city.day);
  const reset = resetPlayerForDay(player, city.day);
  if (reset !== player) {
    player = reset;
    await store.savePlayer(player);
  }

  const [
    crisisVotes,
    yourCrisisVote,
    strategyVotes,
    yourStrategyVote,
    yourActionsToday,
    timeline,
    factionInfluence,
  ] = await Promise.all([
    store.getVoteTally(city.day),
    store.getVoterChoice(city.day, user.userId),
    store.getStrategyTally(city.day),
    store.getStrategyChoice(city.day, user.userId),
    store.getUserActions(city.day, user.userId),
    store.getTimeline(1),
    store.getFactionInfluence(city.day),
  ]);

  const activeLaw =
    city.activeLaw && city.lawExpiresDay >= city.day
      ? BALANCE.laws[city.activeLaw as FactionId]
      : null;

  return c.json<InitResponse>({
    type: 'init',
    postId,
    city,
    player,
    effectiveEnergy: effectiveEnergy(player, city.day),
    crisis: getCrisis(city.crisisId),
    crisisVotes,
    yourCrisisVote: yourCrisisVote ?? null,
    strategyVotes,
    yourStrategyVote: yourStrategyVote ?? null,
    yourActionsToday,
    missionUsedToday: (yourActionsToday as Record<string, unknown>)['mission'] !== undefined,
    resolving,
    timelinePreview: timeline[0] ?? null,
    // Plan 2 conflict layer — real values wired in P5.
    activeLaw,
    raidInDays: Math.max(
      0,
      Math.ceil((BALANCE.raid.triggerThreshold - city.threat) / BALANCE.passiveThreatRise),
    ),
    factionInfluence,
    yourFaction: player.faction,
    yourFactionRep: player.factionRep,
  });
});

api.post('/role', async (c) => {
  const user = requireUser();
  if (!user) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();
  const city = await store.getCityState();
  if (!city) return c.json<ApiError>({ status: 'error', message: 'City not initialized' }, 409);

  const body = await c.req.json<RoleRequest>();
  const player = await store.getPlayer(user.userId);
  if (!player) return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);

  const error = validateRoleChange(player, city.day, body.role);
  if (error) return c.json<ApiError>({ status: 'error', message: error }, 400);

  const updated = { ...player, role: body.role, roleChangedDay: city.day };
  await store.savePlayer(updated);
  return c.json<RoleResponse>({ type: 'role', player: updated });
});

api.post('/action', async (c) => {
  const user = requireUser();
  if (!user) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();
  const city = await store.getCityState();
  if (!city || city.status !== 'alive') {
    return c.json<ApiError>({ status: 'error', message: 'The city is beyond saving.' }, 409);
  }

  const body = await c.req.json<ActionRequest>();

  // Optimistic-concurrency energy spend: watch players; conflict → retry.
  const tx = await redis.watch(KEYS.players);
  const player = await store.getPlayer(user.userId);
  if (!player) {
    await tx.unwatch();
    return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);
  }
  const error = validateAction(player, city.day, body.action);
  if (error) {
    await tx.unwatch();
    return c.json<ApiError>({ status: 'error', message: error }, 400);
  }

  const updated = {
    ...player,
    energyUsedToday: player.energyUsedToday + 1,
    totalContribution: player.totalContribution + BALANCE.contributionPerAction,
  };
  await tx.multi();
  await tx.hSet(KEYS.players, { [user.userId]: JSON.stringify(updated) });
  if (!(await execOrConflict(tx))) {
    return c.json<ApiError>({ status: 'error', message: 'Busy — try again' }, 409);
  }

  // Non-critical bookkeeping outside the tx (contribution mirror + aggregates).
  await store.recordAction(city.day, user.userId, body.action);
  await store.addContribution(user.userId, BALANCE.contributionPerAction);

  // Faction bookkeeping (also outside the tx): the acting player's chosen action
  // pushes influence for its faction today and earns the player rep on it.
  let finalPlayer = updated;
  const faction = BALANCE.factionPerAction[body.action];
  if (faction) {
    await store.bumpFactionInfluence(city.day, faction, BALANCE.factionRepPerAction);
    finalPlayer =
      (await store.bumpPlayerFactionRep(user.userId, faction, BALANCE.factionRepPerAction)) ??
      updated;
  }

  return c.json<ActionResponse>({
    type: 'action',
    player: finalPlayer,
    effectiveEnergy: effectiveEnergy(finalPlayer, city.day),
    yourActionsToday: await store.getUserActions(city.day, user.userId),
  });
});

api.post('/vote', async (c) => {
  const user = requireUser();
  if (!user) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();
  const city = await store.getCityState();
  if (!city || city.status !== 'alive') {
    return c.json<ApiError>({ status: 'error', message: 'The city is beyond saving.' }, 409);
  }

  const body = await c.req.json<VoteRequest>();
  const crisis = getCrisis(city.crisisId);
  if (!crisis.options.some((o) => o.id === body.optionId)) {
    return c.json<ApiError>({ status: 'error', message: 'Unknown option' }, 400);
  }

  const votersKey = KEYS.dayVoters(city.day);
  const tx = await redis.watch(votersKey);
  const existing = await store.getVoterChoice(city.day, user.userId);
  if (existing) {
    await tx.unwatch();
    return c.json<ApiError>({ status: 'error', message: 'You already voted today.' }, 409);
  }
  await tx.multi();
  await tx.hSet(votersKey, { [user.userId]: body.optionId });
  await tx.hIncrBy(KEYS.dayVotes(city.day), body.optionId, 1);
  if (!(await execOrConflict(tx))) {
    return c.json<ApiError>({ status: 'error', message: 'Busy — try again' }, 409);
  }

  return c.json<VoteResponse>({
    type: 'vote',
    crisisVotes: await store.getVoteTally(city.day),
    yourCrisisVote: body.optionId,
  });
});

api.post('/strategy', async (c) => {
  const user = requireUser();
  if (!user) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();
  const city = await store.getCityState();
  if (!city || city.status !== 'alive') {
    return c.json<ApiError>({ status: 'error', message: 'The city is beyond saving.' }, 409);
  }

  const body = await c.req.json<StrategyRequest>();
  if (!(BALANCE.strategyPlans as readonly string[]).includes(body.planId)) {
    return c.json<ApiError>({ status: 'error', message: 'Unknown plan' }, 400);
  }

  const votersKey = KEYS.dayStrategyVoters(city.day);
  const tx = await redis.watch(votersKey);
  const existing = await store.getStrategyChoice(city.day, user.userId);
  if (existing) {
    await tx.unwatch();
    return c.json<ApiError>({ status: 'error', message: 'You already backed a plan today.' }, 409);
  }
  await tx.multi();
  await tx.hSet(votersKey, { [user.userId]: body.planId });
  await tx.hIncrBy(KEYS.dayStrategyPlan(city.day), body.planId, 1);
  if (!(await execOrConflict(tx))) {
    return c.json<ApiError>({ status: 'error', message: 'Busy — try again' }, 409);
  }

  return c.json<StrategyResponse>({
    type: 'strategy',
    strategyVotes: await store.getStrategyTally(city.day),
    yourStrategyVote: body.planId,
  });
});

api.get('/timeline', async (c) => {
  const store = getStore();
  const entries = await store.getTimeline(30);
  return c.json<TimelineResponse>({ type: 'timeline', entries });
});

api.get('/leaderboard', async (c) => {
  const store = getStore();
  const [contribRows, scoutRows] = await Promise.all([
    store.topContributors(10),
    store.topScouts(10),
  ]);

  // Resolve usernames from the players hash; fall back to 'citizen' if unknown.
  const resolve = async (
    rows: { userId: string; score: number }[],
  ): Promise<LeaderboardEntry[]> => {
    const out: LeaderboardEntry[] = [];
    for (const r of rows) {
      const p = await store.getPlayer(r.userId);
      out.push({ userId: r.userId, username: p?.username ?? 'citizen', score: Math.round(r.score) });
    }
    return out;
  };
  const [contributors, scouts] = await Promise.all([resolve(contribRows), resolve(scoutRows)]);

  // Faction standings: rank today's influence tally per faction (deterministic
  // FactionId order as tie-break), standing 1 = highest.
  const city = await store.getCityState();
  const influence = city
    ? await store.getFactionInfluence(city.day)
    : { builders: 0, wardens: 0, seekers: 0, hearth: 0 };
  const order = (['builders', 'wardens', 'seekers', 'hearth'] as FactionId[])
    .map((f) => ({ f, rep: influence[f] }))
    .sort((a, b) => b.rep - a.rep);
  const factions = {} as Record<FactionId, { rep: number; standing: number }>;
  order.forEach((o, i) => {
    factions[o.f] = { rep: o.rep, standing: i + 1 };
  });

  return c.json<LeaderboardResponse>({ type: 'leaderboard', contributors, scouts, factions });
});
