import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import type {
  ApiError,
  LandDonationRequest,
  LandDonationResponse,
  ShopEquipRequest,
  ShopEquipResponse,
  ShopPurchaseRequest,
  ShopPurchaseResponse,
  TreasuryInvestmentRequest,
  TreasuryInvestmentResponse,
} from '../../shared/types';
import {
  economyOf,
  isLandExpansionId,
  landExpansion,
  normalizeEconomyFields,
  shopItem,
} from '../../shared/shop';
import { beginUserLock } from '../game/userLock';
import { KEYS } from '../storage/redisKeys';
import { getStore, parseBody } from './api';

/**
 * The cosmetic shop. Server-authoritative end to end: prices and slots come
 * from the shared catalog, balances from the stored profile — any client-sent
 * price or balance is ignored. Every mutation updates the whole player JSON
 * under the per-user optimistic lock, so a double-tap 409s instead of
 * charging twice. Coins never buy gameplay power (see shared/shop.ts).
 */
export const shop = new Hono();

shop.post('/purchase', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();
  const city = await store.getCityState();
  if (!city) return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);

  const body = await parseBody<ShopPurchaseRequest>(c);
  const item = body ? shopItem(body.itemId) : undefined;
  if (!item) {
    return c.json<ApiError>({ status: 'error', message: 'Unknown item' }, 400);
  }

  const lock = await beginUserLock(redis, userId);
  const player = await store.getPlayer(userId);
  if (!player) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);
  }
  // Role-gated cosmetics: only a player of the item's role may BUY it. Equipping
  // an already-owned item is never gated (see /equip), so a role change never
  // strips a cosmetic you earned.
  if (item.role && player.role !== item.role) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: `Only ${item.role}s can raise the ${item.name}.` }, 403);
  }
  const economy = normalizeEconomyFields(player);
  if (economy.ownedCosmetics.includes(item.id)) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'Already owned.' }, 409);
  }
  if (economy.coins < item.price) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: `Not enough Coins — ${item.name} costs ${item.price}.` }, 400);
  }
  const updated = {
    ...player,
    ...economy,
    coins: economy.coins - item.price,
    ownedCosmetics: [...economy.ownedCosmetics, item.id],
  };
  const committed = await lock.commit(async (tx) => {
    await tx.hSet(KEYS.players, { [userId]: JSON.stringify(updated) });
  });
  if (!committed) {
    return c.json<ApiError>({ status: 'error', message: 'Busy, try again' }, 409);
  }
  return c.json<ShopPurchaseResponse>({
    type: 'shop-purchase',
    itemId: item.id,
    economy: economyOf(updated, city.cycle, city.day),
    message: `${item.name} purchased. ${updated.coins} Coin${updated.coins === 1 ? '' : 's'} remain.`,
  });
});

shop.post('/equip', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();
  const city = await store.getCityState();
  if (!city) return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);

  const body = await parseBody<ShopEquipRequest>(c);
  const item = body ? shopItem(body.itemId) : undefined;
  if (!item) {
    return c.json<ApiError>({ status: 'error', message: 'Unknown item' }, 400);
  }

  const lock = await beginUserLock(redis, userId);
  const player = await store.getPlayer(userId);
  if (!player) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);
  }
  const economy = normalizeEconomyFields(player);
  if (!economy.ownedCosmetics.includes(item.id)) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'You do not own that yet.' }, 400);
  }
  const updated = {
    ...player,
    ...economy,
    equippedCosmetics: { ...economy.equippedCosmetics, [item.slot]: item.id },
  };
  const committed = await lock.commit(async (tx) => {
    await tx.hSet(KEYS.players, { [userId]: JSON.stringify(updated) });
  });
  if (!committed) {
    return c.json<ApiError>({ status: 'error', message: 'Busy, try again' }, 409);
  }
  return c.json<ShopEquipResponse>({
    type: 'shop-equip',
    itemId: item.id,
    economy: economyOf(updated, city.cycle, city.day),
    message: `Your house now carries the ${item.name}.`,
  });
});

shop.post('/donate', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();
  const city = await store.getCityState();
  if (!city || city.status !== 'alive') {
    return c.json<ApiError>({ status: 'error', message: 'The city cannot expand now.' }, 409);
  }

  const body = await parseBody<LandDonationRequest>(c);
  if (
    !body ||
    !isLandExpansionId(body.projectId) ||
    !Number.isSafeInteger(body.amount) ||
    body.amount <= 0
  ) {
    return c.json<ApiError>({ status: 'error', message: 'Choose a valid Coin amount.' }, 400);
  }
  const project = landExpansion(body.projectId);
  if (!project) {
    return c.json<ApiError>({ status: 'error', message: 'Unknown land project.' }, 400);
  }

  const projectLock = KEYS.landProjectLock(project.id);
  const lock = await beginUserLock(redis, userId, [projectLock]);
  const [player, land] = await Promise.all([
    store.getPlayer(userId),
    store.getLandExpansionState(),
  ]);
  if (!player) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);
  }
  const progress = land.projects.find((candidate) => candidate.id === project.id);
  if (!progress?.available) {
    await lock.abort();
    const message = progress?.unlocked
      ? `${project.name} is already unlocked.`
      : 'Expand the connected district before this one first.';
    return c.json<ApiError>({ status: 'error', message }, 409);
  }

  const donated = Math.min(body.amount, progress.remaining);
  const economy = normalizeEconomyFields(player);
  if (economy.coins < donated) {
    await lock.abort();
    return c.json<ApiError>(
      { status: 'error', message: `You need ${donated} Coins for that pledge.` },
      400,
    );
  }
  const updated = { ...player, ...economy, coins: economy.coins - donated };
  const committed = await lock.commit(async (tx) => {
    await tx.hSet(KEYS.players, { [userId]: JSON.stringify(updated) });
    await tx.hIncrBy(KEYS.landFunding, project.id, donated);
  });
  if (!committed) {
    return c.json<ApiError>({ status: 'error', message: 'Busy, try again' }, 409);
  }

  const nextLand = await store.getLandExpansionState();
  const nextProject = nextLand.projects.find((candidate) => candidate.id === project.id);
  const unlocked = nextProject?.unlocked ?? false;
  const remaining = nextProject?.remaining ?? 0;
  return c.json<LandDonationResponse>({
    type: 'land-donation',
    projectId: project.id,
    donated,
    unlocked,
    economy: economyOf(updated, city.cycle, city.day),
    land: nextLand,
    message: unlocked
      ? `${project.name} unlocked. The city frontier expands.`
      : `${donated} Coins pledged to ${project.name}. ${remaining} remain.`,
  });
});

/**
 * Move shared treasury Coins into the one currently available land project.
 * Any citizen may trigger the transfer because the destination is constrained
 * by the server-authored sequential project list; Coins cannot be withdrawn or
 * redirected to a player. The shared locks serialize simultaneous transfers.
 */
shop.post('/invest', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json<ApiError>({ status: 'error', message: 'Not logged in' }, 401);
  const store = getStore();
  const city = await store.getCityState();
  if (!city || city.status !== 'alive') {
    return c.json<ApiError>({ status: 'error', message: 'The city cannot expand now.' }, 409);
  }

  const body = await parseBody<TreasuryInvestmentRequest>(c);
  if (
    !body ||
    !isLandExpansionId(body.projectId) ||
    !Number.isSafeInteger(body.amount) ||
    body.amount <= 0
  ) {
    return c.json<ApiError>({ status: 'error', message: 'Choose a valid treasury amount.' }, 400);
  }
  const project = landExpansion(body.projectId);
  if (!project) {
    return c.json<ApiError>({ status: 'error', message: 'Unknown land project.' }, 400);
  }

  const lock = await beginUserLock(redis, userId, [
    KEYS.treasuryLock,
    KEYS.landProjectLock(project.id),
  ]);
  const [player, land] = await Promise.all([
    store.getPlayer(userId),
    store.getLandExpansionState(),
  ]);
  if (!player) {
    await lock.abort();
    return c.json<ApiError>({ status: 'error', message: 'Open the game first' }, 409);
  }
  const progress = land.projects.find((candidate) => candidate.id === project.id);
  if (!progress?.available) {
    await lock.abort();
    const message = progress?.unlocked
      ? `${project.name} is already unlocked.`
      : 'Expand the connected district before this one first.';
    return c.json<ApiError>({ status: 'error', message }, 409);
  }

  const treasury = await store.getTreasuryState(player);
  const invested = Math.min(body.amount, progress.remaining);
  if (treasury.balance < invested) {
    await lock.abort();
    return c.json<ApiError>(
      { status: 'error', message: `The treasury holds only ${treasury.balance} Coins.` },
      400,
    );
  }

  const committed = await lock.commit(async (tx) => {
    await tx.hIncrBy(KEYS.cityTreasury, 'balance', -invested);
    await tx.hIncrBy(KEYS.cityTreasury, 'invested', invested);
    await tx.hIncrBy(KEYS.landFunding, project.id, invested);
  });
  if (!committed) {
    return c.json<ApiError>({ status: 'error', message: 'Busy, try again' }, 409);
  }

  const [nextLand, nextTreasury] = await Promise.all([
    store.getLandExpansionState(),
    store.getTreasuryState(player),
  ]);
  const nextProject = nextLand.projects.find((candidate) => candidate.id === project.id);
  const unlocked = nextProject?.unlocked ?? false;
  return c.json<TreasuryInvestmentResponse>({
    type: 'treasury-investment',
    projectId: project.id,
    invested,
    unlocked,
    treasury: nextTreasury,
    land: nextLand,
    message: unlocked
      ? `${project.name} unlocked with the village treasury.`
      : `${invested} treasury Coins invested in ${project.name}. ${nextProject?.remaining ?? 0} remain.`,
  });
});
