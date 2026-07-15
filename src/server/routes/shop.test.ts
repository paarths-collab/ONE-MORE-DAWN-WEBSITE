import { beforeEach, describe, expect, it, vi } from 'vitest';
import { context, redis, reddit } from '@devvit/web/server';
import type {
  LandDonationResponse,
  ShopPurchaseResponse,
  TreasuryInvestmentResponse,
} from '../../shared/types';
import { shopItem } from '../../shared/shop';
import { api } from './api';
import { shop } from './shop';
import { KEYS } from '../storage/redisKeys';
import { Store } from '../storage/store';
import { makeFakeRedis, type FakeRedis } from '../storage/store.test';

vi.mock('@devvit/web/server', () => ({
  context: {
    userId: undefined,
    subredditId: 't5_test',
    subredditName: 'testsub',
    postId: 't3_post',
  },
  reddit: {
    getCurrentUser: vi.fn(),
    getCurrentSubreddit: vi.fn(),
    getCurrentUsername: vi.fn(),
    submitCustomPost: vi.fn(),
  },
  redis: {},
}));

const redditUsernameMock = vi.mocked(reddit.getCurrentUsername);
const setUser = (userId: string | undefined) => Object.assign(context, { userId });

let fake: FakeRedis;
let store: Store;

const postJson = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const lantern = shopItem('hearth_lantern');
if (!lantern) throw new Error('Hearth Lantern missing from the shared catalog');

const openRichUser = async (userId: string, coins: number) => {
  setUser(userId);
  redditUsernameMock.mockResolvedValueOnce('spender');
  expect((await api.request('/init')).status).toBe(200);
  const player = await store.getPlayer(userId);
  if (!player) throw new Error('Expected /init to persist the player');
  await store.savePlayer({ ...player, coins });
};

beforeEach(() => {
  vi.clearAllMocks();
  fake = makeFakeRedis();
  Object.assign(redis, fake);
  store = new Store(fake);
});

describe('POST /shop/purchase', () => {
  it('debits the exact catalog price once and records ownership', async () => {
    await openRichUser('t2_buyer', 10);
    const response = await shop.request('/purchase', postJson({ itemId: lantern.id }));
    expect(response.status).toBe(200);
    const body: ShopPurchaseResponse = await response.json();
    expect(body.economy.coins).toBe(10 - lantern.price);
    expect(body.economy.owned).toEqual([lantern.id]);
    expect(body.message).toContain('Hearth Lantern purchased');
    expect(await store.getPlayer('t2_buyer')).toMatchObject({
      coins: 10 - lantern.price,
      ownedCosmetics: [lantern.id],
    });
  });

  it('rejects duplicate, unaffordable, and unknown purchases without charging', async () => {
    await openRichUser('t2_buyer', 10);
    expect((await shop.request('/purchase', postJson({ itemId: lantern.id }))).status).toBe(200);
    expect((await shop.request('/purchase', postJson({ itemId: lantern.id }))).status).toBe(409);
    expect((await store.getPlayer('t2_buyer'))?.coins).toBe(10 - lantern.price);

    await openRichUser('t2_broke', 2);
    expect((await shop.request('/purchase', postJson({ itemId: lantern.id }))).status).toBe(400);
    expect((await store.getPlayer('t2_broke'))?.coins).toBe(2);
    expect((await shop.request('/purchase', postJson({ itemId: 'free_castle' }))).status).toBe(400);
  });

  it('ignores a forged client price and uses the catalog', async () => {
    await openRichUser('t2_forger', 10);
    const response = await shop.request(
      '/purchase',
      postJson({ itemId: lantern.id, price: 0, coins: 9999 }),
    );
    expect(response.status).toBe(200);
    expect((await store.getPlayer('t2_forger'))?.coins).toBe(10 - lantern.price);
  });

  it('rejects unauthenticated and player-less calls', async () => {
    setUser(undefined);
    expect((await shop.request('/purchase', postJson({ itemId: lantern.id }))).status).toBe(401);
    await openRichUser('t2_seed', 0);
    setUser('t2_ghost');
    expect((await shop.request('/purchase', postJson({ itemId: lantern.id }))).status).toBe(409);
  });

  it('never double-charges two concurrent same-user purchases', async () => {
    await openRichUser('t2_race', 20);
    const [first, second] = await Promise.all([
      shop.request('/purchase', postJson({ itemId: lantern.id })),
      shop.request('/purchase', postJson({ itemId: 'crimson_banner' })),
    ]);
    const saved = await store.getPlayer('t2_race');
    if (!saved) throw new Error('Expected buyer profile');
    const successes = [first.status, second.status].filter((status) => status === 200).length;
    expect(successes).toBeGreaterThanOrEqual(1);
    expect(successes).toBeLessThanOrEqual(2);
    const expectedSpend = (saved.ownedCosmetics ?? []).reduce(
      (sum, itemId) => sum + (shopItem(itemId)?.price ?? 0),
      0,
    );
    expect(saved.coins).toBe(20 - expectedSpend);
  });
});

describe('POST /shop/equip', () => {
  it('equips only owned items and replaces another item in the same slot', async () => {
    await openRichUser('t2_roofer', 30);
    expect((await shop.request('/equip', postJson({ itemId: 'slate_roof' }))).status).toBe(400);
    expect((await shop.request('/purchase', postJson({ itemId: 'slate_roof' }))).status).toBe(200);
    expect((await shop.request('/equip', postJson({ itemId: 'slate_roof' }))).status).toBe(200);
    expect((await shop.request('/purchase', postJson({ itemId: 'dawn_gold_trim' }))).status).toBe(200);
    expect((await shop.request('/equip', postJson({ itemId: 'dawn_gold_trim' }))).status).toBe(200);
    expect(await store.getPlayer('t2_roofer')).toMatchObject({
      coins: 10,
      ownedCosmetics: ['slate_roof', 'dawn_gold_trim'],
      equippedCosmetics: { roof: 'dawn_gold_trim' },
    });
  });

  it('fails safely when stored economy fields are malformed', async () => {
    await openRichUser('t2_corrupt', 10);
    const player = await store.getPlayer('t2_corrupt');
    if (!player) throw new Error('Expected player profile');
    await fake.hSet(KEYS.players, {
      t2_corrupt: JSON.stringify({
        ...player,
        ownedCosmetics: 'invalid',
        equippedCosmetics: 7,
        coins: -3,
      }),
    });
    expect((await shop.request('/equip', postJson({ itemId: lantern.id }))).status).toBe(400);
    expect((await shop.request('/purchase', postJson({ itemId: lantern.id }))).status).toBe(400);
  });
});

describe('POST /shop/donate', () => {
  it('pools Coins into the active connected district', async () => {
    await openRichUser('t2_builder', 200);
    const response = await shop.request(
      '/donate',
      postJson({ projectId: 'outer_fields', amount: 50 }),
    );
    expect(response.status).toBe(200);
    const body: LandDonationResponse = await response.json();
    expect(body).toMatchObject({
      projectId: 'outer_fields',
      donated: 50,
      unlocked: false,
      economy: { coins: 150 },
    });
    expect(body.land.projects[0]).toMatchObject({ funded: 50, remaining: 70 });
  });

  it('caps the final pledge at the remaining target and unlocks the next district', async () => {
    await openRichUser('t2_finisher', 20);
    await fake.hSet(KEYS.landFunding, { outer_fields: '115' });
    const response = await shop.request(
      '/donate',
      postJson({ projectId: 'outer_fields', amount: 20, target: 1 }),
    );
    expect(response.status).toBe(200);
    const body: LandDonationResponse = await response.json();
    expect(body.donated).toBe(5);
    expect(body.unlocked).toBe(true);
    expect(body.economy.coins).toBe(15);
    expect(body.land.activeProjectId).toBe('river_ward');
  });

  it('rejects out-of-order, malformed, and unaffordable land funding', async () => {
    await openRichUser('t2_land', 10);
    expect((await shop.request('/donate', postJson({ projectId: 'river_ward', amount: 1 }))).status).toBe(409);
    expect((await shop.request('/donate', postJson({ projectId: 'outer_fields', amount: 0 }))).status).toBe(400);
    expect((await shop.request('/donate', postJson({ projectId: 'unknown', amount: 1 }))).status).toBe(400);
    expect((await shop.request('/donate', postJson({ projectId: 'outer_fields', amount: 11 }))).status).toBe(400);
    expect((await store.getPlayer('t2_land'))?.coins).toBe(10);
  });

  it('never charges twice when two taps race to finish the same district', async () => {
    await openRichUser('t2_land_race', 20);
    await fake.hSet(KEYS.landFunding, { outer_fields: '110' });
    const [first, second] = await Promise.all([
      shop.request('/donate', postJson({ projectId: 'outer_fields', amount: 10 })),
      shop.request('/donate', postJson({ projectId: 'outer_fields', amount: 10 })),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect((await store.getPlayer('t2_land_race'))?.coins).toBe(10);
    expect((await store.getLandExpansionState()).projects[0]).toMatchObject({
      funded: 120,
      unlocked: true,
    });
  });
});

describe('POST /shop/invest', () => {
  it('moves only the amount needed from the shared treasury into active land', async () => {
    await openRichUser('t2_steward', 0);
    await fake.hSet(KEYS.cityTreasury, { balance: '12', collected: '20', invested: '8' });
    await fake.hSet(KEYS.landFunding, { outer_fields: '115' });

    const response = await shop.request(
      '/invest',
      postJson({ projectId: 'outer_fields', amount: 12 }),
    );
    expect(response.status).toBe(200);
    const body: TreasuryInvestmentResponse = await response.json();
    expect(body).toMatchObject({
      projectId: 'outer_fields',
      invested: 5,
      unlocked: true,
      treasury: { balance: 7, totalCollected: 20, totalInvested: 13 },
    });
    expect(body.land.activeProjectId).toBe('river_ward');
    expect((await store.getPlayer('t2_steward'))?.coins).toBe(0);
  });

  it('rejects overdrafts, malformed requests, and out-of-order projects', async () => {
    await openRichUser('t2_steward', 0);
    await fake.hSet(KEYS.cityTreasury, { balance: '3' });
    expect((await shop.request('/invest', postJson({ projectId: 'outer_fields', amount: 4 }))).status).toBe(400);
    expect((await shop.request('/invest', postJson({ projectId: 'river_ward', amount: 1 }))).status).toBe(409);
    expect((await shop.request('/invest', postJson({ projectId: 'outer_fields', amount: 0 }))).status).toBe(400);
    const player = await store.getPlayer('t2_steward');
    if (!player) throw new Error('Expected steward profile');
    expect((await store.getTreasuryState(player)).balance).toBe(3);
  });

  it('serializes two same-user taps so the treasury cannot be spent twice', async () => {
    await openRichUser('t2_steward', 0);
    await fake.hSet(KEYS.cityTreasury, { balance: '10' });
    await fake.hSet(KEYS.landFunding, { outer_fields: '110' });
    const [first, second] = await Promise.all([
      shop.request('/invest', postJson({ projectId: 'outer_fields', amount: 10 })),
      shop.request('/invest', postJson({ projectId: 'outer_fields', amount: 10 })),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const player = await store.getPlayer('t2_steward');
    if (!player) throw new Error('Expected steward profile');
    expect((await store.getTreasuryState(player)).balance).toBe(0);
    expect((await store.getLandExpansionState()).projects[0]).toMatchObject({ funded: 120, unlocked: true });
  });
});

describe('POST /shop/purchase — role-gated cosmetics', () => {
  const roleItem = shopItem('farm_harvest_wreath'); // farmer-only
  if (!roleItem) throw new Error('farm_harvest_wreath missing from the catalog');

  const openRoledUser = async (userId: string, role: 'farmer' | 'guard', coins: number) => {
    setUser(userId);
    redditUsernameMock.mockResolvedValueOnce('roleplayer');
    expect((await api.request('/init')).status).toBe(200);
    const player = await store.getPlayer(userId);
    if (!player) throw new Error('Expected /init to persist the player');
    await store.savePlayer({ ...player, role, coins });
  };

  it('lets the matching role buy its signature cosmetic', async () => {
    await openRoledUser('t2_farmer', 'farmer', 30);
    const res = await shop.request('/purchase', postJson({ itemId: roleItem.id }));
    expect(res.status).toBe(200);
    const body: ShopPurchaseResponse = await res.json();
    expect(body.economy.owned).toContain(roleItem.id);
    expect(body.economy.coins).toBe(30 - roleItem.price);
  });

  it('rejects a different role with 403 and charges nothing', async () => {
    await openRoledUser('t2_guard', 'guard', 30);
    const res = await shop.request('/purchase', postJson({ itemId: roleItem.id }));
    expect(res.status).toBe(403);
    expect(await store.getPlayer('t2_guard')).toMatchObject({ coins: 30, ownedCosmetics: [] });
  });

  it('keeps an owned role cosmetic equippable after the player changes role', async () => {
    await openRoledUser('t2_switch', 'farmer', 30);
    expect((await shop.request('/purchase', postJson({ itemId: roleItem.id }))).status).toBe(200);
    // Switch away from farmer — ownership and equipping must survive it.
    const p = await store.getPlayer('t2_switch');
    await store.savePlayer({ ...p!, role: 'guard' });
    const equip = await shop.request('/equip', postJson({ itemId: roleItem.id }));
    expect(equip.status).toBe(200);
    expect((await store.getPlayer('t2_switch'))?.equippedCosmetics?.[roleItem.slot]).toBe(roleItem.id);
  });
});
