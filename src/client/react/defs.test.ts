import { describe, expect, it } from 'vitest';
import type { InitResponse } from '../../shared/types';
import { scoutReport } from './defs';

// scoutReport only reads a handful of fields — build a minimal InitResponse.
const make = (over: Partial<Record<string, unknown>> = {}): InitResponse =>
  ({
    city: { day: 5, cycle: 3, threat: 68, food: 22, power: 31, morale: 44 },
    marked: { name: 'Mira, the greenhouse child', kind: 'person', pledged: 23, goal: 40 },
    raidInDays: 2,
    player: { role: 'scout' },
    yourCrisisVote: 'a',
    crisis: {
      options: [
        { id: 'a', label: 'Let them in' },
        { id: 'b', label: 'Turn them away' },
      ],
    },
    ...over,
  }) as unknown as InitResponse;

describe('scoutReport', () => {
  it('summarizes live city state with the Marked, threat, raid, role, and vote', () => {
    const r = scoutReport(make());
    expect(r).toContain('day 5 (cycle 3)');
    expect(r).toContain('save Mira — 57%'); // person ⇒ "save"; 23/40 rounds to 57%
    expect(r).toContain('Threat 68/100, raid in 2 days');
    expect(r).toContain('Food 22 · power 31 · morale 44');
    expect(r).toContain('Scout duty');
    expect(r).toContain('"Let them in"');
  });

  it('flags an imminent raid tonight', () => {
    expect(scoutReport(make({ raidInDays: 0 }))).toContain('a raid hits TONIGHT');
    expect(scoutReport(make({ raidInDays: 1 }))).toContain('raid in 1 day'); // singular
  });

  it('handles an undecided player (no role, no vote)', () => {
    const r = scoutReport(make({ player: { role: null }, yourCrisisVote: null }));
    expect(r).toContain('Still deciding on the crisis');
    expect(r).not.toContain('duty');
  });

  it('says "hold" for a place/symbol Marked', () => {
    const r = scoutReport(make({ marked: { name: 'The North Wall', kind: 'place', pledged: 10, goal: 40 } }));
    expect(r).toContain('hold The North Wall');
  });
});
