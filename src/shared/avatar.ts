import type { AvatarConfig, Gender } from './types';
import { hashString } from './rng';

/**
 * Avatar palettes + validation — the single source of truth shared by the
 * client renderer/creator and the server's /api/avatar validator. AvatarConfig
 * stores INDICES into these arrays (not hex), so the two sides can never drift
 * and the server can bounds-check every field. Order is a contract: reordering
 * would recolor everyone who already saved an avatar.
 */

/** Skin tones (light → deep). */
export const SKINS: readonly string[] = [
  '#f4d3b0',
  '#e8b98c',
  '#cf9a6b',
  '#a9704a',
  '#7d4f30',
  '#553a24',
];

/** Hair colors. */
export const HAIRS: readonly string[] = [
  '#241c14', // near-black
  '#4a3020', // dark brown
  '#7a4b26', // brown
  '#b9793a', // auburn
  '#d9b25a', // blonde
  '#c85040', // red/dyed
  '#8f8578', // grey
  '#8a5cc0', // dyed violet
  '#4a7fc0', // dyed blue
];

/** Hair styles — index maps to a shape in the client renderer. */
export const HAIR_STYLES: readonly string[] = [
  'Crop',
  'Swoop',
  'Long',
  'Spikes',
  'Cap',
  'Bald',
];

/** Outfit (body) colors — drawn from the pixel design accents. */
export const OUTFITS: readonly string[] = [
  '#e8c34a', // gold
  '#57c06a', // green
  '#6c8be0', // blue
  '#c85040', // red
  '#b79bff', // violet
  '#e29a4a', // orange
  '#d9c79b', // sand
  '#6f6357', // slate
];

export const GENDERS: readonly Gender[] = ['woman', 'man', 'nonbinary'];

/** Display label + pronoun for a chosen gender (flavor text only). */
export const GENDER_META: Record<Gender, { label: string; subject: string; object: string }> = {
  woman: { label: 'Woman', subject: 'she', object: 'her' },
  man: { label: 'Man', subject: 'he', object: 'him' },
  nonbinary: { label: 'Non-binary', subject: 'they', object: 'them' },
};

export const AVATAR_NAME_MIN = 2;
export const AVATAR_NAME_MAX = 18;

/**
 * Trim a raw name to the allowed shape: unicode letters/numbers plus a few
 * separators, collapsed whitespace, capped length. Returns '' if nothing valid
 * survives — callers decide whether that's an error.
 */
export const sanitizeAvatarName = (raw: string): string =>
  raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} '_.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, AVATAR_NAME_MAX);

const inRange = (n: unknown, len: number): boolean =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < len;

/** True only for a fully-valid config (name length + every index in range). */
export const isValidAvatar = (a: unknown): a is AvatarConfig => {
  if (!a || typeof a !== 'object') return false;
  const v = a as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    sanitizeAvatarName(v.name).length >= AVATAR_NAME_MIN &&
    typeof v.gender === 'string' &&
    (GENDERS as readonly string[]).includes(v.gender) &&
    inRange(v.skin, SKINS.length) &&
    inRange(v.hair, HAIRS.length) &&
    inRange(v.hairStyle, HAIR_STYLES.length) &&
    inRange(v.outfit, OUTFITS.length)
  );
};

const clampIndex = (n: unknown, len: number): number => {
  const i = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 0;
  return Math.max(0, Math.min(len - 1, i));
};

/**
 * Coerce an untrusted config into a safe one: clamp every index into range and
 * sanitize the name. Used server-side so a malformed client payload can never
 * store an out-of-bounds index. The name is NOT length-checked here — validate
 * with isValidAvatar first for the min-length rule.
 */
export const clampAvatar = (a: AvatarConfig): AvatarConfig => ({
  name: sanitizeAvatarName(a.name),
  gender: (GENDERS as readonly string[]).includes(a.gender) ? a.gender : 'nonbinary',
  skin: clampIndex(a.skin, SKINS.length),
  hair: clampIndex(a.hair, HAIRS.length),
  hairStyle: clampIndex(a.hairStyle, HAIR_STYLES.length),
  outfit: clampIndex(a.outfit, OUTFITS.length),
});

/**
 * A deterministic starter avatar seeded from a string (e.g. the userId), so the
 * creator opens on a stable-but-varied look instead of the same one for
 * everyone. Name defaults to a neutral placeholder the player overwrites.
 */
export const defaultAvatar = (seed: string, name = ''): AvatarConfig => {
  const h = hashString(seed);
  return {
    name,
    gender: GENDERS[h % GENDERS.length]!,
    skin: (h >>> 3) % SKINS.length,
    hair: (h >>> 7) % HAIRS.length,
    hairStyle: (h >>> 11) % HAIR_STYLES.length,
    outfit: (h >>> 15) % OUTFITS.length,
  };
};
