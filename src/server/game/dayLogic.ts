import { BALANCE } from '../../shared/balance';
import type { PlayerProfile, Role } from '../../shared/types';

/** Spec §2 "Daily player reset". Pure: returns a new profile, never mutates.
 *  A lapse kills the streak but remembers its ghost (lapsedStreak) so the
 *  player can /rekindle it by burning standing — streak insurance. */
export const resetPlayerForDay = (player: PlayerProfile, cityDay: number): PlayerProfile => {
  if (player.lastActiveDay >= cityDay) return player;
  const continued = player.lastActiveDay === cityDay - 1;
  const dying = !continued && player.streak >= BALANCE.rekindle.minStreak ? player.streak : 0;
  return {
    ...player,
    energyUsedToday: 0,
    streak: continued ? player.streak + 1 : 1,
    lapsedStreak: Math.max(player.lapsedStreak ?? 0, dying),
    lastActiveDay: cityDay,
  };
};

/** Injury penalty is DERIVED from injuredUntilDay, never stored (spec §2). */
export const effectiveEnergy = (player: PlayerProfile, cityDay: number): number =>
  player.injuredUntilDay >= cityDay
    ? BALANCE.dailyEnergy - BALANCE.injuryEnergyPenalty
    : BALANCE.dailyEnergy;

/** Minimal store surface loadOrCreatePlayer needs — keeps dayLogic free of the
 *  full Store/Redis dependency so it stays a pure, fast-to-test unit. */
export type PlayerStore = {
  getPlayer(userId: string): Promise<PlayerProfile | undefined>;
  savePlayer(player: PlayerProfile): Promise<void>;
};

export type LoadedPlayer = {
  player: PlayerProfile;
  /** No stored profile existed before this call. */
  brandNew: boolean;
  /** Existing player whose last activity predates today (dawn-report gate). */
  firstVisitToday: boolean;
};

/**
 * Load the caller's profile, create it on first ever visit, and PERSIST it for
 * today. Extracted from /init so the "a brand-new player must be saved"
 * invariant is unit-testable without the Devvit runtime — the bug it guards
 * against (resetPlayerForDay returns the same reference for a fresh profile, so
 * a naive `reset !== player` check skips the save and the first-time player is
 * never stored, 409-ing every later /role, /action, /pledge forever) slipped
 * past every test that seeded players via store.savePlayer directly.
 *
 * `resolveUsername` is only awaited for brand-new players, so existing profiles
 * never pay the Reddit username RPC.
 */
export const loadOrCreatePlayer = async (
  store: PlayerStore,
  userId: string,
  cityDay: number,
  resolveUsername: () => Promise<string>,
): Promise<LoadedPlayer> => {
  let player = await store.getPlayer(userId);
  const brandNew = !player;
  if (!player) player = freshPlayer(userId, await resolveUsername(), cityDay);
  const firstVisitToday = !brandNew && player.lastActiveDay < cityDay;
  const reset = resetPlayerForDay(player, cityDay);
  if (brandNew || reset !== player) {
    player = reset;
    await store.savePlayer(player);
  }
  return { player, brandNew, firstVisitToday };
};

export const freshPlayer = (userId: string, username: string, cityDay: number): PlayerProfile => ({
  userId,
  username,
  role: null,
  roleChangedDay: 0,
  faction: null,
  factionRep: 0,
  roleRep: {},
  title: null,
  avatar: null,
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
