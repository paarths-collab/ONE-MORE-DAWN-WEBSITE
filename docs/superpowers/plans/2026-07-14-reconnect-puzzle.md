# Plan: "Reconnect the City" — daily tile-rotation puzzle

Locked contract. The shared ENGINE is DONE and tested — do not change it. Each
lane below builds against it in isolated files. The integrator (me) wires the
board into the app, the client API, the dev mock, and the smoke test.

## Shared engine (DONE — `src/shared/puzzle.ts`, `src/shared/puzzleLevels.ts`)

Pure, tested (`src/shared/puzzle.test.ts`, 17 passing). Key exports:

```ts
type PuzzleLevel = { id; name; chapter; width; height; moveTarget; cells: PuzzleCell[]; separateSources? }
type PuzzleCell = blocked | source{capacity} | building{kind,required} | tile{kind,rot,sol,locked?,sw?}
type PuzzleEval = { poweredTiles: boolean[]; poweredBuildings: Record<"x,y",boolean>;
                    overloaded; crossed; requiredMet; requiredTotal; requiredPowered;
                    optionalTotal; optionalPowered; solved }
tileCells(level)            // rotatable tiles, stable order (state array aligns to this)
initialRotations(level)     // scrambled starting rotations (number[], per tileCells)
solutionRotations(level)    // a known solving set (hint / server sanity)
rotateTile(level, rots, i)  // pure; switches flip 180°, locked tiles don't move
evaluate(level, rots)       // -> PuzzleEval
starRating(level, ev, moves)// 0..3 cumulative: solved / within moveTarget / all optional
POWER_COST, BUILDING_LABEL, TILE_EDGES, TILE_STATES
PUZZLE_LEVELS (9 levels), puzzleLevelById(id)
```

Rules: conductors = sources + tiles; buildings are SINKS. A building is powered
if reachable from a source through mutually-open edges and its component isn't
overloaded (load > capacity) or crossed (`separateSources` + two sources touch).
Stars: ★ all required connected, ★★ within moveTarget, ★★★ all optional too.

## Payload types (DONE — `src/shared/types.ts`)

`PuzzleScore{stars,moves,timeMs}`, `PuzzleDailyResponse`, `PuzzleSolveRequest`,
`PuzzleSolveResponse`. See the file; both lanes must use these verbatim.

---

## LANE A — Backend (agent). Files: `src/server/routes/puzzle.ts` (new),
`src/server/storage/redisKeys.ts`, `src/server/storage/store.ts`,
`src/server/index.ts` (register), `src/server/routes/puzzle.routes.test.ts` (new).

- Daily selection: `dailyId = utcDateString(now)`; pick `PUZZLE_LEVELS[hashString(dailyId + ':' + worldSeed) % PUZZLE_LEVELS.length]`. Deterministic; same for everyone that UTC day.
- Redis keys (add to KEYS): `puzzleProgress: (userId) => 'puzzle:progress:'+userId` (hash levelId->JSON PuzzleScore, keep the BEST), `puzzleDaily: (dailyId) => 'puzzle:daily:'+dailyId` (zset member=userId score=moves, lower=better), `puzzleClaim: (dailyId,userId) => 'puzzle:claim:'+dailyId+':'+userId` (NX, one city reward per daily). Add these to the Phoenix/mod reset key lists too.
- Store methods: getPuzzleProgress(userId)->Record<levelId,PuzzleScore>; setPuzzleScore(userId, levelId, score) (only overwrite if strictly better by stars, then fewer moves, then faster time); puzzleDailyRank(dailyId, userId)->{rank,solvedCount,bestMoves}; recordPuzzleDaily(dailyId, userId, moves).
- GET `/api/puzzle`: build a `PuzzleDailyResponse` (today's level + full data, yourBest for that level, solvedCount/bestMoves/yourRank from the daily zset, and `levels[]` = every level's id/name/chapter + your best). requireUser like other routes.
- POST `/api/puzzle/solve` (body `PuzzleSolveRequest`): re-run `evaluate(level, rotations)`; `accepted = ev.solved`. If accepted: `stars = starRating(level, ev, moves)`; update best (setPuzzleScore); if this is TODAY's daily level, recordPuzzleDaily + (once, via puzzleClaim NX) award a small city contribution — `store.addContribution(userId, 3)` and reward string like `"+3 standing · the district is back online"`. Return `PuzzleSolveResponse`. Never lets the city fall; purely additive.
- Register the router in `src/server/index.ts` beside the api/menu/mission routers (match that pattern exactly).
- Tests: daily determinism; solve of a real level (use `solutionRotations`) is accepted + 3 stars + best recorded + reward once (second solve → reward null); an unsolved board → accepted:false, no reward; a better score replaces a worse one, a worse one doesn't.
- Reuse existing patterns: `requireUser`, `redisLike`, `getStore`, `runLazyResolution`/`utcDateString`, `beginUserLock` if needed, `hashString`. Do NOT touch client files or types.ts.

## LANE B — Frontend board (agent). Files: NEW `src/client/PuzzleGame.tsx`
(+ optional `src/client/puzzle.css` imported by it). Do NOT edit App.tsx / api.ts / styles.css.

A SELF-CONTAINED React component that plays one level:

```tsx
export function PuzzleGame(props: {
  level: PuzzleLevel;
  onSolved: (score: { stars: 0|1|2|3; moves: number; timeMs: number }) => void; // fire once, when solved
  onExit: () => void;
}): JSX.Element
```

- Holds its own state via the shared engine: `rotations` (init `initialRotations(level)`), `moves`, a running timer, and `evaluate(level, rotations)` each render.
- Renders the grid (level.width × level.height). Draw tiles as clean SVG road/cable segments that ROTATE (CSS transform by rot×90°, animated ~150ms); powered tiles/edges GLOW (use `ev.poweredTiles`), unpowered are dim. Buildings drawn as labeled icons (BUILDING_LABEL) — lit when `ev.poweredBuildings["x,y"]`, dark otherwise; required vs optional visually distinct. Source = a glowing generator; blocked = a ruin; locked tile = a small lock badge; switch tile = a two-way badge.
- Tap a tile → `rotateTile`, `moves++`, play a rotate SFX (`playSound('puzzle_rotate')` from ./sound — import it; the cue is added by another lane, so guard with try/catch or optional import). When a building newly lights, `playSound('puzzle_connect')`.
- HUD: move counter vs `level.moveTarget`, a live star preview (`starRating`), timer, and — when the level has finite source capacity — a power meter (connected load / capacity, using POWER_COST). Buttons: Reset (back to initial), Hint (nudge one tile toward `solutionRotations`), Exit (calls onExit).
- On `ev.solved` (first time): a payoff — roads/cables glow, buildings light one by one, a banner "THE DISTRICT IS CONNECTED — N buildings restored", play `playSound('puzzle_win')`, then call `props.onSolved({stars,moves,timeMs})` (once). Let the player keep exiting.
- Phone-first: fully responsive, big tap targets, no external assets, matches One More Dawn's warm dusk palette (dark bg, gold/ember accents, cyan "power" glow). Use the frontend-design skill's taste — make it polished and characterful, not generic.

Return in your final message: the exact PuzzleGame prop signature, a 3-sentence description of the board's look/interaction, and confirmation that `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i PuzzleGame` is clean (ignore errors in files other lanes are mid-editing).

## LANE C — SFX (agent). Files: `src/client/sound.ts`, `tools/gen-sfx.mjs`,
new `public/assets/sfx/puzzle_*.wav`. Add cues `puzzle_rotate` (short mechanical
tick/click), `puzzle_connect` (a bright rising blip when a building lights),
`puzzle_win` (a warm triumphant chime for level complete). Same CC0 ffmpeg
derivation as the existing dome/raid cues (see docs/ATTRIBUTION.md + gen-sfx.mjs);
add rows to ATTRIBUTION.md. Verify the three files exist on disk and `grep sound.ts`
in tsc output is clean.

## Integration (me, after lanes land)
App.tsx: a "RECONNECT" / daily-puzzle entry (a card in the CITY tab + a dedicated
overlay) that fetches `/api/puzzle`, mounts `<PuzzleGame>`, and on `onSolved` POSTs
`/api/puzzle/solve` and shows the reward + rank + share line
("I restored the city in N moves. Can you beat it?"). client `api.ts` helpers
`getPuzzle()` / `solvePuzzle()`. Dev mock (vite.dev3d.config.mjs) for `/api/puzzle`
+ `/api/puzzle/solve`. A client-smoke walk that opens the puzzle, solves via the
hint button, and sees the payoff. Gates: type-check, lint, tests, build, smoke.
Branch `feat/reconnect-puzzle`, PR, `main` stays clean.
