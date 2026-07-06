import { describe, expect, it } from 'vitest';
import type { AvatarConfig } from './types';
import {
  AVATAR_NAME_MAX,
  HAIRS,
  HAIR_STYLES,
  OUTFITS,
  SKINS,
  clampAvatar,
  defaultAvatar,
  isValidAvatar,
  sanitizeAvatarName,
} from './avatar';

const good: AvatarConfig = { name: 'Ash', gender: 'nonbinary', skin: 2, hair: 4, hairStyle: 1, outfit: 2 };

describe('sanitizeAvatarName', () => {
  it('trims, collapses whitespace, and caps length', () => {
    expect(sanitizeAvatarName('  Ash   of the   North  ')).toBe('Ash of the North');
    expect(sanitizeAvatarName('x'.repeat(40)).length).toBe(AVATAR_NAME_MAX);
  });

  it('strips control/markup characters but keeps letters, numbers, separators', () => {
    expect(sanitizeAvatarName('Ash<script>')).toBe('Ashscript');
    expect(sanitizeAvatarName("Mara-Jo O'Neil_7")).toBe("Mara-Jo O'Neil_7");
  });

  it('keeps unicode letters', () => {
    expect(sanitizeAvatarName('Renée')).toBe('Renée');
  });
});

describe('isValidAvatar', () => {
  it('accepts a well-formed config', () => {
    expect(isValidAvatar(good)).toBe(true);
  });

  it('rejects too-short names', () => {
    expect(isValidAvatar({ ...good, name: 'a' })).toBe(false);
    expect(isValidAvatar({ ...good, name: '   ' })).toBe(false);
  });

  it('rejects out-of-range indices and bad genders', () => {
    expect(isValidAvatar({ ...good, skin: -1 })).toBe(false);
    expect(isValidAvatar({ ...good, hair: HAIRS.length })).toBe(false);
    expect(isValidAvatar({ ...good, hairStyle: 99 })).toBe(false);
    expect(isValidAvatar({ ...good, outfit: 1.5 })).toBe(false);
    expect(isValidAvatar({ ...good, gender: 'robot' })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isValidAvatar(null)).toBe(false);
    expect(isValidAvatar('nope')).toBe(false);
  });
});

describe('clampAvatar', () => {
  it('clamps every index into range and sanitizes the name', () => {
    const c = clampAvatar({ name: '  Zed!!  ', gender: 'x' as never, skin: 99, hair: -3, hairStyle: 50, outfit: 7.9 });
    expect(c.name).toBe('Zed');
    expect(c.gender).toBe('nonbinary');
    expect(c.skin).toBe(SKINS.length - 1);
    expect(c.hair).toBe(0);
    expect(c.hairStyle).toBe(HAIR_STYLES.length - 1);
    expect(c.outfit).toBeGreaterThanOrEqual(0);
    expect(c.outfit).toBeLessThan(OUTFITS.length);
  });
});

describe('defaultAvatar', () => {
  it('is deterministic per seed and in-range', () => {
    const a = defaultAvatar('t2_abc');
    const b = defaultAvatar('t2_abc');
    expect(a).toEqual(b);
    expect(a.skin).toBeLessThan(SKINS.length);
    expect(a.hair).toBeLessThan(HAIRS.length);
    expect(a.hairStyle).toBeLessThan(HAIR_STYLES.length);
    expect(a.outfit).toBeLessThan(OUTFITS.length);
  });

  it('varies across seeds', () => {
    const seeds = ['a', 'b', 'c', 'd', 'e'].map((s) => JSON.stringify(defaultAvatar(s)));
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });
});
