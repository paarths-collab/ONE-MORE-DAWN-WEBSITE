import { BALANCE } from '../../shared/balance';
import type { CityState, CityTraitId, FactionId } from '../../shared/types';
import { buildingEffects } from './building';
import type { ResolveResult } from './resolver';

/**
 * Game invariants — the rules that must hold after EVERY resolution, no matter
 * what players did. This is how we define "correct" once and check it forever,
 * instead of hand-verifying every scenario. Pure and allocation-cheap; the
 * `check*` forms return a list of violations (empty = valid) for dev/telemetry,
 * the `assert*` forms throw. These are TEST/DEV tools — the production routes do
 * not pay for them (resolveDay already clamps; this proves the clamps hold).
 *
 * Correctness rules (per the locked spec + resolver.ts, using REAL balance
 * constants so the invariants track the tuning automatically):
 *  - Percentage vitals are clamped 0..100:      power, morale, threat, defense.
 *  - Stock vitals are bounded by their store cap: food 0..foodStoreCap(300),
 *    medicine 0..medicineStoreCap(120); population is only non-negative.
 *  - day is a positive integer; resolveDay advances it by EXACTLY +1 (the lazy
 *    resolver decides how many missed days to catch up — that is a separate
 *    concern; each resolveDay call is strictly +1).
 *  - cycle/worldSeed/trait are permanent for the city's life (only a mod reset
 *    starts a new cycle).
 *  - An ALIVE city always has population above the fall threshold; at/below it
 *    the city must be 'fallen'.
 *  - No NaN/Infinity anywhere; every vital is an integer (the resolver rounds).
 *  - Every resolved day produces exactly one timeline entry describing that day.
 */

const FOOD_MAX = BALANCE.scaling.foodStoreCap;
const MEDICINE_MAX = BALANCE.scaling.medicineStoreCap;
const FALL_THRESHOLD = BALANCE.fall.populationThreshold;

const TRAIT_IDS: readonly CityTraitId[] = [
  'standard',
  'frozen',
  'crowded',
  'militarized',
  'sick',
];
const FACTION_IDS: readonly FactionId[] = ['builders', 'wardens', 'seekers', 'hearth'];

/** Push a violation unless `val` is a finite integer within [min, max]. */
const checkNum = (
  out: string[],
  name: string,
  val: unknown,
  min: number,
  max?: number,
): void => {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    out.push(`${name} is not a finite number (${String(val)})`);
    return;
  }
  if (!Number.isInteger(val)) out.push(`${name} is not an integer (${val})`);
  if (val < min) out.push(`${name} ${val} is below min ${min}`);
  if (max !== undefined && val > max) out.push(`${name} ${val} is above max ${max}`);
};

/**
 * Returns a (possibly empty) list of invariant violations for a single city
 * state. Empty array === the state is valid. Never throws — safe to call in a
 * dev telemetry path or a test assertion.
 */
export const checkCityInvariants = (city: CityState): string[] => {
  const v: string[] = [];

  checkNum(v, 'day', city.day, 1);
  checkNum(v, 'cycle', city.cycle, 1);
  checkNum(v, 'worldSeed', city.worldSeed, 0);
  checkNum(v, 'lawExpiresDay', city.lawExpiresDay, 0);

  // stock vitals (bounded by store caps; population only non-negative). A built
  // Storehouse raises the food cap (V1 build-from-zero) — the invariant tracks
  // it so a legitimately-stocked storehouse city is not flagged.
  const foodMax = FOOD_MAX + buildingEffects(city.unlockedBuildings ?? []).foodCapBonus;
  checkNum(v, 'population', city.population, 0);
  checkNum(v, 'food', city.food, 0, foodMax);
  checkNum(v, 'medicine', city.medicine, 0, MEDICINE_MAX);

  // percentage vitals
  checkNum(v, 'power', city.power, 0, 100);
  checkNum(v, 'morale', city.morale, 0, 100);
  checkNum(v, 'threat', city.threat, 0, 100);
  checkNum(v, 'defense', city.defense, 0, 100);

  if (city.status !== 'alive' && city.status !== 'fallen') {
    v.push(`status is not 'alive' | 'fallen' (${String(city.status)})`);
  }
  if (!TRAIT_IDS.includes(city.trait)) v.push(`trait is invalid (${String(city.trait)})`);
  if (typeof city.crisisId !== 'string' || city.crisisId.length === 0) {
    v.push('crisisId is empty');
  }
  if (city.activeLaw !== null && !FACTION_IDS.includes(city.activeLaw as FactionId)) {
    v.push(`activeLaw is invalid (${String(city.activeLaw)})`);
  }

  // cross-field: an alive city must be above the fall threshold. At/below it the
  // city must have fallen — otherwise the fall check was skipped.
  if (city.status === 'alive' && city.population <= FALL_THRESHOLD) {
    v.push(`alive city population ${city.population} is at/below fall threshold ${FALL_THRESHOLD}`);
  }

  return v;
};

/** Throws if the city violates any invariant. `context` labels the error. */
export const assertCityInvariants = (city: CityState, context = 'city'): void => {
  const violations = checkCityInvariants(city);
  if (violations.length > 0) {
    throw new Error(`City invariant violation [${context}]: ${violations.join('; ')}`);
  }
};

/**
 * Cross-resolution invariants: given the city BEFORE resolveDay and its result,
 * what must be true about the transition. Includes a full validity check of the
 * resulting city. Never throws.
 */
export const checkResolveInvariants = (prev: CityState, result: ResolveResult): string[] => {
  const v: string[] = [];
  const { city: next, entry, marked } = result;

  // the resolved city must itself be valid
  for (const msg of checkCityInvariants(next)) v.push(`next.${msg}`);

  // day advances by EXACTLY 1 (strictly — the lazy resolver, not resolveDay,
  // decides how many missed days to catch up).
  if (next.day !== prev.day + 1) {
    v.push(`day did not advance by exactly 1: ${prev.day} -> ${next.day}`);
  }
  // permanent-for-life fields are preserved by resolveDay
  if (next.cycle !== prev.cycle) v.push(`cycle changed during resolve: ${prev.cycle} -> ${next.cycle}`);
  if (next.worldSeed !== prev.worldSeed) v.push('worldSeed changed during resolve');
  if (next.trait !== prev.trait) v.push('trait changed during resolve');

  // exactly one timeline entry, describing the day that was resolved (yesterday)
  if (entry.day !== prev.day) v.push(`timeline entry day ${entry.day} !== resolved day ${prev.day}`);
  if (entry.cycle !== prev.cycle) v.push(`timeline entry cycle ${entry.cycle} !== city cycle ${prev.cycle}`);
  if (typeof entry.headline !== 'string' || entry.headline.length === 0) {
    v.push('timeline entry headline is empty');
  }
  if (!Array.isArray(entry.events)) v.push('timeline entry events is not an array');

  // every delta reported must be a finite number
  for (const [k, d] of Object.entries(entry.deltas)) {
    if (typeof d !== 'number' || !Number.isFinite(d)) {
      v.push(`timeline delta ${k} is not finite (${String(d)})`);
    }
  }

  // the Marked verdict the caller persists must be well-formed
  if (typeof marked.name !== 'string' || marked.name.length === 0) v.push('marked.name is empty');
  if (typeof marked.saved !== 'boolean') v.push('marked.saved is not a boolean');

  return v;
};

/** Throws if the resolution transition violates any invariant. */
export const assertResolveInvariants = (
  prev: CityState,
  result: ResolveResult,
  context = 'resolve',
): void => {
  const violations = checkResolveInvariants(prev, result);
  if (violations.length > 0) {
    throw new Error(`Resolve invariant violation [${context}]: ${violations.join('; ')}`);
  }
};
