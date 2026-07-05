import { BALANCE } from '../../shared/balance';
import type { CityState, Standing } from '../../shared/types';

/**
 * Status spine (hook layer, Plan 1): the player's standing surfaced on every
 * screen. Plan 1 keeps rankLabel an HONEST within-sub framing — cross-sub
 * ranking ("#7 of 42 cities") is Plan 2 via redis.global; we never fake it.
 */
export const buildStanding = (city: CityState, contributionRank: number | null): Standing => {
  const raidImminent =
    city.threat + BALANCE.passiveThreatRise >= BALANCE.raid.triggerThreshold;
  const rankLabel =
    city.status === 'fallen'
      ? `The city fell on day ${city.day}`
      : raidImminent
        ? `Under raid threat · Day ${city.day}`
        : `The city holds · Day ${city.day}`;
  return { survivalDays: city.day, rankLabel, contributionRank };
};
