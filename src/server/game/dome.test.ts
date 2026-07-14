import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../shared/balance';
import {
  applyRepairs,
  chargeSegmentIndex,
  energyPct,
  freshSegments,
  mostDamagedSegment,
  normalizeSegments,
  resolveVolley,
} from './dome';

const D = BALANCE.dome;

describe('dome: segments + energy', () => {
  it('freshSegments has one starting shield per segment', () => {
    const s = freshSegments();
    expect(s).toHaveLength(D.segments);
    expect(s.every((v) => v === D.segmentStart)).toBe(true);
  });

  it('normalizeSegments clamps to [0, max], rounds, and fills missing with the start', () => {
    const s = normalizeSegments([-5, 250, 40.6, undefined, Number.NaN]);
    expect(s).toHaveLength(D.segments);
    expect(s[0]).toBe(0);
    expect(s[1]).toBe(D.segmentMax);
    expect(s[2]).toBe(41);
    expect(s[3]).toBe(D.segmentStart);
    expect(s[4]).toBe(D.segmentStart);
    expect(s.every((v) => v >= 0 && v <= D.segmentMax)).toBe(true);
  });

  it('energyPct is the average shield as a percent of max', () => {
    expect(energyPct(freshSegments())).toBe(Math.round((D.segmentStart / D.segmentMax) * 100));
    expect(energyPct(Array.from({ length: D.segments }, () => D.segmentMax))).toBe(100);
    expect(energyPct(Array.from({ length: D.segments }, () => 0))).toBe(0);
  });

  it('mostDamagedSegment picks the lowest panel below the baseline, or null when none', () => {
    const full: number[] = Array.from({ length: D.segments }, () => D.segmentMax);
    expect(mostDamagedSegment(full)).toBeNull();
    // A fresh dome sits at the baseline shield — not "damaged", nothing to mend.
    expect(mostDamagedSegment(freshSegments())).toBeNull();
    const dented: number[] = [...full];
    dented[3] = 10;
    dented[5] = 40;
    expect(mostDamagedSegment(dented)).toBe(3);
  });

  it('chargeSegmentIndex is deterministic and within range', () => {
    const a = chargeSegmentIndex('u1', 4, 999);
    const b = chargeSegmentIndex('u1', 4, 999);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(D.segments);
    expect(chargeSegmentIndex('u2', 4, 999)).toBeGreaterThanOrEqual(0);
  });
});

describe('dome: resolveVolley', () => {
  it('is deterministic for the same seed + segments', () => {
    const seg = freshSegments();
    const a = resolveVolley(12345, seg);
    const b = resolveVolley(12345, seg);
    expect(a).toEqual(b);
  });

  it('fires between min and max fireballs', () => {
    for (let seed = 0; seed < 40; seed++) {
      const v = resolveVolley(seed, freshSegments());
      expect(v.fireballs.length).toBeGreaterThanOrEqual(D.fireballs.min);
      expect(v.fireballs.length).toBeLessThanOrEqual(D.fireballs.max);
    }
  });

  it('a fully-charged dome blocks every fireball (0 penetrations)', () => {
    const full = Array.from({ length: D.segments }, () => D.segmentMax);
    for (let seed = 0; seed < 40; seed++) {
      const v = resolveVolley(seed, full);
      expect(v.penetrations).toBe(0);
      expect(v.fireballs.every((f) => f.blocked)).toBe(true);
    }
  });

  it('a shattered dome lets every fireball through (all penetrate)', () => {
    const empty = Array.from({ length: D.segments }, () => 0);
    for (let seed = 0; seed < 40; seed++) {
      const v = resolveVolley(seed, empty);
      expect(v.penetrations).toBe(v.fireballs.length);
      expect(v.fireballs.every((f) => !f.blocked)).toBe(true);
    }
  });

  it('a blocked fireball drains only the segment it struck, and never mutates the input', () => {
    const full = Array.from({ length: D.segments }, () => D.segmentMax);
    const input = [...full];
    const v = resolveVolley(7, input);
    expect(input).toEqual(full); // pure
    const blockedCounts = new Map<number, number>();
    for (const f of v.fireballs) if (f.blocked) blockedCounts.set(f.segment, (blockedCounts.get(f.segment) ?? 0) + 1);
    for (let i = 0; i < D.segments; i++) {
      const drained = (blockedCounts.get(i) ?? 0) * D.blockDrain;
      expect(v.segmentsAfter[i]).toBe(Math.max(0, D.segmentMax - drained));
    }
  });

  it('power is tested against the struck segment (block iff power <= shield)', () => {
    const seg = freshSegments();
    const v = resolveVolley(99, seg);
    for (const f of v.fireballs) {
      expect(f.blocked).toBe(f.power <= seg[f.segment]!);
    }
  });
});

describe('dome: applyRepairs', () => {
  it('does nothing when no segment is damaged', () => {
    const full = Array.from({ length: D.segments }, () => D.segmentMax);
    const r = applyRepairs(full, D.repairThreshold * 3);
    expect(r.repaired).toEqual([]);
    expect(r.segments).toEqual(full);
    expect(r.pool).toBe(D.repairThreshold * 3);
  });

  it('restores the most-damaged segment first and stops when the pool cannot afford another', () => {
    const seg = freshSegments();
    seg[2] = 5;
    seg[4] = 20;
    const r = applyRepairs(seg, D.repairThreshold + 3); // affords exactly one repair
    expect(r.repaired).toEqual([2]);
    expect(r.segments[2]).toBe(D.segmentMax);
    expect(r.segments[4]).toBe(20);
    expect(r.pool).toBe(3);
  });

  it('repairs multiple panels weakest-first while the pool allows', () => {
    const seg = freshSegments();
    seg[1] = 0;
    seg[3] = 10;
    const r = applyRepairs(seg, D.repairThreshold * 2);
    expect(r.repaired).toEqual([1, 3]);
    expect(r.segments[1]).toBe(D.segmentMax);
    expect(r.segments[3]).toBe(D.segmentMax);
    expect(r.pool).toBe(0);
  });
});
