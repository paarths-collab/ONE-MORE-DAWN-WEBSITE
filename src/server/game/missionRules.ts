import { BALANCE } from '../../shared/balance';
import { generateMap, rollCrateContents } from '../../shared/mapgen';
import type {
  LootKind,
  MissionCompleteRequest,
  MissionMap,
  MissionRoute,
  Role,
} from '../../shared/types';

export type MissionToken = {
  tokenId: string;
  userId: string;
  day: number;
  layoutSeed: number;
  lootSeed: number;
  route: MissionRoute;
  roleAtStart: Role | null;
  startedAtServerMs: number;
  expiresAtServerMs: number;
  consumed: boolean;
};

export type MissionEvaluation =
  | { ok: true; banked: Partial<Record<LootKind, number>>; injured: boolean }
  | { ok: false; reason: string };

/** BFS distances from `from` over walkable tiles (not 'wall'), 4-neighbor. */
const distancesFrom = (
  map: MissionMap,
  from: { x: number; y: number },
): Map<string, number> => {
  const dist = new Map<string, number>([[`${from.x},${from.y}`, 0]]);
  const queue = [from];
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
      if (
        nx >= 0 &&
        nx < map.width &&
        ny >= 0 &&
        ny < map.height &&
        map.tiles[ny]![nx] !== 'wall' &&
        !dist.has(`${nx},${ny}`)
      ) {
        dist.set(`${nx},${ny}`, d + 1);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return dist;
};

/**
 * Physical lower bound (ms) on a run that claims `crateIds`: every claimed
 * crate must be reached from spawn (BFS distance) and the exit reached from
 * it (CrateSpot.depth is the BFS distance to the exit), at no faster than
 * minMsPerTile. Sound: honest movement is 160ms/tile >= 100ms/tile, so an
 * honest run can never be rejected. Unknown crate ids are ignored — the
 * caller validates them separately.
 */
export const minFeasibleMs = (map: MissionMap, crateIds: string[]): number => {
  const fromSpawn = distancesFrom(map, map.spawn);
  const byId = new Map(map.crates.map((c) => [c.id, c]));
  let bound = 0;
  for (const id of crateIds) {
    const crate = byId.get(id);
    if (!crate) continue;
    const d = fromSpawn.get(`${crate.x},${crate.y}`);
    const tiles = d === undefined ? Number.POSITIVE_INFINITY : d + crate.depth;
    bound = Math.max(bound, tiles * BALANCE.mission.minMsPerTile);
  }
  return bound;
};

/**
 * Spec §4 anti-cheat: the client sends crate IDs; the server regenerates the
 * map from layoutSeed, prices crates from lootSeed, and calculates loot
 * itself. Pure — the route supplies token, request, identity, and clock.
 */
export const evaluateMission = (
  token: MissionToken,
  request: MissionCompleteRequest,
  userId: string,
  cityDay: number,
  cityThreat: number,
  nowMs: number,
): MissionEvaluation => {
  if (token.consumed) return { ok: false, reason: 'Mission already submitted.' };
  if (token.userId !== userId) return { ok: false, reason: 'Not your mission.' };
  if (token.day !== cityDay) return { ok: false, reason: 'This mission belongs to a day that has passed.' };
  if (nowMs > token.expiresAtServerMs) return { ok: false, reason: 'Mission expired.' };

  // Cheap bound before any Set building or map generation.
  if (request.collectedCrateIds.length > BALANCE.mission.routes[token.route].crates) {
    return { ok: false, reason: 'Too many crates claimed.' };
  }

  const serverDuration = nowMs - token.startedAtServerMs;
  const airMs =
    (BALANCE.mission.airSeconds +
      (token.roleAtStart === 'scout' ? BALANCE.mission.scoutAirBonusSeconds : 0)) *
    1000;
  if (serverDuration > airMs + BALANCE.mission.completionGraceMs) {
    return { ok: false, reason: 'Mission took too long.' };
  }

  const unique = new Set(request.collectedCrateIds);
  if (unique.size !== request.collectedCrateIds.length) {
    return { ok: false, reason: 'Duplicate crates claimed.' };
  }

  const map = generateMap(token.layoutSeed, cityThreat, token.route);
  const valid = new Set(map.crates.map((c) => c.id));
  for (const id of request.collectedCrateIds) {
    if (!valid.has(id)) return { ok: false, reason: `Unknown crate: ${id}` };
  }

  // Physical feasibility first (crate-specific, more informative), then the
  // blanket plausibility floor. Same accept/reject set in either order.
  if (serverDuration < minFeasibleMs(map, request.collectedCrateIds)) {
    return { ok: false, reason: 'Claimed loot is not physically reachable in that time.' };
  }
  if (serverDuration < BALANCE.mission.minPlausibleDurationMs) {
    return { ok: false, reason: 'Implausible completion time.' };
  }

  const contents = rollCrateContents(map, token.lootSeed, token.route);
  const banked: Partial<Record<LootKind, number>> = {};
  let totalItems = 0;
  for (const c of contents) {
    if (!unique.has(c.crateId)) continue;
    for (const [kind, n] of Object.entries(c.loot) as [LootKind, number][]) {
      banked[kind] = (banked[kind] ?? 0) + n;
      totalItems += n;
    }
  }

  const failed = request.status !== 'escaped';
  if (failed) {
    // keep half, rounded down, distributed by trimming items one kind at a time
    let keep = Math.floor(totalItems * BALANCE.mission.failLootKeepRatio);
    const trimmed: Partial<Record<LootKind, number>> = {};
    for (const [kind, n] of Object.entries(banked) as [LootKind, number][]) {
      const take = Math.min(n, keep);
      if (take > 0) trimmed[kind] = take;
      keep -= take;
    }
    return { ok: true, banked: trimmed, injured: true };
  }

  return { ok: true, banked, injured: false };
};
