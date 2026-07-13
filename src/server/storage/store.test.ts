import { describe, expect, it } from 'vitest';
import { Store, type RedisLike } from './store';
import type { LockableRedis, LockTx } from '../game/userLock';
import type { CityState, PlayerProfile } from '../../shared/types';
import { KEYS } from './redisKeys';

/**
 * Minimal in-memory fake covering the subset Store uses, PLUS a real model of
 * WATCH/MULTI/EXEC optimistic concurrency (used by beginUserLock). Every
 * mutating op bumps a per-key version; a transaction remembers the versions of
 * its watched keys at watch() time and exec() aborts (returns []) if any of them
 * changed in the meantime — exactly Redis's optimistic-lock contract. Exported
 * for reuse across the test suite.
 */
export type FakeRedis = RedisLike & LockableRedis;

export const makeFakeRedis = (): FakeRedis => {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const zsets = new Map<string, Map<string, number>>();
  const versions = new Map<string, number>();
  const bump = (k: string) => versions.set(k, (versions.get(k) ?? 0) + 1);
  const ver = (k: string) => versions.get(k) ?? 0;
  const hash = (k: string) => {
    if (!hashes.has(k)) hashes.set(k, new Map());
    return hashes.get(k)!;
  };
  const zset = (k: string) => {
    if (!zsets.has(k)) zsets.set(k, new Map());
    return zsets.get(k)!;
  };

  // Mutation impls shared by the direct methods and the queued transaction
  // commands, so both go through the same version bookkeeping.
  const setImpl = (k: string, v: string, opts?: { nx?: boolean }): string => {
    if (opts?.nx && strings.has(k)) return '';
    strings.set(k, v);
    bump(k);
    return 'OK';
  };
  const hSetImpl = (k: string, fv: Record<string, string>): number => {
    for (const [f, v] of Object.entries(fv)) hash(k).set(f, v);
    bump(k);
    return 0;
  };
  const hIncrByImpl = (k: string, f: string, by: number): number => {
    const next = Number(hash(k).get(f) ?? '0') + by;
    hash(k).set(f, String(next));
    bump(k);
    return next;
  };
  const incrByImpl = (k: string, by: number): number => {
    const next = Number(strings.get(k) ?? '0') + by;
    strings.set(k, String(next));
    bump(k);
    return next;
  };

  return {
    async get(k) { return strings.get(k); },
    async set(k, v, opts) { return setImpl(k, v, opts); },
    async del(...keys) { for (const k of keys) { strings.delete(k); hashes.delete(k); zsets.delete(k); bump(k); } },
    async expire() { /* TTL not simulated */ },
    async hGet(k, f) { return hash(k).get(f); },
    async hSet(k, fv) { return hSetImpl(k, fv); },
    async hGetAll(k) { return Object.fromEntries(hash(k)); },
    async hIncrBy(k, f, by) { return hIncrByImpl(k, f, by); },
    async hDel(k, fields) { for (const f of fields) hash(k).delete(f); bump(k); },
    async zIncrBy(k, m, by) {
      const next = (zset(k).get(m) ?? 0) + by;
      zset(k).set(m, next);
      bump(k);
      return next;
    },
    async zAdd(k, ...members) { for (const m of members) zset(k).set(m.member, m.score); bump(k); return members.length; },
    async zScore(k, m) { return zset(k).get(m); },
    async zRange(k, start, stop, opts) {
      const all = [...zset(k).entries()]
        .sort((a, b) => (opts?.reverse ? b[1] - a[1] : a[1] - b[1]))
        .map(([member, score]) => ({ member, score }));
      const stopIdx = typeof stop === 'number' && stop === -1 ? all.length - 1 : Number(stop);
      return all.slice(Number(start), stopIdx + 1);
    },
    async watch(...keys: string[]): Promise<LockTx> {
      // snapshot the watched keys' versions at watch time
      const snapshot = new Map(keys.map((k) => [k, ver(k)] as const));
      const queued: Array<() => unknown> = [];
      const tx: LockTx = {
        async multi() { return undefined; },
        async hSet(k, fv) { queued.push(() => hSetImpl(k, fv)); return undefined; },
        async hIncrBy(k, f, by) { queued.push(() => hIncrByImpl(k, f, by)); return undefined; },
        async zIncrBy(k, m, by) {
          queued.push(() => {
            const next = (zset(k).get(m) ?? 0) + by;
            zset(k).set(m, next);
            bump(k);
            return next;
          });
          return undefined;
        },
        async incrBy(k, by) { queued.push(() => incrByImpl(k, by)); return undefined; },
        async unwatch() { snapshot.clear(); return undefined; },
        async exec() {
          // any watched key modified since watch() → abort with empty array
          for (const [k, v] of snapshot) if (ver(k) !== v) return [];
          return queued.map((cmd) => cmd());
        },
      };
      return tx;
    },
  };
};

const city: CityState = {
  day: 1, cycle: 1, status: 'alive', worldSeed: 0, trait: 'standard',
  population: 120, food: 60, power: 55, medicine: 20,
  morale: 60, threat: 30, defense: 40,
  crisisId: 'first_light', activeLaw: null, lawExpiresDay: 0,
  cityLevel: 0, buildProgress: 0, unlockedBuildings: [],
};

const player: PlayerProfile = {
  userId: 't2_abc', username: 'tester', role: 'scout', roleChangedDay: 1,
  faction: null, factionRep: 0, roleRep: {}, title: null, avatar: null,
  energyUsedToday: 0, lastActiveDay: 1,
  injuredUntilDay: 0, totalContribution: 0, streak: 1,
};

describe('Store', () => {
  it('round-trips city state', async () => {
    const store = new Store(makeFakeRedis());
    expect(await store.getCityState()).toBeUndefined();
    await store.setCityState(city);
    expect(await store.getCityState()).toEqual(city);
  });

  it('backfills worldSeed/trait when reading pre-W1 city JSON', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    // Simulate a city stored before per-world seeds shipped.
    const { worldSeed: _ws, trait: _tr, ...legacy } = city;
    await redis.set('city:state', JSON.stringify(legacy));
    const loaded = await store.getCityState();
    expect(loaded).toEqual({ ...legacy, worldSeed: 0, trait: 'standard' });
  });

  it('does not clobber stored worldSeed/trait when present', async () => {
    const store = new Store(makeFakeRedis());
    await store.setCityState({ ...city, worldSeed: 987, trait: 'frozen' });
    const loaded = await store.getCityState();
    expect(loaded?.worldSeed).toBe(987);
    expect(loaded?.trait).toBe('frozen');
  });

  it('backfills build-from-zero fields when reading pre-progression city JSON', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    // Simulate a city stored before city progression shipped.
    const { cityLevel: _cl, buildProgress: _bp, unlockedBuildings: _ub, ...legacy } = city;
    await redis.set('city:state', JSON.stringify(legacy));
    const loaded = await store.getCityState();
    expect(loaded?.cityLevel).toBe(0);
    expect(loaded?.buildProgress).toBe(0);
    expect(loaded?.unlockedBuildings).toEqual([]);
  });

  it('does not clobber stored build progression when present', async () => {
    const store = new Store(makeFakeRedis());
    await store.setCityState({ ...city, cityLevel: 2, buildProgress: 15, unlockedBuildings: ['shelter', 'farm'] });
    const loaded = await store.getCityState();
    expect(loaded?.cityLevel).toBe(2);
    expect(loaded?.buildProgress).toBe(15);
    expect(loaded?.unlockedBuildings).toEqual(['shelter', 'farm']);
  });

  it('returns undefined for malformed stored city JSON', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    await redis.set('city:state', '{bad');
    expect(await store.getCityState()).toBeUndefined();
  });

  // getPlayer/getAllPlayers backfill the Coin economy on read — pre-economy
  // saves come back broke, not broken. Explicit stored fields always win.
  const revived = (p: PlayerProfile): PlayerProfile => ({
    coins: 0,
    coinsEarnedToday: 0,
    coinsEarnedCycle: 0,
    coinsEarnedDay: 0,
    ownedCosmetics: [],
    equippedCosmetics: {},
    ...p,
  });

  it('round-trips player profiles in the players hash', async () => {
    const store = new Store(makeFakeRedis());
    expect(await store.getPlayer('t2_abc')).toBeUndefined();
    await store.savePlayer(player);
    expect(await store.getPlayer('t2_abc')).toEqual(revived(player));
  });

  it('skips malformed stored player JSON', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    await store.savePlayer(player);
    await redis.hSet('players', { t2_bad: '{bad' });
    expect(await store.getPlayer('t2_bad')).toBeUndefined();
    expect(await store.getAllPlayers()).toEqual([revived(player)]);
  });

  it('backfills roleRep/title when reading legacy player JSON', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    // Simulate a profile stored before the reward layer shipped.
    const { roleRep: _rr, title: _t, ...legacy } = player;
    await redis.hSet('players', { t2_abc: JSON.stringify(legacy) });
    const loaded = await store.getPlayer('t2_abc');
    expect(loaded).toEqual(revived({ ...legacy, roleRep: {}, title: null }));
  });

  it('getAllPlayers returns every saved profile, legacy JSON backfilled', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    await store.savePlayer(player);
    // Second profile written as legacy JSON (pre-reward-layer shape) directly.
    const { roleRep: _rr, title: _t, ...legacy } = { ...player, userId: 't2_old', username: 'oldie' };
    await redis.hSet('players', { t2_old: JSON.stringify(legacy) });
    const all = await store.getAllPlayers();
    expect(all).toHaveLength(2);
    const byId = Object.fromEntries(all.map((p) => [p.userId, p]));
    expect(byId['t2_abc']).toEqual(revived(player));
    expect(byId['t2_old']).toEqual(revived({ ...legacy, roleRep: {}, title: null }));
  });

  it('does not clobber stored roleRep/title when present', async () => {
    const store = new Store(makeFakeRedis());
    await store.savePlayer({ ...player, roleRep: { scout: 30 }, title: 'Runner' });
    const loaded = await store.getPlayer('t2_abc');
    expect(loaded?.roleRep).toEqual({ scout: 30 });
    expect(loaded?.title).toBe('Runner');
  });

  it('backfills avatar:null when reading pre-avatar player JSON', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    // Profile stored before the avatar layer shipped (no `avatar` field).
    const { avatar: _av, ...legacy } = player;
    await redis.hSet('players', { t2_abc: JSON.stringify(legacy) });
    const loaded = await store.getPlayer('t2_abc');
    expect(loaded).toEqual(revived({ ...legacy, avatar: null }));
  });

  it('round-trips a saved avatar', async () => {
    const store = new Store(makeFakeRedis());
    const avatar = { name: 'Ash', gender: 'nonbinary', skin: 2, hair: 4, hairStyle: 1, outfit: 2 } as const;
    await store.savePlayer({ ...player, avatar });
    const loaded = await store.getPlayer('t2_abc');
    expect(loaded?.avatar).toEqual(avatar);
  });

  it('preserves valid economy data and rejects malformed balances and inventory', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    await store.savePlayer({
      ...player,
      coins: 14,
      coinsEarnedToday: 3,
      coinsEarnedCycle: 2,
      coinsEarnedDay: 6,
      ownedCosmetics: ['hearth_lantern', 'slate_roof'],
      equippedCosmetics: { light: 'hearth_lantern', roof: 'slate_roof' },
    });
    expect(await store.getPlayer(player.userId)).toMatchObject({
      coins: 14,
      coinsEarnedToday: 3,
      coinsEarnedCycle: 2,
      coinsEarnedDay: 6,
      ownedCosmetics: ['hearth_lantern', 'slate_roof'],
      equippedCosmetics: { light: 'hearth_lantern', roof: 'slate_roof' },
    });

    await redis.hSet(KEYS.players, {
      t2_bad_economy: JSON.stringify({
        ...player,
        userId: 't2_bad_economy',
        coins: -99,
        coinsEarnedToday: 'five',
        coinsEarnedCycle: -2,
        coinsEarnedDay: 4.5,
        ownedCosmetics: ['hearth_lantern', 'unknown', 'hearth_lantern'],
        equippedCosmetics: {
          light: 'hearth_lantern',
          roof: 'hearth_lantern',
          yard: 'unknown',
        },
      }),
    });
    expect(await store.getPlayer('t2_bad_economy')).toMatchObject({
      coins: 0,
      coinsEarnedToday: 0,
      coinsEarnedCycle: 0,
      coinsEarnedDay: 0,
      ownedCosmetics: ['hearth_lantern'],
      equippedCosmetics: { light: 'hearth_lantern' },
    });
  });

  it('records actions into aggregate and per-user logs', async () => {
    const store = new Store(makeFakeRedis());
    await store.recordAction(3, 't2_abc', 'grow_food');
    await store.recordAction(3, 't2_abc', 'grow_food');
    await store.recordAction(3, 't2_x', 'guard_wall');
    expect(await store.getDayActions(3)).toEqual({ grow_food: 2, guard_wall: 1 });
    expect(await store.getUserActions(3, 't2_abc')).toEqual({ grow_food: 2 });
  });

  it('getAllUserActions returns every acting user for the day', async () => {
    const store = new Store(makeFakeRedis());
    await store.recordAction(3, 't2_abc', 'grow_food');
    await store.recordAction(3, 't2_x', 'guard_wall');
    expect(await store.getAllUserActions(3)).toEqual({
      t2_abc: { grow_food: 1 },
      t2_x: { guard_wall: 1 },
    });
  });

  it('records votes and reads back the voter choice', async () => {
    const store = new Store(makeFakeRedis());
    expect(await store.getVoterChoice(2, 't2_abc')).toBeUndefined();
    await store.recordVote(2, 't2_abc', 'a');
    expect(await store.getVoterChoice(2, 't2_abc')).toBe('a');
    expect(await store.getVoteTally(2)).toEqual({ a: 1 });
  });

  it('bumps and reads faction influence for the day', async () => {
    const store = new Store(makeFakeRedis());
    await store.bumpFactionInfluence(5, 'builders', 3);
    await store.bumpFactionInfluence(5, 'builders', 2);
    await store.bumpFactionInfluence(5, 'seekers', 1);
    expect(await store.getFactionInfluence(5)).toEqual({ builders: 5, wardens: 0, seekers: 1, hearth: 0 });
  });

  it('bumping player faction rep sets faction to the leader', async () => {
    const store = new Store(makeFakeRedis());
    await store.savePlayer(player);
    const p1 = await store.bumpPlayerFactionRep(1, 't2_abc', 'builders', 3);
    expect(p1?.faction).toBe('builders');
    expect(p1?.factionRep).toBe(3);
    const p2 = await store.bumpPlayerFactionRep(1, 't2_abc', 'wardens', 4);
    expect(p2?.faction).toBe('wardens');
    expect(p2?.factionRep).toBe(4);
    const p3 = await store.bumpPlayerFactionRep(1, 't2_abc', 'wardens', 0);
    expect(p3?.faction).toBe('wardens');
  });

  it('scopes faction rep by cycle so a reset does not resurrect old leanings', async () => {
    const store = new Store(makeFakeRedis());
    await store.savePlayer(player);
    await store.bumpPlayerFactionRep(1, 't2_abc', 'seekers', 9);
    // A fresh cycle sees no prior rep.
    const fresh = await store.bumpPlayerFactionRep(2, 't2_abc', 'builders', 2);
    expect(fresh?.faction).toBe('builders');
    expect(fresh?.factionRep).toBe(2);
  });

  it('returns undefined when bumping rep for a nonexistent player', async () => {
    const store = new Store(makeFakeRedis());
    expect(await store.bumpPlayerFactionRep(1, 't2_ghost', 'builders', 1)).toBeUndefined();
  });

  it('appends timeline entries and reads them newest-first', async () => {
    const store = new Store(makeFakeRedis());
    await store.appendTimeline({ day: 1, cycle: 1, headline: 'Day 1', events: [], deltas: {}, crisisId: 'first_light', winningOptionId: null });
    await store.appendTimeline({ day: 2, cycle: 1, headline: 'Day 2', events: [], deltas: {}, crisisId: 'refugee_convoy', winningOptionId: 'a' });
    const entries = await store.getTimeline(10);
    expect(entries.map((e) => e.day)).toEqual([2, 1]);
  });

  it('keeps same-numbered days from different cycles in the chronicle', async () => {
    const store = new Store(makeFakeRedis());
    await store.appendTimeline({ day: 1, cycle: 1, headline: 'First camp', events: [], deltas: {}, crisisId: 'first_light', winningOptionId: null });
    await store.appendTimeline({ day: 1, cycle: 2, headline: 'From the ashes', events: [], deltas: {}, crisisId: 'first_light', winningOptionId: null });
    expect((await store.getTimeline(10)).map((entry) => entry.headline)).toEqual([
      'From the ashes',
      'First camp',
    ]);
  });

  it('skips malformed timeline entries', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    await store.appendTimeline({ day: 1, cycle: 1, headline: 'Day 1', events: [], deltas: {}, crisisId: 'first_light', winningOptionId: null });
    await redis.hSet('timeline', { bad: '{bad' });
    expect((await store.getTimeline(10)).map((e) => e.day)).toEqual([1]);
  });

  it('rejects valid JSON of the wrong shape everywhere state is parsed', async () => {
    // safeParse only catches broken JSON — "7" and "\"hello\"" parse fine but
    // must never impersonate a city, player, pledge, outcome, or timeline.
    const redis = makeFakeRedis();
    const store = new Store(redis);

    await redis.set('city:state', '7');
    expect(await store.getCityState()).toBeUndefined();
    await redis.set('city:state', '"hello"');
    expect(await store.getCityState()).toBeUndefined();

    await redis.hSet('players', { t2_bad: '"hello"', t2_num: '7', t2_arr: '[1,2]' });
    expect(await store.getPlayer('t2_bad')).toBeUndefined();
    expect(await store.getPlayer('t2_num')).toBeUndefined();
    expect(await store.getAllPlayers()).toEqual([]);

    await redis.hSet('day:3:userActions', { t2_bad: '"guard_wall"' });
    expect(await store.getUserActions(3, 't2_bad')).toEqual({});
    expect(await store.getAllUserActions(3)).toEqual({});
    // recordAction heals the corrupt blob instead of crashing on it
    await store.recordAction(3, 't2_bad', 'guard_wall');
    expect(await store.getUserActions(3, 't2_bad')).toEqual({ guard_wall: 1 });

    await redis.hSet('day:3:pledgers', { t2_bad: '{"kind":"nope"}', t2_num: '7' });
    expect(await store.getPledger(3, 't2_bad')).toBeUndefined();
    expect(await store.getPledgers(3)).toEqual({});

    await redis.hSet('marked:outcomes', { '3': '17', '4': '{"name":"Mira"}' });
    expect(await store.getMarkedOutcome(3)).toBeNull();
    expect(await store.getMarkedOutcome(4)).toBeNull();
    expect(await store.countMarkedSaved()).toBe(0);

    await store.appendTimeline({ day: 2, cycle: 1, headline: 'Real day', events: [], deltas: {}, crisisId: 'first_light', winningOptionId: null });
    await redis.hSet('timeline', { wrongShape: '"hello"', numeric: '7' });
    expect((await store.getTimeline(10)).map((e) => e.day)).toEqual([2]);
  });

  it('returns top contributors highest-first, capped at the limit', async () => {
    const store = new Store(makeFakeRedis());
    await store.addContribution('t2_a', 30);
    await store.addContribution('t2_b', 90);
    await store.addContribution('t2_c', 60);
    expect(await store.topContributors(2)).toEqual([
      { userId: 't2_b', score: 90 },
      { userId: 't2_c', score: 60 },
    ]);
  });

  it('returns top scouts by best haul, highest-first', async () => {
    const store = new Store(makeFakeRedis());
    await store.recordScoutHaul('t2_a', 4);
    await store.recordScoutHaul('t2_b', 9);
    await store.recordScoutHaul('t2_a', 7); // improves a's best to 7
    expect(await store.topScouts(10)).toEqual([
      { userId: 't2_b', score: 9 },
      { userId: 't2_a', score: 7 },
    ]);
  });

  // ----- hook layer: the Marked + one-tap pledges -----

  it('bumps and reads the marked pledge counter (0 by default, 0-bump no-op)', async () => {
    const store = new Store(makeFakeRedis());
    expect(await store.getMarkedPledge(3)).toBe(0);
    await store.bumpMarkedPledge(3, 5);
    await store.bumpMarkedPledge(3, 5);
    await store.bumpMarkedPledge(3, 0);
    expect(await store.getMarkedPledge(3)).toBe(10);
    expect(await store.getMarkedPledge(4)).toBe(0); // day-scoped
  });

  it('counts pledge kinds separately from the pledged counter', async () => {
    const store = new Store(makeFakeRedis());
    await store.bumpMarkedPledge(3, 5);
    await store.bumpPledgeKind(3, 'stand_vigil');
    await store.bumpPledgeKind(3, 'stand_vigil');
    await store.bumpPledgeKind(3, 'share_rations');
    expect(await store.getPledgeKindCounts(3)).toEqual({ stand_vigil: 2, share_rations: 1 });
  });

  it('round-trips pledger entries (one-per-day lock reads getPledger)', async () => {
    const store = new Store(makeFakeRedis());
    const entry = { kind: 'run_messages' as const, name: 'ali•••', at: 42, contribution: 30 };
    expect(await store.getPledger(2, 't2_abc')).toBeUndefined();
    await store.recordPledger(2, 't2_abc', entry);
    expect(await store.getPledger(2, 't2_abc')).toEqual(entry);
    expect(await store.getPledgers(2)).toEqual({ t2_abc: entry });
  });

  it('skips malformed pledger entries', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    const entry = { kind: 'run_messages' as const, name: 'ali•••', at: 42, contribution: 30 };
    await store.recordPledger(2, 't2_abc', entry);
    await redis.hSet('day:2:pledgers', { t2_bad: '{bad' });
    expect(await store.getPledger(2, 't2_bad')).toBeUndefined();
    expect(await store.getPledgers(2)).toEqual({ t2_abc: entry });
  });

  it('round-trips the marked dawn outcome by day (null when unresolved)', async () => {
    const store = new Store(makeFakeRedis());
    expect(await store.getMarkedOutcome(1)).toBeNull();
    await store.setMarkedOutcome(1, { name: 'The North Wall', saved: true });
    expect(await store.getMarkedOutcome(1)).toEqual({ name: 'The North Wall', saved: true });
    expect(await store.getMarkedOutcome(2)).toBeNull();
  });

  it('ignores malformed marked outcomes', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    await store.setMarkedOutcome(1, { name: 'The North Wall', saved: true });
    await redis.hSet('marked:outcomes', { '2': '{bad' });
    expect(await store.getMarkedOutcome(2)).toBeNull();
    expect(await store.countMarkedSaved()).toBe(1);
  });

  it('ranks contributors 1-based; null when unranked', async () => {
    const store = new Store(makeFakeRedis());
    await store.addContribution('t2_a', 30);
    await store.addContribution('t2_b', 90);
    await store.addContribution('t2_c', 60);
    expect(await store.getContributionRank('t2_b')).toBe(1);
    expect(await store.getContributionRank('t2_c')).toBe(2);
    expect(await store.getContributionRank('t2_a')).toBe(3);
    expect(await store.getContributionRank('t2_ghost')).toBeNull();
  });
});
