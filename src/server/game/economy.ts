import {
  COIN_DAILY_CAP,
  COIN_PER_CONTRIBUTION,
  economyOf,
  normalizeEconomyFields,
  type EconomyState,
} from '../../shared/shop';
import type { PlayerProfile } from '../../shared/types';
import { applyTreasuryLevy } from '../../shared/treasury';

export type CoinAward = {
  player: PlayerProfile;
  coinsGained: number;
  treasuryPaid: number;
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
  const awardedBalance = stored.coins + coinsGained;
  const levy = applyTreasuryLevy(player, awardedBalance, coinsGained);
  const updated: PlayerProfile = {
    ...player,
    ...stored,
    ...levy.fields,
    coins: levy.coins,
    coinsEarnedToday: earnedToday + coinsGained,
    coinsEarnedCycle: cityCycle,
    coinsEarnedDay: cityDay,
  };
  return {
    player: updated,
    coinsGained,
    treasuryPaid: levy.paidNow,
    economy: economyOf(updated, cityCycle, cityDay),
  };
};
