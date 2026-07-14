import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import { BALANCE } from '../../shared/balance';
import { getCrisis } from '../../shared/crises';
import { HOUSE_CAP, NAMED_HOUSE_LIMIT, tierForContribution } from '../../shared/houses';
import type {
  ActionRequest,
  ActionType,
  ActionResponse,
  ApiError,
  AvatarRequest,
  AvatarResponse,
  CityState,
  DamagedHouse,
  DomeState,
  DawnReport,
  ReconstructionState,
  FactionId,
  Forecast,
  HouseSummary,
  InitResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  Marked,
  PledgeRequest,
  PledgeResponse,
  PlayerProfile,
  RekindleResponse,
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
import { economyOf } from '../../shared/shop';
import { challengeProgress, dailyChallenge } from '../../shared/challenges';
import { cityNameFromSeed } from '../../shared/cityName';
import { clampAvatar, isValidAvatar } from '../../shared/avatar';
import { ACTION_TYPES, validateAction, validateRoleChange } from '../game/actionRules';
import { buildStatus } from '../game/building';
import { buildDrama } from '../game/drama';
import { pickMarked } from '../game/marked';
import { buildPledgeInfo, isPledgeKind, type PledgerEntry } from '../game/pledges';
import { buildStanding } from '../game/standing';
import { buildVillagers, buildZones, maskName } from '../game/village';
import { bumpRoleRep, effectiveEnergy, freshPlayer, resetPlayerForDay } from '../game/dayLogic';
import { awardContributionCoin } from '../game/economy';
import { damagedHouses, nextRebuildTarget, reconstructionState, type HouseRow } from '../game/reconstruction';
import { applyRepairs, chargeSegmentIndex, energyPct, mostDamagedSegment } from '../game/dome';
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
  damaged: [],
});

/** Named house rows for the damaged homes only (bounded, few per raid). */
const namedDamagedRows = async (
  store: Store,
  rows: { userId: string; index: number }[],
  damage: Record<string, 'destroyed' | 'damaged'>,
): Promise<HouseRow[]> => {
  const hit = rows.filter((r) => damage[r.userId] === 'destroyed' || damage[r.userId] === 'damaged');
  const players = await Promise.all(hit.map((r) => store.getPlayer(r.userId)));
  return hit.map((r, i) => ({ ...r, username: players[i]?.username ?? 'a survivor' }));
};

/** The shared rebuild state + the damaged-house list, from one set of reads. */
export const buildReconstruction = async (
  store: Store,
): Promise<{ state: ReconstructionState; damaged: DamagedHouse[]; rows: HouseRow[]; damage: Record<string, 'destroyed' | 'damaged'>; progress: Record<string, number> }> => {
  try {
    const [rows, damage, progress] = await Promise.all([
      store.getHouseRows(),
      store.getHouseDamage(),
      store.getRebuildProgress(),
    ]);
    const named = await namedDamagedRows(store, rows, damage);
    return {
      state: reconstructionState(named, damage, progress),
      damaged: damagedHouses(named, damage, progress),
      rows: named,
      damage,
      progress,
    };
  } catch {
    return {
      state: { active: false, required: 0, contributed: 0, destroyed: 0, damaged: 0, next: null },
      damaged: [],
      rows: [],
      damage: {},
      progress: {},
    };
  }
};

/** The dome's live state for the HUD (segments, energy %, repair pool, next mend). */
export const buildDomeState = async (store: Store): Promise<DomeState> => {
  try {
    const { segments, shield } = await store.getDomeState();
    return {
      segments,
      energyPct: energyPct(segments),
      shield,
      repairThreshold: BALANCE.dome.repairThreshold,
      nextRepairSegment: mostDamagedSegment(segments),
    };
  } catch {
    return { segments: [], energyPct: 0, shield: 0, repairThreshold: BALANCE.dome.repairThreshold, nextRepairSegment: null };
  }
};

/**
 * Auto-repair the dome from the shared shield pool: while the pool can afford a
 * mend and a damaged panel exists, fully restore the weakest one. Optimistic CAS
 * on the shared dome hash (watch -> read -> write) so concurrent contributors can
 * never double-spend the pool. Returns the segment indices repaired (for the
 * client to animate), or [] when nothing was mended. Never throws.
 */
export const settleDomeRepairs = async (store: Store, lockRedis: { watch: (...keys: string[]) => Promise<import('../game/userLock').LockTx> }): Promise<number[]> => {
  const repairedAll: number[] = [];
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const tx = await lockRedis.watch(KEYS.dome);
      const { segments, shield } = await store.getDomeState();
      const res = applyRepairs(segments, shield);
      if (res.repaired.length === 0) {
        await tx.unwatch();
        return repairedAll;
      }
      await tx.multi();
      const fields: Record<string, string> = { shield: String(res.pool) };
      for (let i = 0; i < res.segments.length; i++) fields[`seg${i}`] = String(res.segments[i]);
      await tx.hSet(KEYS.dome, fields);
      const results = await tx.exec();
      if (results.length > 0) return [...repairedAll, ...res.repaired];
      // Watched-key conflict: another contributor mended concurrently. Retry.
    }
  } catch {
    // A failed settle is harmless — the next contribution will mend.
  }
  return repairedAll;
};

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
    const { damaged } = await buildReconstruction(store);
    return { total, cap: HOUSE_CAP, founder, yours, named, damaged };
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

const queueTreasuryDeposit = async (
  tx: { hIncrBy(key: string, field: string, value: number): Promise<unknown> },
  amount: number,
): Promise<void> => {
  if (amount <= 0) return;
  await tx.hIncrBy(KEYS.cityTreasury, 'balance', amount);
  await tx.hIncrBy(KEYS.cityTreasury, 'collected', amount);
};

export const requireUser = (): { userId: string } | undefined => {
  const { userId } = context;
  return userId ? { userId } : undefined;
};

const withFactionRep = (
  player: PlayerProfile,
  raw: Record<string, string>,
  faction: FactionId,
  by: number,
): PlayerProfile => {
  const reps: Record<FactionId, number> = {
    builders: Number(raw.builders ?? 0),
    wardens: Number(raw.wardens ?? 0),
    seekers: Number(raw.seekers ?? 0),
    hearth: Number(raw.hearth ?? 0),
  };
  reps[faction] = (Number.isFinite(reps[faction]) ? reps[faction] : 0) + by;
  const order: FactionId[] = ['builders', 'wardens', 'seekers', 'hearth'];
  let leader: FactionId | null = null;
  let leaderRep = 0;
  for (const candidate of order) {
    if (Number.isFinite(reps[candidate]) && reps[candidate] > leaderRep) {
      leader = candidate;
      leaderRep = reps[candidate];
    }
  }
  return { ...player, faction: leader, factionRep: leaderRep };
};

const loadInitPlayer = async (
  store: Store,
  userId: string,
  cityDay: number,
  resolveUsername: () => Promise<string>,
): Promise<{ player: PlayerProfile; brandNew: boolean; firstVisitToday: boolean } | undefined> => {
  let resolvedUsername: string | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const lock = await beginUserLock(redis, userId);
    let player = await store.getPlayer(userId);
    const brandNew = !player;
    if (!player) {
      resolvedUsername ??= await resolveUsername();
      player = freshPlayer(userId, resolvedUsername, cityDay);
    }
    const firstVisitToday = !brandNew && player.lastActiveDay < cityDay;
    const reset = resetPlayerForDay(player, cityDay);
    if (!brandNew && reset === player) {
      await lock.abort();
      return { player, brandNew, firstVisitToday };
    }
    const committed = await lock.commit(async (tx) => {
      await tx.hSet(KEYS.players, { [userId]: JSON.stringify(reset) });
    });
    if (committed) return { player: reset, brandNew, firstVisitToday };
  }
  return undefined;
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
    dome: await store.getDomeSegments(),
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
  const loadedPlayer = await loadInitPlayer(
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
  if (!loadedPlayer) {
    return c.json<ApiError>({ status: 'error', message: 'Busy, try again' }, 409);
  }
  const { player, brandNew, firstVisitToday } = loadedPlayer;

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
    land,
    treasury,
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
    store.getLandExpansionState(),
    store.getTreasuryState(player),
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

  // Daily personal mission (the 100-level hook). The pick is deterministic
  // from (userId, day, worldSeed) — nothing stored — and progress is provable
  // from state this handler already loaded. Level rides the same lifetime
  // contribution score that drives house tiers. The completion bonus is
  // awarded exactly once via an NX claim key (cycle-scoped, 3-day TTL).
  const lifetimeScore = (await store.getContributionScore(user.userId)) ?? 0;
  let challengeDef = await store.getDailyChallenge(city.cycle, city.day, user.userId);
  if (!challengeDef) {
    challengeDef = dailyChallenge(
      user.userId,
      city.day,
      city.worldSeed,
      lifetimeScore,
      effectiveEnergy(player, city.day),
    );
    await store.setDailyChallenge(city.cycle, city.day, user.userId, challengeDef);
  }
  const cleanActions: Partial<Record<ActionType, number>> = {};
  for (const a of ACTION_TYPES) {
    const v = (yourActionsToday as Partial<Record<string, number>>)[a];
    if (typeof v === 'number') cleanActions[a] = v;
  }
  const chState = challengeProgress(challengeDef, {
    actionsToday: cleanActions,
    voted: !!yourCrisisVote,
    backedPlan: !!yourStrategyVote,
    pledged: pledge.usedToday,
  });
  if (chState.done && city.status === 'alive') {
    const claimed = await redisLike.set(
      KEYS.challengeDone(city.cycle, city.day, user.userId),
      '1',
      { nx: true, expiration: 3 * 24 * 3600 },
    );
    if (claimed) {
      await store.addContribution(user.userId, challengeDef.reward);
      // Completing your daily challenge REINFORCES the dome: the community's daily
      // effort is what charges the shield for the next raid (once per user/day).
      await store.chargeDomeSegment(
        chargeSegmentIndex(user.userId, city.day, city.worldSeed),
        BALANCE.dome.chargePerChallenge,
      );
    }
  }
  const challenge = { ...challengeDef, progress: chState.progress, done: chState.done };

  // World of Cities (Plan 2): keep this sub's global-registry record fresh.
  // Cheap on the common path (one cached-meta read for sub-gate subs; one
  // global hSet when eligible) and never throws.
  await syncWorldRegistry(store, city, new Date());

  // Dawn report: yesterday's story + this player's part in it. Only when a
  // timeline entry for yesterday exists (i.e. at least one resolution ran).
  const timelinePreview = timeline[0] ?? null;
  // Shared rebuild queue: computed once, reused for the owner line + response.
  const reconstruction = await buildReconstruction(store);
  const myDamage = reconstruction.damage[user.userId] ?? null;
  // Settle any pending dome mends the shared pool can now afford, then snapshot it.
  if (city.status === 'alive') await settleDomeRepairs(store, redis);
  const dome = await buildDomeState(store);
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
    if (myDamage === 'destroyed') {
      yourImpact.push('Your house was destroyed in the raid. The city has begun rebuilding it.');
    } else if (myDamage === 'damaged') {
      yourImpact.push('Your house was damaged in the raid. The city is repairing it.');
    }
    dawnReport = {
      day: timelinePreview.day,
      citySummary: timelinePreview.events.slice(0, 5),
      yourImpact,
      title: player.title,
      raidAftermath: timelinePreview.raidAftermath ?? null,
    };
  }

  const activeLaw =
    city.activeLaw && city.lawExpiresDay >= city.day
      ? BALANCE.laws[city.activeLaw as FactionId]
      : null;

  return c.json<InitResponse>({
    type: 'init',
    postId,
    cityName: cityNameFromSeed(city.worldSeed),
    challenge,
    economy: economyOf(player, city.cycle, city.day),
    land,
    treasury,
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
    reconstruction: reconstruction.state,
    dome,
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
  const lock = await beginUserLock(redis, user.userId);
  const player = await store.getPlayer(user.userId);
  if (!player) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);
  }

  const error = validateRoleChange(player, city.day, body.role);
  if (error) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: error }, 400);
  }

  const updated = { ...player, role: body.role, roleChangedDay: city.day };
  const committed = await lock.commit(async (tx) => {
    await tx.hSet(KEYS.players, { [user.userId]: JSON.stringify(updated) });
  });
  if (!committed) {
    return c.json<ApiError>({ status: 'error', message: 'Busy, try again' }, 409);
  }
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
  const lock = await beginUserLock(redis, user.userId);
  const player = await store.getPlayer(user.userId);
  if (!player) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);
  }

  const updated = { ...player, avatar: clampAvatar(body.avatar) };
  const committed = await lock.commit(async (tx) => {
    await tx.hSet(KEYS.players, { [user.userId]: JSON.stringify(updated) });
  });
  if (!committed) {
    return c.json<ApiError>({ status: 'error', message: 'Busy, try again' }, 409);
  }
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

  // build_city labor pays down the shared rebuild queue FIRST (homes before new
  // buildings). Peek before locking to decide whether to also watch the shared
  // rebuild key so concurrent contributors serialize on it (never over-apply).
  const routeToRebuild = body.action === 'build_city' && (await buildReconstruction(store)).state.active;

  // Per-user optimistic energy spend: watch ONLY this user's lock key, so two
  // DIFFERENT users acting in the same instant never abort each other — only a
  // genuine same-user double-tap conflicts (see beginUserLock). A rebuild
  // contribution additionally watches the shared rebuild key.
  const lock = await beginUserLock(redis, user.userId, routeToRebuild ? [KEYS.housesRebuild] : []);
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

  // Under the lock, resolve the next home the city's labor should rebuild. The
  // watch on housesRebuild makes this read consistent with the commit below.
  let rebuildTarget: { userId: string; index: number; username: string; status: 'destroyed' | 'damaged'; done: number; needed: number } | null = null;
  if (routeToRebuild) {
    const [rows, damage, progress] = await Promise.all([
      store.getHouseRows(),
      store.getHouseDamage(),
      store.getRebuildProgress(),
    ]);
    const named = await namedDamagedRows(store, rows, damage);
    rebuildTarget = nextRebuildTarget(named, damage, progress);
  }

  const faction = BALANCE.factionPerAction[body.action];
  // Streak dividend: a long daily flame adds bounded bonus standing to each
  // accepted action (personal ledger only — never a city vital). streak 3 -> +1,
  // 6 -> +2, ... capped at streakReward.cap. A fresh streak (1) adds nothing, so
  // this leaves day-one balance untouched and only rewards sustained returning.
  const streakBonus = Math.min(
    BALANCE.streakReward.cap,
    Math.floor(player.streak / BALANCE.streakReward.step) * BALANCE.streakReward.perStep,
  );
  const actionAward = BALANCE.contributionPerAction + streakBonus;
  const updated: PlayerProfile = {
    ...player,
    energyUsedToday: player.energyUsedToday + 1,
    totalContribution: player.totalContribution + actionAward,
  };
  const factionUpdated = faction
    ? withFactionRep(
        updated,
        await redis.hGetAll(KEYS.playerFactions(city.cycle, user.userId)),
        faction,
        BALANCE.factionRepPerAction,
      )
    : updated;
  // validateAction guarantees a role. Compute every whole-profile field before
  // exec so no stale save can run after the per-user lock has been released.
  const repped = bumpRoleRep(factionUpdated, factionUpdated.role!, BALANCE.roleRepPerAction);
  // Coin award rides the SAME commit as the accepted action: a 409'd retry
  // re-runs the whole computation, so it can never mint twice.
  const coined = awardContributionCoin(repped.player, city.cycle, city.day);
  const finalPlayer = coined.player;
  // Personal action history is a JSON blob, so its read-modify-write must ride
  // the SAME per-user lock as the energy spend — done post-commit it raced a
  // second tab and lost actions (breaking mission progress).
  const mine = await store.getUserActions(city.day, user.userId);
  mine[body.action] = (mine[body.action] ?? 0) + 1;
  const committed = await lock.commit(async (tx) => {
    await tx.hSet(KEYS.players, { [user.userId]: JSON.stringify(finalPlayer) });
    if (faction) {
      await tx.hIncrBy(
        KEYS.playerFactions(city.cycle, user.userId),
        faction,
        BALANCE.factionRepPerAction,
      );
    }
    await tx.hIncrBy(KEYS.dayActions(city.day), body.action, 1);
    await tx.hSet(KEYS.dayUserActions(city.day), { [user.userId]: JSON.stringify(mine) });
    // Rebuild labor rides the same commit — one point toward the next home.
    if (rebuildTarget) await tx.hIncrBy(KEYS.housesRebuild, rebuildTarget.userId, 1);
    // Automatic civic share: this contribution's treasury deposit rides along too.
    await queueTreasuryDeposit(tx, coined.treasuryPaid);
  });
  if (!committed) {
    return c.json<ApiError>({ status: 'error', message: 'Busy, try again' }, 409);
  }

  // A home the community's labor just restored (this point completed it).
  const rebuilt =
    rebuildTarget && rebuildTarget.done + 1 >= rebuildTarget.needed
      ? { username: rebuildTarget.username, index: rebuildTarget.index }
      : null;

  // Non-critical bookkeeping outside the tx (contribution mirror + aggregates),
  // in parallel — every write here is an atomic increment or NX claim, never a
  // read-modify-write. Faction influence rides along when the action maps to
  // a faction.
  await Promise.all([
    store.registerHouse(user.userId),
    store.addContribution(user.userId, actionAward),
    // Every accepted contribution feeds the shared shield pool that mends the dome.
    store.addDomeShield(BALANCE.dome.shieldPerContribution),
    ...(faction
      ? [store.bumpFactionInfluence(city.day, faction, BALANCE.factionRepPerAction)]
      : []),
  ]);
  // With the pool topped up, auto-repair the weakest panel(s) the pool can afford.
  const domeRepaired = await settleDomeRepairs(store, redis);

  return c.json<ActionResponse>({
    type: 'action',
    player: finalPlayer,
    effectiveEnergy: effectiveEnergy(finalPlayer, city.day),
    yourActionsToday: mine,
    unlockedTitle: repped.unlockedTitle,
    coinsGained: coined.coinsGained,
    treasuryPaid: coined.treasuryPaid,
    economy: coined.economy,
    reconstruction: (await buildReconstruction(store)).state,
    rebuilt,
    dome: await buildDomeState(store),
    domeRepaired: domeRepaired.length > 0 ? domeRepaired : null,
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
    return c.json<ApiError>({ status: 'error', message: 'A new day has dawned, reload.' }, 409);
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
  const voter = await store.getPlayer(user.userId);
  if (!voter) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);
  }
  const existing = await store.getVoterChoice(city.day, user.userId);
  if (existing) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'You already voted today.' }, 409);
  }
  // Coin award rides the vote's own commit (accepted contribution = 1 Coin).
  const voterCoined = awardContributionCoin(voter, city.cycle, city.day);
  const committed = await lock.commit(async (tx) => {
    await tx.hSet(votersKey, { [user.userId]: body.optionId });
    await tx.hIncrBy(KEYS.dayVotes(city.day), body.optionId, 1);
    await tx.hSet(KEYS.players, { [user.userId]: JSON.stringify(voterCoined.player) });
    await queueTreasuryDeposit(tx, voterCoined.treasuryPaid);
  });
  if (!committed) {
    return c.json<ApiError>({ status: 'error', message: 'Busy, try again' }, 409);
  }
  await store.registerHouse(user.userId);
  await store.addDomeShield(BALANCE.dome.shieldPerContribution);

  return c.json<VoteResponse>({
    type: 'vote',
    crisisVotes: await store.getVoteTally(city.day),
    yourCrisisVote: body.optionId,
    coinsGained: voterCoined.coinsGained,
    treasuryPaid: voterCoined.treasuryPaid,
    economy: voterCoined.economy,
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
  const backer = await store.getPlayer(user.userId);
  if (!backer) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);
  }
  const existing = await store.getStrategyChoice(city.day, user.userId);
  if (existing) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'You already backed a plan today.' }, 409);
  }
  // Coin award rides the plan's own commit (accepted contribution = 1 Coin).
  const backerCoined = awardContributionCoin(backer, city.cycle, city.day);
  const committed = await lock.commit(async (tx) => {
    await tx.hSet(votersKey, { [user.userId]: body.planId });
    await tx.hIncrBy(KEYS.dayStrategyPlan(city.day), body.planId, 1);
    await tx.hSet(KEYS.players, { [user.userId]: JSON.stringify(backerCoined.player) });
    await queueTreasuryDeposit(tx, backerCoined.treasuryPaid);
  });
  if (!committed) {
    return c.json<ApiError>({ status: 'error', message: 'Busy, try again' }, 409);
  }
  await store.registerHouse(user.userId);
  await store.addDomeShield(BALANCE.dome.shieldPerContribution);

  return c.json<StrategyResponse>({
    type: 'strategy',
    strategyVotes: await store.getStrategyTally(city.day),
    yourStrategyVote: body.planId,
    coinsGained: backerCoined.coinsGained,
    treasuryPaid: backerCoined.treasuryPaid,
    economy: backerCoined.economy,
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
  // Per-user optimistic lock (see /vote): different pledgers never false-conflict.
  const pledgersKey = KEYS.dayPledgers(city.day);
  const lock = await beginUserLock(redis, user.userId);
  const player = await store.getPlayer(user.userId);
  if (!player) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);
  }
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
  // Coin award rides the pledge's own commit (accepted contribution = 1 Coin).
  const coined = awardContributionCoin(
    {
      ...player,
      totalContribution: player.totalContribution + BALANCE.contributionPerPledge,
    },
    city.cycle,
    city.day,
  );
  const updated = coined.player;
  const committed = await lock.commit(async (tx) => {
    await tx.hSet(KEYS.players, { [user.userId]: JSON.stringify(updated) });
    await tx.hSet(pledgersKey, { [user.userId]: JSON.stringify(entry) });
    await tx.hIncrBy(KEYS.dayMarked(city.day), 'pledged', BALANCE.marked.pledgePerTap);
    await tx.hIncrBy(KEYS.dayMarked(city.day), body.kind, 1);
    await queueTreasuryDeposit(tx, coined.treasuryPaid);
  });
  if (!committed) {
    return c.json<ApiError>({ status: 'error', message: 'Busy, try again' }, 409);
  }

  // Public credit: pledges count toward contribution/status (never energy).
  // The whole profile was committed inside the per-user transaction above.
  await Promise.all([
    store.registerHouse(user.userId),
    store.addContribution(user.userId, BALANCE.contributionPerPledge),
    store.addDomeShield(BALANCE.dome.shieldPerContribution),
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
    coinsGained: coined.coinsGained,
    treasuryPaid: coined.treasuryPaid,
    economy: coined.economy,
  });
});

/**
 * Rekindle — streak insurance. A lapse kills the streak but stores its ghost
 * (lapsedStreak, see resetPlayerForDay); this endpoint restores it by BURNING
 * standing (lifetime contribution: cost = lapsedStreak × costPerDay). Standing
 * powers levels, house tiers, and the leaderboard, so the price is real and
 * visible — a depleting resource spent to keep the flame.
 */
api.post('/rekindle', async (c) => {
  const user = requireUser();
  if (!user) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();
  const city = await store.getCityState();
  if (!city || city.status !== 'alive') {
    return c.json<ApiError>({ status: 'error', message: 'The city is beyond saving.' }, 409);
  }

  const lock = await beginUserLock(redis, user.userId);
  const player = await store.getPlayer(user.userId);
  if (!player) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);
  }
  const lapsed = player.lapsedStreak ?? 0;
  if (lapsed < BALANCE.rekindle.minStreak || lapsed <= player.streak) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'No flame to rekindle.' }, 400);
  }
  const cost = lapsed * BALANCE.rekindle.costPerDay;
  const standing = (await store.getContributionScore(user.userId)) ?? 0;
  if (standing < cost) {
    await lock.abort();
    return c.json<ApiError>(
      { status: 'error', message: `Rekindling this flame costs ${cost} standing.` },
      400,
    );
  }

  const updated = { ...player, streak: lapsed, lapsedStreak: 0 };
  const committed = await lock.commit(async (tx) => {
    await tx.hSet(KEYS.players, { [user.userId]: JSON.stringify(updated) });
    await tx.zIncrBy(KEYS.lbContribution, user.userId, -cost);
  });
  if (!committed) {
    return c.json<ApiError>({ status: 'error', message: 'Busy — try again' }, 409);
  }
  return c.json<RekindleResponse>({ type: 'rekindle', player: updated, cost });
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
