import type {
  ActionResponse, ActionType, ApiError, InitResponse, LeaderboardResponse,
  MissionCompleteRequest, MissionCompleteResponse, MissionStartResponse, Role,
  RoleResponse, StrategyPlanId, StrategyResponse, TimelineResponse, VoteResponse,
} from '../../shared/types';

/** Flip to true to develop scenes without a Devvit playtest. */
const MOCK = false;

export class ApiClientError extends Error {}

const request = async <T>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const json = (await res.json()) as T | ApiError;
  if (!res.ok || (json as ApiError).status === 'error') {
    throw new ApiClientError((json as ApiError).message ?? `Request failed: ${path}`);
  }
  return json as T;
};

// ---------- mock fixtures ----------

const mockInit: InitResponse = {
  type: 'init',
  postId: 't3_mock',
  city: {
    day: 5, cycle: 1, status: 'alive',
    population: 143, food: 22, power: 31, medicine: 7,
    morale: 44, threat: 68, defense: 35,
    crisisId: 'refugee_convoy', activeLaw: null, lawExpiresDay: 0,
  },
  player: {
    userId: 't2_mock', username: 'mock_citizen', role: 'scout', roleChangedDay: 3,
    faction: null, factionRep: 0, energyUsedToday: 1, lastActiveDay: 5,
    injuredUntilDay: 0, totalContribution: 120, streak: 3,
  },
  effectiveEnergy: 3,
  crisis: {
    id: 'refugee_convoy',
    title: 'The Convoy at the Gate',
    narrative: 'A refugee convoy is outside the gate. Thirty souls, thin and coughing.',
    options: [
      { id: 'a', label: 'Let them in', description: 'More mouths — and more hands.', effects: { population: 30, food: -20, morale: 4 } },
      { id: 'b', label: 'Turn them away', description: 'The city cannot bleed for strangers.', effects: { morale: -10, defense: 3 } },
      { id: 'c', label: 'Inspect first', description: 'Scouts check the convoy.', effects: { population: 15, food: -8, threat: 3 } },
    ],
  },
  crisisVotes: { a: 12, b: 5, c: 8 },
  yourCrisisVote: null,
  strategyVotes: { prepare_raid: 9, stockpile_food: 6, repair_power: 4 },
  yourStrategyVote: null,
  yourActionsToday: { grow_food: 1 },
  missionUsedToday: false,
  resolving: false,
  timelinePreview: {
    day: 4, cycle: 1,
    headline: 'Day 4: The city survived to see one more dawn.',
    events: ['12 citizen actions strengthened the city.', '3 expeditions returned: +7 food, +2 medicine, +5 scrap.'],
    deltas: { food: -9, power: -4, morale: -6, threat: 8 },
    crisisId: 'blackout_ward', winningOptionId: 'a',
  },
  // Plan 2 fields — inert stubs for the mock fixture.
  activeLaw: null,
  raidInDays: 5,
  factionInfluence: { builders: 8, wardens: 6, seekers: 12, hearth: 4 },
  yourFaction: null,
  yourFactionRep: 0,
};

// ---------- public api ----------

export const api = {
  init: (): Promise<InitResponse> =>
    MOCK ? Promise.resolve(mockInit) : request<InitResponse>('/api/init'),

  chooseRole: (role: Role): Promise<RoleResponse> =>
    MOCK
      ? Promise.resolve({ type: 'role', player: { ...mockInit.player, role } })
      : request<RoleResponse>('/api/role', { role }),

  takeAction: (action: ActionType): Promise<ActionResponse> =>
    MOCK
      ? Promise.resolve({
          type: 'action',
          player: { ...mockInit.player, energyUsedToday: mockInit.player.energyUsedToday + 1 },
          effectiveEnergy: 3,
          yourActionsToday: { ...mockInit.yourActionsToday, [action]: 1 },
        })
      : request<ActionResponse>('/api/action', { action }),

  vote: (optionId: string): Promise<VoteResponse> =>
    MOCK
      ? Promise.resolve({
          type: 'vote',
          crisisVotes: { ...mockInit.crisisVotes, [optionId]: (mockInit.crisisVotes[optionId] ?? 0) + 1 },
          yourCrisisVote: optionId,
        })
      : request<VoteResponse>('/api/vote', { optionId }),

  strategy: (planId: StrategyPlanId): Promise<StrategyResponse> =>
    MOCK
      ? Promise.resolve({
          type: 'strategy',
          strategyVotes: { ...mockInit.strategyVotes, [planId]: (mockInit.strategyVotes[planId] ?? 0) + 1 },
          yourStrategyVote: planId,
        })
      : request<StrategyResponse>('/api/strategy', { planId }),

  missionStart: (): Promise<MissionStartResponse> =>
    MOCK
      ? Promise.resolve({
          type: 'mission-start',
          tokenId: 'mock-token',
          layoutSeed: 4242,
          lootSeed: 999,
          airSeconds: 105,
          player: mockInit.player,
          effectiveEnergy: 2,
        })
      : request<MissionStartResponse>('/api/mission/start'),

  missionComplete: (body: MissionCompleteRequest): Promise<MissionCompleteResponse> =>
    MOCK
      ? Promise.resolve({
          type: 'mission-complete',
          banked: { food: 3, medicine: 1, scrap: 2 },
          injured: body.status !== 'escaped',
          contributionGained: 30,
          player: mockInit.player,
        })
      : request<MissionCompleteResponse>('/api/mission/complete', body),

  timeline: (): Promise<TimelineResponse> =>
    MOCK
      ? Promise.resolve({ type: 'timeline', entries: [mockInit.timelinePreview!] })
      : request<TimelineResponse>('/api/timeline'),

  leaderboard: (): Promise<LeaderboardResponse> =>
    MOCK
      ? Promise.resolve({
          type: 'leaderboard',
          contributors: [{ userId: 't2_mock', username: 'mock_citizen', score: 120 }],
          scouts: [{ userId: 't2_mock', username: 'mock_citizen', score: 6 }],
          factions: {
            builders: { rep: 8, standing: 2 },
            wardens: { rep: 6, standing: 3 },
            seekers: { rep: 12, standing: 1 },
            hearth: { rep: 4, standing: 4 },
          },
        })
      : request<LeaderboardResponse>('/api/leaderboard'),
};
