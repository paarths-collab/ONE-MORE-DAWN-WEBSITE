import { BALANCE } from '../../shared/balance';
import { getCrisis, pickNextCrisis } from '../../shared/crises';
import type {
  CityState, FactionId, ResourceDelta, Role, TimelineEntry,
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
  /** today's faction influence tally (actionType/mission-driven) */
  factionInfluence: Partial<Record<FactionId, number>>;
};

type LawId = FactionId;

/** Is the city's law active for the day being resolved? */
const activeLawId = (city: CityState): LawId | null => {
  if (!city.activeLaw) return null;
  if (city.lawExpiresDay < city.day) return null; // expired
  return city.activeLaw as LawId;
};

/**
 * Production/consumption multipliers implied by the currently active law.
 * Only one law is ever active, so buff/cost pairs never stack across laws.
 * Defaults are no-op (1 / 1 / 1 / 1 / 0).
 *
 * Law "cost" clauses with no in-slice mechanic to attach to are display-only
 * until Plan 3: builders' "morale actions cost +1 energy" (no per-action
 * energy model in the resolver) and seekers' "injury risk +10%" (a
 * mission-time concern the resolver never sees). Those are intentionally
 * NOT modeled here.
 */
const lawMultipliers = (city: CityState) => {
  const mult = {
    repairMult: 1, // repair_power output scale
    treatMult: 1, // treat_sick output scale
    threatRiseMult: 1, // passive threat rise scale
    foodConsumeMult: 1, // consumption scale
    missionFoodBonus: 0, // extra food per mission run
  };
  switch (activeLawId(city)) {
    case 'builders': // Emergency Engineering: repair actions +25% power
      mult.repairMult = 1.25;
      break;
    case 'wardens': // Wall Watch: threat rises 25% slower; food consumption +10%
      mult.threatRiseMult = 0.75;
      mult.foodConsumeMult = 1.1;
      break;
    case 'seekers': // Ruins Charter: expedition loot +1 per crate (~+1 food per run)
      mult.missionFoodBonus = 1;
      break;
    case 'hearth': // Common Table: treat_sick +50% medicine; repair -25% power
      mult.treatMult = 1.5;
      mult.repairMult = 0.75;
      break;
    default:
      break;
  }
  return mult;
};

const FACTION_ORDER: FactionId[] = ['builders', 'wardens', 'seekers', 'hearth'];

/** Highest-influence faction today (ties break by FACTION_ORDER); null if none. */
const winningFaction = (influence: Partial<Record<FactionId, number>>): FactionId | null => {
  let leader: FactionId | null = null;
  let best = 0;
  for (const f of FACTION_ORDER) {
    const v = influence[f] ?? 0;
    if (v > best) { best = v; leader = f; }
  }
  return leader;
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

  // Law modifiers from yesterday's winning faction (applied to today's day).
  const law = lawMultipliers(city);

  // --- 1. action + mission production ---
  let food =
    city.food +
    a('grow_food') * (BALANCE.actionEffects.grow_food.food ?? 0) +
    m('totalFood') +
    m('totalRuns') * law.missionFoodBonus; // seekers: +1 food per run
  let power =
    city.power +
    a('repair_power') * (BALANCE.actionEffects.repair_power.power ?? 0) * law.repairMult +
    m('totalScrap') - // scrap feeds the generators
    BALANCE.passivePowerDecay -
    inputs.activeUserCount * BALANCE.scaling.activePlayerPowerDrain;
  let medicine =
    city.medicine +
    a('treat_sick') * (BALANCE.actionEffects.treat_sick.medicine ?? 0) * law.treatMult +
    m('totalMedicine');
  let defense = city.defense + a('guard_wall') * (BALANCE.actionEffects.guard_wall.defense ?? 0);
  let threat =
    city.threat +
    BALANCE.passiveThreatRise * law.threatRiseMult + // wardens: threat rises slower
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
  const consumed = Math.ceil(
    (Math.ceil(population * BALANCE.foodPerPopulation) +
      Math.ceil(inputs.activeUserCount * BALANCE.scaling.activePlayerFoodDrain)) *
      law.foodConsumeMult, // wardens: +10% food consumption
  );
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

  // --- 4. clamp ---
  // Section ordering (P3): clamp -> raid -> fall check -> next crisis -> faction law -> timeline.
  // The raid runs AFTER clamping (so it acts on final threat) but BEFORE the
  // fall check, because a raid's population loss can itself topple the city.
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

  // --- 4b. Red Signal raid ---
  if (next.threat >= BALANCE.raid.triggerThreshold) {
    // Each guard action today softens every raid loss (floored at 0 per-loss).
    const dampen = (inputs.actions['guard_wall'] ?? 0) * BALANCE.raid.guardDampenPerAction;
    const foodLoss = Math.max(0, BALANCE.raid.foodLoss - dampen);
    const powerLoss = Math.max(0, BALANCE.raid.powerLoss - dampen);
    const moraleLoss = Math.max(0, BALANCE.raid.moraleLoss - dampen);
    const populationLoss = Math.max(0, BALANCE.raid.populationLoss - dampen);

    next.food = clampStock(next.food - foodLoss);
    next.power = clampPct(next.power - powerLoss);
    next.morale = clampPct(next.morale - moraleLoss);
    next.population = Math.max(0, next.population - populationLoss);
    next.threat = BALANCE.raid.postRaidThreat;

    const raidFelled = next.population <= BALANCE.fall.populationThreshold;
    events.push(
      raidFelled
        ? 'The Red Signal came in the night. The city could not hold — it fell.'
        : 'The Red Signal came in the night. The city held, but paid in blood.',
    );
  }

  // --- 4c. fall check (after raid, which can itself cause a fall) ---
  if (next.population <= BALANCE.fall.populationThreshold) {
    if (next.status === 'alive') {
      // Only the non-raid fall gets the generic epitaph; the raid already spoke.
      const felledByRaid = next.threat === BALANCE.raid.postRaidThreat &&
        events.some((e) => /red signal/i.test(e));
      if (!felledByRaid) events.push('The last fires went out. The city has fallen.');
    }
    next.status = 'fallen';
  }

  // --- 5. next crisis (uses FINAL alive status) ---
  if (next.status === 'alive') {
    next.crisisId = pickNextCrisis(city).id;
  }

  // --- 5b. faction winner shapes tomorrow's law (alive cities only) ---
  // lawExpiresDay is the LAST day the law is active. A law enacted for
  // next.day with lifespan 1 expires that same day (active on next.day only),
  // so the stamp is `next.day + lifespan - 1`. Active-check elsewhere is
  // `lawExpiresDay >= currentDay`.
  if (next.status === 'alive') {
    const winnerFaction = winningFaction(inputs.factionInfluence);
    if (winnerFaction) {
      next.activeLaw = winnerFaction;
      next.lawExpiresDay = next.day + BALANCE.lawLifespanDays - 1;
      const label = BALANCE.laws[winnerFaction].label;
      events.push(`The ${winnerFaction} faction shaped tomorrow's law: ${label} enacted.`);
    } else {
      // No faction acted: carry yesterday's law only if it is still within its
      // lifespan for tomorrow; otherwise clear it to null.
      const carry = city.lawExpiresDay >= next.day ? city.activeLaw : null;
      next.activeLaw = carry;
      next.lawExpiresDay = carry ? city.lawExpiresDay : 0;
    }
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
