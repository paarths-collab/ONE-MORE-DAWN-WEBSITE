import type {
  ActionType, CityState, FactionId, PledgeKind, PlayerProfile, TimelineEntry, VoteTally,
} from '../../shared/types';
import { isPledgeKind, type PledgerEntry } from '../game/pledges';
import { freshSegments, normalizeSegments } from '../game/dome';
import { isChallenge, type Challenge } from '../../shared/challenges';
import {
  landExpansionState,
  normalizeEconomyFields,
  type LandExpansionState,
} from '../../shared/shop';
import {
  normalizeTreasuryFields,
  treasuryStateOf,
  type TreasuryState,
} from '../../shared/treasury';
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

const safeParse = <T>(raw: string | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

// safeParse only rejects INVALID JSON. These guards reject valid JSON of the
// wrong shape ("7", "\"hello\"", foreign blobs) so a corrupt Redis value can
// never impersonate game state — it degrades to the same fallback as missing
// data instead of crashing every route that reads it.
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isCityStateShape = (v: unknown): v is CityState =>
  isRecord(v) &&
  typeof v.day === 'number' &&
  typeof v.cycle === 'number' &&
  typeof v.status === 'string' &&
  typeof v.population === 'number' &&
  typeof v.crisisId === 'string';

const isPlayerShape = (v: unknown): v is PlayerProfile =>
  isRecord(v) &&
  typeof v.userId === 'string' &&
  typeof v.username === 'string' &&
  typeof v.energyUsedToday === 'number' &&
  typeof v.lastActiveDay === 'number' &&
  typeof v.totalContribution === 'number' &&
  typeof v.streak === 'number';

const isActionCounts = (v: unknown): v is Partial<Record<ActionType, number>> =>
  isRecord(v) && Object.values(v).every((n) => typeof n === 'number');

const isPledgerShape = (v: unknown): v is PledgerEntry =>
  isRecord(v) &&
  isPledgeKind(v.kind) &&
  typeof v.name === 'string' &&
  typeof v.at === 'number' &&
  typeof v.contribution === 'number';

const isMarkedOutcomeShape = (v: unknown): v is { name: string; saved: boolean } =>
  isRecord(v) && typeof v.name === 'string' && typeof v.saved === 'boolean';

const isTimelineShape = (v: unknown): v is TimelineEntry =>
  isRecord(v) &&
  typeof v.day === 'number' &&
  typeof v.cycle === 'number' &&
  typeof v.headline === 'string' &&
  Array.isArray(v.events) &&
  isRecord(v.deltas);

export class Store {
  constructor(private readonly redis: RedisLike) {}

  private async normalizedHouseRows(): Promise<{ userId: string; index: number }[]> {
    const raw = await this.redis.hGetAll(KEYS.housesIndex);
    const rows = Object.entries(raw)
      .map(([userId, value]) => ({ userId, rawIndex: Number(value) }))
      .filter((row) => Number.isFinite(row.rawIndex) && row.rawIndex >= 0)
      .sort((a, b) => a.rawIndex - b.rawIndex || a.userId.localeCompare(b.userId));
    return rows.map((row, index) => ({ userId: row.userId, index }));
  }

  // ----- city -----
  async getCityState(): Promise<CityState | undefined> {
    const raw = await this.redis.get(KEYS.cityState);
    if (!raw) return undefined;
    // Backfill fields added after launch (same pattern as the player roleRep
    // backfill below): pre-W1 cities lack worldSeed/trait — default to the
    // neutral world so every read path sees the full shape.
    const parsed = safeParse<unknown>(raw, null);
    if (!isCityStateShape(parsed)) return undefined;
    // Pre-progression cities lack the build-from-zero fields — default them to
    // an empty Camp so old saves never crash and resolve identically to before.
    return {
      ...parsed,
      worldSeed: parsed.worldSeed ?? 0,
      trait: parsed.trait ?? 'standard',
      cityLevel: parsed.cityLevel ?? 0,
      buildProgress: parsed.buildProgress ?? 0,
      unlockedBuildings: parsed.unlockedBuildings ?? [],
    };
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
  /**
   * Backfill fields added after launch: stored JSON from earlier builds lacks
   * roleRep/title — default-fill on parse so every read path sees the full
   * shape. The ONE place legacy player JSON gets normalized.
   */
  private revivePlayer(parsed: PlayerProfile): PlayerProfile {
    return {
      ...parsed,
      roleRep: parsed.roleRep ?? {},
      title: parsed.title ?? null,
      avatar: parsed.avatar ?? null,
      ...normalizeEconomyFields(parsed),
      ...normalizeTreasuryFields(parsed),
    };
  }

  async getPlayer(userId: string): Promise<PlayerProfile | undefined> {
    const raw = await this.redis.hGet(KEYS.players, userId);
    if (!raw) return undefined;
    const parsed = safeParse<unknown>(raw, null);
    return isPlayerShape(parsed) ? this.revivePlayer(parsed) : undefined;
  }

  async getAllPlayers(): Promise<PlayerProfile[]> {
    const raw = await this.redis.hGetAll(KEYS.players);
    return Object.values(raw)
      .map((j) => safeParse<unknown>(j, null))
      .filter(isPlayerShape)
      .map((p) => this.revivePlayer(p));
  }

  async savePlayer(player: PlayerProfile): Promise<void> {
    await this.redis.hSet(KEYS.players, { [player.userId]: JSON.stringify(player) });
  }

  async savePlayers(players: PlayerProfile[]): Promise<void> {
    if (players.length === 0) return;
    await this.redis.hSet(
      KEYS.players,
      Object.fromEntries(players.map((player) => [player.userId, JSON.stringify(player)])),
    );
  }

  // ----- actions -----
  async recordAction(day: number, userId: string, action: ActionType): Promise<void> {
    await this.redis.hIncrBy(KEYS.dayActions(day), action, 1);
    const mine = await this.getUserActions(day, userId);
    mine[action] = (mine[action] ?? 0) + 1;
    await this.redis.hSet(KEYS.dayUserActions(day), { [userId]: JSON.stringify(mine) });
  }

  async getDayActions(day: number): Promise<Record<string, number>> {
    return toCounts(await this.redis.hGetAll(KEYS.dayActions(day)));
  }

  async getUserActions(day: number, userId: string): Promise<Partial<Record<ActionType, number>>> {
    const raw = await this.redis.hGet(KEYS.dayUserActions(day), userId);
    const parsed = safeParse<unknown>(raw, null);
    return isActionCounts(parsed) ? parsed : {};
  }

  async getAllUserActions(
    day: number,
  ): Promise<Record<string, Partial<Record<ActionType, number>>>> {
    const raw = await this.redis.hGetAll(KEYS.dayUserActions(day));
    const entries: [string, Partial<Record<ActionType, number>>][] = [];
    for (const [userId, json] of Object.entries(raw)) {
      const parsed = safeParse<unknown>(json, null);
      if (isActionCounts(parsed)) entries.push([userId, parsed]);
    }
    return Object.fromEntries(entries);
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

  // ----- The Marked + one-tap pledges (hook layer) -----
  /** 'pledged' counter and per-kind tap counts share the day's marked hash. */
  async bumpMarkedPledge(day: number, by: number): Promise<void> {
    if (by === 0) return;
    await this.redis.hIncrBy(KEYS.dayMarked(day), 'pledged', by);
  }

  async getMarkedPledge(day: number): Promise<number> {
    return Number((await this.redis.hGet(KEYS.dayMarked(day), 'pledged')) ?? '0');
  }

  async bumpPledgeKind(day: number, kind: PledgeKind): Promise<void> {
    await this.redis.hIncrBy(KEYS.dayMarked(day), kind, 1);
  }

  async getPledgeKindCounts(day: number): Promise<Partial<Record<PledgeKind, number>>> {
    const raw = await this.redis.hGetAll(KEYS.dayMarked(day));
    const out: Partial<Record<PledgeKind, number>> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (isPledgeKind(k)) out[k] = Number(v);
    }
    return out;
  }

  async recordPledger(day: number, userId: string, entry: PledgerEntry): Promise<void> {
    await this.redis.hSet(KEYS.dayPledgers(day), { [userId]: JSON.stringify(entry) });
  }

  async getPledger(day: number, userId: string): Promise<PledgerEntry | undefined> {
    const raw = await this.redis.hGet(KEYS.dayPledgers(day), userId);
    const parsed = safeParse<unknown>(raw, null);
    return isPledgerShape(parsed) ? parsed : undefined;
  }

  async getPledgers(day: number): Promise<Record<string, PledgerEntry>> {
    const raw = await this.redis.hGetAll(KEYS.dayPledgers(day));
    const entries: [string, PledgerEntry][] = [];
    for (const [userId, json] of Object.entries(raw)) {
      const parsed = safeParse<unknown>(json, null);
      if (isPledgerShape(parsed)) entries.push([userId, parsed]);
    }
    return Object.fromEntries(entries);
  }

  /** Dawn verdict for a resolved day — next day's `savedYesterday` reads it. */
  async setMarkedOutcome(day: number, outcome: { name: string; saved: boolean }): Promise<void> {
    await this.redis.hSet(KEYS.markedOutcomes, { [String(day)]: JSON.stringify(outcome) });
  }

  async getMarkedOutcome(day: number): Promise<{ name: string; saved: boolean } | null> {
    const raw = await this.redis.hGet(KEYS.markedOutcomes, String(day));
    const parsed = safeParse<unknown>(raw, null);
    return isMarkedOutcomeShape(parsed) ? parsed : null;
  }

  /** Marked saved THIS cycle (markedOutcomes is deleted on mod reset), for the
   *  World of Cities registry record. */
  async countMarkedSaved(): Promise<number> {
    const raw = await this.redis.hGetAll(KEYS.markedOutcomes);
    return Object.values(raw)
      .map((j) => safeParse<unknown>(j, null))
      .filter((outcome) => isMarkedOutcomeShape(outcome) && outcome.saved).length;
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

  async getContributionScore(userId: string): Promise<number | undefined> {
    return this.redis.zScore(KEYS.lbContribution, userId);
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

  /**
   * 1-based contribution rank (zRevRank-style via zRange — RedisLike exposes no
   * rank op). Null when the member has never contributed.
   */
  async getContributionRank(userId: string): Promise<number | null> {
    const rows = await this.redis.zRange(KEYS.lbContribution, 0, -1, {
      reverse: true,
      by: 'rank',
    });
    const idx = rows.findIndex((r) => r.member === userId);
    return idx === -1 ? null : idx + 1;
  }

  // ----- connected community land -----
  async getLandExpansionState(): Promise<LandExpansionState> {
    const raw = await this.redis.hGetAll(KEYS.landFunding);
    const funding: Record<string, unknown> = {};
    for (const [projectId, value] of Object.entries(raw)) {
      const amount = Number(value);
      funding[projectId] = Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
    }
    return landExpansionState(funding);
  }

  // ----- shared city treasury -----
  async getTreasuryState(player: PlayerProfile): Promise<TreasuryState> {
    const raw = await this.redis.hGetAll(KEYS.cityTreasury);
    return treasuryStateOf(player, raw);
  }

  // ----- personal houses -----
  /** Register the caller's house on their FIRST contribution. Idempotent: a user
   *  who already has a house keeps their original index. Returns their join index. */
  async registerHouse(userId: string): Promise<{ index: number; isNew: boolean }> {
    const existing = await this.redis.hGet(KEYS.housesIndex, userId);
    const existingIndex = Number(existing);
    if (existing !== undefined && Number.isFinite(existingIndex) && existingIndex >= 0) {
      return { index: (await this.getHouseIndex(userId)) ?? existingIndex, isNew: false };
    }
    // hIncrBy is atomic -> distinct index per new user. Read paths compact the
    // hash order, so a stale/corrupt seq or rare same-user race cannot inflate
    // the visible house total.
    const seq = await this.redis.hIncrBy(KEYS.housesMeta, 'seq', 1); // 1-based
    const index = seq - 1;
    await this.redis.hSet(KEYS.housesIndex, { [userId]: String(index) });
    if (index === 0) await this.redis.hSet(KEYS.housesMeta, { founder: userId });
    return { index: (await this.getHouseIndex(userId)) ?? index, isNew: true };
  }

  async getHouseCount(): Promise<number> {
    return (await this.normalizedHouseRows()).length;
  }

  async getHouseIndex(userId: string): Promise<number | null> {
    const row = (await this.normalizedHouseRows()).find((h) => h.userId === userId);
    return row?.index ?? null;
  }

  async getFounderId(): Promise<string | null> {
    const founder = await this.redis.hGet(KEYS.housesMeta, 'founder');
    if (founder && (await this.getHouseIndex(founder)) !== null) return founder;
    return (await this.normalizedHouseRows())[0]?.userId ?? null;
  }

  /** Compacted userId->index rows (public view of the registry). */
  async getHouseRows(): Promise<{ userId: string; index: number }[]> {
    return this.normalizedHouseRows();
  }

  // ----- raid damage + shared reconstruction -----
  async getHouseDamage(): Promise<Record<string, 'destroyed' | 'damaged'>> {
    const raw = await this.redis.hGetAll(KEYS.housesDamage);
    const out: Record<string, 'destroyed' | 'damaged'> = {};
    for (const [userId, v] of Object.entries(raw)) {
      if (v === 'destroyed' || v === 'damaged') out[userId] = v;
    }
    return out;
  }

  /** Stamp the raid's struck homes (destroyed/damaged), a one-time write. */
  async setHouseDamage(entries: Record<string, 'destroyed' | 'damaged'>): Promise<void> {
    if (Object.keys(entries).length === 0) return;
    await this.redis.hSet(KEYS.housesDamage, entries);
  }

  async getRebuildProgress(): Promise<Record<string, number>> {
    const raw = await this.redis.hGetAll(KEYS.housesRebuild);
    const out: Record<string, number> = {};
    for (const [userId, v] of Object.entries(raw)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[userId] = n;
    }
    return out;
  }

  // ----- energy dome -----
  private parseDomeSegments(raw: Record<string, string>): number[] {
    const arr: (number | undefined)[] = [];
    let hasSeg = false;
    for (const [k, v] of Object.entries(raw)) {
      const m = /^seg(\d+)$/.exec(k);
      if (!m) continue;
      hasSeg = true;
      arr[Number(m[1])] = Number(v);
    }
    return hasSeg ? normalizeSegments(arr) : freshSegments();
  }

  /** The dome's segment shields, normalized to [0, max]. Fresh if never written. */
  async getDomeSegments(): Promise<number[]> {
    return this.parseDomeSegments(await this.redis.hGetAll(KEYS.dome));
  }

  /** The full dome state: normalized segments + the shared repair pool. */
  async getDomeState(): Promise<{ segments: number[]; shield: number }> {
    const raw = await this.redis.hGetAll(KEYS.dome);
    const shieldN = Number(raw['shield']);
    const shield = Number.isFinite(shieldN) && shieldN > 0 ? Math.floor(shieldN) : 0;
    return { segments: this.parseDomeSegments(raw), shield };
  }

  /** Overwrite the segment shields (raid drain, mod reset). */
  async setDomeSegments(segments: number[]): Promise<void> {
    const norm = normalizeSegments(segments);
    const fields: Record<string, string> = {};
    for (let i = 0; i < norm.length; i++) fields[`seg${i}`] = String(norm[i]);
    await this.redis.hSet(KEYS.dome, fields);
  }

  /** Write segments AND the pool together (used by the auto-repair settle). */
  async setDomeState(segments: number[], shield: number): Promise<void> {
    const norm = normalizeSegments(segments);
    const fields: Record<string, string> = { shield: String(Math.max(0, Math.floor(shield))) };
    for (let i = 0; i < norm.length; i++) fields[`seg${i}`] = String(norm[i]);
    await this.redis.hSet(KEYS.dome, fields);
  }

  /** Reset the dome to fresh shields and an empty repair pool (rebirth / reset). */
  async resetDome(): Promise<void> {
    await this.setDomeState(freshSegments(), 0);
  }

  /** Add to the shared repair pool (per accepted contribution). Returns the new pool. */
  async addDomeShield(n: number): Promise<number> {
    return this.redis.hIncrBy(KEYS.dome, 'shield', Math.max(0, Math.floor(n)));
  }

  /** Reinforce one segment (a completed daily challenge). Over-charge is clamped on read. */
  async chargeDomeSegment(index: number, n: number): Promise<void> {
    if (!Number.isInteger(index) || index < 0 || index >= freshSegments().length) return;
    await this.redis.hIncrBy(KEYS.dome, `seg${index}`, Math.max(0, Math.floor(n)));
  }

  // ----- timeline + history -----
  async appendTimeline(entry: TimelineEntry): Promise<void> {
    await this.redis.hSet(KEYS.timeline, {
      [`${entry.cycle}:${entry.day}`]: JSON.stringify(entry),
    });
  }

  async getDailyChallenge(cycle: number, day: number, userId: string): Promise<Challenge | null> {
    const raw = await this.redis.hGet(KEYS.dayChallenges(cycle, day), userId);
    const parsed = safeParse<unknown>(raw, null);
    return isChallenge(parsed) ? parsed : null;
  }

  async setDailyChallenge(cycle: number, day: number, userId: string, challenge: Challenge): Promise<void> {
    await this.redis.hSet(KEYS.dayChallenges(cycle, day), {
      [userId]: JSON.stringify(challenge),
    });
  }

  async getTimeline(limit: number): Promise<TimelineEntry[]> {
    const all = await this.redis.hGetAll(KEYS.timeline);
    return Object.values(all)
      .map((raw) => safeParse<unknown>(raw, null))
      .filter(isTimelineShape)
      .sort((a, b) => b.cycle - a.cycle || b.day - a.day)
      .slice(0, limit);
  }

  async snapshotCity(city: CityState): Promise<void> {
    await this.redis.hSet(KEYS.cityHistory, { [String(city.day)]: JSON.stringify(city) });
  }
}
