// The "Reconnect the City" level set. Levels are DATA (spec: the engine loads
// them, so growing 20 -> 100 is just more entries). To keep every level provably
// solvable without a solver, each is authored as connection PATHS from a source
// through tiles to buildings: the builder derives each tile's kind + solving
// rotation from the paths, then a few tiles are scrambled away from that solution.
// The engine's tests replay the solution to confirm each level is well-formed.
import {
  type BuildingKind,
  type PuzzleCell,
  type PuzzleLevel,
  type TileKind,
  TILE_EDGES,
  rotateEdges,
} from './puzzle';

const BIT = [1, 2, 4, 8]; // N,E,S,W
const dirBetween = (ax: number, ay: number, bx: number, by: number): number => {
  if (bx === ax && by === ay - 1) return 0; // N
  if (bx === ax + 1 && by === ay) return 1; // E
  if (bx === ax && by === ay + 1) return 2; // S
  if (bx === ax - 1 && by === ay) return 3; // W
  return -1; // not adjacent
};

const tileFromEdges = (edges: number): { kind: TileKind; sol: number } => {
  const kinds: TileKind[] = ['straight', 'corner', 'tee', 'cross', 'dead_end'];
  for (const kind of kinds) for (let r = 0; r < 4; r++) if (rotateEdges(TILE_EDGES[kind], r) === edges) return { kind, sol: r };
  return { kind: 'cross', sol: 0 };
};

type Pt = [number, number];
type BuildSpec = { at: Pt; kind: BuildingKind; required: boolean };
type LevelSpec = {
  id: number;
  name: string;
  chapter: number;
  width: number;
  height: number;
  moveTarget: number;
  sources: { at: Pt; capacity?: number }[];
  buildings: BuildSpec[];
  blocked?: Pt[];
  paths: Pt[][]; // each is a polyline of adjacent cells: source -> ... -> building
  scramble?: Pt[]; // tiles that ship rotated away from their solution
  locked?: Pt[]; // tiles fixed at their solution (immovable)
  switches?: Pt[]; // tiles that toggle 180° on tap
  separateSources?: boolean;
};

const buildLevel = (spec: LevelSpec): PuzzleLevel => {
  const k = (x: number, y: number) => `${x},${y}`;
  const sourceKeys = new Set(spec.sources.map((s) => k(s.at[0], s.at[1])));
  const buildingKeys = new Set(spec.buildings.map((b) => k(b.at[0], b.at[1])));
  const blockedKeys = new Set((spec.blocked ?? []).map((p) => k(p[0], p[1])));
  const scrambleKeys = new Set((spec.scramble ?? []).map((p) => k(p[0], p[1])));
  const lockedKeys = new Set((spec.locked ?? []).map((p) => k(p[0], p[1])));
  const switchKeys = new Set((spec.switches ?? []).map((p) => k(p[0], p[1])));

  // Accumulate each tile position's solved open-edge set from the paths.
  const edges = new Map<string, number>();
  const addEdge = (x: number, y: number, dir: number) => {
    if (dir < 0) return;
    edges.set(k(x, y), (edges.get(k(x, y)) ?? 0) | BIT[dir]!);
  };
  for (const path of spec.paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, ay] = path[i]!;
      const [bx, by] = path[i + 1]!;
      const d = dirBetween(ax, ay, bx, by);
      if (d < 0) throw new Error(`Level ${spec.id}: non-adjacent path step ${ax},${ay}->${bx},${by}`);
      addEdge(ax, ay, d);
      addEdge(bx, by, (d + 2) % 4);
    }
  }

  const cells: PuzzleCell[] = [];
  for (const s of spec.sources) cells.push({ t: 'source', x: s.at[0], y: s.at[1], capacity: s.capacity ?? -1 });
  for (const b of spec.buildings) cells.push({ t: 'building', x: b.at[0], y: b.at[1], kind: b.kind, required: b.required });
  for (const p of spec.blocked ?? []) cells.push({ t: 'blocked', x: p[0], y: p[1] });
  for (const [kk, e] of edges) {
    if (sourceKeys.has(kk) || buildingKeys.has(kk) || blockedKeys.has(kk)) continue; // endpoints aren't tiles
    const [x, y] = kk.split(',').map(Number) as [number, number];
    const { kind, sol } = tileFromEdges(e);
    const scrambled = scrambleKeys.has(kk);
    const off = scrambled ? (kind === 'straight' ? 1 : 3) : 0; // 1 tap from solved when scrambled
    cells.push({
      t: 'tile', x, y, kind, sol,
      rot: (sol + off) & 3,
      ...(lockedKeys.has(kk) ? { locked: true } : {}),
      ...(switchKeys.has(kk) ? { sw: true } : {}),
    });
  }
  return {
    id: spec.id, name: spec.name, chapter: spec.chapter,
    width: spec.width, height: spec.height, moveTarget: spec.moveTarget,
    cells,
    ...(spec.separateSources ? { separateSources: true } : {}),
  };
};

// ---------------------------------------------------------------------------
// Chapter 1 — The City Goes Dark (basics + branching)
// ---------------------------------------------------------------------------
const L1 = buildLevel({
  id: 1, name: 'First Light', chapter: 1, width: 5, height: 5, moveTarget: 6,
  sources: [{ at: [0, 4] }],
  buildings: [
    { at: [0, 0], kind: 'water_pump', required: true },
    { at: [4, 0], kind: 'shelter', required: true },
    { at: [4, 4], kind: 'clinic', required: true },
    { at: [2, 0], kind: 'house', required: false },
    { at: [2, 4], kind: 'house', required: false },
  ],
  paths: [
    [[0, 4], [0, 3], [0, 2], [0, 1], [0, 0]], // source -> water_pump (up col 0)
    [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [4, 1], [4, 0]], // -> shelter
    [[4, 2], [4, 3], [4, 4]], // -> clinic
    [[2, 2], [2, 1], [2, 0]], // -> optional house (top)
    [[2, 2], [2, 3], [2, 4]], // -> optional house (bottom)
  ],
  scramble: [[0, 3], [3, 2], [4, 3], [2, 1], [2, 3]],
});

const L2 = buildLevel({
  id: 2, name: 'Split Decision', chapter: 1, width: 5, height: 5, moveTarget: 7,
  sources: [{ at: [2, 4] }],
  buildings: [
    { at: [0, 0], kind: 'clinic', required: true },
    { at: [4, 0], kind: 'storehouse', required: true },
    { at: [0, 2], kind: 'house', required: false },
    { at: [4, 2], kind: 'house', required: false },
    { at: [2, 0], kind: 'house', required: false },
  ],
  paths: [
    [[2, 4], [2, 3], [2, 2], [2, 1], [2, 0]], // spine up -> optional house top
    [[2, 2], [1, 2], [0, 2]], // -> optional house left
    [[2, 2], [3, 2], [4, 2]], // -> optional house right
    [[2, 1], [1, 1], [0, 1], [0, 0]], // -> clinic
    [[2, 1], [3, 1], [4, 1], [4, 0]], // -> storehouse
  ],
  scramble: [[2, 3], [1, 1], [4, 1], [1, 2]],
});

const L3 = buildLevel({
  id: 3, name: 'Around the Ruins', chapter: 1, width: 5, height: 5, moveTarget: 8,
  sources: [{ at: [0, 4] }],
  buildings: [
    { at: [4, 0], kind: 'clinic', required: true },
    { at: [4, 4], kind: 'shelter', required: true },
    { at: [0, 0], kind: 'house', required: false },
    { at: [2, 0], kind: 'house', required: false },
  ],
  blocked: [[2, 2], [1, 2]], // ruined tiles to route around
  paths: [
    [[0, 4], [0, 3], [0, 2], [0, 1], [0, 0]], // -> optional house top-left
    [[0, 1], [1, 1], [2, 1], [2, 0]], // -> optional house top-mid
    [[2, 1], [3, 1], [4, 1], [4, 0]], // -> clinic
    [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]], // -> shelter (along the bottom)
  ],
  scramble: [[0, 3], [2, 1], [4, 1], [2, 4], [3, 4]],
});

// ---------------------------------------------------------------------------
// Chapter 2 — Broken Districts (locked tiles, blockers)
// ---------------------------------------------------------------------------
const L6 = buildLevel({
  id: 6, name: 'The Locked Junction', chapter: 2, width: 6, height: 6, moveTarget: 8,
  sources: [{ at: [0, 5] }],
  buildings: [
    { at: [5, 0], kind: 'clinic', required: true },
    { at: [5, 5], kind: 'farm', required: true },
    { at: [0, 0], kind: 'shelter', required: true },
    { at: [3, 0], kind: 'house', required: false },
  ],
  paths: [
    [[0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0]], // -> shelter up col 0
    [[0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3]], // central bus
    [[3, 3], [3, 2], [3, 1], [3, 0]], // -> optional house
    [[5, 3], [5, 2], [5, 1], [5, 0]], // -> clinic
    [[5, 3], [5, 4], [5, 5]], // -> farm
  ],
  locked: [[3, 3]], // the fixed central junction the network must respect
  scramble: [[0, 4], [1, 3], [5, 2], [5, 4], [3, 1]],
});

// ---------------------------------------------------------------------------
// Chapter 3 — Limited Power (source capacity)
// ---------------------------------------------------------------------------
const L11 = buildLevel({
  id: 11, name: 'Power Discipline', chapter: 3, width: 6, height: 6, moveTarget: 9,
  sources: [{ at: [0, 5], capacity: 10 }], // required 7 + 2 optional houses = 9, comfortably under
  buildings: [
    { at: [0, 0], kind: 'water_pump', required: true }, // 2
    { at: [5, 5], kind: 'clinic', required: true }, // 3
    { at: [5, 0], kind: 'shelter', required: true }, // 2
    { at: [2, 3], kind: 'house', required: false }, // 1
    { at: [3, 3], kind: 'house', required: false }, // 1
  ],
  paths: [
    [[0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0]], // -> water_pump (up col 0)
    [[0, 5], [1, 5], [2, 5], [3, 5], [4, 5], [5, 5]], // -> clinic (bottom bus)
    [[4, 5], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0], [5, 0]], // -> shelter (up col 4)
    [[2, 5], [2, 4], [2, 3]], // -> optional house
    [[4, 3], [3, 3]], // -> optional house
  ],
  scramble: [[0, 4], [3, 5], [4, 2], [2, 4], [4, 1]],
});

const L14 = buildLevel({
  id: 14, name: 'The Switchyard', chapter: 3, width: 6, height: 6, moveTarget: 8,
  sources: [{ at: [0, 3], capacity: -1 }],
  buildings: [
    { at: [5, 1], kind: 'clinic', required: true },
    { at: [5, 4], kind: 'storehouse', required: true },
    { at: [0, 0], kind: 'house', required: false },
    { at: [0, 5], kind: 'house', required: false },
  ],
  paths: [
    [[0, 3], [0, 2], [0, 1], [0, 0]], // -> optional house top
    [[0, 3], [0, 4], [0, 5]], // -> optional house bottom
    [[0, 3], [1, 3], [2, 3], [3, 3]], // bus to the switch at (3,3)
    [[3, 3], [3, 2], [3, 1], [4, 1], [5, 1]], // -> clinic
    [[3, 3], [3, 4], [4, 4], [5, 4]], // -> storehouse
  ],
  switches: [[3, 3]], // a switch tile the player toggles to feed both branches
  scramble: [[1, 3], [3, 2], [4, 4], [0, 2]],
});

// ---------------------------------------------------------------------------
// Chapter 4 — Two Halves of the City (two sources)
// ---------------------------------------------------------------------------
const L16 = buildLevel({
  id: 16, name: 'Backup Generator', chapter: 4, width: 7, height: 7, moveTarget: 10,
  sources: [{ at: [0, 6], capacity: 8 }, { at: [6, 6], capacity: 8 }],
  buildings: [
    { at: [0, 0], kind: 'clinic', required: true },
    { at: [2, 0], kind: 'farm', required: true },
    { at: [6, 0], kind: 'shelter', required: true },
    { at: [4, 0], kind: 'water_pump', required: true },
    { at: [3, 3], kind: 'house', required: false },
  ],
  paths: [
    [[0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0]], // main -> clinic
    [[0, 3], [1, 3], [2, 3], [2, 2], [2, 1], [2, 0]], // main -> farm
    [[2, 3], [3, 3]], // main -> optional house
    [[6, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0]], // backup -> shelter
    [[6, 3], [5, 3], [4, 3], [4, 2], [4, 1], [4, 0]], // backup -> water_pump
  ],
  scramble: [[0, 5], [2, 2], [6, 5], [4, 2], [5, 3]],
});

const L17 = buildLevel({
  id: 17, name: 'No Crossed Lines', chapter: 4, width: 7, height: 7, moveTarget: 11,
  separateSources: true,
  sources: [{ at: [0, 6], capacity: 12 }, { at: [6, 0], capacity: 12 }],
  buildings: [
    { at: [0, 0], kind: 'clinic', required: true },
    { at: [2, 0], kind: 'shelter', required: true },
    { at: [6, 6], kind: 'farm', required: true },
    { at: [4, 6], kind: 'water_pump', required: true },
    { at: [0, 3], kind: 'house', required: false },
    { at: [6, 3], kind: 'house', required: false },
  ],
  paths: [
    // West network (must NOT touch the east one)
    [[0, 6], [0, 5], [0, 4], [0, 3]], // -> optional west
    [[0, 4], [1, 4], [2, 4], [2, 3], [2, 2], [2, 1], [2, 0]], // -> shelter
    [[2, 4], [1, 4], [0, 4]],
    [[2, 2], [1, 2], [0, 2], [0, 1], [0, 0]], // -> clinic
    // East network
    [[6, 0], [6, 1], [6, 2], [6, 3]], // -> optional east
    [[6, 2], [5, 2], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6]], // -> water_pump
    [[4, 4], [5, 4], [6, 4], [6, 5], [6, 6]], // -> farm
  ],
  scramble: [[0, 5], [2, 2], [6, 1], [4, 3], [5, 4]],
});

// ---------------------------------------------------------------------------
// Chapter 4 finale — the milestone board
// ---------------------------------------------------------------------------
const L20 = buildLevel({
  id: 20, name: 'Reconnect the City', chapter: 4, width: 8, height: 8, moveTarget: 14,
  sources: [{ at: [0, 7], capacity: 14 }, { at: [7, 7], capacity: 14 }],
  buildings: [
    { at: [0, 0], kind: 'clinic', required: true }, // 3
    { at: [2, 0], kind: 'water_pump', required: true }, // 2
    { at: [4, 0], kind: 'shelter', required: true }, // 2
    { at: [3, 3], kind: 'council_hall', required: true }, // 4  (main required = 11)
    { at: [7, 0], kind: 'farm', required: true }, // 2
    { at: [7, 2], kind: 'storehouse', required: true }, // 2
    { at: [5, 3], kind: 'watchtower', required: true }, // 3  (backup required = 7)
    { at: [1, 5], kind: 'house', required: false },
    { at: [2, 5], kind: 'house', required: false },
    { at: [5, 5], kind: 'house', required: false },
    { at: [7, 4], kind: 'house', required: false },
  ],
  paths: [
    // MAIN (source 0,7): buildings are all leaves off a col-0 spine + branches.
    [[0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0]], // -> clinic (top of col 0)
    [[0, 2], [1, 2], [2, 2], [2, 1], [2, 0]], // -> water_pump
    [[2, 2], [3, 2], [4, 2], [4, 1], [4, 0]], // -> shelter
    [[0, 4], [1, 4], [2, 4], [3, 4], [3, 3]], // -> council_hall
    [[0, 5], [1, 5]], // -> optional house
    [[0, 6], [1, 6], [2, 6], [2, 5]], // -> optional house
    // BACKUP (source 7,7): leaves off a spine down col 6.
    [[7, 7], [6, 7], [6, 6], [6, 5], [6, 4], [6, 3], [6, 2]], // spine
    [[6, 2], [7, 2]], // -> storehouse
    [[6, 2], [6, 1], [6, 0], [7, 0]], // -> farm
    [[6, 3], [5, 3]], // -> watchtower
    [[6, 5], [5, 5]], // -> optional house
    [[6, 4], [7, 4]], // -> optional house
  ],
  scramble: [[0, 6], [1, 2], [2, 1], [3, 2], [3, 4], [6, 7], [6, 1], [6, 3], [6, 5], [1, 6]],
});

export const PUZZLE_LEVELS: PuzzleLevel[] = [L1, L2, L3, L6, L11, L14, L16, L17, L20];

export const puzzleLevelById = (id: number): PuzzleLevel | undefined =>
  PUZZLE_LEVELS.find((l) => l.id === id);
