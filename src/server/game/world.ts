import { BALANCE } from '../../shared/balance';
import type { CityState, CityStatusTag, WorldCity } from '../../shared/types';

/** The vitals worldStatus inspects — any full CityState qualifies. */
export type CityVitals = Pick<
  CityState,
  'status' | 'threat' | 'food' | 'power' | 'medicine' | 'morale'
>;

/**
 * Stored shape of one city in the global registry (`global:cities` hash):
 * WorldCity minus the per-caller `isYou`, plus a record schema version and a
 * freshness stamp (the city day at last write).
 */
export type WorldCityRecord = Omit<WorldCity, 'isYou'> & {
  v: number;
  updatedAtDay: number;
};

export const WORLD_RECORD_VERSION = 1;

/**
 * Coarse status tag for the world map. Precedence: fallen > under_raid >
 * strained > thriving > holding. "Raid imminent" mirrors the forecast/standing
 * check: threat plus one passive day's rise crosses the raid trigger.
 */
export const worldStatus = (c: CityVitals): CityStatusTag => {
  if (c.status === 'fallen') return 'fallen';
  if (c.threat + BALANCE.passiveThreatRise >= BALANCE.raid.triggerThreshold) return 'under_raid';
  const s = BALANCE.world.strained;
  if (c.food <= s.food || c.power <= s.power || c.medicine <= s.medicine || c.morale <= s.morale) {
    return 'strained';
  }
  const t = BALANCE.world.thriving;
  if (
    c.food >= t.food &&
    c.power >= t.power &&
    c.medicine >= t.medicine &&
    c.morale >= t.morale &&
    c.threat <= t.maxThreat
  ) {
    return 'thriving';
  }
  return 'holding';
};

/**
 * Deterministic world ranking: longest-surviving first, then most Marked
 * saved, then population, then subreddit name ascending (a stable, locale-free
 * final tie-break so every caller sees the same order). Non-mutating.
 */
export const rankCities = (cities: WorldCity[]): WorldCity[] =>
  [...cities].sort(
    (a, b) =>
      b.survivalDays - a.survivalDays ||
      b.savedCount - a.savedCount ||
      b.population - a.population ||
      (a.subreddit < b.subreddit ? -1 : a.subreddit > b.subreddit ? 1 : 0),
  );

/** "r/name" display form; already-prefixed names pass through unchanged. */
export const displaySubredditName = (name: string): string =>
  name.startsWith('r/') ? name : `r/${name}`;

/**
 * Build THIS city's registry record (the glue in api.ts persists it via
 * redis.global). `savedCount` = Marked saved this cycle; `activePlayers` =
 * users who took an action today.
 */
export const citySummary = (
  subreddit: string,
  city: CityState,
  savedCount: number,
  activePlayers: number,
): WorldCityRecord => ({
  subreddit: displaySubredditName(subreddit),
  cycle: city.cycle,
  day: city.day,
  survivalDays: city.day,
  status: worldStatus(city),
  threat: city.threat,
  population: city.population,
  savedCount,
  activePlayers,
  v: WORLD_RECORD_VERSION,
  updatedAtDay: city.day,
});

/** Registry record -> API shape: drops version/freshness, stamps isYou. */
export const toWorldCity = (r: WorldCityRecord, isYou: boolean): WorldCity => ({
  subreddit: r.subreddit,
  cycle: r.cycle,
  day: r.day,
  survivalDays: r.survivalDays,
  status: r.status,
  threat: r.threat,
  population: r.population,
  savedCount: r.savedCount,
  activePlayers: r.activePlayers,
  isYou,
});
