import { Hono } from 'hono';
import type {
  ApiError,
  PuzzleDailyResponse,
  PuzzleScore,
  PuzzleSolveRequest,
  PuzzleSolveResponse,
} from '../../shared/types';
import { evaluate, starRating } from '../../shared/puzzle';
import { PUZZLE_LEVELS, puzzleLevelById } from '../../shared/puzzleLevels';
import { hashString } from '../../shared/rng';
import { utcDateString } from '../game/lazyResolve';
import { KEYS } from '../storage/redisKeys';
import { deriveWorldSeed, getStore, parseBody, redisLike, requireUser } from './api';

export const puzzle = new Hono();

/**
 * Today's level for this installation: deterministic from the UTC date +
 * the per-city worldSeed, so everyone in the same subreddit gets the same
 * puzzle each day, and different subs get different sequences. `hashString`
 * returns an unsigned 32-bit int, so the modulo is always a valid, in-range,
 * non-negative index.
 */
export const dailyLevelId = (dailyId: string, worldSeed: number): number =>
  PUZZLE_LEVELS[hashString(`${dailyId}:${worldSeed}`) % PUZZLE_LEVELS.length]!.id;

/** The world seed to key today's puzzle on: the live city's, or the neutral
 *  installation seed before a city exists (the puzzle is playable pre-city). */
const puzzleWorldSeed = async (): Promise<number> => {
  const city = await getStore().getCityState();
  return city?.worldSeed ?? deriveWorldSeed();
};

/**
 * GET /api/puzzle — today's daily board plus the caller's standing on it and a
 * full level-select list carrying their personal best on every shipped level.
 */
puzzle.get('/', async (c) => {
  const user = requireUser();
  if (!user) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();

  const dailyId = utcDateString(new Date());
  const levelId = dailyLevelId(dailyId, await puzzleWorldSeed());
  // dailyLevelId always resolves to a shipped level id, so this is never undefined.
  const level = puzzleLevelById(levelId)!;

  const [progress, standing] = await Promise.all([
    store.getPuzzleProgress(user.userId),
    store.puzzleDailyStanding(dailyId, user.userId),
  ]);

  return c.json<PuzzleDailyResponse>({
    type: 'puzzle',
    dailyId,
    levelId,
    level,
    yourBest: progress[levelId] ?? null,
    solvedCount: standing.solvedCount,
    bestMoves: standing.bestMoves,
    yourRank: standing.rank,
    levels: PUZZLE_LEVELS.map((l) => ({
      id: l.id,
      name: l.name,
      chapter: l.chapter,
      best: progress[l.id] ?? null,
    })),
  });
});

/**
 * POST /api/puzzle/solve — validate a finished board and score it. The client is
 * NEVER trusted for "solved": the pure engine is re-run here and `accepted` is
 * the authoritative verdict. On an accepted solve the personal best is updated
 * (only if strictly better) and, when it's TODAY's daily level, a one-per-daily
 * city contribution is awarded behind an NX claim. This path is purely additive
 * to the city — it can never make the city fall.
 */
puzzle.post('/solve', async (c) => {
  const user = requireUser();
  if (!user) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();

  const body = await parseBody<PuzzleSolveRequest>(c);
  if (!body || typeof body.levelId !== 'number' || !Array.isArray(body.rotations)) {
    return c.json<ApiError>({ status: 'error', message: 'Bad request' }, 400);
  }
  const level = puzzleLevelById(body.levelId);
  if (!level) return c.json<ApiError>({ status: 'error', message: 'Unknown level' }, 400);

  // Clamp the client-reported counters to sane, non-negative integers so a
  // malformed or hostile payload can never mint negative moves/time or NaN stars.
  const moves = Math.max(0, Math.floor(Number(body.moves) || 0));
  const timeMs = Math.max(0, Math.floor(Number(body.timeMs) || 0));

  const ev = evaluate(level, body.rotations);
  const accepted = ev.solved;

  const dailyId = utcDateString(new Date());
  const isDaily = body.levelId === dailyLevelId(dailyId, await puzzleWorldSeed());

  let stars: 0 | 1 | 2 | 3 = 0;
  let best: PuzzleScore | null; // assigned in both branches below
  let improved = false;
  let reward: string | null = null;

  if (accepted) {
    stars = starRating(level, ev, moves);
    const result = await store.setPuzzleScore(user.userId, body.levelId, { stars, moves, timeMs });
    best = result.best;
    improved = result.improved;

    if (isDaily) {
      await store.recordPuzzleDaily(dailyId, user.userId, moves);
      // One city contribution per player per daily, gated by an NX claim so a
      // repeat solve (or a second device) can never double-award. TTL past the
      // day so the key self-cleans.
      const claimed = await redisLike.set(KEYS.puzzleClaim(dailyId, user.userId), '1', {
        nx: true,
        expiration: 3 * 24 * 3600,
      });
      if (claimed) {
        await store.addContribution(user.userId, 3);
        reward = '+3 standing · the district is back online';
      }
    }
  } else {
    // Unsolved: nothing is written, but surface any prior best so the client can
    // still show where the player stands.
    best = (await store.getPuzzleProgress(user.userId))[body.levelId] ?? null;
  }

  const standing = await store.puzzleDailyStanding(dailyId, user.userId);
  return c.json<PuzzleSolveResponse>({
    type: 'puzzle_solve',
    accepted,
    stars,
    best,
    improved,
    reward,
    solvedCount: standing.solvedCount,
    bestMoves: standing.bestMoves,
    yourRank: standing.rank,
  });
});
