import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react';
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
import {
  ApiFailure,
  getInit,
  getChatter,
  getLeaderboard,
  getWorld,
  postAction,
  postAvatar,
  postLandDonate,
  postPledge,
  postRekindle,
  postRole,
  postShopEquip,
  postShopPurchase,
  postStrategy,
  postTreasuryInvest,
  postVote,
  postChatter,
} from './api';
import { isLocalHarnessHost, raidNoteFromEvents, raidOutcomeFromTimeline, worldUnavailableMessage } from './liveUi';
import { BALANCE } from '../shared/balance';
import { cityEpithet } from '../shared/cityName';
import {
  LAND_EXPANSIONS,
  SHOP_CATALOG,
  landExpansionState,
  type EconomyState,
  type LandExpansionId,
  type LandExpansionState,
  type ShopItemId,
} from '../shared/shop';
import type { TreasuryState } from '../shared/treasury';
import {
  CHATTER_CATEGORIES,
  CHATTER_MAX_LENGTH,
  type ChatterCategory,
  type ChatterState,
} from '../shared/chatter';
import { navigateTo } from '@devvit/web/client';
import { isMuted, playSound, preloadSounds, toggleMuted, unlockAudio } from './sound';
import { isMusicMuted, playTrack, refreshMusicVolume, stopMusic, toggleMusicMuted, unlockMusic } from './music';
import { getMasterVolume, setMasterVolume } from './audioSettings';
import type {
  ActionType,
  BuildingDef,
  BuildStatus,
  Crisis,
  DomeState,
  HouseSummary,
  DawnReport,
  InitResponse,
  RaidFireball,
  ReconstructionState,
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
import { tierForContribution } from '../shared/houses';

// ONE MORE DAWN — 3D town, React edition v4: the self-running mini-game.
// The scene runs itself (time cycles, companions on, players walk the streets).
// Right panel: MAP (town minimap + world map of rival cities), CITY dashboard
// (live vitals + district directory), LIVE (Marked, comments, crisis, council,
// raid watch, events), SHOP (house cosmetics + shared expansion), and TOP
// (contribution leaderboard). The city plays
// itself: vitals drift, survivors trickle in, days count up, raids arrive and
// resolve against your defense, and you can talk, build huts, upgrade districts.

const TIMES: { id: TimeOfDay; icon: string; label: string; tagline: string }[] = [
  { id: 'night', icon: '🌙', label: 'NIGHT', tagline: 'the city sleeps, dawn is coming' },
  { id: 'dawn', icon: '🌅', label: 'DAWN', tagline: 'dawn is coming, hold the line' },
  { id: 'day', icon: '☀️', label: 'DAY', tagline: 'the city works while the light lasts' },
  { id: 'dusk', icon: '🌇', label: 'DUSK', tagline: 'last light, count your stores' },
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
  thriving: { icon: '🌿', label: 'Thriving', color: '#7fd6a2', flavor: 'Holding the line, and then some.' },
  holding: { icon: '🕯️', label: 'Holding', color: '#ffcf70', flavor: 'Holding the line.' },
  strained: { icon: '🩸', label: 'Strained', color: '#ff8a3d', flavor: 'Rationing candles. Still standing.' },
  under_raid: { icon: '🚨', label: 'Under raid', color: '#ff5b4d', flavor: 'The dome decides tonight.' },
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

const EMPTY_ECONOMY: EconomyState = {
  coins: 0,
  earnedToday: 0,
  dailyCap: 5,
  owned: [],
  equipped: {},
};
const EMPTY_LAND = landExpansionState({});
const EMPTY_TREASURY: TreasuryState = {
  balance: 0,
  totalCollected: 0,
  totalInvested: 0,
  levyEvery: 10,
  yours: { progress: 0, backlog: 0, paid: 0 },
};
const DEMO_ECONOMY: EconomyState = {
  coins: 18,
  earnedToday: 2,
  dailyCap: 5,
  owned: ['hearth_lantern'],
  equipped: { light: 'hearth_lantern' },
};
const DEMO_LAND = landExpansionState({ outer_fields: 120, river_ward: 96 });
const EMPTY_RECONSTRUCTION: ReconstructionState = {
  active: false, required: 0, contributed: 0, destroyed: 0, damaged: 0, next: null,
};
const EMPTY_DOME: DomeState = {
  segments: [60, 60, 60, 60, 60, 60], energyPct: 60, shield: 0, repairThreshold: 12, nextRepairSegment: null,
};

// Sequence the siege SFX to track the dome cinematic: the warning bell, then per
// fireball an incoming whistle and either a shield-absorb (blocked) or a
// tearing pierce + impact (penetrated), and a final shatter/collapse/chime.
// Short fire-and-forget cues; a stray timer after unmount just calls playSound
// (a safe no-op). The volley is capped so a heavy raid never floods the mix.
function playRaidSfx(
  outcome: 'held' | 'breach' | 'fallen',
  fireballs: readonly RaidFireball[],
  homesLost: boolean,
): void {
  playSound('siege_bell');
  const base = 520;
  const step = 520;
  const shown = fireballs.slice(0, 6);
  shown.forEach((f, i) => {
    const t0 = base + i * step;
    window.setTimeout(() => playSound('fireball'), t0);
    window.setTimeout(() => playSound(f.blocked ? 'dome_block' : 'dome_pierce'), t0 + 330);
    if (!f.blocked) window.setTimeout(() => playSound('impact_hit'), t0 + 560);
  });
  const end = base + Math.max(1, shown.length) * step + 260;
  if (outcome === 'fallen') window.setTimeout(() => playSound('dome_shatter'), end);
  else if (homesLost) window.setTimeout(() => playSound('house_collapse'), end);
  else if (outcome === 'held') window.setTimeout(() => playSound('dawn_report'), end);
}
const DEMO_TREASURY: TreasuryState = {
  balance: 18,
  totalCollected: 42,
  totalInvested: 24,
  levyEvery: 10,
  yours: { progress: 6, backlog: 0, paid: 2 },
};

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

// Advisor coachmarks: four essentials after onboarding, then one-time lessons
// when the player first opens a deeper surface. The compass replays all ten.
const COACH_KEY = 'omd_coach_v1';
const COACH_CONTEXT_KEY = 'omd_coach_context_v1';
const INTRO_COACH_STEPS = 4;
const coachSeen = (): boolean => {
  try {
    return window.localStorage.getItem(COACH_KEY) === '1';
  } catch {
    return true; // storage unavailable — never nag
  }
};
const markCoachSeen = (): void => {
  try {
    window.localStorage.setItem(COACH_KEY, '1');
  } catch {
    /* storage unavailable */
  }
};
const contextualCoachSeen = (step: number): boolean => {
  try {
    return window.localStorage.getItem(`${COACH_CONTEXT_KEY}:${step}`) === '1';
  } catch {
    return true; // storage unavailable — never nag
  }
};
const markContextualCoachSeen = (step: number): void => {
  try {
    window.localStorage.setItem(`${COACH_CONTEXT_KEY}:${step}`, '1');
  } catch {
    /* storage unavailable */
  }
};
// The Advisor is a CHARACTER: Elder Maren, the city's keeper. Her portrait is
// smooth vector art so it stays crisp across Reddit webview densities, while
// still bobbing, blinking, talking, and pointing toward the surface she shows.
function AdvisorPortrait({
  talking,
  face,
  point,
}: {
  talking: boolean;
  face: 'left' | 'right' | 'front';
  point: 'up' | 'side' | null;
}) {
  return (
    <span className={`co-avatar-wrap face-${face}${talking ? ' talking' : ''}${point ? ` point-${point}` : ''}`}>
      <svg className="co-avatar" viewBox="0 0 72 92" width="66" height="84" aria-hidden="true">
        {/* hood and shoulders */}
        <path d="M9 88c1-17 8-27 18-31h20c10 4 16 14 17 31Z" fill="#332818" stroke="#786126" strokeWidth="1.5" />
        <path d="M15 52C10 35 15 14 30 7c12-6 25 2 29 15 3 9 1 22-3 31l-9 7H25Z" fill="#463817" stroke="#8b7027" strokeWidth="1.5" />
        <path d="M22 24c4-10 10-15 18-15 8 1 14 6 18 15-6-4-12-6-18-6-7 0-13 2-18 6Z" fill="#6b551d" />
        <path d="M17 53c4-4 7-7 9-12l2 17-8 13-8-5Z" fill="#241d14" opacity="0.78" />
        <path d="M55 53c-4-4-7-7-9-12l-2 17 8 13 8-5Z" fill="#241d14" opacity="0.78" />

        {/* silver hair and face */}
        <path d="M23 27c2-8 8-12 16-12 9 0 15 5 17 13l-5 6H27Z" fill="#c8c0b4" />
        <path d="M25 27c0-5 5-9 12-10-5 4-7 9-7 16l-6 8c-2-5-2-10 1-14Z" fill="#eee8dd" />
        <path d="M53 27c0-5-5-9-12-10 5 4 7 9 7 16l6 8c2-5 2-10-1-14Z" fill="#a69d92" />
        <path d="M27 28c1-6 6-9 12-9 7 0 12 4 13 10v13c0 12-6 20-13 20-8 0-14-8-14-20Z" fill="#dfbd91" stroke="#a37d55" strokeWidth="1.2" />
        <path d="M27 43c2 10 7 16 13 16 5 0 9-3 12-10-2 9-7 15-13 15-7 0-12-7-12-21Z" fill="#cda276" opacity="0.5" />
        <path d="M26 31c1-7 6-12 13-12 7 0 12 4 14 11-4-4-8-6-13-6-6 0-10 2-14 7Z" fill="#b8afa3" />
        <path d="M26 31c-2 5-2 11 0 17l4-5V29Z" fill="#e4ddd2" />
        <path d="M52 31c2 5 2 11 0 17l-4-5V29Z" fill="#aaa095" />

        {/* expressive features */}
        <path d="M29 36c2-2 5-2 7-1M42 35c2-1 5-1 7 1" fill="none" stroke="#785e45" strokeWidth="1.4" strokeLinecap="round" />
        <g className="co-eyes" fill="#2a2117">
          <ellipse cx="33" cy="39" rx="1.7" ry="1.35" />
          <ellipse cx="46" cy="39" rx="1.7" ry="1.35" />
          <circle cx="33.6" cy="38.6" r="0.38" fill="#fff6d9" />
          <circle cx="46.6" cy="38.6" r="0.38" fill="#fff6d9" />
        </g>
        <path d="M39 39c-1 4-2 7-1 8 1 1 3 1 4 0" fill="none" stroke="#ae825e" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M29 44c2 1 4 1 6 0M45 44c2 1 4 1 6-1" fill="none" stroke="#b68c66" strokeWidth="0.9" strokeLinecap="round" opacity="0.8" />
        <g className="co-mouth-closed">
          <path d="M35 52c3 2 6 2 9 0" fill="none" stroke="#7f4c42" strokeWidth="1.4" strokeLinecap="round" />
        </g>
        <g className="co-mouth-open">
          <ellipse cx="39.5" cy="53" rx="3.4" ry="2.2" fill="#623a35" />
          <path d="M37 53.7c1.5 0 3.4 0 5 .2" stroke="#d89386" strokeWidth="0.8" strokeLinecap="round" />
        </g>

        {/* cloak clasp and resting lantern */}
        <path d="M25 59l14 13 13-13 3 29H20Z" fill="#3a2c18" />
        <path d="M32 63l7 9 7-9-2 25H34Z" fill="#725b1f" />
        <circle cx="39" cy="69" r="3" fill="#d7ad35" stroke="#f2d56a" strokeWidth="1" />
        <g className="co-arm co-arm-side">
          <path d="M51 66c7 2 9 7 8 14" fill="none" stroke="#382b19" strokeWidth="7" strokeLinecap="round" />
          <circle cx="59" cy="78" r="2.4" fill="#d9b489" />
          <g className="co-halo"><circle cx="62" cy="84" r="9" fill="#e8c34a" opacity="0.24" /></g>
          <path d="M58 80h8l-1 9h-6Z" fill="#d59d2a" stroke="#f4da73" strokeWidth="1" />
          <path d="M59 80c0-5 6-5 6 0" fill="none" stroke="#85641f" strokeWidth="1.2" />
          <circle cx="62" cy="84" r="2.2" fill="#fff0a0" />
        </g>

        {/* raised arm and lantern used when Maren points upward */}
        <g className="co-arm co-arm-up">
          <path d="M51 65c6-8 7-17 5-25" fill="none" stroke="#382b19" strokeWidth="7" strokeLinecap="round" />
          <circle cx="56" cy="38" r="2.5" fill="#d9b489" />
          <g className="co-halo"><circle cx="58" cy="23" r="13" fill="#e8c34a" opacity="0.28" /></g>
          <path d="M53 17h10l-1 14h-8Z" fill="#d59d2a" stroke="#f4da73" strokeWidth="1.2" />
          <path d="M54 17c0-7 8-7 8 0" fill="none" stroke="#85641f" strokeWidth="1.4" />
          <path d="M56 20h4l1 8h-6Z" fill="#fff0a0" />
        </g>
      </svg>
      <span className={`co-point${point ? ` co-point-${point}` : ''}`} aria-hidden="true">
        {point ? '👉' : ''}
      </span>
    </span>
  );
}

// {CITY} in text is replaced with the city's ancient name at render time.
// `anchor` highlights that element with a ring; `go` drives the dashboard so
// the advisor SHOWS each surface while explaining it.
type CoachStep = {
  icon: string;
  title: string;
  text: string;
  anchor?: string;
  go?: { open?: boolean; tab?: DashTab };
};
type CoachFlow = 'intro' | 'context' | 'full';
const COACH_STEPS: CoachStep[] = [
  {
    icon: '🕯️',
    title: 'WELCOME, SURVIVOR',
    text: "I am Maren. I kept {CITY} standing before you came, and I'll show you how we keep it standing now. All of this belongs to everyone in this subreddit, and it remembers.",
    anchor: '.title',
    go: { open: false },
  },
  {
    icon: '📊',
    title: 'THE VITALS',
    text: 'Watch these as I do. Food, power, medicine, morale: the city consumes them every day. Threat climbs; defense holds it back. Let one reach zero and we lose people.',
    anchor: '.res',
    go: { open: false },
  },
  {
    icon: '📅',
    title: 'THE DAY',
    text: 'One real day is one of ours. The raid clock counts down here. The night it reaches zero, the wall decides who wakes at dawn.',
    anchor: '.day',
    go: { open: false },
  },
  {
    icon: '⚡',
    title: 'YOUR ENERGY',
    text: "Your strength for today. Spend it below: grow food, repair power, treat the sick, hold the wall. Whatever you choose, it lands at tomorrow's dawn.",
    anchor: '.hotbar',
    go: { open: false },
  },
  {
    icon: '📜',
    title: 'MY TASK FOR YOU',
    text: 'Each dawn I set you a mission of your own, no two neighbors share one. Finish it and your standing grows. A hundred levels await the faithful.',
    anchor: '.mission-chip',
    go: { open: false },
  },
  {
    icon: '▦',
    title: 'THE CITY PANEL',
    text: 'My map table. Tap a district to fly to it, or look at WORLD and see the other cities out there, each one another subreddit holding its own line. Tap a city to travel to it.',
    anchor: '.dash',
    go: { open: true, tab: 'map' },
  },
  {
    icon: '🔨',
    title: 'WE BUILD TOGETHER',
    text: 'Nothing stands unless we raise it. ADD LABOR fills the shared bar; when it fills, the next building rises at dawn. Shelter first. Council Hall last.',
    anchor: '.build-panel',
    go: { open: true, tab: 'city' },
  },
  {
    icon: '🗳️',
    title: 'WE DECIDE TOGETHER',
    text: "Here the city speaks: vote on today's crisis, back a council plan, and pledge for The Marked, one soul the night wants to take. One of each, every day.",
    anchor: '.dash',
    go: { open: true, tab: 'live' },
  },
  {
    icon: '🏆',
    title: 'THE RECORD',
    text: 'Those who give the most are remembered here. 📋 DASH keeps the ledger, 📊 STATS the full numbers, ⚙ the sound, music, and my guide. You now know every control I know.',
    anchor: '.fab-bar',
    go: { open: true, tab: 'top' },
  },
  {
    icon: '🏠',
    title: 'YOUR HOUSE',
    text: 'One last thing. Your first contribution raises YOUR house. The founder built first; every soul after adds their own. Come back at dawn. {CITY} remembers its builders.',
    anchor: '.title',
    go: { open: false },
  },
];

// Action juice: the icon floated above the hotbar when an action lands.
const ACTION_JUICE: Record<string, string> = {
  grow_food: '🌾',
  repair_power: '🔧',
  treat_sick: '⛑️',
  guard_wall: '🛡️',
  build_city: '🔨',
};

// Maren's dialogue chip, isolated so the 24ms typewriter tick re-renders ONLY
// this small subtree — never the whole App (which hosts the WebGL canvas HUD).
// Tapping NEXT mid-sentence completes her line; the next tap advances.
function CoachDialogue({
  step,
  stepIndex,
  total,
  cityName,
  aim,
  onNext,
  onDismiss,
}: {
  step: CoachStep;
  stepIndex: number;
  total: number;
  cityName: string;
  aim: { face: 'left' | 'right' | 'front'; point: 'up' | 'side' | null };
  onNext: () => void;
  onDismiss: () => void;
}) {
  const fullText = step.text.replace(/\{CITY\}/g, cityName);
  const [typed, setTyped] = useState(0);
  useEffect(() => {
    setTyped(0);
    const full = fullText.length;
    const id = window.setInterval(() => {
      setTyped((n) => {
        if (n + 2 >= full) {
          window.clearInterval(id);
          return full;
        }
        return n + 2;
      });
    }, 24);
    return () => window.clearInterval(id);
  }, [stepIndex, fullText.length]);
  const typing = typed < fullText.length;
  return (
    <div className="coach card-bit">
      <AdvisorPortrait talking={typing} face={aim.face} point={aim.point} />
      <div className="co-head">
        <span>
          {step.icon} MAREN · CITY ADVISOR · {step.title}
        </span>
        <button type="button" className="p-x" onClick={onDismiss} aria-label="Dismiss advisor">
          ✕
        </button>
      </div>
      <div className="co-body">
        {fullText.slice(0, typed)}
        {typing && <i className="co-caret">▌</i>}
      </div>
      <div className="co-foot">
        <span className="co-step">
          {stepIndex + 1}/{total}
        </span>
        <button
          type="button"
          className="co-next"
          onClick={() => {
            playSound('button_click');
            if (typing) {
              setTyped(fullText.length);
              return;
            }
            onNext();
          }}
        >
          {typing ? '»' : stepIndex + 1 < total ? 'NEXT →' : 'GOT IT'}
        </button>
      </div>
    </div>
  );
}

// First-run onboarding role catalog — icon/label/blurb, exact copy per spec.
const ROLE_CATALOG: { id: Role; icon: string; label: string; blurb: string }[] = [
  { id: 'scout', icon: '🧭', label: 'SCOUT', blurb: 'Tracks danger and helps the city read the map.' },
  { id: 'engineer', icon: '🔧', label: 'ENGINEER', blurb: 'Repair Power to raise your standing with the Builders.' },
  { id: 'medic', icon: '⛑️', label: 'MEDIC', blurb: 'Treat the Sick to raise your standing with the Hearth.' },
  { id: 'farmer', icon: '🌾', label: 'FARMER', blurb: 'Grow Food to feed the city and earn your title.' },
  { id: 'guard', icon: '🛡️', label: 'GUARD', blurb: 'Guard the Wall to raise your standing with the Wardens.' },
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
  { icon: '🕯️', text: 'ashen_fox stood vigil for Mira, the medics take heart.' },
  { icon: '⚔️', text: 'Raiders probed the North Wall at dusk. The watch held.' },
  { icon: '🎒', text: 'quiet_marrow crawled back from the deep ruins with 7 food.' },
  { icon: '🗳️', text: '25 citizens have voted on the Convoy at the Gate.' },
  { icon: '📜', text: 'The Council leans toward Prepare for Raid, 9 backers.' },
  { icon: '🩹', text: 'saltcedar treated the sick through the night shift.' },
  { icon: '🏚️', text: 'A rival city went dark last night. Theirs, not ours.' },
  { icon: '🌅', text: 'Dawn broke over the city, day 5, still standing.' },
];

// Scripted villager replies — rotates each use.
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
  { id: 'shelter', name: 'Shelter', description: 'First roofs against the cold, souls stop freezing.', progressRequired: 24, effect: 'survivors stay' },
  { id: 'farm', name: 'Farm', description: 'Worked beds, food grows faster.', progressRequired: 30, effect: '+3 food/day' },
  { id: 'clinic', name: 'Clinic', description: 'A ward for the sick, medicine goes further.', progressRequired: 34, effect: '+2 medicine/day' },
  { id: 'watchtower', name: 'Watchtower', description: 'Eyes on the horizon, raiders lose the surprise.', progressRequired: 30, effect: '−threat at dawn' },
  { id: 'storehouse', name: 'Storehouse', description: 'Dry stores, less waste, deeper reserves.', progressRequired: 28, effect: '+food capacity' },
  { id: 'wall', name: 'Wall', description: 'Stone around the camp, the wall holds far longer.', progressRequired: 40, effect: '+defense' },
  { id: 'council_hall', name: 'Council Hall', description: 'A place to decide together, the city endures.', progressRequired: 44, effect: 'the city endures' },
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

function TopBar({ vitals, population, subtitle, cityName }: { vitals: Vitals; population: number; subtitle: string; cityName: string | null }) {
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
        <h1>{cityName || 'THE LAST CITY'}</h1>
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
  dawnEta,
}: {
  time: TimeOfDay;
  day: number;
  raidSoon: boolean;
  raidActive: boolean;
  /** live only: countdown to the next dawn resolution (UTC midnight) */
  dawnEta: string | null;
}) {
  const def = TIMES.find((t) => t.id === time)!;
  return (
    <div className={time === 'dawn' ? 'hud day card-bit glow' : 'hud day card-bit'}>
      <span className="day-n">DAY {day}</span>
      <div className="dn">
        {def.icon} {def.label}
      </div>
      <div className="dt">{def.tagline}</div>
      {dawnEta && <div className="dp-eta">🌅 dawn in {dawnEta}</div>}
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

type ChatterUiState = {
  state: ChatterState | null;
  category: ChatterCategory;
  loading: boolean;
  busy: boolean;
  onCategory: (category: ChatterCategory) => void;
  onPost: (text: string) => Promise<boolean>;
  onOpenThread: () => void;
  onOpenMessage: (url: string) => void;
};

function ChatterHub({
  state,
  category,
  loading,
  busy,
  onCategory,
  onPost,
  onOpenThread,
  onOpenMessage,
}: ChatterUiState) {
  const [draft, setDraft] = useState('');
  const remaining = (state?.maxLength ?? CHATTER_MAX_LENGTH) - [...draft].length;
  const submit = async () => {
    if (busy || !draft.trim()) return;
    if (await onPost(draft)) setDraft('');
  };
  return (
    <section className="chatter-hub" aria-label="City Chatter Hub">
      <div className="chatter-head">
        <div>
          <div className="ct-title">CITY CHATTER HUB</div>
          <div className="mini-cap">The city decides together on Reddit.</div>
        </div>
        {state?.weekKey && <span className="chatter-week">WEEK {state.weekKey.slice(5)}</span>}
      </div>
      <div className="chatter-topics" role="tablist" aria-label="Chatter topic">
        {CHATTER_CATEGORIES.map((topic) => (
          <button
            key={topic.id}
            type="button"
            className={category === topic.id ? 'on' : ''}
            onClick={() => onCategory(topic.id)}
            aria-selected={category === topic.id}
            role="tab"
          >
            <span aria-hidden="true">{topic.icon}</span> {topic.label}
          </button>
        ))}
      </div>
      <div className="chatter-feed" aria-live="polite">
        {loading ? (
          <div className="chatter-empty">Reading Reddit comments…</div>
        ) : !state?.ready ? (
          <div className="chatter-empty">The weekly hub is being prepared. A moderator can create or repair it from the subreddit menu.</div>
        ) : !state.feedAvailable ? (
          <div className="chatter-empty">Reddit comments could not be loaded. Open the full thread or try this topic again.</div>
        ) : state.messages.length === 0 ? (
          <div className="chatter-empty">No one has spoken here yet. Start today’s discussion.</div>
        ) : (
          state.messages.map((message) => (
            <article key={message.id} className="chatter-message">
              <div className="chatter-author">u/{message.author}</div>
              <div className="chatter-text">{message.text}</div>
              <button
                type="button"
                className="chatter-open-message"
                onClick={() => onOpenMessage(message.permalink)}
                title="Open this Reddit comment to reply, report, or mute"
                aria-label={`Open ${message.author}'s comment on Reddit`}
              >
                ↗
              </button>
            </article>
          ))
        )}
      </div>
      {state?.ready && (
        <div className="chatter-compose">
          <textarea
            value={draft}
            maxLength={state.maxLength}
            rows={2}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write to your city…"
            aria-label="City Chatter message"
          />
          <div className="chatter-compose-meta">
            <span>{remaining}</span>
            <button type="button" disabled={busy || !draft.trim()} onClick={submit}>
              {busy ? 'POSTING…' : 'POST TO REDDIT'}
            </button>
          </div>
          <div className="chatter-disclosure">{state.attributionNotice}</div>
        </div>
      )}
      {state?.threadUrl && (
        <button
          type="button"
          className="say-hi chatter-thread"
          data-comments-url={state.threadUrl}
          onClick={onOpenThread}
        >
          ↗ OPEN FULL REDDIT THREAD
        </button>
      )}
    </section>
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
  chatter: ChatterUiState;
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
  chatter,
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

      {liveData ? (
        <>
          <div className="p-sec">REDDIT DISCUSSION</div>
          <ChatterHub {...chatter} />
        </>
      ) : (
        <>
          <div className="p-sec">VILLAGER VOICES</div>
          <div className="talk">
            {talk.map((m) => (
              <div key={m.key} className={m.you ? 'tk you' : 'tk'}>
                <span className="ta">{m.who}</span>
                <span className="tx">{m.text}</span>
              </div>
            ))}
            <button type="button" className="say-hi" disabled={hiCooldown} onClick={onSayHi}>
              {hiCooldown ? '…' : villager ? `💬 TALK TO ${villager}` : '💬 TALK TO A VILLAGER'}
            </button>
          </div>
        </>
      )}

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
              ? '⚠ the forecast says raiders move at dawn, guard the wall'
              : 'guard the wall, every point of defense counts')}
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

// SHOP — Coins earned by helping the city buy house cosmetics; pooled Coins
// fund connected land districts owned by the whole village.
function ShopTab({
  economy,
  land,
  treasury,
  busy,
  disabled,
  onPurchase,
  onEquip,
  onDonate,
  onTreasuryInvest,
}: {
  economy: EconomyState;
  land: LandExpansionState;
  treasury: TreasuryState;
  busy: boolean;
  disabled: boolean;
  onPurchase: (id: ShopItemId) => void;
  onEquip: (id: ShopItemId) => void;
  onDonate: (id: LandExpansionId, amount: number) => void;
  onTreasuryInvest: (id: LandExpansionId, amount: number) => void;
}) {
  const [view, setView] = useState<'house' | 'expand'>('house');
  const activeProject = land.projects.find((project) => project.available) ?? null;
  const maxDonation = activeProject ? Math.min(economy.coins, activeProject.remaining) : 0;
  const treasuryInvestable = activeProject
    ? Math.min(treasury.balance, activeProject.remaining)
    : 0;
  const [donationAmount, setDonationAmount] = useState(1);
  useEffect(() => {
    setDonationAmount((amount) => Math.max(1, Math.min(amount, maxDonation || 1)));
  }, [activeProject?.id, maxDonation]);

  const changeDonation = (next: number) => {
    const max = Math.max(1, maxDonation);
    setDonationAmount(Math.max(1, Math.min(Math.trunc(next) || 1, max)));
  };

  return (
    <>
      <div className="coin-head">
        <span className="ch-coins">🪙 {economy.coins} COINS</span>
        <span className="ch-cap">
          earned {economy.earnedToday}/{economy.dailyCap} today
        </span>
      </div>
      <div className="shop-seg" role="tablist" aria-label="Shop mode">
        <button type="button" className={view === 'house' ? 'on' : ''} onClick={() => setView('house')} aria-selected={view === 'house'} role="tab">
          HOUSE
        </button>
        <button type="button" className={view === 'expand' ? 'on' : ''} onClick={() => setView('expand')} aria-selected={view === 'expand'} role="tab">
          EXPAND
        </button>
      </div>

      {view === 'house' ? (
        <>
          <div className="p-sec">YOUR HOUSE</div>
          <div className="shop-rows">
            {SHOP_CATALOG.map((item) => {
              const owned = economy.owned.includes(item.id);
              const equipped = economy.equipped[item.slot] === item.id;
              return (
                <div key={item.id} className="shop-row">
                  <div className="sr-main">
                    <span className="sr-nm">{item.name}</span>
                    <span className="sr-ds">{item.description}</span>
                  </div>
                  {equipped ? (
                    <span className="sr-state on">EQUIPPED</span>
                  ) : owned ? (
                    <button type="button" className="sr-btn" disabled={busy || disabled} onClick={() => onEquip(item.id)}>
                      EQUIP
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="sr-btn buy"
                      disabled={busy || disabled || economy.coins < item.price}
                      onClick={() => onPurchase(item.id)}
                    >
                      {item.price} 🪙
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="land-head">
            <span>VILLAGE LAND FUND</span>
            <small>SHARED BY THE WHOLE VILLAGE</small>
          </div>
          <div className="treasury-card">
            <div className="tc-head">
              <span>CITY TREASURY</span>
              <strong>{treasury.balance} 🪙</strong>
            </div>
            <div className="tc-meta">
              {treasury.totalCollected} collected · {treasury.totalInvested} invested
            </div>
            <div className="tc-share">
              <span>YOUR CIVIC SHARE</span>
              <span>{treasury.yours.paid} paid · {treasury.yours.progress}/{treasury.levyEvery} toward next</span>
            </div>
            {treasury.yours.backlog > 0 && (
              <div className="tc-backlog">
                {treasury.yours.backlog} Coin backlog · future contribution earnings settle it first
              </div>
            )}
            {activeProject && (
              <button
                type="button"
                className="treasury-invest"
                disabled={busy || disabled || treasuryInvestable < 1}
                onClick={() => onTreasuryInvest(activeProject.id, treasuryInvestable)}
              >
                {treasuryInvestable < 1
                  ? 'TREASURY IS BUILDING'
                  : `INVEST ${treasuryInvestable} 🪙 IN ${activeProject.name.toUpperCase()}`}
              </button>
            )}
          </div>
          <div className="shop-rows land-rows">
            {land.projects.map((project) => {
              const pct = project.target > 0 ? Math.min(100, Math.round((project.funded / project.target) * 100)) : 100;
              const gate = LAND_EXPANSIONS.find((candidate) => candidate.id === project.requires)?.name ?? 'the previous district';
              return (
                <div key={project.id} className={project.unlocked ? 'land-row done' : project.available ? 'land-row active' : 'land-row'}>
                  <div className="sr-main">
                    <span className="sr-nm">{project.name}</span>
                    <span className="sr-ds">{project.description}</span>
                    <div className="land-progress" aria-label={`${project.name} ${pct}% funded`}>
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    <span className="lr-meta">
                      {project.unlocked
                        ? `${project.target}/${project.target} · OPEN`
                        : project.available
                          ? `${project.funded}/${project.target} · ${project.remaining} TO GO`
                          : `LOCKED · AFTER ${gate.toUpperCase()}`}
                    </span>
                  </div>
                  <span className={project.unlocked ? 'sr-state on' : project.available ? 'sr-state funding' : 'sr-state'}>
                    {project.unlocked ? 'OPEN' : project.available ? 'FUNDING' : 'LOCKED'}
                  </span>
                </div>
              );
            })}
          </div>
          {activeProject && (
            <div className="land-donate">
              <label htmlFor="land-donation">PLEDGE TO {activeProject.name.toUpperCase()}</label>
              <div className="land-stepper">
                <button type="button" onClick={() => changeDonation(donationAmount - 1)} disabled={busy || disabled || donationAmount <= 1} aria-label="Decrease pledge" title="Decrease pledge">
                  −
                </button>
                <input
                  id="land-donation"
                  type="number"
                  min="1"
                  max={Math.max(1, maxDonation)}
                  value={donationAmount}
                  disabled={busy || disabled || maxDonation < 1}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => changeDonation(Number(event.target.value))}
                  aria-label={`Coins pledged to ${activeProject.name}`}
                />
                <button type="button" onClick={() => changeDonation(donationAmount + 1)} disabled={busy || disabled || donationAmount >= maxDonation} aria-label="Increase pledge" title="Increase pledge">
                  +
                </button>
                <button type="button" className="land-max" onClick={() => changeDonation(maxDonation)} disabled={busy || disabled || maxDonation < 1}>
                  MAX
                </button>
              </div>
              <button
                type="button"
                className="land-pledge"
                disabled={busy || disabled || maxDonation < 1}
                onClick={() => onDonate(activeProject.id, donationAmount)}
              >
                {maxDonation < 1 ? 'EARN COINS TO PLEDGE' : `PLEDGE ${donationAmount} 🪙`}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

// TOP tab, subreddit contribution leaderboard + city totals.
// Live mode renders the real server leaderboard (username + score only).

function TopTab({ contribs, lb, unavailable }: { contribs: Record<string, Contrib>; lb: LeaderboardEntry[] | null; unavailable: boolean }) {
  if (unavailable) {
    return (
      <>
        <div className="p-sec">TOP CONTRIBUTORS</div>
        <div className="mini-cap">The city ledger could not be reached. Try again shortly.</div>
      </>
    );
  }
  if (lb) {
    const topScore = Math.max(1, lb[0]?.score ?? 1);
    return (
      <>
        <div className="p-sec">TOP CONTRIBUTORS</div>
        <div className="lb">
          {lb.length === 0 && <div className="mini-cap">no contributions yet, be the first</div>}
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
// the fictional set; live mode only renders cities returned by /api/world.
type WmCity = { id: string; name: string; status: WorldStatus; x: number; y: number; info?: string; real?: boolean };

/** Open another city's subreddit — every city on the world map IS a community.
 *  navigateTo needs the Devvit runtime; outside it (dev harness) fall back to
 *  a plain new tab so travel is testable everywhere. */
const travelTo = (subreddit: string): void => {
  const path = subreddit.startsWith('r/') ? subreddit : `r/${subreddit}`;
  const url = `https://www.reddit.com/${path}`;
  try {
    navigateTo(url);
  } catch {
    try {
      window.open(url, '_blank', 'noopener');
    } catch {
      /* travel unavailable — never break the map */
    }
  }
};
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
    // remaining slots. Empty slots stay empty until a real subreddit arrives.
    const you = liveCities.find((c) => c.isYou) ?? null;
    const others = liveCities.filter((c) => !c.isYou).slice(0, 5);
    const info = (c: WorldCity) => `${c.survivalDays} dawns · ${c.population} souls`;
    cities = [];
    const center = WORLD_CITIES[0]!;
    if (you) cities.push({ id: 'you', name: you.subreddit, status: you.status, x: center.x, y: center.y, info: info(you), real: true });
    others.forEach((c, i) => {
      const slot = WORLD_CITIES[i + 1];
      if (!slot) return;
      cities.push({ id: slot.id, name: c.subreddit, status: c.status, x: slot.x, y: slot.y, info: info(c), real: true });
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
          <div className="wm-empty-b">{note ?? 'Real subreddit cities will appear here when the registry answers.'}</div>
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
          {WORLD_STATUS[sel.status].icon} {sel.name}, {WORLD_STATUS[sel.status].label}.{' '}
          {sel.info ?? WORLD_STATUS[sel.status].flavor}
          {sel.real && sel.id !== 'you' && (
            <button
              type="button"
              className="wm-travel"
              onClick={() => {
                playSound('button_click');
                travelTo(sel.name);
              }}
            >
              ⤴ TRAVEL TO {sel.name.toUpperCase()}
            </button>
          )}
        </div>
      )}
      {note && <div className="mini-cap">{note}</div>}
    </div>
  );
}

type DashTab = 'map' | 'city' | 'live' | 'top' | 'shop';
type MapViewMode = 'town' | 'world';

// BUILD panel (CITY tab) — the shared "build from zero" progress. Framed as
// community effort: everyone's labor pushes one meter and unlocks buildings for
// the whole city. Never "you built X" — always "we build this city together".
// REBUILD THE NEIGHBORHOOD (CITY tab, shown while homes are in ruins). A house
// belongs to one Redditor, but the whole city rebuilds it — this is the shared
// meter every player's labor pays down (destroyed homes first). Ownership is
// never lost; a rebuilt home returns to its owner.
function ReconstructionPanel({
  reconstruction,
  onAddLabor,
  disabled,
}: {
  reconstruction: ReconstructionState;
  onAddLabor: () => void;
  disabled: boolean;
}) {
  const { required, contributed, destroyed, damaged, next } = reconstruction;
  const pct = required > 0 ? Math.min(100, Math.round((contributed / required) * 100)) : 100;
  const lost: string[] = [];
  if (destroyed > 0) lost.push(`${destroyed} home${destroyed === 1 ? '' : 's'} destroyed`);
  if (damaged > 0) lost.push(`${damaged} damaged`);
  return (
    <div className="build-panel rebuild-panel">
      <div className="bp-head">
        <span className="bp-stage">🏚️ REBUILD THE NEIGHBORHOOD</span>
        <span className="bp-sub">no citizen rebuilds alone</span>
      </div>
      <div className="mini-cap">{lost.join(' · ') || 'homes were lost in the raid'} — the whole city restores them.</div>
      {next && (
        <div className="bp-next">
          <span className="bp-nm">Rebuilding: u/{next.username}'s house</span>
          <span className="bp-desc">{next.status === 'destroyed' ? 'burned to the foundation' : 'damaged in the raid'}</span>
        </div>
      )}
      <div className="bp-bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="bp-meta">
        {contributed}/{required} labor · {next ? `${next.done}/${next.needed} on this home` : 'almost there'}
      </div>
      <button type="button" className="bp-cta rebuild-cta" disabled={disabled} onClick={onAddLabor}>
        🔨 CONTRIBUTE LABOR
      </button>
    </div>
  );
}

// ENERGY DOME (CITY tab) — the shield a raid's falling fireballs are tested
// against. Charged by daily-challenge completions; every blocked fireball wears
// a panel; the shared repair pool auto-mends the weakest. Six panels, six pips.
function DomeHud({ dome }: { dome: DomeState }) {
  const { segments, energyPct, shield, repairThreshold, nextRepairSegment } = dome;
  const poolPct = repairThreshold > 0 ? Math.min(100, Math.round((shield / repairThreshold) * 100)) : 0;
  const tone = energyPct >= 66 ? 'strong' : energyPct >= 33 ? 'worn' : 'weak';
  const pipTone = (s: number) => (s >= 66 ? 'strong' : s >= 33 ? 'worn' : s > 0 ? 'weak' : 'gone');
  return (
    <div className="dome-panel">
      <div className="dome-head">
        <span className="dome-title">🛡️ ENERGY DOME</span>
        <span className={`dome-energy dome-${tone}`}>{energyPct}%</span>
      </div>
      <div
        className="dome-pips"
        role="img"
        aria-label={`Dome panels at ${segments.map((s) => `${Math.round(s)}%`).join(', ')}`}
      >
        {segments.map((s, i) => (
          <i
            key={i}
            className={`dome-pip dome-${pipTone(s)}${i === nextRepairSegment ? ' dome-next' : ''}`}
            style={{ height: `${Math.max(10, Math.round(s))}%` }}
          />
        ))}
      </div>
      <div className="mini-cap dome-cap">
        {energyPct >= 66
          ? 'the shield is strong — fireballs break against it'
          : energyPct >= 33
            ? 'the shield is wearing thin — finish your daily challenge to charge it'
            : 'the dome is failing — the city must recharge it'}
      </div>
      <div className="dome-repair">
        <span className="dome-repair-label">🔧 shield reserve</span>
        <div className="dome-bar">
          <i style={{ width: `${poolPct}%` }} />
        </div>
        <span className="dome-repair-meta">
          {nextRepairSegment === null
            ? 'no panels breached'
            : `${shield}/${repairThreshold} to mend panel ${nextRepairSegment + 1}`}
        </span>
      </div>
    </div>
  );
}

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
      <div className="bp-built">
        {unlocked.length
          ? `Built: ${unlocked.join(' · ')}`
          : 'Nothing stands here yet. Contribute labor to build the first Shelter.'}
      </div>
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
  lbUnavailable,
  build,
  onAddLabor,
  buildCtaDisabled,
  buildCtaLabel,
  coachActive,
  reconstruction,
  dome,
  economy,
  landState,
  treasury,
  shopBusy,
  shopDisabled,
  onShopPurchase,
  onShopEquip,
  onLandDonate,
  onTreasuryInvest,
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
  lbUnavailable: boolean;
  build: BuildStatus | null;
  onAddLabor: () => void;
  buildCtaDisabled: boolean;
  buildCtaLabel: string;
  coachActive: boolean;
  reconstruction: ReconstructionState;
  dome: DomeState;
  economy: EconomyState;
  landState: LandExpansionState;
  treasury: TreasuryState;
  shopBusy: boolean;
  shopDisabled: boolean;
  onShopPurchase: (id: ShopItemId) => void;
  onShopEquip: (id: ShopItemId) => void;
  onLandDonate: (id: LandExpansionId, amount: number) => void;
  onTreasuryInvest: (id: LandExpansionId, amount: number) => void;
}) {
  return (
    <>
      <button type="button" className="hud dash-fab card-bit" onClick={() => setOpen(!open)} aria-expanded={open}>
        ▦ CITY
      </button>
      <div className={`hud dash card-bit${open ? ' on' : ''}${coachActive ? ' coach-active' : ''}`}>
        <div className="dash-sticky">
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
          <button type="button" className={tab === 'shop' ? 'dash-tab on' : 'dash-tab'} onClick={() => setTab('shop')} aria-pressed={tab === 'shop'}>
            SHOP
          </button>
          <button type="button" className={tab === 'top' ? 'dash-tab on' : 'dash-tab'} onClick={() => setTab('top')} aria-pressed={tab === 'top'}>
            TOP
          </button>
        </div>
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

        {tab === 'top' && <TopTab contribs={contribs} lb={lb} unavailable={lbUnavailable} />}

        {tab === 'shop' && (
          <ShopTab
            economy={economy}
            land={landState}
            treasury={treasury}
            busy={shopBusy}
            disabled={shopDisabled}
            onPurchase={onShopPurchase}
            onEquip={onShopEquip}
            onDonate={onLandDonate}
            onTreasuryInvest={onTreasuryInvest}
          />
        )}

        {tab === 'city' && (
          <>
            <DomeHud dome={dome} />
            {reconstruction.active && (
              <ReconstructionPanel reconstruction={reconstruction} onAddLabor={onAddLabor} disabled={buildCtaDisabled} />
            )}
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

            <div className="p-sec">DISTRICTS · TAP TO VISIT</div>
            <div className="districts">
              {pois.length === 0 ? (
                <div className="mini-cap">No districts yet, raise the first Shelter to begin.</div>
              ) : (
                pois.map((p) => (
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
                ))
              )}
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
          ⬆ UPGRADE · 🍞 {UPGRADE_COST}
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
        💬 TALK
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
  const title = phase === 'held' ? '🛡 THE DOME HELD' : phase === 'breach' ? '🔥 THE DOME WAS BREACHED' : '⚔ RAID AT THE GATE';
  const sub =
    phase === 'held'
      ? 'every fireball broke against the shield'
      : phase === 'breach'
        ? 'a fireball pierced the dome · −8 souls'
        : 'the dome decides tonight…';
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
  lbUnavailable,
  liveRaidLikely,
  liveRaidNote,
  worldCities,
  worldLive,
  worldNote,
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
  lbUnavailable: boolean;
  liveRaidLikely: boolean;
  liveRaidNote: string | null;
  worldCities: WorldCity[] | null;
  worldLive: boolean;
  worldNote: string | null;
}) {
  const ranked = Object.entries(contribs)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([name, c], i) => ({ name, c, rank: i }));
  const worldRows = worldLive
    ? (worldCities ?? []).map((c, index) => ({
        id: c.isYou ? 'you' : `live-${index}`,
        name: c.subreddit,
        status: c.status,
        note: `${c.survivalDays} dawns · ${c.population} souls`,
      }))
    : WORLD_CITIES.map((c) => ({ ...c, status: c.id === 'you' ? youStatus : c.status, note: WORLD_STATUS[c.status].flavor }));
  return (
    <div className={open ? 'hud stats-modal on' : 'hud stats-modal'}>
      <div className="stats-back" onClick={onClose} />
      <div className="stats-sheet card-bit">
        <button type="button" className="st-close" onClick={onClose} aria-label="Close stats">
          ✕
        </button>
        <h2>CITY LEDGER · DAY {day}</h2>

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
              <td>·</td>
              <td>·</td>
              <td>·</td>
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
        {lbUnavailable ? (
          <div className="mini-cap">The city ledger could not be reached. Try again shortly.</div>
        ) : lb ? (
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
                <td colSpan={5}>no raids survived yet, the wall waits</td>
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
            {worldRows.length === 0 ? (
              <tr>
                <td colSpan={3}>{worldNote ?? 'No real subreddit cities are registered yet.'}</td>
              </tr>
            ) : worldRows.map((c) => {
              const st = WORLD_STATUS[c.status];
              return (
                <tr key={c.id} className={c.id === 'you' ? 'me' : undefined}>
                  <td>{c.name}</td>
                  <td>
                    <span className={'st-tag ' + (c.status === 'thriving' ? 'good' : c.status === 'holding' ? 'good' : c.status === 'strained' ? 'low' : 'critical')}>
                      {st.icon} {st.label}
                    </span>
                  </td>
                  <td>{c.note}</td>
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
        <h2>DAWN REPORT · DAY {report.day}</h2>
        <div className="st-sec">THE CITY</div>
        {report.citySummary.length === 0 ? (
          <div className="mini-cap">a quiet night, nothing to report</div>
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
          <div className="mini-cap">You rested. The city carried on without you, today, change that.</div>
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

// CITY DASHBOARD — one consolidated overview the community can open any time:
// the SETTLEMENT (build stage + every structure and whether it's raised),
// the resource INVENTORY, and a unified UPDATES feed (raid status + chronicle).
// Reuses the stats-modal chrome. All data is read-only; no new backend.
function GameDashboard({
  open,
  onClose,
  day,
  build,
  vitals,
  vitalMaxes,
  population,
  events,
  raidDays,
  raidLikely,
  raidNote,
  housesTotal,
}: {
  open: boolean;
  onClose: () => void;
  day: number;
  build: BuildStatus | null;
  vitals: Vitals;
  vitalMaxes: Record<VitKey, number>;
  population: number;
  events: LiveEvent[];
  raidDays: number;
  raidLikely: boolean;
  raidNote: string | null;
  housesTotal: number;
}) {
  const unlocked = new Set(build?.unlocked ?? []);
  const nextId = build?.next?.id ?? null;
  const builtCount = build?.unlocked.length ?? 0;
  const raidHead = raidLikely
    ? 'Raid pressure is active'
    : raidDays <= 1
      ? 'Raiders move at the next dawn'
      : `Next raid in ~${raidDays} dawns`;
  return (
    <div className={open ? 'hud stats-modal on' : 'hud stats-modal'}>
      <div className="stats-back" onClick={onClose} />
      <div className="stats-sheet card-bit">
        <button type="button" className="st-close" onClick={onClose} aria-label="Close dashboard">
          ✕
        </button>
        <h2>CITY DASHBOARD · DAY {day}</h2>

        <div className="st-sec">SETTLEMENT</div>
        {build ? (
          <>
            <div className="db-stage">
              <b>{build.stageLabel}</b>
              <span>
                stage {build.stage + 1}/5 · {builtCount}/{BUILD_SEQUENCE.length} built
              </span>
            </div>
            <div className="db-neigh">🏘 {housesTotal} {housesTotal === 1 ? 'soul has' : 'souls have'} built here</div>
            {build.next ? (
              <div className="db-next">
                <div className="db-next-h">
                  <span>Next: {build.next.name}</span>
                  <span>
                    {build.progress}/{build.progressRequired} labor
                  </span>
                </div>
                <div className="db-bar">
                  <i style={{ width: `${Math.min(100, (build.progress / Math.max(1, build.progressRequired)) * 100)}%` }} />
                </div>
                <div className="db-next-fx">
                  {build.next.effect} · {build.contributorsToday} contributed today
                </div>
              </div>
            ) : (
              <div className="mini-cap">Surviving City, every structure raised.</div>
            )}
            <table className="st">
              <thead>
                <tr>
                  <th>STRUCTURE</th>
                  <th>EFFECT</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {BUILD_SEQUENCE.map((b) => {
                  const isBuilt = unlocked.has(b.id);
                  const isNext = b.id === nextId;
                  const tone = isBuilt ? 'good' : isNext ? 'low' : 'critical';
                  const label = isBuilt ? 'built' : isNext ? 'building' : 'locked';
                  return (
                    <tr key={b.id}>
                      <td>{b.name}</td>
                      <td>{b.effect}</td>
                      <td>
                        <span className={'st-tag ' + tone}>{label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          <div className="mini-cap">the camp is still waking…</div>
        )}

        <div className="st-sec">INVENTORY · RESOURCES</div>
        <table className="st">
          <thead>
            <tr>
              <th>RESOURCE</th>
              <th>HELD</th>
              <th>CAP</th>
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
                  <td>
                    <span className={'st-tag ' + tone}>{tone}</span>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td>👥 SOULS</td>
              <td>{population}</td>
              <td>·</td>
              <td>·</td>
            </tr>
          </tbody>
        </table>

        <div className="st-sec">UPDATES</div>
        <div className={raidLikely ? 'raid-ledger danger' : 'raid-ledger'}>
          <b>{raidHead}</b>
          <span>{raidNote ?? 'Threat, defense, and Guard Wall actions decide the next raid.'}</span>
        </div>
        <div className="db-feed">
          {events.length === 0 ? (
            <div className="mini-cap">no news yet, the city is quiet</div>
          ) : (
            events.map((e) => (
              <div key={e.key} className="db-feed-row">
                <span className="db-feed-i">{e.icon}</span>
                <span>{e.text}</span>
              </div>
            ))
          )}
        </div>
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
  defaultName,
  onEnter,
  onDismiss,
}: {
  busy: boolean;
  /** Reddit username — prefilled so "skip it" visibly means "use my Reddit name". */
  defaultName: string;
  onEnter: (role: Role, name: string) => void;
  onDismiss: () => void;
}) {
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [name, setName] = useState(defaultName.slice(0, 24));
  const selectedLabel = ROLE_CATALOG.find((r) => r.id === selectedRole)?.label ?? '';
  return (
    <div className="hud onboard on">
      <div className="onboard-sheet card-bit">
        <button type="button" className="p-x" onClick={onDismiss} aria-label="Dismiss onboarding">
          ✕
        </button>
        <div className="ob-sub" style={{ color: 'var(--ink)', marginTop: 0, marginBottom: 10 }}>
          This subreddit is a shared city trying to survive one more dawn. It begins as a bare Camp,
          everyone builds it up together, and your first contribution raises your own house in it. Take
          your daily action, vote on the crisis, pledge to save The Marked, and hold the wall, then come
          back at dawn to see what the community's choices did. The city remembers.
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
          placeholder="name your survivor, or we'll use your Reddit name"
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

// Fallen-city memorial (live mode only, city.status === 'fallen'). A dim scrim
// over the (still visible) 3D town; every action surface is suppressed while it
// shows. It is a CHAPTER, not an ending: the Phoenix Dawn rebirths the city at
// the next UTC dawn (see lazyResolve), and every player's titles, streaks, and
// lifetime contribution carry into the new cycle.
function FallenScreen({
  epitaph,
  survivalDays,
  population,
  cycle,
  day,
  cityName,
}: {
  epitaph: string;
  survivalDays: number;
  population: number;
  cycle: number;
  day: number;
  cityName: string;
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
        <div className="fl-note fl-phoenix">
          The survivors regroup. {cityName} rises from the ashes at the next dawn — and every
          title, streak, and deed carries with you into the new cycle.
        </div>
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
  const [dashOpen, setDashOpen] = useState(
    // Phones (portrait or landscape) start with the drawer closed so the city
    // and the hotbar own the first screen; desktop keeps the drawer open.
    () => !window.matchMedia('(max-width: 640px), (max-height: 500px)').matches,
  );
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
  const [boardOpen, setBoardOpen] = useState(false); // 📋 consolidated city dashboard
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
  // LIVE tab state, all demo numbers, drifting on timers.
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
  // subreddit contributions, houses bought + resources gifted, per user
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
  // One temporary HUD message at a time: per-item dismissals advance the queue.
  const [hudDismissed, setHudDismissed] = useState<{ raid?: boolean; mission?: boolean; rekindle?: boolean }>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [worldCities, setWorldCities] = useState<WorldCity[] | null>(null);
  const [worldNote, setWorldNote] = useState<string | null>(null);
  const [liveLb, setLiveLb] = useState<LeaderboardEntry[] | null>(null);
  const [liveLbUnavailable, setLiveLbUnavailable] = useState(false);
  // BUILD FROM ZERO, live: server payload; demo: local counters synth a state.
  const [liveBuild, setLiveBuild] = useState<BuildStatus | null>(null);
  const [demoUnlocked, setDemoUnlocked] = useState<string[]>([]);
  const [demoBuildProgress, setDemoBuildProgress] = useState(0);
  const [demoContributors, setDemoContributors] = useState(6);
  // ONE REDDITOR ONE HOUSE, live: server house summary; demo: synth from a
  // growing contributor count + your own (demo) contribution driving your tier.
  const [liveHouses, setLiveHouses] = useState<HouseSummary | null>(null);
  const [demoHouseTotal, setDemoHouseTotal] = useState(0);
  const [demoYourContribution, setDemoYourContribution] = useState(0);
  // First-run onboarding (live only): a brand-new player has no role yet.
  const [needsOnboard, setNeedsOnboard] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [onboardBusy, setOnboardBusy] = useState(false);
  const [liveUsername, setLiveUsername] = useState(''); // Reddit username (prefills the survivor name)
  const [liveCityName, setLiveCityName] = useState<string | null>(null); // this city's ancient name (per-subreddit)
  const [liveChatter, setLiveChatter] = useState<ChatterState | null>(null);
  const [chatterCategory, setChatterCategory] = useState<ChatterCategory>('strategy');
  const [chatterLoading, setChatterLoading] = useState(false);
  const [chatterBusy, setChatterBusy] = useState(false);
  const [liveChallenge, setLiveChallenge] = useState<InitResponse['challenge'] | null>(null); // today's personal mission
  // Coin economy: balance + cosmetics from the server, land districts shared city-wide.
  const [liveEconomy, setLiveEconomy] = useState<EconomyState | null>(null);
  const [liveLand, setLiveLand] = useState<LandExpansionState | null>(null);
  const [liveReconstruction, setLiveReconstruction] = useState<ReconstructionState | null>(null);
  const [liveDome, setLiveDome] = useState<DomeState>(EMPTY_DOME);
  const [liveTreasury, setLiveTreasury] = useState<TreasuryState | null>(null);
  const [demoEconomy, setDemoEconomy] = useState<EconomyState>(() => ({
    ...DEMO_ECONOMY,
    owned: [...DEMO_ECONOMY.owned],
    equipped: { ...DEMO_ECONOMY.equipped },
  }));
  const [demoLand, setDemoLand] = useState<LandExpansionState>(DEMO_LAND);
  const [demoTreasury, setDemoTreasury] = useState<TreasuryState>(DEMO_TREASURY);
  const [shopBusy, setShopBusy] = useState(false);
  const challengeDoneRef = useRef(false); // last seen done-state, for the completion cheer
  const [liveStreak, setLiveStreak] = useState(0); // consecutive-day streak (server-tracked)
  const [liveLapsed, setLiveLapsed] = useState(0); // a dead streak's ghost, restorable via REKINDLE
  const [rekindleBusy, setRekindleBusy] = useState(false);
  const [dawnEta, setDawnEta] = useState<string | null>(null); // countdown to next UTC-midnight dawn
  // Epic banners (LEVEL UP / THE SHELTER STANDS): one at a time, queued.
  const [epic, setEpic] = useState<{ title: string; sub: string } | null>(null);
  const epicQueueRef = useRef<{ title: string; sub: string }[]>([]);
  const prevLevelRef = useRef<number | null>(null);
  const prevUnlockedRef = useRef<string[] | null>(null);
  const prevCycleRef = useRef<number | null>(null); // Phoenix Dawn rebirth detection
  // Action juice: transient floating "+1 🌾" markers above the hotbar.
  const [floats, setFloats] = useState<{ key: number; text: string }[]>([]);
  const floatKeyRef = useRef(0);
  const [liveTraitId, setLiveTraitId] = useState<string | null>(null); // founding trait → the name's epithet
  // Advisor coachmarks: a short primer plus contextual lessons, replayable in full.
  const [coachStep, setCoachStep] = useState<number | null>(null);
  const [coachFlow, setCoachFlow] = useState<CoachFlow | null>(null);
  const [coachRing, setCoachRing] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // Where Maren looks/points, derived from the highlighted element's position.
  const [coachAim, setCoachAim] = useState<{ face: 'left' | 'right' | 'front'; point: 'up' | 'side' | null }>({ face: 'front', point: null });
  // Fallen-city terminal state (live only): city.status === 'fallen'.
  const [cityFallen, setCityFallen] = useState(false);
  const [liveTimelineHeadline, setLiveTimelineHeadline] = useState<string | null>(null);
  const [muted, setMutedUi] = useState(isMuted()); // global SFX mute (persisted)
  const [musicMuted, setMusicMutedUi] = useState(isMusicMuted()); // background music mute (persisted, defaults ON = muted)
  const [masterVolume, setMasterVolumeUi] = useState(getMasterVolume());
  const handleRef = useRef<VillageHandle | null>(null);
  const cityFallenRef = useRef(false); // fallen state, readable inside handlers/timers
  const modeRef = useRef<Mode>('connecting'); // current mode, readable inside timers
  const mutatingRef = useRef(false); // a POST is in flight, pause polls + block double-taps
  const liveDayRef = useRef(0); // last server day seen (dawn diffing)
  const liveCrisisIdRef = useRef(''); // pins votes to the crisis being shown
  const seenDramaRef = useRef<Set<string>>(new Set()); // drama lines already in the feed
  const worldFetchedRef = useRef(false); // world fetched at least once (first tab open)
  const lbFetchedRef = useRef(false); // leaderboard fetched at least once
  const dashTabRef = useRef<DashTab>('map'); // open tab, readable inside the poll
  const mapViewRef = useRef<MapViewMode>('town');
  const chatterCategoryRef = useRef<ChatterCategory>('strategy');
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
  const liveReconstructionRef = useRef<ReconstructionState | null>(null); // readable in the add-labor handler
  const liveHousesRef = useRef<HouseSummary | null>(null); // last server house summary, for first-house feedback
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
    liveReconstructionRef.current = liveReconstruction;
  }, [liveBuild, liveReconstruction]);

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
  // top-center notification stack, capped at 4, each auto-dismisses after 5s
  const pushNotif = useCallback((icon: string, text: string, tone?: 'good' | 'bad') => {
    const key = notifKeyRef.current;
    notifKeyRef.current += 1;
    setNotifs((prev) => [{ icon, text, tone, key }, ...prev].slice(0, 4));
    notifTimersRef.current.push(window.setTimeout(() => setNotifs((prev) => prev.filter((n) => n.key !== key)), 5000));
  }, []);

  const startIntroCoach = useCallback(() => {
    setCoachFlow('intro');
    setCoachStep(0);
  }, []);
  const openContextCoach = useCallback(
    (step: number) => {
      if (coachStep !== null || !coachSeen() || contextualCoachSeen(step)) return;
      setCoachFlow('context');
      setCoachStep(step);
    },
    [coachStep],
  );
  const setDashboardOpen = useCallback(
    (open: boolean) => {
      setDashOpen(open);
      if (open) openContextCoach(5);
    },
    [openContextCoach],
  );
  const setDashboardTab = useCallback(
    (tab: DashTab) => {
      setDashTab(tab);
      const lesson = tab === 'city' ? 6 : tab === 'live' ? 7 : tab === 'top' ? 8 : null;
      if (lesson !== null) openContextCoach(lesson);
    },
    [openContextCoach],
  );

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
  // Epic banner queue: show one at a time for ~3.2s each.
  const showEpic = useCallback((title: string, sub: string) => {
    epicQueueRef.current.push({ title, sub });
    setEpic((cur) => cur ?? epicQueueRef.current.shift() ?? null);
  }, []);
  useEffect(() => {
    if (!epic) return undefined;
    const t = window.setTimeout(() => setEpic(epicQueueRef.current.shift() ?? null), 3200);
    return () => window.clearTimeout(t);
  }, [epic]);

  // Dawn countdown (live only): the city resolves at UTC midnight — show the
  // appointment. Ticks every 30s; hidden in demo/offline.
  useEffect(() => {
    if (mode !== 'live') {
      setDawnEta(null);
      return undefined;
    }
    const compute = () => {
      const now = new Date();
      const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      const mins = Math.max(1, Math.round((next - now.getTime()) / 60000));
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      setDawnEta(h > 0 ? `${h}h ${m}m` : `${m}m`);
    };
    compute();
    const id = window.setInterval(compute, 30000);
    return () => window.clearInterval(id);
  }, [mode]);

  // Action juice: float a "+1 🌾" above the hotbar, gone in ~1.1s.
  const popFloat = useCallback((text: string) => {
    const key = ++floatKeyRef.current;
    setFloats((f) => [...f, { key, text }]);
    window.setTimeout(() => setFloats((f) => f.filter((x) => x.key !== key)), 1100);
  }, []);

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
      setLiveUsername(init.player.username ?? '');
      setLiveCityName(init.cityName || null);
      // Economy + land: state for the SHOP tab, cosmetics + districts for the scene.
      setLiveEconomy(init.economy ?? EMPTY_ECONOMY);
      setLiveLand(init.land ?? EMPTY_LAND);
      setLiveReconstruction(init.reconstruction ?? EMPTY_RECONSTRUCTION);
      setLiveDome(init.dome ?? EMPTY_DOME);
      setLiveTreasury(init.treasury ?? EMPTY_TREASURY);
      // Daily mission: track completion transitions so finishing mid-session
      // cheers exactly once (never on boot, never again on later polls).
      const ch = init.challenge ?? null;
      setLiveChallenge(ch);
      if (!first && ch?.done && !challengeDoneRef.current) {
        pushNotif('📜', `mission complete, +${ch.reward} standing`, 'good');
        playSound('action_confirm');
      }
      challengeDoneRef.current = !!ch?.done;
      setLiveStreak(init.player.streak ?? 0);
      setLiveLapsed(init.player.lapsedStreak ?? 0);
      // Level-up moment: the mission level climbed since the last refresh.
      if (ch) {
        if (!first && prevLevelRef.current !== null && ch.level > prevLevelRef.current) {
          showEpic(`LEVEL ${ch.level}`, 'your standing in the city grows');
          playSound('dawn_report');
        }
        prevLevelRef.current = ch.level;
      }
      // Dawn celebration: a building the community raised appeared overnight.
      const unlocked = init.build?.unlocked ?? [];
      if (!first && prevUnlockedRef.current) {
        const fresh = unlocked.filter((id) => !prevUnlockedRef.current!.includes(id));
        for (const id of fresh) {
          showEpic(`THE ${id.replace(/_/g, ' ').toUpperCase()} STANDS`, 'raised by this whole subreddit');
          playSound('dawn_report');
        }
      }
      prevUnlockedRef.current = unlocked;
      setLiveTraitId(init.trait?.id ?? null);
      setLiveActions(init.yourActionsToday);
      setLiveStanding(init.standing);
      setLiveCycle(city.cycle);
      // Phoenix Dawn: a cycle increase mid-session means the fallen city rose
      // again overnight — celebrate the rebirth once.
      if (!first && prevCycleRef.current !== null && city.cycle > prevCycleRef.current) {
        showEpic('FROM THE ASHES', `cycle ${city.cycle}, the city rises again`);
        playSound('dawn_report');
      }
      prevCycleRef.current = city.cycle;
      setLiveRaidLikely(init.forecast.raidLikely);
      setLiveBuild(init.build ?? null); // defensive: server lane owns this field
      liveHousesRef.current = init.houses ?? null;
      setLiveHouses(init.houses ?? null); // one-redditor-one-house summary
      setLiveRaidNote(raidNoteFromEvents(init.timelinePreview?.events, init.forecast.raidLikely));
      setLiveTimelineHeadline(init.timelinePreview?.headline ?? null);
      // fallen-city terminal state, mirror to a ref so handlers/timers can read it
      const fallen = city.status === 'fallen';
      cityFallenRef.current = fallen;
      setCityFallen(fallen);
      // first-run onboarding: a brand-new player has no role yet. Open on first
      // load (never re-open after they've dismissed/entered this session).
      if (first && init.player.role === null) {
        setNeedsOnboard(true);
        setOnboardOpen(true);
      } else if (first && !coachSeen()) {
        // returning player who never saw the essentials — walk them in once
        startIntroCoach();
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
        pushNotif('🌅', `dawn breaks, day ${city.day}`);
        pushEvent('🌅', `Dawn broke over the city, day ${city.day}, still standing.`);
        // Last night's raid: the server aftermath (authoritative) drives the full
        // siege cinematic + the sequenced SFX; older entries without it fall back
        // to the timeline-derived banner.
        const after = init.dawnReport?.raidAftermath ?? null;
        if (after) {
          const outcome: 'held' | 'breach' | 'fallen' =
            after.held ? 'held' : city.status === 'fallen' ? 'fallen' : 'breach';
          const hitHouseIndices = (init.houses?.damaged ?? []).map((d) => d.index);
          const volley: RaidFireball[] = after.fireballs ?? [];
          // The dome panels settle to their post-raid state via the liveDome effect;
          // the cinematic plays the falling volley (ripples on blocks, pierces + house
          // hits on penetrations) over them.
          handleRef.current?.playRaidCinematic?.({ outcome, fireballs: volley, hitHouseIndices });
          playRaidSfx(outcome, volley, after.housesDestroyed.length > 0);
          const blocked = volley.filter((f) => f.blocked).length;
          const title =
            after.held ? '🛡 THE DOME HELD' : outcome === 'fallen' ? '💥 THE DOME SHATTERED' : '🔥 THE DOME WAS BREACHED';
          const lost = after.housesDestroyed.length;
          const sub = after.held
            ? `the dome held — ${blocked} fireball${blocked === 1 ? '' : 's'} broke against the shield`
            : lost > 0
              ? `${lost} home${lost === 1 ? '' : 's'} lost — no citizen rebuilds alone`
              : 'a fireball pierced the dome; the city held the line';
          showEpic(title, sub);
          pushNotif('⚔', sub, after.held ? 'good' : 'bad');
          pushEvent('⚔', sub);
        } else {
          const t = init.timelinePreview;
          const raidOutcome = raidOutcomeFromTimeline(t?.events, t?.deltas.population);
          if (raidOutcome) {
            const breached = raidOutcome.title === 'THE WALL WAS BREACHED';
            showEpic(raidOutcome.title, raidOutcome.line);
            pushNotif('⚔', raidOutcome.line, breached ? 'bad' : 'good');
            pushEvent('⚔', raidOutcome.line);
            playSound(breached ? 'raid_warning' : 'dawn_report');
          }
        }
      }
    },
    [pushEvent, pushNotif, showEpic, startIntroCoach],
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
          pushNotif('⚠️', 'dev demo mode, live API unavailable', 'bad');
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


  // Advisor tour: each step can open the dashboard on a tab (so the player SEES
  // what's being explained) and highlight its anchor element with a ring. The
  // measure waits out the drawer's 250ms slide before reading the rect.
  useEffect(() => {
    if (coachStep === null) {
      setCoachRing(null);
      return undefined;
    }
    const step = COACH_STEPS[coachStep];
    if (!step) return undefined;
    if (step.go) {
      if (step.go.open !== undefined) setDashOpen(step.go.open);
      if (step.go.tab) setDashTab(step.go.tab);
    }
    const measure = () => {
      const el = step.anchor ? document.querySelector(step.anchor) : null;
      const r = el?.getBoundingClientRect();
      if (!r || r.width <= 0 || r.height <= 0) {
        setCoachRing(null);
        setCoachAim({ face: 'front', point: null });
        return;
      }
      setCoachRing({ left: r.left - 6, top: r.top - 6, width: r.width + 12, height: r.height + 12 });
      // Maren turns toward the target and raises her lantern when it's high up.
      const cx = r.left + r.width / 2;
      const face = cx < window.innerWidth / 2 - 60 ? 'left' : cx > window.innerWidth / 2 + 60 ? 'right' : 'front';
      const point = r.bottom < window.innerHeight * 0.55 ? 'up' : face !== 'front' ? 'side' : null;
      setCoachAim({ face, point });
    };
    // Measure NOW (throttled webviews clamp timers, and the ring must never
    // lag a step behind), then re-measure once the drawer's slide settles.
    measure();
    const t = window.setTimeout(measure, 340);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', measure);
    };
  }, [coachStep]);

  // ---- V1 sound cues (local files, fail-silent; mute persists in localStorage) ----
  useEffect(() => {
    preloadSounds();
    // Strict webviews (Reddit app) gate playback behind a user gesture — prime
    // audio on pointerdown until one sticks (unlockAudio self-resets on failure).
    const prime = () => {
      unlockAudio();
      unlockMusic();
    };
    window.addEventListener('pointerdown', prime, { passive: true });
    return () => window.removeEventListener('pointerdown', prime);
  }, []);
  // Background music track selection: raid-tension when a raid is imminent,
  // dawn-hope stinger on the dawn transition, otherwise the calm dusk theme.
  useEffect(() => {
    if (mode !== 'live') return;
    if (cityFallen) { stopMusic(); return; }
    if (liveRaidLikely || (raidDays >= 0 && raidDays <= 1)) {
      playTrack('raid');
    } else if (time === 'dawn') {
      playTrack('dawn');
    } else {
      playTrack('dusk');
    }
  }, [mode, cityFallen, liveRaidLikely, raidDays, time]);
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
  const onToggleMusic = useCallback(() => {
    const next = toggleMusicMuted();
    setMusicMutedUi(next);
    if (!next) playSound('button_click'); // audible feedback when turning music on
  }, []);
  const onVolumeChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = setMasterVolume(Number(event.currentTarget.value) / 100);
    setMasterVolumeUi(next);
    refreshMusicVolume();
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
      .then((r) => {
        setLiveLb(r.contributors);
        setLiveLbUnavailable(false);
      })
      .catch(() => {
        // Keep cached truth when available; otherwise render an honest unavailable state.
        if (liveLb === null) setLiveLbUnavailable(true);
      });
  }, [liveLb]);

  const refreshChatter = useCallback(async (category: ChatterCategory) => {
    setChatterLoading(true);
    try {
      const next = await getChatter(category);
      if (chatterCategoryRef.current === category) setLiveChatter(next);
    } catch {
      // Preserve the last confirmed Reddit state during a transient network failure.
    } finally {
      if (chatterCategoryRef.current === category) setChatterLoading(false);
    }
  }, []);

  // Fetch the world once as soon as we're live, so the horizon settlements in
  // the 3D scene wear real city names without waiting for the WORLD tab.
  useEffect(() => {
    if (mode !== 'live' || worldFetchedRef.current) return;
    worldFetchedRef.current = true;
    refreshWorld();
  }, [mode, refreshWorld]);

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
    if (dashTab === 'live') void refreshChatter(chatterCategory);
  }, [mode, dashTab, mapView, chatterCategory, refreshWorld, refreshLb, refreshChatter]);
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
          if (dashTabRef.current === 'live') void refreshChatter(chatterCategoryRef.current);
        })
        .catch(() => {
          // transient poll failure, keep showing the last known state
        });
    }, 30000);
    return () => window.clearInterval(id);
  }, [mode, applyInit, refreshWorld, refreshLb, refreshChatter]);

  // ---- LIVE mode mutations (each guards the poll + double-taps via mutatingRef) ----
  const toastFailure = useCallback(
    (err: unknown, fallback: string) => {
      playSound('error_soft');
      popToast(err instanceof ApiFailure ? err.message : fallback);
    },
    [popToast],
  );

  const refreshAfterContribution = useCallback(async () => {
    try {
      const before = liveHousesRef.current?.yours ?? null;
      const init = await getInit();
      applyInit(init, false);
      const yours = init.houses?.yours ?? null;
      if (!before && yours) {
        pushNotif('🏠', `Your house now stands in the city. Build order #${yours.index + 1}.`, 'good');
        openContextCoach(9);
      } else {
        openContextCoach(4);
      }
    } catch {
      popToast('Saved. City refresh delayed.');
    }
  }, [applyInit, openContextCoach, popToast, pushNotif]);

  // REKINDLE — streak insurance: burn standing to restore the dead streak.
  const onRekindle = useCallback(() => {
    if (rekindleBusy || mutatingRef.current) return;
    setRekindleBusy(true);
    postRekindle()
      .then((res) => {
        setLiveStreak(res.player.streak);
        setLiveLapsed(0);
        playSound('dawn_report');
        pushNotif('🔥', `the flame burns again, ${res.player.streak} days strong (-${res.cost} standing)`, 'good');
      })
      .catch((err) => toastFailure(err, 'could not rekindle, try again'))
      .finally(() => setRekindleBusy(false));
  }, [rekindleBusy, pushNotif, toastFailure]);

  // ---- SHOP: buy/equip house cosmetics, pool Coins into land districts ----
  const onShopPurchase = useCallback(
    (itemId: ShopItemId) => {
      if (shopBusy || cityFallenRef.current) return;
      const item = SHOP_CATALOG.find((candidate) => candidate.id === itemId);
      if (!item) return;
      if (modeRef.current === 'demo') {
        if (demoEconomy.owned.includes(itemId) || demoEconomy.coins < item.price) return;
        setDemoEconomy((economy) => ({
          ...economy,
          coins: economy.coins - item.price,
          owned: [...economy.owned, itemId],
        }));
        playSound('action_confirm');
        pushNotif('🪙', `${item.name} purchased.`, 'good');
        return;
      }
      if (modeRef.current !== 'live' || mutatingRef.current) return;
      setShopBusy(true);
      mutatingRef.current = true;
      postShopPurchase(itemId)
        .then((res) => {
          setLiveEconomy(res.economy);
          playSound('action_confirm');
          pushNotif('🪙', res.message, 'good');
        })
        .catch((err) => toastFailure(err, 'the trade fell through, try again'))
        .finally(() => {
          setShopBusy(false);
          mutatingRef.current = false;
        });
    },
    [demoEconomy, shopBusy, pushNotif, toastFailure],
  );

  const onShopEquip = useCallback(
    (itemId: ShopItemId) => {
      if (shopBusy || cityFallenRef.current) return;
      const item = SHOP_CATALOG.find((candidate) => candidate.id === itemId);
      if (!item) return;
      if (modeRef.current === 'demo') {
        if (!demoEconomy.owned.includes(itemId)) return;
        setDemoEconomy((economy) => ({
          ...economy,
          equipped: { ...economy.equipped, [item.slot]: itemId },
        }));
        playSound('button_click');
        pushNotif('🏠', `${item.name} equipped.`, 'good');
        return;
      }
      if (modeRef.current !== 'live' || mutatingRef.current) return;
      setShopBusy(true);
      mutatingRef.current = true;
      postShopEquip(itemId)
        .then((res) => {
          setLiveEconomy(res.economy);
          playSound('button_click');
          pushNotif('🏠', res.message, 'good');
        })
        .catch((err) => toastFailure(err, 'could not equip that, try again'))
        .finally(() => {
          setShopBusy(false);
          mutatingRef.current = false;
        });
    },
    [demoEconomy, shopBusy, pushNotif, toastFailure],
  );

  const onLandDonate = useCallback(
    (projectId: LandExpansionId, amount: number) => {
      if (shopBusy || cityFallenRef.current || !Number.isSafeInteger(amount) || amount < 1) return;
      if (modeRef.current === 'demo') {
        const project = demoLand.projects.find((candidate) => candidate.id === projectId);
        if (!project?.available) return;
        const donated = Math.min(amount, project.remaining, demoEconomy.coins);
        if (donated < 1) return;
        const funding: Record<string, unknown> = {};
        for (const current of demoLand.projects) funding[current.id] = current.funded;
        funding[projectId] = project.funded + donated;
        const nextLand = landExpansionState(funding);
        const unlocked = nextLand.unlocked.includes(projectId) && !demoLand.unlocked.includes(projectId);
        setDemoEconomy((economy) => ({ ...economy, coins: economy.coins - donated }));
        setDemoLand(nextLand);
        if (unlocked) {
          playSound('dawn_report');
          showEpic(`${project.name.toUpperCase()} OPEN`, 'built into the shared mainland by the whole village');
          pushEvent('🏞️', `${project.name} joined the city.`);
        } else {
          playSound('action_confirm');
        }
        pushNotif('🏞️', `${donated} Coins pledged to ${project.name}.`, 'good');
        return;
      }
      if (modeRef.current !== 'live' || mutatingRef.current) return;
      setShopBusy(true);
      mutatingRef.current = true;
      postLandDonate(projectId, amount)
        .then((res) => {
          setLiveEconomy(res.economy);
          setLiveLand(res.land);
          if (res.unlocked) {
            const opened = res.land.projects.find((project) => project.id === projectId);
            playSound('dawn_report');
            showEpic(`${(opened?.name ?? 'NEW DISTRICT').toUpperCase()} OPEN`, 'built into the shared mainland by the whole village');
            pushEvent('🏞️', res.message);
          } else {
            playSound('action_confirm');
          }
          pushNotif('🏞️', res.message, 'good');
        })
        .catch((err) => toastFailure(err, 'the pledge fell through, try again'))
        .finally(() => {
          setShopBusy(false);
          mutatingRef.current = false;
        });
    },
    [demoEconomy, demoLand, shopBusy, pushNotif, pushEvent, showEpic, toastFailure],
  );

  const onTreasuryInvest = useCallback(
    (projectId: LandExpansionId, amount: number) => {
      if (shopBusy || cityFallenRef.current || !Number.isSafeInteger(amount) || amount < 1) return;
      if (modeRef.current === 'demo') {
        const project = demoLand.projects.find((candidate) => candidate.id === projectId);
        if (!project?.available) return;
        const invested = Math.min(amount, project.remaining, demoTreasury.balance);
        if (invested < 1) return;
        const funding: Record<string, unknown> = {};
        for (const current of demoLand.projects) funding[current.id] = current.funded;
        funding[projectId] = project.funded + invested;
        const nextLand = landExpansionState(funding);
        const unlocked = nextLand.unlocked.includes(projectId) && !demoLand.unlocked.includes(projectId);
        setDemoTreasury((current) => ({
          ...current,
          balance: current.balance - invested,
          totalInvested: current.totalInvested + invested,
        }));
        setDemoLand(nextLand);
        if (unlocked) {
          playSound('dawn_report');
          showEpic(`${project.name.toUpperCase()} OPEN`, 'funded by the shared city treasury');
          pushEvent('🏛️', `${project.name} opened from the village treasury.`);
        } else {
          playSound('action_confirm');
        }
        pushNotif('🏛️', `${invested} treasury Coins invested in ${project.name}.`, 'good');
        return;
      }
      if (modeRef.current !== 'live' || mutatingRef.current) return;
      setShopBusy(true);
      mutatingRef.current = true;
      postTreasuryInvest(projectId, amount)
        .then((res) => {
          setLiveTreasury(res.treasury);
          setLiveLand(res.land);
          if (res.unlocked) {
            const opened = res.land.projects.find((project) => project.id === projectId);
            playSound('dawn_report');
            showEpic(`${(opened?.name ?? 'NEW DISTRICT').toUpperCase()} OPEN`, 'funded by the shared city treasury');
            pushEvent('🏛️', res.message);
          } else {
            playSound('action_confirm');
          }
          pushNotif('🏛️', res.message, 'good');
        })
        .catch((err) => toastFailure(err, 'the treasury transfer failed, try again'))
        .finally(() => {
          setShopBusy(false);
          mutatingRef.current = false;
        });
    },
    [demoLand, demoTreasury, shopBusy, pushNotif, pushEvent, showEpic, toastFailure],
  );

  const onLiveVote = useCallback(
    (optionId: string) => {
      if (cityFallenRef.current || mutatingRef.current) return;
      mutatingRef.current = true;
      postVote(optionId, liveCrisisIdRef.current)
        .then(async (res) => {
          setLiveCrisisVotes(res.crisisVotes);
          setLiveMyVote(res.yourCrisisVote);
          setLiveEconomy(res.economy);
          playSound('vote_cast');
          const tally = Object.values(res.crisisVotes).reduce((a, b) => a + b, 0);
          const share = tally > 0 ? Math.round(((res.crisisVotes[optionId as CrisisOptId] ?? 0) / tally) * 100) : 100;
          pushNotif('🗳️', `your vote is in, ${share}% of the city backs this choice`, 'good');
          // Mutation committed — release the single-flight guard BEFORE the
          // read-only refresh so a quick next tap is never silently swallowed
          // while /init is still in flight (slow devices hit this for real).
          mutatingRef.current = false;
          await refreshAfterContribution();
        })
        .catch((err) => toastFailure(err, 'vote failed, try again'))
        .finally(() => {
          mutatingRef.current = false;
        });
    },
    [pushNotif, refreshAfterContribution, toastFailure],
  );

  const onLivePledge = useCallback(
    (kind: PledgeKind) => {
      if (cityFallenRef.current || mutatingRef.current || !PLEDGE_KINDS.includes(kind)) return;
      mutatingRef.current = true;
      postPledge(kind)
        .then(async (res) => {
          setLiveMarked(res.marked);
          setLiveEconomy(res.economy);
          setLivePledge(res.pledge);
          playSound('pledge');
          pushNotif('🕯️', `you pledged for ${res.marked.name}`, 'good');
          handleRef.current?.pulseMarked?.();
          // Mutation committed — release the single-flight guard BEFORE the
          // read-only refresh so a quick next tap is never silently swallowed
          // while /init is still in flight (slow devices hit this for real).
          mutatingRef.current = false;
          await refreshAfterContribution();
        })
        .catch((err) => toastFailure(err, 'pledge failed, try again'))
        .finally(() => {
          mutatingRef.current = false;
        });
    },
    [pushNotif, refreshAfterContribution, toastFailure],
  );

  const onLiveStrategy = useCallback(
    (planId: string) => {
      const plan = STRATEGY_IDS.find((p) => p === planId);
      if (cityFallenRef.current || !plan || mutatingRef.current) return;
      mutatingRef.current = true;
      postStrategy(plan)
        .then(async (res) => {
          setLiveStrategyVotes(res.strategyVotes);
          setLiveEconomy(res.economy);
          setLiveMyPlan(res.yourStrategyVote);
          playSound('vote_cast');
          const tally = Object.values(res.strategyVotes).reduce((a, b) => a + b, 0);
          const share = tally > 0 ? Math.round(((res.strategyVotes[plan] ?? 0) / tally) * 100) : 100;
          pushNotif('📜', `plan locked, ${share}% of the council backs it`, 'good');
          // Mutation committed — release the single-flight guard BEFORE the
          // read-only refresh so a quick next tap is never silently swallowed
          // while /init is still in flight (slow devices hit this for real).
          mutatingRef.current = false;
          await refreshAfterContribution();
        })
        .catch((err) => toastFailure(err, 'the council is busy, try again'))
        .finally(() => {
          mutatingRef.current = false;
        });
    },
    [pushNotif, refreshAfterContribution, toastFailure],
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
            try {
              await postAvatar({ name: trimmed, gender: 'nonbinary', skin: 0, hair: 0, hairStyle: 0, outfit: 0 });
            } catch {
              popToast('Role saved. Survivor name can be set later.');
            }
          }
          pushNotif('🫡', `role set, ${roleLabel}`, 'good');
          setOnboardOpen(false);
          setNeedsOnboard(false);
          if (!coachSeen()) startIntroCoach(); // the advisor picks up where onboarding ends
          // pull fresh player-derived state from the server
          try {
            const init = await getInit();
            applyInit(init, false);
          } catch {
            popToast('Role saved. City refresh delayed.');
          }
        })
        .catch((err) => toastFailure(err, 'could not set your role, try again'))
        .finally(() => {
          setOnboardBusy(false);
          mutatingRef.current = false;
        });
    },
    [onboardBusy, applyInit, popToast, pushNotif, startIntroCoach, toastFailure],
  );
  const dismissOnboard = useCallback(() => {
    setOnboardOpen(false);
    setNeedsOnboard(false);
  }, []);

  // A dome mend just landed (the shared shield pool crossed the repair threshold):
  // grow the panel(s) back in the scene, chime, and tell the city. Occasional, so
  // a light touch — no full epic (those are reserved for raids + home rebuilds).
  const announceDomeRepairs = useCallback(
    (repaired: number[] | null | undefined) => {
      if (!repaired || repaired.length === 0) return;
      for (const seg of repaired) handleRef.current?.repairDomeSegment?.(seg);
      playSound('dome_repair');
      const n = repaired.length;
      popFloat('🛡 dome mended');
      pushNotif('🛡', `the city mended the dome (${n} panel${n === 1 ? '' : 's'})`, 'good');
      pushEvent('🛡', `The city repaired ${n} dome panel${n === 1 ? '' : 's'} from the shield reserve.`);
    },
    [popFloat, pushNotif, pushEvent],
  );

  // ADD LABOR, the shared "build from zero" contribution. Live: post the
  // energy-gated once/day build_city action, then re-fetch to pull the fresh
  // community progress. Demo: advance the local meter and unlock buildings on
  // the same thresholds so the panel + scene animate without a server.
  const onAddLabor = useCallback(() => {
    if (modeRef.current === 'live') {
      if (cityFallenRef.current || mutatingRef.current) return;
      const nextName = liveBuildRef.current?.next?.name ?? 'settlement';
      mutatingRef.current = true;
      const rebuildingNow = liveReconstructionRef.current?.active ?? false;
      postAction('build_city')
        .then(async (res) => {
          setLiveEnergy({ effective: res.effectiveEnergy, used: res.player.energyUsedToday });
          setLiveActions(res.yourActionsToday);
          setLiveEconomy(res.economy);
          setLiveReconstruction(res.reconstruction);
          setLiveDome(res.dome);
          if (res.treasuryPaid > 0) popFloat(`+${res.treasuryPaid} 🏛 TREASURY`);
          else if (res.coinsGained > 0) popFloat('+1 🪙');
          playSound('action_confirm');
          if (res.rebuilt) {
            // The whole city just restored someone's home — ownership preserved.
            handleRef.current?.rebuildHouse?.(res.rebuilt.index);
            playSound('rebuild_done');
            showEpic('THE CITY REBUILT A HOME', `u/${res.rebuilt.username}'s house stands again`);
            pushNotif('🏠', `the city rebuilt u/${res.rebuilt.username}'s home`, 'good');
            pushEvent('🏠', `The community restored u/${res.rebuilt.username}'s house.`);
          } else {
            pushNotif('🔨', rebuildingNow ? 'you added labor to the rebuild' : `you added a day's labor to the ${nextName}`, 'good');
          }
          announceDomeRepairs(res.domeRepaired);
          // Mutation committed — release the single-flight guard BEFORE the
          // read-only refresh so a quick next tap is never silently swallowed
          // while /init is still in flight (slow devices hit this for real).
          mutatingRef.current = false;
          await refreshAfterContribution();
        })
        .catch((err) => toastFailure(err, 'could not add labor, try again'))
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
      pushNotif('🏗️', `the ${nextDef.name} is built, we raised it together`, 'good');
    } else {
      demoBuildProgressRef.current = progress;
      setDemoBuildProgress(progress);
      pushNotif('🔨', `you added a day's labor to the ${nextDef.name}`, 'good');
    }
  }, [pushNotif, refreshAfterContribution, toastFailure]);

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

  // scene reports a clicked villager (null = clicked empty ground), selection
  // drives the bottom-left chip and re-targets villager dialogue.
  const onVillager = useCallback((name: string | null) => {
    villagerRef.current = name;
    setVillager(name);
  }, []);

  // scene reports a placed hut → grow the city, spend food, exit build mode.
  // Live mode: the hut is purely cosmetic, city numbers belong to the server.
  const onBuilt = useCallback(
    (x: number, _z: number) => {
      if (modeRef.current !== 'live') {
        setPopulation((p) => p + 4);
        setVitals((v) => ({ ...v, FOOD: clampVit('FOOD', v.FOOD - 5) }));
        addContrib('u/you', { houses: 1 });
        pushEvent('🔨', `A new hut rose in the ${x < 0 ? 'west' : 'east'} quarter, a family moves in.`);
        pushNotif('🔨', 'a new hut, +4 souls', 'good');
        popToast('Hut raised, +4 souls');
      } else {
        pushEvent('🔨', `A new hut rose in the ${x < 0 ? 'west' : 'east'} quarter, a family moves in.`);
        pushNotif('🔨', 'a new hut rises (cosmetic)', 'good');
        popToast('Hut raised');
      }
      buildModeRef.current = false;
      setBuildMode(false);
      handleRef.current?.setBuildMode?.(false);
    },
    [addContrib, pushEvent, pushNotif, popToast],
  );

  // VILLAGERS are now PLAYERS, the walking count tracks the number of distinct
  // contributors (people who opted into the game), clamped to a sane range.
  // Live mode keeps a small constant crowd (the server has no walker roster).
  const playerCount = Object.keys(contribs).length;
  useEffect(() => {
    const n = mode === 'live' ? 5 : Math.max(3, Math.min(MAX_VILLAGERS, playerCount));
    handleRef.current?.setVillagers(n);
  }, [playerCount, loaded, mode]);

  // COMPANIONS are permanently on, sync all four once the scene is ready.
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

  // ONE REDDITOR ONE HOUSE, houses reveal by contributor count. Demo synthesises
  // a growing neighborhood (you are the founder) so the mechanic is visible
  // without a backend; live uses the server house summary.
  useEffect(() => {
    if (mode !== 'demo') return undefined;
    const id = window.setInterval(() => {
      setDemoHouseTotal((n) => Math.min(120, n + 1)); // community keeps arriving
      setDemoYourContribution((c) => Math.min(60, c + 3)); // your house climbs tiers
    }, 3500);
    return () => window.clearInterval(id);
  }, [mode]);
  const houses = useMemo<HouseSummary | null>(() => {
    if (mode === 'live') return liveHouses;
    if (mode !== 'demo') return null;
    return {
      total: demoHouseTotal,
      cap: 240,
      founder: demoHouseTotal >= 1 ? { username: 'you' } : null,
      yours: demoHouseTotal >= 1 ? { index: 0, tier: tierForContribution(demoYourContribution), isFounder: true } : null,
      named: [
        { username: 'ashen_fox', index: 6, tier: 3 },
        { username: 'saltcedar', index: 14, tier: 2 },
      ],
      damaged: [],
    };
  }, [mode, liveHouses, demoHouseTotal, demoYourContribution]);
  useEffect(() => {
    handleRef.current?.setHouses?.(houses ? { ...houses, currentUsername: liveUsername || 'you' } : null);
  }, [houses, liveUsername, loaded]);
  // Raid ruins overlay: struck homes render as ruins with lingering smoke and
  // keep their owner label. setHouses re-applies internally on refresh; this
  // effect keeps the scene's damage set in sync with the server truth.
  useEffect(() => {
    handleRef.current?.setHouseDamage?.((houses?.damaged ?? []).map((d) => ({ index: d.index, status: d.status })));
  }, [houses, loaded]);
  // Energy dome: keep the scene's 6 shield panels in sync with the authoritative
  // dome state (charged by challenges, drained by raids, mended by the pool).
  const domeState = mode === 'live' ? liveDome : EMPTY_DOME;
  useEffect(() => {
    handleRef.current?.setDome?.(domeState.segments);
  }, [domeState, loaded]);

  const economy = mode === 'live' ? (liveEconomy ?? EMPTY_ECONOMY) : mode === 'demo' ? demoEconomy : EMPTY_ECONOMY;
  const landState = mode === 'live' ? (liveLand ?? EMPTY_LAND) : mode === 'demo' ? demoLand : EMPTY_LAND;
  const treasury = mode === 'live'
    ? (liveTreasury ?? EMPTY_TREASURY)
    : mode === 'demo'
      ? demoTreasury
      : EMPTY_TREASURY;
  useEffect(() => {
    handleRef.current?.setHouseCosmetics?.(economy.equipped);
  }, [economy, loaded]);
  useEffect(() => {
    handleRef.current?.setLandParcels?.(landState.unlocked);
  }, [landState, loaded]);

  // Horizon: live mode shows only real registry cities. Demo keeps its authored
  // fictional neighbors; missing live data leaves the horizon unlabelled.
  useEffect(() => {
    if (mode !== 'live' && !worldCities) return;
    handleRef.current?.setDistantCities?.(
      (worldCities ?? []).filter((c) => !c.isYou).slice(0, 5).map((c) => ({ name: c.subreddit, status: c.status })),
    );
  }, [mode, worldCities, loaded]);

  // Declutter: the floating in-world district/house banner labels are redundant
  // (and overlap in a narrow webview) while the CITY dashboard panel is open, so
  // fade them out then. CSS wins over the CSS2DRenderer's inline display.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('omd-hide-labels', dashOpen);
    return () => root.classList.remove('omd-hide-labels');
  }, [dashOpen]);

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

  // Time of day. LIVE: the sky follows the player's real local clock (each real
  // day is one game day, so dawn/dusk land where they do outside the window).
  // DEMO: the old fast ambient cycle (~12s per phase), where a dawn transition
  // also advances the demo day counter.
  useEffect(() => {
    const liveTimeOfDay = (): TimeOfDay => {
      const h = new Date().getHours();
      if (h >= 5 && h < 9) return 'dawn';
      if (h >= 9 && h < 17) return 'day';
      if (h >= 17 && h < 20) return 'dusk';
      return 'night';
    };
    const apply = (next: TimeOfDay) => {
      if (next === timeRef.current) return;
      timeRef.current = next;
      setTimeState(next);
      handleRef.current?.setTimeOfDay(next);
    };
    if (modeRef.current === 'live') apply(liveTimeOfDay());
    const id = window.setInterval(() => {
      if (modeRef.current === 'live') {
        apply(liveTimeOfDay());
        return;
      }
      const next = TIME_ORDER[(TIME_ORDER.indexOf(timeRef.current) + 1) % TIME_ORDER.length]!;
      apply(next);
      if (next === 'dawn' && modeRef.current === 'demo') {
        dayRef.current += 1;
        setDay(dayRef.current);
        pushEvent('🌅', `Dawn broke over the city, day ${dayRef.current}, still standing.`);
        pushNotif('🌅', `dawn breaks, day ${dayRef.current}`);
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
    pushNotif('🌅', 'new dawn, actions refreshed');
  }, [day, mode, pushNotif]);

  // LIVE tab handlers, one pledge / one crisis vote per "day" (session).
  const onPledge = useCallback(() => {
    if (pledgedRef.current) return;
    pledgedRef.current = true;
    setPledged((p) => Math.min(MARKED_GOAL, p + 3));
    setPledgedToday(true);
    // optional scene API (added by another agent), never crash if absent
    handleRef.current?.pulseMarked?.();
  }, []);
  const onCrisisVote = useCallback((id: CrisisOptId) => {
    if (votedRef.current) return;
    votedRef.current = true;
    setMyCrisisVote(id);
    setCrisisVotes((v) => ({ ...v, [id]: v[id] + 1 }));
  }, []);

  // Local villager dialogue: wave in the scene and get a scripted reply.
  // With a villager selected the greeting is tagged and THEY answer; otherwise
  // the old random-reply rotation plays out.
  const onSayHi = useCallback(() => {
    if (hiCooldownRef.current) return;
    hiCooldownRef.current = true;
    setHiCooldown(true);
    const target = villagerRef.current;
    if (hiReplyTimerRef.current !== null) window.clearTimeout(hiReplyTimerRef.current);
    if (target) {
      pushTalk('u/you', `${target}, hii 👋`, true);
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

  const openRedditUrl = useCallback((url: string) => {
    if (!url) return;
    playSound('button_click');
    navigateTo(url);
  }, []);

  const onChatterCategory = useCallback((category: ChatterCategory) => {
    chatterCategoryRef.current = category;
    setChatterCategory(category);
  }, []);

  const onChatterPost = useCallback(
    async (text: string): Promise<boolean> => {
      if (chatterBusy || mutatingRef.current) return false;
      const category = chatterCategoryRef.current;
      mutatingRef.current = true;
      setChatterBusy(true);
      try {
        const response = await postChatter(category, text);
        const author = response.postedAs.replace(/^u\//, '') || 'app account';
        pushNotif('💬', `Posted publicly to Reddit as u/${author}.`, 'good');
        await refreshChatter(category);
        return true;
      } catch (err) {
        toastFailure(err, 'Reddit did not confirm the comment. Nothing was posted.');
        return false;
      } finally {
        mutatingRef.current = false;
        setChatterBusy(false);
      }
    },
    [chatterBusy, pushNotif, refreshChatter, toastFailure],
  );

  const onOpenChatterThread = useCallback(() => {
    if (liveChatter?.threadUrl) openRedditUrl(liveChatter.threadUrl);
  }, [liveChatter, openRedditUrl]);

  // villager chip actions, wave at / deselect the clicked villager
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

  // BUILD, toggle placement mode in the scene (fallback toast if the scene
  // API isn't there yet).
  const toggleBuild = useCallback(() => {
    const h = handleRef.current;
    if (!h?.setBuildMode) {
      popToast('Building placement, coming soon');
      return;
    }
    const on = !buildModeRef.current;
    buildModeRef.current = on;
    setBuildMode(on);
    h.setBuildMode?.(on);
  }, [popToast]);

  // UPGRADE, bump a district's level for food; flash it in the scene.
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

  // DAWN ACTIONS, each spends once per day; refreshed by the day effect.
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
          .then(async (res) => {
            setLiveEnergy({ effective: res.effectiveEnergy, used: res.player.energyUsedToday });
            setLiveActions(res.yourActionsToday);
            setLiveReconstruction(res.reconstruction);
            setLiveDome(res.dome);
            playSound('action_confirm');
            popFloat(`+1 ${ACTION_JUICE[act] ?? '⚡'}`);
            pushNotif('✅', 'your work lands at the next dawn', 'good');
            if (res.unlockedTitle) pushNotif('🏅', `title unlocked, ${res.unlockedTitle}`, 'good');
            announceDomeRepairs(res.domeRepaired);
            const liveFrags = ACTION_FLASH[id] ?? [];
            const liveHit = poisRef.current.find((p) => liveFrags.some((f) => p.name.toUpperCase().includes(f)));
            if (liveHit) handleRef.current?.flashDistrict?.(liveHit.name);
            // Mutation committed — release the single-flight guard BEFORE the
            // read-only refresh so a quick next tap is never silently swallowed
            // while /init is still in flight (slow devices hit this for real).
            mutatingRef.current = false;
            await refreshAfterContribution();
          })
          .catch((err) => toastFailure(err, 'the action failed, try again'))
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
        pushNotif('🍞', 'Food grown, the greenhouse holds');
      } else if (id === 'repair_power') {
        setVitals((v) => ({ ...v, POWER: clampVit('POWER', v.POWER + 4) }));
        addContrib('u/you', { power: 4 });
        pushEvent('🔧', 'Hands on the generator through the morning, power steadies.');
        pushNotif('⚡', 'Generator steadied');
      } else if (id === 'treat_sick') {
        setVitals((v) => ({ ...v, MEDICINE: clampVit('MEDICINE', v.MEDICINE + 2) }));
        addContrib('u/you', { medicine: 2 });
        pushEvent('⛑️', 'The clinic worked the ward, the sick rest easier.');
        pushNotif('🩹', 'The sick rest easier');
      } else if (id === 'guard_wall') {
        setVitals((v) => ({
          ...v,
          THREAT: clampVit('THREAT', v.THREAT - 5),
          DEFENSE: clampVit('DEFENSE', v.DEFENSE + 2),
        }));
        pushEvent('🛡️', 'Extra watch posted on the wall, the raiders keep their distance.');
        pushNotif('🛡️', 'The wall holds');
      }
      // flash the matching district if the scene labeled one
      const frags = ACTION_FLASH[id] ?? [];
      const hit = poisRef.current.find((p) => frags.some((f) => p.name.toUpperCase().includes(f)));
      if (hit) handleRef.current?.flashDistrict?.(hit.name);
    },
    [addContrib, popFloat, pushEvent, pushNotif, refreshAfterContribution, toastFailure],
  );

  // Demo-only SCAVENGE, live V1 never opens this flow.
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
        pushNotif('🎒', `the scout returns, +${route.food} food`, 'good');
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

  // RAID, 9s of dread, then the wall decides on CURRENT defense.
  const startRaid = useCallback(() => {
    if (raidPhaseRef.current !== 'idle') return;
    raidPhaseRef.current = 'incoming';
    setRaidPhase('incoming');
    pushNotif('⚔', 'RAID, raiders are at the gate!', 'bad');
    handleRef.current?.setRaidWatch?.(true);
    handleRef.current?.setRaiders?.(true); // raider party appears at the gate
    // The wall decides on CURRENT defense; scale the siege cinematic to match.
    const willHold = vitalsRef.current.DEFENSE >= 40;
    // Demo volley: a strong dome turns every fireball; a weak one lets a few pierce.
    const demoVolley: RaidFireball[] = willHold
      ? [0, 1, 2, 3, 4].map((s) => ({ power: 40, segment: s, blocked: true }))
      : [
          { power: 45, segment: 0, blocked: true },
          { power: 72, segment: 1, blocked: false },
          { power: 38, segment: 2, blocked: true },
          { power: 80, segment: 3, blocked: false },
          { power: 55, segment: 4, blocked: true },
        ];
    handleRef.current?.playRaidCinematic?.({
      outcome: willHold ? 'held' : 'breach',
      fireballs: demoVolley,
      hitHouseIndices: [],
    });
    playRaidSfx(willHold ? 'held' : 'breach', demoVolley, !willHold);
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
          pushNotif('🔥', 'the wall was breached, 8 souls lost', 'bad');
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

  // SUBREDDIT SIMULATION, a community member buys a house (scene API, added
  // by another agent) or gifts resources into the city stores.
  const simBuyHouse = useCallback(
    (user: string) => {
      // A new redditor joins: their house rises through the one-house-per-person
      // system (setHouses reveals it from the growing contributor count), so the
      // demo town fills the same way a real city does, no ungated placements.
      setDemoHouseTotal((n) => Math.min(120, n + 1));
      setPopulation((p) => p + 3);
      addContrib(user, { houses: 1 });
      pushNotif('🏠', `${user} raised a house in the city`, 'good');
      pushEvent('🏠', `${user} raised a house in the city`);
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
  // the subreddit stirs every ~11s, DEMO only; in live mode the real city's
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
  const liveSubreddit = worldCities?.find((city) => city.isYou)?.subreddit ?? null;
  const subtitle = isLive
    ? `${liveSubreddit ? `${liveSubreddit} · ` : ''}${cityEpithet(liveTraitId ?? 'standard')} · ${liveStanding?.rankLabel ?? `cycle ${liveCycle}`}`
    : mode === 'demo'
      ? '3D town · demo mode'
      : mode === 'offline'
        ? 'live city unavailable'
        : 'connecting to the city';
  const vitalMaxes = isLive ? LIVE_VITAL_MAX : VITAL_MAX;
  const energyLeft = Math.max(0, liveEnergy.effective - liveEnergy.used);
  const liveLeaderboard = isLive ? (liveLb ?? []) : null;

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

  // District list mirrors the town's grow-in: a fresh Camp lists no districts;
  // they appear as the community raises buildings (same fraction the scene uses).
  // Offline/connecting (build === null) keeps the full directory as a fallback.
  const gatedPois = build ? pois.slice(0, Math.round(pois.length * Math.min(1, build.unlocked.length / 7))) : pois;

  return (
    <>
      {/* Portrait phones get an advisory, never a blocking gate. Reddit webviews
          can report sticky orientation states, so the game must stay usable. */}
      <div className="rotate-gate">
        <div className="rg-card">
          <div className="rg-i">📱</div>
          <b>ROTATE TO LANDSCAPE</b>
          <span>One More Dawn is a wide city, turn your phone sideways to hold the line.</span>
        </div>
      </div>
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
      <TopBar vitals={vitals} population={population} subtitle={subtitle} cityName={liveCityName} />
      {/* Progressive disclosure: ONE temporary HUD message at a time. Priority:
          dawn report teaser, urgent raid, the daily mission, then the rekindle
          offer. Dismissing one advances to the next. While the advisor speaks,
          the stage clears except the element she anchors. */}
      {(() => {
        if (!isLive || cityFallen || showOnboard) return null;
        const coachAnchor = coachStep !== null ? (COACH_STEPS[coachStep]?.anchor ?? null) : null;
        const missionAnchored = coachAnchor === '.mission-chip';
        if (coachStep !== null && !missionAnchored) return null;
        const teaserUp = dawnTeaserOpen && !dawnOpen && dawnReport !== null;
        const rekindleReady = liveLapsed >= BALANCE.rekindle.minStreak && liveLapsed > liveStreak && !hudDismissed.rekindle;
        const missionUp = liveChallenge !== null && !hudDismissed.mission;
        let slot: 'raid' | 'mission' | 'rekindle' | null = null;
        if (missionAnchored) slot = 'mission'; // the tour needs its target rendered
        else if (teaserUp) slot = null; // the dawn teaser (rendered below) owns the slot
        else if (raidDays <= 1 && !hudDismissed.raid) slot = 'raid';
        else if (rekindleReady) slot = 'rekindle';
        else if (missionUp) slot = 'mission';
        if (slot === 'raid') {
          return (
            <div className="hud mission-chip card-bit urgent">
              <span className="mi-ic">⚔</span>
              <span className="mi-tx">Raiders reach the wall at dawn. Spend energy on GUARD WALL.</span>
              <button type="button" className="p-x" onClick={() => setHudDismissed((d) => ({ ...d, raid: true }))} aria-label="Dismiss raid warning">
                ✕
              </button>
            </div>
          );
        }
        if (slot === 'mission' && liveChallenge) {
          return (
            <div className="hud mission-chip card-bit" title="Your personal mission for today">
              <span className="mi-ic">{liveChallenge.icon}</span>
              <span className="mi-lv">LV {liveChallenge.level}</span>
              {liveStreak >= 2 && <span className="mi-streak">🔥 {liveStreak}d</span>}
              <span className="mi-tx">{liveChallenge.text}</span>
              <span className={liveChallenge.done ? 'mi-pr done' : 'mi-pr'}>
                {liveChallenge.done ? `✓ +${liveChallenge.reward}` : `${liveChallenge.progress}/${liveChallenge.target}`}
              </span>
              <button type="button" className="p-x" onClick={() => setHudDismissed((d) => ({ ...d, mission: true }))} aria-label="Dismiss mission chip">
                ✕
              </button>
            </div>
          );
        }
        if (slot === 'rekindle') {
          return (
            <div className="hud rekindle-chip card-bit">
              <span className="rk-tx">🔥 Your {liveLapsed}-day flame went out while you were away.</span>
              <button type="button" className="rk-btn" disabled={rekindleBusy} onClick={onRekindle}>
                REKINDLE · {liveLapsed * BALANCE.rekindle.costPerDay} ⭐
              </button>
              <button type="button" className="p-x" onClick={() => setHudDismissed((d) => ({ ...d, rekindle: true }))} aria-label="Dismiss rekindle offer">
                ✕
              </button>
            </div>
          );
        }
        return null;
      })()}
      <DayPill time={time} day={day} raidSoon={raidDays <= 1} raidActive={raidPhase === 'incoming'} dawnEta={dawnEta} />
      {floats.length > 0 && (
        <div className="floats" aria-hidden="true">
          {floats.map((f) => (
            <span key={f.key} className="float-up">
              {f.text}
            </span>
          ))}
        </div>
      )}
      {epic && (
        <div className="epic-banner card-bit">
          <div className="ep-t">{epic.title}</div>
          <div className="ep-s">{epic.sub}</div>
        </div>
      )}
      <NotifStack notifs={notifs} />
      <CityDashboard
        open={dashOpen}
        setOpen={setDashboardOpen}
        tab={dashTab}
        setTab={setDashboardTab}
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
        pois={gatedPois}
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
          chatter: {
            state: liveChatter,
            category: chatterCategory,
            loading: chatterLoading,
            busy: chatterBusy,
            onCategory: onChatterCategory,
            onPost: onChatterPost,
            onOpenThread: onOpenChatterThread,
            onOpenMessage: openRedditUrl,
          },
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
        lbUnavailable={isLive && liveLbUnavailable}
        build={build}
        onAddLabor={onAddLabor}
        buildCtaDisabled={buildCtaDisabled}
        buildCtaLabel={buildCtaLabel}
        coachActive={coachStep !== null}
        reconstruction={mode === 'live' ? (liveReconstruction ?? EMPTY_RECONSTRUCTION) : EMPTY_RECONSTRUCTION}
        dome={domeState}
        economy={economy}
        landState={landState}
        treasury={treasury}
        shopBusy={shopBusy}
        shopDisabled={(mode !== 'live' && mode !== 'demo') || cityFallen}
        onShopPurchase={onShopPurchase}
        onShopEquip={onShopEquip}
        onLandDonate={onLandDonate}
        onTreasuryInvest={onTreasuryInvest}
      />
      {/* One flex bar so the fabs never overlap; the .hud wrapper (pointer-events:
          none) lets .hud * re-enable pointer events on the buttons inside.
          Sound, music, and the guide replay live in one ⚙ menu so the first
          screen stays uncluttered. Hidden while the advisor speaks, unless she
          is pointing at it. */}
      {(coachStep === null || COACH_STEPS[coachStep]?.anchor === '.fab-bar') && (
        <div className="hud fab-bar">
          <button
            type="button"
            className="board-fab card-bit"
            onClick={() => setBoardOpen((o) => !o)}
            aria-expanded={boardOpen}
          >
            📋 DASH
          </button>
          <button
            type="button"
            className="stats-fab card-bit"
            onClick={() => setStatsOpen((o) => !o)}
            aria-expanded={statsOpen}
          >
            📊 STATS
          </button>
          <div className="gear-wrap">
            {settingsOpen && (
              <div className="settings-pop card-bit">
                <label className="volume-control">
                  <span className="volume-head">
                    <span>🔉 MASTER VOLUME</span>
                    <output>{Math.round(masterVolume * 100)}%</output>
                  </span>
                  <input
                    className="volume-slider"
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={Math.round(masterVolume * 100)}
                    onChange={onVolumeChange}
                    onPointerUp={() => playSound('button_click')}
                    aria-label="Master volume"
                  />
                </label>
                <button
                  type="button"
                  className="mute-fab"
                  onClick={onToggleMute}
                  aria-pressed={muted}
                  aria-label={muted ? 'Unmute sound' : 'Mute sound'}
                >
                  {muted ? '🔇' : '🔊'} SOUND {muted ? 'OFF' : 'ON'}
                </button>
                <button
                  type="button"
                  className="mute-fab music-fab"
                  onClick={onToggleMusic}
                  aria-pressed={!musicMuted}
                  aria-label={musicMuted ? 'Play background music' : 'Stop background music'}
                >
                  {musicMuted ? '🎵' : '🎶'} MUSIC {musicMuted ? 'OFF' : 'ON'}
                </button>
                <button
                  type="button"
                  className="mute-fab guide-fab"
                  onClick={() => {
                    setSettingsOpen(false);
                    setCoachFlow('full');
                    setCoachStep(0);
                  }}
                  aria-label="Open the advisor guide"
                >
                  🧭 GUIDE
                </button>
              </div>
            )}
            <button
              type="button"
              className="gear-fab card-bit"
              onClick={() => setSettingsOpen((o) => !o)}
              aria-expanded={settingsOpen}
              aria-label="Sound, music, and guide settings"
              title="Settings"
            >
              ⚙
            </button>
          </div>
        </div>
      )}
      {coachStep !== null && !showOnboard && !showFallen && coachRing && (
        <div className="coach-ring" style={{ left: coachRing.left, top: coachRing.top, width: coachRing.width, height: coachRing.height }} />
      )}
      {coachStep !== null && !showOnboard && !showFallen && COACH_STEPS[coachStep] && (
        <CoachDialogue
          step={COACH_STEPS[coachStep]}
          stepIndex={coachFlow === 'context' ? 0 : coachStep}
          total={coachFlow === 'intro' ? INTRO_COACH_STEPS : coachFlow === 'context' ? 1 : COACH_STEPS.length}
          cityName={liveCityName ?? 'the last city'}
          aim={coachAim}
          onNext={() => {
            const lastStep = coachFlow === 'intro' ? INTRO_COACH_STEPS - 1 : COACH_STEPS.length - 1;
            if (coachFlow !== 'context' && coachStep < lastStep) {
              setCoachStep(coachStep + 1);
            } else {
              if (coachFlow === 'context') markContextualCoachSeen(coachStep);
              else markCoachSeen();
              setCoachStep(null);
              setCoachFlow(null);
            }
          }}
          onDismiss={() => {
            if (coachFlow === 'context') markContextualCoachSeen(coachStep);
            else if (coachFlow === 'intro') markCoachSeen();
            setCoachStep(null);
            setCoachFlow(null);
          }}
        />
      )}
      <StatsModal
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        day={day}
        vitals={vitals}
        population={population}
        pois={gatedPois}
        levels={levels}
        contribs={contribs}
        raidLog={raidLog}
        youStatus={worldYouStatus}
        vitalMaxes={vitalMaxes}
        lb={liveLeaderboard}
        lbUnavailable={isLive && liveLbUnavailable}
        liveRaidLikely={liveRaidLikely}
        liveRaidNote={liveRaidNote}
        worldCities={worldCities}
        worldLive={isLive}
        worldNote={worldNote}
      />
      <GameDashboard
        open={boardOpen}
        onClose={() => setBoardOpen(false)}
        day={day}
        build={build}
        vitals={vitals}
        vitalMaxes={vitalMaxes}
        population={population}
        events={events}
        raidDays={raidDays}
        raidLikely={liveRaidLikely}
        raidNote={liveRaidNote}
        housesTotal={houses?.total ?? 0}
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
          show={dawnTeaserOpen && !dawnOpen && coachStep === null}
          onDismiss={() => setDawnTeaserOpen(false)}
          onOpen={() => {
            setDawnTeaserOpen(false);
            setDawnOpen(true);
          }}
        />
      )}
      {showOnboard && <Onboarding busy={onboardBusy} defaultName={liveUsername} onEnter={onEnterCity} onDismiss={dismissOnboard} />}
      {showFallen && (
        <FallenScreen
          epitaph={fallenEpitaph}
          survivalDays={liveStanding?.survivalDays ?? 0}
          population={population}
          cycle={liveCycle}
          day={day}
          cityName={liveCityName ?? 'The city'}
        />
      )}
      <DawnReportModal report={dawnReport} open={dawnOpen} onClose={() => setDawnOpen(false)} />
      {buildMode ? (
        <div className="hud build-hint card-bit">🔨 tap open ground to raise a hut · tap BUILD to cancel</div>
      ) : (
        <div className="hud hint card-bit">drag to pan · scroll / pinch to zoom · click a district</div>
      )}
      <Loader pct={pct} done={loaded} />
    </>
  );
}
