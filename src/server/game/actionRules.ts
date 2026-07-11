import { BALANCE } from '../../shared/balance';
import type { ActionType, PlayerProfile, Role } from '../../shared/types';
import { effectiveEnergy } from './dayLogic';

export const ACTION_TYPES: ActionType[] = ['grow_food', 'repair_power', 'treat_sick', 'guard_wall', 'build_city'];
const ROLES: Role[] = ['scout', 'engineer', 'medic', 'farmer', 'guard', 'speaker'];

/** Returns an error message, or null when the action is allowed. */
export const validateAction = (
  player: PlayerProfile,
  cityDay: number,
  action: ActionType,
): string | null => {
  if (!ACTION_TYPES.includes(action)) return `Unknown action: ${String(action)}`;
  if (!player.role) return 'Choose a role before acting.';
  if (player.energyUsedToday >= effectiveEnergy(player, cityDay)) {
    return 'No energy left today. The city rests, come back tomorrow.';
  }
  return null;
};

/** Returns an error message, or null when the role change is allowed. */
export const validateRoleChange = (
  player: PlayerProfile,
  cityDay: number,
  role: Role,
): string | null => {
  if (!ROLES.includes(role)) return `Unknown role: ${String(role)}`;
  if (player.role === null) return null; // first pick is free
  const daysSince = cityDay - player.roleChangedDay;
  if (daysSince < BALANCE.roleChangeCooldownDays) {
    const wait = BALANCE.roleChangeCooldownDays - daysSince;
    return `You can change roles in ${wait} day${wait > 1 ? 's' : ''}.`;
  }
  return null;
};
