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
  strategyVotes: {},
  roleCounts: {},
  activeUserCount: 0,
  factionInfluence: {},
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
      strategyVotes: {},
      roleCounts: { speaker: 2 },
      activeUserCount: 3,
      factionInfluence: {},
    };
    expect(resolveDay(city(), inputs)).toEqual(resolveDay(city(), inputs));
  });

  it('speaker actions lift morale', () => {
    const base = resolveDay(city({ morale: 50 }), noInputs).city.morale;
    const spoken = resolveDay(city({ morale: 50 }), { ...noInputs, roleCounts: { speaker: 3 } }).city.morale;
    expect(spoken).toBe(base + 3 * BALANCE.speakerMoralePerAction);
  });

  it('scaled drains reduce food when many active players', () => {
    const base = resolveDay(city({ population: 100, food: 50 }), noInputs).city.food;
    const scaled = resolveDay(city({ population: 100, food: 50 }), { ...noInputs, activeUserCount: 20 }).city.food;
    expect(scaled).toBeLessThan(base);
  });

  it('caps food storage at the configured maximum', () => {
    // Massive positive influx: many farmers + high starting food
    const { city: next } = resolveDay(
      city({ food: 250, population: 100 }),
      { ...noInputs, actions: { grow_food: 30 } },
    );
    expect(next.food).toBeLessThanOrEqual(BALANCE.scaling.foodStoreCap);
  });

  it('caps medicine storage at the configured maximum', () => {
    const { city: next } = resolveDay(
      city({ medicine: 110 }),
      { ...noInputs, actions: { treat_sick: 20 } },
    );
    expect(next.medicine).toBeLessThanOrEqual(BALANCE.scaling.medicineStoreCap);
  });

  it('winning faction sets tomorrow\'s law', () => {
    const { city: next } = resolveDay(city(), { ...noInputs, factionInfluence: { builders: 5, wardens: 2 } });
    expect(next.activeLaw).toBe('builders');
    // lawExpiresDay is the LAST active day: enacted for next.day, lifespan 1 → expires that day.
    expect(next.lawExpiresDay).toBe(next.day + BALANCE.lawLifespanDays - 1);
  });

  it('a law lives exactly lawLifespanDays (boundary)', () => {
    // Enact on a day-3 resolution → law is for day 4, lawExpiresDay 4 (lifespan 1).
    const enacted = resolveDay(city({ day: 3 }), { ...noInputs, factionInfluence: { builders: 5 } }).city;
    expect(enacted.day).toBe(4);
    expect(enacted.lawExpiresDay).toBe(4);
    // Active on day 4 (its own day), boosts repair.
    const boosted = resolveDay(enacted, { ...noInputs, actions: { repair_power: 4 } }).city.power;
    const control = resolveDay({ ...enacted, activeLaw: null, lawExpiresDay: 0 }, { ...noInputs, actions: { repair_power: 4 } }).city.power;
    expect(boosted).toBeGreaterThan(control);
    // On day 5 the same law is expired: resolving day 4 with no new winner carries nothing.
    const day5 = resolveDay(enacted, noInputs).city;
    expect(day5.activeLaw).toBeNull();
  });

  it('faction ties break by faction order (builders first)', () => {
    const { city: next } = resolveDay(city(), { ...noInputs, factionInfluence: { wardens: 3, builders: 3 } });
    expect(next.activeLaw).toBe('builders');
  });

  it('an active builders law boosts repair output', () => {
    const withLaw = { ...city(), activeLaw: 'builders', lawExpiresDay: 99 };
    const withoutLaw = { ...city(), activeLaw: null, lawExpiresDay: 0 };
    const p1 = resolveDay(withLaw as CityState, { ...noInputs, actions: { repair_power: 4 } }).city.power;
    const p2 = resolveDay(withoutLaw as CityState, { ...noInputs, actions: { repair_power: 4 } }).city.power;
    expect(p1).toBeGreaterThan(p2);
  });

  it('an expired law does not apply', () => {
    const expired = { ...city({ day: 5 }), activeLaw: 'builders', lawExpiresDay: 4 } as CityState;
    const p1 = resolveDay(expired, { ...noInputs, actions: { repair_power: 4 } }).city.power;
    const noLaw = resolveDay({ ...city({ day: 5 }), activeLaw: null, lawExpiresDay: 0 } as CityState, { ...noInputs, actions: { repair_power: 4 } }).city.power;
    expect(p1).toBe(noLaw);
  });

  it('raid fires at threat >= 100 and resets threat', () => {
    const { city: next, entry } = resolveDay(city({ threat: 100, food: 80, population: 120 }), noInputs);
    expect(next.threat).toBe(BALANCE.raid.postRaidThreat);
    expect(next.food).toBeLessThan(80);
    expect(entry.events.some((e) => /red signal/i.test(e))).toBe(true);
  });

  it('guard actions dampen raid damage', () => {
    // threat 130: +6 passive - 5*5 guard = 111, still >= 100 so the raid still
    // fires for BOTH cities — this isolates dampening from raid-prevention.
    const bare = resolveDay(city({ threat: 130, food: 80 }), noInputs).city.food;
    const guarded = resolveDay(city({ threat: 130, food: 80 }), { ...noInputs, actions: { guard_wall: 5 } }).city.food;
    expect(guarded).toBeGreaterThanOrEqual(bare); // guards reduce food loss
  });

  it('stays deterministic with faction + raid inputs', () => {
    const inp = { ...noInputs, factionInfluence: { seekers: 4 }, actions: { guard_wall: 1 } };
    expect(resolveDay(city({ threat: 100 }), inp)).toEqual(resolveDay(city({ threat: 100 }), inp));
  });

  describe('council unity (S2)', () => {
    it('grants the morale bonus when the city rallies behind the winning plan', () => {
      const actions = { repair_power: 7, grow_food: 3 }; // 7/10 = 0.7 >= 0.6
      const base = resolveDay(city(), { ...noInputs, actions });
      const united = resolveDay(city(), {
        ...noInputs,
        actions,
        strategyVotes: { repair_power: 4 },
      });
      expect(united.city.morale).toBe(base.city.morale + BALANCE.unity.moraleBonus);
      expect(united.entry.events.some((e) => /unity/i.test(e))).toBe(true);
      expect(base.entry.events.some((e) => /unity/i.test(e))).toBe(false);
    });

    it('no quorum: fewer than minPlanVoters means no bonus', () => {
      const actions = { repair_power: 7, grow_food: 3 };
      const base = resolveDay(city(), { ...noInputs, actions });
      const twoVoters = resolveDay(city(), {
        ...noInputs,
        actions,
        strategyVotes: { repair_power: 2 },
      });
      expect(twoVoters.city.morale).toBe(base.city.morale);
      expect(twoVoters.entry.events.some((e) => /unity/i.test(e))).toBe(false);
    });

    it('below alignment threshold: quorum alone is not enough', () => {
      const actions = { repair_power: 3, grow_food: 7 }; // 3/10 = 0.3 < 0.6
      const base = resolveDay(city(), { ...noInputs, actions });
      const misaligned = resolveDay(city(), {
        ...noInputs,
        actions,
        strategyVotes: { repair_power: 4 },
      });
      expect(misaligned.city.morale).toBe(base.city.morale);
      expect(misaligned.entry.events.some((e) => /unity/i.test(e))).toBe(false);
    });

    it('send_scouts aligns via mission runs', () => {
      const inp = {
        ...noInputs,
        actions: { grow_food: 2 },
        missions: { totalRuns: 6 }, // 6/(2+6) = 0.75 >= 0.6
      };
      const base = resolveDay(city(), inp);
      const united = resolveDay(city(), { ...inp, strategyVotes: { send_scouts: 3 } });
      expect(united.city.morale).toBe(base.city.morale + BALANCE.unity.moraleBonus);
      expect(united.entry.events.some((e) => /unity/i.test(e))).toBe(true);
    });

    it('stays deterministic with strategyVotes present', () => {
      const inp = {
        ...noInputs,
        actions: { repair_power: 7, grow_food: 3 },
        strategyVotes: { repair_power: 4, stockpile_food: 1 },
      };
      expect(resolveDay(city(), inp)).toEqual(resolveDay(city(), inp));
    });
  });
});
