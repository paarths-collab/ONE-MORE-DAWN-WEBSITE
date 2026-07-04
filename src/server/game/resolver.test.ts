import { describe, expect, it } from 'vitest';
import { newCityState, resolveDay, type DayInputs } from './resolver';
import { BALANCE } from '../../shared/balance';
import type { CityState } from '../../shared/types';

const city = (over: Partial<CityState> = {}): CityState => ({
  ...newCityState(1),
  day: 3,
  crisisId: 'refugee_convoy',
  ...over,
});

const noInputs: DayInputs = {
  actions: {},
  missions: {},
  crisisVotes: {},
  roleCounts: {},
};

describe('resolveDay', () => {
  it('advances the day and consumes food per population', () => {
    const { city: next } = resolveDay(city({ population: 100, food: 50 }), noInputs);
    expect(next.day).toBe(4);
    expect(next.food).toBe(50 - Math.ceil(100 * BALANCE.foodPerPopulation));
  });

  it('applies action effects: farming adds food', () => {
    const base = resolveDay(city(), noInputs).city.food;
    const farmed = resolveDay(city(), { ...noInputs, actions: { grow_food: 4 } }).city.food;
    expect(farmed).toBe(base + 4 * BALANCE.actionEffects.grow_food.food!);
  });

  it('applies the winning crisis option effects', () => {
    const { city: next, entry } = resolveDay(
      city({ population: 100 }),
      { ...noInputs, crisisVotes: { a: 5, b: 2 } },
    );
    expect(next.population).toBe(100 + 30);
    expect(entry.winningOptionId).toBe('a');
  });

  it('resolves tie-breaks by option order (a beats b at equal votes)', () => {
    const { entry } = resolveDay(city(), { ...noInputs, crisisVotes: { b: 3, a: 3 } });
    expect(entry.winningOptionId).toBe('a');
  });

  it('no votes -> no crisis effects, recorded as null', () => {
    const { entry } = resolveDay(city(), noInputs);
    expect(entry.winningOptionId).toBeNull();
  });

  it('adds mission loot to city stores', () => {
    const { city: next } = resolveDay(city({ food: 40, medicine: 10 }), {
      ...noInputs,
      missions: { totalFood: 6, totalMedicine: 3, totalScrap: 4, totalRuns: 3, injuries: 1 },
    });
    expect(next.medicine).toBeGreaterThanOrEqual(10 + 3 - BALANCE.sickness.medicineCostPerDay);
    expect(next.food).toBe(40 + 6 - Math.ceil(next.population * BALANCE.foodPerPopulation));
  });

  it('hunger kills and demoralizes when food runs out', () => {
    const { city: next, entry } = resolveDay(city({ food: 2, population: 100, morale: 50 }), noInputs);
    expect(next.food).toBe(0);
    expect(next.population).toBeLessThan(100);
    expect(next.morale).toBeLessThanOrEqual(50 - BALANCE.hunger.moralePenalty);
    expect(entry.events.some((e) => e.toLowerCase().includes('hunger'))).toBe(true);
  });

  it('threat rises passively and is reduced by guards', () => {
    const passive = resolveDay(city({ threat: 40 }), noInputs).city.threat;
    expect(passive).toBe(40 + BALANCE.passiveThreatRise);
    const guarded = resolveDay(city({ threat: 40 }), { ...noInputs, actions: { guard_wall: 3 } }).city.threat;
    expect(guarded).toBe(40 + BALANCE.passiveThreatRise + 3 * BALANCE.actionEffects.guard_wall.threat!);
  });

  it('clamps percentages to 0..100 and stocks to >= 0', () => {
    const { city: next } = resolveDay(
      city({ morale: 2, power: 1, food: 0, medicine: 0, threat: 99 }),
      noInputs,
    );
    expect(next.morale).toBeGreaterThanOrEqual(0);
    expect(next.power).toBeGreaterThanOrEqual(0);
    expect(next.threat).toBeLessThanOrEqual(100);
    expect(next.food).toBeGreaterThanOrEqual(0);
  });

  it('city falls when population collapses', () => {
    const { city: next } = resolveDay(city({ population: 11, food: 0, morale: 5, medicine: 0 }), noInputs);
    if (next.population <= BALANCE.fall.populationThreshold) {
      expect(next.status).toBe('fallen');
    }
  });

  it('picks a new crisis different from the current one', () => {
    const { city: next } = resolveDay(city(), noInputs);
    expect(next.crisisId).not.toBe('refugee_convoy');
  });

  it('is deterministic: same inputs, same outputs', () => {
    const inputs: DayInputs = {
      actions: { grow_food: 2, guard_wall: 1 },
      missions: { totalFood: 3, totalRuns: 2, injuries: 0 },
      crisisVotes: { b: 4 },
      roleCounts: { speaker: 2 },
    };
    expect(resolveDay(city(), inputs)).toEqual(resolveDay(city(), inputs));
  });

  it('speaker actions lift morale', () => {
    const base = resolveDay(city({ morale: 50 }), noInputs).city.morale;
    const spoken = resolveDay(city({ morale: 50 }), { ...noInputs, roleCounts: { speaker: 3 } }).city.morale;
    expect(spoken).toBe(base + 3 * BALANCE.speakerMoralePerAction);
  });
});
