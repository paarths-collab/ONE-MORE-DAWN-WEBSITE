import { describe, expect, it } from 'vitest';
import { evaluateMission, minFeasibleMs, type MissionToken } from './missionRules';
import { generateMap, rollCrateContents } from '../../shared/mapgen';
import { BALANCE } from '../../shared/balance';
import type { MissionMap } from '../../shared/types';

const NOW = 1_800_000_000_000;

const token: MissionToken = {
  tokenId: 'tok1',
  userId: 't2_a',
  day: 5,
  layoutSeed: 4242,
  lootSeed: 999,
  route: 'deep',
  roleAtStart: 'scout',
  startedAtServerMs: NOW - 60_000,
  expiresAtServerMs: NOW + 540_000,
  consumed: false,
};

const map = generateMap(token.layoutSeed, 30);
const contents = rollCrateContents(map, token.lootSeed);
const validCrates = map.crates.slice(0, 2).map((c) => c.id);

const request = {
  tokenId: 'tok1',
  status: 'escaped' as const,
  collectedCrateIds: validCrates,
  clientDurationMs: 60_000,
};

describe('evaluateMission', () => {
  it('banks full server-calculated loot on escape', () => {
    const result = evaluateMission(token, request, 't2_a', 5, 30, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected: Record<string, number> = {};
    for (const c of contents.filter((c) => validCrates.includes(c.crateId))) {
      for (const [kind, n] of Object.entries(c.loot)) {
        expected[kind] = (expected[kind] ?? 0) + (n ?? 0);
      }
    }
    expect(result.banked).toEqual(expected);
    expect(result.injured).toBe(false);
  });

  it('halves loot (rounded down) and injures on timeout or hazard', () => {
    for (const status of ['timeout', 'hazard'] as const) {
      const result = evaluateMission(token, { ...request, status }, 't2_a', 5, 30, NOW);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const fullItems = contents
        .filter((c) => validCrates.includes(c.crateId))
        .flatMap((c) => Object.values(c.loot))
        .reduce((s, n) => s + (n ?? 0), 0);
      const bankedItems = Object.values(result.banked).reduce((s, n) => s + (n ?? 0), 0);
      expect(bankedItems).toBe(Math.floor(fullItems * BALANCE.mission.failLootKeepRatio));
      expect(result.injured).toBe(true);
    }
  });

  it('rejects a consumed token', () => {
    const r = evaluateMission({ ...token, consumed: true }, request, 't2_a', 5, 30, NOW);
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/already/i) });
  });

  it('rejects the wrong user', () => {
    expect(evaluateMission(token, request, 't2_intruder', 5, 30, NOW).ok).toBe(false);
  });

  it('rejects a stale day', () => {
    expect(evaluateMission(token, request, 't2_a', 6, 30, NOW).ok).toBe(false);
  });

  it('rejects after expiry', () => {
    expect(evaluateMission(token, request, 't2_a', 5, 30, token.expiresAtServerMs + 1).ok).toBe(false);
  });

  it('rejects implausibly fast completion', () => {
    const fast = { ...token, startedAtServerMs: NOW - 1000 };
    expect(evaluateMission(fast, request, 't2_a', 5, 30, NOW).ok).toBe(false);
  });

  it('rejects crate ids that are not on the seeded map', () => {
    const r = evaluateMission(token, { ...request, collectedCrateIds: ['c999'] }, 't2_a', 5, 30, NOW);
    expect(r.ok).toBe(false);
  });

  it('rejects duplicate crate ids', () => {
    const dup = [validCrates[0]!, validCrates[0]!];
    expect(evaluateMission(token, { ...request, collectedCrateIds: dup }, 't2_a', 5, 30, NOW).ok).toBe(false);
  });

  it('rejects claiming more crate ids than the map holds (before map generation)', () => {
    const ids = Array.from({ length: BALANCE.mission.cratesPerMap + 1 }, (_, i) => `c${i}`);
    const r = evaluateMission(token, { ...request, collectedCrateIds: ids }, 't2_a', 5, 30, NOW);
    expect(r).toEqual({ ok: false, reason: 'Too many crates claimed.' });
  });

  it('rejects loot that is not physically reachable in the elapsed time', () => {
    const deepest = [...map.crates].sort((a, b) => b.depth - a.depth)[0]!;
    const bound = minFeasibleMs(map, [deepest.id]);
    expect(bound).toBeGreaterThan(0);
    // One tile-time short of the spawn->crate->exit lower bound.
    const fast = { ...token, startedAtServerMs: NOW - (bound - 1) };
    const r = evaluateMission(
      fast,
      { ...request, collectedCrateIds: [deepest.id] },
      't2_a',
      5,
      30,
      NOW,
    );
    expect(r).toEqual({
      ok: false,
      reason: 'Claimed loot is not physically reachable in that time.',
    });
  });

  it('minFeasibleMs matches independent BFS math for the deepest crate', () => {
    // Independent spawn-BFS so the helper is not tested against itself.
    const bfsFromSpawn = (m: MissionMap): Map<string, number> => {
      const dist = new Map<string, number>([[`${m.spawn.x},${m.spawn.y}`, 0]]);
      const queue = [m.spawn];
      while (queue.length > 0) {
        const { x, y } = queue.shift()!;
        const d = dist.get(`${x},${y}`)!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (
            nx >= 0 && nx < m.width && ny >= 0 && ny < m.height &&
            m.tiles[ny]![nx] !== 'wall' && !dist.has(`${nx},${ny}`)
          ) {
            dist.set(`${nx},${ny}`, d + 1);
            queue.push({ x: nx, y: ny });
          }
        }
      }
      return dist;
    };
    const deepest = [...map.crates].sort((a, b) => b.depth - a.depth)[0]!;
    const fromSpawn = bfsFromSpawn(map).get(`${deepest.x},${deepest.y}`)!;
    expect(minFeasibleMs(map, [deepest.id])).toBe(
      (fromSpawn + deepest.depth) * BALANCE.mission.minMsPerTile,
    );
  });

  it('accepts an honest-duration full clear (feasibility never false-positives)', () => {
    // 60s elapsed (token default) covers every crate's lower bound at 100ms/tile.
    const all = map.crates.map((c) => c.id);
    const r = evaluateMission(token, { ...request, collectedCrateIds: all }, 't2_a', 5, 30, NOW);
    expect(r.ok).toBe(true);
  });

  it('desperate route: accepts all 9 crates and banks route-specific extra deep loot', () => {
    const desperateToken: MissionToken = { ...token, route: 'desperate' };
    const desperateMap = generateMap(desperateToken.layoutSeed, 30, 'desperate');
    expect(desperateMap.crates).toHaveLength(BALANCE.mission.routes.desperate.crates);
    expect(desperateMap.crates).toHaveLength(9);
    const all = desperateMap.crates.map((c) => c.id);
    // 9 crates would exceed the deep-route cap (7) — the cap must be per-route.
    expect(all.length).toBeGreaterThan(BALANCE.mission.routes.deep.crates);

    const r = evaluateMission(
      desperateToken,
      { ...request, collectedCrateIds: all },
      't2_a',
      5,
      30,
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Server-banked loot must match a route-aware reroll, including the
    // desperate +1 item on deep-tier crates.
    const desperateContents = rollCrateContents(desperateMap, desperateToken.lootSeed, 'desperate');
    const expected: Record<string, number> = {};
    let deepItems = 0;
    let deepCrates = 0;
    for (const c of desperateContents) {
      const crate = desperateMap.crates.find((k) => k.id === c.crateId)!;
      const items = Object.values(c.loot).reduce((s, n) => s + (n ?? 0), 0);
      if (crate.depth >= BALANCE.mission.deepCrateDepthThreshold) {
        deepItems += items;
        deepCrates += 1;
        expect(items).toBeGreaterThanOrEqual(BALANCE.mission.deepCrate.minItems + 1);
        expect(items).toBeLessThanOrEqual(BALANCE.mission.deepCrate.maxItems + 1);
      }
      for (const [kind, n] of Object.entries(c.loot)) {
        expected[kind] = (expected[kind] ?? 0) + (n ?? 0);
      }
    }
    expect(deepCrates).toBeGreaterThan(0);
    expect(deepItems).toBeGreaterThanOrEqual(deepCrates * (BALANCE.mission.deepCrate.minItems + 1));
    expect(r.banked).toEqual(expected);
    expect(r.injured).toBe(false);
  });
});
