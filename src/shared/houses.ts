export type HouseTier = 0 | 1 | 2 | 3 | 4; // 0 = no house yet · 1 tent · 2 cottage · 3 house · 4 manor

export const HOUSE_CAP = 240;              // max personal houses rendered
export const NAMED_HOUSE_LIMIT = 8;        // how many top contributors get name labels

// min lifetime contribution for each tier (index 0 => tier 1, etc.)
export const HOUSE_TIER_MINS = [1, 6, 18, 40] as const;

export function tierForContribution(contribution: number): HouseTier {
  if (contribution >= 40) return 4;
  if (contribution >= 18) return 3;
  if (contribution >= 6) return 2;
  if (contribution >= 1) return 1;
  return 0;
}
