import { beforeEach, describe, expect, it, vi } from 'vitest';
import { context, redis, reddit } from '@devvit/web/server';
import type { InitResponse } from '../../shared/types';
import { api } from './api';
import { KEYS } from '../storage/redisKeys';
import { makeFakeRedis, type FakeRedis } from '../storage/store.test';

/**
 * Corrupt-storage resilience for the boot path: a wrong-shaped but VALID JSON
 * value in Redis (a bare number, a string, a foreign blob) must degrade to the
 * same fallback as missing data — /api/init keeps serving 200s, it never 500s
 * on a poisoned key. Same mocking strategy as api.routes.test.ts.
 */
vi.mock('@devvit/web/server', () => ({
  context: {
    userId: 't2_survivor' as string | undefined,
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
const redditMock = reddit as unknown as { getCurrentUsername: ReturnType<typeof vi.fn> };

let fake: FakeRedis;

beforeEach(() => {
  vi.clearAllMocks();
  fake = makeFakeRedis();
  Object.assign(redis, fake);
  ctx.userId = 't2_survivor';
  redditMock.getCurrentUsername.mockResolvedValue('survivor');
});

describe('GET /api/init — corrupt Redis values', () => {
  it('boots a fresh city when the stored city is wrong-shaped JSON', async () => {
    await fake.set(KEYS.cityState, '7');
    const res = await api.request('/init');
    expect(res.status).toBe(200);
    const body = (await res.json()) as InitResponse;
    expect(body.type).toBe('init');
    expect(body.city.day).toBeGreaterThanOrEqual(1);
  });

  it('re-creates the caller profile when their stored player is wrong-shaped JSON', async () => {
    await fake.hSet(KEYS.players, { t2_survivor: '"hello"' });
    const res = await api.request('/init');
    expect(res.status).toBe(200);
    const body = (await res.json()) as InitResponse;
    expect(body.player.userId).toBe('t2_survivor');
    expect(body.player.energyUsedToday).toBe(0);
  });

  it('serves init despite corrupt timeline, pledger, and outcome entries', async () => {
    await fake.hSet(KEYS.timeline, { '1:1': '"hello"', junk: '7' });
    await fake.hSet(KEYS.dayPledgers(1), { t2_survivor: '17' });
    await fake.hSet(KEYS.markedOutcomes, { '1': '"nope"' });
    const res = await api.request('/init');
    expect(res.status).toBe(200);
    expect(((await res.json()) as InitResponse).type).toBe('init');
  });
});
