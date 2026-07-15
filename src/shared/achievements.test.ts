import { describe, expect, it } from 'vitest';
import type { InitResponse } from './types';
import { type Badge, earnedBadges } from './achievements';

/**
 * Focused fixtures: earnedBadges reads only a handful of InitResponse fields,
 * so tests build a minimal init that names exactly those fields and cast it to
 * the real type. Keeping the fixture shape narrow (rather than a DeepPartial of
 * the whole InitResponse) sidesteps the project's strict literal-union and
 * exactOptionalPropertyTypes checks while staying readable.
 */
type InitFixture = {
  player?: { streak?: number };
  standing?: { survivalDays?: number; contributionRank?: number | null };
  houses?: { yours?: { tier?: number; isFounder?: boolean } | null };
  challenge?: { level?: number };
  city?: { cycle?: number };
  build?: { next?: { id?: string } | null; unlocked?: string[] };
};
const mk = (o: InitFixture = {}): InitResponse => o as unknown as InitResponse;

/** An init that earns nothing — the baseline "fresh survivor" state. */
const barren = (): InitFixture => ({
  player: { streak: 0 },
  standing: { survivalDays: 0, contributionRank: null },
  houses: { yours: null },
  challenge: { level: 1 },
  city: { cycle: 1 },
  build: { next: { id: 'wall' }, unlocked: ['shelter'] },
});

const idsOf = (badges: Badge[]): string[] => badges.map((b) => b.id);

describe('earnedBadges — empty and shape', () => {
  it('returns no badges for a fresh survivor with nothing achieved', () => {
    expect(earnedBadges(mk(barren()))).toEqual([]);
  });

  it('does not throw and returns [] when whole sub-objects are missing (legacy init)', () => {
    expect(earnedBadges(mk({}))).toEqual([]);
  });

  it('every emitted badge has a non-empty id, icon, label, and a valid tier', () => {
    const badges = earnedBadges(
      mk({ ...barren(), player: { streak: 30 }, houses: { yours: { isFounder: true, tier: 4 } } }),
    );
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) {
      expect(b.id).toBeTruthy();
      expect(b.icon).toBeTruthy();
      expect(b.label).toBeTruthy();
      expect(['bronze', 'silver', 'gold', 'legendary']).toContain(b.tier);
    }
  });

  it('never emits duplicate badge ids', () => {
    const badges = earnedBadges(
      mk({
        player: { streak: 30 },
        standing: { survivalDays: 100, contributionRank: 1 },
        houses: { yours: { tier: 4, isFounder: true } },
        challenge: { level: 100 },
        city: { cycle: 5 },
        build: { next: null, unlocked: ['a', 'b'] },
      }),
    );
    expect(new Set(idsOf(badges)).size).toBe(badges.length);
  });
});

describe('earnedBadges — streak track (🔥)', () => {
  const withStreak = (streak: number) => earnedBadges(mk({ ...barren(), player: { streak } }));

  it('awards nothing below the first threshold (streak 2)', () => {
    expect(withStreak(2)).toEqual([]);
  });

  it('awards bronze "Kindled" at exactly 3, and holds it through 6', () => {
    expect(idsOf(withStreak(3))).toEqual(['streak-3']);
    expect(withStreak(3)[0]!.tier).toBe('bronze');
    expect(idsOf(withStreak(6))).toEqual(['streak-3']);
  });

  it('awards silver at 7, gold at 14, legendary at 30 — exactly one flame at a time', () => {
    expect(withStreak(7)[0]).toMatchObject({ id: 'streak-7', tier: 'silver' });
    expect(withStreak(14)[0]).toMatchObject({ id: 'streak-14', tier: 'gold' });
    expect(withStreak(30)[0]).toMatchObject({ id: 'streak-30', tier: 'legendary' });
    expect(withStreak(999)).toHaveLength(1);
  });
});

describe('earnedBadges — dawns-survived track (🌅)', () => {
  const withDawns = (survivalDays: number) =>
    earnedBadges(mk({ ...barren(), standing: { survivalDays, contributionRank: null } }));

  it('awards nothing below 7 dawns', () => {
    expect(withDawns(6)).toEqual([]);
  });

  it('climbs bronze→silver→gold→legendary at 7/30/60/100', () => {
    expect(withDawns(7)[0]).toMatchObject({ id: 'dawns-7', tier: 'bronze' });
    expect(withDawns(30)[0]).toMatchObject({ id: 'dawns-30', tier: 'silver' });
    expect(withDawns(60)[0]).toMatchObject({ id: 'dawns-60', tier: 'gold' });
    expect(withDawns(100)[0]).toMatchObject({ id: 'dawns-100', tier: 'legendary' });
    expect(withDawns(100)).toHaveLength(1);
  });
});

describe('earnedBadges — house track (🏠)', () => {
  const withTier = (tier: number) =>
    earnedBadges(mk({ ...barren(), houses: { yours: { tier } } }));

  it('awards nothing for tier 0 or a null house', () => {
    expect(withTier(0)).toEqual([]);
    expect(earnedBadges(mk({ ...barren(), houses: { yours: null } }))).toEqual([]);
  });

  it('maps tiers 1→4 to Tent/Cottage/Household/Manor', () => {
    expect(withTier(1)[0]).toMatchObject({ id: 'house-1', tier: 'bronze' });
    expect(withTier(2)[0]).toMatchObject({ id: 'house-2', tier: 'silver' });
    expect(withTier(3)[0]).toMatchObject({ id: 'house-3', tier: 'gold' });
    expect(withTier(4)[0]).toMatchObject({ id: 'house-4', tier: 'legendary' });
    expect(withTier(4)).toHaveLength(1);
  });
});

describe('earnedBadges — survivor-level track (⭐)', () => {
  const withLevel = (level: number) => earnedBadges(mk({ ...barren(), challenge: { level } }));

  it('awards nothing below level 10', () => {
    expect(withLevel(9)).toEqual([]);
  });

  it('climbs at 10/25/50/100', () => {
    expect(withLevel(10)[0]).toMatchObject({ id: 'level-10', tier: 'bronze' });
    expect(withLevel(25)[0]).toMatchObject({ id: 'level-25', tier: 'silver' });
    expect(withLevel(50)[0]).toMatchObject({ id: 'level-50', tier: 'gold' });
    expect(withLevel(100)[0]).toMatchObject({ id: 'level-100', tier: 'legendary' });
    expect(withLevel(100)).toHaveLength(1);
  });
});

describe('earnedBadges — standing/rank track (🏆)', () => {
  const withRank = (contributionRank: number | null) =>
    earnedBadges(mk({ ...barren(), standing: { survivalDays: 0, contributionRank } }));

  it('awards nothing when rank is unknown (null) or non-positive (guard)', () => {
    expect(withRank(null)).toEqual([]);
    expect(withRank(0)).toEqual([]);
    expect(withRank(-1)).toEqual([]);
  });

  it('awards nothing outside the top ten', () => {
    expect(withRank(11)).toEqual([]);
  });

  it('gold at #1, silver in top 3, bronze in top 10', () => {
    expect(withRank(1)[0]).toMatchObject({ id: 'rank-1', tier: 'gold' });
    expect(withRank(2)[0]).toMatchObject({ id: 'rank-3', tier: 'silver' });
    expect(withRank(3)[0]).toMatchObject({ id: 'rank-3', tier: 'silver' });
    expect(withRank(4)[0]).toMatchObject({ id: 'rank-10', tier: 'bronze' });
    expect(withRank(10)[0]).toMatchObject({ id: 'rank-10', tier: 'bronze' });
  });
});

describe('earnedBadges — phoenix/cycles track (🐦‍🔥)', () => {
  const withCycle = (cycle: number) => earnedBadges(mk({ ...barren(), city: { cycle } }));

  it('awards nothing on the first life (cycle 1)', () => {
    expect(withCycle(1)).toEqual([]);
  });

  it('bronze "Reborn" at 2, silver at 3, gold "Phoenix" at 5', () => {
    expect(withCycle(2)[0]).toMatchObject({ id: 'phoenix-2', tier: 'bronze' });
    expect(withCycle(3)[0]).toMatchObject({ id: 'phoenix-3', tier: 'silver' });
    expect(withCycle(5)[0]).toMatchObject({ id: 'phoenix-5', tier: 'gold' });
    expect(withCycle(9)).toHaveLength(1);
  });
});

describe('earnedBadges — founder badge (👑)', () => {
  it('awards a legendary Founder badge when isFounder is true', () => {
    const badges = earnedBadges(mk({ ...barren(), houses: { yours: { tier: 1, isFounder: true } } }));
    expect(badges.some((b) => b.id === 'founder' && b.tier === 'legendary')).toBe(true);
  });

  it('does not award Founder when isFounder is false or absent', () => {
    expect(
      earnedBadges(mk({ ...barren(), houses: { yours: { tier: 1, isFounder: false } } })).some(
        (b) => b.id === 'founder',
      ),
    ).toBe(false);
    expect(idsOf(earnedBadges(mk({ ...barren(), houses: { yours: { tier: 1 } } })))).not.toContain(
      'founder',
    );
  });
});

describe('earnedBadges — city-complete badge (🏛️)', () => {
  it('awards when every structure is raised (build.next === null)', () => {
    const badges = earnedBadges(
      mk({
        ...barren(),
        build: { next: null, unlocked: ['shelter', 'farm'] },
      }),
    );
    expect(badges.some((b) => b.id === 'city-complete' && b.tier === 'gold')).toBe(true);
  });

  it('does not award while a next structure is still pending', () => {
    const badges = earnedBadges(
      mk({
        ...barren(),
        build: { next: { id: 'council_hall' }, unlocked: ['shelter'] },
      }),
    );
    expect(idsOf(badges)).not.toContain('city-complete');
  });

  it('does not award (and does not throw) when build data is missing', () => {
    const partial = barren();
    delete partial.build;
    expect(idsOf(earnedBadges(mk(partial)))).not.toContain('city-complete');
  });
});

describe('earnedBadges — ordering, determinism, and one-per-track', () => {
  const fullHouse = () =>
    mk({
      player: { streak: 30 },
      standing: { survivalDays: 100, contributionRank: 1 },
      houses: { yours: { tier: 4, isFounder: true } },
      challenge: { level: 100 },
      city: { cycle: 5 },
      build: { next: null, unlocked: ['a', 'b'] },
    });

  it('sorts shiniest-first: all legendary badges precede gold, silver, bronze', () => {
    const tiers = earnedBadges(fullHouse()).map((b) => b.tier);
    const rank = { legendary: 0, gold: 1, silver: 2, bronze: 3 } as const;
    const ranks = tiers.map((t) => rank[t]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('produces a stable, deterministic order across repeated calls', () => {
    const a = earnedBadges(fullHouse());
    const b = earnedBadges(fullHouse());
    expect(idsOf(a)).toEqual(idsOf(b));
  });

  it('emits at most one badge per track (8 tracks → at most 8 badges)', () => {
    const badges = earnedBadges(fullHouse());
    expect(badges.length).toBeLessThanOrEqual(8);
    expect(new Set(idsOf(badges)).size).toBe(badges.length);
  });

  it('is a pure read: calling it does not mutate the input', () => {
    const input = fullHouse();
    const snapshot = JSON.stringify(input);
    earnedBadges(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
