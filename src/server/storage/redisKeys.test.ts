import { describe, expect, it } from 'vitest';
import { KEYS } from './redisKeys';

describe('redis keys', () => {
  it('produces stable day-scoped keys', () => {
    expect(KEYS.dayActions(7)).toBe('day:7:actions');
    expect(KEYS.dayUserActions(7)).toBe('day:7:userActions');
    expect(KEYS.dayVotes(7)).toBe('day:7:votes');
    expect(KEYS.dayVoters(7)).toBe('day:7:voters');
    expect(KEYS.dayMissions(7)).toBe('day:7:missions');
    expect(KEYS.dayFactionInfluence(7)).toBe('day:7:factionInfluence');
    expect(KEYS.dayStrategyPlan(7)).toBe('day:7:strategyPlan');
    expect(KEYS.dayStrategyVoters(7)).toBe('day:7:strategyVoters');
  });

  it('exposes fixed collection keys', () => {
    expect(KEYS.cityState).toBe('city:state');
    expect(KEYS.cityMeta).toBe('city:meta');
    expect(KEYS.players).toBe('players');
    expect(KEYS.missionToken('tok-1')).toBe('mission:token:tok-1');
    expect(KEYS.lbContribution).toBe('lb:contribution');
    expect(KEYS.lbScouts).toBe('lb:scouts');
    expect(KEYS.timeline).toBe('timeline');
    expect(KEYS.cityHistory).toBe('city:history');
    expect(KEYS.resolverLock).toBe('resolver:lock');
    expect(KEYS.gameConfig).toBe('game:config');
  });
});
