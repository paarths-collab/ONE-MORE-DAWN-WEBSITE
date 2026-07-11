import { describe, expect, it } from 'vitest';
import { CHALLENGE_LEVELS, challengeProgress, dailyChallenge, levelForContribution, rewardForLevel } from './challenges';

describe('levelForContribution', () => {
  it('starts at level 1 and caps at 100', () => {
    expect(levelForContribution(0)).toBe(1);
    expect(levelForContribution(-5)).toBe(1);
    expect(levelForContribution(Number.NaN)).toBe(1);
    expect(levelForContribution(1_000_000)).toBe(CHALLENGE_LEVELS);
  });

  it('climbs the sqrt curve', () => {
    expect(levelForContribution(100)).toBe(11);
    expect(levelForContribution(2500)).toBe(51);
    expect(levelForContribution(9801)).toBe(100);
  });
});

describe('dailyChallenge', () => {
  it('is deterministic for the same (user, day, seed)', () => {
    const a = dailyChallenge('t2_alice', 4, 123, 10);
    const b = dailyChallenge('t2_alice', 4, 123, 10);
    expect(a).toEqual(b);
  });

  it('varies across users and days (spot check)', () => {
    const days = new Set<string>();
    for (let d = 1; d <= 12; d++) days.add(dailyChallenge('t2_alice', d, 123, 10).id);
    expect(days.size).toBeGreaterThan(3); // different missions across a dozen days

    const users = new Set<string>();
    for (const u of ['t2_a', 't2_b', 't2_c', 't2_d', 't2_e', 't2_f', 't2_g', 't2_h']) {
      users.add(dailyChallenge(u, 4, 123, 10).id);
    }
    expect(users.size).toBeGreaterThan(2); // neighbors mostly get different tasks
  });

  it('renders a complete mission text (no unexpanded placeholders)', () => {
    for (let d = 1; d <= 30; d++) {
      const ch = dailyChallenge('t2_x', d, 42, 500);
      expect(ch.text).not.toMatch(/\{n\}|\{act\}/);
      expect(ch.text.length).toBeGreaterThan(10);
      expect(ch.level).toBe(levelForContribution(500));
      expect(ch.target).toBeGreaterThanOrEqual(1);
      expect(ch.reward).toBe(rewardForLevel(ch.level));
    }
  });

  it('scales action targets with level: 1 early, up to 3 at level 60+', () => {
    // find an action-kind mission and check its target at different levels
    for (let d = 1; d <= 40; d++) {
      const low = dailyChallenge('t2_scale', d, 7, 0); // level 1
      const high = dailyChallenge('t2_scale', d, 7, 9801); // level 100
      if (low.kind === 'action' || low.kind === 'any_action') {
        expect(low.target).toBe(1);
        expect(high.target).toBe(3);
        return;
      }
    }
    throw new Error('no action mission found in 40 days — template mix broken');
  });
});

describe('challengeProgress', () => {
  const base = { actionsToday: {}, voted: false, backedPlan: false, pledged: false };

  it('counts a specific action toward an action mission', () => {
    // find a grow_food mission deterministically
    let ch = dailyChallenge('t2_p', 1, 1, 0);
    for (let d = 1; ch.action !== 'grow_food'; d++) ch = dailyChallenge('t2_p', d, 1, 0);
    expect(challengeProgress(ch, base).done).toBe(false);
    const done = challengeProgress(ch, { ...base, actionsToday: { grow_food: ch.target } });
    expect(done).toEqual({ progress: ch.target, done: true });
    // other actions do not count
    expect(challengeProgress(ch, { ...base, actionsToday: { guard_wall: 3 } }).done).toBe(false);
  });

  it('civic requires BOTH votes; devout requires vote AND pledge', () => {
    let civic = dailyChallenge('t2_c', 1, 1, 0);
    for (let d = 1; civic.kind !== 'civic'; d++) civic = dailyChallenge('t2_c', d, 1, 0);
    expect(challengeProgress(civic, { ...base, voted: true }).done).toBe(false);
    expect(challengeProgress(civic, { ...base, voted: true, backedPlan: true }).done).toBe(true);

    let dev = dailyChallenge('t2_d', 1, 1, 0);
    for (let d = 1; dev.kind !== 'devout'; d++) dev = dailyChallenge('t2_d', d, 1, 0);
    expect(challengeProgress(dev, { ...base, voted: true, pledged: false }).done).toBe(false);
    expect(challengeProgress(dev, { ...base, voted: true, pledged: true }).done).toBe(true);
  });

  it('any_action counts everything and clamps progress at the target', () => {
    let any = dailyChallenge('t2_a2', 1, 1, 0);
    for (let d = 1; any.kind !== 'any_action'; d++) any = dailyChallenge('t2_a2', d, 1, 0);
    const over = challengeProgress(any, { ...base, actionsToday: { grow_food: 2, guard_wall: 2 } });
    expect(over.progress).toBe(any.target);
    expect(over.done).toBe(true);
  });
});
