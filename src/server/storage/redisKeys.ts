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
  timeline: 'timeline',
  cityHistory: 'city:history',
  resolverLock: 'resolver:lock',
  gameConfig: 'game:config',

  dayActions: (day: number) => `day:${day}:actions`,
  dayUserActions: (day: number) => `day:${day}:userActions`,
  dayVotes: (day: number) => `day:${day}:votes`,
  dayVoters: (day: number) => `day:${day}:voters`,
  dayMissions: (day: number) => `day:${day}:missions`,
  dayFactionInfluence: (day: number) => `day:${day}:factionInfluence`,
  dayStrategyPlan: (day: number) => `day:${day}:strategyPlan`,
  dayStrategyVoters: (day: number) => `day:${day}:strategyVoters`,
  playerFactions: (userId: string) => `player:${userId}:factions`,
} as const;
