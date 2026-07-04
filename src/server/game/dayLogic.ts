import { BALANCE } from '../../shared/balance';
import type { PlayerProfile } from '../../shared/types';

/** Spec §2 "Daily player reset". Pure: returns a new profile, never mutates. */
export const resetPlayerForDay = (player: PlayerProfile, cityDay: number): PlayerProfile => {
  if (player.lastActiveDay >= cityDay) return player;
  return {
    ...player,
    energyUsedToday: 0,
    streak: player.lastActiveDay === cityDay - 1 ? player.streak + 1 : 1,
    lastActiveDay: cityDay,
  };
};

/** Injury penalty is DERIVED from injuredUntilDay, never stored (spec §2). */
export const effectiveEnergy = (player: PlayerProfile, cityDay: number): number =>
  player.injuredUntilDay >= cityDay
    ? BALANCE.dailyEnergy - BALANCE.injuryEnergyPenalty
    : BALANCE.dailyEnergy;

export const freshPlayer = (userId: string, username: string, cityDay: number): PlayerProfile => ({
  userId,
  username,
  role: null,
  roleChangedDay: 0,
  faction: null,
  factionRep: 0,
  energyUsedToday: 0,
  lastActiveDay: cityDay,
  injuredUntilDay: 0,
  totalContribution: 0,
  streak: 1,
});
