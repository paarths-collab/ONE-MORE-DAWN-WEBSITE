import { beforeEach, describe, expect, it, vi } from 'vitest';
import { context, redis } from '@devvit/web/server';
import { hashString } from '../../shared/rng';
import { initialRotations, rotateEdges, solutionRotations, tileCells, TILE_EDGES } from '../../shared/puzzle';
import { PUZZLE_LEVELS, puzzleLevelById } from '../../shared/puzzleLevels';
import type { PuzzleDailyResponse, PuzzleSolveResponse } from '../../shared/types';
import { DAILY_PUZZLE_LEVELS, dailyLevelId, puzzle } from './puzzle';
import { utcDateString } from '../game/lazyResolve';
import { KEYS } from '../storage/redisKeys';
import { Store } from '../storage/store';
import { makeFakeRedis, type FakeRedis } from '../storage/store.test';

/**
 * The provable move floor for a FULL-solution submission: every tile whose
 * solved edges differ from its scrambled start necessarily cost >=1 tap. The
 * /solve route clamps client-reported `moves` up to this (anti-spoof), so these
 * tests must submit realistic counts at/above it. Mirrors the route's own math.
 * The daily pool (L1-L10) always keeps >=1 slack between this floor and the
 * moveTarget, so `floor` and `floor + 1` are both within-target (3-star) solves.
 */
const provableFloor = (level: (typeof PUZZLE_LEVELS)[number]): number => {
  const start = initialRotations(level);
  const sol = solutionRotations(level);
  let n = 0;
  tileCells(level).forEach((tile, i) => {
    if (rotateEdges(TILE_EDGES[tile.kind], start[i] ?? 0) !== rotateEdges(TILE_EDGES[tile.kind], sol[i] ?? 0)) n += 1;
  });
  return n;
};

/**
 * Route-level tests for the "Reconnect the City" daily puzzle. Same mocking
 * strategy as api.routes.test.ts: a mutable `context` and a `redis` shell
 * backfilled with the in-memory fake so api.ts's redisLike adapter (which the
 * route reuses) hits real (fake) storage.
 */
vi.mock('@devvit/web/server', () => ({
  context: {
    userId: undefined as string | undefined,
    subredditId: 't5_test',
    subredditName: 'testsub',
    postId: 't3_post',
  },
  reddit: {
    getCurrentUsername: vi.fn(),
    getCurrentSubreddit: vi.fn(),
  },
  redis: {},
}));

const ctx = context as unknown as { userId: string | undefined };

let fake: FakeRedis;
let store: Store;

beforeEach(() => {
  vi.clearAllMocks();
  fake = makeFakeRedis();
  Object.assign(redis, fake);
  store = new Store(fake);
});

const postJson = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const getDaily = async () => (await (await puzzle.request('/')).json()) as PuzzleDailyResponse;
const solve = async (body: unknown) =>
  (await (await puzzle.request('/solve', postJson(body))).json()) as PuzzleSolveResponse;

describe('GET /api/puzzle — daily selection', () => {
  it('rejects unauthenticated requests', async () => {
    ctx.userId = undefined;
    const res = await puzzle.request('/');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ status: 'error', message: 'Not logged in' });
  });

  it('picks a deterministic level from the UTC date + world seed', async () => {
    ctx.userId = 't2_daily';
    const a = await getDaily();
    const b = await getDaily();
    // Same for everyone on the same UTC day.
    expect(a.levelId).toBe(b.levelId);
    // No city yet -> the world seed falls back to the installation seed.
    const expected = dailyLevelId(utcDateString(new Date()), hashString('t5_test'));
    expect(a.levelId).toBe(expected);
    expect(a.level.id).toBe(a.levelId);
    expect(a.dailyId).toBe(utcDateString(new Date()));
    // The level-select list carries every shipped level with a null best so far.
    expect(a.levels).toHaveLength(PUZZLE_LEVELS.length);
    expect(a.levels.every((l) => l.best === null)).toBe(true);
    expect(a.yourBest).toBeNull();
    expect(a.solvedCount).toBe(0);
    expect(a.bestMoves).toBeNull();
    expect(a.yourRank).toBeNull();
  });

  it('keeps V1 daily boards in the approachable first two chapters', () => {
    expect(DAILY_PUZZLE_LEVELS.length).toBeGreaterThan(0);
    expect(DAILY_PUZZLE_LEVELS.every((level) => level.chapter <= 2)).toBe(true);

    for (let day = 1; day <= 31; day += 1) {
      for (let seed = 0; seed < 20; seed += 1) {
        const id = dailyLevelId(`2026-07-${String(day).padStart(2, '0')}`, seed);
        expect(DAILY_PUZZLE_LEVELS.some((level) => level.id === id)).toBe(true);
      }
    }
  });
});

describe('POST /api/puzzle/solve — validation, scoring, reward', () => {
  it('400s an unknown level id', async () => {
    ctx.userId = 't2_x';
    const res = await puzzle.request('/solve', postJson({ levelId: 9999, rotations: [], moves: 0, timeMs: 0 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ status: 'error', message: 'Unknown level' });
  });

  it('accepts a real solution, banks 3 stars, records the best, and rewards once', async () => {
    ctx.userId = 't2_win';
    const daily = await getDaily();
    const level = puzzleLevelById(daily.levelId)!;
    const rotations = solutionRotations(level);

    const floor = provableFloor(level);
    const first = await solve({ levelId: daily.levelId, rotations, moves: floor, timeMs: 4200 });
    expect(first.accepted).toBe(true);
    expect(first.stars).toBe(3);
    expect(first.best).toEqual({ stars: 3, moves: floor, timeMs: 4200 });
    expect(first.improved).toBe(true);
    expect(first.reward).toBe('+3 standing · the district is back online');
    expect(first.solvedCount).toBe(1);
    expect(first.bestMoves).toBe(floor);
    expect(first.yourRank).toBe(1);
    // The reward is banked as +3 lifetime standing.
    expect(await store.getContributionScore('t2_win')).toBe(3);
    // The daily claim is stamped so the reward cannot be minted twice.
    expect(await fake.get(KEYS.puzzleClaim(daily.dailyId, 't2_win'))).toBe('1');

    // A second solve on the same daily does NOT re-award the city contribution.
    const second = await solve({ levelId: daily.levelId, rotations, moves: 3, timeMs: 4200 });
    expect(second.accepted).toBe(true);
    expect(second.reward).toBeNull();
    expect(await store.getContributionScore('t2_win')).toBe(3);
  });

  it('rejects an unsolved board with no stars and no reward', async () => {
    ctx.userId = 't2_fail';
    const daily = await getDaily();
    const level = puzzleLevelById(daily.levelId)!;
    // The scrambled starting rotations are unsolved by construction.
    const res = await solve({ levelId: daily.levelId, rotations: initialRotations(level), moves: 1, timeMs: 500 });
    expect(res.accepted).toBe(false);
    expect(res.stars).toBe(0);
    expect(res.reward).toBeNull();
    expect(res.best).toBeNull();
    expect(res.improved).toBe(false);
    expect(res.solvedCount).toBe(0);
    // No standing was banked and no reward was granted.
    expect(await store.getContributionScore('t2_fail')).toBeUndefined();
  });

  it('keeps only the strictly-better score (stars beat moves beat time)', async () => {
    ctx.userId = 't2_best';
    const daily = await getDaily();
    const level = puzzleLevelById(daily.levelId)!;
    const rotations = solutionRotations(level);
    const floor = provableFloor(level); // fewest possible moves for this board
    const over = level.moveTarget + 5; // solved but beyond the target -> 1 star

    // A sloppy over-target solve lands 1 star and sets the first record.
    const a = await solve({ levelId: daily.levelId, rotations, moves: over, timeMs: 9000 });
    expect(a.stars).toBe(1);
    expect(a.best).toEqual({ stars: 1, moves: over, timeMs: 9000 });
    expect(a.improved).toBe(true);

    // A clean solve (within target, all optional lit) is 3 stars -> replaces it.
    // floor + 1 stays within target (the daily pool keeps >=1 slack over the floor).
    const b = await solve({ levelId: daily.levelId, rotations, moves: floor + 1, timeMs: 3000 });
    expect(b.stars).toBe(3);
    expect(b.best).toEqual({ stars: 3, moves: floor + 1, timeMs: 3000 });
    expect(b.improved).toBe(true);

    // Fewer moves at the same star tier improves the record (down to the floor).
    const c = await solve({ levelId: daily.levelId, rotations, moves: floor, timeMs: 5000 });
    expect(c.improved).toBe(true);
    expect(c.best).toEqual({ stars: 3, moves: floor, timeMs: 5000 });

    // More moves at the same tier does NOT (even with a faster time).
    const d = await solve({ levelId: daily.levelId, rotations, moves: floor + 1, timeMs: 10 });
    expect(d.improved).toBe(false);
    expect(d.best).toEqual({ stars: 3, moves: floor, timeMs: 5000 });

    // Fewer stars never overwrite a better record.
    const e = await solve({ levelId: daily.levelId, rotations, moves: over + 2, timeMs: 1 });
    expect(e.stars).toBe(1);
    expect(e.improved).toBe(false);
    expect(e.best).toEqual({ stars: 3, moves: floor, timeMs: 5000 });
  });

  it('records a personal best off the daily level but grants no city reward', async () => {
    ctx.userId = 't2_other';
    const daily = await getDaily();
    const other = PUZZLE_LEVELS.find((l) => l.id !== daily.levelId)!;

    const floor = provableFloor(other);
    const res = await solve({ levelId: other.id, rotations: solutionRotations(other), moves: floor, timeMs: 1000 });
    expect(res.accepted).toBe(true);
    expect(res.stars).toBe(3);
    // Personal best is still saved...
    expect(res.best).toEqual({ stars: 3, moves: floor, timeMs: 1000 });
    // ...but no daily reward and no daily standing for an off-daily solve.
    expect(res.reward).toBeNull();
    expect(res.solvedCount).toBe(0);
    expect(res.yourRank).toBeNull();
    expect(await store.getContributionScore('t2_other')).toBeUndefined();

    // The saved best surfaces on the level-select list next time.
    const again = await getDaily();
    expect(again.levels.find((l) => l.id === other.id)?.best).toEqual({ stars: 3, moves: floor, timeMs: 1000 });
  });

  it('ranks the fewest-moves solver first across two citizens', async () => {
    ctx.userId = 't2_slow';
    const daily = await getDaily();
    const level = puzzleLevelById(daily.levelId)!;
    const rotations = solutionRotations(level);
    const floor = provableFloor(level);

    await solve({ levelId: daily.levelId, rotations, moves: floor + 5, timeMs: 6000 });

    ctx.userId = 't2_fast';
    const fast = await solve({ levelId: daily.levelId, rotations, moves: floor, timeMs: 2000 });
    expect(fast.solvedCount).toBe(2);
    expect(fast.bestMoves).toBe(floor);
    expect(fast.yourRank).toBe(1);

    ctx.userId = 't2_slow';
    const slowAgain = await getDaily();
    expect(slowAgain.yourRank).toBe(2);
    expect(slowAgain.solvedCount).toBe(2);
    expect(slowAgain.bestMoves).toBe(floor);
  });
});
