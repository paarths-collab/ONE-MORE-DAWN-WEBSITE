import { describe, expect, it } from 'vitest';
import { applyBuildProgress, buildingEffects, buildStatus, stageForCount } from './building';
import { newCityState, resolveDay, type DayInputs } from './resolver';
import { BALANCE } from '../../shared/balance';
import type { CityState } from '../../shared/types';

const noInputs: DayInputs = {
  actions: {},
  missions: {},
  crisisVotes: {},
  strategyVotes: {},
  roleCounts: {},
  activeUserCount: 0,
  factionInfluence: {},
  markedPledged: 0,
  pledges: {},
  markedActivePlayers: 0,
};

const B = BALANCE.build.buildings;
const req = (id: string) => B.find((b) => b.id === id)!.progressRequired;

describe('newCityState build-from-zero defaults', () => {
  it('starts every city as an empty Camp at zero', () => {
    const c = newCityState(1);
    expect(c.cityLevel).toBe(0);
    expect(c.buildProgress).toBe(0);
    expect(c.unlockedBuildings).toEqual([]);
  });
});

describe('stageForCount', () => {
  it('maps building counts to stages 0..4', () => {
    expect(stageForCount(0)).toBe(0); // Camp
    expect(stageForCount(1)).toBe(1); // Settlement
    expect(stageForCount(2)).toBe(2); // Village
    expect(stageForCount(3)).toBe(2);
    expect(stageForCount(4)).toBe(3); // Fortified Town
    expect(stageForCount(5)).toBe(3);
    expect(stageForCount(6)).toBe(4); // Surviving City
    expect(stageForCount(7)).toBe(4);
  });

  it('clamps out-of-range inputs into 0..4', () => {
    expect(stageForCount(-5)).toBe(0);
    expect(stageForCount(999)).toBe(4);
  });
});

describe('applyBuildProgress', () => {
  it('accumulates labor below the first threshold without unlocking', () => {
    const out = applyBuildProgress(0, [], 10);
    expect(out.progress).toBe(10);
    expect(out.unlocked).toEqual([]);
    expect(out.completed).toEqual([]);
  });

  it('unlocks the first building when the threshold is crossed and carries the remainder', () => {
    const labor = req('shelter') + 5;
    const out = applyBuildProgress(0, [], labor);
    expect(out.completed).toEqual(['shelter']);
    expect(out.unlocked).toEqual(['shelter']);
    expect(out.progress).toBe(5); // remainder toward the farm
  });

  it('unlocks multiple buildings in one big labor spike, in list order', () => {
    const labor = req('shelter') + req('farm') + 3;
    const out = applyBuildProgress(0, [], labor);
    expect(out.completed).toEqual(['shelter', 'farm']);
    expect(out.unlocked).toEqual(['shelter', 'farm']);
    expect(out.progress).toBe(3);
  });

  it('never over-accumulates once everything is built', () => {
    const allIds = B.map((b) => b.id) as string[];
    const out = applyBuildProgress(0, allIds, 9999);
    expect(out.unlocked).toEqual(allIds);
    expect(out.completed).toEqual([]);
    expect(out.progress).toBe(0);
  });

  it('does not mutate the passed-in unlocked array', () => {
    const prev: string[] = [];
    applyBuildProgress(0, prev, req('shelter'));
    expect(prev).toEqual([]);
  });
});

describe('buildingEffects', () => {
  it('is all-zero for an empty (brand-new) city', () => {
    expect(buildingEffects([])).toEqual({
      foodBonus: 0,
      defenseBonus: 0,
      moraleBonus: 0,
      medicineBonus: 0,
      foodCapBonus: 0,
      raidDampen: 0,
    });
  });

  it('sums bounded per-building effects for the built set', () => {
    const fx = buildingEffects(['shelter', 'farm', 'clinic', 'watchtower', 'storehouse', 'wall', 'council_hall']);
    expect(fx).toEqual({
      foodBonus: 3, // farm
      defenseBonus: 2, // watchtower
      moraleBonus: 2, // shelter + council_hall
      medicineBonus: 1, // clinic
      foodCapBonus: 100, // storehouse
      raidDampen: 4, // wall
    });
  });

  it('ignores unknown building ids', () => {
    expect(buildingEffects(['not_a_building'])).toEqual({
      foodBonus: 0, defenseBonus: 0, moraleBonus: 0, medicineBonus: 0, foodCapBonus: 0, raidDampen: 0,
    });
  });
});

describe('buildStatus payload', () => {
  it('reports the next unbuilt building and current progress', () => {
    const c: CityState = { ...newCityState(1), unlockedBuildings: ['shelter'], cityLevel: 1, buildProgress: 7 };
    const s = buildStatus(c, 3, true);
    expect(s.stage).toBe(1);
    expect(s.stageLabel).toBe('Settlement');
    expect(s.unlocked).toEqual(['shelter']);
    expect(s.next?.id).toBe('farm');
    expect(s.progress).toBe(7);
    expect(s.progressRequired).toBe(req('farm'));
    expect(s.contributorsToday).toBe(3);
    expect(s.youBuiltToday).toBe(true);
  });

  it('reports next=null once every building is built', () => {
    const allIds = B.map((b) => b.id) as string[];
    const c: CityState = { ...newCityState(1), unlockedBuildings: allIds, cityLevel: 4, buildProgress: 0 };
    const s = buildStatus(c, 0, false);
    expect(s.next).toBeNull();
    expect(s.progressRequired).toBe(0);
    expect(s.stageLabel).toBe('Surviving City');
  });
});

describe('resolveDay build integration', () => {
  const alive = (over: Partial<CityState> = {}): CityState => ({ ...newCityState(1), day: 3, ...over });

  it('a new empty city resolves with no build change (default no-op)', () => {
    const { city: next } = resolveDay(alive(), noInputs);
    expect(next.cityLevel).toBe(0);
    expect(next.buildProgress).toBe(0);
    expect(next.unlockedBuildings).toEqual([]);
  });

  it('build_city actions accrue progress toward the first building', () => {
    const actions = { build_city: 2 };
    const { city: next } = resolveDay(alive(), { ...noInputs, actions });
    expect(next.buildProgress).toBe(2 * BALANCE.build.progressPerAction);
    expect(next.unlockedBuildings).toEqual([]);
  });

  it('crossing a threshold unlocks the shelter and raises the stage', () => {
    const actions = { build_city: Math.ceil(req('shelter') / BALANCE.build.progressPerAction) };
    const { city: next, entry } = resolveDay(alive(), { ...noInputs, actions });
    expect(next.unlockedBuildings).toEqual(['shelter']);
    expect(next.cityLevel).toBe(1);
    expect(entry.events.some((e) => /Shelter is complete/.test(e))).toBe(true);
  });

  it('a fallen city cannot advance build progress', () => {
    const actions = { build_city: 20 };
    const { city: next } = resolveDay(alive({ status: 'fallen' }), { ...noInputs, actions });
    expect(next.buildProgress).toBe(0);
    expect(next.unlockedBuildings).toEqual([]);
    expect(next.cityLevel).toBe(0);
  });

  it('already-built buildings pay their bounded effect this dawn (farm = +3 food)', () => {
    const withFarm = alive({ unlockedBuildings: ['shelter', 'farm'], cityLevel: 2 });
    const without = alive();
    const gain = resolveDay(withFarm, noInputs).city.food - resolveDay(without, noInputs).city.food;
    // shelter has no food effect; farm adds +3 food/day.
    expect(gain).toBe(3);
  });

  it('storehouse raises the food store cap without breaking clamps', () => {
    // A huge food store: without storehouse it clamps at foodStoreCap; with it, +100.
    const base = alive({ food: 500 });
    const withStore = alive({ food: 500, unlockedBuildings: ['storehouse'], cityLevel: 1 });
    const cappedNoStore = resolveDay(base, noInputs).city.food;
    const cappedStore = resolveDay(withStore, noInputs).city.food;
    expect(cappedNoStore).toBeLessThanOrEqual(BALANCE.scaling.foodStoreCap);
    expect(cappedStore).toBeLessThanOrEqual(BALANCE.scaling.foodStoreCap + 100);
    expect(cappedStore).toBeGreaterThan(cappedNoStore);
  });
});
