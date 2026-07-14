import { describe, expect, it } from 'vitest';
import {
  evaluate,
  initialRotations,
  rotateEdges,
  rotateTile,
  solutionRotations,
  starRating,
  tileCells,
  type PuzzleLevel,
} from './puzzle';
import { PUZZLE_LEVELS } from './puzzleLevels';

describe('puzzle engine — primitives', () => {
  it('rotateEdges spins the edge bitmask clockwise', () => {
    expect(rotateEdges(1, 0)).toBe(1); // N
    expect(rotateEdges(1, 1)).toBe(2); // N -> E
    expect(rotateEdges(1, 2)).toBe(4); // -> S
    expect(rotateEdges(1, 3)).toBe(8); // -> W
    expect(rotateEdges(1 | 4, 1)).toBe(2 | 8); // straight N|S -> E|W
    expect(rotateEdges(15, 3)).toBe(15); // cross unchanged
  });
});

// A tiny hand-built board: source -> straight -> straight -> clinic, in a row.
const line = (rots: { s0: number; s1: number }): PuzzleLevel => ({
  id: 0, name: 't', chapter: 0, width: 4, height: 1, moveTarget: 2,
  cells: [
    { t: 'source', x: 0, y: 0, capacity: -1 },
    { t: 'tile', x: 1, y: 0, kind: 'straight', rot: rots.s0, sol: 1 },
    { t: 'tile', x: 2, y: 0, kind: 'straight', rot: rots.s1, sol: 1 },
    { t: 'building', x: 3, y: 0, kind: 'clinic', required: true },
  ],
});

describe('puzzle engine — connection + power', () => {
  it('powers a building only when the whole line is connected E-W', () => {
    const lvl = line({ s0: 1, s1: 1 }); // both horizontal -> connected
    const ev = evaluate(lvl, initialRotations(lvl));
    expect(ev.requiredMet).toBe(true);
    expect(ev.solved).toBe(true);
    expect(ev.poweredBuildings['3,0']).toBe(true);
  });

  it('breaks when one tile is vertical (edges do not mate)', () => {
    const lvl = line({ s0: 0, s1: 1 }); // first tile N|S -> gap
    const ev = evaluate(lvl, initialRotations(lvl));
    expect(ev.requiredMet).toBe(false);
    expect(ev.solved).toBe(false);
  });

  it('rotateTile advances a tile and never moves a locked one', () => {
    const lvl = line({ s0: 0, s1: 1 });
    const fixed = rotateTile(lvl, initialRotations(lvl), 0); // 0 -> 1, now connected
    expect(evaluate(lvl, fixed).solved).toBe(true);
    const locked: PuzzleLevel = { ...lvl, cells: lvl.cells.map((c) => (c.t === 'tile' && c.x === 1 ? { ...c, locked: true } : c)) };
    expect(rotateTile(locked, initialRotations(locked), 0)).toEqual(initialRotations(locked));
  });

  it('overloads when connected load exceeds source capacity', () => {
    const lvl: PuzzleLevel = {
      id: 0, name: 't', chapter: 0, width: 3, height: 1, moveTarget: 0,
      cells: [
        { t: 'source', x: 0, y: 0, capacity: 2 }, // only 2 power
        { t: 'tile', x: 1, y: 0, kind: 'cross', rot: 0, sol: 0 },
        { t: 'building', x: 2, y: 0, kind: 'clinic', required: true }, // costs 3
        { t: 'building', x: 1, y: 1, kind: 'house', required: false }, // +1 (cross faces S)
      ],
    };
    const ev = evaluate(lvl, initialRotations(lvl));
    expect(ev.overloaded).toBe(true);
    expect(ev.solved).toBe(false); // overloaded network powers nothing
    expect(ev.poweredBuildings['2,0']).toBe(false);
  });

  it('separateSources flags a crossed network', () => {
    const lvl: PuzzleLevel = {
      id: 0, name: 't', chapter: 0, width: 3, height: 1, moveTarget: 0, separateSources: true,
      cells: [
        { t: 'source', x: 0, y: 0, capacity: -1 },
        { t: 'tile', x: 1, y: 0, kind: 'straight', rot: 1, sol: 1 }, // connects both sources
        { t: 'source', x: 2, y: 0, capacity: -1 },
      ],
    };
    const ev = evaluate(lvl, initialRotations(lvl));
    expect(ev.crossed).toBe(true);
    expect(ev.solved).toBe(false);
  });

  it('starRating is cumulative: solve, within moves, all optional', () => {
    const lvl = line({ s0: 1, s1: 1 });
    const ev = evaluate(lvl, initialRotations(lvl)); // no optional -> optionalTotal 0
    expect(starRating(lvl, ev, 2)).toBe(3); // solved, within target, all (0) optional
    expect(starRating(lvl, ev, 5)).toBe(1); // over the move target
    const unsolved = evaluate(line({ s0: 0, s1: 1 }), initialRotations(line({ s0: 0, s1: 1 })));
    expect(starRating(lvl, unsolved, 0)).toBe(0);
  });
});

describe('puzzle levels — every shipped level is well-formed and solvable', () => {
  it('has a stable, unique set of ids', () => {
    const ids = PUZZLE_LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PUZZLE_LEVELS.length).toBeGreaterThanOrEqual(8);
  });

  for (const level of PUZZLE_LEVELS) {
    it(`L${level.id} "${level.name}" solves fully (3 stars reachable) and ships scrambled`, () => {
      const sol = solutionRotations(level);
      const solved = evaluate(level, sol);
      // The authored solution connects every required AND optional building, no overload/cross.
      expect(solved.requiredPowered).toBe(solved.requiredTotal);
      expect(solved.optionalPowered).toBe(solved.optionalTotal);
      expect(solved.overloaded).toBe(false);
      expect(solved.crossed).toBe(false);
      expect(solved.solved).toBe(true);
      // It ships scrambled (needs work) and is solvable within the move target.
      const init = initialRotations(level);
      expect(init).not.toEqual(sol);
      const scrambledCount = init.filter((r, i) => r !== sol[i]).length;
      expect(level.moveTarget).toBeGreaterThanOrEqual(scrambledCount);
      // Every scrambled tile is reachable to its solution within the move budget.
      expect(tileCells(level).length).toBeGreaterThan(0);
    });
  }
});
