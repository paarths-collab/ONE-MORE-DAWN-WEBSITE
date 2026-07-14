import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { context, reddit, redis } from '@devvit/web/server';
import { menu } from './menu';
import { newCityState } from '../game/resolver';
import { Store } from '../storage/store';
import { makeFakeRedis, type FakeRedis } from '../storage/store.test';
import { freshPlayer } from '../game/dayLogic';
import { KEYS } from '../storage/redisKeys';
import type { TimelineEntry } from '../../shared/types';

/**
 * Route-level authorization tests for /internal/menu/*. The Devvit runtime is
 * mocked at the module boundary: `context` is a mutable plain object, `reddit`
 * is a set of vi.fn()s, and `redis` is an empty shell that each test backfills
 * with the in-memory fake from store.test (api.ts's redisLike adapter then
 * delegates straight into it).
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
    submitPost: vi.fn(),
    submitComment: vi.fn(),
  },
  redis: {},
}));

const ctx = context as unknown as {
  userId: string | undefined;
  subredditId: string;
  subredditName: string | undefined;
};
const redditMock = reddit as unknown as {
  getCurrentUser: Mock;
  getCurrentSubreddit: Mock;
  submitCustomPost: Mock;
  submitPost: Mock;
  submitComment: Mock;
};

const MENU_ROUTES = ['/post-create', '/chatter-hub', '/force-resolve', '/reset', '/seed-demo'] as const;

const asLoggedOut = () => {
  ctx.userId = undefined;
  redditMock.getCurrentUser.mockResolvedValue(undefined);
};

const asNonModerator = () => {
  ctx.userId = 't2_pleb';
  redditMock.getCurrentUser.mockResolvedValue({
    username: 'pleb',
    getModPermissionsForSubreddit: async () => [], // empty = not a mod of this sub
  });
};

const asModerator = () => {
  ctx.userId = 't2_mod';
  redditMock.getCurrentUser.mockResolvedValue({
    username: 'mod',
    getModPermissionsForSubreddit: async () => ['all'],
  });
};

let fake: FakeRedis;
let store: Store;

beforeEach(() => {
  vi.clearAllMocks();
  ctx.subredditName = 'testsub';
  fake = makeFakeRedis();
  // api.ts's redisLike closes over THIS object — swap its guts per test.
  Object.assign(redis, fake);
  store = new Store(fake);
});

describe('/internal/menu/* authorization', () => {
  it('rejects logged-out callers on every route and mutates nothing', async () => {
    asLoggedOut();
    const city = newCityState(1);
    await store.setCityState(city);

    for (const route of MENU_ROUTES) {
      const res = await menu.request(route, { method: 'POST' });
      expect(res.status, route).toBe(403);
      const body = (await res.json()) as { showToast?: string };
      expect(body.showToast, route).toMatch(/moderators only/i);
    }

    // Nothing happened: same city, no post created, no timeline written.
    expect(await store.getCityState()).toEqual(city);
    expect(await store.getTimeline(10)).toEqual([]);
    expect(redditMock.submitCustomPost).not.toHaveBeenCalled();
  });

  it('rejects logged-in non-moderators on every route and mutates nothing', async () => {
    asNonModerator();
    const city = { ...newCityState(3), day: 5 };
    await store.setCityState(city);

    for (const route of MENU_ROUTES) {
      const res = await menu.request(route, { method: 'POST' });
      expect(res.status, route).toBe(403);
      const body = (await res.json()) as { showToast?: string };
      expect(body.showToast, route).toMatch(/moderators only/i);
    }

    // No resolve (day 5 intact), no reset (cycle 3 intact), no demo seed, no post.
    expect(await store.getCityState()).toEqual(city);
    expect(await store.getTimeline(10)).toEqual([]);
    expect(redditMock.submitCustomPost).not.toHaveBeenCalled();
  });

  it('fails CLOSED when the moderator lookup itself throws', async () => {
    ctx.userId = 't2_mod';
    redditMock.getCurrentUser.mockRejectedValue(new Error('reddit is down'));
    const city = newCityState(1);
    await store.setCityState(city);

    const res = await menu.request('/reset', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(await store.getCityState()).toEqual(city);
  });

  it('lets a moderator force-resolve the day', async () => {
    asModerator();
    await store.setCityState(newCityState(1));

    const res = await menu.request('/force-resolve', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { showToast?: string };
    expect(body.showToast).toMatch(/Resolved day 1 → day 2/);
    expect((await store.getCityState())?.day).toBe(2);
  });

  it('lets a moderator reset the city into the next cycle', async () => {
    asModerator();
    await store.setCityState({ ...newCityState(2), day: 7 });

    const res = await menu.request('/reset', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { showToast?: string };
    expect(body.showToast).toMatch(/City reset\. Cycle 3, day 1\./);
    const city = await store.getCityState();
    expect(city?.cycle).toBe(3);
    expect(city?.day).toBe(1);
  });

  it('reset wipes players, timeline, houses, and day-scoped votes — not just cycle/day', async () => {
    asModerator();
    await store.setCityState({ ...newCityState(2), day: 4 });
    // Populate a lived-in city so the destructive clear has something to remove.
    await store.savePlayer({
      ...freshPlayer('t2_a', 'a', 4),
      coins: 8,
      ownedCosmetics: ['hearth_lantern'],
      equippedCosmetics: { light: 'hearth_lantern' },
    });
    await store.savePlayer(freshPlayer('t2_b', 'b', 4));
    await store.addContribution('t2_a', 10);
    await store.registerHouse('t2_a');
    await store.registerHouse('t2_b');
    const past: TimelineEntry = {
      day: 3, cycle: 2, headline: 'Day 3 passed', events: ['held'],
      deltas: {}, crisisId: 'first_light', winningOptionId: null,
    };
    await store.appendTimeline(past);
    await fake.hSet(KEYS.dayVoters(4), { t2_a: 'a' });
    await fake.hSet(KEYS.dayVotes(4), { a: '1' });
    await fake.hSet(KEYS.landFunding, { outer_fields: '75' });
    await fake.hSet(KEYS.cityTreasury, { balance: '9', collected: '18', invested: '9' });
    // Sanity: populated before the reset.
    expect(await store.getHouseCount()).toBe(2);
    expect(await store.getAllPlayers()).toHaveLength(2);
    expect((await store.getPlayer('t2_a'))?.coins).toBe(8);

    const res = await menu.request('/reset', { method: 'POST' });
    expect(res.status).toBe(200);

    // The destructive payload actually ran — everything cleared to a bare Camp.
    expect(await store.getAllPlayers()).toEqual([]);
    expect(await store.getTimeline(10)).toEqual([]);
    expect(await store.getHouseCount()).toBe(0);
    expect(await store.getVoteTally(4)).toEqual({});
    expect((await store.getLandExpansionState()).projects[0]?.funded).toBe(0);
    expect((await store.getTreasuryState(freshPlayer('t2_check', 'check', 1))).balance).toBe(0);
    const fresh = await store.getCityState();
    expect(fresh?.cycle).toBe(3);
    expect(fresh?.day).toBe(1);
  });

  it('lets a moderator seed the demo city', async () => {
    asModerator();
    const res = await menu.request('/seed-demo', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { showToast?: string };
    expect(body.showToast).toMatch(/Demo seeded/);
    const city = await store.getCityState();
    expect(city).toBeDefined();
    expect(city?.status).toBe('alive');
  });

  it('lets a moderator create the game post', async () => {
    asModerator();
    redditMock.submitCustomPost.mockResolvedValue({ permalink: '/r/testsub/comments/abc/' });

    const res = await menu.request('/post-create', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { navigateTo?: string };
    expect(body.navigateTo).toBe('https://reddit.com/r/testsub/comments/abc/');
    expect(redditMock.submitCustomPost).toHaveBeenCalledTimes(1);
  });

  it('lets a moderator create and open the weekly City Chatter hub', async () => {
    asModerator();
    await store.setCityState({ ...newCityState(1), day: 4 });
    redditMock.submitPost.mockResolvedValue({
      id: 't3_week123',
      permalink: '/r/testsub/comments/week123/city_chatter_hub/',
    });
    let root = 0;
    redditMock.submitComment.mockImplementation(async () => {
      root += 1;
      return { id: `t1_root${root}` };
    });

    const res = await menu.request('/chatter-hub', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      navigateTo: 'https://www.reddit.com/r/testsub/comments/week123/city_chatter_hub/',
    });
    expect(redditMock.submitPost).toHaveBeenCalledTimes(1);
    expect(redditMock.submitComment).toHaveBeenCalledTimes(4);
  });

  it('falls back to getCurrentSubreddit() when context has no subreddit name', async () => {
    asModerator();
    ctx.subredditName = undefined;
    redditMock.getCurrentUser.mockResolvedValue({
      username: 'mod',
      getModPermissionsForSubreddit: async (name: string) => (name === 'fromrpc' ? ['all'] : []),
    });
    redditMock.getCurrentSubreddit.mockResolvedValue({ name: 'fromrpc' });
    await store.setCityState(newCityState(1));

    const res = await menu.request('/force-resolve', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(redditMock.getCurrentSubreddit).toHaveBeenCalledTimes(1);
  });
});
