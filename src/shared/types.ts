// ---------- Core enums ----------

export type Role = 'scout' | 'engineer' | 'medic' | 'farmer' | 'guard' | 'speaker';

export type ActionType = 'grow_food' | 'repair_power' | 'treat_sick' | 'guard_wall';

export type StrategyPlanId =
  | 'stockpile_food'
  | 'repair_power'
  | 'prepare_raid'
  | 'send_scouts'
  | 'treat_sick';

export type CityStatus = 'alive' | 'fallen';

// Factions exist in types from day one so Plan 2 adds no migration.
export type FactionId = 'builders' | 'wardens' | 'seekers' | 'hearth';

// Per-city starting trait, rolled deterministically from (worldSeed, cycle).
export type CityTraitId = 'standard' | 'frozen' | 'crowded' | 'militarized' | 'sick';

// ---------- Persistent state ----------

export type CityState = {
  day: number;
  cycle: number;
  status: CityStatus;
  /** Per-installation seed (hash of subredditId); 0 = neutral/test world. */
  worldSeed: number;
  trait: CityTraitId;
  population: number;
  food: number;
  power: number; // 0..100 (%)
  medicine: number;
  morale: number; // 0..100
  threat: number; // 0..100
  defense: number; // 0..100
  crisisId: string;
  activeLaw: string | null; // Plan 2; null in slice
  lawExpiresDay: number; // Plan 2; 0 in slice
};

export type PlayerProfile = {
  userId: string;
  username: string;
  role: Role | null;
  roleChangedDay: number;
  faction: FactionId | null; // Plan 2; derived, null in slice
  factionRep: number; // Plan 2; 0 in slice
  roleRep: Partial<Record<Role, number>>; // lifetime rep per role (reward layer)
  title: string | null; // derived from the CURRENT role's rep tier
  energyUsedToday: number;
  lastActiveDay: number;
  injuredUntilDay: number; // player is injured while city.day <= injuredUntilDay
  totalContribution: number;
  streak: number;
};

// ---------- Crises ----------

export type ResourceDelta = Partial<
  Pick<CityState, 'population' | 'food' | 'power' | 'medicine' | 'morale' | 'threat' | 'defense'>
>;

export type CrisisOption = {
  id: string; // 'a' | 'b' | 'c'
  label: string;
  description: string;
  effects: ResourceDelta;
};

export type Crisis = {
  id: string;
  title: string;
  narrative: string;
  options: CrisisOption[];
  // gating: crisis only enters the pool when predicate over city state passes
  minDay?: number;
  requires?: { maxFood?: number; maxPower?: number; maxMorale?: number; minThreat?: number };
};

// ---------- Timeline ----------

export type TimelineEntry = {
  day: number;
  cycle: number;
  headline: string;
  events: string[]; // human-readable lines
  deltas: ResourceDelta;
  crisisId: string;
  winningOptionId: string | null;
};

// ---------- Mission ----------

export type MissionRoute = 'safe' | 'deep' | 'desperate';

export type TileKind = 'floor' | 'wall' | 'exit' | 'spawn';

export type CrateSpot = {
  id: string; // 'c0'..'cN', stable per layout
  x: number;
  y: number;
  depth: number; // BFS distance from exit
};

export type HazardSpot = { x: number; y: number };

export type MissionMap = {
  width: number; // 14
  height: number; // 9
  tiles: TileKind[][]; // [y][x]
  spawn: { x: number; y: number };
  exit: { x: number; y: number };
  crates: CrateSpot[];
  hazards: HazardSpot[];
};

export type LootKind = 'food' | 'medicine' | 'scrap';

export type CrateContents = { crateId: string; loot: Partial<Record<LootKind, number>> };

export type MissionStatus = 'escaped' | 'timeout' | 'hazard';

// ---------- Dawn report (reward/retention layer) ----------

export type DawnReport = {
  day: number;                 // the resolved day the report describes (yesterday)
  citySummary: string[];       // yesterday's timeline events (max 5)
  yourImpact: string[];        // personalized lines (may be empty)
  title: string | null;        // player's current title
};

// ---------- API payloads ----------

export type ApiError = { status: 'error'; message: string };

export type Forecast = {
  food: number; power: number; medicine: number; morale: number; threat: number;
  raidLikely: boolean;
};

export type VoteTally = Record<string, number>; // optionId/planId -> count

export type InitResponse = {
  type: 'init';
  postId: string;
  city: CityState;
  player: PlayerProfile;
  effectiveEnergy: number; // dailyEnergy minus injury penalty; derived, never stored
  crisis: Crisis;
  crisisVotes: VoteTally;
  yourCrisisVote: string | null;
  strategyVotes: VoteTally;
  yourStrategyVote: string | null;
  yourActionsToday: Partial<Record<ActionType, number>>;
  missionUsedToday: boolean;
  resolving: boolean; // true when another request holds the resolver lock
  timelinePreview: TimelineEntry | null; // yesterday's entry, for "what changed"
  activeLaw: LawDef | null;
  raidInDays: number;
  factionInfluence: Record<FactionId, number>;
  yourFaction: FactionId | null;
  yourFactionRep: number;
  dawnReport: DawnReport | null;
  firstVisitToday: boolean;
  forecast: Forecast;
  trait: { id: CityTraitId; label: string; blurb: string };
  // ---- Reddit-native hook layer (Plan 1) ----
  marked: Marked;
  pledge: PledgeInfo;
  drama: DramaEvent[];
  standing: Standing;
};

// ========== Reddit-native hook layer (2026-07-06 locked direction) ==========

/** The daily shared objective the city rallies to save before dawn. Not a real
 *  user, not permadeath of a player — a named person/place/symbol. */
export type Marked = {
  id: string;
  name: string; // "Mira, the greenhouse child" / "The North Wall"
  kind: 'person' | 'place' | 'symbol';
  blurb: string; // one line of stakes
  goal: number; // pledged "resolve" needed to save it
  pledged: number; // pledged so far today
  unit: string; // display unit, e.g. "resolve"
  savedYesterday: { name: string; saved: boolean } | null;
};

export type PledgeKind = 'stand_vigil' | 'share_rations' | 'run_messages' | 'back_council';

export type PledgeOption = { id: PledgeKind; label: string; icon: string; effect: string };

export type PledgeLedger = { topHelpers: string[]; recent: string[]; mine: number };

/** One-tap, one-per-day, low/no-energy contribution — the lurker path. */
export type PledgeInfo = {
  options: PledgeOption[];
  usedToday: boolean;
  ledger: PledgeLedger;
};

/** An event in the Live Drama Feed (generated from game events; no realtime). */
export type DramaEvent = {
  icon: string;
  text: string;
  kind: 'action' | 'raid' | 'law' | 'marked' | 'city' | 'crisis';
};

/** Status/standing surfaced across screens (the "status spine"). */
export type Standing = {
  survivalDays: number; // how long THIS city has survived
  rankLabel: string; // Plan 1: within-sub framing / "rank coming"; Plan 2: "#7 of 42 cities"
  contributionRank: number | null; // your rank among this city's citizens
};

export type PledgeRequest = { kind: PledgeKind };
export type PledgeResponse = {
  type: 'pledge';
  marked: Marked;
  pledge: PledgeInfo;
  player: PlayerProfile;
};

// ========== World of Cities (Plan 2 — cross-subreddit) ==========

/** Coarse status shown on the world map. */
export type CityStatusTag = 'thriving' | 'holding' | 'strained' | 'under_raid' | 'fallen';

/** One subreddit-city as it appears on the world map. Sourced from the
 *  cross-installation global registry (redis.global). */
export type WorldCity = {
  subreddit: string; // "r/meadowbrook"
  cycle: number;
  day: number;
  survivalDays: number; // headline ranking stat
  status: CityStatusTag;
  threat: number; // 0..100
  population: number;
  savedCount: number; // Marked saved this cycle (tribal bragging right)
  activePlayers: number; // active in last 24h (liveliness)
  isYou: boolean; // this is the caller's own city
};

/** GET /api/world — the ranked map of participating subreddit-cities. */
export type WorldResponse = {
  type: 'world';
  cities: WorldCity[]; // ranked (longest-surviving first by default)
  yourRank: number | null; // your city's rank among participants (null if not eligible/registered)
  totalCities: number;
  eligible: boolean; // is THIS subreddit >= minSubscribers (i.e. does it join the world)
  subscribers: number | null; // this sub's subscriber count (null if unknown)
  minSubscribers: number; // the gate (e.g. 500)
};

export type RoleRequest = { role: Role };
export type RoleResponse = { type: 'role'; player: PlayerProfile };

export type ActionRequest = { action: ActionType };
export type ActionResponse = {
  type: 'action';
  player: PlayerProfile;
  effectiveEnergy: number;
  yourActionsToday: Partial<Record<ActionType, number>>;
  unlockedTitle: string | null;
};

export type VoteRequest = { optionId: string };
export type VoteResponse = { type: 'vote'; crisisVotes: VoteTally; yourCrisisVote: string };

export type StrategyRequest = { planId: StrategyPlanId };
export type StrategyResponse = {
  type: 'strategy';
  strategyVotes: VoteTally;
  yourStrategyVote: StrategyPlanId;
};

export type MissionStartResponse = {
  type: 'mission-start';
  tokenId: string;
  layoutSeed: number;
  lootSeed: number;
  airSeconds: number; // role-adjusted
  route: MissionRoute;
  player: PlayerProfile;
  effectiveEnergy: number;
};

export type MissionCompleteRequest = {
  tokenId: string;
  status: MissionStatus;
  collectedCrateIds: string[];
  clientDurationMs: number;
};

export type MissionCompleteResponse = {
  type: 'mission-complete';
  banked: Partial<Record<LootKind, number>>;
  injured: boolean;
  contributionGained: number;
  player: PlayerProfile;
  unlockedTitle: string | null;
};

export type TimelineResponse = { type: 'timeline'; entries: TimelineEntry[] };

// ---------- Pixel Village (GET /api/village) ----------

export type VillageZone = { id: ActionType; name: string; count: number };

export type Villager = {
  maskedName: string; // e.g. "ali•••"
  role: Role | null;
  faction: FactionId | null;
  color: number; // stable per user, for the avatar body
  online: boolean; // acted today
  since: string; // "day N" (lastActiveDay)
};

export type VillageResponse = {
  type: 'village';
  villageName: string; // "THE LAST CITY"
  subreddit: string; // from context.subredditName
  cycle: number;
  day: number;
  status: CityStatus;
  prosperity: number; // city.morale
  pills: { food: number; power: number; medicine: number; threat: number };
  raidInDays: number;
  activeLawLabel: string | null;
  zones: VillageZone[]; // one per ActionType, with today's tally
  villagers: Villager[]; // up to ~20, online first
  onlineCount: number;
  totalCount: number;
  notices: string[]; // recent timeline event lines (up to 5)
};

// ---------- Factions & laws (Plan 2) ----------

export type LawDef = {
  id: FactionId;
  label: string;
  buff: string;
  cost: string;
};

export type LeaderboardEntry = { userId: string; username: string; score: number };

export type LeaderboardResponse = {
  type: 'leaderboard';
  contributors: LeaderboardEntry[];
  scouts: LeaderboardEntry[];
  factions: Record<FactionId, { rep: number; standing: number }>;
};
