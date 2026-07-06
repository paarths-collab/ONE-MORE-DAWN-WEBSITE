import type { ActionType, MissionRoute, PledgeKind, Role, StrategyPlanId } from '../../shared/types';

/** Mutation callbacks owned by App (optimistic update + api call + toast). */
export type Handlers = {
  onPledge: (kind: PledgeKind) => void;
  onVote: (optionId: string, crisisId: string) => void;
  onStrategy: (planId: StrategyPlanId) => void;
  onAction: (action: ActionType) => void;
  onRole: (role: Role) => void;
  onMission: (route: MissionRoute) => void;
};
