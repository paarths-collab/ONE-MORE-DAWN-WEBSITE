import { describe, expect, it } from 'vitest';
import {
  BEACON_RENOWN_CAP,
  BEACON_TIERS,
  ROLE_COSMETICS,
  SHOP_CATALOG,
  SHOP_COSMETICS,
  beaconState,
  economyOf,
  isShopItemId,
  landExpansionState,
  normalizeEconomyFields,
  shopItem,
} from './shop';
import type { ShopItemId } from './shop';
import type { Role } from './types';

describe('shop catalog and economy wire state', () => {
  it('keeps catalog prices server-owned and non-power-bearing', () => {
    expect(shopItem('hearth_lantern')).toMatchObject({
      id: 'hearth_lantern',
      slot: 'light',
      price: 3,
    });
    expect(shopItem('not_real')).toBeUndefined();
  });

  it('preserves valid inventory while dropping unknown, duplicate, and wrong-slot data', () => {
    const normalized = normalizeEconomyFields({
      coins: 20,
      coinsEarnedToday: 2,
      coinsEarnedCycle: 3,
      coinsEarnedDay: 7,
      ownedCosmetics: [
        'hearth_lantern',
        'hearth_lantern',
        'slate_roof',
      ],
      equippedCosmetics: {
        light: 'hearth_lantern',
        banner: 'slate_roof',
        roof: 'slate_roof',
      },
    });
    expect(normalized).toEqual({
      coins: 20,
      coinsEarnedToday: 2,
      coinsEarnedCycle: 3,
      coinsEarnedDay: 7,
      ownedCosmetics: ['hearth_lantern', 'slate_roof'],
      equippedCosmetics: { light: 'hearth_lantern', roof: 'slate_roof' },
    });
  });

  it('reports a stale day or cycle counter as zero without erasing the balance', () => {
    const stored = {
      coins: 9,
      coinsEarnedToday: 5,
      coinsEarnedCycle: 2,
      coinsEarnedDay: 1,
      ownedCosmetics: [],
      equippedCosmetics: {},
    };
    expect(economyOf(stored, 2, 2)).toMatchObject({ coins: 9, earnedToday: 0 });
    expect(economyOf(stored, 3, 1)).toMatchObject({ coins: 9, earnedToday: 0 });
    expect(economyOf(stored, 2, 1)).toMatchObject({ coins: 9, earnedToday: 5 });
  });

  it('unlocks only one connected land district at a time', () => {
    const empty = landExpansionState({});
    expect(empty.activeProjectId).toBe('outer_fields');
    expect(empty.unlocked).toEqual([]);
    expect(empty.projects.map((project) => project.available)).toEqual([true, false, false]);

    const fields = landExpansionState({ outer_fields: 120, river_ward: 40 });
    expect(fields.activeProjectId).toBe('river_ward');
    expect(fields.unlocked).toEqual(['outer_fields']);
    expect(fields.projects[1]).toMatchObject({ funded: 40, remaining: 220, available: true });

    const all = landExpansionState({
      outer_fields: 999,
      river_ward: 260,
      high_keep: 450,
    });
    expect(all.activeProjectId).toBeNull();
    expect(all.unlocked).toEqual(['outer_fields', 'river_ward', 'high_keep']);
    expect(all.projects.map((project) => project.funded)).toEqual([120, 260, 450]);
  });
});

describe('higher-tier cosmetics', () => {
  it('adds premium catalog items priced well above the entry tier', () => {
    // The prestige roof headlines the expansion; all new cosmetics cost more
    // than the original top item (Dawn-Gold Trim at 12) so late Coins have
    // somewhere to go before the sink.
    expect(shopItem('celestial_roof')).toMatchObject({ slot: 'roof', price: 40 });
    expect(shopItem('aurora_lantern')).toMatchObject({ slot: 'light', price: 16 });
    expect(shopItem('verdant_grove')).toMatchObject({ slot: 'yard', price: 20 });
    expect(shopItem('ivory_banner')).toMatchObject({ slot: 'banner', price: 24 });
    expect(shopItem('obsidian_roof')).toMatchObject({ slot: 'roof', price: 30 });
  });

  it('exposes at least four new cosmetics, none of them beacon tiers', () => {
    // SHOP_COSMETICS is the equippable-house subset the shop renders; beacon
    // patron tiers ride the same catalog but are never dressed onto the house.
    const beaconIds = new Set(BEACON_TIERS.map((tier) => tier.id));
    expect(SHOP_COSMETICS.length).toBeGreaterThanOrEqual(9); // 5 original + ≥4 new
    for (const item of SHOP_COSMETICS) expect(beaconIds.has(item.id)).toBe(false);
  });
});

describe('dawn beacon Coin sink', () => {
  it('registers every patron tier as a purchasable catalog item', () => {
    // Riding the shared catalog means the existing NX-claimed purchase route
    // prices and idempotency-guards beacon tiers with zero server changes.
    for (const tier of BEACON_TIERS) {
      expect(isShopItemId(tier.id)).toBe(true);
      expect(shopItem(tier.id)).toMatchObject({ id: tier.id, price: tier.price });
    }
  });

  it('starts empty with only the first rung available', () => {
    const state = beaconState([]);
    expect(state.standing).toBe(0);
    expect(state.cap).toBe(BEACON_RENOWN_CAP);
    expect(state.atCap).toBe(false);
    expect(state.coinsInvested).toBe(0);
    expect(state.nextTier).toBe('beacon_ember');
    expect(state.tiers.map((tier) => tier.available)).toEqual([true, false, false, false]);
  });

  it('unlocks each rung only after the previous is owned', () => {
    const state = beaconState(['beacon_ember']);
    expect(state.standing).toBe(5);
    expect(state.coinsInvested).toBe(15);
    expect(state.nextTier).toBe('beacon_flame');
    expect(state.tiers.find((tier) => tier.id === 'beacon_ember')).toMatchObject({
      owned: true,
      available: false,
    });
    expect(state.tiers.find((tier) => tier.id === 'beacon_flame')).toMatchObject({
      owned: false,
      available: true,
    });
    expect(state.tiers.find((tier) => tier.id === 'beacon_pyre')).toMatchObject({
      owned: false,
      available: false,
    });
  });

  it('grants strictly diminishing renown as the beacon climbs', () => {
    const ember = beaconState(['beacon_ember']).standing;
    const flame = beaconState(['beacon_ember', 'beacon_flame']).standing;
    const pyre = beaconState(['beacon_ember', 'beacon_flame', 'beacon_pyre']).standing;
    expect(flame - ember).toBeLessThan(ember); // +4 < +5
    expect(pyre - flame).toBeLessThan(flame - ember); // +3 < +4
  });

  it('caps standing below the raw renown sum so status cannot be over-bought', () => {
    const all = BEACON_TIERS.map((tier) => tier.id);
    const rawSum = BEACON_TIERS.reduce((sum, tier) => sum + tier.renown, 0);
    const state = beaconState(all);
    expect(rawSum).toBeGreaterThan(BEACON_RENOWN_CAP); // the clamp actually bites
    expect(state.standing).toBe(BEACON_RENOWN_CAP);
    expect(state.atCap).toBe(true);
    expect(state.nextTier).toBeNull();
  });

  it('never exceeds the cap even with duplicate or unknown owned entries', () => {
    const noisy = [
      'beacon_ember',
      'beacon_ember',
      'beacon_flame',
      'beacon_pyre',
      'beacon_dawnfire',
      'beacon_dawnfire',
      'hearth_lantern',
      'not_real',
    ] as ShopItemId[];
    const state = beaconState(noisy);
    expect(state.standing).toBe(BEACON_RENOWN_CAP);
    expect(state.coinsInvested).toBe(190); // each tier counted once: 15+30+55+90
  });

  it('ignores cosmetics when tallying beacon investment', () => {
    const state = beaconState(['hearth_lantern', 'celestial_roof', 'beacon_ember']);
    expect(state.coinsInvested).toBe(15);
    expect(state.standing).toBe(5);
    expect(state.nextTier).toBe('beacon_flame');
  });
});

describe('role cosmetics', () => {
  const ROLES: Role[] = ['farmer', 'engineer', 'medic', 'guard', 'scout', 'speaker'];

  it('gives every role a signature set, each purchasable and role-tagged', () => {
    for (const role of ROLES) {
      const items = ROLE_COSMETICS.filter((item) => item.role === role);
      expect(items.length).toBeGreaterThanOrEqual(1);
      for (const item of items) {
        expect(item.role).toBe(role);
        expect(item.price).toBeGreaterThan(0);
        expect(isShopItemId(item.id)).toBe(true); // valid id -> in SHOP_CATALOG
        expect(SHOP_CATALOG).toContain(item); // rides the purchase/normalize path
      }
    }
  });

  it('keeps role items out of the ungated house grid (they render in the role section)', () => {
    for (const item of ROLE_COSMETICS) {
      expect(SHOP_COSMETICS).not.toContain(item);
    }
  });

  it('normalizes/keeps an owned role cosmetic regardless of the wearer', () => {
    const normalized = normalizeEconomyFields({ ownedCosmetics: ['farm_harvest_wreath'] });
    expect(normalized.ownedCosmetics).toEqual(['farm_harvest_wreath']);
  });
});
