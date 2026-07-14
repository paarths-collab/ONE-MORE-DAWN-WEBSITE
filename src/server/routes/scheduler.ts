import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import { ensureChatterHub, chatterThreadUrl } from '../chatter/hub';
import { runLazyResolution } from '../game/lazyResolve';
import { deriveWorldSeed, getStore, redisLike } from './api';

export const schedulerRoutes = new Hono();

const subredditName = async (): Promise<string> =>
  context.subredditName ?? (await reddit.getCurrentSubreddit()).name;

schedulerRoutes.post('/chatter-maintenance', async (c) => {
  const store = getStore();
  const existing = await store.getCityState();
  if (!existing) return c.json({ status: 'success', message: 'No city exists yet; chatter maintenance skipped.' });
  try {
    const { city, resolving } = await runLazyResolution(
      store,
      redisLike,
      new Date(),
      deriveWorldSeed(),
    );
    if (resolving) {
      return c.json({ status: 'success', message: 'Dawn resolution is already in progress; chatter maintenance deferred.' });
    }
    const hub = await ensureChatterHub(redisLike, await subredditName(), city);
    return c.json({
      status: 'success',
      message: `City Chatter ready for day ${city.day}.`,
      threadUrl: chatterThreadUrl(hub.permalink),
    });
  } catch (error) {
    console.error(`Chatter maintenance failed: ${error}`);
    return c.json({ status: 'error', message: 'City Chatter maintenance failed.' }, 500);
  }
});
