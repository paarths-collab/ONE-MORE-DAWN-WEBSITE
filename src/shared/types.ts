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

// ---------- Persistent state ----------

export type CityState = {
  day: number;
  cycle: number;
  status: CityStatus;
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

// ---------- API payloads ----------

export type ApiError = { status: 'error'; message: string };

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
};

export type RoleRequest = { role: Role };
export type RoleResponse = { type: 'role'; player: PlayerProfile };

export type ActionRequest = { action: ActionType };
export type ActionResponse = {
  type: 'action';
  player: PlayerProfile;
  effectiveEnergy: number;
  yourActionsToday: Partial<Record<ActionType, number>>;
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
};

export type TimelineResponse = { type: 'timeline'; entries: TimelineEntry[] };

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
