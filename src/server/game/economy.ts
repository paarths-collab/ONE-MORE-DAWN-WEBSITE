import {
  COIN_DAILY_CAP,
  COIN_PER_CONTRIBUTION,
  economyOf,
  normalizeEconomyFields,
  type EconomyState,
} from '../../shared/shop';
import type { PlayerProfile } from '../../shared/types';

export type CoinAward = {
  player: PlayerProfile;
  coinsGained: number;
  economy: EconomyState;
};

/**
 * Award one accepted contribution. The caller must save the returned player in
 * the same per-user transaction as the contribution itself.
 */
export const awardContributionCoin = (
  player: PlayerProfile,
  cityCycle: number,
  cityDay: number,
): CoinAward => {
  const stored = normalizeEconomyFields(player);
  const sameDay =
    stored.coinsEarnedCycle === cityCycle && stored.coinsEarnedDay === cityDay;
  const earnedToday = sameDay ? stored.coinsEarnedToday : 0;
  const coinsGained =
    earnedToday < COIN_DAILY_CAP ? COIN_PER_CONTRIBUTION : 0;
  const updated: PlayerProfile = {
    ...player,
    ...stored,
    coins: stored.coins + coinsGained,
    coinsEarnedToday: earnedToday + coinsGained,
    coinsEarnedCycle: cityCycle,
    coinsEarnedDay: cityDay,
  };
  return {
    player: updated,
    coinsGained,
    economy: economyOf(updated, cityCycle, cityDay),
  };
};
