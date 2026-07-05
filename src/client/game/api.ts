import type {
  ActionResponse, ActionType, ApiError, CityTraitId, DramaEvent, InitResponse,
  LeaderboardResponse, Marked, MissionCompleteRequest, MissionCompleteResponse, MissionRoute,
  MissionStartResponse, PledgeInfo, PledgeKind, PledgeRequest, PledgeResponse, Role,
  RoleResponse, Standing, StrategyPlanId, StrategyResponse, TimelineResponse, VillageResponse,
  VoteResponse, WorldCity, WorldResponse,
} from '../../shared/types';

/** Flip to true to force mock mode even inside a Devvit playtest. */
const FORCE_MOCK = false;

/**
 * Mock mode auto-engages when the client is served standalone (localhost /
 * `?mock=1`) so the UI is reviewable in a plain browser; inside a Devvit
 * webview (webview.devvit.net) the real endpoints are used.
 */
const MOCK =
  FORCE_MOCK ||
  (typeof window !== 'undefined' &&
    (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname) ||
      /[?&]mock=1\b/.test(window.location.search)));

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

// Varied masked citizen names (mirrors the server-side name generator pool).
const NAMES = {
  you: 'lastferry',
  helpers: ['ashen_fox', 'quiet_marrow', 'saltcedar'],
  recent: ['brackenwren', 'ferrous_ivy', 'palewick', 'sable_reed', 'mx_ember', 'coldharbor'],
} as const;

const mockMarked: Marked = {
  id: 'marked_mira_d5',
  name: 'Mira, the greenhouse child',
  kind: 'person',
  blurb: 'Fever took her at the greenhouse. The medics need resolve by dawn.',
  goal: 40,
  pledged: 23,
  unit: 'resolve',
  savedYesterday: { name: 'The North Wall', saved: true },
};

const mockPledge: PledgeInfo = {
  options: [
    { id: 'stand_vigil', label: 'Stand Vigil', icon: '🕯️', effect: '+defense · +resolve' },
    { id: 'share_rations', label: 'Share Rations', icon: '🍞', effect: '+food · +resolve' },
    { id: 'run_messages', label: 'Run Messages', icon: '🕊️', effect: '+morale · +resolve' },
    { id: 'back_council', label: 'Back the Council', icon: '🏛️', effect: '+unity · +resolve' },
  ],
  usedToday: false,
  ledger: {
    topHelpers: [...NAMES.helpers],
    recent: [...NAMES.recent],
    mine: 2,
  },
};

const mockDrama: DramaEvent[] = [
  { icon: '🕯️', text: 'ashen_fox stood vigil for Mira — the medics take heart.', kind: 'marked' },
  { icon: '⚔️', text: 'Raiders probed the North Wall at dusk. The watch held.', kind: 'raid' },
  { icon: '🎒', text: 'quiet_marrow crawled back from the deep ruins with 7 food.', kind: 'action' },
  { icon: '🗳️', text: '25 citizens have voted on the Convoy at the Gate.', kind: 'crisis' },
  { icon: '📜', text: 'The Council leans toward Prepare for Raid — 9 backers.', kind: 'law' },
  { icon: '🩹', text: 'saltcedar treated the sick through the night shift.', kind: 'action' },
  { icon: '🏚️', text: 'A rival city went dark last night. Theirs, not ours.', kind: 'city' },
  { icon: '🌅', text: 'Dawn broke over the city — day 5, still standing.', kind: 'city' },
];

const mockStanding: Standing = {
  survivalDays: 26, // dawns survived across the city's whole life (cycle 3, day 5)
  rankLabel: 'The city holds · Day 5',
  contributionRank: 3,
};

const mockInit: InitResponse = {
  type: 'init',
  postId: 't3_mock',
  city: {
    day: 5, cycle: 3, status: 'alive', worldSeed: 0, trait: 'frozen',
    population: 143, food: 22, power: 31, medicine: 7,
    morale: 44, threat: 68, defense: 35,
    crisisId: 'refugee_convoy', activeLaw: null, lawExpiresDay: 0,
  },
  player: {
    userId: 't2_mock', username: NAMES.you, role: 'scout', roleChangedDay: 3,
    faction: null, factionRep: 0, energyUsedToday: 1, lastActiveDay: 5,
    injuredUntilDay: 0, totalContribution: 120, streak: 3,
    roleRep: { scout: 80 }, title: 'Night Scout',
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
    day: 4, cycle: 3,
    headline: 'Day 4: The city survived to see one more dawn.',
    events: ['12 citizen actions strengthened the city.', '3 expeditions returned: +7 food, +2 medicine, +5 scrap.'],
    deltas: { food: -9, power: -4, morale: -6, threat: 8 },
    crisisId: 'blackout_ward', winningOptionId: 'a',
  },
  firstVisitToday: true,
  dawnReport: {
    day: 4,
    citySummary: ['12 citizen actions strengthened the city.', '3 expeditions returned: +7 food, +2 medicine, +5 scrap.'],
    yourImpact: ['You took 2 city actions for the city.', 'Your expedition banked +3 food, +1 medicine.', 'You voted on the crisis.'],
    title: 'Night Scout',
  },
  // Plan 2 fields — inert stubs for the mock fixture.
  activeLaw: null,
  raidInDays: 5,
  factionInfluence: { builders: 8, wardens: 6, seekers: 12, hearth: 4 },
  yourFaction: null,
  yourFactionRep: 0,
  forecast: { food: 8, power: 24, medicine: 5, morale: 38, threat: 76, raidLikely: false },
  trait: {
    id: 'frozen',
    label: 'Frozen Start',
    blurb: 'Power decays 50% faster; food keeps 15% longer.',
  } satisfies { id: CityTraitId; label: string; blurb: string },
  // ---- Reddit-native hook layer (Plan 1) ----
  marked: mockMarked,
  pledge: mockPledge,
  drama: mockDrama,
  standing: mockStanding,
};

/** How much one mock pledge moves the Marked bar. */
const MOCK_PLEDGE_PRESSURE = 3;

// ---------- World of Cities (Plan 2 — WORLD tab) ----------

// Cross-sub world fixture: 12 varied cities, one of them yours (r/meadowbrook,
// rank #4 by longest dawn — coherent with mockInit: cycle 3, day 5, threat 68).
// `survivalDays` is the headline stat (dawns survived across the city's whole
// life); `day` is the current run. Append `?worldlocked=1` to the preview URL
// to see the not-yet-eligible state (small-sub aspiration view).
const MOCK_WORLD_CITIES: readonly WorldCity[] = [
  { subreddit: 'r/lastlight', cycle: 1, day: 63, survivalDays: 63, status: 'thriving', threat: 18, population: 540, savedCount: 44, activePlayers: 216, isYou: false },
  { subreddit: 'r/ironhollow', cycle: 2, day: 21, survivalDays: 47, status: 'holding', threat: 46, population: 402, savedCount: 31, activePlayers: 129, isYou: false },
  { subreddit: 'r/nightmarket', cycle: 1, day: 38, survivalDays: 38, status: 'under_raid', threat: 87, population: 355, savedCount: 26, activePlayers: 244, isYou: false },
  { subreddit: 'r/meadowbrook', cycle: 3, day: 5, survivalDays: 26, status: 'holding', threat: 68, population: 143, savedCount: 12, activePlayers: 37, isYou: true },
  { subreddit: 'r/greyharbor', cycle: 2, day: 9, survivalDays: 22, status: 'thriving', threat: 25, population: 260, savedCount: 17, activePlayers: 88, isYou: false },
  { subreddit: 'r/emberfall', cycle: 1, day: 19, survivalDays: 19, status: 'strained', threat: 71, population: 205, savedCount: 9, activePlayers: 54, isYou: false },
  { subreddit: 'r/coldwater', cycle: 1, day: 14, survivalDays: 14, status: 'holding', threat: 40, population: 178, savedCount: 8, activePlayers: 41, isYou: false },
  { subreddit: 'r/thornreach', cycle: 2, day: 4, survivalDays: 11, status: 'strained', threat: 66, population: 130, savedCount: 4, activePlayers: 26, isYou: false },
  { subreddit: 'r/saltflats', cycle: 1, day: 9, survivalDays: 9, status: 'thriving', threat: 30, population: 96, savedCount: 6, activePlayers: 33, isYou: false },
  { subreddit: 'r/deadchannel', cycle: 1, day: 8, survivalDays: 8, status: 'fallen', threat: 94, population: 0, savedCount: 3, activePlayers: 5, isYou: false },
  { subreddit: 'r/pinegate', cycle: 1, day: 6, survivalDays: 6, status: 'holding', threat: 35, population: 84, savedCount: 2, activePlayers: 19, isYou: false },
  { subreddit: 'r/dustmarch', cycle: 1, day: 3, survivalDays: 3, status: 'fallen', threat: 99, population: 0, savedCount: 0, activePlayers: 2, isYou: false },
];

const mockWorld = (): WorldResponse => {
  const locked =
    typeof window !== 'undefined' && /[?&]worldlocked=1\b/.test(window.location.search);
  if (locked) {
    // Not eligible yet: your city is absent from the world — read-only aspiration.
    const cities = MOCK_WORLD_CITIES.filter((c) => !c.isYou);
    return {
      type: 'world',
      cities,
      yourRank: null,
      totalCities: cities.length,
      eligible: false,
      subscribers: 214,
      minSubscribers: 500,
    };
  }
  return {
    type: 'world',
    cities: [...MOCK_WORLD_CITIES],
    yourRank: 4,
    totalCities: MOCK_WORLD_CITIES.length,
    eligible: true,
    subscribers: 1243,
    minSubscribers: 500,
  };
};

// ---------- public api ----------

export const api = {
  init: (): Promise<InitResponse> =>
    MOCK ? Promise.resolve(mockInit) : request<InitResponse>('/api/init'),

  pledge: (kind: PledgeKind): Promise<PledgeResponse> =>
    MOCK
      ? Promise.resolve({
          type: 'pledge',
          marked: {
            ...mockMarked,
            pledged: Math.min(mockMarked.goal, mockMarked.pledged + MOCK_PLEDGE_PRESSURE),
          },
          pledge: {
            ...mockPledge,
            usedToday: true,
            ledger: {
              ...mockPledge.ledger,
              mine: mockPledge.ledger.mine + 1,
              recent: [NAMES.you, ...mockPledge.ledger.recent].slice(0, 6),
            },
          },
          player: { ...mockInit.player, totalContribution: mockInit.player.totalContribution + 5 },
        } satisfies PledgeResponse)
      : request<PledgeResponse>('/api/pledge', { kind } satisfies PledgeRequest),

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
          unlockedTitle: null,
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

  missionStart: (route: MissionRoute): Promise<MissionStartResponse> =>
    MOCK
      ? Promise.resolve({
          type: 'mission-start',
          tokenId: 'mock-token',
          layoutSeed: 4242,
          lootSeed: 999,
          airSeconds: 105,
          route,
          player: mockInit.player,
          effectiveEnergy: 2,
        })
      : request<MissionStartResponse>('/api/mission/start', { route }),

  missionComplete: (body: MissionCompleteRequest): Promise<MissionCompleteResponse> =>
    MOCK
      ? Promise.resolve({
          type: 'mission-complete',
          banked: { food: 3, medicine: 1, scrap: 2 },
          injured: body.status !== 'escaped',
          contributionGained: 30,
          player: mockInit.player,
          unlockedTitle: null,
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
          contributors: [
            { userId: 't2_m1', username: 'ashen_fox', score: 210 },
            { userId: 't2_m2', username: 'quiet_marrow', score: 164 },
            { userId: 't2_mock', username: NAMES.you, score: 120 },
            { userId: 't2_m3', username: 'saltcedar', score: 96 },
          ],
          scouts: [
            { userId: 't2_m4', username: 'brackenwren', score: 8 },
            { userId: 't2_mock', username: NAMES.you, score: 6 },
            { userId: 't2_m5', username: 'ferrous_ivy', score: 4 },
          ],
          factions: {
            builders: { rep: 8, standing: 2 },
            wardens: { rep: 6, standing: 3 },
            seekers: { rep: 12, standing: 1 },
            hearth: { rep: 4, standing: 4 },
          },
        })
      : request<LeaderboardResponse>('/api/leaderboard'),

  village: (): Promise<VillageResponse> =>
    MOCK
      ? Promise.resolve({
          type: 'village',
          villageName: 'THE LAST CITY',
          subreddit: 'r/meadowbrook',
          cycle: mockInit.city.cycle,
          day: mockInit.city.day,
          status: mockInit.city.status,
          prosperity: mockInit.city.morale,
          pills: { food: mockInit.city.food, power: mockInit.city.power, medicine: mockInit.city.medicine, threat: mockInit.city.threat },
          raidInDays: mockInit.raidInDays,
          activeLawLabel: null,
          zones: [
            { id: 'grow_food', name: 'Farm', count: 4 },
            { id: 'repair_power', name: 'Generator', count: 2 },
            { id: 'treat_sick', name: 'Clinic', count: 1 },
            { id: 'guard_wall', name: 'Watchtower', count: 3 },
          ],
          villagers: [
            { maskedName: 'ashen•••', role: 'scout', faction: 'seekers', color: 0x6c8be0, online: true, since: 'day 3' },
            { maskedName: 'salt•••', role: 'engineer', faction: 'builders', color: 0xe8c34a, online: true, since: 'day 1' },
            { maskedName: 'brack•••', role: 'farmer', faction: null, color: 0x4caf50, online: false, since: 'day 2' },
            { maskedName: 'ember•••', role: 'speaker', faction: 'hearth', color: 0xa03030, online: true, since: 'day 1' },
          ],
          onlineCount: 3,
          totalCount: 4,
          notices: ['Day 4: The city survived to see one more dawn.', '3 expeditions returned with supplies.'],
        })
      : request<VillageResponse>('/api/village'),

  /** GET /api/world — the cross-subreddit World of Cities (WORLD tab). */
  world: (): Promise<WorldResponse> =>
    MOCK ? Promise.resolve(mockWorld()) : request<WorldResponse>('/api/world'),
};
