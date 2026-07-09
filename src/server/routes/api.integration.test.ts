import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../shared/balance';
import { tierForContribution } from '../../shared/houses';
import { generateMap, rollCrateContents } from '../../shared/mapgen';
import { deriveLayoutSeed, hashString } from '../../shared/rng';
import type { CityState, Marked, PlayerProfile } from '../../shared/types';
import { validateAction, validateRoleChange } from '../game/actionRules';
import { freshPlayer, loadOrCreatePlayer, resetPlayerForDay } from '../game/dayLogic';
import { buildDrama } from '../game/drama';
import { runLazyResolution } from '../game/lazyResolve';
import { pickMarked } from '../game/marked';
import { evaluateMission, type MissionToken } from '../game/missionRules';
import { buildPledgeInfo } from '../game/pledges';
import { newCityState, resolveDay, type DayInputs } from '../game/resolver';
import { buildStanding } from '../game/standing';
import { Store } from '../storage/store';
import { makeFakeRedis } from '../storage/store.test';

/** Empty DayInputs so each scenario only sets the fields it exercises. */
const noInputs = (): DayInputs => ({
  actions: {},
  missions: {},
  crisisVotes: {},
  strategyVotes: {},
  roleCounts: {},
  activeUserCount: 0,
  factionInfluence: {},
  markedPledged: 0,
  pledges: {},
  markedActivePlayers: 0,
});

/**
 * Vertical slice integration — exercises store + pure game logic end-to-end
 * against an in-memory fake redis. Does NOT invoke Hono routes (those need
 * the Devvit runtime). Proves the day loop composes correctly.
 */
describe('vertical slice', () => {
  it('runs one full city day and rolls into day 2', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);

    const day1 = new Date('2026-07-05T09:00:00Z');
    const day2 = new Date('2026-07-06T09:00:00Z');

    // Per-installation world seed (W1): mirrors hashString(subredditId) in /init.
    const worldSeed = hashString('t5_slice');

    // 1. First init creates the city on day 1, stamped with the world seed.
    const first = await runLazyResolution(store, redis, day1, worldSeed);
    expect(first.city.day).toBe(1);
    expect(first.city.status).toBe('alive');
    expect(first.resolving).toBe(false);
    expect(first.city.crisisId).toBe('first_light');
    expect(first.city.worldSeed).toBe(worldSeed);

    // 1a. Same-day repeat is a no-op — idempotent.
    const firstAgain = await runLazyResolution(store, redis, day1, worldSeed);
    expect(firstAgain.city).toEqual(first.city);

    // 2. Create Alice and set her role to farmer (first pick is free).
    let alice: PlayerProfile = freshPlayer('t2_alice', 'alice', first.city.day);
    alice = resetPlayerForDay(alice, first.city.day); // same-day no-op
    expect(alice.energyUsedToday).toBe(0);

    expect(validateRoleChange(alice, first.city.day, 'farmer')).toBeNull();
    alice = { ...alice, role: 'farmer', roleChangedDay: first.city.day };
    await store.savePlayer(alice);

    // 3. Alice grows food twice — validate + save + record for each action.
    for (let i = 0; i < 2; i++) {
      expect(validateAction(alice, first.city.day, 'grow_food')).toBeNull();
      alice = { ...alice, energyUsedToday: alice.energyUsedToday + 1 };
      await store.savePlayer(alice);
      await store.recordAction(first.city.day, alice.userId, 'grow_food');
    }
    expect(await store.getDayActions(first.city.day)).toEqual({ grow_food: 2 });

    // 4. Mission: deterministic token → server-side evaluation. Layout seed is
    // salted by the city's worldSeed (W1) — mirrors /mission/start.
    const layoutSeed = deriveLayoutSeed(first.city.worldSeed, first.city.cycle, first.city.day);
    const lootSeed = hashString(`${layoutSeed}-${alice.userId}`);
    const startedAt = 1_000_000;
    const token: MissionToken = {
      tokenId: `${alice.userId}-${first.city.day}-${startedAt}`,
      userId: alice.userId,
      day: first.city.day,
      layoutSeed,
      lootSeed,
      route: 'deep',
      roleAtStart: alice.role,
      startedAtServerMs: startedAt,
      expiresAtServerMs: startedAt + BALANCE.mission.tokenTtlMs,
      consumed: false,
    };
    const map = generateMap(layoutSeed, first.city.threat);
    const contents = rollCrateContents(map, lootSeed);
    const collectedCrateIds = [contents[0]!.crateId, contents[1]!.crateId];
    const finishedAt = startedAt + BALANCE.mission.minPlausibleDurationMs + 1_000;
    const missionResult = evaluateMission(
      token,
      { tokenId: token.tokenId, status: 'escaped', collectedCrateIds, clientDurationMs: 6000 },
      alice.userId,
      first.city.day,
      first.city.threat,
      finishedAt,
    );
    expect(missionResult.ok).toBe(true);
    if (!missionResult.ok) throw new Error('impossible');
    expect(missionResult.injured).toBe(false);
    const bankedItems =
      (missionResult.banked.food ?? 0) +
      (missionResult.banked.medicine ?? 0) +
      (missionResult.banked.scrap ?? 0);
    expect(bankedItems).toBeGreaterThan(0);

    await store.bumpDayMissions(first.city.day, {
      totalRuns: 1,
      totalFood: missionResult.banked.food ?? 0,
      totalMedicine: missionResult.banked.medicine ?? 0,
      totalScrap: missionResult.banked.scrap ?? 0,
      injuries: missionResult.injured ? 1 : 0,
    });
    await store.recordScoutHaul(alice.userId, bankedItems);

    // 5. Crisis vote (first_light option 'a') and council plan.
    await store.recordVote(first.city.day, alice.userId, 'a');
    await store.recordStrategyVote(first.city.day, alice.userId, 'stockpile_food');
    expect(await store.getVoteTally(first.city.day)).toEqual({ a: 1 });
    expect(await store.getStrategyTally(first.city.day)).toEqual({ stockpile_food: 1 });

    // 6. Force a day rollover — UTC date changed, so resolver fires.
    const resolved = await runLazyResolution(store, redis, day2, worldSeed);
    expect(resolved.city.day).toBe(2);
    expect(resolved.city.status).toBe('alive');
    expect(resolved.resolving).toBe(false);

    // 6a. Timeline captured yesterday's story.
    const timeline = await store.getTimeline(10);
    expect(timeline).toHaveLength(1);
    const yesterday = timeline[0]!;
    expect(yesterday.day).toBe(1);
    expect(yesterday.winningOptionId).toBe('a');
    expect(yesterday.events.some((line) => /citizen actions/.test(line))).toBe(true);
    expect(yesterday.events.some((line) => /expedition/i.test(line))).toBe(true);

    // 6b. City snapshot for day 2 exists in history.
    const rawSnap = await redis.hGet('city:history', '2');
    expect(rawSnap).toBeDefined();

    // 6c. Yesterday's day-scoped keys are preserved (we don't wipe them).
    expect(await store.getDayActions(1)).toEqual({ grow_food: 2 });

    // 6d. Second run at day 2 is idempotent — lastResolvedDate guards it.
    const resolvedAgain = await runLazyResolution(store, redis, day2, worldSeed);
    expect(resolvedAgain.city).toEqual(resolved.city);
    expect((await store.getTimeline(10)).length).toBe(1);

    // 7. Alice resets for day 2 — energy back to 0, streak bumped.
    const reloaded = (await store.getPlayer(alice.userId))!;
    const reset = resetPlayerForDay(reloaded, resolved.city.day);
    expect(reset.energyUsedToday).toBe(0);
    expect(reset.lastActiveDay).toBe(2);
    expect(reset.streak).toBe(reloaded.streak + 1);
  });
});

/**
 * Front-door regression — the single most common situation (a brand-new player
 * opening the post) must not brick. This exercises loadOrCreatePlayer, the
 * exact code /init runs, rather than seeding store.savePlayer directly (which is
 * precisely how the original brick slipped past every other test).
 */
describe('brand-new player front door', () => {
  it('persists the fresh profile on first visit so later actions do not 409', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    const { city } = await runLazyResolution(store, redis, new Date('2026-07-05T09:00:00Z'), 0);

    // Nothing stored yet — this is a first-ever visitor.
    expect(await store.getPlayer('t2_newcomer')).toBeUndefined();

    let rpcCalls = 0;
    const resolveUsername = async () => {
      rpcCalls += 1;
      return 'newcomer';
    };

    const first = await loadOrCreatePlayer(store, 't2_newcomer', city.day, resolveUsername);
    expect(first.brandNew).toBe(true);
    expect(first.firstVisitToday).toBe(false); // no "yesterday" → no dawn report
    expect(rpcCalls).toBe(1); // fresh player paid the username RPC exactly once

    // THE INVARIANT: the profile is now persisted. If this regresses, /role,
    // /action and /pledge all read undefined and 409 "Open the game first".
    const persisted = await store.getPlayer('t2_newcomer');
    expect(persisted).not.toBeUndefined();
    expect(persisted?.userId).toBe('t2_newcomer');
    expect(persisted?.username).toBe('newcomer');
    expect(persisted?.role).toBeNull();
    expect(persisted?.lastActiveDay).toBe(city.day);

    // The role gate would now succeed — the player exists, so no 409.
    const gate = await store.getPlayer('t2_newcomer');
    expect(gate).not.toBeUndefined();

    // Second visit reuses the stored profile and never re-pays the RPC.
    const second = await loadOrCreatePlayer(store, 't2_newcomer', city.day, resolveUsername);
    expect(second.brandNew).toBe(false);
    expect(rpcCalls).toBe(1);
    expect(second.player.username).toBe('newcomer');
  });

  it('marks an existing player firstVisitToday after a day rollover', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    // Player last active on day 1, city is now on day 2.
    await store.savePlayer({ ...freshPlayer('t2_ret', 'ret', 1), lastActiveDay: 1 });
    const loaded = await loadOrCreatePlayer(store, 't2_ret', 2, async () => 'unused');
    expect(loaded.brandNew).toBe(false);
    expect(loaded.firstVisitToday).toBe(true);
    expect(loaded.player.energyUsedToday).toBe(0); // reset for the new day
    expect(loaded.player.lastActiveDay).toBe(2);
    // Persisted with the advanced day.
    expect((await store.getPlayer('t2_ret'))?.lastActiveDay).toBe(2);
  });
});

describe('one redditor one house integration', () => {
  it('keeps house order stable while tiers come from contribution scores', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    await store.savePlayer(freshPlayer('t2_founder', 'founder', 1));
    await store.savePlayer(freshPlayer('t2_neighbor', 'neighbor', 1));

    expect(await store.registerHouse('t2_founder')).toEqual({ index: 0, isNew: true });
    await store.addContribution('t2_founder', 40);
    expect(await store.registerHouse('t2_neighbor')).toEqual({ index: 1, isNew: true });
    await store.addContribution('t2_neighbor', 6);

    expect(await store.getFounderId()).toBe('t2_founder');
    expect(await store.getHouseCount()).toBe(2);
    expect(await store.getHouseIndex('t2_founder')).toBe(0);
    expect(await store.getHouseIndex('t2_neighbor')).toBe(1);

    const top = await store.topContributors(2);
    expect(top.map((t) => [t.userId, tierForContribution(t.score)])).toEqual([
      ['t2_founder', 4],
      ['t2_neighbor', 2],
    ]);
  });
});

/**
 * Conflict layer (Plan 2) integration — proves factions, laws, and raids
 * compose with the Store end-to-end at the store + pure-resolver level (the
 * same strategy as the vertical-slice test above; Hono routes need Devvit).
 * P3 already unit-tests laws/raids in isolation; these tests prove they wire
 * through real Store reads (getFactionInfluence, bumpPlayerFactionRep, ...).
 */
describe('conflict layer', () => {
  it('Scenario A: a faction wins and enacts (and applies) tomorrow\'s law', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    const day = 1;
    const city = newCityState(1); // fresh, activeLaw: null

    // Two players each do 2 repair actions → bump builders influence to a clear
    // lead. factionPerAction.repair_power === 'builders'; rep 2 per action.
    for (const _player of ['t2_boba', 't2_cid']) {
      for (let i = 0; i < 2; i++) {
        await store.bumpFactionInfluence(day, 'builders', BALANCE.factionRepPerAction);
      }
    }
    // A couple of other-faction actions, but strictly fewer, so builders leads.
    await store.bumpFactionInfluence(day, 'wardens', BALANCE.factionRepPerAction);

    const influence = await store.getFactionInfluence(day);
    expect(influence).toEqual({ builders: 8, wardens: 2, seekers: 0, hearth: 0 });

    const inputs: DayInputs = {
      ...noInputs(),
      actions: { repair_power: 4 },
      activeUserCount: 2,
      factionInfluence: influence,
    };
    const { city: next } = resolveDay(city, inputs);

    // Builders won → tomorrow's law is 'builders'. lawExpiresDay is the last
    // active day: enacted for next.day, lifespan 1 → expires that same day.
    expect(next.activeLaw).toBe('builders');
    expect(next.lawExpiresDay).toBe(next.day + BALANCE.lawLifespanDays - 1);

    // Now resolve ANOTHER day WITH the builders law active + repair actions,
    // and compare against a CONTROL run of the same day with no law. The law
    // must actually boost repair output (power gain higher), proving it
    // modifies production and isn't merely stored.
    const repairInputs: DayInputs = {
      ...noInputs(),
      actions: { repair_power: 4 },
      activeUserCount: 0, // isolate the law effect from active-player drains
    };
    const withLaw = resolveDay(next, repairInputs).city; // next.activeLaw === 'builders'
    const control = resolveDay({ ...next, activeLaw: null, lawExpiresDay: 0 }, repairInputs).city;

    expect(withLaw.power).toBeGreaterThan(control.power);
    // Sanity: the boost is the +25% on repair output (4 repairs × 4 power × 0.25 = 4).
    expect(withLaw.power - control.power).toBe(4);
  });

  it('Scenario B: a raid fires and guards dampen the food loss', async () => {
    // Construct a high-threat city directly (store round-trip proven above).
    const base: CityState = { ...newCityState(1), threat: 130 };

    // --- No guards: the raid fires and resets threat, food drops. ---
    const unguarded = resolveDay(base, noInputs());
    expect(unguarded.city.threat).toBe(BALANCE.raid.postRaidThreat);
    expect(unguarded.entry.events.some((e) => /red signal/i.test(e))).toBe(true);
    expect(unguarded.city.food).toBeLessThan(base.food); // raid + consumption ate food

    // --- With guards: guard_wall softens every raid loss. NOTE: guard_wall
    // also lowers threat (−5 each ⇒ 5 guards = −25). At threat 130 that leaves
    // 130 + passiveRise − 25 ≈ 111 ≥ 100, so the raid STILL fires here — we are
    // measuring the dampening, not preventing the raid. ---
    const guardedInputs: DayInputs = { ...noInputs(), actions: { guard_wall: 5 } };
    const guarded = resolveDay(base, guardedInputs);
    expect(guarded.city.threat).toBe(BALANCE.raid.postRaidThreat); // raid fired + reset
    expect(guarded.entry.events.some((e) => /red signal/i.test(e))).toBe(true);

    // Guarded city keeps more (>=) food than the unguarded raid.
    expect(guarded.city.food).toBeGreaterThanOrEqual(unguarded.city.food);
  });

  it('Scenario C: faction rep accumulates on a player and sets their leaning', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);

    const player = freshPlayer('t2_dax', 'dax', 1);
    expect(player.faction).toBeNull();
    expect(player.factionRep).toBe(0);
    await store.savePlayer(player);

    // Two seekers rep bumps (e.g. two expedition runs).
    const first = await store.bumpPlayerFactionRep(1, 't2_dax', 'seekers', BALANCE.factionRepPerMissionRun);
    expect(first?.faction).toBe('seekers');
    const second = await store.bumpPlayerFactionRep(1, 't2_dax', 'seekers', BALANCE.factionRepPerMissionRun);
    expect(second?.faction).toBe('seekers');
    expect(second?.factionRep).toBe(BALANCE.factionRepPerMissionRun * 2);

    // Persisted: reloading the player shows the same leaning + total.
    const reloaded = await store.getPlayer('t2_dax');
    expect(reloaded?.faction).toBe('seekers');
    expect(reloaded?.factionRep).toBe(BALANCE.factionRepPerMissionRun * 2);
  });

  it('Scenario D: desperate route allows (and pays for) a 9-crate haul deep would reject', () => {
    const city = newCityState(1);
    const layoutSeed = deriveLayoutSeed(city.worldSeed, city.cycle, city.day);
    const lootSeed = hashString(`${layoutSeed}-t2_eve`);
    const startedAt = 1_000_000;
    const desperateToken: MissionToken = {
      tokenId: `t2_eve-${city.day}-${startedAt}`,
      userId: 't2_eve',
      day: city.day,
      layoutSeed,
      lootSeed,
      route: 'desperate',
      roleAtStart: 'scout',
      startedAtServerMs: startedAt,
      expiresAtServerMs: startedAt + BALANCE.mission.tokenTtlMs,
      consumed: false,
    };

    // The desperate map carries the route's crate count — more than deep's cap.
    const map = generateMap(layoutSeed, city.threat, 'desperate');
    expect(map.crates.length).toBe(BALANCE.mission.routes.desperate.crates); // 9
    expect(map.crates.length).toBeGreaterThan(BALANCE.mission.routes.deep.crates);

    // Claim ALL crates with a generous honest duration (80s of a 105s scout run).
    const allCrateIds = map.crates.map((c) => c.id);
    const durationMs = 80_000;
    const request = {
      tokenId: desperateToken.tokenId,
      status: 'escaped' as const,
      collectedCrateIds: allCrateIds,
      clientDurationMs: durationMs,
    };
    const result = evaluateMission(
      desperateToken,
      request,
      't2_eve',
      city.day,
      city.threat,
      startedAt + durationMs,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('impossible');
    const bankedItems =
      (result.banked.food ?? 0) + (result.banked.medicine ?? 0) + (result.banked.scrap ?? 0);
    // 9 crates × at least 1 item each.
    expect(bankedItems).toBeGreaterThanOrEqual(map.crates.length);

    // The IDENTICAL 9-crate claim on a deep-route token is rejected: deep maps
    // cap at 7 crates, so the claim count alone is impossible.
    const deepToken: MissionToken = { ...desperateToken, route: 'deep' };
    const deepResult = evaluateMission(
      deepToken,
      request,
      't2_eve',
      city.day,
      city.threat,
      startedAt + durationMs,
    );
    expect(deepResult.ok).toBe(false);
    if (deepResult.ok) throw new Error('impossible');
    expect(deepResult.reason).toBe('Too many crates claimed.');
  });
});

/**
 * Reddit-native hook layer (Plan 1) integration — the Marked, one-tap pledges,
 * ledger, drama feed, and standing, driven through the Store + pure game logic
 * exactly like the vertical slice above (Hono routes need the Devvit runtime;
 * the store writes here mirror POST /api/pledge 1:1).
 */
describe('hook layer (Plan 1)', () => {
  it('one-tap pledges save the Marked at dawn; ledger, drama, and standing follow', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    const worldSeed = hashString('t5_hook');
    const day1 = new Date('2026-07-05T09:00:00Z');
    const day2 = new Date('2026-07-06T09:00:00Z');

    const first = await runLazyResolution(store, redis, day1, worldSeed);
    // Day 1: no action-takers yesterday, so the goal is the base.
    const marked = pickMarked(worldSeed, first.city.cycle, first.city.day, 0);
    expect(marked.goal).toBe(BALANCE.marked.goalBase);

    // Enough one-tap pledges to clear the goal (mirrors /api/pledge writes).
    const taps = Math.ceil(marked.goal / BALANCE.marked.pledgePerTap);
    for (let i = 0; i < taps; i++) {
      const userId = `t2_p${i}`;
      await store.recordPledger(1, userId, {
        kind: 'stand_vigil',
        name: `pled${i}•••`,
        at: 1_000 + i,
        contribution: i,
      });
      await store.bumpMarkedPledge(1, BALANCE.marked.pledgePerTap);
      await store.bumpPledgeKind(1, 'stand_vigil');
      await store.addContribution(userId, BALANCE.contributionPerPledge);
    }
    expect(await store.getMarkedPledge(1)).toBe(taps * BALANCE.marked.pledgePerTap);

    // One-per-day rule: the route 409s when getPledger finds a record.
    expect(await store.getPledger(1, 't2_p0')).toBeDefined();
    expect(await store.getPledger(1, 't2_lurker')).toBeUndefined();

    // Public-credit ledger straight from the day's pledgers.
    const info = buildPledgeInfo(await store.getPledgers(1), 't2_p0');
    expect(info.usedToday).toBe(true);
    expect(info.ledger.mine).toBe(BALANCE.marked.pledgePerTap);
    expect(info.ledger.recent.length).toBe(Math.min(taps, BALANCE.marked.ledgerRecent));

    // Dawn: resolution judges pledged vs goal, records the outcome, and the
    // vigil pressure lands on the city (defense up vs a pledge-free control).
    const control = resolveDay(first.city, noInputs()).city;
    const resolved = await runLazyResolution(store, redis, day2, worldSeed);
    expect(resolved.city.day).toBe(2);
    expect(resolved.city.defense - control.defense).toBe(taps);

    const outcome = await store.getMarkedOutcome(1);
    expect(outcome).toEqual({ name: marked.name, saved: true });
    const timeline = await store.getTimeline(1);
    expect(timeline[0]!.events.some((e) => e.includes(marked.name))).toBe(true);
    expect(timeline[0]!.events.some((e) => /was saved/.test(e))).toBe(true);

    // Next day's surfaces: savedYesterday + drama feed + standing.
    const today: Marked = {
      ...pickMarked(worldSeed, resolved.city.cycle, resolved.city.day, 0),
      pledged: 0,
      savedYesterday: outcome,
    };
    expect(today.name).not.toBe(marked.name); // never the same objective twice
    const drama = buildDrama(
      resolved.city,
      timeline,
      {},
      {},
      today,
      await store.getFactionInfluence(2),
    );
    expect(drama.length).toBeGreaterThan(0);
    expect(drama.length).toBeLessThanOrEqual(BALANCE.drama.maxEvents);
    expect(drama.some((d) => d.kind === 'marked' && /was saved at dawn/.test(d.text))).toBe(true);

    const standing = buildStanding(resolved.city, await store.getContributionRank('t2_p0'));
    expect(standing.survivalDays).toBe(2);
    expect(standing.contributionRank).not.toBeNull();
  });

  it('a lost Marked writes a memorial outcome at dawn', async () => {
    const redis = makeFakeRedis();
    const store = new Store(redis);
    const worldSeed = hashString('t5_quiet');
    await runLazyResolution(store, redis, new Date('2026-07-05T09:00:00Z'), worldSeed);
    // Nobody pledges. Dawn comes anyway.
    const resolved = await runLazyResolution(store, redis, new Date('2026-07-06T09:00:00Z'), worldSeed);
    expect(resolved.city.day).toBe(2);

    const marked = pickMarked(worldSeed, 1, 1, 0);
    expect(await store.getMarkedOutcome(1)).toEqual({ name: marked.name, saved: false });
    const timeline = await store.getTimeline(1);
    expect(timeline[0]!.events.some((e) => /^Memorial:/.test(e))).toBe(true);
  });
});
