import { describe, expect, it } from 'vitest';
import type { InitResponse } from '../../../shared/types';
import { cityMood } from './CitySky';

// cityMood only reads city.status, city.morale, city.threat, and raidInDays.
const make = (over: { status?: 'alive' | 'fallen'; morale?: number; threat?: number; raidInDays?: number }): InitResponse =>
  ({
    city: {
      status: over.status ?? 'alive',
      morale: over.morale ?? 55,
      threat: over.threat ?? 50,
    },
    raidInDays: over.raidInDays ?? 5,
  }) as unknown as InitResponse;

describe('cityMood', () => {
  it('is fallen when the city is dead, regardless of vitals', () => {
    expect(cityMood(make({ status: 'fallen', morale: 90, threat: 0 }))).toBe('fallen');
  });

  it('is raid when a raid lands today or tomorrow', () => {
    expect(cityMood(make({ raidInDays: 1 }))).toBe('raid');
    expect(cityMood(make({ raidInDays: 0 }))).toBe('raid');
  });

  it('raid outranks strained vitals', () => {
    expect(cityMood(make({ raidInDays: 1, morale: 10, threat: 99 }))).toBe('raid');
  });

  it('is strained on low morale or high threat', () => {
    expect(cityMood(make({ morale: 30 }))).toBe('strained');
    expect(cityMood(make({ threat: 70 }))).toBe('strained');
  });

  it('is thriving on high morale and low threat', () => {
    expect(cityMood(make({ morale: 80, threat: 20 }))).toBe('thriving');
  });

  it('is holding in the middle', () => {
    expect(cityMood(make({ morale: 55, threat: 50 }))).toBe('holding');
  });
});
