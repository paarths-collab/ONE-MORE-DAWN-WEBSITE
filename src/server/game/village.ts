import type { ActionType, PlayerProfile, Villager, VillageZone } from '../../shared/types';
import { hashString } from '../../shared/rng';

/**
 * Pure shaping helpers for GET /api/village (see docs/design/DESIGN_SYSTEM.md).
 * No I/O and no Devvit imports — unit-tested directly.
 */

/** Payload cap: the village renders at most this many walking villagers. */
export const VILLAGER_CAP = 20;

/**
 * Privacy mask (design's "SANDBOXED · MASKED" theme): keep a short recognizable
 * prefix, hide the rest. 1–2 char names have nothing left to hide.
 */
export const maskName = (username: string): string =>
  username.length <= 2 ? username : username.slice(0, Math.min(4, username.length - 1)) + '•••';

/**
 * Fixed avatar-body palette drawn from the design system (accents + terrain),
 * so every generated villager stays on-theme. Order is a contract: colors are
 * picked by stable hash, so reordering would recolor everyone.
 */
export const VILLAGER_PALETTE: readonly number[] = [
  0xe8c34a, // gold (primary accent)
  0x4caf50, // green (ok/online)
  0x6c8be0, // blue (info)
  0xa03030, // red (danger)
  0x5b8c3a, // grass green
  0x3a78a0, // water blue
  0xd9c79b, // shoreline sand
  0x8f6a42, // dock brown
];

/** Stable per-user avatar color: same user always renders the same body. */
export const villagerColor = (userId: string): number =>
  VILLAGER_PALETTE[hashString(userId) % VILLAGER_PALETTE.length]!;

export const toVillager = (p: PlayerProfile, cityDay: number): Villager => ({
  maskedName: maskName(p.username),
  role: p.role,
  faction: p.faction,
  color: villagerColor(p.userId),
  online: p.lastActiveDay === cityDay,
  since: `day ${p.lastActiveDay}`,
});

/** Online first, then most recently active, capped for payload size. */
export const buildVillagers = (players: PlayerProfile[], cityDay: number): Villager[] =>
  [...players]
    .sort((a, b) => {
      const aOnline = a.lastActiveDay === cityDay ? 1 : 0;
      const bOnline = b.lastActiveDay === cityDay ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      return b.lastActiveDay - a.lastActiveDay;
    })
    .slice(0, VILLAGER_CAP)
    .map((p) => toVillager(p, cityDay));

/** Zone id → building name on the village map (DESIGN_SYSTEM.md game mapping). */
const ZONE_NAMES: Record<ActionType, string> = {
  grow_food: 'Farm',
  repair_power: 'Generator',
  treat_sick: 'Clinic',
  guard_wall: 'Watchtower',
};

/** One zone per ActionType, count = today's aggregate action tally. */
export const buildZones = (dayActions: Record<string, number>): VillageZone[] =>
  (Object.keys(ZONE_NAMES) as ActionType[]).map((id) => ({
    id,
    name: ZONE_NAMES[id],
    count: dayActions[id] ?? 0,
  }));
