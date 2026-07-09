import { BALANCE } from '../../shared/balance';
import type { BuildingDef, BuildingId, BuildStatus, CityState } from '../../shared/types';

/**
 * City progression: "build from zero" (V1). Pure, deterministic helpers with no
 * I/O — mirrors the bounded, default-no-op pattern used by lawMultipliers /
 * traitMultipliers in resolver.ts, so an empty (brand-new) city resolves
 * identically to the pre-progression game.
 */

/** The ordered building list — the single source of truth for unlock order. */
const BUILDINGS = BALANCE.build.buildings;

/**
 * Stage index (0..4) from the number of buildings built:
 * 0 → Camp, 1 → Settlement, 2–3 → Village, 4–5 → Fortified Town, ≥6 → Surviving City.
 */
export const stageForCount = (unlockedCount: number): number => {
  const n = Math.max(0, Math.floor(unlockedCount));
  let stage: number;
  if (n <= 0) stage = 0;
  else if (n === 1) stage = 1;
  else if (n <= 3) stage = 2;
  else if (n <= 5) stage = 3;
  else stage = 4;
  return Math.max(0, Math.min(4, stage));
};

/**
 * Accrue build labor and unlock any buildings whose threshold is crossed, in
 * list order. Never mutates its arguments. The remainder carries toward the
 * next unbuilt building; once everything is built, progress stays 0.
 */
export const applyBuildProgress = (
  prevProgress: number,
  prevUnlocked: string[],
  buildLabor: number,
): { progress: number; unlocked: string[]; completed: BuildingId[] } => {
  let progress = prevProgress + buildLabor;
  const unlocked = [...prevUnlocked];
  const completed: BuildingId[] = [];

  while (unlocked.length < BUILDINGS.length && progress >= BUILDINGS[unlocked.length]!.progressRequired) {
    const b = BUILDINGS[unlocked.length]!;
    progress -= b.progressRequired;
    unlocked.push(b.id);
    completed.push(b.id);
  }

  if (unlocked.length < BUILDINGS.length) {
    // Cap so a huge single-day labor spike can't over-accumulate past the next
    // building's requirement (defensive; the loop already drains full thresholds).
    progress = Math.min(progress, BUILDINGS[unlocked.length]!.progressRequired);
  } else {
    progress = 0; // everything is built — nothing left to build toward
  }

  return { progress, unlocked, completed };
};

/** Bounded per-day bonuses summed over the BUILT set (empty set → all zeros). */
export const buildingEffects = (
  unlocked: readonly string[],
): {
  foodBonus: number;
  defenseBonus: number;
  moraleBonus: number;
  medicineBonus: number;
  foodCapBonus: number;
  raidDampen: number;
} => {
  const fx = {
    foodBonus: 0,
    defenseBonus: 0,
    moraleBonus: 0,
    medicineBonus: 0,
    foodCapBonus: 0,
    raidDampen: 0,
  };
  for (const id of unlocked) {
    switch (id) {
      case 'shelter': fx.moraleBonus += 1; break;
      case 'farm': fx.foodBonus += 3; break;
      case 'clinic': fx.medicineBonus += 1; break;
      case 'watchtower': fx.defenseBonus += 2; break;
      case 'storehouse': fx.foodCapBonus += 100; break;
      case 'wall': fx.raidDampen += 4; break;
      case 'council_hall': fx.moraleBonus += 1; break;
      default: break;
    }
  }
  return fx;
};

/** Assemble the /init build payload from the city's current progression state. */
export const buildStatus = (
  city: CityState,
  contributorsToday: number,
  youBuiltToday: boolean,
): BuildStatus => {
  const stage = city.cityLevel;
  const next: BuildingDef | null = BUILDINGS[city.unlockedBuildings.length] ?? null;
  return {
    stage,
    stageLabel: BALANCE.build.stages[stage] ?? BALANCE.build.stages[0],
    unlocked: city.unlockedBuildings,
    next,
    progress: city.buildProgress,
    progressRequired: next?.progressRequired ?? 0,
    contributorsToday,
    youBuiltToday,
  };
};
