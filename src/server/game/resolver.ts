import { BALANCE } from '../../shared/balance';
import { getCrisis, pickNextCrisis } from '../../shared/crises';
import type {
  CityState, ResourceDelta, Role, TimelineEntry,
} from '../../shared/types';

/** Aggregates for the day being resolved. All plain data from Redis hashes. */
export type DayInputs = {
  actions: Record<string, number>; // actionType -> count
  missions: Record<string, number>; // totalFood/totalMedicine/totalScrap/totalRuns/injuries
  crisisVotes: Record<string, number>; // optionId -> count
  /** actions taken by players of each role today (slice: only 'speaker' matters) */
  roleCounts: Partial<Record<Role, number>>;
  /** number of users who took any action today (for scarcity scaling — Plan 2 P4) */
  activeUserCount: number;
};

export type ResolveResult = { city: CityState; entry: TimelineEntry };

export const newCityState = (cycle: number): CityState => ({
  day: 1,
  cycle,
  status: 'alive',
  ...BALANCE.start,
  crisisId: 'first_light',
  activeLaw: null,
  lawExpiresDay: 0,
});

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const clampStock = (n: number) => Math.max(0, Math.round(n));

const winningOption = (votes: Record<string, number>): string | null => {
  const entries = Object.entries(votes).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  entries.sort(([idA, nA], [idB, nB]) => nB - nA || idA.localeCompare(idB));
  return entries[0]![0];
};

/**
 * Pure day resolution (spec §1 "Day resolution"). Deterministic:
 * same (city, inputs) -> same result. Never mutates its arguments.
 * Law/faction/raid hooks arrive in Plan 2 — the shape already fits.
 */
export const resolveDay = (city: CityState, inputs: DayInputs): ResolveResult => {
  const events: string[] = [];
  const a = (type: string) => inputs.actions[type] ?? 0;
  const m = (field: string) => inputs.missions[field] ?? 0;

  // --- 1. action + mission production ---
  let food = city.food + a('grow_food') * (BALANCE.actionEffects.grow_food.food ?? 0) + m('totalFood');
  let power =
    city.power +
    a('repair_power') * (BALANCE.actionEffects.repair_power.power ?? 0) +
    m('totalScrap') - // scrap feeds the generators
    BALANCE.passivePowerDecay -
    inputs.activeUserCount * BALANCE.scaling.activePlayerPowerDrain;
  let medicine =
    city.medicine + a('treat_sick') * (BALANCE.actionEffects.treat_sick.medicine ?? 0) + m('totalMedicine');
  let defense = city.defense + a('guard_wall') * (BALANCE.actionEffects.guard_wall.defense ?? 0);
  let threat =
    city.threat +
    BALANCE.passiveThreatRise +
    a('guard_wall') * (BALANCE.actionEffects.guard_wall.threat ?? 0) +
    m('totalRuns') * BALANCE.mission.missionThreatNoise +
    inputs.activeUserCount * BALANCE.scaling.activePlayerThreatRise;
  let morale = city.morale + (inputs.roleCounts.speaker ?? 0) * BALANCE.speakerMoralePerAction;
  let population = city.population;

  const acted = Object.values(inputs.actions).reduce((s, n) => s + n, 0);
  if (acted > 0) events.push(`${acted} citizen actions strengthened the city.`);
  if (m('totalRuns') > 0) {
    events.push(
      `${m('totalRuns')} expedition${m('totalRuns') > 1 ? 's' : ''} returned: +${m('totalFood')} food, +${m('totalMedicine')} medicine, +${m('totalScrap')} scrap.`,
    );
  }
  if (m('injuries') > 0) events.push(`${m('injuries')} scout${m('injuries') > 1 ? 's were' : ' was'} injured in the ruins.`);

  // --- 2. crisis vote ---
  const crisis = getCrisis(city.crisisId);
  const winner = winningOption(inputs.crisisVotes);
  const deltas: ResourceDelta = {};
  if (winner) {
    const option = crisis.options.find((o) => o.id === winner);
    if (option) {
      food += option.effects.food ?? 0;
      power += option.effects.power ?? 0;
      medicine += option.effects.medicine ?? 0;
      morale += option.effects.morale ?? 0;
      threat += option.effects.threat ?? 0;
      defense += option.effects.defense ?? 0;
      population += option.effects.population ?? 0;
      events.push(`Crisis "${crisis.title}": the city chose "${option.label}".`);
    }
  } else {
    events.push(`Crisis "${crisis.title}": nobody voted. The moment passed unanswered.`);
  }

  // --- 3. consumption + penalties ---
  const consumed =
    Math.ceil(population * BALANCE.foodPerPopulation) +
    Math.ceil(inputs.activeUserCount * BALANCE.scaling.activePlayerFoodDrain);
  food -= consumed;
  if (food < 0) {
    const missing = -food;
    const deaths = Math.ceil(missing * BALANCE.hunger.deathsPerMissingFood);
    population -= deaths;
    morale -= BALANCE.hunger.moralePenalty;
    food = 0;
    events.push(`Hunger swept the city: ${deaths} died, morale is breaking.`);
  }
  if (power < BALANCE.lowPowerThreshold) {
    morale -= BALANCE.lowPowerMoralePenalty;
    events.push('The lights flicker. Darkness weighs on everyone.');
  }
  if (medicine < BALANCE.sickness.threshold) {
    if (medicine >= BALANCE.sickness.medicineCostPerDay) {
      medicine -= BALANCE.sickness.medicineCostPerDay;
    } else {
      population -= BALANCE.sickness.deathsIfNone;
      events.push(`Sickness claimed ${BALANCE.sickness.deathsIfNone} lives — there was no medicine left.`);
    }
  } else {
    medicine -= BALANCE.sickness.medicineCostPerDay;
  }
  if (morale < BALANCE.morale.collapseThreshold) {
    population -= BALANCE.morale.desertersPerDay;
    events.push(`${BALANCE.morale.desertersPerDay} citizens slipped away in the night.`);
  }

  // --- 4. clamp + fall check ---
  const next: CityState = {
    ...city,
    day: city.day + 1,
    population: Math.max(0, Math.round(population)),
    food: Math.min(BALANCE.scaling.foodStoreCap, clampStock(food)),
    power: clampPct(power),
    medicine: Math.min(BALANCE.scaling.medicineStoreCap, clampStock(medicine)),
    morale: clampPct(morale),
    threat: clampPct(threat),
    defense: clampPct(defense),
    crisisId: city.crisisId,
    status: city.status,
  };
  if (next.population <= BALANCE.fall.populationThreshold) {
    next.status = 'fallen';
    events.push('The last fires went out. The city has fallen.');
  }

  // --- 5. next crisis ---
  if (next.status === 'alive') {
    next.crisisId = pickNextCrisis(city).id;
  }

  // --- 6. timeline entry (deltas vs yesterday) ---
  deltas.food = next.food - city.food;
  deltas.power = next.power - city.power;
  deltas.medicine = next.medicine - city.medicine;
  deltas.morale = next.morale - city.morale;
  deltas.threat = next.threat - city.threat;
  deltas.population = next.population - city.population;

  const entry: TimelineEntry = {
    day: city.day, // the day being resolved
    cycle: city.cycle,
    headline:
      next.status === 'fallen'
        ? `Day ${city.day}: The city fell.`
        : `Day ${city.day}: The city survived to see one more dawn.`,
    events,
    deltas,
    crisisId: city.crisisId,
    winningOptionId: winner,
  };

  return { city: next, entry };
};
