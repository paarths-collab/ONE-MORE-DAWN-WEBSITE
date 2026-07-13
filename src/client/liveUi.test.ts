import { describe, expect, it } from 'vitest';
import { isLocalHarnessHost, raidNoteFromEvents, raidOutcomeFromTimeline, worldUnavailableMessage } from './liveUi';

describe('live UI helpers', () => {
  it('only treats localhost hosts as demo-harness safe', () => {
    expect(isLocalHarnessHost('localhost')).toBe(true);
    expect(isLocalHarnessHost('127.0.0.1')).toBe(true);
    expect(isLocalHarnessHost('reddit.com')).toBe(false);
  });

  it('explains why the real world map is unavailable', () => {
    expect(worldUnavailableMessage({ eligible: false, subscribers: 123, minSubscribers: 500, cityCount: 1 }))
      .toContain('123/500 subscribers');
    expect(worldUnavailableMessage({ eligible: true, subscribers: 500, minSubscribers: 500, cityCount: 0 }))
      .toContain('No cities');
    expect(worldUnavailableMessage({ eligible: true, subscribers: 500, minSubscribers: 500, cityCount: 2 }))
      .toBeNull();
  });

  it('prefers resolved raid lines over forecast copy', () => {
    expect(raidNoteFromEvents(['The Red Signal came in the night. The city held.'], true))
      .toMatch(/Red Signal/);
    expect(raidNoteFromEvents([], true)).toMatch(/forecast/);
    expect(raidNoteFromEvents([], false)).toBeNull();
  });

  it('turns a resolved raid into a clear held or breached payoff', () => {
    const events = ['Raiders reached the wall before dawn.'];
    expect(raidOutcomeFromTimeline(events, 0)?.title).toBe('THE WALL HELD');
    expect(raidOutcomeFromTimeline(events, -4)?.title).toBe('THE WALL WAS BREACHED');
    expect(raidOutcomeFromTimeline(['A quiet night.'], -4)).toBeNull();
  });
});
