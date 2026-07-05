import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import { BALANCE } from '../../shared/balance';
import { getCrisis } from '../../shared/crises';
import type {
  ActionRequest,
  ActionResponse,
  ApiError,
  DawnReport,
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
import { bumpRoleRep, effectiveEnergy, freshPlayer, resetPlayerForDay } from '../game/dayLogic';
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
  zScore: (key, member) => redis.zScore(key, member),
  zRange: (key, start, stop, options) =>
    redis.zRange(
      key,
      start,
      stop,
      options && { by: options.by ?? 'rank', reverse: options.reverse },
    ),
};

export const getStore = () => new Store(redisLike);

/** Malformed JSON must be a 400 at the route, never an unhandled 500. */
export const parseBody = async <T>(c: {
  req: { json(): Promise<unknown> };
}): Promise<T | undefined> => {
  try {
    return (await c.req.json()) as T;
  } catch {
    return undefined;
  }
};

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

  // Only fresh players pay the Reddit username RPC — existing profiles skip it.
  let player = await store.getPlayer(user.userId);
  const brandNew = !player;
  if (!player) {
    const username = (await reddit.getCurrentUsername()) ?? 'citizen';
    player = freshPlayer(user.userId, username, city.day);
  }
  // Computed BEFORE the daily reset advances lastActiveDay; new players never
  // get a dawn report (there was no yesterday for them).
  const firstVisitToday = !brandNew && player.lastActiveDay < city.day;
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
    yesterdayActions,
    yesterdayVote,
  ] = await Promise.all([
    store.getVoteTally(city.day),
    store.getVoterChoice(city.day, user.userId),
    store.getStrategyTally(city.day),
    store.getStrategyChoice(city.day, user.userId),
    store.getUserActions(city.day, user.userId),
    store.getTimeline(1),
    store.getFactionInfluence(city.day),
    store.getUserActions(city.day - 1, user.userId),
    store.getVoterChoice(city.day - 1, user.userId),
  ]);

  // Dawn report: yesterday's story + this player's part in it. Only when a
  // timeline entry for yesterday exists (i.e. at least one resolution ran).
  const timelinePreview = timeline[0] ?? null;
  let dawnReport: DawnReport | null = null;
  if (!brandNew && timelinePreview && timelinePreview.day === city.day - 1) {
    const yourImpact: string[] = [];
    const yRaw = yesterdayActions as Record<string, unknown>;
    let actionCount = 0;
    for (const [key, value] of Object.entries(yRaw)) {
      if (key !== 'mission' && key !== 'missionLoot' && typeof value === 'number') {
        actionCount += value;
      }
    }
    if (actionCount > 0) {
      yourImpact.push(`You took ${actionCount} city action(s) for the city.`);
    }
    const loot = yRaw['missionLoot'];
    if (loot && typeof loot === 'object') {
      const l = loot as Partial<Record<'food' | 'medicine' | 'scrap', number>>;
      yourImpact.push(
        `Your expedition banked +${l.food ?? 0} food, +${l.medicine ?? 0} medicine, +${l.scrap ?? 0} scrap.`,
      );
    }
    if (yesterdayVote) yourImpact.push('You voted on the crisis.');
    dawnReport = {
      day: timelinePreview.day,
      citySummary: timelinePreview.events.slice(0, 5),
      yourImpact,
      title: player.title,
    };
  }

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
    timelinePreview,
    // Plan 2 conflict layer — real values wired in P5.
    activeLaw,
    raidInDays: Math.max(
      0,
      Math.ceil((BALANCE.raid.triggerThreshold - city.threat) / BALANCE.passiveThreatRise),
    ),
    factionInfluence,
    yourFaction: player.faction,
    yourFactionRep: player.factionRep,
    dawnReport,
    firstVisitToday,
  });
});

api.post('/role', async (c) => {
  const user = requireUser();
  if (!user) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();
  const city = await store.getCityState();
  if (!city) return c.json<ApiError>({ status: 'error', message: 'City not initialized' }, 409);

  const body = await parseBody<RoleRequest>(c);
  if (!body || typeof body.role !== 'string') {
    return c.json<ApiError>({ status: 'error', message: 'Bad request' }, 400);
  }
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

  const body = await parseBody<ActionRequest>(c);
  if (!body || typeof body.action !== 'string') {
    return c.json<ApiError>({ status: 'error', message: 'Bad request' }, 400);
  }

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

  // Non-critical bookkeeping outside the tx (contribution mirror + aggregates),
  // in parallel — none of these read each other's writes. Faction influence
  // rides along when the action maps to a faction.
  const faction = BALANCE.factionPerAction[body.action];
  await Promise.all([
    store.recordAction(city.day, user.userId, body.action),
    store.addContribution(user.userId, BALANCE.contributionPerAction),
    ...(faction
      ? [store.bumpFactionInfluence(city.day, faction, BALANCE.factionRepPerAction)]
      : []),
  ]);

  // Rep re-reads the saved player and its result is the response player —
  // must stay after the tx write and outside the Promise.all.
  let finalPlayer = updated;
  if (faction) {
    finalPlayer =
      (await store.bumpPlayerFactionRep(city.cycle, user.userId, faction, BALANCE.factionRepPerAction)) ??
      updated;
  }

  // Role reputation rides on every action. validateAction guarantees a role.
  // Fold onto whatever bumpPlayerFactionRep persisted, then save once more.
  const repped = bumpRoleRep(finalPlayer, finalPlayer.role!, BALANCE.roleRepPerAction);
  finalPlayer = repped.player;
  await store.savePlayer(finalPlayer);

  return c.json<ActionResponse>({
    type: 'action',
    player: finalPlayer,
    effectiveEnergy: effectiveEnergy(finalPlayer, city.day),
    yourActionsToday: await store.getUserActions(city.day, user.userId),
    unlockedTitle: repped.unlockedTitle,
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

  const body = await parseBody<VoteRequest>(c);
  if (!body || typeof body.optionId !== 'string') {
    return c.json<ApiError>({ status: 'error', message: 'Bad request' }, 400);
  }
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

  const body = await parseBody<StrategyRequest>(c);
  if (!body || typeof body.planId !== 'string') {
    return c.json<ApiError>({ status: 'error', message: 'Bad request' }, 400);
  }
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

  // Resolve usernames from the players hash (in parallel); fall back to
  // 'citizen' if unknown.
  const resolve = (rows: { userId: string; score: number }[]): Promise<LeaderboardEntry[]> =>
    Promise.all(
      rows.map(async (r) => {
        const p = await store.getPlayer(r.userId);
        return { userId: r.userId, username: p?.username ?? 'citizen', score: Math.round(r.score) };
      }),
    );

  // Faction standings: rank today's influence tally per faction (deterministic
  // FactionId order as tie-break), standing 1 = highest. Influence needs
  // city.day, so read the city first, then run both username resolutions in
  // parallel with the influence fetch.
  const city = await store.getCityState();
  const [contributors, scouts, influence] = await Promise.all([
    resolve(contribRows),
    resolve(scoutRows),
    city
      ? store.getFactionInfluence(city.day)
      : Promise.resolve<Record<FactionId, number>>({ builders: 0, wardens: 0, seekers: 0, hearth: 0 }),
  ]);
  const order = (['builders', 'wardens', 'seekers', 'hearth'] as FactionId[])
    .map((f) => ({ f, rep: influence[f] }))
    .sort((a, b) => b.rep - a.rep);
  const factions = {} as Record<FactionId, { rep: number; standing: number }>;
  order.forEach((o, i) => {
    factions[o.f] = { rep: o.rep, standing: i + 1 };
  });

  return c.json<LeaderboardResponse>({ type: 'leaderboard', contributors, scouts, factions });
});
