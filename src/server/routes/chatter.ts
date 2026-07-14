import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import {
  CHATTER_COOLDOWN_SECONDS,
  CHATTER_DUPLICATE_SECONDS,
  CHATTER_MAX_LENGTH,
  chatterWeekKey,
  isChatterCategory,
  validateChatterText,
  type ChatterCategory,
  type ChatterMessage,
  type ChatterPostRequest,
  type ChatterPostResponse,
  type ChatterState,
} from '../../shared/chatter';
import type { ApiError } from '../../shared/types';
import { hashString } from '../../shared/rng';
import { chatterThreadUrl, ensureChatterHub, readChatterMeta, readChatterRoots } from '../chatter/hub';
import { KEYS } from '../storage/redisKeys';
import { getStore, redisLike } from './api';

export const chatter = new Hono();

const ATTRIBUTION_NOTICE =
  'Posting is optional and creates a public Reddit comment. During unapproved playtests, Reddit may attribute non-owner comments to the app account.';

const requireUser = (): string | null => context.userId ?? null;

const selectedCategory = (value: unknown): ChatterCategory =>
  isChatterCategory(value) ? value : 'strategy';

const commentMessage = (comment: {
  id: string;
  authorName: string;
  body: string;
  createdAt: Date;
  permalink: string;
}, fallbackPermalink = ''): ChatterMessage => ({
  id: comment.id,
  author: comment.authorName || '[deleted]',
  text: comment.body || '',
  createdAt: comment.createdAt instanceof Date && Number.isFinite(comment.createdAt.getTime())
    ? comment.createdAt.toISOString()
    : new Date().toISOString(),
  permalink: chatterThreadUrl(comment.permalink || fallbackPermalink),
});

chatter.get('/', async (c) => {
  if (!requireUser()) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const category = selectedCategory(c.req.query('category'));
  const store = getStore();
  const city = await store.getCityState();
  if (!city) return c.json<ApiError>({ status: 'error', message: 'Open the city first' }, 409);
  const currentWeek = chatterWeekKey(new Date());
  let meta = await readChatterMeta(redisLike);
  let roots = meta?.weekKey === currentWeek ? await readChatterRoots(redisLike, meta, city) : {};
  if (meta?.weekKey !== currentWeek || !roots[category]) {
    try {
      const subredditName = context.subredditName ?? (await reddit.getCurrentSubreddit()).name;
      const hub = await ensureChatterHub(redisLike, subredditName, city);
      meta = hub;
      roots = hub.roots;
    } catch {
      // The feed remains honest and read-only when Reddit provisioning fails.
      meta = await readChatterMeta(redisLike);
      if (meta?.weekKey !== currentWeek) meta = null;
      roots = meta ? await readChatterRoots(redisLike, meta, city) : {};
    }
  }
  const rootCommentId = roots[category] ?? null;
  let messages: ChatterMessage[] = [];
  let feedAvailable = true;

  if (meta && rootCommentId) {
    try {
      const comments = await reddit.getComments({
        postId: meta.postId,
        commentId: rootCommentId,
        depth: 1,
        limit: 20,
        pageSize: 20,
        sort: 'new',
      }).all();
      messages = comments
        .filter((comment) => comment.parentId === rootCommentId && !comment.removed && !comment.spam)
        .slice(0, 12)
        .map((comment) => commentMessage(comment));
    } catch {
      messages = [];
      feedAvailable = false;
    }
  }

  return c.json<ChatterState>({
    type: 'chatter',
    ready: !!meta && !!rootCommentId,
    weekKey: meta?.weekKey ?? null,
    cityDay: city.day,
    category,
    rootCommentId,
    threadUrl: meta ? chatterThreadUrl(meta.permalink) : null,
    messages,
    feedAvailable,
    maxLength: CHATTER_MAX_LENGTH,
    cooldownSeconds: CHATTER_COOLDOWN_SECONDS,
    attributionNotice: ATTRIBUTION_NOTICE,
  });
});

chatter.post('/', async (c) => {
  const userId = requireUser();
  if (!userId) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  let body: ChatterPostRequest;
  try {
    body = await c.req.json<ChatterPostRequest>();
  } catch {
    return c.json<ApiError>({ status: 'error', message: 'Bad request' }, 400);
  }
  if (!isChatterCategory(body.category)) {
    return c.json<ApiError>({ status: 'error', message: 'Choose a valid City Chatter topic.' }, 400);
  }
  const checked = validateChatterText(body.text);
  if (!checked.ok) return c.json<ApiError>({ status: 'error', message: checked.message }, 400);

  const store = getStore();
  const city = await store.getCityState();
  if (!city) return c.json<ApiError>({ status: 'error', message: 'Open the city first' }, 409);
  const meta = await readChatterMeta(redisLike);
  const roots = meta?.weekKey === chatterWeekKey(new Date())
    ? await readChatterRoots(redisLike, meta, city)
    : {};
  const rootId = roots[body.category];
  if (!meta || !rootId) {
    return c.json<ApiError>({ status: 'error', message: 'City Chatter is being prepared. Open the Reddit thread or ask a moderator to repair it.' }, 503);
  }

  const cooldownKey = KEYS.chatterCooldown(userId);
  const cooldown = await redisLike.set(cooldownKey, '1', {
    nx: true,
    expiration: CHATTER_COOLDOWN_SECONDS,
  });
  if (!cooldown) {
    return c.json<ApiError>({ status: 'error', message: `Wait ${CHATTER_COOLDOWN_SECONDS} seconds before posting again.` }, 429);
  }
  const duplicateKey = KEYS.chatterDuplicate(
    userId,
    hashString(`${body.category}:${checked.duplicateKey}`),
  );
  const unique = await redisLike.set(duplicateKey, '1', {
    nx: true,
    expiration: CHATTER_DUPLICATE_SECONDS,
  });
  if (!unique) {
    await redisLike.del(cooldownKey);
    return c.json<ApiError>({ status: 'error', message: 'That message was already posted recently.' }, 409);
  }

  try {
    const comment = await reddit.submitComment({ id: rootId, text: checked.text, runAs: 'USER' });
    const message = commentMessage(comment, meta.permalink);
    return c.json<ChatterPostResponse>({
      type: 'chatter-post',
      message,
      postedAs: message.author,
      threadUrl: chatterThreadUrl(meta.permalink),
    });
  } catch {
    await redisLike.del(cooldownKey, duplicateKey);
    return c.json<ApiError>({ status: 'error', message: 'Reddit did not confirm the comment. Nothing was posted; try again.' }, 502);
  }
});
