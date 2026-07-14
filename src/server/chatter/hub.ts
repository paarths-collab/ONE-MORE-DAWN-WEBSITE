import { reddit } from '@devvit/web/server';
import type { T1, T3 } from '@devvit/shared-types/tid.js';
import { BALANCE } from '../../shared/balance';
import {
  CHATTER_CATEGORIES,
  chatterWeekKey,
  chatterWeekLabel,
  type ChatterCategory,
} from '../../shared/chatter';
import { cityNameFromSeed } from '../../shared/cityName';
import type { CityState } from '../../shared/types';
import { buildStatus } from '../game/building';
import { getCrisis } from '../../shared/crises';
import { KEYS } from '../storage/redisKeys';
import type { RedisLike } from '../storage/store';

export type ChatterHubMeta = {
  weekKey: string;
  postId: T3;
  permalink: string;
  createdAt: string;
};

export type ChatterHub = ChatterHubMeta & {
  roots: Record<ChatterCategory, T1>;
};

const isPostId = (value: string | undefined): value is T3 => !!value && /^t3_[a-z0-9]+$/i.test(value);
const isCommentId = (value: string | undefined): value is T1 => !!value && /^t1_[a-z0-9]+$/i.test(value);

const rootField = (weekKey: string, cycle: number, day: number, category: ChatterCategory): string =>
  `${weekKey}:${cycle}:${day}:${category}`;

export const chatterThreadUrl = (permalink: string): string => {
  if (/^https?:\/\//i.test(permalink)) {
    try {
      const url = new URL(permalink);
      const host = url.hostname.toLocaleLowerCase('en-US');
      if (host === 'reddit.com' || host.endsWith('.reddit.com')) return url.toString();
    } catch {
      // Fall through to the safe Reddit root.
    }
    return 'https://www.reddit.com/';
  }
  return `https://www.reddit.com${permalink.startsWith('/') ? '' : '/'}${permalink}`;
};

export const readChatterMeta = async (redis: RedisLike): Promise<ChatterHubMeta | null> => {
  const raw = await redis.hGetAll(KEYS.chatterMeta);
  if (!raw['weekKey'] || !isPostId(raw['postId']) || !raw['permalink'] || !raw['createdAt']) return null;
  return {
    weekKey: raw['weekKey'],
    postId: raw['postId'],
    permalink: raw['permalink'],
    createdAt: raw['createdAt'],
  };
};

export const readChatterRoots = async (
  redis: RedisLike,
  meta: ChatterHubMeta,
  city: CityState,
): Promise<Partial<Record<ChatterCategory, T1>>> => {
  const raw = await redis.hGetAll(KEYS.chatterRoots);
  const roots: Partial<Record<ChatterCategory, T1>> = {};
  for (const category of CHATTER_CATEGORIES) {
    const id = raw[rootField(meta.weekKey, city.cycle, city.day, category.id)];
    if (isCommentId(id)) roots[category.id] = id;
  }
  return roots;
};

const postBody = (city: CityState, date: Date): string => {
  const name = cityNameFromSeed(city.worldSeed);
  return [
    `# ${name} City Chatter Hub`,
    '',
    'This is the shared weekly discussion thread for One More Dawn.',
    '',
    '- Discuss strategy, raids, rebuilding, and city life beneath the daily topic comments.',
    '- Binding actions and votes still happen inside the game.',
    '- Be constructive. Reddit community rules and moderation apply.',
    '',
    `**Week:** ${chatterWeekLabel(date)}`,
  ].join('\n');
};

const rootText = (category: ChatterCategory, city: CityState): string => {
  const crisis = getCrisis(city.crisisId);
  const build = buildStatus(city, 0, false);
  const raidInDays = Math.max(
    0,
    Math.ceil((BALANCE.raid.triggerThreshold - city.threat) / BALANCE.passiveThreatRise),
  );
  const common = `**DAY ${city.day}** · Binding actions and votes remain inside One More Dawn.`;
  switch (category) {
    case 'strategy':
      return `## 🧭 STRATEGY COUNCIL\n\n${common}\n\nToday’s crisis is **${crisis.title}**. What should the city prioritize before dawn?`;
    case 'raid':
      return `## ⚔️ RAID PREPARATION\n\n${common}\n\n${raidInDays <= 1 ? 'Raiders are at the horizon.' : `The current forecast is roughly ${raidInDays} dawns.`} What must be protected first?`;
    case 'rebuilding':
      return `## 🔨 REBUILDING EFFORT\n\n${common}\n\n${build.next ? `The next shared project is **${build.next.name}**.` : 'The civic districts stand complete.'} Where should labor go next?`;
    case 'general':
      return `## 💬 OPEN CITY CHATTER\n\n${common}\n\nQuestions, roleplay, welcomes, and life inside the walls belong here.`;
  }
};

const completeRoots = (roots: Partial<Record<ChatterCategory, T1>>): roots is Record<ChatterCategory, T1> =>
  CHATTER_CATEGORIES.every((category) => isCommentId(roots[category.id]));

export const ensureChatterHub = async (
  redis: RedisLike,
  subredditName: string,
  city: CityState,
  now = new Date(),
): Promise<ChatterHub> => {
  const weekKey = chatterWeekKey(now);
  let meta = await readChatterMeta(redis);
  let roots = meta?.weekKey === weekKey ? await readChatterRoots(redis, meta, city) : {};
  if (meta?.weekKey === weekKey && completeRoots(roots)) return { ...meta, roots };

  const lockKey = KEYS.chatterProvisionLock(weekKey);
  const locked = await redis.set(lockKey, '1', { nx: true, expiration: 120 });
  if (!locked) {
    meta = await readChatterMeta(redis);
    roots = meta?.weekKey === weekKey ? await readChatterRoots(redis, meta, city) : {};
    if (meta?.weekKey === weekKey && completeRoots(roots)) return { ...meta, roots };
    throw new Error('City Chatter setup is already in progress.');
  }

  try {
    if (meta?.weekKey !== weekKey) {
      const post = await reddit.submitPost({
        subredditName,
        title: `One More Dawn — City Chatter Hub | ${chatterWeekLabel(now)}`,
        text: postBody(city, now),
        flairText: 'One More Dawn: Chatter Hub',
        sendreplies: false,
        runAs: 'APP',
      });
      meta = {
        weekKey,
        postId: post.id,
        permalink: post.permalink,
        createdAt: now.toISOString(),
      };
      await redis.hSet(KEYS.chatterMeta, meta);
      roots = {};
    }

    for (const category of CHATTER_CATEGORIES) {
      if (roots[category.id]) continue;
      const comment = await reddit.submitComment({
        id: meta.postId,
        text: rootText(category.id, city),
        runAs: 'APP',
      });
      roots[category.id] = comment.id;
      await redis.hSet(KEYS.chatterRoots, {
        [rootField(meta.weekKey, city.cycle, city.day, category.id)]: comment.id,
      });
    }

    if (!completeRoots(roots)) throw new Error('City Chatter roots were not fully created.');
    return { ...meta, roots };
  } finally {
    await redis.del(lockKey);
  }
};
