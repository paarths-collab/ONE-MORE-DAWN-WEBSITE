// "Reconnect the City" — a tile-rotation grid puzzle (pipe-puzzle) played as a
// daily challenge. This module is the PURE, data-driven engine shared by the
// client board and the server validator: given a level's tiles + their current
// rotations, it computes which buildings are powered, whether any source is
// overloaded, and the star rating. No IO, no rendering — the same result on both
// sides so the server can trust (and re-check) a submitted solution.
//
// Design contract: every level is DATA (see puzzleLevels.ts). Each rotatable
// tile ships with its scrambled `rot` plus its `sol` (a known solving rotation),
// so every level is solvable BY CONSTRUCTION and the engine never needs a solver.

// ---------- grid directions (N, E, S, W) ----------
export type Dir = 0 | 1 | 2 | 3;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const OPP: Dir[] = [2, 3, 0, 1];
const BIT = [1, 2, 4, 8]; // N=1, E=2, S=4, W=8 (bitmask of open edges)

/** Rotate an open-edge bitmask 90° clockwise `rot` times (N->E->S->W->N). */
export const rotateEdges = (edges: number, rot: number): number => {
  let e = edges & 15;
  const r = ((rot % 4) + 4) % 4;
  for (let i = 0; i < r; i++) e = ((e << 1) | (e >> 3)) & 15;
  return e;
};

// ---------- tiles ----------
export type TileKind = 'straight' | 'corner' | 'tee' | 'cross' | 'dead_end';
/** Open edges of each tile at rotation 0. */
export const TILE_EDGES: Record<TileKind, number> = {
  straight: 1 | 4, // N,S
  corner: 1 | 2, // N,E
  tee: 1 | 2 | 4, // N,E,S (missing W)
  cross: 15, // all four
  dead_end: 1, // N only
};
/** How many distinct orientations a tap cycles through (for hints/UI). */
export const TILE_STATES: Record<TileKind, number> = {
  straight: 2, corner: 4, tee: 4, cross: 1, dead_end: 4,
};

// ---------- buildings ----------
export type BuildingKind =
  | 'clinic' | 'shelter' | 'water_pump' | 'farm' | 'storehouse' | 'watchtower' | 'council_hall' | 'house';
/** Power a connected building draws from its source (Chapter 3+ capacity math). */
export const POWER_COST: Record<BuildingKind, number> = {
  house: 1, shelter: 2, farm: 2, water_pump: 2, storehouse: 2, clinic: 3, watchtower: 3, council_hall: 4,
};
export const BUILDING_LABEL: Record<BuildingKind, string> = {
  clinic: 'Clinic', shelter: 'Shelter', water_pump: 'Water Pump', farm: 'Farm',
  storehouse: 'Storehouse', watchtower: 'Watchtower', council_hall: 'Council Hall', house: 'House',
};

// ---------- level data ----------
export type PuzzleCell =
  | { t: 'blocked'; x: number; y: number }
  | { t: 'source'; x: number; y: number; capacity: number; edges?: number } // capacity Infinity-able via -1; edges default all
  | { t: 'building'; x: number; y: number; kind: BuildingKind; required: boolean; edges?: number }
  | { t: 'tile'; x: number; y: number; kind: TileKind; rot: number; sol: number; locked?: boolean; sw?: boolean };

export type PuzzleLevel = {
  id: number;
  name: string;
  chapter: number;
  width: number;
  height: number;
  moveTarget: number;
  cells: PuzzleCell[];
  /** Two networks may not touch (Chapter 4 "no crossed lines"); default false. */
  separateSources?: boolean;
};

const UNLIMITED = 1e9; // a source with capacity -1 never overloads
const cap = (c: number): number => (c < 0 ? UNLIMITED : c);
const key = (x: number, y: number): string => `${x},${y}`;
const edgesOf = (cell: PuzzleCell, rot: number): number => {
  switch (cell.t) {
    case 'tile':
      return rotateEdges(TILE_EDGES[cell.kind], rot);
    case 'source':
    case 'building':
      return cell.edges ?? 15; // default: connect on any side
    default:
      return 0; // blocked / empty conduct nothing
  }
};

// ---------- game state ----------
/** The rotatable tiles of a level, in a stable order (the state array aligns to this). */
export const tileCells = (level: PuzzleLevel): Extract<PuzzleCell, { t: 'tile' }>[] =>
  level.cells.filter((c): c is Extract<PuzzleCell, { t: 'tile' }> => c.t === 'tile');

/** Fresh rotations for a level's tiles, in `tileCells` order (their scrambled `rot`). */
export const initialRotations = (level: PuzzleLevel): number[] => tileCells(level).map((c) => c.rot & 3);

/** The known-solving rotations (used by the engine's own tests + the hint button). */
export const solutionRotations = (level: PuzzleLevel): number[] => tileCells(level).map((c) => c.sol & 3);

/** Tap tile index `i`: switches flip 180° (two states), others rotate 90°. Locked tiles don't move.
 *  Returns a NEW rotations array (pure) or the same array unchanged when locked. */
export const rotateTile = (level: PuzzleLevel, rotations: number[], i: number): number[] => {
  const tiles = tileCells(level);
  const tile = tiles[i];
  if (!tile || tile.locked) return rotations;
  const step = tile.sw ? 2 : 1;
  const next = rotations.slice();
  next[i] = ((rotations[i] ?? 0) + step) & 3;
  return next;
};

// ---------- evaluation ----------
export type PuzzleEval = {
  poweredTiles: boolean[]; // per tileCells index — is this conductor energized?
  poweredBuildings: Record<string, boolean>; // "x,y" -> powered
  overloaded: boolean; // any source-fed component drawing beyond its capacity
  crossed: boolean; // separateSources violated (two sources share a network)
  requiredMet: boolean; // every required building powered
  requiredTotal: number;
  requiredPowered: number;
  optionalTotal: number;
  optionalPowered: number;
  solved: boolean; // requiredMet && !overloaded && !crossed
};

/**
 * Evaluate a board. Conductors = sources + tiles; buildings are SINKS (they draw
 * power but never pass it on). Power floods from sources through mutually-open
 * edges; a component that draws more than its sources' combined capacity is
 * OVERLOADED and powers nothing. `separateSources` levels fail if two sources
 * end up in one component.
 */
export const evaluate = (level: PuzzleLevel, rotations: number[]): PuzzleEval => {
  const tiles = tileCells(level);
  const byKey = new Map<string, { cell: PuzzleCell; edges: number; tileIndex: number }>();
  let ti = 0;
  for (const cell of level.cells) {
    if (cell.t === 'tile') {
      byKey.set(key(cell.x, cell.y), { cell, edges: edgesOf(cell, rotations[ti] ?? 0), tileIndex: ti });
      ti++;
    } else {
      byKey.set(key(cell.x, cell.y), { cell, edges: edgesOf(cell, 0), tileIndex: -1 });
    }
  }
  const isConductor = (c: PuzzleCell): boolean => c.t === 'tile' || c.t === 'source';

  // Union-find over conductor cells, merging adjacent ones whose edges mate.
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(k) !== r) { const p = parent.get(k)!; parent.set(k, r); k = p; }
    return r;
  };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
  for (const [k, node] of byKey) if (isConductor(node.cell)) parent.set(k, k);

  const mate = (a: { edges: number }, b: { edges: number }, d: Dir): boolean =>
    (a.edges & BIT[d]!) !== 0 && (b.edges & BIT[OPP[d]!]!) !== 0;

  for (const [k, node] of byKey) {
    if (!isConductor(node.cell)) continue;
    const { x, y } = node.cell;
    for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
      const nk = key(x + DX[d]!, y + DY[d]!);
      const nb = byKey.get(nk);
      if (nb && isConductor(nb.cell) && mate(node, nb, d)) union(k, nk);
    }
  }

  // Per component: capacity from sources, then buildings drawn against it.
  type Comp = { sourceCap: number; sourceCount: number; load: number; buildings: string[] };
  const comps = new Map<string, Comp>();
  const compOf = (k: string): Comp => {
    const r = find(k);
    let c = comps.get(r);
    if (!c) { c = { sourceCap: 0, sourceCount: 0, load: 0, buildings: [] }; comps.set(r, c); }
    return c;
  };
  for (const [k, node] of byKey) {
    if (node.cell.t !== 'source') continue;
    const c = compOf(k);
    c.sourceCap += cap(node.cell.capacity);
    c.sourceCount += 1;
  }
  // Attach each building to the first adjacent conductor's component (if energized).
  const buildingComp = new Map<string, Comp | null>();
  for (const [k, node] of byKey) {
    if (node.cell.t !== 'building') continue;
    const { x, y } = node.cell;
    let comp: Comp | null = null;
    for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
      const nb = byKey.get(key(x + DX[d]!, y + DY[d]!));
      if (nb && isConductor(nb.cell) && mate(node, nb, d)) { comp = compOf(find(key(nb.cell.x, nb.cell.y))); break; }
    }
    buildingComp.set(k, comp);
    if (comp) { comp.load += POWER_COST[node.cell.kind]; comp.buildings.push(k); }
  }

  const compPowers = (c: Comp): boolean =>
    c.sourceCount > 0 && c.load <= c.sourceCap && !(level.separateSources && c.sourceCount > 1);

  const poweredTiles = tiles.map((c) => {
    const comp = comps.get(find(key(c.x, c.y)));
    return comp ? compPowers(comp) : false;
  });

  let overloaded = false;
  let crossed = false;
  for (const c of comps.values()) {
    if (c.sourceCount > 0 && c.load > c.sourceCap) overloaded = true;
    if (level.separateSources && c.sourceCount > 1) crossed = true;
  }

  const poweredBuildings: Record<string, boolean> = {};
  let requiredTotal = 0, requiredPowered = 0, optionalTotal = 0, optionalPowered = 0;
  for (const [k, node] of byKey) {
    if (node.cell.t !== 'building') continue;
    const comp = buildingComp.get(k) ?? null;
    const on = comp ? compPowers(comp) : false;
    poweredBuildings[k] = on;
    if (node.cell.required) { requiredTotal++; if (on) requiredPowered++; }
    else { optionalTotal++; if (on) optionalPowered++; }
  }

  const requiredMet = requiredPowered === requiredTotal;
  return {
    poweredTiles,
    poweredBuildings,
    overloaded,
    crossed,
    requiredMet,
    requiredTotal,
    requiredPowered,
    optionalTotal,
    optionalPowered,
    solved: requiredMet && !overloaded && !crossed,
  };
};

/**
 * Star rating (cumulative): 1 = all required connected (no overload/cross);
 * 2 = also within the move target; 3 = also every optional house powered.
 */
export const starRating = (level: PuzzleLevel, ev: PuzzleEval, moves: number): 0 | 1 | 2 | 3 => {
  if (!ev.solved) return 0;
  if (moves > level.moveTarget) return 1;
  if (ev.optionalPowered < ev.optionalTotal) return 2;
  return 3;
};
