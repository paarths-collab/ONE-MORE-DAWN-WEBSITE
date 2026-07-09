import { BALANCE } from '../../shared/balance';
import { getCrisis, pickNextCrisis } from '../../shared/crises';
import { makeRng } from '../../shared/rng';
import type {
  CityState, CityTraitId, FactionId, PledgeKind, ResourceDelta, Role, StrategyPlanId, TimelineEntry,
} from '../../shared/types';
import { pickMarked } from './marked';
import { applyBuildProgress, buildingEffects, stageForCount } from './building';

/** Aggregates for the day being resolved. All plain data from Redis hashes. */
export type DayInputs = {
  actions: Record<string, number>; // actionType -> count
  missions: Record<string, number>; // totalFood/totalMedicine/totalScrap/totalRuns/injuries
  crisisVotes: Record<string, number>; // optionId -> count
  strategyVotes: Record<string, number>; // planId -> count (council plan — S2)
  /** actions taken by players of each role today (slice: only 'speaker' matters) */
  roleCounts: Partial<Record<Role, number>>;
  /** number of users who took any action today (for scarcity scaling — Plan 2 P4) */
  activeUserCount: number;
  /** today's faction influence tally (actionType/mission-driven) */
  factionInfluence: Partial<Record<FactionId, number>>;
  /** pledged "resolve" toward today's Marked (hook layer); 0 = nobody pledged */
  markedPledged: number;
  /** per-kind one-tap pledge counts for the day (city-stat pressure) */
  pledges: Partial<Record<PledgeKind, number>>;
  /** YESTERDAY's action-taker count — scales the Marked goal (stable all day) */
  markedActivePlayers: number;
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
export const winningFaction = (influence: Partial<Record<FactionId, number>>): FactionId | null => {
  let leader: FactionId | null = null;
  let best = 0;
  for (const f of FACTION_ORDER) {
    const v = influence[f] ?? 0;
    if (v > best) { best = v; leader = f; }
  }
  return leader;
};

/** Highest-count council plan (ties break by BALANCE.strategyPlans order); null if no votes. */
const winningPlan = (votes: Record<string, number>): StrategyPlanId | null => {
  let leader: StrategyPlanId | null = null;
  let best = 0;
  for (const p of BALANCE.strategyPlans) {
    const v = votes[p] ?? 0;
    if (v > best) { best = v; leader = p; }
  }
  return leader;
};

export type ResolveResult = {
  city: CityState;
  entry: TimelineEntry;
  /** Dawn verdict for the day's Marked — callers persist it for savedYesterday. */
  marked: { name: string; saved: boolean };
};

const TRAIT_IDS: CityTraitId[] = ['standard', 'frozen', 'crowded', 'militarized', 'sick'];

/**
 * Deterministic trait roll per (worldSeed, cycle). worldSeed 0 is the
 * documented neutral/test path: it SKIPS the roll and always yields
 * 'standard', so legacy fixtures keep their exact start values.
 */
const rollTrait = (worldSeed: number, cycle: number): CityTraitId => {
  if (worldSeed === 0) return 'standard';
  return TRAIT_IDS[makeRng((worldSeed ^ Math.imul(cycle, 40503)) >>> 0).int(TRAIT_IDS.length)]!;
};

export const newCityState = (cycle: number, worldSeed = 0): CityState => {
  const trait = rollTrait(worldSeed, cycle);
  const fx = BALANCE.traitEffects[trait];
  return {
    day: 1,
    cycle,
    status: 'alive',
    worldSeed,
    trait,
    ...BALANCE.start,
    population: Math.round(BALANCE.start.population * (fx?.startPopulationMult ?? 1)),
    food: Math.round(BALANCE.start.food * (fx?.startFoodMult ?? 1)),
    medicine: Math.round(BALANCE.start.medicine * (fx?.startMedicineMult ?? 1)),
    defense: BALANCE.start.defense + (fx?.startDefenseDelta ?? 0),
    morale: BALANCE.start.morale + (fx?.startMoraleDelta ?? 0),
    crisisId: 'first_light',
    activeLaw: null,
    lawExpiresDay: 0,
    // Build from zero (V1): every city starts as an empty Camp. Zero here means
    // buildingEffects() is all-zero, so a new city resolves identically to the
    // pre-progression game (all legacy numeric fixtures stay intact).
    cityLevel: 0,
    buildProgress: 0,
    unlockedBuildings: [],
  };
};

/**
 * Ongoing multipliers implied by the city's trait (W1). Defaults are no-op —
 * 'standard' (and any trait without effects) resolves identically to the
 * pre-trait resolver, keeping legacy numeric assertions intact.
 */
const traitMultipliers = (city: CityState) => {
  const fx = BALANCE.traitEffects[city.trait];
  return {
    powerDecayMult: fx?.powerDecayMult ?? 1,
    foodConsumeMult: fx?.foodConsumeMult ?? 1,
  };
};

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
  // Trait modifiers are permanent for the city's whole cycle (W1).
  const trait = traitMultipliers(city);

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
    BALANCE.passivePowerDecay * trait.powerDecayMult - // frozen: faster decay
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

  // --- 1a. building effects (V1 build-from-zero): bounded, default-no-op ---
  // Effects use the set ALREADY built at day start, so a building completed
  // today first pays out next dawn (natural). An empty set → all zeros, so a
  // brand-new city resolves identically to the pre-progression game.
  const fx = buildingEffects(city.unlockedBuildings);
  food += fx.foodBonus;
  defense += fx.defenseBonus;
  morale += fx.moraleBonus;
  medicine += fx.medicineBonus;

  // Build labor accrual + unlocks. A fallen city can never build (mirrors the
  // aliveness gate lazyResolve applies before calling resolveDay); progress and
  // the unlocked set carry unchanged so the projection stays stable.
  const buildLabor =
    city.status === 'alive' ? (inputs.actions['build_city'] ?? 0) * BALANCE.build.progressPerAction : 0;
  const built = applyBuildProgress(city.buildProgress, city.unlockedBuildings, buildLabor);
  const nextCityLevel = stageForCount(built.unlocked.length);
  for (const id of built.completed) {
    const def = BALANCE.build.buildings.find((b) => b.id === id);
    events.push(`The ${def?.name ?? id} is complete — the city grows.`);
  }

  // --- 1b. one-tap pledge pressure (hook layer): each tap nudges a vital ---
  let pledgeTaps = 0;
  for (const kind of Object.keys(BALANCE.marked.pledgePressure) as PledgeKind[]) {
    const taps = inputs.pledges[kind] ?? 0;
    if (taps === 0) continue;
    pledgeTaps += taps;
    const fx: ResourceDelta = BALANCE.marked.pledgePressure[kind];
    food += taps * (fx.food ?? 0);
    power += taps * (fx.power ?? 0);
    medicine += taps * (fx.medicine ?? 0);
    morale += taps * (fx.morale ?? 0);
    threat += taps * (fx.threat ?? 0);
    defense += taps * (fx.defense ?? 0);
  }
  if (pledgeTaps > 0) events.push(`${pledgeTaps} citizen pledge${pledgeTaps > 1 ? 's' : ''} steadied the city.`);

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

  // --- 2b. council unity (S2): morale bonus BEFORE consumption/penalties so
  // the bonus participates in the day's morale math (collapse check etc.).
  const plan = winningPlan(inputs.strategyVotes);
  // back_council pledges nudge unity: each tap counts toward the QUORUM only
  // (a plan still needs real votes to win).
  const planVoterCount =
    Object.values(inputs.strategyVotes).reduce((s, n) => s + n, 0) +
    (inputs.pledges.back_council ?? 0) * BALANCE.marked.backCouncilQuorumWeight;
  if (plan && planVoterCount >= BALANCE.unity.minPlanVoters) {
    const alignedAction = BALANCE.planActionMap[plan];
    // send_scouts aligns with mission runs; every other plan maps to a city action.
    const alignedCount = alignedAction === null ? m('totalRuns') : a(alignedAction);
    // Total effort pool = all city actions + mission runs, so action-plan and
    // mission-plan shares are comparable.
    const totalCount = acted + m('totalRuns');
    if (totalCount > 0 && alignedCount / totalCount >= BALANCE.unity.alignedShareThreshold) {
      morale += BALANCE.unity.moraleBonus;
      events.push(
        `Unity: the city rallied behind "${plan.replace(/_/g, ' ')}" — morale +${BALANCE.unity.moraleBonus}.`,
      );
    }
  }

  // --- 2c. The Marked (hook layer): pledged resolve vs the daily goal.
  // pickMarked is pure per (worldSeed, cycle, day, actives), so the resolver
  // judges exactly the objective /init displayed. Morale lands BEFORE the
  // penalty phase so it participates in the collapse check, like unity.
  const marked = pickMarked(city.worldSeed, city.cycle, city.day, inputs.markedActivePlayers);
  const markedSaved = inputs.markedPledged >= marked.goal;
  if (markedSaved) {
    morale += BALANCE.marked.savedMoraleBonus;
    events.push(
      `${marked.name} was saved — ${inputs.markedPledged}/${marked.goal} resolve pledged. The city takes heart.`,
    );
  } else {
    morale -= BALANCE.marked.lostMoralePenalty;
    events.push(
      `Memorial: ${marked.name} was lost at dawn — only ${inputs.markedPledged}/${marked.goal} resolve pledged.`,
    );
  }

  // --- 3. consumption + penalties ---
  const consumed = Math.ceil(
    (Math.ceil(population * BALANCE.foodPerPopulation) +
      Math.ceil(inputs.activeUserCount * BALANCE.scaling.activePlayerFoodDrain)) *
      law.foodConsumeMult * // wardens: +10% food consumption
      trait.foodConsumeMult, // frozen: food keeps longer (composes multiplicatively)
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
    food: Math.min(BALANCE.scaling.foodStoreCap + fx.foodCapBonus, clampStock(food)),
    power: clampPct(power),
    medicine: Math.min(BALANCE.scaling.medicineStoreCap, clampStock(medicine)),
    morale: clampPct(morale),
    threat: clampPct(threat),
    defense: clampPct(defense),
    crisisId: city.crisisId,
    status: city.status,
    // Build progression carries into tomorrow (unchanged for a fallen city).
    cityLevel: nextCityLevel,
    buildProgress: built.progress,
    unlockedBuildings: built.unlocked,
  };

  // --- 4b. Red Signal raid ---
  if (next.threat >= BALANCE.raid.triggerThreshold) {
    // Each guard action today softens every raid loss (floored at 0 per-loss).
    // A built Wall adds a flat raidDampen on top (bounded; 0 without the wall).
    const dampen = (inputs.actions['guard_wall'] ?? 0) * BALANCE.raid.guardDampenPerAction + fx.raidDampen;
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

  return { city: next, entry, marked: { name: marked.name, saved: markedSaved } };
};
