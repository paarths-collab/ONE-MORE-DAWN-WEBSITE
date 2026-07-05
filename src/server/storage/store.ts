import type {
  ActionType, CityState, FactionId, PlayerProfile, TimelineEntry, VoteTally,
} from '../../shared/types';
import { KEYS } from './redisKeys';

/** The subset of the Devvit redis client the store uses. Tests provide a fake. */
export type RedisLike = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, options?: { nx?: boolean; expiration?: number }): Promise<string>;
  del(...keys: string[]): Promise<void>;
  expire(key: string, seconds: number): Promise<void>;
  hGet(key: string, field: string): Promise<string | undefined>;
  hSet(key: string, fieldValues: Record<string, string>): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hIncrBy(key: string, field: string, value: number): Promise<number>;
  hDel(key: string, fields: string[]): Promise<void>;
  zIncrBy(key: string, member: string, value: number): Promise<number>;
  zAdd(key: string, ...members: { member: string; score: number }[]): Promise<number>;
  zScore(key: string, member: string): Promise<number | undefined>;
  zRange(
    key: string, start: number | string, stop: number | string,
    options?: { reverse?: boolean; by?: 'rank' | 'score' | 'lex' },
  ): Promise<{ member: string; score: number }[]>;
};

const toCounts = (raw: Record<string, string>): Record<string, number> =>
  Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)]));

export class Store {
  constructor(private readonly redis: RedisLike) {}

  // ----- city -----
  async getCityState(): Promise<CityState | undefined> {
    const raw = await this.redis.get(KEYS.cityState);
    return raw ? (JSON.parse(raw) as CityState) : undefined;
  }

  async setCityState(city: CityState): Promise<void> {
    await this.redis.set(KEYS.cityState, JSON.stringify(city));
  }

  async getCityMeta(): Promise<Record<string, string>> {
    return this.redis.hGetAll(KEYS.cityMeta);
  }

  async setCityMeta(fields: Record<string, string>): Promise<void> {
    await this.redis.hSet(KEYS.cityMeta, fields);
  }

  // ----- players -----
  async getPlayer(userId: string): Promise<PlayerProfile | undefined> {
    const raw = await this.redis.hGet(KEYS.players, userId);
    if (!raw) return undefined;
    // Backfill fields added after launch: stored JSON from earlier builds lacks
    // roleRep/title — default-fill on parse so every read path sees the full shape.
    const parsed = JSON.parse(raw) as PlayerProfile;
    return { ...parsed, roleRep: parsed.roleRep ?? {}, title: parsed.title ?? null };
  }

  async savePlayer(player: PlayerProfile): Promise<void> {
    await this.redis.hSet(KEYS.players, { [player.userId]: JSON.stringify(player) });
  }

  // ----- actions -----
  async recordAction(day: number, userId: string, action: ActionType): Promise<void> {
    await this.redis.hIncrBy(KEYS.dayActions(day), action, 1);
    const raw = await this.redis.hGet(KEYS.dayUserActions(day), userId);
    const mine: Partial<Record<ActionType, number>> = raw ? JSON.parse(raw) : {};
    mine[action] = (mine[action] ?? 0) + 1;
    await this.redis.hSet(KEYS.dayUserActions(day), { [userId]: JSON.stringify(mine) });
  }

  async getDayActions(day: number): Promise<Record<string, number>> {
    return toCounts(await this.redis.hGetAll(KEYS.dayActions(day)));
  }

  async getUserActions(day: number, userId: string): Promise<Partial<Record<ActionType, number>>> {
    const raw = await this.redis.hGet(KEYS.dayUserActions(day), userId);
    return raw ? JSON.parse(raw) : {};
  }

  async getAllUserActions(
    day: number,
  ): Promise<Record<string, Partial<Record<ActionType, number>>>> {
    const raw = await this.redis.hGetAll(KEYS.dayUserActions(day));
    return Object.fromEntries(Object.entries(raw).map(([userId, json]) => [userId, JSON.parse(json)]));
  }

  // ----- votes (crisis) -----
  async recordVote(day: number, userId: string, optionId: string): Promise<void> {
    await this.redis.hSet(KEYS.dayVoters(day), { [userId]: optionId });
    await this.redis.hIncrBy(KEYS.dayVotes(day), optionId, 1);
  }

  async getVoterChoice(day: number, userId: string): Promise<string | undefined> {
    return this.redis.hGet(KEYS.dayVoters(day), userId);
  }

  async getVoteTally(day: number): Promise<VoteTally> {
    return toCounts(await this.redis.hGetAll(KEYS.dayVotes(day)));
  }

  // ----- votes (council strategy) -----
  async recordStrategyVote(day: number, userId: string, planId: string): Promise<void> {
    await this.redis.hSet(KEYS.dayStrategyVoters(day), { [userId]: planId });
    await this.redis.hIncrBy(KEYS.dayStrategyPlan(day), planId, 1);
  }

  async getStrategyChoice(day: number, userId: string): Promise<string | undefined> {
    return this.redis.hGet(KEYS.dayStrategyVoters(day), userId);
  }

  async getStrategyTally(day: number): Promise<VoteTally> {
    return toCounts(await this.redis.hGetAll(KEYS.dayStrategyPlan(day)));
  }

  // ----- faction influence (Plan 2 P2) -----
  async bumpFactionInfluence(day: number, faction: FactionId, by: number): Promise<void> {
    if (by === 0) return;
    await this.redis.hIncrBy(KEYS.dayFactionInfluence(day), faction, by);
  }

  async getFactionInfluence(day: number): Promise<Record<FactionId, number>> {
    const raw = await this.redis.hGetAll(KEYS.dayFactionInfluence(day));
    const empty: Record<FactionId, number> = { builders: 0, wardens: 0, seekers: 0, hearth: 0 };
    for (const [k, v] of Object.entries(raw)) {
      if (k in empty) empty[k as FactionId] = Number(v);
    }
    return empty;
  }

  /**
   * Bumps the player's rep on a faction. Leader is the strictly-highest faction
   * across the per-player shadow hash, with FactionId order as deterministic tie-break.
   * Returns the updated profile, or undefined if the player didn't exist.
   */
  async bumpPlayerFactionRep(
    cycle: number,
    userId: string,
    faction: FactionId,
    by: number,
  ): Promise<PlayerProfile | undefined> {
    const player = await this.getPlayer(userId);
    if (!player) return undefined;
    if (by !== 0) {
      await this.redis.hIncrBy(KEYS.playerFactions(cycle, userId), faction, by);
    }
    const repRaw = await this.redis.hGetAll(KEYS.playerFactions(cycle, userId));
    const reps: Record<FactionId, number> = { builders: 0, wardens: 0, seekers: 0, hearth: 0 };
    for (const [k, v] of Object.entries(repRaw)) {
      if (k in reps) reps[k as FactionId] = Number(v);
    }
    const order: FactionId[] = ['builders', 'wardens', 'seekers', 'hearth'];
    let leader: FactionId | null = null;
    let leaderRep = 0;
    for (const f of order) {
      if (reps[f] > leaderRep) { leader = f; leaderRep = reps[f]; }
    }
    const updated: PlayerProfile = {
      ...player,
      factionRep: leaderRep,
      faction: leader,
    };
    await this.savePlayer(updated);
    return updated;
  }

  // ----- missions -----
  async bumpDayMissions(day: number, fields: Record<string, number>): Promise<void> {
    await Promise.all(
      Object.entries(fields)
        .filter(([, by]) => by !== 0)
        .map(([field, by]) => this.redis.hIncrBy(KEYS.dayMissions(day), field, by)),
    );
  }

  async getDayMissions(day: number): Promise<Record<string, number>> {
    return toCounts(await this.redis.hGetAll(KEYS.dayMissions(day)));
  }

  // ----- leaderboards -----
  async addContribution(userId: string, amount: number): Promise<void> {
    await this.redis.zIncrBy(KEYS.lbContribution, userId, amount);
  }

  async recordScoutHaul(userId: string, haul: number): Promise<void> {
    const current = await this.redis.zScore(KEYS.lbScouts, userId);
    if (current === undefined || haul > current) {
      await this.redis.zAdd(KEYS.lbScouts, { member: userId, score: haul });
    }
  }

  /** Top-N contributors by lifetime contribution, highest score first. */
  async topContributors(limit: number): Promise<{ userId: string; score: number }[]> {
    const rows = await this.redis.zRange(KEYS.lbContribution, 0, limit - 1, {
      reverse: true,
      by: 'rank',
    });
    return rows.map((r) => ({ userId: r.member, score: r.score }));
  }

  /** Top-N scouts by best single expedition haul, highest score first. */
  async topScouts(limit: number): Promise<{ userId: string; score: number }[]> {
    const rows = await this.redis.zRange(KEYS.lbScouts, 0, limit - 1, {
      reverse: true,
      by: 'rank',
    });
    return rows.map((r) => ({ userId: r.member, score: r.score }));
  }

  // ----- timeline + history -----
  async appendTimeline(entry: TimelineEntry): Promise<void> {
    await this.redis.hSet(KEYS.timeline, { [String(entry.day)]: JSON.stringify(entry) });
  }

  async getTimeline(limit: number): Promise<TimelineEntry[]> {
    const all = await this.redis.hGetAll(KEYS.timeline);
    return Object.values(all)
      .map((raw) => JSON.parse(raw) as TimelineEntry)
      .sort((a, b) => b.day - a.day)
      .slice(0, limit);
  }

  async snapshotCity(city: CityState): Promise<void> {
    await this.redis.hSet(KEYS.cityHistory, { [String(city.day)]: JSON.stringify(city) });
  }
}
