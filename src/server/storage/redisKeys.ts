// Every Redis key used by the app. Devvit Redis cannot enumerate keys,
// so all collections live under these stable names (see spec §2).
export const KEYS = {
  cityState: 'city:state',
  cityMeta: 'city:meta',
  players: 'players',
  // Per-token key with TTL (plan deviation 5): hash fields cannot expire.
  missionToken: (tokenId: string) => `mission:token:${tokenId}`,
  lbContribution: 'lb:contribution',
  lbScouts: 'lb:scouts',
  housesIndex: 'houses:index',
  housesMeta: 'houses:meta',
  timeline: 'timeline',
  cityHistory: 'city:history',
  resolverLock: 'resolver:lock',
  gameConfig: 'game:config',
  // Hook layer: dawn outcomes of the daily Marked, keyed by day (like timeline).
  markedOutcomes: 'marked:outcomes',
  // Per-USER optimistic-lock counter. Energy-spend writes (action / mission
  // start) watch THIS key, not the shared `players` hash, so two different
  // users acting at once never abort each other — only a genuine same-user
  // double-tap conflicts. Bumped inside the transaction (see beginUserLock).
  playerLock: (userId: string) => `player:lock:${userId}`,

  dayActions: (day: number) => `day:${day}:actions`,
  dayUserActions: (day: number) => `day:${day}:userActions`,
  dayVotes: (day: number) => `day:${day}:votes`,
  dayVoters: (day: number) => `day:${day}:voters`,
  dayMissions: (day: number) => `day:${day}:missions`,
  dayFactionInfluence: (day: number) => `day:${day}:factionInfluence`,
  dayStrategyPlan: (day: number) => `day:${day}:strategyPlan`,
  dayStrategyVoters: (day: number) => `day:${day}:strategyVoters`,
  // Hook layer: 'pledged' counter + per-kind tap counts in one hash; the
  // pledgers hash doubles as the one-pledge-per-day lock (watch target).
  dayMarked: (day: number) => `day:${day}:marked`,
  dayPledgers: (day: number) => `day:${day}:pledgers`,
  dayChallenges: (cycle: number, day: number) => `cycle:${cycle}:day:${day}:challenges`,
  // Cycle-namespaced so a mod reset (which can't enumerate per-player keys)
  // doesn't resurrect last cycle's faction rep for returning players.
  playerFactions: (cycle: number, userId: string) => `player:${cycle}:${userId}:factions`,
  // Daily-mission completion claim (NX + TTL): cycle-scoped like playerFactions
  // so a reset can never leak last cycle's claims into the new one.
  challengeDone: (cycle: number, day: number, userId: string) =>
    `challenge:${cycle}:${day}:${userId}`,
} as const;
