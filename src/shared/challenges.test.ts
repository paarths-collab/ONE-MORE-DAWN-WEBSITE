import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_LEVELS,
  challengeProgress,
  dailyChallenge,
  levelForContribution,
  rewardForLevel,
  roleTask,
  roleTaskReward,
} from './challenges';
import type { Role } from './types';

const ALL_ROLES: Role[] = ['farmer', 'engineer', 'medic', 'guard', 'speaker', 'scout'];

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
      if ((low.kind === 'action' && low.action !== 'build_city') || low.kind === 'any_action') {
        expect(low.target).toBe(1);
        expect(high.target).toBe(3);
        return;
      }
    }
    throw new Error('no action mission found in 40 days — template mix broken');
  });

  it('never assigns more labor than the once-per-day build control allows', () => {
    for (let d = 1; d <= 200; d++) {
      const challenge = dailyChallenge('t2_builder', d, 7, 9801);
      if (challenge.action === 'build_city') expect(challenge.target).toBe(1);
    }
  });

  it('caps action targets to the energy available to an injured survivor', () => {
    for (let d = 1; d <= 200; d++) {
      const challenge = dailyChallenge('t2_injured', d, 7, 9801, 2);
      if (challenge.kind === 'action' || challenge.kind === 'any_action') {
        expect(challenge.target).toBeLessThanOrEqual(2);
      }
    }
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

describe('roleTaskReward', () => {
  it('starts at 2 and grows one point every 15 levels', () => {
    expect(roleTaskReward(1)).toBe(2);
    expect(roleTaskReward(14)).toBe(2);
    expect(roleTaskReward(15)).toBe(3);
    expect(roleTaskReward(30)).toBe(4);
    expect(roleTaskReward(100)).toBe(8);
  });
});

describe('roleTask', () => {
  it('gives each worker role its signature action', () => {
    expect(roleTask('farmer', 100)).toMatchObject({ kind: 'action', action: 'grow_food', icon: '🌾' });
    expect(roleTask('engineer', 100)).toMatchObject({ kind: 'action', action: 'repair_power', icon: '🔧' });
    expect(roleTask('medic', 100)).toMatchObject({ kind: 'action', action: 'treat_sick', icon: '⛑️' });
    expect(roleTask('guard', 100)).toMatchObject({ kind: 'action', action: 'guard_wall', icon: '🛡️' });
  });

  it('gives the speaker an any_action rally and the scout a civic duty', () => {
    expect(roleTask('speaker', 100)).toMatchObject({ kind: 'any_action', action: null, icon: '📣' });
    expect(roleTask('scout', 100)).toMatchObject({ kind: 'civic', action: null, icon: '🧭' });
  });

  it('is deterministic for the same (role, contribution) — no storage needed', () => {
    for (const role of ALL_ROLES) {
      expect(roleTask(role, 500)).toEqual(roleTask(role, 500));
    }
  });

  it('gives every role a distinct id keyed by role', () => {
    const ids = new Set(ALL_ROLES.map((r) => roleTask(r, 500).id));
    expect(ids.size).toBe(ALL_ROLES.length);
    for (const role of ALL_ROLES) {
      expect(roleTask(role, 500).id.startsWith(`role:${role}:`)).toBe(true);
    }
  });

  it('renders complete text with no unexpanded placeholders across levels', () => {
    for (const role of ALL_ROLES) {
      for (const score of [0, 100, 2500, 9801]) {
        const task = roleTask(role, score);
        expect(task.text).not.toMatch(/\{n\}|\{act\}|\{s\}/);
        expect(task.text.length).toBeGreaterThan(10);
        expect(task.level).toBe(levelForContribution(score));
        expect(task.reward).toBe(roleTaskReward(task.level));
        expect(task.target).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("pluralizes the speaker's rally: singular at 1, plural above", () => {
    expect(roleTask('speaker', 0).target).toBe(1); // level 1 → 1 action
    expect(roleTask('speaker', 0).text).toContain('1 action ');
    const high = roleTask('speaker', 9801); // level 100 → 3 actions
    expect(high.target).toBe(3);
    expect(high.text).toContain('3 actions');
  });

  it('caps action targets to the energy an injured survivor has left', () => {
    const injured = roleTask('farmer', 9801, 2); // level 100 would ask 3, but only 2 energy
    expect(injured.target).toBe(2);
  });

  it('feeds challengeProgress like any other Challenge', () => {
    const farmer = roleTask('farmer', 9801); // grow_food, target 3
    const base = { actionsToday: {}, voted: false, backedPlan: false, pledged: false };
    expect(challengeProgress(farmer, base).done).toBe(false);
    expect(
      challengeProgress(farmer, { ...base, actionsToday: { grow_food: farmer.target } }),
    ).toEqual({ progress: farmer.target, done: true });

    const scout = roleTask('scout', 100); // civic → needs vote AND plan
    expect(challengeProgress(scout, { ...base, voted: true }).done).toBe(false);
    expect(challengeProgress(scout, { ...base, voted: true, backedPlan: true }).done).toBe(true);
  });
});
