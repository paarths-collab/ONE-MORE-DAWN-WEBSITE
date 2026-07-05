import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from '../../shared/types';
import {
  VILLAGER_CAP,
  VILLAGER_PALETTE,
  buildVillagers,
  buildZones,
  maskName,
  toVillager,
  villagerColor,
} from './village';

const makePlayer = (over: Partial<PlayerProfile>): PlayerProfile => ({
  userId: 't2_abc', username: 'tester', role: 'scout', roleChangedDay: 1,
  faction: null, factionRep: 0, roleRep: {}, title: null,
  energyUsedToday: 0, lastActiveDay: 1,
  injuredUntilDay: 0, totalContribution: 0, streak: 1,
  ...over,
});

describe('maskName', () => {
  it('leaves 1–2 char names untouched (nothing left to hide)', () => {
    expect(maskName('a')).toBe('a');
    expect(maskName('ab')).toBe('ab');
  });

  it('masks short names keeping length-1 prefix', () => {
    expect(maskName('bob')).toBe('bo•••');
    expect(maskName('alix')).toBe('ali•••');
  });

  it('caps the visible prefix at 4 chars for long names', () => {
    expect(maskName('alice')).toBe('alic•••');
    expect(maskName('spez_the_great')).toBe('spez•••');
  });
});

describe('villagerColor', () => {
  it('is deterministic per userId', () => {
    expect(villagerColor('t2_abc')).toBe(villagerColor('t2_abc'));
  });

  it('always picks from the fixed palette', () => {
    for (const id of ['t2_a', 't2_b', 't2_c', 't2_zzz', 'anything', '']) {
      expect(VILLAGER_PALETTE).toContain(villagerColor(id));
    }
  });
});

describe('toVillager', () => {
  it('maps profile fields, online iff lastActiveDay === city day', () => {
    const p = makePlayer({ username: 'alice', role: 'medic', faction: 'hearth', lastActiveDay: 7 });
    expect(toVillager(p, 7)).toEqual({
      maskedName: 'alic•••',
      role: 'medic',
      faction: 'hearth',
      color: villagerColor('t2_abc'),
      online: true,
      since: 'day 7',
    });
    expect(toVillager(p, 8).online).toBe(false);
    expect(toVillager(p, 8).since).toBe('day 7');
  });
});

describe('buildVillagers', () => {
  it('sorts online first, then most recently active, and does not mutate input', () => {
    const players = [
      makePlayer({ userId: 't2_stale', username: 'stale', lastActiveDay: 2 }),
      makePlayer({ userId: 't2_on', username: 'onnn', lastActiveDay: 9 }),
      makePlayer({ userId: 't2_recent', username: 'recent', lastActiveDay: 5 }),
    ];
    const snapshot = [...players];
    const out = buildVillagers(players, 9);
    expect(out.map((v) => v.maskedName)).toEqual(['onn•••', 'rece•••', 'stal•••']);
    expect(out[0]!.online).toBe(true);
    expect(out[1]!.online).toBe(false);
    expect(players).toEqual(snapshot);
  });

  it('caps the list at VILLAGER_CAP', () => {
    const players = Array.from({ length: VILLAGER_CAP + 5 }, (_, i) =>
      makePlayer({ userId: `t2_${i}`, username: `user${i}`, lastActiveDay: i }),
    );
    const out = buildVillagers(players, 99);
    expect(out).toHaveLength(VILLAGER_CAP);
    // Highest lastActiveDay survives the cap (none online on day 99).
    expect(out[0]!.since).toBe(`day ${VILLAGER_CAP + 4}`);
  });
});

describe('buildZones', () => {
  it('emits one zone per action with human names and today tallies', () => {
    expect(buildZones({ grow_food: 3, guard_wall: 1 })).toEqual([
      { id: 'grow_food', name: 'Farm', count: 3 },
      { id: 'repair_power', name: 'Generator', count: 0 },
      { id: 'treat_sick', name: 'Clinic', count: 0 },
      { id: 'guard_wall', name: 'Watchtower', count: 1 },
    ]);
  });

  it('ignores non-action fields in the day hash', () => {
    const zones = buildZones({ mission: 4 });
    expect(zones.every((z) => z.count === 0)).toBe(true);
  });
});
