import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import { BALANCE } from '../../shared/balance';
import { getCrisis } from '../../shared/crises';
import { HOUSE_CAP, NAMED_HOUSE_LIMIT, tierForContribution } from '../../shared/houses';
import type {
  ActionRequest,
  ActionResponse,
  ApiError,
  AvatarRequest,
  AvatarResponse,
  CityState,
  DawnReport,
  FactionId,
  Forecast,
  HouseSummary,
  InitResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  Marked,
  PledgeRequest,
  PledgeResponse,
  RoleRequest,
  RoleResponse,
  StrategyRequest,
  StrategyResponse,
  TimelineResponse,
  VillageResponse,
  VoteRequest,
  VoteResponse,
  WorldResponse,
} from '../../shared/types';
import { hashString } from '../../shared/rng';
import { clampAvatar, isValidAvatar } from '../../shared/avatar';
import { validateAction, validateRoleChange } from '../game/actionRules';
import { buildStatus } from '../game/building';
import { buildDrama } from '../game/drama';
import { pickMarked } from '../game/marked';
import { buildPledgeInfo, isPledgeKind, type PledgerEntry } from '../game/pledges';
import { buildStanding } from '../game/standing';
import { buildVillagers, buildZones, maskName } from '../game/village';
import { bumpRoleRep, effectiveEnergy, loadOrCreatePlayer } from '../game/dayLogic';
import { runLazyResolution, utcDateString } from '../game/lazyResolve';
import { resolveDay } from '../game/resolver';
import { beginUserLock } from '../game/userLock';
import {
  citySummary,
  displaySubredditName,
  rankCities,
  toWorldCity,
  type WorldCityRecord,
} from '../game/world';
import { KEYS } from '../storage/redisKeys';
import { Store, type RedisLike } from '../storage/store';
import { readWorldCities, upsertWorldCity } from '../storage/worldRegistry';

export const api = new Hono();

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

const emptyHouseSummary = (): HouseSummary => ({
  total: 0,
  cap: HOUSE_CAP,
  founder: null,
  yours: null,
  named: [],
});

export const buildHouseSummary = async (store: Store, userId: string): Promise<HouseSummary> => {
  try {
    const [rawTotal, founderId, myIndexRaw, myScoreRaw, top] = await Promise.all([
      store.getHouseCount(),
      store.getFounderId(),
      store.getHouseIndex(userId),
      store.getContributionScore(userId),
      store.topContributors(NAMED_HOUSE_LIMIT),
    ]);
    if (!Number.isFinite(rawTotal) || rawTotal <= 0) return emptyHouseSummary();
    const total = Math.floor(rawTotal);
    const founderProfile = founderId ? await store.getPlayer(founderId) : undefined;
    const founder = founderId ? { username: founderProfile?.username ?? 'a survivor' } : null;
    const myIndex = myIndexRaw !== null && Number.isFinite(myIndexRaw) && myIndexRaw >= 0
      ? Math.floor(myIndexRaw)
      : null;
    const myScore = Number.isFinite(myScoreRaw) ? myScoreRaw ?? 0 : 0;
    const yours = myIndex === null
      ? null
      : { index: myIndex, tier: tierForContribution(myScore), isFounder: myIndex === 0 };

    const namedRaw = await Promise.all(top.map(async (t) => {
      const [idxRaw, p] = await Promise.all([
        store.getHouseIndex(t.userId),
        store.getPlayer(t.userId),
      ]);
      if (idxRaw === null || !Number.isFinite(idxRaw) || idxRaw < 0 || !p) return null;
      return { username: p.username, index: Math.floor(idxRaw), tier: tierForContribution(t.score) };
    }));
    const named = namedRaw.filter((h): h is NonNullable<typeof h> => h !== null);
    return { total, cap: HOUSE_CAP, founder, yours, named };
  } catch {
    return emptyHouseSummary();
  }
};

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

/**
 * Per-installation world seed (W1): hash of the subreddit id, so every
 * subreddit gets its own maps, crisis sequence, and city trait. BaseContext
 * types subredditId as non-optional T5; the fallback guards local harnesses.
 */
export const deriveWorldSeed = (): number => hashString(context.subredditId ?? 'local');

/**
 * World-of-Cities gate (Plan 2): does this sub have >= BALANCE.world
 * .minSubscribers? getCurrentSubreddit() is a Reddit RPC, so the verdict is
 * cached in city:meta under a UTC date stamp and refreshed at most once per
 * day. If the RPC fails we fall back to the last cached verdict (stale beats
 * flapping); with no cache at all we report ineligible/unknown.
 */
const getWorldEligibility = async (
  store: Store,
  now: Date,
): Promise<{ eligible: boolean; subscribers: number | null }> => {
  const fromMeta = (meta: Record<string, string>) => {
    const n = Number(meta.worldSubscribers);
    return { eligible: meta.worldEligible === '1', subscribers: Number.isFinite(n) ? n : null };
  };
  const today = utcDateString(now);
  const meta = await store.getCityMeta();
  if (meta.worldCheckedDate === today && meta.worldEligible !== undefined) {
    return fromMeta(meta);
  }
  try {
    const subscribers = (await reddit.getCurrentSubreddit()).numberOfSubscribers;
    const eligible = subscribers >= BALANCE.world.minSubscribers;
    await store.setCityMeta({
      worldCheckedDate: today,
      worldSubscribers: String(subscribers),
      worldEligible: eligible ? '1' : '0',
    });
    return { eligible, subscribers };
  } catch {
    return meta.worldEligible !== undefined
      ? fromMeta(meta)
      : { eligible: false, subscribers: null };
  }
};

/**
 * Upsert THIS city into the cross-installation registry (redis.global) — but
 * ONLY past the subscriber gate: a sub-minSubscribers community plays fully
 * locally and is never written to the world map. Best-effort by design: world
 * sync rides on /init and must never break it, so all failures are swallowed.
 */
const syncWorldRegistry = async (store: Store, city: CityState, now: Date): Promise<void> => {
  try {
    const { subredditId } = context;
    if (!subredditId) return;
    const { eligible } = await getWorldEligibility(store, now);
    if (!eligible) return;
    const [savedCount, todayActions] = await Promise.all([
      store.countMarkedSaved(),
      store.getAllUserActions(city.day),
    ]);
    const record = citySummary(
      context.subredditName ?? subredditId,
      city,
      savedCount,
      Object.keys(todayActions).length,
    );
    await upsertWorldCity(redis.global, subredditId, record);
  } catch {
    // Cross-install writes are a side quest; the local game never depends on them.
  }
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
  const { city, resolving } = await runLazyResolution(store, redisLike, new Date(), deriveWorldSeed());

  // "Tomorrow if nobody acts": a zero-action projection of today's resolution.
  // resolveDay is pure and cheap (no I/O, never mutates city) — safe inline.
  // It intentionally ignores actions already recorded today. Computed even for
  // fallen cities (the dashboard early-returns there; the type must be filled).
  const projected = resolveDay(city, {
    actions: {},
    missions: {},
    crisisVotes: {},
    roleCounts: {},
    activeUserCount: 0,
    factionInfluence: {},
    strategyVotes: {},
    markedPledged: 0,
    pledges: {},
    markedActivePlayers: 0,
  }).city;
  const forecast: Forecast = {
    food: projected.food,
    power: projected.power,
    medicine: projected.medicine,
    morale: projected.morale,
    threat: projected.threat,
    raidLikely: city.threat + BALANCE.passiveThreatRise >= BALANCE.raid.triggerThreshold,
  };

  // Load-or-create-and-persist the caller's profile (see loadOrCreatePlayer).
  // Only fresh players pay the Reddit username RPC — existing profiles skip it.
  // The brand-new profile is ALWAYS persisted here; skipping the save bricks
  // every first-time player at the role gate forever.
  const { player, brandNew, firstVisitToday } = await loadOrCreatePlayer(
    store,
    user.userId,
    city.day,
    // Fail-soft: a brand-new player has no saved profile yet, so a THROWN
    // username RPC (not just a null return) must not 500 their first load.
    // Username is cosmetic and correctable later — default to 'citizen'.
    async () => {
      try {
        return (await reddit.getCurrentUsername()) ?? 'citizen';
      } catch {
        return 'citizen';
      }
    },
  );

  const [
    crisisVotes,
    yourCrisisVote,
    strategyVotes,
    yourStrategyVote,
    yourActionsToday,
    timeline,
    factionInfluence,
    allYesterdayActions,
    yesterdayVote,
    dayActions,
    dayMissions,
    markedPledged,
    pledgers,
    markedOutcome,
    contributionRank,
  ] = await Promise.all([
    store.getVoteTally(city.day),
    store.getVoterChoice(city.day, user.userId),
    store.getStrategyTally(city.day),
    store.getStrategyChoice(city.day, user.userId),
    store.getUserActions(city.day, user.userId),
    store.getTimeline(1),
    store.getFactionInfluence(city.day),
    // Full map: this user's slice feeds the dawn report, the key count scales
    // the Marked goal (yesterday's action-takers — stable all day).
    store.getAllUserActions(city.day - 1),
    store.getVoterChoice(city.day - 1, user.userId),
    store.getDayActions(city.day),
    store.getDayMissions(city.day),
    store.getMarkedPledge(city.day),
    store.getPledgers(city.day),
    store.getMarkedOutcome(city.day - 1),
    store.getContributionRank(user.userId),
  ]);
  const yesterdayActions = allYesterdayActions[user.userId] ?? {};

  // ---- Reddit-native hook layer (Plan 1) ----
  const marked: Marked = {
    ...pickMarked(city.worldSeed, city.cycle, city.day, Object.keys(allYesterdayActions).length),
    pledged: markedPledged,
    savedYesterday: markedOutcome,
  };
  const pledge = buildPledgeInfo(pledgers, user.userId);
  const drama = buildDrama(city, timeline, dayActions, dayMissions, marked, factionInfluence);
  const standing = buildStanding(city, contributionRank);
  const houses = await buildHouseSummary(store, user.userId);

  // World of Cities (Plan 2): keep this sub's global-registry record fresh.
  // Cheap on the common path (one cached-meta read for sub-gate subs; one
  // global hSet when eligible) and never throws.
  await syncWorldRegistry(store, city, new Date());

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
    forecast,
    trait: {
      id: city.trait,
      label: BALANCE.traits[city.trait].label,
      blurb: BALANCE.traits[city.trait].blurb,
    },
    build: buildStatus(
      city,
      dayActions['build_city'] ?? 0,
      (yourActionsToday['build_city'] ?? 0) > 0,
    ),
    houses,
    marked,
    pledge,
    drama,
    standing,
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

/**
 * Create or edit the caller's survivor avatar (name / gender / pixel look).
 * Purely cosmetic — no game numbers change, and there's no cooldown (unlike
 * roles): identity should always be editable. The payload is validated and
 * every palette index clamped into range so a malformed client can't store an
 * out-of-bounds look.
 */
api.post('/avatar', async (c) => {
  const user = requireUser();
  if (!user) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();

  const body = await parseBody<AvatarRequest>(c);
  if (!body || !isValidAvatar(body.avatar)) {
    return c.json<ApiError>({ status: 'error', message: 'Pick a name (2+ letters) and a look.' }, 400);
  }
  const player = await store.getPlayer(user.userId);
  if (!player) return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);

  const updated = { ...player, avatar: clampAvatar(body.avatar) };
  await store.savePlayer(updated);
  return c.json<AvatarResponse>({ type: 'avatar', player: updated });
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

  // Per-user optimistic energy spend: watch ONLY this user's lock key, so two
  // DIFFERENT users acting in the same instant never abort each other — only a
  // genuine same-user double-tap conflicts (see beginUserLock).
  const lock = await beginUserLock(redis, user.userId);
  const player = await store.getPlayer(user.userId);
  if (!player) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);
  }
  const error = validateAction(player, city.day, body.action);
  if (error) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: error }, 400);
  }

  const updated = {
    ...player,
    energyUsedToday: player.energyUsedToday + 1,
    totalContribution: player.totalContribution + BALANCE.contributionPerAction,
  };
  const committed = await lock.commit(async (tx) => {
    await tx.hSet(KEYS.players, { [user.userId]: JSON.stringify(updated) });
  });
  if (!committed) {
    return c.json<ApiError>({ status: 'error', message: 'Busy — try again' }, 409);
  }

  // Non-critical bookkeeping outside the tx (contribution mirror + aggregates),
  // in parallel — none of these read each other's writes. Faction influence
  // rides along when the action maps to a faction.
  const faction = BALANCE.factionPerAction[body.action];
  await Promise.all([
    store.registerHouse(user.userId),
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
  // Reject a stale vote: a client held open past UTC midnight is voting on
  // YESTERDAY's crisis. Without this its optionId ('a') would silently count for
  // a DIFFERENT crisis's option 'a' today.
  if (typeof body.crisisId === 'string' && body.crisisId !== city.crisisId) {
    return c.json<ApiError>({ status: 'error', message: 'A new day has dawned — reload.' }, 409);
  }
  const crisis = getCrisis(city.crisisId);
  if (!crisis.options.some((o) => o.id === body.optionId)) {
    return c.json<ApiError>({ status: 'error', message: 'Unknown option' }, 400);
  }

  // Per-user optimistic lock (same pattern as /action): two DIFFERENT voters
  // watch different lock keys and never abort each other — only a genuine
  // same-user double-tap conflicts (the sequential re-vote is caught by the
  // getVoterChoice check above). Replaces the old shared dayVoters-hash watch,
  // which false-409'd every concurrent voter in the post-dawn burst.
  const votersKey = KEYS.dayVoters(city.day);
  const lock = await beginUserLock(redis, user.userId);
  const existing = await store.getVoterChoice(city.day, user.userId);
  if (existing) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'You already voted today.' }, 409);
  }
  const committed = await lock.commit(async (tx) => {
    await tx.hSet(votersKey, { [user.userId]: body.optionId });
    await tx.hIncrBy(KEYS.dayVotes(city.day), body.optionId, 1);
  });
  if (!committed) {
    return c.json<ApiError>({ status: 'error', message: 'Busy — try again' }, 409);
  }
  await store.registerHouse(user.userId);

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

  // Per-user optimistic lock (see /vote): different backers never false-conflict.
  const votersKey = KEYS.dayStrategyVoters(city.day);
  const lock = await beginUserLock(redis, user.userId);
  const existing = await store.getStrategyChoice(city.day, user.userId);
  if (existing) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'You already backed a plan today.' }, 409);
  }
  const committed = await lock.commit(async (tx) => {
    await tx.hSet(votersKey, { [user.userId]: body.planId });
    await tx.hIncrBy(KEYS.dayStrategyPlan(city.day), body.planId, 1);
  });
  if (!committed) {
    return c.json<ApiError>({ status: 'error', message: 'Busy — try again' }, 409);
  }
  await store.registerHouse(user.userId);

  return c.json<StrategyResponse>({
    type: 'strategy',
    strategyVotes: await store.getStrategyTally(city.day),
    yourStrategyVote: body.planId,
  });
});

/**
 * One-tap pledge (hook layer, Plan 1) — the lurker path. FREE: never touches
 * the 3-energy action budget; the only cap is one pledge per user per day,
 * enforced with the same watch/multi lock pattern as the crisis vote.
 */
api.post('/pledge', async (c) => {
  const user = requireUser();
  if (!user) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();
  const city = await store.getCityState();
  if (!city || city.status !== 'alive') {
    return c.json<ApiError>({ status: 'error', message: 'The city is beyond saving.' }, 409);
  }

  const body = await parseBody<PledgeRequest>(c);
  if (!body || !isPledgeKind(body.kind)) {
    return c.json<ApiError>({ status: 'error', message: 'Bad request' }, 400);
  }
  const player = await store.getPlayer(user.userId);
  if (!player) return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);

  // Per-user optimistic lock (see /vote): different pledgers never false-conflict.
  const pledgersKey = KEYS.dayPledgers(city.day);
  const lock = await beginUserLock(redis, user.userId);
  const existing = await store.getPledger(city.day, user.userId);
  if (existing) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'You already pledged today.' }, 409);
  }
  const entry: PledgerEntry = {
    kind: body.kind,
    name: maskName(player.username),
    at: Date.now(),
    contribution: player.totalContribution,
  };
  const committed = await lock.commit(async (tx) => {
    await tx.hSet(pledgersKey, { [user.userId]: JSON.stringify(entry) });
    await tx.hIncrBy(KEYS.dayMarked(city.day), 'pledged', BALANCE.marked.pledgePerTap);
    await tx.hIncrBy(KEYS.dayMarked(city.day), body.kind, 1);
  });
  if (!committed) {
    return c.json<ApiError>({ status: 'error', message: 'Busy — try again' }, 409);
  }

  // Public credit: pledges count toward contribution/status (never energy).
  // Re-read after the tx so a concurrent action's energy spend isn't clobbered.
  const fresh = (await store.getPlayer(user.userId)) ?? player;
  const updated = {
    ...fresh,
    totalContribution: fresh.totalContribution + BALANCE.contributionPerPledge,
  };
  await Promise.all([
    store.registerHouse(user.userId),
    store.savePlayer(updated),
    store.addContribution(user.userId, BALANCE.contributionPerPledge),
  ]);

  const [pledged, pledgers, allYesterdayActions, markedOutcome] = await Promise.all([
    store.getMarkedPledge(city.day),
    store.getPledgers(city.day),
    store.getAllUserActions(city.day - 1),
    store.getMarkedOutcome(city.day - 1),
  ]);
  const marked: Marked = {
    ...pickMarked(city.worldSeed, city.cycle, city.day, Object.keys(allYesterdayActions).length),
    pledged,
    savedYesterday: markedOutcome,
  };
  return c.json<PledgeResponse>({
    type: 'pledge',
    marked,
    pledge: buildPledgeInfo(pledgers, user.userId),
    player: updated,
  });
});

/**
 * World of Cities (Plan 2): the ranked cross-subreddit map, read from the
 * global registry. Read-only — the write path is the eligibility-gated upsert
 * in /init. Sub-gate subs still get the full map (eligible:false + their
 * subscriber count) so the client can show "join the world at 500".
 */
api.get('/world', async (c) => {
  const user = requireUser();
  if (!user) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();

  const [{ eligible, subscribers }, records] = await Promise.all([
    getWorldEligibility(store, new Date()),
    readWorldCities(redis.global),
  ]);

  const isYou = (subredditId: string, record: WorldCityRecord): boolean =>
    subredditId === context.subredditId ||
    (context.subredditName !== undefined &&
      record.subreddit === displaySubredditName(context.subredditName));
  let cities = rankCities(
    Object.entries(records).map(([subredditId, record]) =>
      toWorldCity(record, isYou(subredditId, record)),
    ),
  );

  // Empty world (fresh deploy, or the only sub is still under the gate): show the
  // caller their OWN city so the map is never blank. Not written to the global
  // registry — just surfaced in this caller's own view.
  if (cities.length === 0 && context.subredditId) {
    const localCity = await store.getCityState();
    if (localCity) {
      const [savedCount, todayActions] = await Promise.all([
        store.countMarkedSaved(),
        store.getAllUserActions(localCity.day),
      ]);
      const own = citySummary(
        context.subredditName ?? context.subredditId,
        localCity,
        savedCount,
        Object.keys(todayActions).length,
      );
      cities = [toWorldCity(own, true)];
    }
  }
  const yourIdx = cities.findIndex((city) => city.isYou);

  return c.json<WorldResponse>({
    type: 'world',
    cities,
    yourRank: yourIdx === -1 ? null : yourIdx + 1,
    totalCities: cities.length,
    eligible,
    subscribers,
    minSubscribers: BALANCE.world.minSubscribers,
  });
});

api.get('/timeline', async (c) => {
  const user = requireUser();
  if (!user) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();
  const entries = await store.getTimeline(30);
  return c.json<TimelineResponse>({ type: 'timeline', entries });
});

api.get('/leaderboard', async (c) => {
  const user = requireUser();
  if (!user) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();
  const [contribRows, scoutRows] = await Promise.all([
    store.topContributors(10),
    store.topScouts(10),
  ]);

  // Resolve usernames from the players hash (in parallel); fall back to
  // 'citizen' if unknown. The raw t2_* userId keys the leaderboard is stored
  // under NEVER leave the server — the client gets public usernames only.
  const resolve = (rows: { userId: string; score: number }[]): Promise<LeaderboardEntry[]> =>
    Promise.all(
      rows.map(async (r) => {
        const p = await store.getPlayer(r.userId);
        return { username: p?.username ?? 'citizen', score: Math.round(r.score) };
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

/**
 * Everything the Pixel Village HUD needs in one privacy-masked call: town
 * vitals, live zone tallies, and real villagers (masked). Read-only for
 * players, but runs lazy resolution like /init so the village works as a
 * first-open landing view even before the city exists.
 */
api.get('/village', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ApiError>({ status: 'error', message: 'postId missing from context' }, 400);
  }
  const user = requireUser();
  if (!user) {
    return c.json<ApiError>({ status: 'error', message: 'Log in to Reddit to play' }, 401);
  }

  const store = getStore();
  const { city } = await runLazyResolution(store, redisLike, new Date(), deriveWorldSeed());

  const [players, dayActions, timeline] = await Promise.all([
    store.getAllPlayers(),
    store.getDayActions(city.day),
    store.getTimeline(5),
  ]);

  const activeLaw =
    city.activeLaw && city.lawExpiresDay >= city.day
      ? BALANCE.laws[city.activeLaw as FactionId]
      : null;

  return c.json<VillageResponse>({
    type: 'village',
    villageName: 'THE LAST CITY',
    subreddit: context.subredditName ?? 'the sub',
    cycle: city.cycle,
    day: city.day,
    status: city.status,
    prosperity: city.morale,
    pills: { food: city.food, power: city.power, medicine: city.medicine, threat: city.threat },
    raidInDays: Math.max(
      0,
      Math.ceil((BALANCE.raid.triggerThreshold - city.threat) / BALANCE.passiveThreatRise),
    ),
    activeLawLabel: activeLaw?.label ?? null,
    zones: buildZones(dayActions),
    villagers: buildVillagers(players, city.day),
    onlineCount: players.filter((p) => p.lastActiveDay === city.day).length,
    totalCount: players.length,
    notices: timeline.map((e) => e.headline),
  });
});
