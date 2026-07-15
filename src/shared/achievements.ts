// Display-only achievements/badges for "One More Dawn".
//
// A pure, deterministic mapping from the /api/init payload to the memorable
// milestones a survivor has reached. It reads ONLY fields already present in
// InitResponse — no server route, no new persistence, nothing to store. The
// client renders the result read-only inside the STATS ledger.
//
// Design: each "track" (streak, dawns, house, …) yields AT MOST ONE badge —
// the highest tier the player has reached — so the wall shows your best in
// each area instead of a stack of redundant lower tiers. Output is sorted
// shiniest-first (legendary → bronze), ties keeping a fixed track order, so
// the same init always renders the same wall.

import type { InitResponse } from './types';

export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'legendary';

/** One earned milestone. `id` is stable per distinct badge; `tier` drives color. */
export type Badge = {
  id: string;
  icon: string;
  label: string;
  tier: BadgeTier;
};

/** Sort weight: legendary shows first, bronze last. */
const TIER_ORDER: Record<BadgeTier, number> = {
  legendary: 0,
  gold: 1,
  silver: 2,
  bronze: 3,
};

/** Coerce anything to a finite number; NaN/strings/undefined → 0 (earns nothing). */
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Map an InitResponse to the badges its player has earned.
 * Pure and total: partial/legacy payloads never throw — a missing field simply
 * earns no badge on that track.
 */
export function earnedBadges(init: InitResponse): Badge[] {
  const badges: Badge[] = [];

  // 1 · Streak (🔥) — consecutive days the survivor has answered the dawn.
  const streak = num(init.player?.streak);
  if (streak >= 30) badges.push({ id: 'streak-30', icon: '🔥', label: 'Undying Flame', tier: 'legendary' });
  else if (streak >= 14) badges.push({ id: 'streak-14', icon: '🔥', label: 'Steadfast', tier: 'gold' });
  else if (streak >= 7) badges.push({ id: 'streak-7', icon: '🔥', label: 'Weeklong Flame', tier: 'silver' });
  else if (streak >= 3) badges.push({ id: 'streak-3', icon: '🔥', label: 'Kindled', tier: 'bronze' });

  // 2 · Dawns survived (🌅) — how long THIS city has held; a night weathered.
  const dawns = num(init.standing?.survivalDays);
  if (dawns >= 100) badges.push({ id: 'dawns-100', icon: '🌅', label: 'Centurion of Dawns', tier: 'legendary' });
  else if (dawns >= 60) badges.push({ id: 'dawns-60', icon: '🌅', label: 'Long Watch', tier: 'gold' });
  else if (dawns >= 30) badges.push({ id: 'dawns-30', icon: '🌅', label: 'Month of Dawns', tier: 'silver' });
  else if (dawns >= 7) badges.push({ id: 'dawns-7', icon: '🌅', label: 'One Week On', tier: 'bronze' });

  // 3 · House (🏠) — your home's grandeur, grown from lifetime contribution.
  const houseTier = num(init.houses?.yours?.tier);
  if (houseTier >= 4) badges.push({ id: 'house-4', icon: '🏰', label: 'Manor of the City', tier: 'legendary' });
  else if (houseTier === 3) badges.push({ id: 'house-3', icon: '🏘️', label: 'Household', tier: 'gold' });
  else if (houseTier === 2) badges.push({ id: 'house-2', icon: '🏠', label: 'Cottage Raised', tier: 'silver' });
  else if (houseTier === 1) badges.push({ id: 'house-1', icon: '🏕️', label: 'Tent Raised', tier: 'bronze' });

  // 4 · Survivor level (⭐) — the 1..100 ladder the daily mission climbs.
  const level = num(init.challenge?.level);
  if (level >= 100) badges.push({ id: 'level-100', icon: '⭐', label: 'Elder of the City', tier: 'legendary' });
  else if (level >= 50) badges.push({ id: 'level-50', icon: '⭐', label: 'Veteran', tier: 'gold' });
  else if (level >= 25) badges.push({ id: 'level-25', icon: '⭐', label: 'Seasoned Survivor', tier: 'silver' });
  else if (level >= 10) badges.push({ id: 'level-10', icon: '⭐', label: 'Rank Ten', tier: 'bronze' });

  // 5 · Standing (🏆) — your rank among this city's citizens (1 = top).
  const rank = init.standing?.contributionRank;
  if (typeof rank === 'number' && Number.isFinite(rank) && rank >= 1) {
    if (rank === 1) badges.push({ id: 'rank-1', icon: '🏆', label: "City's Backbone", tier: 'gold' });
    else if (rank <= 3) badges.push({ id: 'rank-3', icon: '🏆', label: 'On the Podium', tier: 'silver' });
    else if (rank <= 10) badges.push({ id: 'rank-10', icon: '🏆', label: 'Top Ten', tier: 'bronze' });
  }

  // 6 · Phoenix (🐦‍🔥) — cycles survived; the city fell and rose from the ashes.
  const cycle = num(init.city?.cycle);
  if (cycle >= 5) badges.push({ id: 'phoenix-5', icon: '🐦‍🔥', label: 'Phoenix', tier: 'gold' });
  else if (cycle >= 3) badges.push({ id: 'phoenix-3', icon: '🐦‍🔥', label: 'Twice-Risen', tier: 'silver' });
  else if (cycle >= 2) badges.push({ id: 'phoenix-2', icon: '🐦‍🔥', label: 'Reborn', tier: 'bronze' });

  // 7 · Founder (👑) — you raised the first house of this city.
  if (init.houses?.yours?.isFounder === true) {
    badges.push({ id: 'founder', icon: '👑', label: 'Founder', tier: 'legendary' });
  }

  // 8 · City Complete (🏛️) — every one of the city's structures stands.
  const build = init.build;
  if (build && build.next === null && (build.unlocked?.length ?? 0) > 0) {
    badges.push({ id: 'city-complete', icon: '🏛️', label: 'City Complete', tier: 'gold' });
  }

  // Shiniest-first. Array.sort is stable, and badges were pushed in a fixed
  // track order, so ties within a tier keep that order — fully deterministic.
  return badges.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
}
