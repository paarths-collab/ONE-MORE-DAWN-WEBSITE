import { beforeEach, describe, expect, it, vi } from 'vitest';
import { schedulerRoutes } from './scheduler';
import { chatterWeekKey } from '../../shared/chatter';
import { newCityState } from '../game/resolver';
import { KEYS } from '../storage/redisKeys';
import { Store } from '../storage/store';
import { makeFakeRedis, type FakeRedis } from '../storage/store.test';

const runtime = vi.hoisted(() => ({
  context: {
    userId: undefined,
    subredditId: 't5_test',
    subredditName: 'testsub',
    postId: undefined,
  },
  reddit: {
    getCurrentSubreddit: vi.fn(),
    submitPost: vi.fn(),
    submitComment: vi.fn(),
  },
  redis: {},
}));

vi.mock('@devvit/web/server', () => runtime);

let fake: FakeRedis;
let store: Store;

beforeEach(() => {
  vi.clearAllMocks();
  fake = makeFakeRedis();
  Object.assign(runtime.redis, fake);
  store = new Store(fake);
  runtime.reddit.submitPost.mockResolvedValue({
    id: 't3_week123',
    permalink: '/r/testsub/comments/week123/city_chatter_hub/',
  });
  let root = 0;
  runtime.reddit.submitComment.mockImplementation(async () => {
    root += 1;
    return { id: `t1_root${root}` };
  });
});

describe('City Chatter scheduler', () => {
  it('does not create a city merely to create a discussion thread', async () => {
    const res = await schedulerRoutes.request('/chatter-maintenance', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await store.getCityState()).toBeUndefined();
    expect(runtime.reddit.submitPost).not.toHaveBeenCalled();
  });

  it('resolves dawn before creating the new city day category roots', async () => {
    await store.setCityState({ ...newCityState(1), day: 6 });
    await store.setCityMeta({ lastResolvedDate: '2000-01-01', schemaVersion: '1' });

    const res = await schedulerRoutes.request('/chatter-maintenance', { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe('City Chatter ready for day 7.');
    expect((await store.getCityState())?.day).toBe(7);
    expect(runtime.reddit.submitPost).toHaveBeenCalledTimes(1);
    expect(runtime.reddit.submitComment).toHaveBeenCalledTimes(4);
    const roots = await fake.hGetAll(KEYS.chatterRoots);
    const prefix = `${chatterWeekKey(new Date())}:1:7:`;
    expect(Object.keys(roots).filter((key) => key.startsWith(prefix))).toHaveLength(4);
  });
});
