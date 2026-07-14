import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatter } from './chatter';
import { KEYS } from '../storage/redisKeys';
import { Store } from '../storage/store';
import { makeFakeRedis, type FakeRedis } from '../storage/store.test';
import { newCityState } from '../game/resolver';
import { chatterWeekKey } from '../../shared/chatter';

const runtime = vi.hoisted(() => ({
  context: {
    userId: 't2_reader' as string | undefined,
    subredditId: 't5_test',
    subredditName: 'testsub',
    postId: 't3_gamepost',
  },
  reddit: {
    getComments: vi.fn(),
    getCurrentSubreddit: vi.fn(),
    submitPost: vi.fn(),
    submitComment: vi.fn(),
  },
  redis: {},
}));

vi.mock('@devvit/web/server', () => runtime);

const postJson = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const comment = (overrides: Record<string, unknown> = {}) => ({
  id: 't1_reply1',
  parentId: 't1_strategy1',
  authorName: 'ashen_fox',
  body: 'Hold the north wall.',
  createdAt: new Date('2026-07-14T08:30:00.000Z'),
  permalink: '/r/testsub/comments/week123/hub/t1_reply1/',
  removed: false,
  spam: false,
  ...overrides,
});

let fake: FakeRedis;
let store: Store;

const seedHub = async () => {
  const city = { ...newCityState(1), day: 6 };
  const weekKey = chatterWeekKey(new Date());
  await store.setCityState(city);
  await fake.hSet(KEYS.chatterMeta, {
    weekKey,
    postId: 't3_week123',
    permalink: '/r/testsub/comments/week123/city_chatter_hub/',
    createdAt: '2026-07-13T00:05:00.000Z',
  });
  await fake.hSet(KEYS.chatterRoots, {
    [`${weekKey}:1:6:strategy`]: 't1_strategy1',
    [`${weekKey}:1:6:raid`]: 't1_raid1',
    [`${weekKey}:1:6:rebuilding`]: 't1_rebuild1',
    [`${weekKey}:1:6:general`]: 't1_general1',
  });
};

beforeEach(async () => {
  vi.clearAllMocks();
  runtime.context.userId = 't2_reader';
  fake = makeFakeRedis();
  Object.assign(runtime.redis, fake);
  store = new Store(fake);
  await seedHub();
  runtime.reddit.getComments.mockReturnValue({ all: vi.fn().mockResolvedValue([comment()]) });
  runtime.reddit.submitComment.mockResolvedValue(comment({ authorName: 'reader', parentId: 't1_strategy1' }));
});

describe('GET /api/chatter', () => {
  it('returns only direct, visible Reddit replies for the selected category', async () => {
    runtime.reddit.getComments.mockReturnValue({
      all: vi.fn().mockResolvedValue([
        comment(),
        comment({ id: 't1_nested1', parentId: 't1_reply1', body: 'Nested reply' }),
        comment({ id: 't1_removed1', removed: true, body: 'Removed' }),
        comment({ id: 't1_spam1', spam: true, body: 'Spam' }),
      ]),
    });

    const res = await chatter.request('/?category=strategy');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      type: 'chatter',
      ready: true,
      category: 'strategy',
      rootCommentId: 't1_strategy1',
      threadUrl: 'https://www.reddit.com/r/testsub/comments/week123/city_chatter_hub/',
      maxLength: 250,
    }));
    expect(body.messages).toEqual([expect.objectContaining({ id: 't1_reply1', author: 'ashen_fox' })]);
    expect(runtime.reddit.getComments).toHaveBeenCalledWith(expect.objectContaining({
      postId: 't3_week123',
      commentId: 't1_strategy1',
      sort: 'new',
    }));
  });

  it('fails safely to an empty feed when Reddit comment reads fail', async () => {
    runtime.reddit.getComments.mockReturnValue({ all: vi.fn().mockRejectedValue(new Error('Reddit unavailable')) });

    const res = await chatter.request('/?category=raid');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({
      messages: [],
      feedAvailable: false,
    }));
  });

  it('repairs a missing daily category root on first use without duplicating the weekly post', async () => {
    const weekKey = chatterWeekKey(new Date());
    await fake.hDel(KEYS.chatterRoots, [`${weekKey}:1:6:raid`]);

    const res = await chatter.request('/?category=raid');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(runtime.reddit.submitPost).not.toHaveBeenCalled();
    expect(runtime.reddit.submitComment).toHaveBeenCalledTimes(1);
    expect(runtime.reddit.submitComment).toHaveBeenCalledWith(expect.objectContaining({
      id: 't3_week123',
      runAs: 'APP',
    }));
  });

  it('requires a logged-in Reddit user', async () => {
    runtime.context.userId = undefined;
    const res = await chatter.request('/');
    expect(res.status).toBe(401);
    expect(runtime.reddit.getComments).not.toHaveBeenCalled();
  });
});

describe('POST /api/chatter', () => {
  it('posts only after an explicit request and asks Reddit to attribute it to the user', async () => {
    const res = await chatter.request('/', postJson({ category: 'strategy', text: '  Hold   the wall. ' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(runtime.reddit.submitComment).toHaveBeenCalledWith({
      id: 't1_strategy1',
      text: 'Hold the wall.',
      runAs: 'USER',
    });
    expect(body).toEqual(expect.objectContaining({
      type: 'chatter-post',
      postedAs: 'reader',
      message: expect.objectContaining({ author: 'reader' }),
    }));
  });

  it('rejects links, overlong messages, and unknown categories before calling Reddit', async () => {
    const cases = [
      { category: 'strategy', text: 'See https://example.com' },
      { category: 'strategy', text: 'x'.repeat(251) },
      { category: 'unknown', text: 'Hello city' },
    ];
    for (const body of cases) {
      const res = await chatter.request('/', postJson(body));
      expect(res.status).toBe(400);
    }
    expect(runtime.reddit.submitComment).not.toHaveBeenCalled();
  });

  it('enforces both the posting cooldown and duplicate-message lock', async () => {
    const request = postJson({ category: 'strategy', text: 'Hold the wall.' });
    expect((await chatter.request('/', request)).status).toBe(200);
    expect((await chatter.request('/', request)).status).toBe(429);

    await fake.del(KEYS.chatterCooldown('t2_reader'));
    expect((await chatter.request('/', request)).status).toBe(409);
    expect(runtime.reddit.submitComment).toHaveBeenCalledTimes(1);
  });

  it('releases spam locks when Reddit does not confirm the comment', async () => {
    runtime.reddit.submitComment.mockRejectedValueOnce(new Error('Reddit unavailable'));
    const request = postJson({ category: 'raid', text: 'Protect the outer fields.' });

    const failed = await chatter.request('/', request);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({
      status: 'error',
      message: 'Reddit did not confirm the comment. Nothing was posted; try again.',
    });

    runtime.reddit.submitComment.mockResolvedValueOnce(comment({
      id: 't1_retry1',
      parentId: 't1_raid1',
      authorName: 'reader',
      body: 'Protect the outer fields.',
    }));
    expect((await chatter.request('/', request)).status).toBe(200);
    expect(runtime.reddit.submitComment).toHaveBeenCalledTimes(2);
  });

  it('does not report failure after Reddit accepts a comment with incomplete metadata', async () => {
    runtime.reddit.submitComment.mockResolvedValueOnce(comment({
      id: 't1_sparse1',
      authorName: '',
      createdAt: new Date('invalid'),
      permalink: '',
    }));

    const res = await chatter.request('/', postJson({ category: 'general', text: 'Good dawn, city.' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      postedAs: '[deleted]',
      message: expect.objectContaining({
        id: 't1_sparse1',
        permalink: 'https://www.reddit.com/r/testsub/comments/week123/city_chatter_hub/',
      }),
    }));
  });

  it('refuses to post into a stale weekly hub', async () => {
    await fake.hSet(KEYS.chatterMeta, { weekKey: '2000-01-03' });

    const res = await chatter.request('/', postJson({ category: 'strategy', text: 'Hold the wall.' }));
    expect(res.status).toBe(503);
    expect(runtime.reddit.submitComment).not.toHaveBeenCalled();
  });
});
