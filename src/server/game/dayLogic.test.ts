import { describe, expect, it } from 'vitest';
import { effectiveEnergy, freshPlayer, resetPlayerForDay } from './dayLogic';
import type { PlayerProfile } from '../../shared/types';

const player = (over: Partial<PlayerProfile>): PlayerProfile => ({
  userId: 't2_a', username: 'a', role: 'farmer', roleChangedDay: 1,
  faction: null, factionRep: 0, energyUsedToday: 3, lastActiveDay: 4,
  injuredUntilDay: 0, totalContribution: 50, streak: 2,
  ...over,
});

describe('resetPlayerForDay', () => {
  it('is a no-op when the player already acted today', () => {
    const p = player({ lastActiveDay: 5, energyUsedToday: 2 });
    expect(resetPlayerForDay(p, 5)).toEqual(p);
  });

  it('resets energy and advances lastActiveDay on a new day', () => {
    const p = resetPlayerForDay(player({ lastActiveDay: 4, energyUsedToday: 3, streak: 2 }), 5);
    expect(p.energyUsedToday).toBe(0);
    expect(p.lastActiveDay).toBe(5);
  });

  it('increments streak on consecutive days, resets otherwise', () => {
    expect(resetPlayerForDay(player({ lastActiveDay: 4, streak: 2 }), 5).streak).toBe(3);
    expect(resetPlayerForDay(player({ lastActiveDay: 2, streak: 9 }), 5).streak).toBe(1);
  });
});

describe('effectiveEnergy', () => {
  it('is dailyEnergy when healthy', () => {
    expect(effectiveEnergy(player({ injuredUntilDay: 0 }), 5)).toBe(3);
  });

  it('is reduced while injured, derived not stored (no double-apply on refresh)', () => {
    const p = player({ injuredUntilDay: 5 });
    expect(effectiveEnergy(p, 5)).toBe(2);
    expect(effectiveEnergy(p, 5)).toBe(2); // calling twice changes nothing
    expect(effectiveEnergy(p, 6)).toBe(3); // healed next day
  });
});

describe('freshPlayer', () => {
  it('creates a day-synced profile with no role', () => {
    const p = freshPlayer('t2_new', 'newbie', 3);
    expect(p).toEqual({
      userId: 't2_new', username: 'newbie', role: null, roleChangedDay: 0,
      faction: null, factionRep: 0, energyUsedToday: 0, lastActiveDay: 3,
      injuredUntilDay: 0, totalContribution: 0, streak: 1,
    });
  });
});
