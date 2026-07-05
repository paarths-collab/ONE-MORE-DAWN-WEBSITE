import { BALANCE } from '../../shared/balance';
import type { PlayerProfile, Role } from '../../shared/types';

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
  roleRep: {},
  title: null,
  energyUsedToday: 0,
  lastActiveDay: cityDay,
  injuredUntilDay: 0,
  totalContribution: 0,
  streak: 1,
});

/** Highest title tier whose threshold is <= rep, or null below the first tier. */
export const titleForRep = (role: Role, rep: number): string | null => {
  let best: string | null = null;
  for (const tier of BALANCE.titles[role]) {
    if (rep >= tier.rep) best = tier.title;
  }
  return best;
};

/**
 * Bumps roleRep[role] and recomputes `title` from the player's CURRENT role's
 * rep — the title reflects your active role identity, even when the bump lands
 * on a different role (mission roleAtStart). Pure: never mutates.
 * unlockedTitle = the new title string iff it changed from before, else null.
 */
export const bumpRoleRep = (
  player: PlayerProfile,
  role: Role,
  by: number,
): { player: PlayerProfile; unlockedTitle: string | null } => {
  const roleRep = { ...player.roleRep, [role]: (player.roleRep[role] ?? 0) + by };
  const title = player.role ? titleForRep(player.role, roleRep[player.role] ?? 0) : null;
  return {
    player: { ...player, roleRep, title },
    unlockedTitle: title !== null && title !== player.title ? title : null,
  };
};
