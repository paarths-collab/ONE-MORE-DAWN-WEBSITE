import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../shared/balance';
import { generateMap, rollCrateContents } from '../../shared/mapgen';
import { hashString } from '../../shared/rng';
import type { CityState, PlayerProfile } from '../../shared/types';
import { validateAction, validateRoleChange } from '../game/actionRules';
import { freshPlayer, resetPlayerForDay } from '../game/dayLogic';
import { runLazyResolution } from '../game/lazyResolve';
import { evaluateMission, type MissionToken } from '../game/missionRules';
import { newCityState, resolveDay, type DayInputs } from '../game/resolver';
import { Store } from '../storage/store';
import { makeFakeRedis } from '../storage/store.test';

/** Empty DayInputs so each scenario only sets the fields it exercises. */
const noInputs = (): DayInputs => ({
  actions: {},
  missions: {},
  crisisVotes: {},
  roleCounts: {},
  activeUserCount: 0,
  factionInfluence: {},
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

    // 1. First init creates the city on day 1.
    const first = await runLazyResolution(store, redis, day1);
    expect(first.city.day).toBe(1);
    expect(first.city.status).toBe('alive');
    expect(first.resolving).toBe(false);
    expect(first.city.crisisId).toBe('first_light');

    // 1a. Same-day repeat is a no-op — idempotent.
    const firstAgain = await runLazyResolution(store, redis, day1);
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

    // 4. Mission: deterministic token → server-side evaluation.
    const layoutSeed = hashString(`cycle${first.city.cycle}-day${first.city.day}`);
    const lootSeed = hashString(`${layoutSeed}-${alice.userId}`);
    const startedAt = 1_000_000;
    const token: MissionToken = {
      tokenId: `${alice.userId}-${first.city.day}-${startedAt}`,
      userId: alice.userId,
      day: first.city.day,
      layoutSeed,
      lootSeed,
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
    const resolved = await runLazyResolution(store, redis, day2);
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
    const resolvedAgain = await runLazyResolution(store, redis, day2);
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

    // Builders won → tomorrow's law is 'builders', lifespan honored.
    expect(next.activeLaw).toBe('builders');
    expect(next.lawExpiresDay).toBe(next.day + BALANCE.lawLifespanDays);

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
    const first = await store.bumpPlayerFactionRep('t2_dax', 'seekers', BALANCE.factionRepPerMissionRun);
    expect(first?.faction).toBe('seekers');
    const second = await store.bumpPlayerFactionRep('t2_dax', 'seekers', BALANCE.factionRepPerMissionRun);
    expect(second?.faction).toBe('seekers');
    expect(second?.factionRep).toBe(BALANCE.factionRepPerMissionRun * 2);

    // Persisted: reloading the player shows the same leaning + total.
    const reloaded = await store.getPlayer('t2_dax');
    expect(reloaded?.faction).toBe('seekers');
    expect(reloaded?.factionRep).toBe(BALANCE.factionRepPerMissionRun * 2);
  });
});
