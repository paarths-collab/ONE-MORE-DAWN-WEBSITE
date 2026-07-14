import { defineConfig } from 'vite';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Standalone dev harness for the 3D town client (the real Devvit client build
// goes through vite.config.ts). Serves src/client on port 4630 without the
// Devvit wrapper so the town can be iterated on / QA'd in a plain browser.
// Run: node node_modules/vite/bin/vite.js --config vite.dev3d.config.mjs
//
// The /shot middleware is a QA hook: the page POSTs its WebGL canvas as a
// data-URL and we save it as village-shot.png (repo root, gitignored) so
// headless review can see real frames.

const HERE = dirname(fileURLToPath(import.meta.url));

const shotEndpoint = () => ({
  name: 'village-shot-endpoint',
  configureServer(server) {
    server.middlewares.use('/shot', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end('POST only');
        return;
      }
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', async () => {
        const b64 = String(body).replace(/^data:image\/png;base64,/, '');
        await writeFile(join(HERE, 'village-shot.png'), Buffer.from(b64, 'base64'));
        res.end('ok');
      });
    });
  },
});

// GET / → /game.html so the dev server root shows the game (the Devvit build
// treats game.html as a named entrypoint, not index.html).
const rootToGame = () => ({
  name: 'root-to-game-html',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/' || req.url === '/index.html') req.url = '/game.html';
      next();
    });
  },
});

// OPTIONAL mock backend (MOCK_API=1): answers /api/* with faithful fixtures so
// the client's LIVE mode can be exercised without a Devvit runtime. Off by
// default — the plain harness 404s /api/* and the client falls to demo mode.
const CITY = {
  day: 6, cycle: 1, status: 'alive', worldSeed: 12345, trait: 'standard',
  population: 143, food: 210, power: 78, medicine: 34, morale: 52, threat: 64, defense: 41,
  crisisId: 'first_light', activeLaw: null, lawExpiresDay: 0,
  cityLevel: 1, buildProgress: 12, unlockedBuildings: ['shelter'],
};
const PLAYER = {
  userId: 't2_mock', username: 'mock_user', role: 'guard', roleChangedDay: 1, faction: null, factionRep: 0,
  roleRep: {}, title: 'Wall-Warden', avatar: null, energyUsedToday: 1, lastActiveDay: 6,
  injuredUntilDay: 0, totalContribution: 14, streak: 3, lapsedStreak: 12,
  // Coin economy fixture: the Hearth Lantern (3) is affordable, the Slate
  // Roof (8) is one good day away — lets the smoke walk earn/buy/equip.
  coins: 4, coinsEarnedToday: 1, coinsEarnedCycle: 1, coinsEarnedDay: 6,
  ownedCosmetics: [], equippedCosmetics: {},
  treasuryProgress: 6, treasuryBacklog: 0, treasuryPaid: 2,
};
// Shop catalog mirror (kept tiny; the real authority is src/shared/shop.ts).
const SHOP_PRICES = { hearth_lantern: 3, crimson_banner: 5, garden_plot: 6, slate_roof: 8, dawn_gold_trim: 12 };
const SHOP_SLOTS = { hearth_lantern: 'light', crimson_banner: 'banner', garden_plot: 'yard', slate_roof: 'roof', dawn_gold_trim: 'roof' };
const economyOfMock = (p) => ({
  coins: p.coins ?? 0,
  earnedToday: p.coinsEarnedCycle === 1 && p.coinsEarnedDay === 6 ? (p.coinsEarnedToday ?? 0) : 0,
  dailyCap: 5,
  owned: p.ownedCosmetics ?? [],
  equipped: p.equippedCosmetics ?? {},
});
// Community reconstruction mirror. Off by default so the standard build-panel
// smoke is unaffected; MOCK_RAID_AFTERMATH=1 arms a raid-damaged neighbor home
// (5 labor) sitting one short so a single build_city restores it on camera.
const RECON_NEEDED = 5;
let mockRebuildDone = process.env.MOCK_RAID_AFTERMATH ? 4 : RECON_NEEDED;
const mockDamaged = () =>
  mockRebuildDone < RECON_NEEDED ? [{ index: 6, username: 'ashen_fox', status: 'damaged' }] : [];
const reconstructionOfMock = () => {
  const active = mockRebuildDone < RECON_NEEDED;
  return {
    active,
    required: active ? RECON_NEEDED : 0,
    contributed: active ? mockRebuildDone : 0,
    destroyed: 0,
    damaged: active ? 1 : 0,
    next: active
      ? { username: 'ashen_fox', index: 6, status: 'damaged', done: mockRebuildDone, needed: RECON_NEEDED }
      : null,
  };
};

// The protective energy dome. MOCK_RAID_AFTERMATH=1 shows a worn dome (one panel
// shattered, another low) so the HUD, pips, and repair reserve all read; otherwise
// a healthy, well-charged shield.
const mockDomeSegments = () =>
  process.env.MOCK_RAID_AFTERMATH ? [80, 15, 60, 0, 95, 45] : [88, 92, 80, 100, 96, 84];
const domeOfMock = () => {
  const segments = mockDomeSegments();
  const energyPct = Math.round(segments.reduce((a, b) => a + b, 0) / segments.length);
  let nextRepairSegment = null;
  let lo = 100;
  segments.forEach((s, i) => {
    if (s < lo && s < 100) {
      lo = s;
      nextRepairSegment = i;
    }
  });
  return {
    segments,
    energyPct,
    shield: process.env.MOCK_RAID_AFTERMATH ? 8 : 3,
    repairThreshold: 12,
    nextRepairSegment,
  };
};
// The volley for the cinematic when a raid is mocked: 3 blocked, 3 pierced.
const RAID_AFTERMATH = {
  held: false,
  wallBreached: true,
  housesDestroyed: [],
  housesDamaged: 1,
  reconstructionRequired: RECON_NEEDED,
  fireballs: [
    { power: 45, segment: 0, blocked: true },
    { power: 88, segment: 1, blocked: false },
    { power: 40, segment: 2, blocked: true },
    { power: 90, segment: 3, blocked: false },
    { power: 30, segment: 4, blocked: true },
    { power: 55, segment: 5, blocked: false },
  ],
  penetrations: 3,
  soulsLost: 6,
  segmentsBefore: [100, 35, 80, 20, 95, 55],
  segmentsAfter: [80, 15, 60, 0, 95, 45],
};
let mockTreasury = { balance: 4, collected: 11, invested: 7 };
const treasuryOfMock = (p) => ({
  balance: mockTreasury.balance,
  totalCollected: mockTreasury.collected,
  totalInvested: mockTreasury.invested,
  levyEvery: 10,
  yours: {
    progress: p.treasuryProgress ?? 0,
    backlog: p.treasuryBacklog ?? 0,
    paid: p.treasuryPaid ?? 0,
  },
});
// Land districts mirror (authority: src/shared/shop.ts LAND_EXPANSIONS).
// outer_fields sits 5 short of its target so the smoke can fund the unlock.
const LAND_DEFS = [
  { id: 'outer_fields', name: 'Outer Fields', description: 'Open connected farmland, roads, and new house plots.', target: 120, requires: null },
  { id: 'river_ward', name: 'River Ward', description: 'Extend the city along the river with room for trade and homes.', target: 260, requires: 'outer_fields' },
  { id: 'high_keep', name: 'High Keep', description: 'Claim the connected hill for walls and civic landmarks.', target: 450, requires: 'river_ward' },
];
let mockLandFunding = { outer_fields: 115, river_ward: 0, high_keep: 0 };
const landOfMock = () => {
  const unlocked = [];
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
const INIT = {
  type: 'init', postId: 't3_mock', cityName: 'VAELMAR',
  challenge: { id: '0:2', icon: '🌾', text: 'Feed the stores: Grow Food ×2 today.', kind: 'action', action: 'grow_food', target: 2, level: 7, reward: 2, progress: 1, done: false },
  city: CITY, player: PLAYER, effectiveEnergy: 3, crisis: CRISIS,
  crisisVotes: { a: 12, b: 7, c: 5 }, yourCrisisVote: null,
  strategyVotes: { prepare_raid: 9, stockpile_food: 6, repair_power: 4 }, yourStrategyVote: null,
  yourActionsToday: { grow_food: 1 }, missionUsedToday: false, resolving: false,
  timelinePreview: { day: 5, cycle: 1, headline: 'The wall held', events: ['Raiders probed the north wall, the watch held.', 'Food ran short; rationing began.'], deltas: { food: -12, threat: -20 }, crisisId: 'ration_riots', winningOptionId: 'b' },
  activeLaw: null, raidInDays: 6, factionInfluence: { builders: 2, wardens: 5, seekers: 1, hearth: 3 },
  yourFaction: null, yourFactionRep: 0,
  dawnReport: { day: 5, citySummary: ['Raiders probed the north wall, the watch held.', 'Food ran short; rationing began.'], yourImpact: ['You took 2 city action(s) for the city.', 'You voted on the crisis.'], title: 'Wall-Warden' },
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
    { username: 'mock_user', score: 96 }, { username: 'quiet_marrow', score: 74 }, { username: 'palewick', score: 51 },
  ],
  scouts: [{ username: 'quiet_marrow', score: 7 }],
  factions: { builders: { rep: 12, standing: 2 }, wardens: { rep: 20, standing: 1 }, seekers: { rep: 4, standing: 4 }, hearth: { rep: 9, standing: 3 } },
};
// Fixture variants for the two live-only edge states (set alongside MOCK_API):
//   MOCK_ROLE_NULL=1 → brand-new player (role null) → onboarding overlay
//   MOCK_FALLEN=1    → city.status 'fallen'          → fallen terminal screen
//   MOCK_CAMP=1      → brand-new city progression    → Camp / no buildings
const PLAYER_V = { ...PLAYER, role: process.env.MOCK_ROLE_NULL ? null : PLAYER.role, avatar: null };
// Stateful like the vote/strategy mocks: after /rekindle, later /init polls
// must reflect the restored streak (the real server persists it under lock).
// Without this, a slow post-rekindle refresh resurrects the rekindle offer.
let mockPlayer = PLAYER_V;
const CAMP_BUILD = {
  stage: 0, stageLabel: 'Camp', unlocked: [],
  next: { id: 'shelter', name: 'Shelter', description: 'Tents become homes, fewer are lost to the cold.', progressRequired: 24, effect: '+1 morale/day' },
  progress: 0, progressRequired: 24, contributorsToday: 0, youBuiltToday: false,
};
const CITY_V = {
  ...CITY,
  status: process.env.MOCK_FALLEN ? 'fallen' : CITY.status,
  ...(process.env.MOCK_CAMP ? { cityLevel: 0, buildProgress: 0, unlockedBuildings: [] } : {}),
};
const CAMP_HOUSES = { total: 0, cap: 240, founder: null, yours: null, named: [] };
const NO_HOUSE = { ...INIT.houses, total: 23, yours: null };
let mockHasHouse = !process.env.MOCK_NO_HOUSE;
let mockCrisisVotes = INIT.crisisVotes;
let mockCrisisVote = INIT.yourCrisisVote;
let mockStrategyVotes = INIT.strategyVotes;
let mockStrategyVote = INIT.yourStrategyVote;
let mockActions = INIT.yourActionsToday;
let mockMarked = INIT.marked;
let mockPledge = INIT.pledge;
let mockMutationDone = false;
const currentHouses = () => (mockHasHouse ? INIT.houses : NO_HOUSE);
const currentInit = () => ({
  ...INIT,
  player: mockPlayer,
  city: CITY_V,
  crisisVotes: mockCrisisVotes,
  yourCrisisVote: mockCrisisVote,
  strategyVotes: mockStrategyVotes,
  yourStrategyVote: mockStrategyVote,
  yourActionsToday: mockActions,
  marked: mockMarked,
  pledge: mockPledge,
  economy: economyOfMock(mockPlayer),
  land: landOfMock(),
  reconstruction: reconstructionOfMock(),
  dome: domeOfMock(),
  treasury: treasuryOfMock(mockPlayer),
  houses: { ...currentHouses(), damaged: mockDamaged() },
  ...(process.env.MOCK_RAID_AFTERMATH ? { dawnReport: { ...INIT.dawnReport, raidAftermath: RAID_AFTERMATH } } : {}),
  ...(process.env.MOCK_CAMP ? { build: CAMP_BUILD, houses: { ...CAMP_HOUSES, damaged: [] }, yourActionsToday: {} } : {}),
});
// One accepted mock contribution: +1 Coin up to the cap, mirrored statefully.
const mockEarnCoin = () => {
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
    ...mockPlayer,
    coins,
    coinsEarnedToday: earned + gained,
    treasuryProgress: progressTotal % 10,
    treasuryBacklog: oldBacklog - backlogPaid + dueAdded - newlyDuePaid,
    treasuryPaid: (mockPlayer.treasuryPaid ?? 0) + treasuryPaid,
  };
  mockTreasury = {
    ...mockTreasury,
    balance: mockTreasury.balance + treasuryPaid,
    collected: mockTreasury.collected + treasuryPaid,
  };
  return { gained, treasuryPaid };
};
const CHATTER_THREAD_URL = 'https://www.reddit.com/r/meadowbrook/comments/chatter_week_4/one_more_dawn_city_chatter_hub/';
let mockChatterMessages = [
  { id: 't1_chatter_1', category: 'strategy', author: 'ashen_fox', text: 'Fortify the north wall before spending the medicine.', createdAt: '2026-07-14T08:30:00.000Z' },
  { id: 't1_chatter_2', category: 'raid', author: 'quiet_marrow', text: 'Keep one watch team near the outer fields.', createdAt: '2026-07-14T08:25:00.000Z' },
];
const chatterState = (category) => ({
  type: 'chatter',
  ready: true,
  weekKey: '2026-07-13',
  cityDay: 6,
  category,
  rootCommentId: `t1_${category}_day_6`,
  threadUrl: CHATTER_THREAD_URL,
  messages: mockChatterMessages
    .filter((message) => message.category === category)
    .map(({ category: _category, ...message }) => ({
      ...message,
      permalink: `${CHATTER_THREAD_URL}${message.id}/`,
    })),
  feedAvailable: true,
  maxLength: 250,
  cooldownSeconds: 15,
  attributionNotice: 'Posting is optional and creates a public Reddit comment. During unapproved playtests, Reddit may attribute non-owner comments to the app account.',
});
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const mockApi = () => ({
  name: 'mock-devvit-api',
  configureServer(server) {
    const send = (res, obj, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    // Reconnect the City daily puzzle mock: a tiny valid, solvable board (4 tiles,
    // each one tap from its solution) so the smoke's Hint-to-solve walk works.
    const MOCK_PUZZLE_LEVEL = {
      id: 1, name: 'The Dark District', chapter: 1, width: 3, height: 3, moveTarget: 6,
      cells: [
        { t: 'source', x: 0, y: 2, capacity: -1 },
        { t: 'tile', x: 0, y: 1, kind: 'straight', rot: 1, sol: 0 }, // up col 0 (scrambled)
        { t: 'tile', x: 0, y: 0, kind: 'corner', rot: 0, sol: 1 }, // turn east
        { t: 'tile', x: 1, y: 0, kind: 'straight', rot: 0, sol: 1 }, // -> clinic
        { t: 'building', x: 2, y: 0, kind: 'clinic', required: true },
        { t: 'tile', x: 1, y: 2, kind: 'straight', rot: 0, sol: 1 }, // -> optional house
        { t: 'building', x: 2, y: 2, kind: 'house', required: false },
      ],
    };
    let mockPuzzleBest = null;
    let mockPuzzleSolvedCount = 41;
    let mockPuzzleSolveMode = 'accept';
    // Root middleware matching only exact /api/<name> paths (a `.use('/api')`
    // mount would also swallow the client's own /api.ts module → app never loads).
    server.middlewares.use(async (req, res, next) => {
      const path = (req.url ?? '').split('?')[0];
      if (path === '/api/init' && process.env.MOCK_INIT_FAIL_AFTER_MUTATION && mockMutationDone) return send(res, { status: 'error', message: 'mock refresh failure' }, 503);
      if (path === '/api/init') return send(res, currentInit());
      if (path === '/api/world') return send(res, WORLD);
      if (path === '/api/leaderboard' && process.env.MOCK_LEADERBOARD_FAIL) return send(res, { status: 'error', message: 'mock leaderboard failure' }, 503);
      if (path === '/api/leaderboard') return send(res, LEADERBOARD);
      if (path === '/api/puzzle') {
        return send(res, {
          type: 'puzzle', dailyId: '2026-07-14', levelId: MOCK_PUZZLE_LEVEL.id, level: MOCK_PUZZLE_LEVEL,
          yourBest: mockPuzzleBest, solvedCount: mockPuzzleSolvedCount, bestMoves: 4,
          yourRank: mockPuzzleBest ? 12 : null,
          levels: [{ id: 1, name: MOCK_PUZZLE_LEVEL.name, chapter: 1, best: mockPuzzleBest }],
        });
      }
      if (path === '/api/mock/puzzle-solve-mode' && req.method === 'POST') {
        const body = await readBody(req);
        mockPuzzleSolveMode = ['accept', 'reject', 'fail'].includes(body.mode) ? body.mode : 'accept';
        return send(res, { mode: mockPuzzleSolveMode });
      }
      if (path === '/api/puzzle/solve') {
        if (mockPuzzleSolveMode === 'fail') return send(res, { status: 'error', message: 'mock puzzle save failure' }, 503);
        const b = await readBody(req);
        const moves = Number(b.moves) || 0;
        const stars = moves <= MOCK_PUZZLE_LEVEL.moveTarget ? 3 : 1;
        if (mockPuzzleSolveMode === 'reject') {
          return send(res, {
            type: 'puzzle_solve', accepted: false, stars: 0, best: mockPuzzleBest, improved: false,
            reward: null, solvedCount: mockPuzzleSolvedCount, bestMoves: 4, yourRank: mockPuzzleBest ? 12 : null,
          });
        }
        const first = !mockPuzzleBest;
        const score = { stars, moves, timeMs: Number(b.timeMs) || 0 };
        if (first || stars > mockPuzzleBest.stars || (stars === mockPuzzleBest.stars && moves < mockPuzzleBest.moves)) mockPuzzleBest = score;
        if (first) mockPuzzleSolvedCount += 1;
        return send(res, {
          type: 'puzzle_solve', accepted: true, stars, best: mockPuzzleBest, improved: first,
          reward: first ? '+3 standing · the district is back online' : null,
          solvedCount: mockPuzzleSolvedCount, bestMoves: 4, yourRank: 12,
        });
      }
      if (path === '/api/chatter' && req.method === 'GET') {
        const category = new URL(req.url ?? '', 'http://mock.local').searchParams.get('category') ?? 'strategy';
        return send(res, chatterState(category));
      }
      if (path === '/api/chatter' && req.method === 'POST') {
        const b = await readBody(req);
        const text = typeof b.text === 'string' ? b.text.replace(/\s+/g, ' ').trim() : '';
        if (!text || text.length > 250 || /https?:\/\/|www\./i.test(text)) {
          return send(res, { status: 'error', message: 'Write a valid City Chatter message.' }, 400);
        }
        const category = ['strategy', 'raid', 'rebuilding', 'general'].includes(b.category) ? b.category : 'strategy';
        const posted = { id: `t1_chatter_${mockChatterMessages.length + 1}`, category, author: 'mock_user', text, createdAt: new Date().toISOString() };
        mockChatterMessages = [posted, ...mockChatterMessages];
        return send(res, {
          type: 'chatter-post',
          message: { id: posted.id, author: posted.author, text: posted.text, createdAt: posted.createdAt, permalink: `${CHATTER_THREAD_URL}${posted.id}/` },
          postedAs: 'mock_user',
          threadUrl: CHATTER_THREAD_URL,
        });
      }
      if (path === '/api/action') {
        const b = await readBody(req);
        mockHasHouse = true;
        mockMutationDone = true;
        // build_city is energy-gated too; echo it in yourActionsToday so the
        // client's re-fetch path is exercised. Other actions keep the old shape.
        const acts = b.action === 'build_city' ? { grow_food: 1, build_city: 1 } : { grow_food: 1, guard_wall: 1 };
        mockActions = acts;
        mockPlayer = { ...mockPlayer, energyUsedToday: 2 };
        const award = mockEarnCoin();
        // build_city labor pays down the shared rebuild queue first (homes
        // before buildings). One point restores the pre-funded damaged home.
        let rebuilt = null;
        if (b.action === 'build_city' && mockRebuildDone < RECON_NEEDED) {
          mockRebuildDone += 1;
          if (mockRebuildDone >= RECON_NEEDED) rebuilt = { username: 'ashen_fox', index: 6 };
        }
        return send(res, { type: 'action', player: mockPlayer, effectiveEnergy: 3, yourActionsToday: acts, unlockedTitle: null, coinsGained: award.gained, treasuryPaid: award.treasuryPaid, economy: economyOfMock(mockPlayer), reconstruction: reconstructionOfMock(), rebuilt, dome: domeOfMock(), domeRepaired: null });
      }
      if (path === '/api/vote') {
        mockHasHouse = true;
        mockCrisisVotes = { a: 13, b: 7, c: 5 };
        mockCrisisVote = 'a';
        const award = mockEarnCoin();
        return send(res, { type: 'vote', crisisVotes: mockCrisisVotes, yourCrisisVote: mockCrisisVote, coinsGained: award.gained, treasuryPaid: award.treasuryPaid, economy: economyOfMock(mockPlayer) });
      }
      if (path === '/api/shop/purchase') {
        const b = await readBody(req);
        const price = SHOP_PRICES[b.itemId];
        if (price === undefined) return send(res, { status: 'error', message: 'Unknown item' }, 400);
        const owned = mockPlayer.ownedCosmetics ?? [];
        if (owned.includes(b.itemId)) return send(res, { status: 'error', message: 'Already owned.' }, 409);
        if ((mockPlayer.coins ?? 0) < price) return send(res, { status: 'error', message: 'Not enough Coins.' }, 400);
        mockPlayer = { ...mockPlayer, coins: mockPlayer.coins - price, ownedCosmetics: [...owned, b.itemId] };
        return send(res, { type: 'shop-purchase', itemId: b.itemId, economy: economyOfMock(mockPlayer), message: `purchased. ${mockPlayer.coins} Coins remain.` });
      }
      if (path === '/api/shop/donate') {
        const b = await readBody(req);
        const state = landOfMock();
        const project = state.projects.find((p) => p.id === b.projectId);
        if (!project || !Number.isSafeInteger(b.amount) || b.amount <= 0) return send(res, { status: 'error', message: 'Choose a valid Coin amount.' }, 400);
        if (!project.available) return send(res, { status: 'error', message: project.unlocked ? 'Already unlocked.' : 'Expand the connected district before this one first.' }, 409);
        const donated = Math.min(b.amount, project.remaining);
        if ((mockPlayer.coins ?? 0) < donated) return send(res, { status: 'error', message: `You need ${donated} Coins for that pledge.` }, 400);
        mockPlayer = { ...mockPlayer, coins: mockPlayer.coins - donated };
        mockLandFunding = { ...mockLandFunding, [project.id]: (mockLandFunding[project.id] ?? 0) + donated };
        const next = landOfMock();
        const unlocked = next.unlocked.includes(project.id);
        return send(res, {
          type: 'land-donation', projectId: project.id, donated, unlocked,
          economy: economyOfMock(mockPlayer), land: next,
          message: unlocked ? `${project.name} unlocked. The city frontier expands.` : `${donated} Coins pledged to ${project.name}. ${project.remaining - donated} remain.`,
        });
      }
      if (path === '/api/shop/invest') {
        const b = await readBody(req);
        const state = landOfMock();
        const project = state.projects.find((p) => p.id === b.projectId);
        if (!project || !Number.isSafeInteger(b.amount) || b.amount <= 0) return send(res, { status: 'error', message: 'Choose a valid treasury amount.' }, 400);
        if (!project.available) return send(res, { status: 'error', message: project.unlocked ? 'Already unlocked.' : 'Expand the connected district before this one first.' }, 409);
        const invested = Math.min(b.amount, project.remaining);
        if (mockTreasury.balance < invested) return send(res, { status: 'error', message: `The treasury holds only ${mockTreasury.balance} Coins.` }, 400);
        mockTreasury = { ...mockTreasury, balance: mockTreasury.balance - invested, invested: mockTreasury.invested + invested };
        mockLandFunding = { ...mockLandFunding, [project.id]: (mockLandFunding[project.id] ?? 0) + invested };
        const next = landOfMock();
        const unlocked = next.unlocked.includes(project.id);
        return send(res, {
          type: 'treasury-investment', projectId: project.id, invested, unlocked,
          treasury: treasuryOfMock(mockPlayer), land: next,
          message: unlocked ? `${project.name} unlocked with the village treasury.` : `${invested} treasury Coins invested in ${project.name}.`,
        });
      }
      if (path === '/api/shop/equip') {
        const b = await readBody(req);
        const slot = SHOP_SLOTS[b.itemId];
        if (!slot) return send(res, { status: 'error', message: 'Unknown item' }, 400);
        if (!(mockPlayer.ownedCosmetics ?? []).includes(b.itemId)) return send(res, { status: 'error', message: 'You do not own that yet.' }, 400);
        mockPlayer = { ...mockPlayer, equippedCosmetics: { ...(mockPlayer.equippedCosmetics ?? {}), [slot]: b.itemId } };
        return send(res, { type: 'shop-equip', itemId: b.itemId, economy: economyOfMock(mockPlayer), message: 'equipped.' });
      }
      if (path === '/api/rekindle') {
        mockPlayer = { ...mockPlayer, streak: 12, lapsedStreak: 0 };
        return send(res, { type: 'rekindle', player: mockPlayer, cost: 24 });
      }
      if (path === '/api/pledge') {
        mockHasHouse = true;
        mockMarked = { ...MARKED, pledged: 26 };
        mockPledge = { ...PLEDGE, usedToday: true };
        const award = mockEarnCoin();
        return send(res, { type: 'pledge', marked: mockMarked, pledge: mockPledge, player: mockPlayer, coinsGained: award.gained, treasuryPaid: award.treasuryPaid, economy: economyOfMock(mockPlayer) });
      }
      if (path === '/api/strategy') {
        mockHasHouse = true;
        mockStrategyVotes = { prepare_raid: 10, stockpile_food: 6, repair_power: 4 };
        mockStrategyVote = 'prepare_raid';
        const award = mockEarnCoin();
        return send(res, { type: 'strategy', strategyVotes: mockStrategyVotes, yourStrategyVote: mockStrategyVote, coinsGained: award.gained, treasuryPaid: award.treasuryPaid, economy: economyOfMock(mockPlayer) });
      }
      if (path === '/api/role') { const b = await readBody(req); mockPlayer = { ...mockPlayer, role: b.role ?? 'guard', roleChangedDay: 6 }; return send(res, { type: 'role', player: mockPlayer }); }
      if (path === '/api/avatar' && process.env.MOCK_AVATAR_FAIL) return send(res, { status: 'error', message: 'mock avatar failure' }, 503);
      if (path === '/api/avatar') { const b = await readBody(req); mockPlayer = { ...mockPlayer, avatar: b.avatar ?? null }; return send(res, { type: 'avatar', player: mockPlayer }); }
      return next();
    });
  },
});

export default defineConfig({
  root: join(HERE, 'src/client'),
  publicDir: join(HERE, 'public'), // GLBs live in <repo>/public/assets (shared with the Devvit build)
  plugins: [shotEndpoint(), rootToGame(), ...(process.env.MOCK_API ? [mockApi()] : [])],
  esbuild: { jsx: 'automatic' }, // TSX via esbuild — no react plugin needed for dev
  server: { port: 4630, strictPort: true },
});
