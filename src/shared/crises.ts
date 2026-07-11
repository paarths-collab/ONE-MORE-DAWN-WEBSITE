import { makeRng } from './rng';
import type { Crisis, CityState } from './types';

export const CRISES: Crisis[] = [
  {
    id: 'first_light',
    title: 'First Light',
    narrative:
      'The generators cough back to life. Survivors gather at the wall, waiting to be told what this city will become.',
    options: [
      { id: 'a', label: 'Fortify first', description: 'Spend the day on the wall. Safety before comfort.', effects: { defense: 6, morale: -3 } },
      { id: 'b', label: 'Feed everyone', description: 'Open the stores. A full stomach buys hope.', effects: { food: -8, morale: 8 } },
      { id: 'c', label: 'Map the ruins', description: 'Send runners out to chart what is left.', effects: { threat: 4, medicine: 3, food: 3 } },
    ],
  },
  {
    id: 'refugee_convoy',
    title: 'The Convoy at the Gate',
    narrative:
      'A refugee convoy is outside the gate. Thirty souls, thin and coughing. They say raiders burned their camp.',
    minDay: 2,
    options: [
      { id: 'a', label: 'Let them in', description: 'More mouths, and more hands.', effects: { population: 30, food: -20, morale: 4 } },
      { id: 'b', label: 'Turn them away', description: 'The city cannot bleed for strangers.', effects: { morale: -10, defense: 3 } },
      { id: 'c', label: 'Inspect first', description: 'Scouts check the convoy for sickness and weapons.', effects: { population: 15, food: -8, threat: 3 } },
    ],
  },
  {
    id: 'blackout_ward',
    title: 'Blackout in the Ward',
    narrative:
      'The hospital ward lost power overnight. The backup cells have one charge left. Where does it go?',
    minDay: 3,
    options: [
      { id: 'a', label: 'Power the ward', description: 'The sick get the light.', effects: { medicine: 4, power: -6, morale: 3 } },
      { id: 'b', label: 'Power the wall lights', description: 'Darkness invites worse things than sickness.', effects: { threat: -8, morale: -4 } },
      { id: 'c', label: 'Ration the charge', description: 'Split it. Half measures for half a city.', effects: { medicine: 2, threat: -3, power: -3 } },
    ],
  },
  {
    id: 'ration_riots',
    title: 'Ration Riots',
    narrative:
      'The food queue turned ugly at dusk. A storehouse window is broken and three guards are bruised.',
    minDay: 4,
    requires: { maxFood: 15 },
    options: [
      { id: 'a', label: 'Impose strict rationing', description: 'Order, at the cost of anger.', effects: { food: 6, morale: -12 } },
      { id: 'b', label: 'Open emergency stores', description: 'Calm them with what little is left.', effects: { food: -10, morale: 10 } },
      { id: 'c', label: 'Double the guard', description: 'Meet fists with discipline.', effects: { defense: 4, morale: -6, threat: 2 } },
    ],
  },
  {
    id: 'strange_signal',
    title: 'A Strange Signal',
    narrative:
      'The radio tower catches a repeating pulse from the north. Not weather. Not random. Someone, or something, is broadcasting.',
    minDay: 3,
    options: [
      { id: 'a', label: 'Answer it', description: 'Break silence. Risk attention.', effects: { threat: 8, morale: 5 } },
      { id: 'b', label: 'Jam it', description: 'Whatever it is, keep it away.', effects: { power: -5, threat: -5 } },
      { id: 'c', label: 'Just listen', description: 'Log everything. Reveal nothing.', effects: { morale: -2, medicine: 2 } },
    ],
  },
  {
    id: 'sickness_spreads',
    title: 'The Cough Spreads',
    narrative:
      'Four workers collapsed at the greenhouse. The medics whisper a word nobody wants to hear: outbreak.',
    minDay: 4,
    requires: { maxMorale: 70 },
    options: [
      { id: 'a', label: 'Quarantine the block', description: 'Contain it, whatever it costs.', effects: { morale: -8, medicine: -3, population: -2 } },
      { id: 'b', label: 'Spend the medicine', description: 'Treat everyone showing symptoms.', effects: { medicine: -10, morale: 6 } },
      { id: 'c', label: 'Work through it', description: 'The city cannot stop. Pray it passes.', effects: { population: -6, morale: -5 } },
    ],
  },
];

export const getCrisis = (id: string): Crisis =>
  CRISES.find((c) => c.id === id) ?? CRISES[0]!;

const isEligible = (crisis: Crisis, city: CityState): boolean => {
  if (crisis.id === city.crisisId) return false;
  if (crisis.minDay !== undefined && city.day + 1 < crisis.minDay) return false;
  const r = crisis.requires;
  if (!r) return true;
  if (r.maxFood !== undefined && city.food > r.maxFood) return false;
  if (r.maxPower !== undefined && city.power > r.maxPower) return false;
  if (r.maxMorale !== undefined && city.morale > r.maxMorale) return false;
  if (r.minThreat !== undefined && city.threat < r.minThreat) return false;
  return true;
};

/**
 * Deterministic pick: same city state -> same next crisis. The resolver runs
 * once per day under a lock, so determinism means retries can't fork reality.
 * Uses the seeded RNG (not a linear stride) so consecutive days decorrelate —
 * the previous `(day*7 + cycle*13) % n` degenerated to short orbits (a 3-crisis
 * loop in the healthy case). Seed mixes day and cycle via Knuth/prime
 * multipliers so nearby seeds land in different buckets, and folds in the
 * per-city worldSeed (W1) so different installations see different sequences.
 */
export const pickNextCrisis = (city: CityState): Crisis => {
  const pool = CRISES.filter((c) => isEligible(c, city));
  if (pool.length === 0) {
    return getCrisis(city.crisisId === 'first_light' ? 'strange_signal' : 'first_light');
  }
  const seed =
    (Math.imul(city.day, 2654435761) ^ Math.imul(city.cycle, 40503) ^ city.worldSeed) >>> 0;
  return pool[makeRng(seed).int(pool.length)]!;
};
