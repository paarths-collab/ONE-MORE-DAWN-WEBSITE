import { describe, expect, it } from 'vitest';
import { validateAction, validateRoleChange } from './actionRules';
import type { PlayerProfile } from '../../shared/types';

const player = (over: Partial<PlayerProfile>): PlayerProfile => ({
  userId: 't2_a', username: 'a', role: 'farmer', roleChangedDay: 1,
  faction: null, factionRep: 0, roleRep: {}, title: null, avatar: null,
  energyUsedToday: 0, lastActiveDay: 5,
  injuredUntilDay: 0, totalContribution: 0, streak: 1,
  ...over,
});

describe('validateAction', () => {
  it('accepts a valid action with energy remaining', () => {
    expect(validateAction(player({ energyUsedToday: 2 }), 5, 'grow_food')).toBeNull();
  });

  it('rejects when out of energy', () => {
    expect(validateAction(player({ energyUsedToday: 3 }), 5, 'grow_food')).toMatch(/energy/i);
  });

  it('rejects when injured and at reduced cap', () => {
    expect(validateAction(player({ energyUsedToday: 2, injuredUntilDay: 5 }), 5, 'grow_food')).toMatch(/energy/i);
  });

  it('rejects unknown action types', () => {
    expect(validateAction(player({}), 5, 'hack_mainframe' as never)).toMatch(/unknown/i);
  });

  it('rejects before role selection', () => {
    expect(validateAction(player({ role: null }), 5, 'grow_food')).toMatch(/role/i);
  });
});

describe('validateRoleChange', () => {
  it('allows the first pick any time', () => {
    expect(validateRoleChange(player({ role: null, roleChangedDay: 0 }), 5, 'medic')).toBeNull();
  });

  it('enforces the 3-day cooldown', () => {
    expect(validateRoleChange(player({ role: 'farmer', roleChangedDay: 4 }), 5, 'medic')).toMatch(/day/i);
    expect(validateRoleChange(player({ role: 'farmer', roleChangedDay: 2 }), 5, 'medic')).toBeNull();
  });

  it('rejects unknown roles', () => {
    expect(validateRoleChange(player({}), 5, 'warlord' as never)).toMatch(/unknown/i);
  });
});
