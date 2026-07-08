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
};
const PLAYER = {
  userId: 't2_mock', username: 'you', role: 'guard', roleChangedDay: 1, faction: null, factionRep: 0,
  roleRep: {}, title: 'Wall-Warden', avatar: null, energyUsedToday: 1, lastActiveDay: 6,
  injuredUntilDay: 0, totalContribution: 14, streak: 3,
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
  type: 'init', postId: 't3_mock', city: CITY, player: PLAYER, effectiveEnergy: 3, crisis: CRISIS,
  crisisVotes: { a: 12, b: 7, c: 5 }, yourCrisisVote: null,
  strategyVotes: { prepare_raid: 9, stockpile_food: 6, repair_power: 4 }, yourStrategyVote: null,
  yourActionsToday: { grow_food: 1 }, missionUsedToday: false, resolving: false,
  timelinePreview: { day: 5, cycle: 1, headline: 'The wall held', events: ['Raiders probed the north wall — the watch held.', 'Food ran short; rationing began.'], deltas: { food: -12, threat: -20 }, crisisId: 'ration_riots', winningOptionId: 'b' },
  activeLaw: null, raidInDays: 6, factionInfluence: { builders: 2, wardens: 5, seekers: 1, hearth: 3 },
  yourFaction: null, yourFactionRep: 0,
  dawnReport: { day: 5, citySummary: ['Raiders probed the north wall — the watch held.', 'Food ran short; rationing began.'], yourImpact: ['You took 2 city action(s) for the city.', 'You voted on the crisis.'], title: 'Wall-Warden' },
  firstVisitToday: true,
  forecast: { food: 198, power: 75, medicine: 32, morale: 49, threat: 70, raidLikely: false },
  trait: { id: 'standard', label: 'Standard', blurb: 'A city like any other.' },
  marked: MARKED, pledge: PLEDGE,
  drama: [{ icon: '⚔️', text: 'Raiders probed the North Wall at dusk. The watch held.', kind: 'raid' }, { icon: '🕯️', text: 'ashen_fox stood vigil for Mira.', kind: 'marked' }],
  standing: { survivalDays: 5, rankLabel: 'holding the line · day 6', contributionRank: 7 },
};
const WORLD = {
  type: 'world', totalCities: 6, yourRank: 2, eligible: true, subscribers: 1200, minSubscribers: 500,
  cities: [
    { subreddit: 'r/ironhollow', cycle: 3, day: 22, survivalDays: 22, status: 'thriving', threat: 30, population: 240, savedCount: 5, activePlayers: 18, isYou: false },
    { subreddit: 'r/meadowbrook', cycle: 1, day: 6, survivalDays: 6, status: 'holding', threat: 64, population: 143, savedCount: 1, activePlayers: 7, isYou: true },
    { subreddit: 'r/saltmere', cycle: 2, day: 14, survivalDays: 14, status: 'holding', threat: 55, population: 180, savedCount: 3, activePlayers: 9, isYou: false },
    { subreddit: 'r/thornwick', cycle: 1, day: 9, survivalDays: 9, status: 'strained', threat: 78, population: 96, savedCount: 0, activePlayers: 4, isYou: false },
    { subreddit: 'r/ashfall', cycle: 1, day: 3, survivalDays: 3, status: 'under_raid', threat: 92, population: 60, savedCount: 0, activePlayers: 5, isYou: false },
    { subreddit: 'r/deepwater', cycle: 2, day: 0, survivalDays: 11, status: 'fallen', threat: 100, population: 8, savedCount: 2, activePlayers: 0, isYou: false },
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
const mockApi = () => ({
  name: 'mock-devvit-api',
  configureServer(server) {
    const send = (res, obj) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    // Root middleware matching only exact /api/<name> paths (a `.use('/api')`
    // mount would also swallow the client's own /api.ts module → app never loads).
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '').split('?')[0];
      if (path === '/api/init') return send(res, INIT);
      if (path === '/api/world') return send(res, WORLD);
      if (path === '/api/leaderboard') return send(res, LEADERBOARD);
      if (path === '/api/action') return send(res, { type: 'action', player: { ...PLAYER, energyUsedToday: 2 }, effectiveEnergy: 3, yourActionsToday: { grow_food: 1, guard_wall: 1 }, unlockedTitle: null });
      if (path === '/api/vote') return send(res, { type: 'vote', crisisVotes: { a: 13, b: 7, c: 5 }, yourCrisisVote: 'a' });
      if (path === '/api/pledge') return send(res, { type: 'pledge', marked: { ...MARKED, pledged: 26 }, pledge: { ...PLEDGE, usedToday: true }, player: PLAYER });
      if (path === '/api/strategy') return send(res, { type: 'strategy', strategyVotes: { prepare_raid: 10, stockpile_food: 6, repair_power: 4 }, yourStrategyVote: 'prepare_raid' });
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
