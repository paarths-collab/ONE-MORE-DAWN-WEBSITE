import { describe, expect, it } from 'vitest';
import { BALANCE } from './balance';
import type { ActionType, FactionId } from './types';

describe('balance factions (Plan 2 P1)', () => {
  it('maps every ActionType to a faction or null', () => {
    const actions: ActionType[] = ['grow_food', 'repair_power', 'treat_sick', 'guard_wall'];
    for (const a of actions) {
      expect(BALANCE.factionPerAction).toHaveProperty(a);
    }
  });

  it('has a law for every faction', () => {
    const factions: FactionId[] = ['builders', 'wardens', 'seekers', 'hearth'];
    for (const f of factions) {
      expect(BALANCE.laws[f]).toBeDefined();
      expect(BALANCE.laws[f].id).toBe(f);
      expect(BALANCE.laws[f].label.length).toBeGreaterThan(0);
      expect(BALANCE.laws[f].buff.length).toBeGreaterThan(0);
      expect(BALANCE.laws[f].cost.length).toBeGreaterThan(0);
    }
  });

  it('raid config is sane', () => {
    expect(BALANCE.raid.triggerThreshold).toBe(100);
    expect(BALANCE.raid.postRaidThreat).toBeLessThan(BALANCE.raid.triggerThreshold);
    expect(BALANCE.raid.guardDampenPerAction).toBeGreaterThan(0);
  });

  it('mission-run faction is Seekers', () => {
    expect(BALANCE.factionPerMissionRun).toBe('seekers');
  });
});
