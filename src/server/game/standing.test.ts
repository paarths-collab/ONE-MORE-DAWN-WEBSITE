import { describe, expect, it } from 'vitest';
import { newCityState } from './resolver';
import { buildStanding } from './standing';

describe('buildStanding', () => {
  it('reports survival days and an honest within-sub label', () => {
    const city = { ...newCityState(1), day: 7 };
    expect(buildStanding(city, 3)).toEqual({
      survivalDays: 7,
      rankLabel: 'The city holds · Day 7',
      contributionRank: 3,
    });
  });

  it('flags an imminent raid', () => {
    const city = { ...newCityState(1), day: 4, threat: 95 };
    expect(buildStanding(city, null).rankLabel).toBe('Under raid threat · Day 4');
  });

  it('marks a fallen city and passes a null rank through', () => {
    const city = { ...newCityState(1), day: 9, status: 'fallen' as const };
    expect(buildStanding(city, null)).toEqual({
      survivalDays: 9,
      rankLabel: 'The city fell on day 9',
      contributionRank: null,
    });
  });
});
