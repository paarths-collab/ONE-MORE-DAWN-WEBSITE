import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  createVillageScene,
  MAX_VILLAGERS,
  type BuildingMeta,
  type CompanionKind,
  type PoiInfo,
  type TimeOfDay,
  type VillageHandle,
  type VillageHooks,
} from './scene';
import { ApiFailure, getInit, getLeaderboard, getWorld, postAction, postAvatar, postPledge, postRole, postStrategy, postVote } from './api';
import { isLocalHarnessHost, raidNoteFromEvents, worldUnavailableMessage } from './liveUi';
import { isMuted, playSound, preloadSounds, toggleMuted } from './sound';
import type {
  ActionType,
  BuildingDef,
  BuildStatus,
  Crisis,
  DawnReport,
  InitResponse,
  LeaderboardEntry,
  Marked,
  PledgeInfo,
  PledgeKind,
  ResourceDelta,
  Role,
  Standing,
  StrategyPlanId,
  VoteTally,
  WorldCity,
} from '../shared/types';

// ONE MORE DAWN — 3D town, React edition v4: the self-running mini-game.
// The scene runs itself (time cycles, companions on, players walk the streets).
// Right panel: MAP (town minimap + world map of rival cities), CITY dashboard
// (live vitals + district directory), LIVE (Marked, comments, crisis, council,
// raid watch, events) and TOP (contribution leaderboard). The city plays
// itself: vitals drift, survivors trickle in, days count up, raids arrive and
// resolve against your defense, and you can talk, build huts, upgrade districts.

const TIMES: { id: TimeOfDay; icon: string; label: string; tagline: string }[] = [
  { id: 'night', icon: '🌙', label: 'NIGHT', tagline: 'the city sleeps — dawn is coming' },
  { id: 'dawn', icon: '🌅', label: 'DAWN', tagline: 'dawn is coming — hold the line' },
  { id: 'day', icon: '☀️', label: 'DAY', tagline: 'the city works while the light lasts' },
  { id: 'dusk', icon: '🌇', label: 'DUSK', tagline: 'last light — count your stores' },
];
const TIME_ORDER: TimeOfDay[] = ['night', 'dawn', 'day', 'dusk'];

const COMPANIONS: { id: CompanionKind; icon: string; label: string }[] = [
  { id: 'horse', icon: '🐴', label: 'HORSE' },
  { id: 'flamingo', icon: '🦩', label: 'FLAMINGO' },
  { id: 'parrot', icon: '🦜', label: 'PARROT' },
  { id: 'stork', icon: '🕊️', label: 'STORK' },
];

// ---------- MAP tab data ----------
// Shape of the scene's getMapData() (added by the scene agent; may be absent).
type MapData = {
  radius: number;
  outline: [number, number][];
  districts: { name: string; icon: string; x: number; z: number }[];
  houses: [number, number][];
};
// Shape of getView() — the live camera + look-at target.
type MapView = { cx: number; cz: number; tx: number; tz: number; fov: number };

// WORLD map — fabricated network of rival subreddit-cities (not wired to Reddit).
type WorldStatus = 'thriving' | 'holding' | 'strained' | 'under_raid' | 'fallen';
const WORLD_CITIES: { id: string; name: string; status: WorldStatus; x: number; y: number }[] = [
  { id: 'you', name: 'YOUR CITY', status: 'holding', x: 52, y: 54 },
  { id: 'ironhollow', name: 'r/ironhollow', status: 'thriving', x: 28, y: 32 },
  { id: 'ashfall', name: 'r/ashfall', status: 'under_raid', x: 78, y: 32 },
  { id: 'deepwater', name: 'r/deepwater', status: 'fallen', x: 72, y: 78 },
  { id: 'saltmere', name: 'r/saltmere', status: 'holding', x: 30, y: 72 },
  { id: 'thornwick', name: 'r/thornwick', status: 'strained', x: 62, y: 17 },
];
const WORLD_STATUS: Record<WorldStatus, { icon: string; label: string; color: string; flavor: string }> = {
  thriving: { icon: '🌿', label: 'Thriving', color: '#7fd6a2', flavor: 'Holding the line — and then some.' },
  holding: { icon: '🕯️', label: 'Holding', color: '#ffcf70', flavor: 'Holding the line.' },
  strained: { icon: '🩸', label: 'Strained', color: '#ff8a3d', flavor: 'Rationing candles. Still standing.' },
  under_raid: { icon: '🚨', label: 'Under raid', color: '#ff5b4d', flavor: 'The wall decides tonight.' },
  fallen: { icon: '💀', label: 'Fallen', color: '#6b7089', flavor: 'The lights went out.' },
};

// ---- WORLD map terrain (all static, hand-drawn coordinates; nothing moves) ----
// one big continent with bays and peninsulas — every city sits on this landmass
const WM_LAND =
  'M 30 8 Q 44 4.5 55 10 Q 68 7 78 14 Q 90 18 88 30 Q 84 38 91 46 Q 94 56 86 62 ' +
  'Q 81 66 85 74 Q 88 84 76 89 Q 66 93 56 87 Q 48 91 40 86 Q 28 89 22 78 ' +
  'Q 15 72 19 62 Q 25 56 18 50 Q 12 44 17 34 Q 13 24 22 17 Q 25 11 30 8 Z';
const WM_ISLES = [
  'M 6 22 Q 10 18.5 13 22 Q 14.5 26 10 27.5 Q 5.5 26.5 6 22 Z',
  'M 90 84 Q 94 81 97 85 Q 96.5 89.5 92 89.5 Q 88.5 87 90 84 Z',
];
// mountain range — an arc of peaks between r/ironhollow and r/thornwick
const WM_MTNS: { x: number; y: number; s: number }[] = [
  { x: 35, y: 26, s: 0.9 },
  { x: 39, y: 23.5, s: 1.1 },
  { x: 43, y: 21.5, s: 1.3 },
  { x: 47.5, y: 20.5, s: 1.15 },
  { x: 52, y: 21, s: 1.0 },
  { x: 56, y: 23, s: 0.85 },
];
// mountain glyph: triangle body + a small snow-cap stroke near the peak
const mtnPath = (x: number, y: number, s: number): string =>
  `M ${x - 1.7 * s} ${y} L ${x} ${y - 3.1 * s} L ${x + 1.7 * s} ${y} Z ` +
  `M ${x - 0.55 * s} ${y - 2 * s} L ${x} ${y - 3.1 * s} L ${x + 0.55 * s} ${y - 2 * s}`;
// forest groves — three clusters of canopy circles
const WM_TREES: [number, number][] = [
  [36, 62], [38.6, 64.2], [34.2, 65], // southwest grove
  [65, 51], [67.6, 53.2], [63.4, 54.4], // eastern grove
  [55, 82], [57.8, 80.4], // southern grove
];
// river — from the high peaks down to the western bay
const WM_RIVER = 'M 46 22 Q 42 30 36 34 Q 28 40 23 44 Q 19 46.5 17 49';
// curved trade routes: YOUR CITY → each rival (quadratic arcs, hand-tuned)
const WM_ROUTES: Record<string, string> = {
  ironhollow: 'M 52 54 Q 36 45 28 32',
  ashfall: 'M 52 54 Q 68 46 78 32',
  deepwater: 'M 52 54 Q 64 65 72 78',
  saltmere: 'M 52 54 Q 40 61 30 72',
  thornwick: 'M 52 54 Q 60 36 62 17',
};
// city wall for YOUR CITY — an octagon around the hut cluster
const octPath = (cx: number, cy: number, r: number): string =>
  Array.from({ length: 8 }, (_, i) => {
    const a = (Math.PI / 4) * i - Math.PI / 8;
    return `${i === 0 ? 'M' : 'L'} ${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  }).join(' ') + ' Z';
// hut cluster offsets (relative to the city anchor)
const WM_HUTS_SMALL: [number, number][] = [
  [-1.7, 0.4],
  [0.4, -0.9],
  [1.5, 1.0],
];
const WM_HUTS_BIG: [number, number][] = [
  [-2.4, 0.6],
  [-0.2, -1.5],
  [2.2, -0.3],
  [-1.0, 2.0],
  [1.7, 1.8],
];

// ---------- LIVE tab demo data (copied from the local mock fixtures; live mode
// uses the Devvit API, while demo mode lets the town drift on timers).

type CrisisOptId = 'a' | 'b' | 'c';
type PlanId = 'prepare_raid' | 'stockpile_food' | 'repair_power';
type LiveEvent = { icon: string; text: string; key: number };
type TalkMsg = { who: string; text: string; you?: boolean; key: number };
type RaidPhase = 'idle' | 'incoming' | 'held' | 'breach';
// one resolved raid, newest first — the losses recorded are the ones applied
type RaidLogEntry = { day: number; outcome: 'held' | 'breach'; souls: number; food: number; defense: number; key: number };
type NotifTone = 'good' | 'bad' | undefined;
type Notif = { icon: string; text: string; tone: NotifTone; key: number };

const MARKED_GOAL = 40;

// ---------- LIVE mode (real backend via src/client/api.ts) ----------
// 'connecting' while the first /api/init is in flight; 'live' when the real
// game answers; 'demo' is only for the standalone dev harness. Production API
// failures must stop on an explicit offline/login state, not a fake city.
type Mode = 'connecting' | 'live' | 'demo' | 'offline';

// Server vitals caps (src/shared/balance.ts: food store 300, medicine 120,
// power/morale/threat/defense 0..100). Demo keeps the old local maxes.
const LIVE_VITAL_MAX: Record<VitKey, number> = { FOOD: 300, POWER: 100, MEDICINE: 120, MORALE: 100, THREAT: 100, DEFENSE: 100 };

// ResourceDelta key → HUD emoji, for rendering crisis option effects.
const DELTA_ICONS: Record<string, string> = {
  population: '👥',
  food: '🍞',
  power: '⚡',
  medicine: '🩹',
  morale: '🙂',
  threat: '☠️',
  defense: '🛡️',
};
const fmtDelta = (fx: ResourceDelta): string =>
  Object.entries(fx)
    .filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] !== 0)
    .map(([k, n]) => `${n > 0 ? '+' : '−'}${Math.abs(n)} ${DELTA_ICONS[k] ?? k}`)
    .join(' · ');

// Council plan labels for every server StrategyPlanId (fallback = raw id).
const PLAN_LABELS: Record<string, string> = {
  prepare_raid: '🛡️ Prepare for Raid',
  stockpile_food: '🍞 Stockpile Food',
  repair_power: '⚡ Repair Power',
  send_scouts: '🧭 Send Scouts',
  treat_sick: '⛑️ Treat the Sick',
};
const STRATEGY_IDS: StrategyPlanId[] = ['stockpile_food', 'repair_power', 'prepare_raid', 'send_scouts', 'treat_sick'];
const PLEDGE_KINDS: PledgeKind[] = ['stand_vigil', 'share_rations', 'run_messages', 'back_council'];
const ACTION_IDS: ActionType[] = ['grow_food', 'repair_power', 'treat_sick', 'guard_wall'];
const MARKED_ICONS: Record<Marked['kind'], string> = { person: '🧒', place: '🏚️', symbol: '🕯️' };

// First-run onboarding role catalog — icon/label/blurb, exact copy per spec.
const ROLE_CATALOG: { id: Role; icon: string; label: string; blurb: string }[] = [
  { id: 'scout', icon: '🧭', label: 'SCOUT', blurb: 'Tracks danger and helps the city read the map.' },
  { id: 'engineer', icon: '🔧', label: 'ENGINEER', blurb: '+50% when you Repair Power.' },
  { id: 'medic', icon: '⛑️', label: 'MEDIC', blurb: '+50% when you Treat the Sick.' },
  { id: 'farmer', icon: '🌾', label: 'FARMER', blurb: '+50% when you Grow Food.' },
  { id: 'guard', icon: '🛡️', label: 'GUARD', blurb: '+50% when you Guard the Wall.' },
  { id: 'speaker', icon: '📣', label: 'SPEAKER', blurb: 'Every action you take also lifts morale.' },
];

// Everything the LIVE tab needs when the real backend is talking. null = demo.
type LiveData = {
  markedIcon: string;
  markedName: string;
  markedBlurb: string;
  markedGoal: number;
  markedUnit: string;
  pledgeOptions: { id: PledgeKind; icon: string; label: string }[];
  onPledgeKind: (kind: PledgeKind) => void;
  crisisTitle: string;
  crisisNarrative: string;
  crisisOptions: { id: string; label: string; fx: string }[];
  crisisVotes: VoteTally;
  myVote: string | null;
  onVote: (id: string) => void;
  plans: { id: string; nm: string; votes: number }[];
  myPlan: string | null;
  onPlan: (id: string) => void;
  raidLikely: boolean;
  raidNote: string | null;
  hasDawnReport: boolean;
  onOpenDawn: () => void;
};

const PLEDGES: { id: string; icon: string; label: string }[] = [
  { id: 'stand_vigil', icon: '🕯️', label: 'Stand Vigil' },
  { id: 'share_rations', icon: '🍞', label: 'Share Rations' },
  { id: 'run_messages', icon: '🕊️', label: 'Run Messages' },
  { id: 'back_council', icon: '🏛️', label: 'Back the Council' },
];

const CRISIS_IDS: CrisisOptId[] = ['a', 'b', 'c'];
const CRISIS_OPTS: { id: CrisisOptId; nm: string; fx: string }[] = [
  { id: 'a', nm: 'Let them in', fx: '+30 👥 · −20 🍞 · +4 🙂' },
  { id: 'b', nm: 'Turn them away', fx: '−10 🙂 · +3 🛡️' },
  { id: 'c', nm: 'Inspect first', fx: '+15 👥 · −8 🍞 · +3 ☠️' },
];

const PLAN_IDS: PlanId[] = ['prepare_raid', 'stockpile_food', 'repair_power'];
const PLANS: { id: PlanId; nm: string }[] = [
  { id: 'prepare_raid', nm: '🛡️ Prepare for Raid' },
  { id: 'stockpile_food', nm: '🍞 Stockpile Food' },
  { id: 'repair_power', nm: '⚡ Repair Power' },
];

const DRAMA: { icon: string; text: string }[] = [
  { icon: '🕯️', text: 'ashen_fox stood vigil for Mira — the medics take heart.' },
  { icon: '⚔️', text: 'Raiders probed the North Wall at dusk. The watch held.' },
  { icon: '🎒', text: 'quiet_marrow crawled back from the deep ruins with 7 food.' },
  { icon: '🗳️', text: '25 citizens have voted on the Convoy at the Gate.' },
  { icon: '📜', text: 'The Council leans toward Prepare for Raid — 9 backers.' },
  { icon: '🩹', text: 'saltcedar treated the sick through the night shift.' },
  { icon: '🏚️', text: 'A rival city went dark last night. Theirs, not ours.' },
  { icon: '🌅', text: 'Dawn broke over the city — day 5, still standing.' },
];

// Scripted replies to SAY HI — rotates each use.
const HI_REPLIES: { who: string; text: string }[] = [
  { who: 'u/ashen_fox', text: 'hii 👋 welcome to the wall' },
  { who: 'u/quiet_marrow', text: 'gm 🌅' },
  { who: 'u/saltcedar', text: 'stay warm out there' },
];

// City vitals — same keys/start values as before, but live state now: ambient
// drift, raids, builds and upgrades all move these numbers.
type VitKey = 'FOOD' | 'POWER' | 'MEDICINE' | 'MORALE' | 'THREAT' | 'DEFENSE';
type Vitals = Record<VitKey, number>;
const VITAL_DEFS: { k: VitKey; icon: string; max: number; danger?: boolean }[] = [
  { k: 'FOOD', icon: '🍞', max: 500 },
  { k: 'POWER', icon: '⚡', max: 100 },
  { k: 'MEDICINE', icon: '🩹', max: 120 },
  { k: 'MORALE', icon: '🙂', max: 100 },
  { k: 'THREAT', icon: '☠️', max: 100, danger: true },
  { k: 'DEFENSE', icon: '🛡️', max: 100 },
];
const START_VITALS: Vitals = { FOOD: 342, POWER: 78, MEDICINE: 12, MORALE: 44, THREAT: 68, DEFENSE: 35 };
const VITAL_MAX: Record<VitKey, number> = { FOOD: 500, POWER: 100, MEDICINE: 120, MORALE: 100, THREAT: 100, DEFENSE: 100 };
const clampVit = (k: VitKey, n: number): number => Math.max(0, Math.min(VITAL_MAX[k], n));

const UPGRADE_COST = 10; // food per district upgrade

// DAWN ACTIONS — the real game's once-per-day free actions, HUD edition.
// Ids match the server's ActionType exactly (live mode posts them verbatim).
const ACTIONS: { id: ActionType; icon: string; label: string; fx: string }[] = [
  { id: 'grow_food', icon: '🌾', label: 'GROW FOOD', fx: '+3 🍞' },
  { id: 'repair_power', icon: '🔧', label: 'REPAIR', fx: '+4 ⚡' },
  { id: 'treat_sick', icon: '⛑️', label: 'TREAT', fx: '+2 🩹' },
  { id: 'guard_wall', icon: '🛡️', label: 'GUARD', fx: '−5 ☠️ +2 🛡️' },
];
// districts (by name fragment, uppercase) worth flashing when an action lands
const ACTION_FLASH: Record<string, string[]> = {
  grow_food: ['FIELD', 'FARM', 'GREEN'],
  repair_power: ['POWER', 'MILL'],
  treat_sick: ['CLINIC', 'MED'],
  guard_wall: ['GATE', 'WALL', 'BARRACK'],
};

// SCAVENGE routes — the real game's risk ladder, condensed.
type RouteId = 'safe' | 'deep' | 'desperate';
const ROUTES: { id: RouteId; icon: string; title: string; blurb: string; dur: number; food: number }[] = [
  { id: 'safe', icon: '🌤️', title: 'Safe Route', blurb: '4 crates · few hazards', dur: 12000, food: 12 },
  { id: 'deep', icon: '🌆', title: 'Deep Ruins', blurb: '7 crates · real risk', dur: 18000, food: 21 },
  { id: 'desperate', icon: '☠️', title: 'Desperate Dive', blurb: '9 crates · deadly, richer loot', dur: 25000, food: 27 },
];

// SUBREDDIT CONTRIBUTIONS — community members buy houses in the 3D town and
// gift resources; everything lands on the TOP 🏆 leaderboard tab.
const SUB_USERS = ['u/ashen_fox', 'u/quiet_marrow', 'u/saltcedar', 'u/brackenwren', 'u/palewick', 'u/mx_ember', 'u/dawn_keeper', 'u/gate_runner', 'u/tinder_witch', 'u/rustle_creek', 'u/norwind', 'u/old_lantern'];

type Contrib = { houses: number; food: number; power: number; medicine: number; score: number };
type ContribPatch = Partial<Omit<Contrib, 'score'>>;

const contribScore = (c: Omit<Contrib, 'score'>): number => c.houses * 10 + c.food + c.power * 2 + c.medicine * 2;
const mkContrib = (houses: number, food: number, power: number, medicine: number): Contrib => ({
  houses,
  food,
  power,
  medicine,
  score: contribScore({ houses, food, power, medicine }),
});
// seeded numbers only — these houses are "already in town", never placed in 3D
const START_CONTRIBS: Record<string, Contrib> = {
  'u/ashen_fox': mkContrib(2, 6, 1, 0), // 28
  'u/saltcedar': mkContrib(1, 4, 0, 3), // 20
  'u/quiet_marrow': mkContrib(0, 9, 2, 0), // 13
  'u/tinder_witch': mkContrib(0, 3, 1, 1), // 7
  'u/you': mkContrib(0, 0, 0, 0), // the player climbs from zero
};

// resource gifts the simulation can pick — vital key + contrib key + range
const GIFTS: { k: 'food' | 'power' | 'medicine'; vit: VitKey; min: number; max: number }[] = [
  { k: 'food', vit: 'FOOD', min: 6, max: 14 },
  { k: 'power', vit: 'POWER', min: 3, max: 7 },
  { k: 'medicine', vit: 'MEDICINE', min: 2, max: 5 },
];

const LB_RANKS = ['🥇', '🥈', '🥉'];

const vitColor = (pct: number, danger = false): string =>
  danger ? (pct >= 70 ? '#c85040' : pct >= 40 ? '#e8c34a' : '#57c06a') : pct < 25 ? '#c85040' : pct < 50 ? '#e8c34a' : '#57c06a';

// ---------- BUILD FROM ZERO (community city progression) ----------
// The city rises from a bare camp: every player's day of labor pushes the SAME
// shared meter, and when it fills the next building unlocks for everyone. Live
// mode reads this from the server (InitResponse.build); demo synthesizes an
// identical local state so the panel — and the 3D scene — still animate.
// Sequence + thresholds mirror the server contract exactly.
const BUILD_SEQUENCE: BuildingDef[] = [
  { id: 'shelter', name: 'Shelter', description: 'First roofs against the cold — souls stop freezing.', progressRequired: 24, effect: 'survivors stay' },
  { id: 'farm', name: 'Farm', description: 'Worked beds — food grows faster.', progressRequired: 30, effect: '+3 food/day' },
  { id: 'clinic', name: 'Clinic', description: 'A ward for the sick — medicine goes further.', progressRequired: 34, effect: '+2 medicine/day' },
  { id: 'watchtower', name: 'Watchtower', description: 'Eyes on the horizon — raiders lose the surprise.', progressRequired: 30, effect: '−threat at dawn' },
  { id: 'storehouse', name: 'Storehouse', description: 'Dry stores — less waste, deeper reserves.', progressRequired: 28, effect: '+food capacity' },
  { id: 'wall', name: 'Wall', description: 'Stone around the camp — the wall holds far longer.', progressRequired: 40, effect: '+defense' },
  { id: 'council_hall', name: 'Council Hall', description: 'A place to decide together — the city endures.', progressRequired: 44, effect: 'the city endures' },
];
const BUILD_LABOR_STEP = 6; // labor added per contribution (matches the server)
// 7 buildings collapse into 5 named stages (stage index 0..4).
const DEMO_STAGE_LABELS = ['Camp', 'Settlement', 'Village', 'Town', 'City'];
const demoStage = (built: number): number => (built >= 6 ? 4 : built >= 4 ? 3 : built >= 2 ? 2 : built);
// Build a BuildStatus from the local demo counters so the panel renders the
// same shape as the live server payload.
const demoBuildStatus = (unlocked: string[], progress: number, contributorsToday: number): BuildStatus => {
  const next = BUILD_SEQUENCE[unlocked.length] ?? null;
  const stage = demoStage(unlocked.length);
  return {
    stage,
    stageLabel: DEMO_STAGE_LABELS[stage] ?? 'City',
    unlocked,
    next,
    progress,
    progressRequired: next?.progressRequired ?? 0,
    contributorsToday,
    youBuiltToday: false,
  };
};

function VillageCanvas({
  onReady,
  onProgress,
  onLoad,
  onSelect,
  onPois,
  onChat,
  onBuilt,
  onVillager,
}: {
  onReady: (h: VillageHandle) => void;
  onProgress: (pct: number) => void;
  onLoad: () => void;
  onSelect: (meta: BuildingMeta | null) => void;
  onPois: (pois: PoiInfo[]) => void;
  onChat: (who: string, text: string) => void;
  onBuilt: (x: number, z: number) => void;
  onVillager: (name: string | null) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return undefined;
    // onChat / onBuilt / onVillager are optional scene hooks (added by another
    // agent) — the assertion keeps this compiling against either scene.ts.
    const handle = createVillageScene(el, { onProgress, onLoad, onSelect, onPois, onChat, onBuilt, onVillager } as VillageHooks);
    onReady(handle);
    return () => handle.dispose();
    // mount once — callbacks are stable (useCallback in App)
  }, []);
  return <div ref={mountRef} className="canvas-mount" />;
}

function TopBar({ vitals, population, subtitle }: { vitals: Vitals; population: number; subtitle: string }) {
  const RES: [string, number][] = [
    ['🍞', vitals.FOOD],
    ['⚡', vitals.POWER],
    ['🩹', vitals.MEDICINE],
    ['🙂', vitals.MORALE],
    ['☠️', vitals.THREAT],
    ['🛡️', vitals.DEFENSE],
    ['👥', population],
  ];
  return (
    <div className="hud topbar">
      <div className="title card-bit">
        <h1>THE LAST CITY</h1>
        <div className="sub">{subtitle}</div>
      </div>
      <div className="res">
        {RES.map(([icon, value]) => (
          <span key={icon} className="pill card-bit">
            {icon} <b>{value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function DayPill({
  time,
  day,
  raidSoon,
  raidActive,
}: {
  time: TimeOfDay;
  day: number;
  raidSoon: boolean;
  raidActive: boolean;
}) {
  const def = TIMES.find((t) => t.id === time)!;
  return (
    <div className={time === 'dawn' ? 'hud day card-bit glow' : 'hud day card-bit'}>
      <span className="day-n">DAY {day}</span>
      <div className="dn">
        {def.icon} {def.label}
      </div>
      <div className="dt">{def.tagline}</div>
      {raidActive ? (
        <div className="dp-warn">⚔ RAID AT THE GATE</div>
      ) : (
        raidSoon && <div className="dp-warn">⚠ raiders sighted beyond the wall</div>
      )}
    </div>
  );
}

// Notification stack — top-center under the DayPill, newest on top, each
// auto-dismisses after 5s (timers owned by App).
function NotifStack({ notifs }: { notifs: Notif[] }) {
  return (
    <div className="hud notifs">
      {notifs.map((n) => (
        <div key={n.key} className={n.tone ? `notif on ${n.tone}` : 'notif on'}>
          <span className="ni">{n.icon}</span>
          <span className="nt">{n.text}</span>
        </div>
      ))}
    </div>
  );
}

type LiveState = {
  pledged: number;
  pledgedToday: boolean;
  onPledge: () => void;
  talk: TalkMsg[];
  hiCooldown: boolean;
  onSayHi: () => void;
  villager: string | null;
  crisisVotes: Record<CrisisOptId, number>;
  myCrisisVote: CrisisOptId | null;
  onCrisisVote: (id: CrisisOptId) => void;
  councilVotes: Record<PlanId, number>;
  raidDays: number;
  events: LiveEvent[];
  /** Real-backend payload — null keeps the demo rendering untouched. */
  liveData: LiveData | null;
};

function LiveTab({
  pledged,
  pledgedToday,
  onPledge,
  talk,
  hiCooldown,
  onSayHi,
  villager,
  crisisVotes,
  myCrisisVote,
  onCrisisVote,
  councilVotes,
  raidDays,
  events,
  liveData,
}: LiveState) {
  const mkGoal = liveData?.markedGoal ?? MARKED_GOAL;
  const mkPct = Math.min(100, Math.round((pledged / Math.max(1, mkGoal)) * 100));
  const crisisTotal = Math.max(1, crisisVotes.a + crisisVotes.b + crisisVotes.c);
  const liveCrisisTotal = liveData ? Math.max(1, Object.values(liveData.crisisVotes).reduce((a, b) => a + b, 0)) : 1;
  const councilMax = Math.max(1, ...PLAN_IDS.map((id) => councilVotes[id]));
  const liveCouncilMax = liveData ? Math.max(1, ...liveData.plans.map((p) => p.votes)) : 1;
  const raidSoon = raidDays <= 1;
  return (
    <>
      {liveData?.hasDawnReport && (
        <button type="button" className="say-hi" onClick={liveData.onOpenDawn}>
          🌅 DAWN REPORT
        </button>
      )}
      <div className="p-sec">THE MARKED</div>
      <div className="marked">
        <div className="mk-head">
          <span className="mi">{liveData?.markedIcon ?? '🧒'}</span>
          <span className="mn">{liveData?.markedName ?? 'Mira, the greenhouse child'}</span>
        </div>
        {liveData && <div className="mini-cap">{liveData.markedBlurb}</div>}
        <div className="mk-bar">
          <i style={{ width: `${mkPct}%` }} />
        </div>
        <div className="mk-meta">
          <span>
            {pledged} / {mkGoal} {liveData?.markedUnit ?? 'resolve'}
          </span>
          <span>{pledgedToday ? "You've helped today" : `${mkPct}% saved`}</span>
        </div>
        <div className="mk-pledges">
          {liveData
            ? liveData.pledgeOptions.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="mk-pledge"
                  disabled={pledgedToday}
                  onClick={() => liveData.onPledgeKind(p.id)}
                >
                  {p.icon} {p.label}
                </button>
              ))
            : PLEDGES.map((p) => (
                <button key={p.id} type="button" className="mk-pledge" disabled={pledgedToday} onClick={onPledge}>
                  {p.icon} {p.label}
                </button>
              ))}
        </div>
      </div>

      <div className="p-sec">THE COMMENTS — SAY HI</div>
      <div className="talk">
        {talk.map((m) => (
          <div key={m.key} className={m.you ? 'tk you' : 'tk'}>
            <span className="ta">{m.who}</span>
            <span className="tx">{m.text}</span>
          </div>
        ))}
        <button type="button" className="say-hi" disabled={hiCooldown} onClick={onSayHi}>
          {hiCooldown ? '…' : villager ? `👋 SAY HI to @${villager}` : '👋 SAY HI IN THE COMMENTS'}
        </button>
      </div>

      <div className="p-sec">TODAY'S CRISIS</div>
      <div className="crisis">
        <div className="cr-title">⚔️ {liveData ? liveData.crisisTitle : 'The Convoy at the Gate'}</div>
        {liveData && <div className="mini-cap">{liveData.crisisNarrative}</div>}
        {liveData
          ? liveData.crisisOptions.map((o) => {
              const pct = Math.round(((liveData.crisisVotes[o.id] ?? 0) / liveCrisisTotal) * 100);
              return (
                <button
                  key={o.id}
                  type="button"
                  className={liveData.myVote === o.id ? 'cr-opt mine' : 'cr-opt'}
                  disabled={liveData.myVote !== null}
                  onClick={() => liveData.onVote(o.id)}
                >
                  <span className="cr-nm">{o.label}</span>
                  <span className="cr-fx">{o.fx}</span>
                  <span className="cr-pct">{pct}%</span>
                </button>
              );
            })
          : CRISIS_OPTS.map((o) => {
              const pct = Math.round((crisisVotes[o.id] / crisisTotal) * 100);
              return (
                <button
                  key={o.id}
                  type="button"
                  className={myCrisisVote === o.id ? 'cr-opt mine' : 'cr-opt'}
                  disabled={myCrisisVote !== null}
                  onClick={() => onCrisisVote(o.id)}
                >
                  <span className="cr-nm">{o.nm}</span>
                  <span className="cr-fx">{o.fx}</span>
                  <span className="cr-pct">{pct}%</span>
                </button>
              );
            })}
      </div>

      <div className="p-sec">THE COUNCIL</div>
      <div className="council">
        {liveData
          ? liveData.plans.map((p) => {
              const lead = p.votes === liveCouncilMax && p.votes > 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={liveData.myPlan === p.id || lead ? 'co-plan lead' : 'co-plan'}
                  disabled={liveData.myPlan !== null}
                  onClick={() => liveData.onPlan(p.id)}
                  style={{ width: '100%', background: 'none', border: 'none', padding: 0, cursor: liveData.myPlan === null ? 'pointer' : 'default' }}
                >
                  <span className="co-nm">{p.nm}</span>
                  <div className="co-bar">
                    <i style={{ width: `${Math.round((p.votes / liveCouncilMax) * 100)}%` }} />
                  </div>
                  <span className="co-v">{p.votes}</span>
                </button>
              );
            })
          : PLANS.map((p) => {
              const v = councilVotes[p.id];
              const lead = v === councilMax;
              return (
                <div key={p.id} className={lead ? 'co-plan lead' : 'co-plan'}>
                  <span className="co-nm">{p.nm}</span>
                  <div className="co-bar">
                    <i style={{ width: `${Math.round((v / councilMax) * 100)}%` }} />
                  </div>
                  <span className="co-v">{v}</span>
                </div>
              );
            })}
      </div>

      <div className="p-sec">RAID WATCH</div>
      <div className={raidSoon ? 'raid soon' : 'raid'}>
        <span className="raid-ic">☠️</span>
        <div className="raid-body">
          <div className="raid-count">{raidSoon ? 'RAID AT NEXT DAWN' : `RAID IN ${raidDays} DAWNS`}</div>
          <div className="raid-note">
            {liveData?.raidNote ?? (liveData?.raidLikely
              ? '⚠ the forecast says raiders move at dawn — guard the wall'
              : 'guard the wall — every point of defense counts')}
          </div>
          {liveData?.raidLikely && (
            <div className="raid-detail">At dawn, the Red Signal can cost food, power, morale, and souls. Guard Wall softens every loss.</div>
          )}
        </div>
      </div>

      <div className="p-sec">LIVE EVENTS</div>
      <div className="events">
        {events.map((e, i) => (
          <div key={e.key} className={i === 0 ? 'ev new' : 'ev'}>
            <span className="ei">{e.icon}</span>
            <span className="et">{e.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// TOP 🏆 tab — subreddit contribution leaderboard + city totals.
// Live mode renders the real server leaderboard (username + score only).
function TopTab({ contribs, lb }: { contribs: Record<string, Contrib>; lb: LeaderboardEntry[] | null }) {
  if (lb) {
    const topScore = Math.max(1, lb[0]?.score ?? 1);
    return (
      <>
        <div className="p-sec">TOP CONTRIBUTORS</div>
        <div className="lb">
          {lb.length === 0 && <div className="mini-cap">no contributions yet — be the first</div>}
          {lb.map((row, i) => (
            <div key={`${row.username}-${i}`} className="lb-row">
              <span className="lb-rank">{LB_RANKS[i] ?? i + 1}</span>
              <span className="lb-user">u/{row.username}</span>
              <span className="lb-score">{row.score}</span>
              <div className="lb-bar">
                <i style={{ width: `${Math.round((row.score / topScore) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="p-sec">CITY TOTALS</div>
        <div className="lb-total">every action, pledge and council stand counts toward the ledger</div>
      </>
    );
  }
  const ranked = Object.entries(contribs)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([name, c], i) => ({ name, c, rank: i }));
  // top 8, but the player's row stays pinned on (with its true rank)
  const rows = ranked.slice(0, 8);
  const you = ranked.find((r) => r.name === 'u/you');
  if (you && you.rank >= 8) rows.push(you);
  const topScore = Math.max(1, ranked[0]?.c.score ?? 1);
  const totals = Object.values(contribs).reduce(
    (acc, c) => ({
      houses: acc.houses + c.houses,
      food: acc.food + c.food,
      power: acc.power + c.power,
      medicine: acc.medicine + c.medicine,
    }),
    { houses: 0, food: 0, power: 0, medicine: 0 },
  );
  return (
    <>
      <div className="p-sec">TOP CONTRIBUTORS</div>
      <div className="lb">
        {rows.map(({ name, c, rank }) => (
          <div key={name} className={name === 'u/you' ? 'lb-row me' : 'lb-row'}>
            <span className="lb-rank">{LB_RANKS[rank] ?? rank + 1}</span>
            <span className="lb-user">{name}</span>
            <span className="lb-stats">
              🏠{c.houses} · 🍞{c.food} · ⚡{c.power} · 🩹{c.medicine}
            </span>
            <span className="lb-score">{c.score}</span>
            <div className="lb-bar">
              <i style={{ width: `${Math.round((c.score / topScore) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="p-sec">CITY TOTALS</div>
      <div className="lb-total">
        🏠 {totals.houses} houses bought · gifted 🍞{totals.food} · ⚡{totals.power} · 🩹{totals.medicine}
      </div>
    </>
  );
}

// ---------- MAP tab: town minimap (SVG schematic from getMapData/getView) ----------
function MiniMap({
  mapData,
  view,
  onFocusDistrict,
  onFocusPoint,
}: {
  mapData: MapData | null;
  view: MapView | null;
  onFocusDistrict: (name: string) => void;
  onFocusPoint: (x: number, z: number) => void;
}) {
  const R = (mapData?.radius ?? 72) * 1.08;
  const svgRef = useRef<SVGSVGElement>(null);

  const flyToClick = (e: ReactMouseEvent<SVGRectElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.getBoundingClientRect();
    const sx = -R + ((e.clientX - pt.left) / pt.width) * 2 * R;
    const sz = -R + ((e.clientY - pt.top) / pt.height) * 2 * R;
    onFocusPoint(sx, sz);
  };

  // view cone: two edges fanned ±20° around the cam→target direction, out to ~40 units
  let cone: string | null = null;
  if (view) {
    const dx = view.tx - view.cx;
    const dz = view.tz - view.cz;
    const base = Math.atan2(dz, dx);
    const spread = (20 * Math.PI) / 180;
    const reach = 40;
    const ax = view.cx + Math.cos(base - spread) * reach;
    const az = view.cz + Math.sin(base - spread) * reach;
    const bx = view.cx + Math.cos(base + spread) * reach;
    const bz = view.cz + Math.sin(base + spread) * reach;
    cone = `${view.cx},${view.cz} ${ax},${az} ${bx},${bz}`;
  }

  return (
    <div className="mini">
      <svg ref={svgRef} className="mini-svg" viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} xmlns="http://www.w3.org/2000/svg">
        {/* click-anywhere fly target sits behind everything */}
        <rect x={-R} y={-R} width={2 * R} height={2 * R} fill="transparent" pointerEvents="all" onClick={flyToClick} />
        {mapData && mapData.outline.length > 0 && (
          <polygon className="mm-plateau" points={mapData.outline.map(([x, z]) => `${x},${z}`).join(' ')} />
        )}
        {mapData?.houses.map(([x, z], i) => <circle key={`h${i}`} className="mm-house" cx={x} cy={z} r={0.9} />)}
        {view && cone && <polygon className="mm-cone" points={cone} />}
        {view && (
          <>
            <line className="mm-cam" x1={view.cx} y1={view.cz} x2={view.tx} y2={view.tz} />
            <circle className="mm-cam" cx={view.cx} cy={view.cz} r={2.5} />
          </>
        )}
        {mapData?.districts.map((d) => (
          <g
            key={d.name}
            className="mm-pin"
            data-name={d.name}
            onClick={(e) => {
              e.stopPropagation();
              onFocusDistrict(d.name);
            }}
          >
            <circle cx={d.x} cy={d.z} r={2.2} />
            <text className="mm-pin-ic" x={d.x} y={d.z} fontSize={4} textAnchor="middle" dominantBaseline="central">
              {d.icon}
            </text>
          </g>
        ))}
      </svg>
      <div className="mini-cap">tap a district or the map to fly there</div>
    </div>
  );
}

// ---------- MAP tab: world map of rival subreddit-cities ----------
// A parchment-style terrain map: sea → continent → mountains/forests/river →
// curved trade routes → hut-cluster settlements with status flags. Demo shows
// the fictional set; live maps real /api/world cities onto the same 6 slots.
type WmCity = { id: string; name: string; status: WorldStatus; x: number; y: number; info?: string };
function WorldMap({
  youStatus,
  liveCities,
  liveMode,
  note,
}: {
  youStatus: WorldStatus;
  liveCities: WorldCity[] | null;
  liveMode: boolean;
  note: string | null;
}) {
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  let cities: WmCity[];
  const unavailable = liveMode && liveCities === null;
  if (liveCities) {
    // your city → the center slot; the top 5 others (already ranked) → the
    // remaining slots. Fewer than 6 cities just leaves slots empty.
    const you = liveCities.find((c) => c.isYou) ?? null;
    const others = liveCities.filter((c) => !c.isYou).slice(0, 5);
    const info = (c: WorldCity) => `${c.survivalDays} dawns · ${c.population} souls`;
    cities = [];
    const center = WORLD_CITIES[0]!;
    if (you) cities.push({ id: 'you', name: you.subreddit, status: you.status, x: center.x, y: center.y, info: info(you) });
    others.forEach((c, i) => {
      const slot = WORLD_CITIES[i + 1];
      if (!slot) return;
      cities.push({ id: slot.id, name: c.subreddit, status: c.status, x: slot.x, y: slot.y, info: info(c) });
    });
  } else {
    cities = WORLD_CITIES.map((c) => (c.id === 'you' ? { ...c, status: youStatus } : c));
  }
  const sel = cities.find((c) => c.id === selectedCity) ?? null;
  if (unavailable) {
    return (
      <div className="wm wm-unavailable">
        <div className="wm-empty card-bit">
          <div className="wm-empty-k">{note ? 'WORLD SIGNAL LOST' : 'SCANNING WORLD'}</div>
          <div className="wm-empty-t">{note ? 'The known world is unavailable.' : 'Contacting the world registry.'}</div>
          <div className="wm-empty-b">{note ?? 'Real subreddit-cities will appear here when the registry answers.'}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="wm">
      <svg className="wm-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        {/* sea + landmass */}
        <rect className="wm-sea" x={0} y={0} width={100} height={100} />
        <path className="wm-land" d={WM_LAND} />
        {WM_ISLES.map((d, i) => (
          <path key={`isle${i}`} className="wm-isle" d={d} />
        ))}
        {/* terrain: river under the mountains, forests as canopy circles */}
        <path className="wm-river" d={WM_RIVER} fill="none" />
        {WM_MTNS.map((m, i) => (
          <path key={`mtn${i}`} className="wm-mtn" d={mtnPath(m.x, m.y, m.s)} />
        ))}
        {WM_TREES.map(([tx, ty], i) => (
          <circle key={`tree${i}`} className="wm-tree" cx={tx} cy={ty} r={1.2} />
        ))}
        {/* curved trade routes: YOUR CITY → each rival */}
        {cities
          .filter((c) => c.id !== 'you')
          .map((c) => (
            <path key={`l${c.id}`} className="wm-link" d={WM_ROUTES[c.id] ?? ''} fill="none" />
          ))}
        {/* settlements: hut clusters + status flag + name */}
        {cities.map((c) => {
          const st = WORLD_STATUS[c.status];
          const isYou = c.id === 'you';
          const huts = isYou ? WM_HUTS_BIG : WM_HUTS_SMALL;
          const s = isYou ? 1.15 : 1; // your city builds a little bigger
          const w = 1.6 * s;
          const h = 1.2 * s;
          const poleX = c.x + (isYou ? 3.6 : 2.7);
          const poleTop = c.y - (isYou ? 3.2 : 2.4);
          return (
            <g key={c.id} className={isYou ? 'wm-city you' : 'wm-city'} onClick={() => setSelectedCity(c.id)}>
              {/* generous invisible hit target */}
              <circle cx={c.x} cy={c.y} r={6} fill="transparent" />
              {isYou && <circle className="wm-ring" cx={c.x} cy={c.y} r={5.6} fill="none" />}
              {isYou && <path className="wm-wall" d={octPath(c.x, c.y, 4.6)} fill="none" />}
              {huts.map(([dx, dy], i) => {
                const hx = c.x + dx;
                const hy = c.y + dy;
                return (
                  <g key={`hut${i}`}>
                    <rect x={hx - w / 2} y={hy - h} width={w} height={h} />
                    <path d={`M ${hx - w / 2 - 0.2 * s} ${hy - h} L ${hx} ${hy - h - 0.9 * s} L ${hx + w / 2 + 0.2 * s} ${hy - h} Z`} />
                  </g>
                );
              })}
              {/* status banner: pole + colored flag */}
              <line x1={poleX} y1={c.y + 0.6} x2={poleX} y2={poleTop} stroke="currentColor" strokeWidth={0.25} />
              <circle className="wm-flag" cx={poleX} cy={poleTop - 0.9} r={1.1} fill={st.color} />
              <text className="wm-name" x={c.x} y={c.y + (isYou ? 6.2 : 4.8)} fontSize={isYou ? 3 : 2.7} textAnchor="middle">
                {c.name}
              </text>
            </g>
          );
        })}
        {/* map furniture: caption + compass rose in the southwest sea */}
        <text className="wm-cap" x={50} y={5.2} fontSize={3.2} textAnchor="middle" letterSpacing={1.4}>
          THE KNOWN WORLD
        </text>
        <g className="wm-compass">
          <path d="M 9 84.5 L 10.2 87.8 L 13.5 89 L 10.2 90.2 L 9 93.5 L 7.8 90.2 L 4.5 89 L 7.8 87.8 Z" />
          <text x={9} y={83.4} fontSize={2.6} textAnchor="middle">
            N
          </text>
        </g>
      </svg>
      {sel && (
        <div className="wm-info">
          {WORLD_STATUS[sel.status].icon} {sel.name} — {WORLD_STATUS[sel.status].label}.{' '}
          {sel.info ?? WORLD_STATUS[sel.status].flavor}
        </div>
      )}
      {note && <div className="mini-cap">{note}</div>}
    </div>
  );
}

type DashTab = 'map' | 'city' | 'live' | 'top';
type MapViewMode = 'town' | 'world';

// BUILD panel (CITY tab) — the shared "build from zero" progress. Framed as
// community effort: everyone's labor pushes one meter and unlocks buildings for
// the whole city. Never "you built X" — always "we build this city together".
function BuildPanel({
  build,
  onAddLabor,
  ctaDisabled,
  ctaLabel,
}: {
  build: BuildStatus;
  onAddLabor: () => void;
  ctaDisabled: boolean;
  ctaLabel: string;
}) {
  const { stage, stageLabel, unlocked, next, progress, progressRequired, contributorsToday } = build;
  const pct = progressRequired > 0 ? Math.min(100, Math.round((progress / progressRequired) * 100)) : 100;
  return (
    <div className="build-panel">
      <div className="bp-head">
        <span className="bp-stage">{stageLabel}</span>
        <span className="bp-sub">stage {stage + 1}/5 · we build this city together</span>
      </div>
      {next ? (
        <>
          <div className="bp-next">
            <span className="bp-nm">Next: {next.name}</span>
            <span className="bp-desc">{next.description}</span>
            <span className="bp-fx">{next.effect}</span>
          </div>
          <div className="bp-bar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="bp-meta">
            {progress}/{progressRequired} labor · {contributorsToday} contributed today
          </div>
        </>
      ) : (
        <div className="bp-next">The city is built. It survives.</div>
      )}
      <div className="bp-built">Built: {unlocked.length ? unlocked.join(' · ') : 'nothing yet — just a camp'}</div>
      <button type="button" className="bp-cta" disabled={ctaDisabled} onClick={onAddLabor}>
        {ctaLabel}
      </button>
    </div>
  );
}

function CityDashboard({
  open,
  setOpen,
  tab,
  setTab,
  mapView,
  setMapView,
  mapData,
  view,
  onFocusDistrict,
  onFocusPoint,
  worldYouStatus,
  worldCities,
  worldNote,
  worldLive,
  pois,
  levels,
  vitals,
  vitalMaxes,
  selectedName,
  onVisit,
  live,
  contribs,
  lb,
  build,
  onAddLabor,
  buildCtaDisabled,
  buildCtaLabel,
}: {
  open: boolean;
  setOpen: (b: boolean) => void;
  tab: DashTab;
  setTab: (t: DashTab) => void;
  mapView: MapViewMode;
  setMapView: (m: MapViewMode) => void;
  mapData: MapData | null;
  view: MapView | null;
  onFocusDistrict: (name: string) => void;
  onFocusPoint: (x: number, z: number) => void;
  worldYouStatus: WorldStatus;
  worldCities: WorldCity[] | null;
  worldNote: string | null;
  worldLive: boolean;
  pois: PoiInfo[];
  levels: Record<string, number>;
  vitals: Vitals;
  vitalMaxes: Record<VitKey, number>;
  selectedName: string | null;
  onVisit: (name: string) => void;
  live: LiveState;
  contribs: Record<string, Contrib>;
  lb: LeaderboardEntry[] | null;
  build: BuildStatus | null;
  onAddLabor: () => void;
  buildCtaDisabled: boolean;
  buildCtaLabel: string;
}) {
  return (
    <>
      <button type="button" className="hud dash-fab card-bit" onClick={() => setOpen(!open)} aria-expanded={open}>
        ▦ CITY
      </button>
      <div className={open ? 'hud dash card-bit on' : 'hud dash card-bit'}>
        <div className="p-head">
          <span>CITY</span>
          <button type="button" className="p-x" onClick={() => setOpen(false)} aria-label="Close dashboard">
            ✕
          </button>
        </div>

        <div className="dash-tabs">
          <button type="button" className={tab === 'map' ? 'dash-tab on' : 'dash-tab'} onClick={() => setTab('map')} aria-pressed={tab === 'map'}>
            MAP
          </button>
          <button type="button" className={tab === 'city' ? 'dash-tab on' : 'dash-tab'} onClick={() => setTab('city')} aria-pressed={tab === 'city'}>
            CITY
          </button>
          <button type="button" className={tab === 'live' ? 'dash-tab on' : 'dash-tab'} onClick={() => setTab('live')} aria-pressed={tab === 'live'}>
            LIVE
          </button>
          <button type="button" className={tab === 'top' ? 'dash-tab on' : 'dash-tab'} onClick={() => setTab('top')} aria-pressed={tab === 'top'}>
            TOP 🏆
          </button>
        </div>

        {tab === 'map' && (
          <>
            <div className="map-seg">
              <button type="button" className={mapView === 'town' ? 'map-seg-btn on' : 'map-seg-btn'} onClick={() => setMapView('town')} aria-pressed={mapView === 'town'}>
                TOWN
              </button>
              <button type="button" className={mapView === 'world' ? 'map-seg-btn on' : 'map-seg-btn'} onClick={() => setMapView('world')} aria-pressed={mapView === 'world'}>
                WORLD
              </button>
            </div>
            {mapView === 'town' ? (
              <MiniMap mapData={mapData} view={view} onFocusDistrict={onFocusDistrict} onFocusPoint={onFocusPoint} />
            ) : (
              <WorldMap youStatus={worldYouStatus} liveCities={worldCities} liveMode={worldLive} note={worldNote} />
            )}
          </>
        )}

        {tab === 'live' && <LiveTab {...live} />}

        {tab === 'top' && <TopTab contribs={contribs} lb={lb} />}

        {tab === 'city' && (
          <>
            {build && (
              <BuildPanel build={build} onAddLabor={onAddLabor} ctaDisabled={buildCtaDisabled} ctaLabel={buildCtaLabel} />
            )}
            <div className="p-sec">CITY VITALS</div>
            <div className="vits">
              {VITAL_DEFS.map((r) => {
                const max = vitalMaxes[r.k];
                const v = vitals[r.k];
                const pct = Math.min(100, (v / max) * 100);
                const col = vitColor(pct, r.danger);
                return (
                  <div key={r.k} className="vit">
                    <div className="t">
                      <span className="k">
                        {r.icon} {r.k}
                      </span>
                      <span className="v" style={{ color: col }}>
                        {v}
                        <em>/{max}</em>
                      </span>
                    </div>
                    <div className="track">
                      <i style={{ width: `${pct}%`, background: col }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-sec">DISTRICTS — TAP TO VISIT</div>
            <div className="districts">
              {pois.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className={selectedName === p.name ? 'district on' : 'district'}
                  onClick={() => onVisit(p.name)}
                  title={p.blurb}
                >
                  <span className="di">{p.icon}</span>
                  <span className="dn2">
                    {p.name}
                    <i>LVL {levels[p.name] ?? p.level}</i>
                  </span>
                  <span className="go">→</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function BuildingChip({
  meta,
  levels,
  food,
  onUpgrade,
  live,
}: {
  meta: BuildingMeta | null;
  levels: Record<string, number>;
  food: number;
  onUpgrade: (name: string) => void;
  live: boolean;
}) {
  const [shown, setShown] = useState<BuildingMeta | null>(meta);
  useEffect(() => {
    if (meta) setShown(meta);
  }, [meta]);
  const level = shown ? (levels[shown.name] ?? shown.level) : 1;
  const canAfford = food >= UPGRADE_COST;
  return (
    <div className={meta ? 'hud chip card-bit on' : 'hud chip card-bit'}>
      <div className="nm">{shown?.name ?? ''}</div>
      <div className="lv">LEVEL {level}</div>
      <div className="bl">{shown?.blurb ?? ''}</div>
      {!live && (
        <button
          type="button"
          className="up"
          disabled={!canAfford}
          title={canAfford ? undefined : 'not enough food'}
          onClick={() => {
            if (shown) onUpgrade(shown.name);
          }}
        >
          ⬆ UPGRADE — 🍞 {UPGRADE_COST}
        </button>
      )}
    </div>
  );
}

// Villager chip — replaces the building chip while a villager is selected in 3D.
function VillagerChip({
  name,
  hiCooldown,
  onWave,
  onSayHi,
  onClose,
}: {
  name: string;
  hiCooldown: boolean;
  onWave: () => void;
  onSayHi: () => void;
  onClose: () => void;
}) {
  return (
    <div className="hud vchip card-bit on">
      <button type="button" className="p-x" onClick={onClose} aria-label="Deselect villager">
        ✕
      </button>
      <div className="vn">{name}</div>
      <div className="vs">citizen of the last city</div>
      <button type="button" className="wave-btn" onClick={onWave}>
        👋 WAVE
      </button>
      <button type="button" className="hi-btn" disabled={hiCooldown} onClick={onSayHi}>
        💬 SAY HI
      </button>
    </div>
  );
}

function BuildDock({
  buildMode,
  onToggle,
  toastText,
  toastOn,
}: {
  buildMode: boolean;
  onToggle: () => void;
  toastText: string;
  toastOn: boolean;
}) {
  return (
    <div className="hud dock">
      <div style={{ position: 'relative' }}>
        <div className={toastOn ? 'toast on' : 'toast'}>{toastText}</div>
        <button
          type="button"
          className={buildMode ? 'build armed' : 'build'}
          onClick={onToggle}
          aria-label="Build"
          aria-pressed={buildMode}
        >
          🔨
        </button>
      </div>
      <span className="btag">BUILD</span>
    </div>
  );
}

// DAWN ACTIONS hotbar — once each per day, plus the demo-only route picker.
// Live mode: buttons post to the real API, an energy pill shows what's left,
// and SCAVENGE stays hidden for V1 (the mission minigame isn't ported to town).
function Hotbar({
  used,
  onAction,
  scouting,
  scavOpen,
  onToggleScav,
  onScavenge,
  live,
  energyLeft,
  actionCounts,
}: {
  used: Record<string, boolean>;
  onAction: (id: string) => void;
  scouting: boolean;
  scavOpen: boolean;
  onToggleScav: () => void;
  onScavenge: (id: RouteId) => void;
  live: boolean;
  energyLeft: number;
  actionCounts: Partial<Record<ActionType, number>>;
}) {
  return (
    <>
      {scavOpen && !live && (
        <div className="hud scav card-bit on">
          {ROUTES.map((r) => (
            <button key={r.id} type="button" className="route" onClick={() => onScavenge(r.id)}>
              <span className="ri">{r.icon}</span>
              <span className="rn">{r.title}</span>
              <span className="rb">{r.blurb}</span>
            </button>
          ))}
        </div>
      )}
      <div className={live ? 'hud hotbar live' : 'hud hotbar'}>
        {live && (
          <span className="pill card-bit" title="energy left today">
            ⚡ <b>{energyLeft}</b>
          </span>
        )}
        {ACTIONS.map((a) => {
          const count = actionCounts[a.id] ?? 0;
          const disabled = live ? energyLeft <= 0 : !!used[a.id];
          const fx = live ? (count > 0 ? `✓ ×${count} today` : a.fx) : used[a.id] ? '✓ done' : a.fx;
          return (
            <button key={a.id} type="button" className="act" disabled={disabled} onClick={() => onAction(a.id)}>
              <span className="ai">{a.icon}</span>
              <span className="al">{a.label}</span>
              <span className="af">{fx}</span>
            </button>
          );
        })}
        {!live && (
          <button
            type="button"
            className="act scv"
            disabled={scouting}
            onClick={onToggleScav}
            aria-expanded={scavOpen}
          >
            <span className="ai">🧭</span>
            <span className="al">SCAVENGE</span>
            <span className="af">{scouting ? 'scout out…' : 'pick a route'}</span>
          </button>
        )}
      </div>
    </>
  );
}

function DawnReportTeaser({
  report,
  show,
  onOpen,
  onDismiss,
}: {
  report: DawnReport | null;
  show: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  if (!report || !show) return null;
  const summary = report.citySummary[0] ?? 'A new dawn report is ready.';
  return (
    <div className="hud dawn-teaser card-bit">
      <button type="button" className="p-x" onClick={onDismiss} aria-label="Dismiss dawn report notice">
        ✕
      </button>
      <div className="dt-k">DAWN REPORT</div>
      <div className="dt-t">DAY {report.day}</div>
      <div className="dt-s">{summary}</div>
      <button type="button" className="dt-open" onClick={onOpen}>
        VIEW
      </button>
    </div>
  );
}

function RaidBanner({ phase }: { phase: RaidPhase }) {
  const cls =
    phase === 'idle'
      ? 'hud raid-banner card-bit'
      : phase === 'breach'
        ? 'hud raid-banner card-bit on bad'
        : 'hud raid-banner card-bit on';
  const title = phase === 'held' ? '🛡 THE WALL HELD' : phase === 'breach' ? '🔥 THE WALL WAS BREACHED' : '⚔ RAID AT THE GATE';
  const sub =
    phase === 'held'
      ? 'threat −38 · defense −8 · food −6'
      : phase === 'breach'
        ? '−8 souls · food −18 · defense −15'
        : 'the wall decides tonight…';
  return (
    <div className={cls}>
      <div className="rb-t">{title}</div>
      <div className="rb-s">{sub}</div>
    </div>
  );
}

// STATS — the full-screen city ledger: every number in the game, in tables.
function StatsModal({
  open,
  onClose,
  day,
  vitals,
  population,
  pois,
  levels,
  contribs,
  raidLog,
  youStatus,
  vitalMaxes,
  lb,
  liveRaidLikely,
  liveRaidNote,
}: {
  open: boolean;
  onClose: () => void;
  day: number;
  vitals: Vitals;
  population: number;
  pois: PoiInfo[];
  levels: Record<string, number>;
  contribs: Record<string, Contrib>;
  raidLog: RaidLogEntry[];
  youStatus: WorldStatus;
  vitalMaxes: Record<VitKey, number>;
  lb: LeaderboardEntry[] | null;
  liveRaidLikely: boolean;
  liveRaidNote: string | null;
}) {
  const ranked = Object.entries(contribs)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([name, c], i) => ({ name, c, rank: i }));
  const worldRows = WORLD_CITIES.map((c) => (c.id === 'you' ? { ...c, status: youStatus } : c));
  return (
    <div className={open ? 'hud stats-modal on' : 'hud stats-modal'}>
      <div className="stats-back" onClick={onClose} />
      <div className="stats-sheet card-bit">
        <button type="button" className="st-close" onClick={onClose} aria-label="Close stats">
          ✕
        </button>
        <h2>CITY LEDGER — DAY {day}</h2>

        <div className="st-sec">CITY VITALS</div>
        <table className="st">
          <thead>
            <tr>
              <th>RESOURCE</th>
              <th>VALUE</th>
              <th>MAX</th>
              <th>%</th>
              <th>STATE</th>
            </tr>
          </thead>
          <tbody>
            {VITAL_DEFS.map((r) => {
              const max = vitalMaxes[r.k];
              const v = vitals[r.k];
              const pct = Math.round((v / max) * 100);
              const eff = r.danger ? 100 - pct : pct; // THREAT: high is bad
              const tone = eff >= 50 ? 'good' : eff >= 25 ? 'low' : 'critical';
              return (
                <tr key={r.k}>
                  <td>
                    {r.icon} {r.k}
                  </td>
                  <td>{v}</td>
                  <td>{max}</td>
                  <td>{pct}%</td>
                  <td>
                    <span className={'st-tag ' + tone}>{tone}</span>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td>👥 SOULS</td>
              <td>{population}</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>

        <div className="st-sec">DISTRICTS</div>
        <table className="st">
          <thead>
            <tr>
              <th>DISTRICT</th>
              <th>LEVEL</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {pois.length === 0 ? (
              <tr>
                <td colSpan={3}>the districts are still waking…</td>
              </tr>
            ) : (
              pois.map((p) => {
                const lvl = levels[p.name] ?? p.level;
                return (
                  <tr key={p.name}>
                    <td>
                      {p.icon} {p.name}
                    </td>
                    <td>LVL {lvl}</td>
                    <td>{lvl > p.level ? 'upgraded' : 'standing'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        <div className="st-sec">TOP CONTRIBUTORS</div>
        {lb ? (
          <table className="st">
            <thead>
              <tr>
                <th>RANK</th>
                <th>USER</th>
                <th>SCORE</th>
              </tr>
            </thead>
            <tbody>
              {lb.length === 0 ? (
                <tr>
                  <td colSpan={3}>no contributions recorded yet</td>
                </tr>
              ) : (
                lb.map((row, i) => (
                  <tr key={`${row.username}-${i}`}>
                    <td>{LB_RANKS[i] ?? i + 1}</td>
                    <td>u/{row.username}</td>
                    <td>{row.score}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="st">
            <thead>
              <tr>
                <th>RANK</th>
                <th>USER</th>
                <th>🏠</th>
                <th>🍞</th>
                <th>⚡</th>
                <th>🩹</th>
                <th>SCORE</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ name, c, rank }) => (
                <tr key={name} className={name === 'u/you' ? 'me' : undefined}>
                  <td>{LB_RANKS[rank] ?? rank + 1}</td>
                  <td>{name}</td>
                  <td>{c.houses}</td>
                  <td>{c.food}</td>
                  <td>{c.power}</td>
                  <td>{c.medicine}</td>
                  <td>{c.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="st-sec">RED SIGNAL</div>
        <div className={liveRaidLikely ? 'raid-ledger danger' : 'raid-ledger'}>
          <b>{liveRaidLikely ? 'Raid pressure is active' : 'No raid forecast right now'}</b>
          <span>{liveRaidNote ?? 'Threat, defense, and Guard Wall actions decide the next Red Signal.'}</span>
        </div>

        <div className="st-sec">RAID LOG</div>
        <table className="st">
          <thead>
            <tr>
              <th>DAY</th>
              <th>OUTCOME</th>
              <th>SOULS</th>
              <th>FOOD</th>
              <th>DEFENSE</th>
            </tr>
          </thead>
          <tbody>
            {raidLog.length === 0 ? (
              <tr>
                <td colSpan={5}>no raids survived yet — the wall waits</td>
              </tr>
            ) : (
              raidLog.map((e) => (
                <tr key={e.key}>
                  <td>{e.day}</td>
                  <td className={e.outcome}>{e.outcome === 'held' ? '🛡 HELD' : '🔥 BREACH'}</td>
                  <td>−{e.souls}</td>
                  <td>−{e.food}</td>
                  <td>−{e.defense}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="st-sec">THE KNOWN WORLD</div>
        <table className="st">
          <thead>
            <tr>
              <th>CITY</th>
              <th>STATUS</th>
              <th>NOTE</th>
            </tr>
          </thead>
          <tbody>
            {worldRows.map((c) => {
              const st = WORLD_STATUS[c.status];
              return (
                <tr key={c.id} className={c.id === 'you' ? 'me' : undefined}>
                  <td>{c.name}</td>
                  <td>
                    <span className={'st-tag ' + (c.status === 'thriving' ? 'good' : c.status === 'holding' ? 'good' : c.status === 'strained' ? 'low' : 'critical')}>
                      {st.icon} {st.label}
                    </span>
                  </td>
                  <td>{st.flavor}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// DAWN REPORT — live-mode morning recap, reusing the stats-modal chrome.
function DawnReportModal({
  report,
  open,
  onClose,
}: {
  report: DawnReport | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!report || !open) return null;
  return (
    <div className="hud stats-modal dawn-report on">
      <div className="stats-back" onClick={onClose} />
      <div className="stats-sheet card-bit">
        <button type="button" className="st-close" onClick={onClose} aria-label="Close dawn report">
          ✕
        </button>
        <h2>DAWN REPORT — DAY {report.day}</h2>
        <div className="st-sec">THE CITY</div>
        {report.citySummary.length === 0 ? (
          <div className="mini-cap">a quiet night — nothing to report</div>
        ) : (
          <div className="dr-lines">
            {report.citySummary.map((line, i) => (
              <div key={i} className="dr-line">
                {line}
              </div>
            ))}
          </div>
        )}
        <div className="st-sec">YOUR PART</div>
        {report.yourImpact.length === 0 ? (
          <div className="mini-cap">You rested. The city carried on without you — today, change that.</div>
        ) : (
          <div className="dr-lines">
            {report.yourImpact.map((line, i) => (
              <div key={i} className="dr-line">
                {line}
              </div>
            ))}
          </div>
        )}
        {report.title && (
          <div className="dr-title">
            <span>TITLE</span>
            {report.title}
          </div>
        )}
      </div>
    </div>
  );
}

function OfflineNotice({ message }: { message: string | null }) {
  return (
    <div className="hud offline on">
      <div className="stats-back" />
      <div className="offline-sheet card-bit">
        <div className="offline-k">CITY LINK LOST</div>
        <h2>Reddit did not return the live city.</h2>
        <p>{message ?? 'Open the game from a Reddit post and make sure you are logged in.'}</p>
        <button type="button" onClick={() => window.location.reload()}>
          ↻ RETRY
        </button>
      </div>
    </div>
  );
}

function Loader({ pct, done }: { pct: number; done: boolean }) {
  return (
    <div className={done ? 'loader done' : 'loader'}>
      <div className="sun" />
      <h2>ONE MORE DAWN</h2>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="st">waking the village…</div>
    </div>
  );
}

// First-run ROLE + survivor-name onboarding (live mode only). Brand-new players
// (init.player.role === null) pick a role and, optionally, name their survivor
// before entering the city. The ✕ dismisses for the session (soft escape for a
// returning-but-roleless edge case) without setting a role server-side.
function Onboarding({
  busy,
  onEnter,
  onDismiss,
}: {
  busy: boolean;
  onEnter: (role: Role, name: string) => void;
  onDismiss: () => void;
}) {
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const selectedLabel = ROLE_CATALOG.find((r) => r.id === selectedRole)?.label ?? '';
  return (
    <div className="hud onboard on">
      <div className="onboard-sheet card-bit">
        <button type="button" className="p-x" onClick={onDismiss} aria-label="Dismiss onboarding">
          ✕
        </button>
        <div className="ob-sub" style={{ color: 'var(--ink)', marginTop: 0, marginBottom: 10 }}>
          This subreddit is a shared city trying to survive one more dawn. Everyone gets one meaningful
          action a day. Vote on the crisis, pledge to save The Marked, and hold the wall — then come back
          at dawn to see what the community's choices did. The city remembers.
        </div>
        <div className="ob-title">CHOOSE YOUR ROLE</div>
        <div className="ob-sub">Your role shapes what you're best at. You can change it later.</div>
        <div className="ob-roles">
          {ROLE_CATALOG.map((r) => (
            <button
              key={r.id}
              type="button"
              className={selectedRole === r.id ? 'ob-role on' : 'ob-role'}
              aria-pressed={selectedRole === r.id}
              onClick={() => setSelectedRole(r.id)}
            >
              <span className="ob-ic">{r.icon}</span>
              <span className="ob-nm">{r.label}</span>
              <span className="ob-bl">{r.blurb}</span>
            </button>
          ))}
        </div>
        <input
          className="ob-name"
          placeholder="name your survivor (optional)"
          maxLength={24}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="ob-go"
          disabled={!selectedRole || busy}
          onClick={() => {
            if (selectedRole) onEnter(selectedRole, name);
          }}
        >
          ENTER THE CITY
        </button>
        {selectedLabel && <div className="mini-cap">{busy ? 'entering the city…' : `you'll join as a ${selectedLabel.toLowerCase()}`}</div>}
      </div>
    </div>
  );
}

// Fallen-city terminal state (live mode only, city.status === 'fallen'). A dim
// scrim over the (still visible) 3D town; every action surface is suppressed and
// the LIVE handlers are no-ops while it shows. Only a mod reset clears it.
function FallenScreen({
  epitaph,
  survivalDays,
  population,
  cycle,
  day,
}: {
  epitaph: string;
  survivalDays: number;
  population: number;
  cycle: number;
  day: number;
}) {
  return (
    <div className="hud fallen on">
      <div className="fallen-sheet card-bit">
        <div className="fl-skull">💀</div>
        <div className="fl-title">THE CITY HAS FALLEN</div>
        <div className="fl-epitaph">{epitaph}</div>
        <div className="fl-stats">
          <span>Survived {survivalDays} dawns</span>
          <span>{population} souls remained</span>
          <span>Cycle {cycle}, Day {day}</span>
        </div>
        <div className="fl-note">Only a moderator's reset can begin a new cycle.</div>
      </div>
    </div>
  );
}

export function App() {
  const [pct, setPct] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<BuildingMeta | null>(null);
  const [pois, setPois] = useState<PoiInfo[]>([]);
  const [time, setTimeState] = useState<TimeOfDay>('dawn');
  const [dashOpen, setDashOpen] = useState(true);
  const [dashTab, setDashTab] = useState<DashTab>('map');
  const [mapView, setMapView] = useState<MapViewMode>('town');
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  // ---- the mini-game state machines ----
  const [vitals, setVitals] = useState<Vitals>(START_VITALS);
  const [population, setPopulation] = useState(143);
  const [day, setDay] = useState(5);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [buildMode, setBuildMode] = useState(false);
  const [raidPhase, setRaidPhase] = useState<RaidPhase>('idle');
  const [raidLog, setRaidLog] = useState<RaidLogEntry[]>([]); // resolved raids, newest first
  const [statsOpen, setStatsOpen] = useState(false); // 📊 full-screen city ledger
  const [talk, setTalk] = useState<TalkMsg[]>(() => [
    { who: 'u/saltcedar', text: 'watch fires lit, see you at dawn 🔥', key: 1 },
    { who: 'u/ashen_fox', text: "gm city, who's on wall duty?", key: 0 },
  ]);
  const [hiCooldown, setHiCooldown] = useState(false);
  const [toastText, setToastText] = useState('');
  const [toastOn, setToastOn] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [villager, setVillager] = useState<string | null>(null);
  // dawn actions: which are spent today · scavenge picker + scout-out flag
  const [used, setUsed] = useState<Record<string, boolean>>({});
  const [scavOpen, setScavOpen] = useState(false);
  const [scouting, setScouting] = useState(false);
  // LIVE tab state — all demo numbers, drifting on timers.
  const [pledged, setPledged] = useState(23);
  const [pledgedToday, setPledgedToday] = useState(false);
  const [crisisVotes, setCrisisVotes] = useState<Record<CrisisOptId, number>>({ a: 12, b: 5, c: 8 });
  const [myCrisisVote, setMyCrisisVote] = useState<CrisisOptId | null>(null);
  const [councilVotes, setCouncilVotes] = useState<Record<PlanId, number>>({
    prepare_raid: 9,
    stockpile_food: 6,
    repair_power: 4,
  });
  const [raidDays, setRaidDays] = useState(5);
  // subreddit contributions — houses bought + resources gifted, per user
  const [contribs, setContribs] = useState<Record<string, Contrib>>(START_CONTRIBS);
  // seed newest-first: DRAMA[2] is the freshest, rotation continues at index 3
  const [events, setEvents] = useState<LiveEvent[]>(() => [2, 1, 0].map((i) => ({ ...DRAMA[i]!, key: i })));
  // ---- LIVE mode (real backend) state ----
  const [mode, setMode] = useState<Mode>('connecting');
  const [apiError, setApiError] = useState<string | null>(null);
  const [liveCrisis, setLiveCrisis] = useState<Crisis | null>(null);
  const [liveCrisisVotes, setLiveCrisisVotes] = useState<VoteTally>({});
  const [liveMyVote, setLiveMyVote] = useState<string | null>(null);
  const [liveStrategyVotes, setLiveStrategyVotes] = useState<VoteTally>({});
  const [liveMyPlan, setLiveMyPlan] = useState<string | null>(null);
  const [liveMarked, setLiveMarked] = useState<Marked | null>(null);
  const [livePledge, setLivePledge] = useState<PledgeInfo | null>(null);
  const [liveEnergy, setLiveEnergy] = useState({ effective: 0, used: 0 });
  const [liveActions, setLiveActions] = useState<Partial<Record<ActionType, number>>>({});
  const [liveStanding, setLiveStanding] = useState<Standing | null>(null);
  const [liveCycle, setLiveCycle] = useState(1);
  const [liveRaidLikely, setLiveRaidLikely] = useState(false);
  const [liveRaidNote, setLiveRaidNote] = useState<string | null>(null);
  const [dawnReport, setDawnReport] = useState<DawnReport | null>(null);
  const [dawnOpen, setDawnOpen] = useState(false);
  const [dawnTeaserOpen, setDawnTeaserOpen] = useState(false);
  const [worldCities, setWorldCities] = useState<WorldCity[] | null>(null);
  const [worldNote, setWorldNote] = useState<string | null>(null);
  const [liveLb, setLiveLb] = useState<LeaderboardEntry[] | null>(null);
  // BUILD FROM ZERO — live: server payload; demo: local counters synth a state.
  const [liveBuild, setLiveBuild] = useState<BuildStatus | null>(null);
  const [demoUnlocked, setDemoUnlocked] = useState<string[]>([]);
  const [demoBuildProgress, setDemoBuildProgress] = useState(0);
  const [demoContributors, setDemoContributors] = useState(6);
  // First-run onboarding (live only): a brand-new player has no role yet.
  const [needsOnboard, setNeedsOnboard] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [onboardBusy, setOnboardBusy] = useState(false);
  // Fallen-city terminal state (live only): city.status === 'fallen'.
  const [cityFallen, setCityFallen] = useState(false);
  const [liveTimelineHeadline, setLiveTimelineHeadline] = useState<string | null>(null);
  const [muted, setMutedUi] = useState(isMuted()); // global SFX mute (persisted)
  const handleRef = useRef<VillageHandle | null>(null);
  const cityFallenRef = useRef(false); // fallen state, readable inside handlers/timers
  const modeRef = useRef<Mode>('connecting'); // current mode, readable inside timers
  const mutatingRef = useRef(false); // a POST is in flight — pause polls + block double-taps
  const liveDayRef = useRef(0); // last server day seen (dawn diffing)
  const liveCrisisIdRef = useRef(''); // pins votes to the crisis being shown
  const seenDramaRef = useRef<Set<string>>(new Set()); // drama lines already in the feed
  const worldFetchedRef = useRef(false); // world fetched at least once (first tab open)
  const lbFetchedRef = useRef(false); // leaderboard fetched at least once
  const dashTabRef = useRef<DashTab>('map'); // open tab, readable inside the poll
  const mapViewRef = useRef<MapViewMode>('town');
  const pledgedRef = useRef(false); // click guard (double-tap before re-render)
  const votedRef = useRef(false);
  const nextEvRef = useRef(3);
  const evKeyRef = useRef(100); // monotonic key for every feed entry
  const talkKeyRef = useRef(10);
  const timeRef = useRef<TimeOfDay>('dawn'); // current phase, readable inside intervals
  const dayRef = useRef(5);
  const vitalsRef = useRef<Vitals>(START_VITALS); // fresh reads in callbacks/timers
  const levelsRef = useRef<Record<string, number>>({});
  const buildModeRef = useRef(false);
  const raidPhaseRef = useRef<RaidPhase>('idle');
  const raidDaysRef = useRef(5);
  const raidTimersRef = useRef<number[]>([]);
  const raidLogKeyRef = useRef(0); // monotonic key for raid-log entries
  const hiCooldownRef = useRef(false);
  const hiReplyIdxRef = useRef(0);
  const hiReplyTimerRef = useRef<number | null>(null);
  const hiCooldownTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const notifKeyRef = useRef(0); // monotonic key for every notification
  const notifTimersRef = useRef<number[]>([]);
  const villagerRef = useRef<string | null>(null); // selected villager, readable in timers
  const usedRef = useRef<Record<string, boolean>>({}); // click guard for dawn actions
  const prevDayRef = useRef(5); // last day seen by the action-reset effect
  const scoutingRef = useRef(false); // click guard: one scout out at a time
  const scoutTimerRef = useRef<number | null>(null);
  const poisRef = useRef<PoiInfo[]>([]); // district directory, readable in handlers
  const contribsRef = useRef<Record<string, Contrib>>(START_CONTRIBS); // fresh reads in timers
  const liveBuildRef = useRef<BuildStatus | null>(null); // last server build state, readable in the add-labor handler
  const demoUnlockedRef = useRef<string[]>([]); // demo build unlocks, readable in the handler
  const demoBuildProgressRef = useRef(0); // demo labor toward the next building

  useEffect(() => {
    timeRef.current = time;
  }, [time]);
  useEffect(() => {
    contribsRef.current = contribs;
  }, [contribs]);
  useEffect(() => {
    vitalsRef.current = vitals;
  }, [vitals]);
  useEffect(() => {
    levelsRef.current = levels;
  }, [levels]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    dashTabRef.current = dashTab;
  }, [dashTab]);
  useEffect(() => {
    mapViewRef.current = mapView;
  }, [mapView]);
  useEffect(() => {
    liveBuildRef.current = liveBuild;
  }, [liveBuild]);

  // ---- feed helpers ----
  const pushEvent = useCallback((icon: string, text: string) => {
    const key = evKeyRef.current;
    evKeyRef.current += 1;
    setEvents((prev) => [{ icon, text, key }, ...prev].slice(0, 6));
  }, []);
  const pushTalk = useCallback((who: string, text: string, you = false) => {
    const key = talkKeyRef.current;
    talkKeyRef.current += 1;
    setTalk((prev) => [{ who, text, you, key }, ...prev].slice(0, 7));
  }, []);
  const popToast = useCallback((text: string) => {
    setToastText(text);
    setToastOn(true);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastOn(false), 2200);
  }, []);
  // top-center notification stack — capped at 4, each auto-dismisses after 5s
  const pushNotif = useCallback((icon: string, text: string, tone?: 'good' | 'bad') => {
    const key = notifKeyRef.current;
    notifKeyRef.current += 1;
    setNotifs((prev) => [{ icon, text, tone, key }, ...prev].slice(0, 4));
    notifTimersRef.current.push(window.setTimeout(() => setNotifs((prev) => prev.filter((n) => n.key !== key)), 5000));
  }, []);

  // ---- contribution helpers ----
  // merge a patch into a user's contribution record and recompute their score
  const addContrib = useCallback((user: string, patch: ContribPatch) => {
    setContribs((prev) => {
      const cur = prev[user] ?? mkContrib(0, 0, 0, 0);
      const merged = mkContrib(
        cur.houses + (patch.houses ?? 0),
        cur.food + (patch.food ?? 0),
        cur.power + (patch.power ?? 0),
        cur.medicine + (patch.medicine ?? 0),
      );
      return { ...prev, [user]: merged };
    });
  }, []);

  // ---- LIVE mode: map an InitResponse onto the HUD state ----
  const applyInit = useCallback(
    (init: InitResponse, first: boolean) => {
      const { city } = init;
      const dayIncreased = !first && city.day > liveDayRef.current;
      liveDayRef.current = city.day;
      liveCrisisIdRef.current = init.crisis.id;
      dayRef.current = city.day;
      prevDayRef.current = city.day; // keep the demo dawn-refresh effect quiet
      setDay(city.day);
      setVitals({
        FOOD: Math.round(city.food),
        POWER: Math.round(city.power),
        MEDICINE: Math.round(city.medicine),
        MORALE: Math.round(city.morale),
        THREAT: Math.round(city.threat),
        DEFENSE: Math.round(city.defense),
      });
      setPopulation(city.population);
      setLiveCrisis(init.crisis);
      setLiveCrisisVotes(init.crisisVotes);
      setLiveMyVote(init.yourCrisisVote);
      setLiveStrategyVotes(init.strategyVotes);
      setLiveMyPlan(init.yourStrategyVote);
      setLiveMarked(init.marked);
      setLivePledge(init.pledge);
      setLiveEnergy({ effective: init.effectiveEnergy, used: init.player.energyUsedToday });
      setLiveActions(init.yourActionsToday);
      setLiveStanding(init.standing);
      setLiveCycle(city.cycle);
      setLiveRaidLikely(init.forecast.raidLikely);
      setLiveBuild(init.build ?? null); // defensive: server lane owns this field
      setLiveRaidNote(raidNoteFromEvents(init.timelinePreview?.events, init.forecast.raidLikely));
      setLiveTimelineHeadline(init.timelinePreview?.headline ?? null);
      // fallen-city terminal state — mirror to a ref so handlers/timers can read it
      const fallen = city.status === 'fallen';
      cityFallenRef.current = fallen;
      setCityFallen(fallen);
      // first-run onboarding: a brand-new player has no role yet. Open on first
      // load (never re-open after they've dismissed/entered this session).
      if (first && init.player.role === null) {
        setNeedsOnboard(true);
        setOnboardOpen(true);
      }
      raidDaysRef.current = init.raidInDays;
      setRaidDays(init.raidInDays);
      // events feed: seed from the drama feed, then append only unseen lines
      for (const d of [...init.drama].reverse()) {
        const dk = `${d.icon}|${d.text}`;
        if (seenDramaRef.current.has(dk)) continue;
        seenDramaRef.current.add(dk);
        pushEvent(d.icon, d.text);
      }
      if (first && init.marked.savedYesterday) {
        const s = init.marked.savedYesterday;
        pushEvent('🕯️', s.saved ? `${s.name} was saved before dawn.` : `${s.name} was lost in the night.`);
      }
      if (init.dawnReport) {
        setDawnReport(init.dawnReport);
        if ((first && init.firstVisitToday) || dayIncreased) {
          setDawnTeaserOpen(true);
          playSound('dawn_report');
        }
      }
      if (dayIncreased) {
        pushNotif('🌅', `dawn breaks — day ${city.day}`);
        pushEvent('🌅', `Dawn broke over the city — day ${city.day}, still standing.`);
        // last night's raid, if the timeline recorded one
        const t = init.timelinePreview;
        if (t && (t.deltas.population ?? 0) < 0 && t.events.some((e) => /raid|red signal/i.test(e))) {
          const line = t.events.find((e) => /raid|red signal/i.test(e)) ?? 'Raiders came in the night.';
          pushNotif('⚔', line, 'bad');
          pushEvent('⚔', line);
        }
      }
    },
    [pushEvent, pushNotif],
  );

  // Boot: one real /api/init decides the mode. Success = LIVE (the shared city
  // is truth, local sims stay off). Dev harness failures can still show DEMO;
  // production failures stop on an explicit offline/login state.
  useEffect(() => {
    let cancelled = false;
    getInit()
      .then((init) => {
        if (cancelled) return;
        setApiError(null);
        setMode('live');
        modeRef.current = 'live';
        applyInit(init, true);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof ApiFailure ? err.message : 'The city API could not be reached.';
        const localHarness = isLocalHarnessHost(window.location.hostname);
        if (localHarness) {
          setApiError(null);
          setMode('demo');
          modeRef.current = 'demo';
          pushNotif('⚠️', 'dev demo mode — live API unavailable', 'bad');
        } else {
          setApiError(message);
          setMode('offline');
          modeRef.current = 'offline';
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyInit, pushNotif]);

  // ---- V1 sound cues (local files, fail-silent; mute persists in localStorage) ----
  useEffect(() => {
    preloadSounds();
  }, []);
  // Boolean state → the effect only re-fires on a real transition (no repeat on poll).
  useEffect(() => {
    if (cityFallen) playSound('city_fallen');
  }, [cityFallen]);
  useEffect(() => {
    if (liveRaidLikely) playSound('raid_warning');
  }, [liveRaidLikely]);
  const onToggleMute = useCallback(() => {
    const next = toggleMuted();
    setMutedUi(next);
    if (!next) playSound('button_click'); // give audible feedback only when unmuting
  }, []);

  // WORLD map (live): real cities from /api/world; any failure or an
  // ineligible sub falls back to the fictional charts with a caption.
  const refreshWorld = useCallback(() => {
    getWorld()
      .then((w) => {
        const unavailable = worldUnavailableMessage({
          eligible: w.eligible,
          subscribers: w.subscribers,
          minSubscribers: w.minSubscribers,
          cityCount: w.cities.length,
        });
        if (unavailable) {
          setWorldCities(null);
          setWorldNote(unavailable);
        } else {
          setWorldCities(w.cities);
          setWorldNote(null);
        }
      })
      .catch(() => {
        setWorldCities(null);
        setWorldNote('The world registry could not be reached. Your city is still playable.');
      });
  }, []);

  const refreshLb = useCallback(() => {
    getLeaderboard()
      .then((r) => setLiveLb(r.contributors))
      .catch(() => {
        // keep the last leaderboard on a transient failure
      });
  }, []);

  // First open of the WORLD map / TOP tab in live mode triggers the fetch;
  // afterwards the 30s poll refreshes whichever is on screen.
  useEffect(() => {
    if (mode !== 'live') return;
    if (dashTab === 'map' && mapView === 'world' && !worldFetchedRef.current) {
      worldFetchedRef.current = true;
      refreshWorld();
    }
    if (dashTab === 'top' && !lbFetchedRef.current) {
      lbFetchedRef.current = true;
      refreshLb();
    }
  }, [mode, dashTab, mapView, refreshWorld, refreshLb]);
  useEffect(() => {
    if (mode !== 'live' || !statsOpen || lbFetchedRef.current) return;
    lbFetchedRef.current = true;
    refreshLb();
  }, [mode, statsOpen, refreshLb]);

  // Poll the real game every 30s so other players' votes/pledges/actions (and
  // the next dawn) show up. Skipped while one of our own POSTs is in flight.
  useEffect(() => {
    if (mode !== 'live') return undefined;
    const id = window.setInterval(() => {
      if (mutatingRef.current) return;
      getInit()
        .then((init) => {
          applyInit(init, false);
          if (dashTabRef.current === 'map' && mapViewRef.current === 'world') refreshWorld();
          if (dashTabRef.current === 'top') refreshLb();
        })
        .catch(() => {
          // transient poll failure — keep showing the last known state
        });
    }, 30000);
    return () => window.clearInterval(id);
  }, [mode, applyInit, refreshWorld, refreshLb]);

  // ---- LIVE mode mutations (each guards the poll + double-taps via mutatingRef) ----
  const toastFailure = useCallback(
    (err: unknown, fallback: string) => {
      playSound('error_soft');
      popToast(err instanceof ApiFailure ? err.message : fallback);
    },
    [popToast],
  );

  const onLiveVote = useCallback(
    (optionId: string) => {
      if (cityFallenRef.current || mutatingRef.current) return;
      mutatingRef.current = true;
      postVote(optionId, liveCrisisIdRef.current)
        .then((res) => {
          setLiveCrisisVotes(res.crisisVotes);
          setLiveMyVote(res.yourCrisisVote);
          playSound('vote_cast');
          pushNotif('🗳️', 'your vote is in', 'good');
        })
        .catch((err) => toastFailure(err, 'vote failed — try again'))
        .finally(() => {
          mutatingRef.current = false;
        });
    },
    [pushNotif, toastFailure],
  );

  const onLivePledge = useCallback(
    (kind: PledgeKind) => {
      if (cityFallenRef.current || mutatingRef.current || !PLEDGE_KINDS.includes(kind)) return;
      mutatingRef.current = true;
      postPledge(kind)
        .then((res) => {
          setLiveMarked(res.marked);
          setLivePledge(res.pledge);
          playSound('pledge');
          pushNotif('🕯️', `you pledged for ${res.marked.name}`, 'good');
          handleRef.current?.pulseMarked?.();
        })
        .catch((err) => toastFailure(err, 'pledge failed — try again'))
        .finally(() => {
          mutatingRef.current = false;
        });
    },
    [pushNotif, toastFailure],
  );

  const onLiveStrategy = useCallback(
    (planId: string) => {
      const plan = STRATEGY_IDS.find((p) => p === planId);
      if (cityFallenRef.current || !plan || mutatingRef.current) return;
      mutatingRef.current = true;
      postStrategy(plan)
        .then((res) => {
          setLiveStrategyVotes(res.strategyVotes);
          setLiveMyPlan(res.yourStrategyVote);
          playSound('vote_cast');
          pushNotif('📜', 'the council heard you', 'good');
        })
        .catch((err) => toastFailure(err, 'the council is busy — try again'))
        .finally(() => {
          mutatingRef.current = false;
        });
    },
    [pushNotif, toastFailure],
  );

  // First-run onboarding submit: set the role, optionally name the survivor,
  // then refresh from the server. 400/401 keeps the overlay open with a toast.
  const onEnterCity = useCallback(
    (role: Role, name: string) => {
      if (onboardBusy || mutatingRef.current) return;
      const trimmed = name.trim();
      const letters = (trimmed.match(/\p{L}/gu) ?? []).length;
      setOnboardBusy(true);
      mutatingRef.current = true;
      const roleLabel = ROLE_CATALOG.find((r) => r.id === role)?.label ?? role;
      postRole(role)
        .then(async () => {
          if (letters >= 2) {
            await postAvatar({ name: trimmed, gender: 'nonbinary', skin: 0, hair: 0, hairStyle: 0, outfit: 0 });
          }
          pushNotif('🫡', `role set — ${roleLabel}`, 'good');
          setOnboardOpen(false);
          setNeedsOnboard(false);
          // pull fresh player-derived state from the server
          const init = await getInit();
          applyInit(init, false);
        })
        .catch((err) => toastFailure(err, 'could not set your role — try again'))
        .finally(() => {
          setOnboardBusy(false);
          mutatingRef.current = false;
        });
    },
    [onboardBusy, applyInit, pushNotif, toastFailure],
  );
  const dismissOnboard = useCallback(() => {
    setOnboardOpen(false);
    setNeedsOnboard(false);
  }, []);

  // ADD LABOR — the shared "build from zero" contribution. Live: post the
  // energy-gated once/day build_city action, then re-fetch to pull the fresh
  // community progress. Demo: advance the local meter and unlock buildings on
  // the same thresholds so the panel + scene animate without a server.
  const onAddLabor = useCallback(() => {
    if (modeRef.current === 'live') {
      if (cityFallenRef.current || mutatingRef.current) return;
      const nextName = liveBuildRef.current?.next?.name ?? 'settlement';
      mutatingRef.current = true;
      postAction('build_city')
        .then(async () => {
          playSound('action_confirm');
          pushNotif('🔨', `you added a day's labor to the ${nextName}`, 'good');
          const init = await getInit();
          applyInit(init, false);
        })
        .catch((err) => toastFailure(err, 'could not add labor — try again'))
        .finally(() => {
          mutatingRef.current = false;
        });
      return;
    }
    if (modeRef.current !== 'demo') return;
    const unlocked = demoUnlockedRef.current;
    const nextDef = BUILD_SEQUENCE[unlocked.length];
    if (!nextDef) return; // the city is fully built
    playSound('action_confirm');
    setDemoContributors((c) => c + 1);
    const progress = demoBuildProgressRef.current + BUILD_LABOR_STEP;
    if (progress >= nextDef.progressRequired) {
      const nextUnlocked = [...unlocked, nextDef.id];
      const carry = progress - nextDef.progressRequired;
      demoUnlockedRef.current = nextUnlocked;
      demoBuildProgressRef.current = carry;
      setDemoUnlocked(nextUnlocked);
      setDemoBuildProgress(carry);
      pushNotif('🏗️', `the ${nextDef.name} is built — we raised it together`, 'good');
    } else {
      demoBuildProgressRef.current = progress;
      setDemoBuildProgress(progress);
      pushNotif('🔨', `you added a day's labor to the ${nextDef.name}`, 'good');
    }
  }, [applyInit, pushNotif, toastFailure]);

  const onReady = useCallback((h: VillageHandle) => {
    handleRef.current = h;
  }, []);
  const onProgress = useCallback((p: number) => setPct(p), []);
  const onLoad = useCallback(() => setLoaded(true), []);
  const onSelect = useCallback((meta: BuildingMeta | null) => setSelected(meta), []);
  const onPois = useCallback((list: PoiInfo[]) => {
    poisRef.current = list;
    setPois(list);
    // seed the live level map from the scene directory (never clobber upgrades)
    setLevels((prev) => {
      const next = { ...prev };
      for (const p of list) if (next[p.name] === undefined) next[p.name] = p.level;
      return next;
    });
  }, []);

  // scene-generated villager chatter → the comments feed
  const onChat = useCallback(
    (who: string, text: string) => {
      pushTalk(who, text);
    },
    [pushTalk],
  );

  // scene reports a clicked villager (null = clicked empty ground) — selection
  // drives the bottom-left chip and re-targets SAY HI.
  const onVillager = useCallback((name: string | null) => {
    villagerRef.current = name;
    setVillager(name);
  }, []);

  // scene reports a placed hut → grow the city, spend food, exit build mode.
  // Live mode: the hut is purely cosmetic — city numbers belong to the server.
  const onBuilt = useCallback(
    (x: number, _z: number) => {
      if (modeRef.current !== 'live') {
        setPopulation((p) => p + 4);
        setVitals((v) => ({ ...v, FOOD: clampVit('FOOD', v.FOOD - 5) }));
        addContrib('u/you', { houses: 1 });
        pushEvent('🔨', `A new hut rose in the ${x < 0 ? 'west' : 'east'} quarter — a family moves in.`);
        pushNotif('🔨', 'a new hut — +4 souls', 'good');
        popToast('Hut raised — +4 souls');
      } else {
        pushEvent('🔨', `A new hut rose in the ${x < 0 ? 'west' : 'east'} quarter — a family moves in.`);
        pushNotif('🔨', 'a new hut rises (cosmetic)', 'good');
        popToast('Hut raised');
      }
      buildModeRef.current = false;
      setBuildMode(false);
      handleRef.current?.setBuildMode?.(false);
    },
    [addContrib, pushEvent, pushNotif, popToast],
  );

  // VILLAGERS are now PLAYERS — the walking count tracks the number of distinct
  // contributors (people who opted into the game), clamped to a sane range.
  // Live mode keeps a small constant crowd (the server has no walker roster).
  const playerCount = Object.keys(contribs).length;
  useEffect(() => {
    const n = mode === 'live' ? 5 : Math.max(3, Math.min(MAX_VILLAGERS, playerCount));
    handleRef.current?.setVillagers(n);
  }, [playerCount, loaded, mode]);

  // COMPANIONS are permanently on — sync all four once the scene is ready.
  useEffect(() => {
    const h = handleRef.current;
    if (!h) return;
    (COMPANIONS.map((c) => c.id) as CompanionKind[]).forEach((k) => h.setCompanion(k, true));
  }, [loaded]);

  // BUILD stage → the 3D scene reflects which buildings the community has raised.
  // Live: server unlocks. Demo: local unlocks. Both call the optional scene API
  // defensively (the scene lane may not have shipped setBuildStage yet).
  useEffect(() => {
    if (mode === 'live' && liveBuild) handleRef.current?.setBuildStage?.(liveBuild.unlocked);
  }, [mode, liveBuild, loaded]);
  useEffect(() => {
    if (mode === 'demo') handleRef.current?.setBuildStage?.(demoUnlocked);
  }, [mode, demoUnlocked, loaded]);

  const visitDistrict = useCallback((name: string) => {
    handleRef.current?.focusOn(name);
  }, []);

  // MAP: fetch the town schematic once loaded, then refetch on an interval to
  // pick up newly-bought houses. Guard for the scene API being absent.
  useEffect(() => {
    if (!loaded) return undefined;
    const fetchMap = () => {
      const md = handleRef.current?.getMapData?.() as MapData | undefined;
      if (md) setMapData(md);
    };
    fetchMap();
    const id = window.setInterval(fetchMap, 4000);
    return () => window.clearInterval(id);
  }, [loaded]);

  // MAP: poll the live camera view so the minimap can draw where it's looking.
  useEffect(() => {
    if (!loaded) return undefined;
    const id = window.setInterval(() => {
      const v = handleRef.current?.getView?.() as MapView | undefined;
      if (v) setView(v);
    }, 250);
    return () => window.clearInterval(id);
  }, [loaded]);

  const focusPoint = useCallback((x: number, z: number) => {
    handleRef.current?.focusPoint?.(x, z);
  }, []);

  // The day always turns — night → dawn → day → dusk, ~12s per phase. The
  // visual cycle runs in BOTH modes (the server has no time-of-day), but only
  // demo mode lets a dawn transition advance the day counter — in live mode
  // the day is the server's.
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = TIME_ORDER[(TIME_ORDER.indexOf(timeRef.current) + 1) % TIME_ORDER.length]!;
      timeRef.current = next;
      setTimeState(next);
      handleRef.current?.setTimeOfDay(next);
      if (next === 'dawn' && modeRef.current === 'demo') {
        dayRef.current += 1;
        setDay(dayRef.current);
        pushEvent('🌅', `Dawn broke over the city — day ${dayRef.current}, still standing.`);
        pushNotif('🌅', `dawn breaks — day ${dayRef.current}`);
      }
    }, 12000);
    return () => window.clearInterval(id);
  }, [pushEvent, pushNotif]);

  // New dawn → the daily actions refresh (skip the initial render). Demo only:
  // in live mode `yourActionsToday`/energy come back fresh from the server.
  useEffect(() => {
    if (mode !== 'demo') {
      prevDayRef.current = day;
      return;
    }
    if (day === prevDayRef.current) return;
    prevDayRef.current = day;
    usedRef.current = {};
    setUsed({});
    pushNotif('🌅', 'new dawn — actions refreshed');
  }, [day, mode, pushNotif]);

  // LIVE tab handlers — one pledge / one crisis vote per "day" (session).
  const onPledge = useCallback(() => {
    if (pledgedRef.current) return;
    pledgedRef.current = true;
    setPledged((p) => Math.min(MARKED_GOAL, p + 3));
    setPledgedToday(true);
    // optional scene API (added by another agent) — never crash if absent
    handleRef.current?.pulseMarked?.();
  }, []);
  const onCrisisVote = useCallback((id: CrisisOptId) => {
    if (votedRef.current) return;
    votedRef.current = true;
    setMyCrisisVote(id);
    setCrisisVotes((v) => ({ ...v, [id]: v[id] + 1 }));
  }, []);

  // SAY HI — post to the comments, wave in the scene, get a scripted reply.
  // With a villager selected the greeting is tagged and THEY answer; otherwise
  // the old random-reply rotation plays out.
  const onSayHi = useCallback(() => {
    if (hiCooldownRef.current) return;
    hiCooldownRef.current = true;
    setHiCooldown(true);
    const target = villagerRef.current;
    if (hiReplyTimerRef.current !== null) window.clearTimeout(hiReplyTimerRef.current);
    if (target) {
      pushTalk('u/you', `@${target} hii 👋`, true);
      handleRef.current?.sayTo?.(target, 'hii 👋');
      hiReplyTimerRef.current = window.setTimeout(() => {
        pushTalk(target, 'hii 👋 good to see you');
        handleRef.current?.waveAt?.(target);
        pushNotif('💬', `${target} waved back!`, 'good');
      }, 2500);
    } else {
      pushTalk('u/you', 'hii 👋', true);
      handleRef.current?.say?.('hii 👋');
      const reply = HI_REPLIES[hiReplyIdxRef.current % HI_REPLIES.length]!;
      hiReplyIdxRef.current += 1;
      hiReplyTimerRef.current = window.setTimeout(() => {
        pushTalk(reply.who, reply.text);
        handleRef.current?.say?.(reply.text);
        pushNotif('💬', `${reply.who} replied`, 'good');
      }, 2500);
    }
    if (hiCooldownTimerRef.current !== null) window.clearTimeout(hiCooldownTimerRef.current);
    hiCooldownTimerRef.current = window.setTimeout(() => {
      hiCooldownRef.current = false;
      setHiCooldown(false);
    }, 6000);
  }, [pushTalk, pushNotif]);

  // villager chip actions — wave at / deselect the clicked villager
  const onWaveAt = useCallback(() => {
    const target = villagerRef.current;
    if (!target) return;
    handleRef.current?.waveAt?.(target);
    pushTalk('u/you', `waved at ${target} 👋`, true);
  }, [pushTalk]);
  const clearVillager = useCallback(() => {
    villagerRef.current = null;
    setVillager(null);
  }, []);

  // BUILD — toggle placement mode in the scene (fallback toast if the scene
  // API isn't there yet).
  const toggleBuild = useCallback(() => {
    const h = handleRef.current;
    if (!h?.setBuildMode) {
      popToast('Building placement — coming soon');
      return;
    }
    const on = !buildModeRef.current;
    buildModeRef.current = on;
    setBuildMode(on);
    h.setBuildMode?.(on);
  }, [popToast]);

  // UPGRADE — bump a district's level for food; flash it in the scene.
  const onUpgrade = useCallback(
    (name: string) => {
      if (vitalsRef.current.FOOD < UPGRADE_COST) return;
      const n = (levelsRef.current[name] ?? 1) + 1;
      setLevels((prev) => ({ ...prev, [name]: n }));
      setVitals((v) => ({ ...v, FOOD: clampVit('FOOD', v.FOOD - UPGRADE_COST) }));
      handleRef.current?.flashDistrict?.(name);
      pushEvent('⬆', `${name} upgraded to LVL ${n}.`);
    },
    [pushEvent],
  );

  // DAWN ACTIONS — each spends once per day; refreshed by the day effect.
  // Live mode posts the real action instead: no optimistic vital bump (the next
  // poll brings the server truth), energy/counters from the response, 400/409
  // surfaced as a toast.
  const runAction = useCallback(
    (id: string) => {
      if (modeRef.current === 'live') {
        if (cityFallenRef.current) return;
        const act = ACTION_IDS.find((a) => a === id);
        if (!act || mutatingRef.current) return;
        mutatingRef.current = true;
        postAction(act)
          .then((res) => {
            setLiveEnergy({ effective: res.effectiveEnergy, used: res.player.energyUsedToday });
            setLiveActions(res.yourActionsToday);
            playSound('action_confirm');
            pushNotif('✅', 'your work lands at the next dawn', 'good');
            if (res.unlockedTitle) pushNotif('🏅', `title unlocked — ${res.unlockedTitle}`, 'good');
            const liveFrags = ACTION_FLASH[id] ?? [];
            const liveHit = poisRef.current.find((p) => liveFrags.some((f) => p.name.toUpperCase().includes(f)));
            if (liveHit) handleRef.current?.flashDistrict?.(liveHit.name);
          })
          .catch((err) => toastFailure(err, 'the action failed — try again'))
          .finally(() => {
            mutatingRef.current = false;
          });
        return;
      }
      if (usedRef.current[id]) return;
      if (!ACTIONS.some((a) => a.id === id)) return;
      usedRef.current = { ...usedRef.current, [id]: true };
      setUsed(usedRef.current);
      if (id === 'grow_food') {
        setVitals((v) => ({ ...v, FOOD: clampVit('FOOD', v.FOOD + 3) }));
        addContrib('u/you', { food: 3 });
        pushEvent('🌾', 'The growers coaxed 3 more food from the greenhouse beds.');
        pushNotif('🍞', 'Food grown — the greenhouse holds');
      } else if (id === 'repair_power') {
        setVitals((v) => ({ ...v, POWER: clampVit('POWER', v.POWER + 4) }));
        addContrib('u/you', { power: 4 });
        pushEvent('🔧', 'Hands on the generator through the morning — power steadies.');
        pushNotif('⚡', 'Generator steadied');
      } else if (id === 'treat_sick') {
        setVitals((v) => ({ ...v, MEDICINE: clampVit('MEDICINE', v.MEDICINE + 2) }));
        addContrib('u/you', { medicine: 2 });
        pushEvent('⛑️', 'The clinic worked the ward — the sick rest easier.');
        pushNotif('🩹', 'The sick rest easier');
      } else if (id === 'guard_wall') {
        setVitals((v) => ({
          ...v,
          THREAT: clampVit('THREAT', v.THREAT - 5),
          DEFENSE: clampVit('DEFENSE', v.DEFENSE + 2),
        }));
        pushEvent('🛡️', 'Extra watch posted on the wall — the raiders keep their distance.');
        pushNotif('🛡️', 'The wall holds');
      }
      // flash the matching district if the scene labeled one
      const frags = ACTION_FLASH[id] ?? [];
      const hit = poisRef.current.find((p) => frags.some((f) => p.name.toUpperCase().includes(f)));
      if (hit) handleRef.current?.flashDistrict?.(hit.name);
    },
    [addContrib, pushEvent, pushNotif],
  );

  // Demo-only SCAVENGE — live V1 never opens this flow.
  const runScavenge = useCallback(
    (id: RouteId) => {
      if (modeRef.current === 'live') return;
      if (scoutingRef.current) return;
      const route = ROUTES.find((r) => r.id === id);
      if (!route) return;
      scoutingRef.current = true;
      setScouting(true);
      setScavOpen(false);
      pushNotif('🧭', 'a scout slips out the gate…');
      scoutTimerRef.current = window.setTimeout(() => {
        scoutingRef.current = false;
        setScouting(false);
        const hurt = route.id === 'deep' && Math.random() < 0.25;
        setVitals((v) => ({
          ...v,
          FOOD: clampVit('FOOD', v.FOOD + route.food),
          ...(hurt ? { MEDICINE: clampVit('MEDICINE', v.MEDICINE - 4) } : {}),
        }));
        if (hurt) pushNotif('🩹', 'the scout came back hurt', 'bad');
        if (route.id === 'desperate' && Math.random() < 0.35) {
          setPopulation((p) => Math.max(0, p - 1));
          pushNotif('☠️', "a scout didn't come back", 'bad');
        }
        addContrib('u/you', { food: route.food });
        pushNotif('🎒', `the scout returns — +${route.food} food`, 'good');
        pushEvent('🎒', `A scout came back from the ${route.title} with ${route.food} food.`);
      }, route.dur);
    },
    [addContrib, pushEvent, pushNotif],
  );

  // record a resolved raid in the ledger (losses = the ones actually applied)
  const logRaid = useCallback((outcome: 'held' | 'breach') => {
    const key = raidLogKeyRef.current;
    raidLogKeyRef.current += 1;
    const loss = outcome === 'held' ? { souls: 0, food: 6, defense: 8 } : { souls: 8, food: 18, defense: 15 };
    setRaidLog((prev) => [{ day: dayRef.current, outcome, ...loss, key }, ...prev].slice(0, 12));
  }, []);

  // RAID — 9s of dread, then the wall decides on CURRENT defense.
  const startRaid = useCallback(() => {
    if (raidPhaseRef.current !== 'idle') return;
    raidPhaseRef.current = 'incoming';
    setRaidPhase('incoming');
    pushNotif('⚔', 'RAID — raiders are at the gate!', 'bad');
    handleRef.current?.setRaidWatch?.(true);
    handleRef.current?.setRaiders?.(true); // raider party appears at the gate
    raidTimersRef.current.push(
      window.setTimeout(() => {
        const held = vitalsRef.current.DEFENSE >= 40;
        if (held) {
          setVitals((v) => ({
            ...v,
            THREAT: clampVit('THREAT', 30),
            DEFENSE: clampVit('DEFENSE', v.DEFENSE - 8),
            FOOD: clampVit('FOOD', v.FOOD - 6),
          }));
          pushEvent('🛡', 'The raiders broke on the south wall. The city holds.');
          pushNotif('🛡', 'the wall held', 'good');
          logRaid('held');
          raidPhaseRef.current = 'held';
          setRaidPhase('held');
        } else {
          setPopulation((p) => Math.max(0, p - 8));
          setVitals((v) => ({
            ...v,
            THREAT: clampVit('THREAT', 45),
            DEFENSE: clampVit('DEFENSE', v.DEFENSE - 15),
            FOOD: clampVit('FOOD', v.FOOD - 18),
            MORALE: clampVit('MORALE', v.MORALE - 10),
          }));
          pushEvent('🔥', 'Raiders breached the gate before the watch pushed them out.');
          pushNotif('🔥', 'the wall was breached — 8 souls lost', 'bad');
          logRaid('breach');
          raidPhaseRef.current = 'breach';
          setRaidPhase('breach');
        }
        // result banner lingers 6s, then the countdown resets
        raidTimersRef.current.push(
          window.setTimeout(() => {
            raidPhaseRef.current = 'idle';
            setRaidPhase('idle');
            handleRef.current?.setRaidWatch?.(false);
            handleRef.current?.setRaiders?.(false); // the raiders melt away
            raidDaysRef.current = 5;
            setRaidDays(5);
          }, 6000),
        );
      }, 9000),
    );
  }, [pushEvent, pushNotif, logRaid]);

  // SUBREDDIT SIMULATION — a community member buys a house (scene API, added
  // by another agent) or gifts resources into the city stores.
  const simBuyHouse = useCallback(
    (user: string) => {
      // optional scene API — returns where the house rose, or null if full
      const spot = handleRef.current?.buyHouse?.(user) as { x: number; z: number; quarter: string } | null | undefined;
      if (!spot) return; // town full (or scene API absent) — skip silently
      setPopulation((p) => p + 3);
      addContrib(user, { houses: 1 });
      pushNotif('🏠', `${user} bought a house in the ${spot.quarter} quarter`, 'good');
      pushEvent('🏠', `${user} bought a house in the ${spot.quarter} quarter`);
    },
    [addContrib, pushEvent, pushNotif],
  );
  const simContribute = useCallback(
    (user: string) => {
      const gift = GIFTS[Math.floor(Math.random() * GIFTS.length)]!;
      const n = gift.min + Math.floor(Math.random() * (gift.max - gift.min + 1));
      setVitals((v) => ({ ...v, [gift.vit]: clampVit(gift.vit, v[gift.vit] + n) }));
      const patch: ContribPatch = gift.k === 'food' ? { food: n } : gift.k === 'power' ? { power: n } : { medicine: n };
      addContrib(user, patch);
      pushNotif('🎁', `${user} contributed ${n} ${gift.k}`);
      pushEvent('🎁', `${user} contributed ${n} ${gift.k}`);
    },
    [addContrib, pushEvent, pushNotif],
  );
  // one tick: random member, 40% house purchase / 60% resource gift
  const simTick = useCallback(
    (user?: string) => {
      const u = user ?? SUB_USERS[Math.floor(Math.random() * SUB_USERS.length)]!;
      if (Math.random() < 0.4) simBuyHouse(u);
      else simContribute(u);
    },
    [simBuyHouse, simContribute],
  );
  // the subreddit stirs every ~11s — DEMO only; in live mode the real city's
  // numbers belong to the server, so the local sim must never touch them.
  useEffect(() => {
    if (mode !== 'demo') return undefined;
    const id = window.setInterval(() => simTick(), 11000);
    return () => window.clearInterval(id);
  }, [mode, simTick]);

  // LIVE tab simulation — every number drifts on its own clock:
  //   pledges +1 / ~7s · crisis votes +1 / ~9s · council votes +1 / ~11s ·
  //   raid countdown −1 / 48s (threat creeps +2 per tick; at 0 the raid plays
  //   out) · event feed rotates / ~8s · ambient vitals drift / 20s ·
  //   a survivor reaches the gate / ~25s.
  // DEMO only — in live mode every one of these numbers is the server's truth.
  useEffect(() => {
    if (mode !== 'demo') return undefined;
    const ids: number[] = [
      window.setInterval(() => setPledged((p) => Math.min(MARKED_GOAL, p + 1)), 7000),
      window.setInterval(() => {
        const id = CRISIS_IDS[Math.floor(Math.random() * CRISIS_IDS.length)]!;
        setCrisisVotes((v) => ({ ...v, [id]: v[id] + 1 }));
      }, 9000),
      window.setInterval(() => {
        const id = PLAN_IDS[Math.floor(Math.random() * PLAN_IDS.length)]!;
        setCouncilVotes((v) => ({ ...v, [id]: v[id] + 1 }));
      }, 11000),
      window.setInterval(() => {
        setVitals((v) => ({ ...v, THREAT: clampVit('THREAT', v.THREAT + 2) }));
        if (raidPhaseRef.current !== 'idle') return; // a raid is already playing out
        const d = raidDaysRef.current - 1;
        if (d <= 0) {
          raidDaysRef.current = 0;
          setRaidDays(0);
          startRaid();
        } else {
          raidDaysRef.current = d;
          setRaidDays(d);
        }
      }, 48000),
      window.setInterval(() => {
        const idx = nextEvRef.current;
        nextEvRef.current = idx + 1;
        const src = DRAMA[idx % DRAMA.length]!;
        pushEvent(src.icon, src.text);
      }, 8000),
      // ambient vitals drift: food −1..+2, power ±1, clamped ≥ 0
      window.setInterval(() => {
        setVitals((v) => ({
          ...v,
          FOOD: clampVit('FOOD', v.FOOD + (Math.floor(Math.random() * 4) - 1)),
          POWER: clampVit('POWER', v.POWER + (Math.random() < 0.5 ? -1 : 1)),
        }));
      }, 20000),
      // a survivor reaches the gate every ~25s
      window.setInterval(() => {
        setPopulation((p) => p + 1);
        pushEvent('🚶', 'a survivor reaches the gate');
        pushNotif('🚶', 'a survivor reached the gate');
      }, 25000),
    ];
    return () => ids.forEach((id) => window.clearInterval(id));
  }, [mode, pushEvent, pushNotif, startRaid]);

  // one-shot timers (say-hi reply/cooldown, toast, raid sequence, notification
  // dismissals, scout return) — swept on unmount
  useEffect(
    () => () => {
      if (hiReplyTimerRef.current !== null) window.clearTimeout(hiReplyTimerRef.current);
      if (hiCooldownTimerRef.current !== null) window.clearTimeout(hiCooldownTimerRef.current);
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      if (scoutTimerRef.current !== null) window.clearTimeout(scoutTimerRef.current);
      raidTimersRef.current.forEach((id) => window.clearTimeout(id));
      raidTimersRef.current = [];
      notifTimersRef.current.forEach((id) => window.clearTimeout(id));
      notifTimersRef.current = [];
    },
    [],
  );

  // Raid watch ambience → optional scene API (defensive: the handle may not
  // have it). The active raid sequence drives setRaidWatch itself.
  useEffect(() => {
    if (raidPhaseRef.current !== 'idle') return;
    const h = handleRef.current;
    if (raidDays <= 1) h?.setRaidWatch?.(true);
    else if (raidDays >= 5) h?.setRaidWatch?.(false);
  }, [raidDays, loaded]);

  // QA hooks: window.__omdDemo.raidNow() / .build() / .sayHi() /
  // .selectVillager(name) / .action(id) / .scavenge(routeId) /
  // .contribute(user?) / .buyHouse(user?) / .stats()
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__omdDemo = {
      raidNow: () => {
        raidDaysRef.current = 0;
        setRaidDays(0); // next countdown tick fires the raid
      },
      build: () => toggleBuild(),
      sayHi: () => onSayHi(),
      selectVillager: (n: string) => onVillager(n),
      action: (id: string) => runAction(id),
      scavenge: (routeId: RouteId) => runScavenge(routeId),
      contribute: (user?: string) => simTick(user),
      buyHouse: (user?: string) => simBuyHouse(user ?? SUB_USERS[Math.floor(Math.random() * SUB_USERS.length)]!),
      flyTo: (name: string) => handleRef.current?.focusOn(name),
      mapTab: () => setDashTab('map'),
      world: () => setMapView('world'),
      stats: () => setStatsOpen((o) => !o),
      onboard: () => {
        setNeedsOnboard(true);
        setOnboardOpen(true);
      },
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__omdDemo;
    };
  }, [toggleBuild, onSayHi, onVillager, runAction, runScavenge, simTick, simBuyHouse]);

  // YOUR CITY's world-map status reflects live vitals + raid state.
  const worldYouStatus: WorldStatus =
    raidPhase === 'incoming'
      ? 'under_raid'
      : vitals.MORALE < 25 || vitals.FOOD < 60
        ? 'strained'
        : vitals.MORALE > 60 && vitals.DEFENSE > 55
          ? 'thriving'
          : 'holding';

  // ---- derived render values (live vs demo) ----
  const isLive = mode === 'live';
  const subtitle = isLive
    ? (liveStanding?.rankLabel ?? `cycle ${liveCycle} · the last city`)
    : mode === 'demo'
      ? '3D town · demo mode'
      : mode === 'offline'
        ? 'live city unavailable'
        : 'connecting to the city';
  const vitalMaxes = isLive ? LIVE_VITAL_MAX : VITAL_MAX;
  const energyLeft = Math.max(0, liveEnergy.effective - liveEnergy.used);
  const liveLeaderboard = isLive ? liveLb : null;

  // The LIVE tab's real-backend payload — null until the first /api/init lands,
  // which keeps the demo rendering (fictional crisis/marked/council) untouched.
  const liveData: LiveData | null =
    isLive && liveCrisis && liveMarked && livePledge
      ? {
          markedIcon: MARKED_ICONS[liveMarked.kind],
          markedName: liveMarked.name,
          markedBlurb: liveMarked.blurb,
          markedGoal: liveMarked.goal,
          markedUnit: liveMarked.unit,
          pledgeOptions: livePledge.options.map((o) => ({ id: o.id, icon: o.icon, label: o.label })),
          onPledgeKind: onLivePledge,
          crisisTitle: liveCrisis.title,
          crisisNarrative: liveCrisis.narrative,
          crisisOptions: liveCrisis.options.map((o) => ({ id: o.id, label: o.label, fx: fmtDelta(o.effects) })),
          crisisVotes: liveCrisisVotes,
          myVote: liveMyVote,
          onVote: onLiveVote,
          plans: (Object.keys(liveStrategyVotes).length ? Object.keys(liveStrategyVotes) : STRATEGY_IDS).map((id) => ({
            id,
            nm: PLAN_LABELS[id] ?? id,
            votes: liveStrategyVotes[id] ?? 0,
          })),
          myPlan: liveMyPlan,
          onPlan: onLiveStrategy,
          raidLikely: liveRaidLikely,
          raidNote: liveRaidNote,
          hasDawnReport: dawnReport !== null,
          onOpenDawn: () => setDawnOpen(true),
        }
      : null;
  // In live mode the Marked count/goal come from the server (via liveData); the
  // pledged/pledgedToday the LiveTab reads for the bar come from live state too.
  const shownPledged = isLive && liveMarked ? liveMarked.pledged : pledged;
  const shownPledgedToday = isLive && livePledge ? livePledge.usedToday : pledgedToday;

  // Fallen-city terminal state (live only): while it shows, all action surfaces
  // are suppressed and the epitaph is the freshest timeline headline (falling
  // back to the newest event line, then a default).
  const showFallen = isLive && cityFallen;
  const fallenEpitaph = liveTimelineHeadline ?? events[0]?.text ?? 'The lights went out before dawn.';
  const showOnboard = isLive && needsOnboard && onboardOpen && !showFallen;
  // Actions are dead while fallen: hide the hotbar, build dock, and dawn teaser.
  const showActionSurfaces = !showFallen;

  // BUILD FROM ZERO — the panel's state: server truth in live, local synth in
  // demo, nothing in offline/connecting.
  const build: BuildStatus | null = isLive
    ? liveBuild
    : mode === 'demo'
      ? demoBuildStatus(demoUnlocked, demoBuildProgress, demoContributors)
      : null;
  const buildYouBuiltToday = isLive ? (liveBuild?.youBuiltToday ?? false) : false;
  const buildNoEnergy = isLive && energyLeft <= 0;
  const buildCtaDisabled = showFallen || buildYouBuiltToday || buildNoEnergy || (build?.next == null);
  const buildCtaLabel = buildYouBuiltToday ? '✓ built today' : '🔨 ADD LABOR';

  return (
    <>
      <VillageCanvas
        onReady={onReady}
        onProgress={onProgress}
        onLoad={onLoad}
        onSelect={onSelect}
        onPois={onPois}
        onChat={onChat}
        onBuilt={onBuilt}
        onVillager={onVillager}
      />
      <TopBar vitals={vitals} population={population} subtitle={subtitle} />
      <DayPill time={time} day={day} raidSoon={raidDays <= 1} raidActive={raidPhase === 'incoming'} />
      <NotifStack notifs={notifs} />
      <CityDashboard
        open={dashOpen}
        setOpen={setDashOpen}
        tab={dashTab}
        setTab={setDashTab}
        mapView={mapView}
        setMapView={setMapView}
        mapData={mapData}
        view={view}
        onFocusDistrict={visitDistrict}
        onFocusPoint={focusPoint}
        worldYouStatus={worldYouStatus}
        worldCities={worldCities}
        worldNote={worldNote}
        worldLive={isLive}
        pois={pois}
        levels={levels}
        vitals={vitals}
        vitalMaxes={vitalMaxes}
        selectedName={selected?.name ?? null}
        onVisit={visitDistrict}
        live={{
          pledged: shownPledged,
          pledgedToday: shownPledgedToday,
          onPledge,
          talk,
          hiCooldown,
          onSayHi,
          villager,
          crisisVotes,
          myCrisisVote,
          onCrisisVote,
          councilVotes,
          raidDays,
          events,
          liveData,
        }}
        contribs={contribs}
        lb={liveLeaderboard}
        build={build}
        onAddLabor={onAddLabor}
        buildCtaDisabled={buildCtaDisabled}
        buildCtaLabel={buildCtaLabel}
      />
      <button
        type="button"
        className="hud stats-fab card-bit"
        onClick={() => setStatsOpen((o) => !o)}
        aria-expanded={statsOpen}
      >
        📊 STATS
      </button>
      <button
        type="button"
        className="hud mute-fab card-bit"
        onClick={onToggleMute}
        aria-pressed={muted}
        aria-label={muted ? 'Unmute sound' : 'Mute sound'}
        title={muted ? 'Sound off' : 'Sound on'}
      >
        {muted ? '🔇' : '🔊'}
      </button>
      <StatsModal
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        day={day}
        vitals={vitals}
        population={population}
        pois={pois}
        levels={levels}
        contribs={contribs}
        raidLog={raidLog}
        youStatus={worldYouStatus}
        vitalMaxes={vitalMaxes}
        lb={liveLeaderboard}
        liveRaidLikely={liveRaidLikely}
        liveRaidNote={liveRaidNote}
      />
      {villager ? (
        <VillagerChip name={villager} hiCooldown={hiCooldown} onWave={onWaveAt} onSayHi={onSayHi} onClose={clearVillager} />
      ) : (
        <BuildingChip meta={selected} levels={levels} food={vitals.FOOD} onUpgrade={onUpgrade} live={isLive} />
      )}
      {!isLive && showActionSurfaces && <BuildDock buildMode={buildMode} onToggle={toggleBuild} toastText={toastText} toastOn={toastOn} />}
      <RaidBanner phase={raidPhase} />
      {mode === 'offline' && <OfflineNotice message={apiError} />}
      {showActionSurfaces && (
        <Hotbar
          used={used}
          onAction={runAction}
          scouting={scouting}
          scavOpen={scavOpen}
          onToggleScav={() => setScavOpen((o) => !o)}
          onScavenge={runScavenge}
          live={isLive}
          energyLeft={energyLeft}
          actionCounts={liveActions}
        />
      )}
      {showActionSurfaces && (
        <DawnReportTeaser
          report={dawnReport}
          show={dawnTeaserOpen && !dawnOpen}
          onDismiss={() => setDawnTeaserOpen(false)}
          onOpen={() => {
            setDawnTeaserOpen(false);
            setDawnOpen(true);
          }}
        />
      )}
      {showOnboard && <Onboarding busy={onboardBusy} onEnter={onEnterCity} onDismiss={dismissOnboard} />}
      {showFallen && (
        <FallenScreen
          epitaph={fallenEpitaph}
          survivalDays={liveStanding?.survivalDays ?? 0}
          population={population}
          cycle={liveCycle}
          day={day}
        />
      )}
      <DawnReportModal report={dawnReport} open={dawnOpen} onClose={() => setDawnOpen(false)} />
      {buildMode ? (
        <div className="hud build-hint card-bit">🔨 tap open ground to raise a hut · tap BUILD to cancel</div>
      ) : (
        <div className="hud hint card-bit">drag to pan · scroll / pinch to zoom · click a district</div>
      )}
      <div className="hud attrib">three.js example models · threejs.org</div>
      <Loader pct={pct} done={loaded} />
    </>
  );
}
