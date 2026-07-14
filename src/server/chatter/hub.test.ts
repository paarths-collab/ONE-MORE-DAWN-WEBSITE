import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '../storage/redisKeys';
import { makeFakeRedis } from '../storage/store.test';
import { newCityState } from '../game/resolver';
import { chatterThreadUrl, ensureChatterHub, readChatterMeta, readChatterRoots } from './hub';

const redditMock = vi.hoisted(() => ({
  submitPost: vi.fn(),
  submitComment: vi.fn(),
}));

vi.mock('@devvit/web/server', () => ({ reddit: redditMock }));

beforeEach(() => {
  vi.clearAllMocks();
  let commentNumber = 0;
  redditMock.submitPost.mockResolvedValue({
    id: 't3_week123',
    permalink: '/r/testsub/comments/week123/city_chatter_hub/',
  });
  redditMock.submitComment.mockImplementation(async () => {
    commentNumber += 1;
    return { id: `t1_root${commentNumber}` };
  });
});

describe('weekly City Chatter provisioning', () => {
  it('never turns stored or returned permalinks into an off-Reddit redirect', () => {
    expect(chatterThreadUrl('/r/testsub/comments/abc/hub/')).toBe('https://www.reddit.com/r/testsub/comments/abc/hub/');
    expect(chatterThreadUrl('https://old.reddit.com/r/testsub/comments/abc/')).toBe('https://old.reddit.com/r/testsub/comments/abc/');
    expect(chatterThreadUrl('https://example.com/phish')).toBe('https://www.reddit.com/');
  });

  it('creates one weekly post and four daily category roots idempotently', async () => {
    const redis = makeFakeRedis();
    const city = { ...newCityState(1), day: 6 };
    const now = new Date('2026-07-14T10:00:00.000Z');

    const first = await ensureChatterHub(redis, 'testsub', city, now);
    const second = await ensureChatterHub(redis, 'testsub', city, now);

    expect(first).toEqual(second);
    expect(first.weekKey).toBe('2026-07-13');
    expect(Object.keys(first.roots)).toEqual(['strategy', 'raid', 'rebuilding', 'general']);
    expect(redditMock.submitPost).toHaveBeenCalledTimes(1);
    expect(redditMock.submitComment).toHaveBeenCalledTimes(4);
    expect(redditMock.submitPost).toHaveBeenCalledWith(expect.objectContaining({
      subredditName: 'testsub',
      flairText: 'One More Dawn: Chatter Hub',
      runAs: 'APP',
    }));
  });

  it('adds fresh category roots for a new city day without duplicating the weekly post', async () => {
    const redis = makeFakeRedis();
    const now = new Date('2026-07-14T10:00:00.000Z');
    const daySix = { ...newCityState(2), day: 6 };
    const daySeven = { ...daySix, day: 7 };

    await ensureChatterHub(redis, 'testsub', daySix, now);
    const next = await ensureChatterHub(redis, 'testsub', daySeven, now);

    expect(redditMock.submitPost).toHaveBeenCalledTimes(1);
    expect(redditMock.submitComment).toHaveBeenCalledTimes(8);
    expect(Object.keys(next.roots)).toHaveLength(4);
    expect(new Set(Object.values(next.roots)).size).toBe(4);
  });

  it('repairs a partially provisioned day after Reddit fails', async () => {
    const redis = makeFakeRedis();
    const city = { ...newCityState(1), day: 3 };
    const now = new Date('2026-07-14T10:00:00.000Z');
    redditMock.submitComment
      .mockResolvedValueOnce({ id: 't1_saved1' })
      .mockRejectedValueOnce(new Error('Reddit unavailable'));

    await expect(ensureChatterHub(redis, 'testsub', city, now)).rejects.toThrow('Reddit unavailable');
    expect(await redis.get(KEYS.chatterProvisionLock('2026-07-13'))).toBeUndefined();

    let repairedNumber = 1;
    redditMock.submitComment.mockImplementation(async () => {
      repairedNumber += 1;
      return { id: `t1_fixed${repairedNumber}` };
    });
    const repaired = await ensureChatterHub(redis, 'testsub', city, now);

    expect(redditMock.submitPost).toHaveBeenCalledTimes(1);
    expect(Object.values(repaired.roots)).toContain('t1_saved1');
    expect(Object.keys(repaired.roots)).toHaveLength(4);
  });

  it('ignores malformed routing metadata instead of returning corrupt IDs', async () => {
    const redis = makeFakeRedis();
    const city = newCityState(1);
    await redis.hSet(KEYS.chatterMeta, {
      weekKey: '2026-07-13',
      postId: 'not-a-post-id',
      permalink: '/r/test/comments/bad/',
      createdAt: 'bad-date',
    });
    await redis.hSet(KEYS.chatterRoots, {
      '2026-07-13:1:1:strategy': 'not-a-comment-id',
    });

    expect(await readChatterMeta(redis)).toBeNull();
    const validMeta = {
      weekKey: '2026-07-13',
      postId: 't3_valid1' as const,
      permalink: '/r/test/comments/valid1/',
      createdAt: '2026-07-13T00:00:00.000Z',
    };
    expect(await readChatterRoots(redis, validMeta, city)).toEqual({});
  });
});
