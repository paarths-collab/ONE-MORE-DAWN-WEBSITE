import { describe, expect, it } from 'vitest';
import { bumpRoleRep, effectiveEnergy, freshPlayer, resetPlayerForDay, titleForRep } from './dayLogic';
import type { PlayerProfile } from '../../shared/types';

const player = (over: Partial<PlayerProfile>): PlayerProfile => ({
  userId: 't2_a', username: 'a', role: 'farmer', roleChangedDay: 1,
  faction: null, factionRep: 0, roleRep: {}, title: null, avatar: null,
  energyUsedToday: 3, lastActiveDay: 4,
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

  it('a lapse remembers the dead streak as lapsedStreak (rekindle insurance)', () => {
    // 9-day streak dies in a lapse — its ghost is stored.
    const lapsed = resetPlayerForDay(player({ lastActiveDay: 2, streak: 9 }), 9);
    expect(lapsed.streak).toBe(1);
    expect(lapsed.lapsedStreak).toBe(9);
    // A continued day never overwrites the stored ghost.
    const continued = resetPlayerForDay({ ...lapsed, lastActiveDay: 9 }, 10);
    expect(continued.streak).toBe(2);
    expect(continued.lapsedStreak).toBe(9);
    // A bigger dying streak replaces a smaller ghost; never shrinks it.
    const bigger = resetPlayerForDay(player({ lastActiveDay: 2, streak: 12, lapsedStreak: 9 }), 9);
    expect(bigger.lapsedStreak).toBe(12);
  });

  it('streaks below the rekindle minimum are not worth remembering', () => {
    const p = resetPlayerForDay(player({ lastActiveDay: 2, streak: 2 }), 9);
    expect(p.streak).toBe(1);
    expect(p.lapsedStreak ?? 0).toBe(0);
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
      faction: null, factionRep: 0, roleRep: {}, title: null, avatar: null,
      energyUsedToday: 0, lastActiveDay: 3,
      injuredUntilDay: 0, totalContribution: 0, streak: 1,
      coins: 0, coinsEarnedToday: 0, coinsEarnedCycle: 0, coinsEarnedDay: 0,
      ownedCosmetics: [], equippedCosmetics: {},
    });
  });
});

describe('titleForRep', () => {
  it('is null below the first threshold', () => {
    expect(titleForRep('scout', 0)).toBeNull();
    expect(titleForRep('scout', 24)).toBeNull();
  });

  it('unlocks tiers exactly at their thresholds', () => {
    expect(titleForRep('scout', 25)).toBe('Runner');
    expect(titleForRep('scout', 74)).toBe('Runner');
    expect(titleForRep('scout', 75)).toBe('Night Scout');
    expect(titleForRep('scout', 150)).toBe('Ruin Walker');
    expect(titleForRep('scout', 9999)).toBe('Ruin Walker');
  });

  it('resolves per-role tables', () => {
    expect(titleForRep('speaker', 150)).toBe('The Conscience');
    expect(titleForRep('guard', 25)).toBe('Watchman');
  });
});

describe('bumpRoleRep', () => {
  it('detects a title unlock when rep crosses a threshold', () => {
    const p = player({ role: 'scout', roleRep: { scout: 24 }, title: null });
    const { player: next, unlockedTitle } = bumpRoleRep(p, 'scout', 3);
    expect(next.roleRep.scout).toBe(27);
    expect(next.title).toBe('Runner');
    expect(unlockedTitle).toBe('Runner');
    // pure: input untouched
    expect(p.roleRep.scout).toBe(24);
    expect(p.title).toBeNull();
  });

  it('returns null unlockedTitle when the bump stays within a tier', () => {
    const p = player({ role: 'scout', roleRep: { scout: 30 }, title: 'Runner' });
    const { player: next, unlockedTitle } = bumpRoleRep(p, 'scout', 3);
    expect(next.roleRep.scout).toBe(33);
    expect(next.title).toBe('Runner');
    expect(unlockedTitle).toBeNull();
  });

  it('recomputes title from the CURRENT role, not the bumped role', () => {
    // Player switched to engineer but a mission credits their old scout role.
    const p = player({ role: 'engineer', roleRep: { scout: 100, engineer: 24 }, title: null });
    const scoutBump = bumpRoleRep(p, 'scout', 4);
    expect(scoutBump.player.roleRep.scout).toBe(104);
    expect(scoutBump.player.title).toBeNull(); // engineer rep still 24
    expect(scoutBump.unlockedTitle).toBeNull();

    const engineerBump = bumpRoleRep(p, 'engineer', 3);
    expect(engineerBump.player.title).toBe('Tinkerer'); // engineer rep 27
    expect(engineerBump.unlockedTitle).toBe('Tinkerer');
  });

  it('yields a null title (and no unlock) when the player has no role', () => {
    const p = player({ role: null, roleRep: { scout: 200 }, title: null });
    const { player: next, unlockedTitle } = bumpRoleRep(p, 'scout', 4);
    expect(next.title).toBeNull();
    expect(unlockedTitle).toBeNull();
  });
});
