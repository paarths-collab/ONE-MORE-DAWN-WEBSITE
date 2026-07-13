// Server-authoritative Coin economy and cosmetic catalog. Coins are earned
// through accepted contributions and never purchase gameplay power.

export type ShopItemId =
  | 'hearth_lantern'
  | 'crimson_banner'
  | 'garden_plot'
  | 'slate_roof'
  | 'dawn_gold_trim';

export type CosmeticSlot = 'roof' | 'banner' | 'light' | 'yard';

export type ShopItem = {
  id: ShopItemId;
  name: string;
  slot: CosmeticSlot;
  price: number;
  description: string;
};

export type EconomyState = {
  coins: number;
  earnedToday: number;
  dailyCap: number;
  owned: ShopItemId[];
  equipped: Partial<Record<CosmeticSlot, ShopItemId>>;
};

/** Optional because profiles written before the economy shipped lack them. */
export type EconomyFields = {
  coins?: number;
  coinsEarnedToday?: number;
  coinsEarnedCycle?: number;
  coinsEarnedDay?: number;
  ownedCosmetics?: ShopItemId[];
  equippedCosmetics?: Partial<Record<CosmeticSlot, ShopItemId>>;
};

export type NormalizedEconomyFields = {
  coins: number;
  coinsEarnedToday: number;
  coinsEarnedCycle: number;
  coinsEarnedDay: number;
  ownedCosmetics: ShopItemId[];
  equippedCosmetics: Partial<Record<CosmeticSlot, ShopItemId>>;
};

export const COIN_DAILY_CAP = 5;
export const COIN_PER_CONTRIBUTION = 1;

export const SHOP_CATALOG: readonly ShopItem[] = [
  {
    id: 'hearth_lantern',
    name: 'Hearth Lantern',
    slot: 'light',
    price: 3,
    description: 'A warm lantern glows by your door.',
  },
  {
    id: 'crimson_banner',
    name: 'Crimson Banner',
    slot: 'banner',
    price: 5,
    description: 'A survivor banner marks your house.',
  },
  {
    id: 'garden_plot',
    name: 'Garden Plot',
    slot: 'yard',
    price: 6,
    description: 'A planter and fence beside your house.',
  },
  {
    id: 'slate_roof',
    name: 'Slate Roof',
    slot: 'roof',
    price: 8,
    description: 'A dark slate roof, built to last.',
  },
  {
    id: 'dawn_gold_trim',
    name: 'Dawn-Gold Trim',
    slot: 'roof',
    price: 12,
    description: 'Gold trim and ridge cap for the dawn-faithful.',
  },
];

const COSMETIC_SLOTS: readonly CosmeticSlot[] = ['roof', 'banner', 'light', 'yard'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonNegativeInteger = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

export const shopItem = (id: string): ShopItem | undefined =>
  SHOP_CATALOG.find((item) => item.id === id);

export const isShopItemId = (id: unknown): id is ShopItemId =>
  typeof id === 'string' && shopItem(id) !== undefined;

const normalizeOwned = (value: unknown): ShopItemId[] => {
  if (!Array.isArray(value)) return [];
  const owned: ShopItemId[] = [];
  for (const candidate of value) {
    if (isShopItemId(candidate) && !owned.includes(candidate)) owned.push(candidate);
  }
  return owned;
};

const normalizeEquipped = (
  value: unknown,
  owned: readonly ShopItemId[],
): Partial<Record<CosmeticSlot, ShopItemId>> => {
  if (!isRecord(value)) return {};
  const equipped: Partial<Record<CosmeticSlot, ShopItemId>> = {};
  for (const slot of COSMETIC_SLOTS) {
    const itemId = value[slot];
    if (!isShopItemId(itemId) || !owned.includes(itemId)) continue;
    if (shopItem(itemId)?.slot === slot) equipped[slot] = itemId;
  }
  return equipped;
};

/**
 * Runtime normalization for legacy or malformed player JSON. Valid economy
 * data is preserved; invalid numbers, unknown items, duplicates, and impossible
 * slot assignments fail closed.
 */
export const normalizeEconomyFields = (player: EconomyFields): NormalizedEconomyFields => {
  const ownedCosmetics = normalizeOwned(player.ownedCosmetics);
  return {
    coins: nonNegativeInteger(player.coins),
    coinsEarnedToday: Math.min(
      COIN_DAILY_CAP,
      nonNegativeInteger(player.coinsEarnedToday),
    ),
    coinsEarnedCycle: nonNegativeInteger(player.coinsEarnedCycle),
    coinsEarnedDay: nonNegativeInteger(player.coinsEarnedDay),
    ownedCosmetics,
    equippedCosmetics: normalizeEquipped(player.equippedCosmetics, ownedCosmetics),
  };
};

/** Public wire view. A stale cycle/day counter reads as zero until next award. */
export const economyOf = (
  player: EconomyFields,
  cityCycle: number,
  cityDay: number,
): EconomyState => {
  const economy = normalizeEconomyFields(player);
  const earnedToday =
    economy.coinsEarnedCycle === cityCycle && economy.coinsEarnedDay === cityDay
      ? economy.coinsEarnedToday
      : 0;
  return {
    coins: economy.coins,
    earnedToday,
    dailyCap: COIN_DAILY_CAP,
    owned: [...economy.ownedCosmetics],
    equipped: { ...economy.equippedCosmetics },
  };
};
