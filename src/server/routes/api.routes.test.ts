import { beforeEach, describe, expect, it, vi } from 'vitest';
import { context, redis, reddit } from '@devvit/web/server';
import { BALANCE } from '../../shared/balance';
import { HOUSE_CAP } from '../../shared/houses';
import type { InitResponse, LeaderboardResponse, TimelineEntry, TimelineResponse } from '../../shared/types';
import { api } from './api';
import { mission } from './mission';
import { freshPlayer } from '../game/dayLogic';
import { KEYS } from '../storage/redisKeys';
import { Store } from '../storage/store';
import { makeFakeRedis, type FakeRedis } from '../storage/store.test';

/**
 * Route-level tests for the read-only /api endpoints that historically skipped
 * the requireUser gate (/timeline, /leaderboard). Same mocking strategy as
 * menu.test.ts: a mutable `context`, and a `redis` shell backfilled with the
 * in-memory fake so api.ts's redisLike adapter hits real (fake) storage.
 */
vi.mock('@devvit/web/server', () => ({
  context: {
    userId: undefined as string | undefined,
    subredditId: 't5_test',
    subredditName: 'testsub',
    postId: 't3_post',
  },
  reddit: {
    getCurrentUser: vi.fn(),
    getCurrentSubreddit: vi.fn(),
    getCurrentUsername: vi.fn(),
    submitCustomPost: vi.fn(),
  },
  redis: {},
}));

const ctx = context as unknown as { userId: string | undefined };
const redditMock = reddit as unknown as {
  getCurrentUsername: ReturnType<typeof vi.fn>;
};

let fake: FakeRedis;
let store: Store;

beforeEach(() => {
  vi.clearAllMocks();
  fake = makeFakeRedis();
  Object.assign(redis, fake);
  store = new Store(fake);
});

const entry = (day: number): TimelineEntry => ({
  day,
  cycle: 1,
  headline: `Day ${day} passed`,
  events: ['The city held.'],
  deltas: {},
  crisisId: 'first_light',
  winningOptionId: null,
});

const postJson = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const onboardAndAct = async (
  userId: string,
  username: string,
  role: 'farmer' | 'guard',
  action: 'grow_food' | 'guard_wall' | 'build_city',
) => {
  ctx.userId = userId;
  redditMock.getCurrentUsername.mockResolvedValueOnce(username);
  expect((await api.request('/init')).status).toBe(200);
  expect((await api.request('/role', postJson({ role }))).status).toBe(200);
  expect((await api.request('/action', postJson({ action }))).status).toBe(200);
};

const openUser = async (userId: string, username: string) => {
  ctx.userId = userId;
  redditMock.getCurrentUsername.mockResolvedValueOnce(username);
  expect((await api.request('/init')).status).toBe(200);
};

describe('GET /api/timeline', () => {
  it('rejects unauthenticated requests with the standard 401 shape', async () => {
    ctx.userId = undefined;
    const res = await api.request('/timeline');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ status: 'error', message: 'Not logged in' });
  });

  it('returns the timeline for a logged-in user', async () => {
    ctx.userId = 't2_reader';
    await store.appendTimeline(entry(1));
    const res = await api.request('/timeline');
    expect(res.status).toBe(200);
    const body = (await res.json()) as TimelineResponse;
    expect(body.type).toBe('timeline');
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.day).toBe(1);
  });
});

describe('GET /api/leaderboard', () => {
  it('rejects unauthenticated requests with the standard 401 shape', async () => {
    ctx.userId = undefined;
    const res = await api.request('/leaderboard');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ status: 'error', message: 'Not logged in' });
  });

  it('returns usernames and scores but never leaks a t2_* userId', async () => {
    ctx.userId = 't2_reader';
    await store.savePlayer(freshPlayer('t2_alice', 'alice', 1));
    await store.savePlayer(freshPlayer('t2_bob', 'bob', 1));
    await store.addContribution('t2_alice', 42);
    await store.addContribution('t2_bob', 7);
    await store.recordScoutHaul('t2_bob', 5);

    const res = await api.request('/leaderboard');
    expect(res.status).toBe(200);
    const body = (await res.json()) as LeaderboardResponse;

    expect(body.type).toBe('leaderboard');
    expect(body.contributors.map((e) => e.username)).toEqual(['alice', 'bob']);
    expect(body.contributors.map((e) => e.score)).toEqual([42, 7]);
    expect(body.scouts.map((e) => e.username)).toEqual(['bob']);

    // The identifier-leak regression: no entry carries a userId field, and no
    // raw t2_* identifier appears ANYWHERE in the payload.
    for (const row of [...body.contributors, ...body.scouts]) {
      expect(row).not.toHaveProperty('userId');
      expect(Object.keys(row).sort()).toEqual(['score', 'username']);
    }
    expect(JSON.stringify(body)).not.toContain('t2_');
  });

  it('falls back to "citizen" for unknown players without exposing their id', async () => {
    ctx.userId = 't2_reader';
    await store.addContribution('t2_ghost', 3); // score exists, profile does not
    const res = await api.request('/leaderboard');
    const body = (await res.json()) as LeaderboardResponse;
    expect(body.contributors).toEqual([{ username: 'citizen', score: 3 }]);
  });
});

describe('GET /api/init houses', () => {
  it('registers houses from every accepted contribution route', async () => {
    await openUser('t2_vote', 'voter');
    expect((await api.request('/vote', postJson({ crisisId: 'first_light', optionId: 'a' }))).status).toBe(200);

    await openUser('t2_strategy', 'planner');
    expect((await api.request('/strategy', postJson({ planId: 'prepare_raid' }))).status).toBe(200);

    await openUser('t2_pledge', 'keeper');
    expect((await api.request('/pledge', postJson({ kind: 'stand_vigil' }))).status).toBe(200);

    await onboardAndAct('t2_builder', 'builder', 'farmer', 'build_city');

    expect(await store.getHouseIndex('t2_vote')).toBe(0);
    expect(await store.getHouseIndex('t2_strategy')).toBe(1);
    expect(await store.getHouseIndex('t2_pledge')).toBe(2);
    expect(await store.getHouseIndex('t2_builder')).toBe(3);
    expect(await store.getHouseCount()).toBe(4);
    expect(await store.getFounderId()).toBe('t2_vote');
  });

  it('returns one-house summary for contributors in first-contribution order', async () => {
    await onboardAndAct('t2_alice', 'alice', 'farmer', 'grow_food');
    await onboardAndAct('t2_bob', 'bob', 'guard', 'guard_wall');

    ctx.userId = 't2_alice';
    const aliceRes = await api.request('/init');
    expect(aliceRes.status).toBe(200);
    const alice = (await aliceRes.json()) as InitResponse;
    expect(alice.houses.total).toBe(2);
    expect(alice.houses.cap).toBe(HOUSE_CAP);
    expect(alice.houses.founder).toEqual({ username: 'alice' });
    expect(alice.houses.yours).toEqual({ index: 0, tier: 2, isFounder: true });
    expect(alice.houses.named).toEqual(
      expect.arrayContaining([
        { username: 'alice', index: 0, tier: 2 },
        { username: 'bob', index: 1, tier: 2 },
      ]),
    );

    ctx.userId = 't2_bob';
    const bob = (await (await api.request('/init')).json()) as InitResponse;
    expect(bob.houses.total).toBe(2);
    expect(bob.houses.founder).toEqual({ username: 'alice' });
    expect(bob.houses.yours).toEqual({ index: 1, tier: 2, isFounder: false });
  });

  it('fails closed when the house registry is malformed', async () => {
    ctx.userId = 't2_corrupt';
    redditMock.getCurrentUsername.mockResolvedValueOnce('corrupt');
    await fake.hSet(KEYS.housesMeta, { seq: 'not-a-number', founder: 't2_missing' });
    await fake.hSet(KEYS.housesIndex, { t2_corrupt: 'NaN' });
    await store.addContribution('t2_corrupt', 10);

    const res = await api.request('/init');
    expect(res.status).toBe(200);
    const body = (await res.json()) as InitResponse;
    expect(body.houses).toEqual({
      total: 0,
      cap: HOUSE_CAP,
      founder: null,
      yours: null,
      named: [],
    });
  });
});

const deferred = () => {
  let settle = () => {};
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
};

describe('POST /action — atomic player profile', () => {
  it('cannot roll energy backward when an earlier request finishes bookkeeping late', async () => {
    await openUser('t2_race', 'racer');
    expect((await api.request('/role', postJson({ role: 'guard' }))).status).toBe(200);

    const firstBookkeepingReached = deferred();
    const releaseFirstBookkeeping = deferred();
    const originalZIncrBy = fake.zIncrBy.bind(fake);
    let blockFirst = true;
    vi.spyOn(redis, 'zIncrBy').mockImplementation(async (key, member, value) => {
      if (blockFirst && member === 't2_race') {
        blockFirst = false;
        firstBookkeepingReached.resolve();
        await releaseFirstBookkeeping.promise;
      }
      return originalZIncrBy(key, member, value);
    });

    const first = api.request('/action', postJson({ action: 'guard_wall' }));
    await firstBookkeepingReached.promise;
    const second = await api.request('/action', postJson({ action: 'guard_wall' }));
    expect(second.status).toBe(200);
    releaseFirstBookkeeping.resolve();
    expect((await first).status).toBe(200);

    const saved = await store.getPlayer('t2_race');
    expect(saved?.energyUsedToday).toBe(2);
    expect(saved?.roleRep.guard).toBe(BALANCE.roleRepPerAction * 2);
    expect(saved?.factionRep).toBe(BALANCE.factionRepPerAction * 2);
    expect(await store.getUserActions(1, 't2_race')).toEqual({ guard_wall: 2 });
  });
});

describe('POST /mission — V1 scope gate', () => {
  it('rejects direct mission calls even when the hidden endpoint is discovered', async () => {
    ctx.userId = 't2_curious';
    for (const path of ['/start', '/complete']) {
      const res = await mission.request(path, postJson({ route: 'deep' }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        status: 'error',
        message: 'Expeditions are not available in V1.',
      });
    }
  });
});

describe('POST /vote /strategy /pledge — per-user lock + repeat guard', () => {
  // The three routes migrated from a shared per-day-hash watch (which false-409'd
  // concurrent users) to beginUserLock. The primitive's cross-user no-conflict is
  // proven in userLock.test.ts; here we assert the ROUTES still commit both users'
  // writes and still reject a same-user repeat with the exact 409.
  const day = async () => (await store.getCityState())?.day ?? 1;

  it('tallies votes from two different users and blocks a same-user re-vote', async () => {
    await openUser('t2_v1', 'v1');
    expect((await api.request('/vote', postJson({ crisisId: 'first_light', optionId: 'a' }))).status).toBe(200);
    await openUser('t2_v2', 'v2');
    expect((await api.request('/vote', postJson({ crisisId: 'first_light', optionId: 'a' }))).status).toBe(200);
    expect(await store.getVoteTally(await day())).toEqual({ a: 2 });

    // t2_v2 votes again → rejected, tally unchanged.
    const again = await api.request('/vote', postJson({ crisisId: 'first_light', optionId: 'a' }));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ status: 'error', message: 'You already voted today.' });
    expect(await store.getVoteTally(await day())).toEqual({ a: 2 });
  });

  it('tallies plans from two different users and blocks a same-user re-back', async () => {
    await openUser('t2_s1', 's1');
    expect((await api.request('/strategy', postJson({ planId: 'prepare_raid' }))).status).toBe(200);
    await openUser('t2_s2', 's2');
    expect((await api.request('/strategy', postJson({ planId: 'prepare_raid' }))).status).toBe(200);
    expect(await store.getStrategyTally(await day())).toEqual({ prepare_raid: 2 });

    const again = await api.request('/strategy', postJson({ planId: 'prepare_raid' }));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ status: 'error', message: 'You already backed a plan today.' });
  });

  it('records pledges from two different users and blocks a same-user re-pledge', async () => {
    await openUser('t2_p1', 'p1');
    expect((await api.request('/pledge', postJson({ kind: 'stand_vigil' }))).status).toBe(200);
    await openUser('t2_p2', 'p2');
    expect((await api.request('/pledge', postJson({ kind: 'stand_vigil' }))).status).toBe(200);
    expect(await store.getPledger(await day(), 't2_p1')).toBeTruthy();
    expect(await store.getPledger(await day(), 't2_p2')).toBeTruthy();

    const again = await api.request('/pledge', postJson({ kind: 'stand_vigil' }));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ status: 'error', message: 'You already pledged today.' });
  });
});

describe('GET /api/init — brand-new player robustness', () => {
  it('falls back to username "citizen" when getCurrentUsername() throws (does not 500)', async () => {
    ctx.userId = 't2_newbie';
    redditMock.getCurrentUsername.mockRejectedValueOnce(new Error('reddit down'));
    const res = await api.request('/init');
    expect(res.status).toBe(200);
    expect((await store.getPlayer('t2_newbie'))?.username).toBe('citizen');
  });
});
