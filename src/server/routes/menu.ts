import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import type { CityState, TimelineEntry } from '../../shared/types';
import { createPost } from '../core/post';
import { newCityState, resolveDay, type DayInputs } from '../game/resolver';
import { utcDateString } from '../game/lazyResolve';
import { KEYS } from '../storage/redisKeys';
import { deriveWorldSeed, getStore, redisLike } from './api';

export const menu = new Hono();

menu.post('/post-create', async (c) => {
  const post = await createPost();
  return c.json<UiResponse>(
    { navigateTo: `https://reddit.com${post.permalink}` },
    200,
  );
});

menu.post('/force-resolve', async (c) => {
  const store = getStore();
  const city = await store.getCityState();
  if (!city) {
    return c.json<UiResponse>({ showToast: 'No city yet — open the post first.' }, 200);
  }
  if (city.status === 'fallen') {
    return c.json<UiResponse>(
      { showToast: 'City has fallen. Reset to start a new cycle.' },
      200,
    );
  }

  const inputs: DayInputs = {
    actions: await store.getDayActions(city.day),
    missions: await store.getDayMissions(city.day),
    crisisVotes: await store.getVoteTally(city.day),
    strategyVotes: await store.getStrategyTally(city.day),
    roleCounts: {},
    activeUserCount: 0,
    factionInfluence: await store.getFactionInfluence(city.day),
    markedPledged: await store.getMarkedPledge(city.day),
    pledges: await store.getPledgeKindCounts(city.day),
    markedActivePlayers: Object.keys(await store.getAllUserActions(city.day - 1)).length,
  };
  const { city: next, entry, marked } = resolveDay(city, inputs);
  await store.snapshotCity(next);
  await store.appendTimeline(entry);
  await store.setMarkedOutcome(city.day, marked);
  await store.setCityState(next);
  await store.setCityMeta({ lastResolvedDate: utcDateString(new Date()) });

  return c.json<UiResponse>(
    { showToast: `Resolved day ${city.day} → day ${next.day} (${next.status}).` },
    200,
  );
});

menu.post('/reset', async (c) => {
  const store = getStore();
  const old = await store.getCityState();
  const cycle = (old?.cycle ?? 0) + 1;
  const lastDay = old?.day ?? 1;

  const keysToDelete: string[] = [
    KEYS.cityState,
    KEYS.timeline,
    KEYS.cityHistory,
    KEYS.players,
    KEYS.lbContribution,
    KEYS.lbScouts,
    KEYS.markedOutcomes,
  ];
  for (let d = 1; d <= lastDay + 1; d++) {
    keysToDelete.push(
      KEYS.dayActions(d),
      KEYS.dayUserActions(d),
      KEYS.dayVotes(d),
      KEYS.dayVoters(d),
      KEYS.dayMissions(d),
      KEYS.dayFactionInfluence(d),
      KEYS.dayStrategyPlan(d),
      KEYS.dayStrategyVoters(d),
      KEYS.dayMarked(d),
      KEYS.dayPledgers(d),
    );
  }
  // Long cycles build a big key list — delete in bounded batches so a single
  // del never carries hundreds of keys.
  for (let i = 0; i < keysToDelete.length; i += 100) {
    await redisLike.del(...keysToDelete.slice(i, i + 100));
  }

  await store.setCityState(newCityState(cycle, deriveWorldSeed()));
  await store.setCityMeta({
    lastResolvedDate: utcDateString(new Date()),
    schemaVersion: '1',
  });

  return c.json<UiResponse>(
    { showToast: `City reset. Cycle ${cycle}, day 1.` },
    200,
  );
});

menu.post('/seed-demo', async (c) => {
  const store = getStore();
  const old = await store.getCityState();
  const cycle = old?.cycle ?? 1;

  const demo: CityState = {
    day: 5,
    cycle,
    status: 'alive',
    worldSeed: deriveWorldSeed(),
    trait: 'standard', // demo state is hand-built; keep it modifier-free
    population: 143,
    food: 22,
    power: 31,
    medicine: 7,
    morale: 44,
    threat: 68,
    defense: 35,
    crisisId: 'refugee_convoy',
    activeLaw: null,
    lawExpiresDay: 0,
  };
  await store.setCityState(demo);
  await store.setCityMeta({
    lastResolvedDate: utcDateString(new Date()),
    schemaVersion: '1',
  });

  const day4Entry: TimelineEntry = {
    day: 4,
    cycle,
    headline: 'Day 4: The city survived to see one more dawn.',
    events: [
      '12 citizen actions strengthened the city.',
      'Engineers repaired the north generator; power held through the night.',
      '2 expeditions returned: +6 food, +3 medicine, +4 scrap.',
      'A scout was injured in the ruins beyond the wall.',
      'The lights flicker. Darkness weighs on everyone.',
    ],
    deltas: {
      food: -4,
      power: -6,
      medicine: 1,
      morale: -5,
      threat: 8,
      population: -2,
    },
    crisisId: 'blackout_ward',
    winningOptionId: 'a',
  };
  await store.appendTimeline(day4Entry);

  return c.json<UiResponse>(
    { showToast: 'Demo state seeded: day 5, threat 68, refugee convoy at the gate.' },
    200,
  );
});
