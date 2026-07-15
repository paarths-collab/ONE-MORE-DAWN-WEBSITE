// Server-authoritative Coin economy and cosmetic catalog. Coins are earned
// through accepted contributions and never purchase gameplay power.

export type ShopItemId =
  // Entry-tier cosmetics (3–12 Coins).
  | 'hearth_lantern'
  | 'crimson_banner'
  | 'garden_plot'
  | 'slate_roof'
  | 'dawn_gold_trim'
  // Higher-tier cosmetics (16–40 Coins) — somewhere for late Coins to go.
  | 'aurora_lantern'
  | 'verdant_grove'
  | 'ivory_banner'
  | 'obsidian_roof'
  | 'celestial_roof'
  // Dawn-beacon patron tiers — the capped, diminishing Coin sink.
  | 'beacon_ember'
  | 'beacon_flame'
  | 'beacon_pyre'
  | 'beacon_dawnfire';

export type CosmeticSlot = 'roof' | 'banner' | 'light' | 'yard';

export type ShopItem = {
  id: ShopItemId;
  name: string;
  slot: CosmeticSlot;
  price: number;
  description: string;
};

/**
 * A Dawn-Beacon patron rung. It is a full ShopItem — so it rides the existing
 * NX-claimed purchase route, priced and idempotency-guarded server-side with no
 * catalog-consumer changes — plus a `renown` value used only by the sink math.
 * The `slot` is inert: patron tiers are never equipped onto the house (the shop
 * never offers EQUIP for them), so the slot value is never rendered.
 */
export type BeaconTier = ShopItem & { renown: number };

export type BeaconTierProgress = BeaconTier & {
  owned: boolean;
  /** Not yet owned, and either the first rung or the previous rung is owned. */
  available: boolean;
};

export type BeaconState = {
  tiers: BeaconTierProgress[];
  /** Cumulative renown, clamped to the cap — diminishing and un-exploitable. */
  standing: number;
  cap: number;
  atCap: boolean;
  /** The next purchasable rung in ladder order, or null once fully patroned. */
  nextTier: ShopItemId | null;
  /** Total Coins the player has poured into owned beacon tiers. */
  coinsInvested: number;
};

export type LandExpansionId = 'outer_fields' | 'river_ward' | 'high_keep';

export type LandExpansionProject = {
  id: LandExpansionId;
  name: string;
  description: string;
  target: number;
  requires: LandExpansionId | null;
};

export type LandExpansionProgress = LandExpansionProject & {
  funded: number;
  remaining: number;
  unlocked: boolean;
  available: boolean;
};

export type LandExpansionState = {
  projects: LandExpansionProgress[];
  activeProjectId: LandExpansionId | null;
  unlocked: LandExpansionId[];
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

/**
 * House cosmetics: the equippable-slot subset the shop dresses onto the player's
 * home. Entry tier (3–12) plus a higher tier (16–40) so a fully-kitted veteran
 * still has Coins to spend before hitting the beacon sink.
 */
export const SHOP_COSMETICS: readonly ShopItem[] = [
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
  {
    id: 'aurora_lantern',
    name: 'Aurora Lantern',
    slot: 'light',
    price: 16,
    description: 'A prismatic lantern that scatters dawnlight across the step.',
  },
  {
    id: 'verdant_grove',
    name: 'Verdant Grove',
    slot: 'yard',
    price: 20,
    description: 'A flowering grove and stone path wrapping your home.',
  },
  {
    id: 'ivory_banner',
    name: 'Ivory Banner',
    slot: 'banner',
    price: 24,
    description: 'A hand-stitched ivory banner of the founding line.',
  },
  {
    id: 'obsidian_roof',
    name: 'Obsidian Roof',
    slot: 'roof',
    price: 30,
    description: 'Volcanic-glass tiles that drink the morning glare.',
  },
  {
    id: 'celestial_roof',
    name: 'Celestial Roof',
    slot: 'roof',
    price: 40,
    description: 'A star-mapped roof that mirrors the night over the dome.',
  },
];

/** Renown clamp for the beacon sink. Held below the raw tier sum (14) so the
 * final rung is a pure act of patronage — Coins spent, status already maxed. */
export const BEACON_RENOWN_CAP = 13;

/**
 * The Dawn Beacon: a personal, non-power Coin sink. Each rung is a one-time,
 * escalating-price purchase granting diminishing renown, hard-capped by
 * BEACON_RENOWN_CAP. Finite + NX-claimed + capped, so late Coins have a
 * meaningful home that can never be farmed into an advantage.
 */
export const BEACON_TIERS: readonly BeaconTier[] = [
  {
    id: 'beacon_ember',
    name: 'Beacon Ember',
    slot: 'light',
    price: 15,
    renown: 5,
    description: 'Kindle the dawn beacon. The city notes an Ember patron.',
  },
  {
    id: 'beacon_flame',
    name: 'Beacon Flame',
    slot: 'light',
    price: 30,
    renown: 4,
    description: 'Feed the beacon to a steady flame above the wall.',
  },
  {
    id: 'beacon_pyre',
    name: 'Beacon Pyre',
    slot: 'light',
    price: 55,
    renown: 3,
    description: 'Raise the beacon into a roaring pyre seen for miles.',
  },
  {
    id: 'beacon_dawnfire',
    name: 'Beacon Dawnfire',
    slot: 'light',
    price: 90,
    renown: 2,
    description: 'Crown the beacon with dawnfire — the city’s foremost patron.',
  },
];

/**
 * The full purchasable catalog. Server pricing, NX-claim, and profile
 * normalization all read this union, so beacon tiers ride the exact same
 * idempotent purchase path as cosmetics with no route changes.
 */
export const SHOP_CATALOG: readonly ShopItem[] = [...SHOP_COSMETICS, ...BEACON_TIERS];

export const LAND_EXPANSIONS: readonly LandExpansionProject[] = [
  {
    id: 'outer_fields',
    name: 'Outer Fields',
    description: 'Open connected farmland, roads, and new house plots.',
    target: 120,
    requires: null,
  },
  {
    id: 'river_ward',
    name: 'River Ward',
    description: 'Extend the city along the river with room for trade and homes.',
    target: 260,
    requires: 'outer_fields',
  },
  {
    id: 'high_keep',
    name: 'High Keep',
    description: 'Claim the connected hill for walls and civic landmarks.',
    target: 450,
    requires: 'river_ward',
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

/**
 * Derive the Dawn-Beacon sink state from a player's owned items. Renown is
 * summed over owned tiers (each counted once, cosmetics and junk ignored) and
 * clamped to BEACON_RENOWN_CAP, so no amount of spending — or malformed save
 * data — can push civic standing past the cap. A rung is `available` once the
 * previous rung is owned, giving the ladder its climb.
 */
export const beaconState = (owned: readonly ShopItemId[]): BeaconState => {
  const ownedSet = new Set(owned);
  let rawRenown = 0;
  let coinsInvested = 0;
  let previousOwned = true; // the first rung has no prerequisite
  let nextTier: ShopItemId | null = null;
  const tiers: BeaconTierProgress[] = BEACON_TIERS.map((tier) => {
    const isOwned = ownedSet.has(tier.id);
    const available = !isOwned && previousOwned;
    if (isOwned) {
      rawRenown += tier.renown;
      coinsInvested += tier.price;
    }
    if (available && nextTier === null) nextTier = tier.id;
    previousOwned = isOwned;
    return { ...tier, owned: isOwned, available };
  });
  const standing = Math.min(BEACON_RENOWN_CAP, rawRenown);
  return {
    tiers,
    standing,
    cap: BEACON_RENOWN_CAP,
    atCap: standing >= BEACON_RENOWN_CAP,
    nextTier,
    coinsInvested,
  };
};

export const landExpansion = (id: string): LandExpansionProject | undefined =>
  LAND_EXPANSIONS.find((project) => project.id === id);

export const isLandExpansionId = (id: unknown): id is LandExpansionId =>
  typeof id === 'string' && landExpansion(id) !== undefined;

export const landExpansionState = (
  rawFunding: Record<string, unknown>,
): LandExpansionState => {
  const projects: LandExpansionProgress[] = [];
  const unlocked: LandExpansionId[] = [];
  let activeProjectId: LandExpansionId | null = null;
  for (const project of LAND_EXPANSIONS) {
    const prerequisiteMet = project.requires === null || unlocked.includes(project.requires);
    const raw = rawFunding[project.id];
    const funded = Math.min(project.target, nonNegativeInteger(raw));
    const projectUnlocked = prerequisiteMet && funded >= project.target;
    const available = prerequisiteMet && !projectUnlocked && activeProjectId === null;
    if (projectUnlocked) unlocked.push(project.id);
    if (available) activeProjectId = project.id;
    projects.push({
      ...project,
      funded,
      remaining: project.target - funded,
      unlocked: projectUnlocked,
      available,
    });
  }
  return { projects, activeProjectId, unlocked };
};

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
