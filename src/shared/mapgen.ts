import { BALANCE } from './balance';
import { makeRng } from './rng';
import type { CrateContents, CrateSpot, LootKind, MissionMap, MissionRoute, TileKind } from './types';

const WIDTH = 14;
const HEIGHT = 9;

/**
 * Six hand-authored wall templates (spec §4 scope guard). '#' wall, '.' floor,
 * 'E' exit, 'S' spawn. Crates/hazards are placed algorithmically per seed.
 * All templates are hand-verified open (no sealed pockets) — the solvability
 * test enforces it.
 */
const TEMPLATES: string[] = [
  [
    '##############',
    '#S...#.......#',
    '#.##.#.####..#',
    '#.#....#.....#',
    '#.#.##.#.###.#',
    '#......#...#.#',
    '#.####.###.#.#',
    '#............E',
    '##############',
  ].join('\n'),
  [
    '##############',
    '#........#...#',
    '#.######.#.#.#',
    '#.#....#...#.#',
    '#.#.##.#####.#',
    '#S..#........#',
    '#.#.#.######.#',
    '#.#..........E',
    '##############',
  ].join('\n'),
  [
    '##############',
    '#S...........#',
    '#.###.####.#.#',
    '#.#.......#..#',
    '#.#.#####.#.##',
    '#...#...#....#',
    '###.#.#.####.#',
    '#.....#......E',
    '##############',
  ].join('\n'),
  [
    '##############',
    '#...#....#...#',
    '#.#.#.##.#.#.#',
    '#.#...##...#.#',
    '#.#####..###.#',
    '#S...........#',
    '#.##.###.##..#',
    '#..#.....#...E',
    '##############',
  ].join('\n'),
  [
    '##############',
    '#S.#.........#',
    '#..#.#####.#.#',
    '#.##.#...#.#.#',
    '#....#.#.#.#.#',
    '#.####.#.#.#.#',
    '#......#...#.#',
    '#.##########.E',
    '##############',
  ].join('\n'),
  [
    '##############',
    '#........#...#',
    '#.##.###.#.#.#',
    '#S.#.#.....#.#',
    '#.##.#.#####.#',
    '#.#..........#',
    '#.#.######.#.#',
    '#..........#.E',
    '##############',
  ].join('\n'),
];

const parseTemplate = (raw: string) => {
  const rows = raw.split('\n');
  const tiles: TileKind[][] = [];
  let spawn = { x: 1, y: 1 };
  let exit = { x: WIDTH - 1, y: HEIGHT - 2 };
  for (let y = 0; y < HEIGHT; y++) {
    const row: TileKind[] = [];
    for (let x = 0; x < WIDTH; x++) {
      const ch = rows[y]![x]!;
      if (ch === '#') row.push('wall');
      else if (ch === 'E') {
        row.push('exit');
        exit = { x, y };
      } else if (ch === 'S') {
        row.push('spawn');
        spawn = { x, y };
      } else row.push('floor');
    }
    tiles.push(row);
  }
  return { tiles, spawn, exit };
};

const isWalkable = (tiles: TileKind[][], x: number, y: number): boolean =>
  x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT && tiles[y]![x] !== 'wall';

/** BFS distances from a start tile over walkable tiles. */
const bfsDistances = (
  tiles: TileKind[][],
  start: { x: number; y: number },
): Map<string, number> => {
  const dist = new Map<string, number>([[`${start.x},${start.y}`, 0]]);
  const queue = [start];
  while (queue.length > 0) {
    const { x, y } = queue.shift()!;
    const d = dist.get(`${x},${y}`)!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (isWalkable(tiles, nx, ny) && !dist.has(`${nx},${ny}`)) {
        dist.set(`${nx},${ny}`, d + 1);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return dist;
};

export const reachableTiles = (map: MissionMap, from: { x: number; y: number }): Set<string> =>
  new Set(bfsDistances(map.tiles, from).keys());

/**
 * Spec §4: layoutSeed -> identical map for every player that day.
 * Route (S1) picks crate/hazard density from BALANCE.mission.routes. The
 * default 'deep' reproduces pre-route maps bit-identically: crate/hazard
 * counts are post-shuffle slices, so the RNG stream never depends on them.
 */
export const generateMap = (
  layoutSeed: number,
  cityThreat: number,
  route: MissionRoute = 'deep',
): MissionMap => {
  const cfg = BALANCE.mission.routes[route];
  const rng = makeRng(layoutSeed);
  const { tiles, spawn, exit } = parseTemplate(TEMPLATES[rng.int(TEMPLATES.length)]!);
  const fromExit = bfsDistances(tiles, exit);

  // candidate floor tiles, excluding spawn/exit and their direct neighbors
  const nearProtected = new Set<string>();
  for (const p of [spawn, exit]) {
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      nearProtected.add(`${p.x + dx},${p.y + dy}`);
    }
  }
  const floors: { x: number; y: number }[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (
        tiles[y]![x] === 'floor' &&
        !nearProtected.has(`${x},${y}`) &&
        fromExit.has(`${x},${y}`)
      ) {
        floors.push({ x, y });
      }
    }
  }

  const shuffled = rng.shuffle(floors);
  const crates: CrateSpot[] = shuffled.slice(0, cfg.crates).map((pos, i) => ({
    id: `c${i}`,
    x: pos.x,
    y: pos.y,
    depth: fromExit.get(`${pos.x},${pos.y}`) ?? 0,
  }));

  const crateSet = new Set(crates.map((c) => `${c.x},${c.y}`));
  const hazardCount = cfg.hazardsBase + Math.floor(cityThreat * cfg.hazardsPerThreat);
  const hazards = shuffled
    .slice(cfg.crates)
    .filter((pos) => !crateSet.has(`${pos.x},${pos.y}`))
    .slice(0, hazardCount)
    .map((pos) => ({ x: pos.x, y: pos.y }));

  return { width: WIDTH, height: HEIGHT, tiles, spawn, exit, crates, hazards };
};

/**
 * Spec §4: lootSeed (per-user) -> crate contents. Same layout, personal loot.
 * Route (S1): deep-tier crates gain the route's extraDeepItems on top of the
 * rolled count — added after the roll, so the default 'deep' (extra 0) keeps
 * the pre-route RNG stream and results bit-identical.
 */
export const rollCrateContents = (
  map: MissionMap,
  lootSeed: number,
  route: MissionRoute = 'deep',
): CrateContents[] => {
  const extraDeepItems = BALANCE.mission.routes[route].extraDeepItems;
  const rng = makeRng(lootSeed);
  return map.crates.map((crate) => {
    const deep = crate.depth >= BALANCE.mission.deepCrateDepthThreshold;
    const itemCount = deep
      ? BALANCE.mission.deepCrate.minItems +
        rng.int(BALANCE.mission.deepCrate.maxItems - BALANCE.mission.deepCrate.minItems + 1) +
        extraDeepItems
      : BALANCE.mission.nearCrate.items;
    const weights = deep ? BALANCE.mission.lootWeightsDeep : BALANCE.mission.lootWeightsNear;
    const loot: Partial<Record<LootKind, number>> = {};
    for (let i = 0; i < itemCount; i++) {
      const kind = rng.pick(weights as Record<LootKind, number>);
      loot[kind] = (loot[kind] ?? 0) + 1;
    }
    return { crateId: crate.id, loot };
  });
};
