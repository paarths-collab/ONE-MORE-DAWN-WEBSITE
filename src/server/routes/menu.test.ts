import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { context, reddit, redis } from '@devvit/web/server';
import { menu } from './menu';
import { newCityState } from '../game/resolver';
import { Store } from '../storage/store';
import { makeFakeRedis, type FakeRedis } from '../storage/store.test';

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
};

const MENU_ROUTES = ['/post-create', '/force-resolve', '/reset', '/seed-demo'] as const;

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
