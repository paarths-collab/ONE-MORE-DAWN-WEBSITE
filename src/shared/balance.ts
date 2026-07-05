import type { ActionType, FactionId, ResourceDelta, Role, StrategyPlanId } from './types';

export const BALANCE = {
  dailyEnergy: 3,
  injuryEnergyPenalty: 1,
  roleChangeCooldownDays: 3,

  // starting city
  start: {
    population: 120,
    food: 60,
    power: 55,
    medicine: 20,
    morale: 60,
    threat: 30,
    defense: 40,
  },

  // per-day consumption/decay (per resolution)
  foodPerPopulation: 0.15, // food consumed = ceil(population * this)
  passiveThreatRise: 6,
  passivePowerDecay: 3,

  // ---------- Scaling for active player count (Plan 2 P4, audit finding #1) ----------
  // Drains grow with active players so a 20-player subreddit still faces
  // scarcity, not just a 3-player one.
  scaling: {
    activePlayerFoodDrain: 0.5,   // extra food consumed per active player per day
    activePlayerPowerDrain: 0.2,
    activePlayerThreatRise: 0.2,
    foodStoreCap: 300,
    medicineStoreCap: 120,
  },

  // action base effects (before role bonus)
  actionEffects: {
    grow_food: { food: 3 },
    repair_power: { power: 4 },
    treat_sick: { medicine: 2 },
    guard_wall: { threat: -5, defense: 2 },
  } satisfies Record<ActionType, ResourceDelta>,

  // role -> action it boosts, multiplier applied to that action's effects
  roleBonus: {
    farmer: { action: 'grow_food', multiplier: 1.5 },
    engineer: { action: 'repair_power', multiplier: 1.5 },
    medic: { action: 'treat_sick', multiplier: 1.5 },
    guard: { action: 'guard_wall', multiplier: 1.5 },
    // scout and speaker get their bonuses elsewhere (mission / morale tick)
  } as Partial<Record<Role, { action: ActionType; multiplier: number }>>,

  speakerMoralePerAction: 1, // each speaker action also adds +1 morale

  // contribution scoring (leaderboard + faction rep later)
  contributionPerAction: 10,
  contributionPerMissionLoot: 5, // per item banked

  // hunger / darkness / sickness penalties at resolution
  hunger: { moralePenalty: 8, deathsPerMissingFood: 0.3 }, // deaths = ceil(missingFood * this)
  lowPowerThreshold: 25,
  lowPowerMoralePenalty: 4,
  sickness: { threshold: 10, medicineCostPerDay: 2, deathsIfNone: 2 }, // if medicine < threshold

  morale: { collapseThreshold: 15, desertersPerDay: 3 }, // population loss when morale < threshold

  // mission
  mission: {
    airSeconds: 90,
    scoutAirBonusSeconds: 15,
    scoutRevealTiles: 2,
    minPlausibleDurationMs: 5000,
    completionGraceMs: 30000,
    tokenTtlMs: 10 * 60 * 1000,
    failLootKeepRatio: 0.5, // keep half, rounded down
    injuryDays: 1,
    missionThreatNoise: 2, // each mission run raises threat a little
    // crate loot rolls (weights)
    nearCrate: { items: 1 },
    deepCrateDepthThreshold: 6, // BFS distance from exit >= this = deep
    deepCrate: { minItems: 2, maxItems: 3 },
    lootWeightsNear: { food: 0.55, scrap: 0.3, medicine: 0.15 },
    lootWeightsDeep: { food: 0.35, scrap: 0.3, medicine: 0.35 },
    cratesPerMap: 7,
    hazardsBase: 4,
    hazardsPerThreat: 0.05, // + floor(threat * this) hazards
    hazardWarningMs: 1200,
  },

  strategyPlans: [
    'stockpile_food',
    'repair_power',
    'prepare_raid',
    'send_scouts',
    'treat_sick',
  ] satisfies StrategyPlanId[],

  // city failure
  fall: { populationThreshold: 10 },

  // ---------- Factions (Plan 2 P1) ----------
  factionPerAction: {
    grow_food: null,
    repair_power: 'builders',
    treat_sick: 'hearth',
    guard_wall: 'wardens',
  } satisfies Record<ActionType, FactionId | null>,

  factionPerMissionRun: 'seekers' as FactionId,
  factionRepPerAction: 2,
  factionRepPerMissionRun: 3,

  laws: {
    builders: { id: 'builders' as const, label: 'Emergency Engineering', buff: 'Repair actions +25% power', cost: 'Morale actions cost +1 energy' },
    wardens:  { id: 'wardens'  as const, label: 'Wall Watch',            buff: 'Threat rises 25% slower',    cost: 'Food consumption +10%' },
    seekers:  { id: 'seekers'  as const, label: 'Ruins Charter',          buff: 'Expedition loot +1 per crate', cost: 'Injury risk +10%' },
    hearth:   { id: 'hearth'   as const, label: 'Common Table',           buff: 'Treat Sick +50% medicine',   cost: 'Repair actions -25% power' },
  },

  lawLifespanDays: 1,

  raid: {
    triggerThreshold: 100,
    postRaidThreat: 40,
    populationLoss: 8,
    foodLoss: 20,
    powerLoss: 15,
    moraleLoss: 15,
    guardDampenPerAction: 3,
  },
} as const;

export const DAY_ZERO_CRISIS_ID = 'first_light';
