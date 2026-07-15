// ===========================================================================
// FRONTEND-ONLY DEMO BACKEND
// ===========================================================================
// One More Dawn is a Reddit (Devvit) app: the client talks to a real server at
// /api/* (src/server/routes/api.ts). This module lets the WHOLE client run with
// NO server — a judge-facing "visual demo" — by monkey-patching window.fetch so
// every /api/* call resolves against in-memory fixtures instead of the network.
//
// It mirrors the DEFAULT happy path of the dev harness mock (vite.dev3d.config.mjs
// with MOCK_API=1), so the client boots into its full LIVE experience: the daily
// mission + role duty, badges, crisis vote, council plans, The Marked pledge,
// city actions, the cosmetic shop + land expansion, the daily puzzle, the world
// map, leaderboard, and City Chatter. State is per-session and never persisted —
// a reload starts fresh. It is compiled ONLY into the demo build (guarded by the
// VITE_FRONTEND_ONLY flag in game.tsx); the real Devvit build never ships it.
// ===========================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

type Json = Record<string, any>;
type Handled = { status: number; body: unknown };

// ---------- Static-ish fixtures (the "seed" of the demo city) ----------

const CITY = {
  day: 6, cycle: 1, status: 'alive', worldSeed: 12345, trait: 'standard',
  population: 143, food: 210, power: 78, medicine: 34, morale: 52, threat: 64, defense: 41,
  crisisId: 'first_light', activeLaw: null, lawExpiresDay: 0,
  cityLevel: 1, buildProgress: 12, unlockedBuildings: ['shelter'],
};

let mockPlayer: Json = {
  userId: 't2_demo', username: 'you', role: 'guard', roleChangedDay: 1, faction: null, factionRep: 0,
  roleRep: {}, title: 'Wall-Warden', avatar: null, energyUsedToday: 1, lastActiveDay: 6,
  injuredUntilDay: 0, totalContribution: 14, streak: 3, lapsedStreak: 12,
  coins: 4, coinsEarnedToday: 1, coinsEarnedCycle: 1, coinsEarnedDay: 6,
  ownedCosmetics: [], equippedCosmetics: {},
  treasuryProgress: 6, treasuryBacklog: 0, treasuryPaid: 2,
};

// The guard's role duty (mirrors roleTask('guard', …)); the badges wall reads the
// house tier / streak / rank below, so both new features render in the demo.
const ROLE_TASK_FIX = {
  id: 'role:guard:2', icon: '🛡️', text: 'Hold the wall: Guard the Wall ×2 today.',
  kind: 'action', action: 'guard_wall', target: 2, level: 25, reward: 3, progress: 1, done: false,
};

const SHOP_PRICES: Json = { hearth_lantern: 3, crimson_banner: 5, garden_plot: 6, slate_roof: 8, dawn_gold_trim: 12 };
const SHOP_SLOTS: Json = { hearth_lantern: 'light', crimson_banner: 'banner', garden_plot: 'yard', slate_roof: 'roof', dawn_gold_trim: 'roof' };
const economyOf = (p: Json) => ({
  coins: p.coins ?? 0,
  earnedToday: p.coinsEarnedCycle === 1 && p.coinsEarnedDay === 6 ? (p.coinsEarnedToday ?? 0) : 0,
  dailyCap: 5,
  owned: p.ownedCosmetics ?? [],
  equipped: p.equippedCosmetics ?? {},
});

const RECON_NEEDED = 5;
const mockRebuildDone = RECON_NEEDED; // demo starts with no raid damage outstanding
const reconstructionOf = () => {
  const active = mockRebuildDone < RECON_NEEDED;
  return {
    active,
    required: active ? RECON_NEEDED : 0,
    contributed: active ? mockRebuildDone : 0,
    destroyed: 0,
    damaged: active ? 1 : 0,
    next: active ? { username: 'ashen_fox', index: 6, status: 'damaged', done: mockRebuildDone, needed: RECON_NEEDED } : null,
  };
};

const domeOf = () => {
  const segments = [88, 92, 80, 100, 96, 84];
  const energyPct = Math.round(segments.reduce((a, b) => a + b, 0) / segments.length);
  let nextRepairSegment: number | null = null;
  let lo = 100;
  segments.forEach((s, i) => { if (s < lo && s < 100) { lo = s; nextRepairSegment = i; } });
  return { segments, energyPct, shield: 3, repairThreshold: 12, nextRepairSegment };
};

let mockTreasury = { balance: 4, collected: 11, invested: 7 };
const treasuryOf = (p: Json) => ({
  balance: mockTreasury.balance, totalCollected: mockTreasury.collected, totalInvested: mockTreasury.invested,
  levyEvery: 10,
  yours: { progress: p.treasuryProgress ?? 0, backlog: p.treasuryBacklog ?? 0, paid: p.treasuryPaid ?? 0 },
});

const LAND_DEFS = [
  { id: 'outer_fields', name: 'Outer Fields', description: 'Open connected farmland, roads, and new house plots.', target: 120, requires: null },
  { id: 'river_ward', name: 'River Ward', description: 'Extend the city along the river with room for trade and homes.', target: 260, requires: 'outer_fields' },
  { id: 'high_keep', name: 'High Keep', description: 'Claim the connected hill for walls and civic landmarks.', target: 450, requires: 'river_ward' },
];
let mockLandFunding: Json = { outer_fields: 115, river_ward: 0, high_keep: 0 };
const landOf = () => {
  const unlocked: string[] = [];
  const projects = LAND_DEFS.map((d) => {
    const funded = Math.min(mockLandFunding[d.id] ?? 0, d.target);
    const isUnlocked = funded >= d.target;
    if (isUnlocked) unlocked.push(d.id);
    const gate = d.requires ? LAND_DEFS.find((x) => x.id === d.requires) : null;
    const gateOpen = !gate || (mockLandFunding[gate.id] ?? 0) >= gate.target;
    return { ...d, funded, remaining: d.target - funded, unlocked: isUnlocked, available: !isUnlocked && gateOpen };
  });
  return { projects, activeProjectId: projects.find((p) => p.available)?.id ?? null, unlocked };
};

const CRISIS = {
  id: 'first_light', title: 'First Light',
  narrative: 'The generators cough back to life. Survivors gather at the wall, waiting to be told what this city will become.',
  options: [
    { id: 'a', label: 'Fortify first', description: 'Spend the day on the wall.', effects: { defense: 6, morale: -3 } },
    { id: 'b', label: 'Feed everyone', description: 'Open the stores.', effects: { food: -8, morale: 8 } },
    { id: 'c', label: 'Map the ruins', description: 'Send runners out.', effects: { threat: 4, medicine: 3, food: 3 } },
  ],
};

const MARKED = {
  id: 'm1', name: 'Mira, the greenhouse child', kind: 'person',
  blurb: 'The fever took her mother; the city will not lose her too.',
  goal: 40, pledged: 23, unit: 'resolve', savedYesterday: { name: 'The North Wall', saved: true },
};
const PLEDGE = {
  options: [
    { id: 'stand_vigil', label: 'Stand Vigil', icon: '🕯️', effect: '+morale' },
    { id: 'share_rations', label: 'Share Rations', icon: '🍞', effect: '+resolve' },
    { id: 'run_messages', label: 'Run Messages', icon: '🕊️', effect: '+resolve' },
    { id: 'back_council', label: 'Back the Council', icon: '🏛️', effect: '+unity' },
  ],
  usedToday: false, ledger: { topHelpers: ['u/ashen_fox', 'u/saltcedar'], recent: ['u/palewick pledged'], mine: 0 },
};

const INIT_BASE = {
  type: 'init', postId: 't3_demo', cityName: 'VAELMAR',
  challenge: { id: '0:2', icon: '🌾', text: 'Feed the stores: Grow Food ×2 today.', kind: 'action', action: 'grow_food', target: 2, level: 7, reward: 2, progress: 1, done: false },
  roleTask: ROLE_TASK_FIX,
  city: CITY, effectiveEnergy: 3, crisis: CRISIS,
  crisisVotes: { a: 12, b: 7, c: 5 }, yourCrisisVote: null,
  strategyVotes: { prepare_raid: 9, stockpile_food: 6, repair_power: 4 }, yourStrategyVote: null,
  yourActionsToday: { grow_food: 1 }, missionUsedToday: false, resolving: false,
  timelinePreview: { day: 5, cycle: 1, headline: 'The wall held', events: ['Raiders probed the north wall, the watch held.', 'Food ran short; rationing began.'], deltas: { food: -12, threat: -20 }, crisisId: 'ration_riots', winningOptionId: 'b' },
  activeLaw: null, raidInDays: 6, factionInfluence: { builders: 2, wardens: 5, seekers: 1, hearth: 3 },
  yourFaction: null, yourFactionRep: 0,
  dawnReport: { day: 5, citySummary: ['Raiders probed the north wall, the watch held.', 'Food ran short; rationing began.'], yourImpact: ['You took 2 city action(s) for the city.', 'You voted on the crisis.'], title: 'Wall-Warden', raidAftermath: null },
  firstVisitToday: true,
  forecast: { food: 198, power: 75, medicine: 32, morale: 49, threat: 70, raidLikely: false },
  trait: { id: 'standard', label: 'Standard', blurb: 'A city like any other.' },
  marked: MARKED, pledge: PLEDGE,
  drama: [{ icon: '⚔️', text: 'Raiders probed the North Wall at dusk. The watch held.', kind: 'raid' }, { icon: '🕯️', text: 'ashen_fox stood vigil for Mira.', kind: 'marked' }],
  standing: { survivalDays: 5, rankLabel: 'holding the line · day 6', contributionRank: 7 },
  build: {
    stage: 1, stageLabel: 'Settlement', unlocked: ['shelter'],
    next: { id: 'farm', name: 'Farm', description: 'Worked beds, food grows faster.', progressRequired: 30, effect: '+3 food/day' },
    progress: 12, progressRequired: 30, contributorsToday: 8, youBuiltToday: false,
  },
  houses: {
    total: 24, cap: 240,
    founder: { username: 'ashen_fox' },
    yours: { index: 2, tier: 3, isFounder: false },
    named: [{ username: 'ashen_fox', index: 0, tier: 4 }, { username: 'saltcedar', index: 1, tier: 3 }],
    damaged: [],
  },
};

const WORLD = {
  type: 'world', totalCities: 6, yourRank: 2, eligible: true, subscribers: 1200, minSubscribers: 500,
  cities: [
    { subreddit: 'r/ironhollow', cycle: 3, day: 22, survivalDays: 22, status: 'thriving', threat: 30, population: 240, savedCount: 5, activePlayers: 18, isYou: false },
    { subreddit: 'r/meadowbrook', cycle: 1, day: 6, survivalDays: 6, status: 'holding', threat: 64, population: 143, savedCount: 1, activePlayers: 7, isYou: true },
  ],
};
const LEADERBOARD = {
  type: 'leaderboard',
  contributors: [
    { username: 'ashen_fox', score: 142 }, { username: 'saltcedar', score: 118 },
    { username: 'you', score: 96 }, { username: 'quiet_marrow', score: 74 }, { username: 'palewick', score: 51 },
  ],
  scouts: [{ username: 'quiet_marrow', score: 7 }],
  factions: { builders: { rep: 12, standing: 2 }, wardens: { rep: 20, standing: 1 }, seekers: { rep: 4, standing: 4 }, hearth: { rep: 9, standing: 3 } },
};

// ---------- Mutable per-session state ----------
let mockCrisisVotes: Json = { ...INIT_BASE.crisisVotes };
let mockCrisisVote: string | null = null;
let mockStrategyVotes: Json = { ...INIT_BASE.strategyVotes };
let mockStrategyVote: string | null = null;
let mockActions: Json = { ...INIT_BASE.yourActionsToday };
let mockMarked: Json = { ...MARKED };
let mockPledge: Json = { ...PLEDGE };

const currentInit = () => ({
  ...INIT_BASE,
  player: mockPlayer,
  roleTask: mockPlayer.role ? ROLE_TASK_FIX : null,
  crisisVotes: mockCrisisVotes,
  yourCrisisVote: mockCrisisVote,
  strategyVotes: mockStrategyVotes,
  yourStrategyVote: mockStrategyVote,
  yourActionsToday: mockActions,
  marked: mockMarked,
  pledge: mockPledge,
  economy: economyOf(mockPlayer),
  land: landOf(),
  reconstruction: reconstructionOf(),
  dome: domeOf(),
  treasury: treasuryOf(mockPlayer),
});

// One accepted contribution: +1 Coin up to the daily cap, mirrored statefully.
const earnCoin = () => {
  const earned = mockPlayer.coinsEarnedToday ?? 0;
  const gained = earned < 5 ? 1 : 0;
  let coins = (mockPlayer.coins ?? 0) + gained;
  const oldBacklog = mockPlayer.treasuryBacklog ?? 0;
  const backlogPaid = Math.min(oldBacklog, gained, coins);
  coins -= backlogPaid;
  const progressTotal = (mockPlayer.treasuryProgress ?? 0) + 1;
  const dueAdded = Math.floor(progressTotal / 10);
  const newlyDuePaid = Math.min(dueAdded, coins);
  coins -= newlyDuePaid;
  const treasuryPaid = backlogPaid + newlyDuePaid;
  mockPlayer = {
    ...mockPlayer, coins, coinsEarnedToday: earned + gained,
    treasuryProgress: progressTotal % 10,
    treasuryBacklog: oldBacklog - backlogPaid + dueAdded - newlyDuePaid,
    treasuryPaid: (mockPlayer.treasuryPaid ?? 0) + treasuryPaid,
  };
  mockTreasury = { ...mockTreasury, balance: mockTreasury.balance + treasuryPaid, collected: mockTreasury.collected + treasuryPaid };
  return { gained, treasuryPaid };
};

// ---------- Daily puzzle ----------
const MOCK_PUZZLE_LEVEL = {
  id: 1, name: 'The Dark District', chapter: 1, width: 3, height: 3, moveTarget: 6,
  cells: [
    { t: 'source', x: 0, y: 2, capacity: -1 },
    { t: 'tile', x: 0, y: 1, kind: 'straight', rot: 1, sol: 0 },
    { t: 'tile', x: 0, y: 0, kind: 'corner', rot: 0, sol: 1 },
    { t: 'tile', x: 1, y: 0, kind: 'straight', rot: 0, sol: 1 },
    { t: 'building', x: 2, y: 0, kind: 'clinic', required: true },
    { t: 'tile', x: 1, y: 2, kind: 'straight', rot: 0, sol: 1 },
    { t: 'building', x: 2, y: 2, kind: 'house', required: false },
  ],
};
let mockPuzzleBest: Json | null = null;
let mockPuzzleSolvedCount = 41;

// ---------- City Chatter ----------
const CHATTER_THREAD_URL = 'https://www.reddit.com/r/meadowbrook/comments/chatter_week_4/one_more_dawn_city_chatter_hub/';
let mockChatterMessages: Json[] = [
  { id: 't1_chatter_1', category: 'strategy', author: 'ashen_fox', text: 'Fortify the north wall before spending the medicine.', createdAt: '2026-07-14T08:30:00.000Z' },
  { id: 't1_chatter_2', category: 'raid', author: 'quiet_marrow', text: 'Keep one watch team near the outer fields.', createdAt: '2026-07-14T08:25:00.000Z' },
];
const chatterState = (category: string) => ({
  type: 'chatter', ready: true, weekKey: '2026-07-13', cityDay: 6, category,
  rootCommentId: `t1_${category}_day_6`, threadUrl: CHATTER_THREAD_URL,
  messages: mockChatterMessages.filter((m) => m.category === category).map(({ category: _c, ...m }) => ({ ...m, permalink: `${CHATTER_THREAD_URL}${m.id}/` })),
  feedAvailable: true, maxLength: 250, cooldownSeconds: 15,
  attributionNotice: 'This frontend demo keeps messages local to your browser. Nothing is posted to Reddit.',
});

// ---------- The router: (path, method, body) -> { status, body } ----------
function handle(path: string, method: string, body: Json): Handled {
  const clean = path.split('?')[0] ?? path;
  const query = path.includes('?') ? new URLSearchParams(path.slice(path.indexOf('?'))) : new URLSearchParams();

  if (clean === '/api/init') return { status: 200, body: currentInit() };
  if (clean === '/api/world') return { status: 200, body: WORLD };
  if (clean === '/api/leaderboard') return { status: 200, body: LEADERBOARD };

  if (clean === '/api/puzzle') {
    return { status: 200, body: {
      type: 'puzzle', dailyId: '2026-07-14', levelId: MOCK_PUZZLE_LEVEL.id, level: MOCK_PUZZLE_LEVEL,
      yourBest: mockPuzzleBest, solvedCount: mockPuzzleSolvedCount, bestMoves: 4,
      yourRank: mockPuzzleBest ? 12 : null,
      levels: [{ id: 1, name: MOCK_PUZZLE_LEVEL.name, chapter: 1, best: mockPuzzleBest }],
    } };
  }
  if (clean === '/api/puzzle/solve') {
    const moves = Number(body.moves) || 0;
    const stars = moves <= MOCK_PUZZLE_LEVEL.moveTarget ? 3 : 1;
    const first = !mockPuzzleBest;
    const score = { stars, moves, timeMs: Number(body.timeMs) || 0 };
    if (first || stars > (mockPuzzleBest!.stars as number) || (stars === mockPuzzleBest!.stars && moves < (mockPuzzleBest!.moves as number))) mockPuzzleBest = score;
    if (first) mockPuzzleSolvedCount += 1;
    return { status: 200, body: {
      type: 'puzzle_solve', accepted: true, stars, best: mockPuzzleBest, improved: first,
      reward: first ? '+3 standing · the district is back online' : null,
      solvedCount: mockPuzzleSolvedCount, bestMoves: 4, yourRank: 12,
    } };
  }

  if (clean === '/api/chatter' && method === 'GET') {
    return { status: 200, body: chatterState(query.get('category') ?? 'strategy') };
  }
  if (clean === '/api/chatter' && method === 'POST') {
    const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
    if (!text || text.length > 250 || /https?:\/\/|www\./i.test(text)) {
      return { status: 400, body: { status: 'error', message: 'Write a valid City Chatter message.' } };
    }
    const category = ['strategy', 'raid', 'rebuilding', 'general'].includes(body.category) ? body.category : 'strategy';
    const posted = { id: `t1_chatter_${mockChatterMessages.length + 1}`, category, author: 'you', text, createdAt: new Date().toISOString() };
    mockChatterMessages = [posted, ...mockChatterMessages];
    return { status: 200, body: {
      type: 'chatter-post',
      message: { id: posted.id, author: posted.author, text: posted.text, createdAt: posted.createdAt, permalink: `${CHATTER_THREAD_URL}${posted.id}/` },
      postedAs: 'you', threadUrl: CHATTER_THREAD_URL,
    } };
  }

  if (clean === '/api/action') {
    const acts = body.action === 'build_city' ? { ...mockActions, build_city: (mockActions.build_city ?? 0) + 1 } : { ...mockActions, [body.action]: (mockActions[body.action] ?? 0) + 1 };
    mockActions = acts;
    mockPlayer = { ...mockPlayer, energyUsedToday: Math.min(3, (mockPlayer.energyUsedToday ?? 0) + 1) };
    const award = earnCoin();
    return { status: 200, body: {
      type: 'action', player: mockPlayer, effectiveEnergy: 3, yourActionsToday: acts, unlockedTitle: null,
      coinsGained: award.gained, treasuryPaid: award.treasuryPaid, economy: economyOf(mockPlayer),
      reconstruction: reconstructionOf(), rebuilt: null, dome: domeOf(), domeRepaired: null,
    } };
  }
  if (clean === '/api/vote') {
    mockCrisisVote = String(body.optionId ?? 'a');
    mockCrisisVotes = { ...mockCrisisVotes, [mockCrisisVote]: (mockCrisisVotes[mockCrisisVote] ?? 0) + 1 };
    const award = earnCoin();
    return { status: 200, body: { type: 'vote', crisisVotes: mockCrisisVotes, yourCrisisVote: mockCrisisVote, coinsGained: award.gained, treasuryPaid: award.treasuryPaid, economy: economyOf(mockPlayer) } };
  }
  if (clean === '/api/strategy') {
    mockStrategyVote = String(body.planId ?? 'prepare_raid');
    mockStrategyVotes = { ...mockStrategyVotes, [mockStrategyVote]: (mockStrategyVotes[mockStrategyVote] ?? 0) + 1 };
    const award = earnCoin();
    return { status: 200, body: { type: 'strategy', strategyVotes: mockStrategyVotes, yourStrategyVote: mockStrategyVote, coinsGained: award.gained, treasuryPaid: award.treasuryPaid, economy: economyOf(mockPlayer) } };
  }
  if (clean === '/api/pledge') {
    mockMarked = { ...mockMarked, pledged: (mockMarked.pledged ?? 0) + 3 };
    mockPledge = { ...mockPledge, usedToday: true, ledger: { ...mockPledge.ledger, mine: (mockPledge.ledger?.mine ?? 0) + 1 } };
    const award = earnCoin();
    return { status: 200, body: { type: 'pledge', marked: mockMarked, pledge: mockPledge, player: mockPlayer, coinsGained: award.gained, treasuryPaid: award.treasuryPaid, economy: economyOf(mockPlayer) } };
  }
  if (clean === '/api/rekindle') {
    mockPlayer = { ...mockPlayer, streak: 12, lapsedStreak: 0 };
    return { status: 200, body: { type: 'rekindle', player: mockPlayer, cost: 24 } };
  }

  if (clean === '/api/shop/purchase') {
    const price = SHOP_PRICES[body.itemId];
    if (price === undefined) return { status: 400, body: { status: 'error', message: 'Unknown item' } };
    const owned = mockPlayer.ownedCosmetics ?? [];
    if (owned.includes(body.itemId)) return { status: 409, body: { status: 'error', message: 'Already owned.' } };
    if ((mockPlayer.coins ?? 0) < price) return { status: 400, body: { status: 'error', message: 'Not enough Coins.' } };
    mockPlayer = { ...mockPlayer, coins: mockPlayer.coins - price, ownedCosmetics: [...owned, body.itemId] };
    return { status: 200, body: { type: 'shop-purchase', itemId: body.itemId, economy: economyOf(mockPlayer), message: `purchased. ${mockPlayer.coins} Coins remain.` } };
  }
  if (clean === '/api/shop/equip') {
    const slot = SHOP_SLOTS[body.itemId];
    if (!slot) return { status: 400, body: { status: 'error', message: 'Unknown item' } };
    if (!(mockPlayer.ownedCosmetics ?? []).includes(body.itemId)) return { status: 400, body: { status: 'error', message: 'You do not own that yet.' } };
    mockPlayer = { ...mockPlayer, equippedCosmetics: { ...(mockPlayer.equippedCosmetics ?? {}), [slot]: body.itemId } };
    return { status: 200, body: { type: 'shop-equip', itemId: body.itemId, economy: economyOf(mockPlayer), message: 'equipped.' } };
  }
  if (clean === '/api/shop/donate') {
    const state = landOf();
    const project = state.projects.find((p) => p.id === body.projectId);
    if (!project || !Number.isSafeInteger(body.amount) || body.amount <= 0) return { status: 400, body: { status: 'error', message: 'Choose a valid Coin amount.' } };
    if (!project.available) return { status: 409, body: { status: 'error', message: project.unlocked ? 'Already unlocked.' : 'Expand the connected district before this one first.' } };
    const donated = Math.min(body.amount, project.remaining);
    if ((mockPlayer.coins ?? 0) < donated) return { status: 400, body: { status: 'error', message: `You need ${donated} Coins for that pledge.` } };
    mockPlayer = { ...mockPlayer, coins: mockPlayer.coins - donated };
    mockLandFunding = { ...mockLandFunding, [project.id]: (mockLandFunding[project.id] ?? 0) + donated };
    const next = landOf();
    const unlocked = next.unlocked.includes(project.id);
    return { status: 200, body: { type: 'land-donation', projectId: project.id, donated, unlocked, economy: economyOf(mockPlayer), land: next, message: unlocked ? `${project.name} unlocked. The city frontier expands.` : `${donated} Coins pledged to ${project.name}. ${project.remaining - donated} remain.` } };
  }
  if (clean === '/api/shop/invest') {
    const state = landOf();
    const project = state.projects.find((p) => p.id === body.projectId);
    if (!project || !Number.isSafeInteger(body.amount) || body.amount <= 0) return { status: 400, body: { status: 'error', message: 'Choose a valid treasury amount.' } };
    if (!project.available) return { status: 409, body: { status: 'error', message: project.unlocked ? 'Already unlocked.' : 'Expand the connected district before this one first.' } };
    const invested = Math.min(body.amount, project.remaining);
    if (mockTreasury.balance < invested) return { status: 400, body: { status: 'error', message: `The treasury holds only ${mockTreasury.balance} Coins.` } };
    mockTreasury = { ...mockTreasury, balance: mockTreasury.balance - invested, invested: mockTreasury.invested + invested };
    mockLandFunding = { ...mockLandFunding, [project.id]: (mockLandFunding[project.id] ?? 0) + invested };
    const next = landOf();
    const unlocked = next.unlocked.includes(project.id);
    return { status: 200, body: { type: 'treasury-investment', projectId: project.id, invested, unlocked, treasury: treasuryOf(mockPlayer), land: next, message: unlocked ? `${project.name} unlocked with the village treasury.` : `${invested} treasury Coins invested in ${project.name}.` } };
  }

  if (clean === '/api/role') { mockPlayer = { ...mockPlayer, role: body.role ?? 'guard', roleChangedDay: 6 }; return { status: 200, body: { type: 'role', player: mockPlayer } }; }
  if (clean === '/api/avatar') { mockPlayer = { ...mockPlayer, avatar: body.avatar ?? null }; return { status: 200, body: { type: 'avatar', player: mockPlayer } }; }

  // Unhandled /api/* — mirror the real dev harness's 404 so callers degrade gracefully.
  return { status: 404, body: { status: 'error', message: `demo: no mock for ${method} ${clean}` } };
}

/**
 * Patch window.fetch so every same-origin /api/* request is answered from the
 * in-memory demo backend. All other requests (fonts, GLBs, assets) pass through.
 */
export function installFrontendMock(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string;
    let method = (init?.method ?? 'GET').toUpperCase();
    const rawBody = init?.body;
    if (typeof input === 'string') url = input;
    else if (input instanceof URL) url = input.href;
    else { url = input.url; method = (input.method || method).toUpperCase(); }

    const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
    if (!path.startsWith('/api/')) return original(input, init);

    let body: Json = {};
    if (typeof rawBody === 'string') { try { body = JSON.parse(rawBody); } catch { body = {}; } }

    // A touch of latency so optimistic-UI transitions read naturally.
    await new Promise((r) => setTimeout(r, 90));
    const { status, body: respBody } = handle(path, method, body);
    return new Response(JSON.stringify(respBody), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
}
