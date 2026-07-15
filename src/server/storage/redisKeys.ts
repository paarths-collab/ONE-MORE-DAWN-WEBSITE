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
  // Raid aftermath: a house's transient damage overlay + its shared-rebuild
  // labor. The userId->index registry above is never touched; these clear on
  // reconstruction, Phoenix rebirth, and mod reset.
  housesDamage: 'houses:damage', // { [userId]: 'destroyed' | 'damaged' }
  housesRebuild: 'houses:rebuild', // { [userId]: '<labor done>' }
  // The protective energy dome: one hash with seg0..seg5 (segment shields, ints)
  // and `shield` (the shared repair pool). Charged by daily challenges, drained by
  // raids, mended by the pool. Resets with Phoenix rebirth and mod reset.
  dome: 'dome:state',
  landFunding: 'land:funding',
  landProjectLock: (projectId: string) => `land:lock:${projectId}`,
  cityTreasury: 'city:treasury',
  treasuryLock: 'city:treasury:lock',
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
  // Per-role daily-duty completion claim (NX + TTL), mirrored on challengeDone:
  // cycle-scoped so a mod reset can't leak last cycle's claim into the new one.
  roleTaskDone: (cycle: number, day: number, userId: string) =>
    `roletask:${cycle}:${day}:${userId}`,

  // "Reconnect the City" daily puzzle. `puzzleProgress` is a per-user hash
  // (levelId -> JSON PuzzleScore) holding the LIFETIME best on each level — a
  // personal record that, like the contribution leaderboard, survives Phoenix
  // rebirth and clears only on a full mod reset. `puzzleDaily` is a date-keyed
  // zset (member=userId, score=fewest moves) for today's shared board.
  // `puzzleClaim` is the NX gate that grants the city reward at most once per
  // player per daily.
  puzzleProgress: (userId: string) => `puzzle:progress:${userId}`,
  puzzleDaily: (dailyId: string) => `puzzle:daily:${dailyId}`,
  puzzleClaim: (dailyId: string, userId: string) => `puzzle:claim:${dailyId}:${userId}`,
  chatterMeta: 'chatter:meta',
  chatterRoots: 'chatter:roots',
  chatterProvisionLock: (weekKey: string) => `chatter:provision:${weekKey}`,
  chatterCooldown: (userId: string) => `chatter:cooldown:${userId}`,
  chatterDuplicate: (userId: string, fingerprint: number) => `chatter:duplicate:${userId}:${fingerprint}`,
} as const;
