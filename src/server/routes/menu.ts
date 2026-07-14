import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { requireModerator } from '../core/moderator';
import { createPost } from '../core/post';
import { seedDemoCity } from '../game/demoSeed';
import { newCityState, resolveDay, type DayInputs } from '../game/resolver';
import { utcDateString } from '../game/lazyResolve';
import { KEYS } from '../storage/redisKeys';
import { deriveWorldSeed, getStore, redisLike } from './api';
import { chatterThreadUrl, ensureChatterHub } from '../chatter/hub';
import { context, reddit } from '@devvit/web/server';

export const menu = new Hono();

/**
 * Defense in depth: devvit.json only OFFERS these routes as moderator menu
 * items — it does not AUTHORIZE the caller. This middleware fronts every
 * /internal/menu/* handler (present and future) and rejects anyone who is not
 * a moderator of the current subreddit before any state is touched. The body
 * keeps the menu-item `showToast` shape so a rejected call surfaces as a toast
 * if the platform renders it, while the 403 status marks it as denied for any
 * other caller.
 */
menu.use('*', async (c, next) => {
  const check = await requireModerator();
  if (!check.ok) {
    return c.json<UiResponse>({ showToast: check.message }, 403);
  }
  await next();
});

menu.post('/post-create', async (c) => {
  const post = await createPost();
  return c.json<UiResponse>(
    { navigateTo: `https://reddit.com${post.permalink}` },
    200,
  );
});

menu.post('/chatter-hub', async (c) => {
  const store = getStore();
  const city = await store.getCityState();
  if (!city) {
    return c.json<UiResponse>({ showToast: 'Open the game once before creating City Chatter.' }, 200);
  }
  try {
    const subredditName = context.subredditName ?? (await reddit.getCurrentSubreddit()).name;
    const hub = await ensureChatterHub(redisLike, subredditName, city);
    return c.json<UiResponse>({ navigateTo: chatterThreadUrl(hub.permalink) }, 200);
  } catch (error) {
    console.error(`Error creating Chatter Hub: ${error}`);
    return c.json<UiResponse>({ showToast: 'Could not create City Chatter. Try again shortly.' }, 200);
  }
});

menu.post('/force-resolve', async (c) => {
  const store = getStore();
  const city = await store.getCityState();
  if (!city) {
    return c.json<UiResponse>({ showToast: 'No city yet, open the post first.' }, 200);
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
    dome: await store.getDomeSegments(),
  };
  const { city: next, entry, marked, raid } = resolveDay(city, inputs);
  // Keep the dome consistent on the force-resolve path too (blocked hits drain it).
  if (raid && next.status === 'alive') await store.setDomeSegments(raid.segmentsAfter);
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
    KEYS.housesIndex,
    KEYS.housesMeta,
    KEYS.housesDamage,
    KEYS.housesRebuild,
    KEYS.dome,
    KEYS.landFunding,
    KEYS.cityTreasury,
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
      KEYS.dayChallenges(old?.cycle ?? cycle, d),
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

/**
 * Seed a rich, self-consistent mid-run city (see game/demoSeed.ts) so a judge or
 * first visitor lands in a living Day-5 city under an imminent raid instead of
 * an empty Day-1 board. Everything is written through the store the game reads;
 * `reset` clears it.
 */
menu.post('/seed-demo', async (c) => {
  const store = getStore();
  const old = await store.getCityState();
  const cycle = old?.cycle ?? 1;
  await seedDemoCity(store, { cycle, worldSeed: deriveWorldSeed(), nowMs: Date.now() });
  await store.setCityMeta({ lastResolvedDate: utcDateString(new Date()), schemaVersion: '1' });
  return c.json<UiResponse>(
    {
      showToast:
        'Demo seeded: Day 5, 9 citizens, raid tomorrow, The Marked rescue underway, votes & chronicle live.',
    },
    200,
  );
});
