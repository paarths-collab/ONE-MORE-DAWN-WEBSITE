import type {
  ActionType, CityTraitId, FactionId, Marked, MissionRoute, PledgeKind, PledgeOption,
  ResourceDelta, Role, StrategyPlanId,
} from './types';

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

  // ---------- Council unity (S2) ----------
  unity: {
    alignedShareThreshold: 0.6, // fraction of today's city actions matching the winning plan
    minPlanVoters: 3,           // unity needs a real quorum
    moraleBonus: 5,
  },
  planActionMap: {
    stockpile_food: 'grow_food',
    repair_power: 'repair_power',
    prepare_raid: 'guard_wall',
    treat_sick: 'treat_sick',
    send_scouts: null, // scouting is missions, counted via totalRuns
  } satisfies Record<StrategyPlanId, ActionType | null>,

  // action base effects (before role bonus)
  actionEffects: {
    grow_food: { food: 3 },
    repair_power: { power: 4 },
    treat_sick: { medicine: 2 },
    guard_wall: { threat: -5, defense: 2 },
    // build_city produces no direct city-stat delta — its labor feeds the build
    // system (see BALANCE.build + game/building.ts), so its effect map is empty.
    build_city: {},
  } satisfies Record<ActionType, ResourceDelta>,

  // ---------- City progression: build from zero (V1) ----------
  // A brand-new city starts as a Camp with no buildings. Each build_city action
  // adds `progressPerAction` labor; buildings unlock in list order as progress
  // crosses each threshold. Effects are modest and bounded (see game/building.ts).
  build: {
    progressPerAction: 6,
    stages: ['Camp', 'Settlement', 'Village', 'Fortified Town', 'Surviving City'],
    buildings: [
      { id: 'shelter',      name: 'Shelter',      description: 'Tents become homes, fewer are lost to the cold.', progressRequired: 24, effect: '+1 morale/day' },
      { id: 'farm',         name: 'Farm',         description: 'Worked beds, food grows faster.',                  progressRequired: 30, effect: '+3 food/day' },
      { id: 'clinic',       name: 'Clinic',       description: 'The sick rest and recover.',                         progressRequired: 34, effect: '+1 medicine/day' },
      { id: 'watchtower',   name: 'Watchtower',   description: 'Eyes on the ridge, the wall holds harder.',         progressRequired: 30, effect: '+2 defense/day' },
      { id: 'storehouse',   name: 'Storehouse',   description: 'Stores keep more before they spoil.',                progressRequired: 28, effect: '+100 food cap' },
      { id: 'wall',         name: 'Wall',         description: 'Raiders break on stone.',                            progressRequired: 40, effect: 'softens raid losses' },
      { id: 'council_hall', name: 'Council Hall', description: 'The council speaks with one voice.',                 progressRequired: 44, effect: '+1 morale/day' },
    ],
  } as const,

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
  // A daily streak now PAYS. Every `step` consecutive days adds `perStep` bonus
  // standing to each accepted action, capped at `cap` (a +50% ceiling on the
  // base 10, reached at a 15-day flame). Personal-ledger only (standing +
  // leaderboard) — it never touches a city vital, so it cannot perturb the
  // resolve / raid / Marked balance. Turns the streak from a pure cost (rekindle
  // only ever spent standing) into a reason to keep the flame lit.
  streakReward: { step: 3, perStep: 1, cap: 5 },
  // Streak insurance: restore a dead streak by burning standing. Cost scales
  // with the streak being saved, so long flames are precious, not free.
  rekindle: { minStreak: 3, costPerDay: 2 },
  contributionPerMissionLoot: 5, // per item banked
  contributionPerPledge: 5, // one-tap pledge: half an action's worth

  // ---------- The Marked + one-tap pledges (Reddit-native hook layer, Plan 1) ----------
  marked: {
    // goal = min(goalMax, goalBase + ceil(activePlayers * goalPerActivePlayer))
    // where activePlayers = YESTERDAY's action-takers (stable all day, so the
    // goal shown at /init is exactly the goal the dawn resolver judges).
    // Tuned so the Marked is SAVEABLE across the whole 5-20 active target range:
    // with pledgePerTap 5 (one pledge/user/day), the max daily resolve is 5*P.
    // Solving 5P >= goalBase + goalPerActivePlayer*P gives P >= 2 here, so even a
    // 5-player sub saves at ~64% pledging (goal 16 vs max 25); a 20-player sub at
    // ~46% (goal 46 vs 100). The old 10 + 4P made it 5P >= 10 + 4P -> P >= 10, i.e.
    // literally unwinnable for the bottom half of the target range.
    goalBase: 6,
    goalPerActivePlayer: 2,
    goalMax: 200,
    pledgePerTap: 5, // "resolve" each one-tap pledge adds toward the goal
    savedMoraleBonus: 4, // dawn: goal met
    lostMoralePenalty: 3, // dawn: goal missed (small — a memorial, not a wipe)
    // Daily objective pool weights by kind (see MARKED_POOL in names.ts).
    kindWeights: { person: 4, place: 4, symbol: 2 } satisfies Record<Marked['kind'], number>,
    // Per-tap city-stat pressure applied at resolution. back_council has no
    // direct stat: each tap counts toward the council-unity quorum instead
    // (see backCouncilQuorumWeight + resolver §2b).
    pledgePressure: {
      stand_vigil: { defense: 1, threat: -1 },
      share_rations: { food: 1 },
      run_messages: { morale: 1 },
      back_council: {},
    } satisfies Record<PledgeKind, ResourceDelta>,
    backCouncilQuorumWeight: 1, // each back_council tap counts as this many plan voters (quorum only)
    ledgerTop: 3, // pledge ledger: top helpers shown
    ledgerRecent: 5, // pledge ledger: recent helpers shown
  },

  // The 4 one-tap pledge options — single source of truth for /init + /pledge.
  pledgeOptions: [
    { id: 'stand_vigil', label: 'Stand Vigil', icon: '🕯️', effect: '+defense · −threat' },
    { id: 'share_rations', label: 'Share Rations', icon: '🍞', effect: '+food' },
    { id: 'run_messages', label: 'Run Messages', icon: '📨', effect: '+morale' },
    { id: 'back_council', label: 'Back the Council', icon: '🏛️', effect: '+council unity' },
  ] satisfies readonly PledgeOption[],

  // Live Drama Feed sizing (built in /init; see src/server/game/drama.ts).
  drama: { maxEvents: 8 },

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
    minMsPerTile: 100, // client walks at 160ms/tile; 100 leaves slack for honest runs
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
    // Route choice (S1): 'deep' matches the legacy defaults above exactly so
    // pre-route maps/seeds reproduce bit-identically.
    routes: {
      safe:      { crates: 4, hazardsBase: 2, hazardsPerThreat: 0.03, extraDeepItems: 0 },
      deep:      { crates: 7, hazardsBase: 4, hazardsPerThreat: 0.05, extraDeepItems: 0 },
      desperate: { crates: 9, hazardsBase: 6, hazardsPerThreat: 0.08, extraDeepItems: 1 },
    } satisfies Record<MissionRoute, { crates: number; hazardsBase: number; hazardsPerThreat: number; extraDeepItems: number }>,
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
    build_city: 'builders',
  } satisfies Record<ActionType, FactionId | null>,

  factionPerMissionRun: 'seekers' as FactionId,
  factionRepPerAction: 2,
  factionRepPerMissionRun: 3,

  // ---------- Role reputation & titles (reward/retention layer) ----------
  roleRepPerAction: 3,
  roleRepPerMission: 4,
  titles: {
    scout:    [ { rep: 25, title: 'Runner' },       { rep: 75, title: 'Night Scout' },   { rep: 150, title: 'Ruin Walker' } ],
    engineer: [ { rep: 25, title: 'Tinkerer' },     { rep: 75, title: 'Grid Mender' },   { rep: 150, title: 'Generator Saint' } ],
    medic:    [ { rep: 25, title: 'Bandager' },     { rep: 75, title: 'Ward Keeper' },   { rep: 150, title: 'Plague Breaker' } ],
    farmer:   [ { rep: 25, title: 'Sower' },        { rep: 75, title: 'Ration Hero' },   { rep: 150, title: 'Harvest Warden' } ],
    guard:    [ { rep: 25, title: 'Watchman' },     { rep: 75, title: 'Wall Keeper' },   { rep: 150, title: 'Red Signal Veteran' } ],
    speaker:  [ { rep: 25, title: 'Crier' },        { rep: 75, title: 'Voice of Dawn' }, { rep: 150, title: 'The Conscience' } ],
  } satisfies Record<Role, { rep: number; title: string }[]>,

  // ---------- City traits (W1): per-world starting conditions ----------
  traits: {
    standard:    { label: 'Standard Dawn',      blurb: 'A typical beginning. No modifiers.' },
    frozen:      { label: 'Frozen Start',       blurb: 'Power decays 50% faster; food keeps 15% longer.' },
    crowded:     { label: 'Crowded Start',      blurb: 'A third more mouths; a third less food to start.' },
    militarized: { label: 'Militarized Start',  blurb: 'High walls, low spirits: +20 defense, -15 morale to start.' },
    sick:        { label: 'Sick Start',         blurb: 'The cough came early: half the starting medicine.' },
  } satisfies Record<CityTraitId, { label: string; blurb: string }>,
  // Start modifiers (applied once at city creation) and ongoing multipliers
  // (resolver). Cast follows the approved roleBonus precedent in this file.
  traitEffects: {
    frozen:      { powerDecayMult: 1.5, foodConsumeMult: 0.85 },
    crowded:     { startPopulationMult: 1.34, startFoodMult: 0.66 },
    militarized: { startDefenseDelta: 20, startMoraleDelta: -15 },
    sick:        { startMedicineMult: 0.5 },
  } as Partial<Record<CityTraitId, { powerDecayMult?: number; foodConsumeMult?: number; startPopulationMult?: number; startFoodMult?: number; startDefenseDelta?: number; startMoraleDelta?: number; startMedicineMult?: number }>>,

  laws: {
    builders: { id: 'builders' as const, label: 'Emergency Engineering', buff: 'Repair actions +25% power', cost: 'Morale actions cost +1 energy' },
    wardens:  { id: 'wardens'  as const, label: 'Wall Watch',            buff: 'Threat rises 25% slower',    cost: 'Food consumption +10%' },
    seekers:  { id: 'seekers'  as const, label: 'Ruins Charter',          buff: 'Expedition loot +1 per crate', cost: 'Injury risk +10%' },
    hearth:   { id: 'hearth'   as const, label: 'Common Table',           buff: 'Treat Sick +50% medicine',   cost: 'Repair actions -25% power' },
  },

  lawLifespanDays: 1,

  // ---------- World of Cities (Plan 2 — cross-subreddit via redis.global) ----------
  world: {
    // The gate: a subreddit joins the world map at this many subscribers.
    // Sub-gate communities play fully locally and are never written globally.
    minSubscribers: 500,
    // Coarse map-status thresholds (see worldStatus in src/server/game/world.ts).
    // 'strained': ANY vital at/below its floor. 'thriving': ALL vitals at/above
    // their floor AND threat at/below the ceiling.
    strained: { food: 10, power: 15, medicine: 3, morale: 20 },
    thriving: { food: 40, power: 50, medicine: 10, morale: 65, maxThreat: 40 },
  },

  raid: {
    triggerThreshold: 100,
    postRaidThreat: 40,
    populationLoss: 8,
    foodLoss: 20,
    powerLoss: 15,
    moraleLoss: 15,
    guardDampenPerAction: 3,
  },

  // A house belongs to one Redditor, but when a raid destroys it the WHOLE city
  // rebuilds it. Destroyed/damaged homes enter a shared reconstruction queue;
  // build_city labor pays it down (destroyed homes first) before any new
  // building rises. Ownership is never lost — damage is a transient overlay.
  reconstruction: {
    laborPerDestroyed: 12,
    laborPerDamaged: 5,
    // Homes struck per raid outcome: [min, max] destroyed, [min, max] damaged.
    // A fully-dampened raid (strong defense) holds with at most cosmetic damage;
    // a breach costs homes; a fall scars the city before Phoenix rebirth.
    select: {
      held: { destroy: [0, 0], damage: [0, 1] },
      breach: { destroy: [1, 3], damage: [1, 2] },
      fallen: { destroy: [3, 5], damage: [0, 2] },
    },
  },

  // The city shelters under a protective energy DOME of 6 arc segments. A raid is
  // 5-6 fireballs FALLING FROM ABOVE; each fireball's rolled power is tested
  // against the shield of the segment it strikes. power <= shield -> BLOCKED (the
  // segment loses integrity, no city damage); power > shield -> PENETRATES (a home
  // is destroyed, souls/resources lost, softened by the physical wall/guard layer).
  // Segments are CHARGED by daily-challenge completions and REPAIRED by a shared
  // shield pool that fills as the city contributes and auto-mends the weakest panel.
  dome: {
    segments: 6,
    segmentMax: 100,
    segmentStart: 60,
    chargePerChallenge: 5, // per completed daily challenge, added to one seeded segment
    shieldPerContribution: 1, // repair-pool gain per accepted contribution
    repairThreshold: 12, // pool needed to auto-repair one segment fully
    fireballs: { min: 5, max: 6 },
    power: { min: 26, max: 82 },
    blockDrain: 20, // shield a segment loses when it blocks a fireball
    perPenetration: { population: 2, food: 4, power: 3, morale: 3 },
  },
} as const;

export const DAY_ZERO_CRISIS_ID = 'first_light';
