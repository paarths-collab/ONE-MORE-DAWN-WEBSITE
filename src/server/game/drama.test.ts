import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../shared/balance';
import type { FactionId, Marked, TimelineEntry } from '../../shared/types';
import { buildDrama } from './drama';
import { pickMarked } from './marked';
import { newCityState } from './resolver';

const noInfluence: Record<FactionId, number> = { builders: 0, wardens: 0, seekers: 0, hearth: 0 };

const marked = (over: Partial<Marked> = {}): Marked => ({ ...pickMarked(0, 1, 1, 0), ...over });

const timelineEntry = (events: string[]): TimelineEntry => ({
  day: 1,
  cycle: 1,
  headline: 'Day 1',
  events,
  deltas: {},
  crisisId: 'first_light',
  winningOptionId: null,
});

describe('buildDrama', () => {
  it('always includes the Marked rally, caps at maxEvents, valid icons/kinds', () => {
    const events = buildDrama(
      newCityState(1),
      [timelineEntry(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])],
      { grow_food: 3 },
      { totalRuns: 2 },
      marked({ savedYesterday: { name: 'The North Wall', saved: true } }),
      noInfluence,
    );
    expect(events.length).toBeLessThanOrEqual(BALANCE.drama.maxEvents);
    expect(events.some((e) => e.kind === 'marked' && e.text.includes('pledged'))).toBe(true);
    for (const e of events) {
      expect(e.icon.length).toBeGreaterThan(0);
      expect(['action', 'raid', 'law', 'marked', 'city', 'crisis']).toContain(e.kind);
    }
  });

  it("reports yesterday's Marked verdict — saved or memorial", () => {
    const saved = buildDrama(newCityState(1), [], {}, {}, marked({ savedYesterday: { name: 'Mira', saved: true } }), noInfluence);
    expect(saved.some((e) => e.kind === 'marked' && /Mira was saved/.test(e.text))).toBe(true);
    const lost = buildDrama(newCityState(1), [], {}, {}, marked({ savedYesterday: { name: 'Mira', saved: false } }), noInfluence);
    expect(lost.some((e) => e.kind === 'marked' && /Mira was lost/.test(e.text))).toBe(true);
  });

  it('leads with a raid warning when the Red Signal is imminent', () => {
    const city = { ...newCityState(1), threat: 95 };
    const events = buildDrama(city, [], {}, {}, marked(), noInfluence);
    expect(events[0]!.kind).toBe('raid');
  });

  it("surfaces today's law, or the faction leading for tomorrow's", () => {
    const lawCity = { ...newCityState(1), activeLaw: 'wardens', lawExpiresDay: 1 };
    const withLaw = buildDrama(lawCity, [], {}, {}, marked(), noInfluence);
    expect(withLaw.some((e) => e.kind === 'law' && /Wall Watch/.test(e.text))).toBe(true);
    const leading = buildDrama(newCityState(1), [], {}, {}, marked(), { ...noInfluence, seekers: 5 });
    expect(leading.some((e) => e.kind === 'law' && /seekers/.test(e.text))).toBe(true);
  });

  it("flags low vitals and today's activity aggregates", () => {
    const city = { ...newCityState(1), food: 5, power: 10, medicine: 2 };
    const events = buildDrama(city, [], { guard_wall: 4 }, { totalRuns: 1 }, marked(), noInfluence);
    expect(events.some((e) => e.kind === 'city' && /granary|food/i.test(e.text))).toBe(true);
    expect(events.some((e) => e.kind === 'action' && /expedition/.test(e.text))).toBe(true);
    expect(events.some((e) => e.kind === 'action' && /4 citizen actions/.test(e.text))).toBe(true);
  });

  it("classifies yesterday's timeline lines into feed kinds", () => {
    const lines = [
      'The Red Signal came in the night. The city held, but paid in blood.',
      'Crisis "First Light": the city chose "Feed everyone".',
    ];
    const events = buildDrama(newCityState(1), [timelineEntry(lines)], {}, {}, marked(), noInfluence);
    expect(events.some((e) => e.kind === 'raid' && /Red Signal came/.test(e.text))).toBe(true);
    expect(events.some((e) => e.kind === 'crisis')).toBe(true);
  });
});
