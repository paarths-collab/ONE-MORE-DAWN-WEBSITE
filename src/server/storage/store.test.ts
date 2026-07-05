import { describe, expect, it } from 'vitest';
import { Store, type RedisLike } from './store';
import type { CityState, PlayerProfile } from '../../shared/types';

/** Minimal in-memory fake covering the subset Store uses. Exported for reuse in later route tests. */
export const makeFakeRedis = (): RedisLike => {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const zsets = new Map<string, Map<string, number>>();
  const hash = (k: string) => {
    if (!hashes.has(k)) hashes.set(k, new Map());
    return hashes.get(k)!;
  };
  const zset = (k: string) => {
    if (!zsets.has(k)) zsets.set(k, new Map());
    return zsets.get(k)!;
  };
  return {
    async get(k) { return strings.get(k); },
    async set(k, v, opts) {
      if (opts?.nx && strings.has(k)) return '';
      strings.set(k, v);
      return 'OK';
    },
    async del(...keys) { for (const k of keys) { strings.delete(k); hashes.delete(k); zsets.delete(k); } },
    async expire() { /* TTL not simulated */ },
    async hGet(k, f) { return hash(k).get(f); },
    async hSet(k, fv) { for (const [f, v] of Object.entries(fv)) hash(k).set(f, v); return 0; },
    async hGetAll(k) { return Object.fromEntries(hash(k)); },
    async hIncrBy(k, f, by) {
      const next = Number(hash(k).get(f) ?? '0') + by;
      hash(k).set(f, String(next));
      return next;
    },
    async hDel(k, fields) { for (const f of fields) hash(k).delete(f); },
    async zIncrBy(k, m, by) {
      const next = (zset(k).get(m) ?? 0) + by;
      zset(k).set(m, next);
      return next;
    },
    async zAdd(k, ...members) { for (const m of members) zset(k).set(m.member, m.score); return members.length; },
    async zScore(k, m) { return zset(k).get(m); },
    async zRange(k, start, stop, opts) {
      const all = [...zset(k).entries()]
        .sort((a, b) => (opts?.reverse ? b[1] - a[1] : a[1] - b[1]))
        .map(([member, score]) => ({ member, score }));
      const stopIdx = typeof stop === 'number' && stop === -1 ? all.length - 1 : Number(stop);
      return all.slice(Number(start), stopIdx + 1);
    },
  };
};

const city: CityState = {
  day: 1, cycle: 1, status: 'alive',
  population: 120, food: 60, power: 55, medicine: 20,
  morale: 60, threat: 30, defense: 40,
  crisisId: 'first_light', activeLaw: null, lawExpiresDay: 0,
};

const player: PlayerProfile = {
  userId: 't2_abc', username: 'tester', role: 'scout', roleChangedDay: 1,
  faction: null, factionRep: 0, roleRep: {}, title: null,
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

  it('round-trips player profiles in the players hash', async () => {
    const store = new Store(makeFakeRedis());
    expect(await store.getPlayer('t2_abc')).toBeUndefined();
    await store.savePlayer(player);
    expect(await store.getPlayer('t2_abc')).toEqual(player);
  });

  it('backfills roleRep/title when reading legacy player JSON', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    // Simulate a profile stored before the reward layer shipped.
    const { roleRep: _rr, title: _t, ...legacy } = player;
    await redis.hSet('players', { t2_abc: JSON.stringify(legacy) });
    const loaded = await store.getPlayer('t2_abc');
    expect(loaded).toEqual({ ...legacy, roleRep: {}, title: null });
  });

  it('does not clobber stored roleRep/title when present', async () => {
    const store = new Store(makeFakeRedis());
    await store.savePlayer({ ...player, roleRep: { scout: 30 }, title: 'Runner' });
    const loaded = await store.getPlayer('t2_abc');
    expect(loaded?.roleRep).toEqual({ scout: 30 });
    expect(loaded?.title).toBe('Runner');
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
});
