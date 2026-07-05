import type {
  ActionType,
  CityStatusTag,
  DramaEvent,
  FactionId,
  Marked,
  MissionRoute,
  PledgeKind,
  ResourceDelta,
  Role,
  StrategyPlanId,
} from '../../shared/types';

/**
 * Display-only definitions for the mobile hook-layer client. Labels/icons live
 * here so screen code stays lean; game numbers stay server-side
 * (shared/balance.ts) — the effect strings below mirror them for display and
 * are not used in math.
 */

export type RoleDef = { icon: string; name: string; bonus: string };

export const ROLE_IDS: readonly Role[] = [
  'scout',
  'engineer',
  'medic',
  'farmer',
  'guard',
  'speaker',
];

export const ROLE_DEFS: Record<Role, RoleDef> = {
  scout: { icon: '🧭', name: 'Scout', bonus: '+15s air on expeditions · reveals crates' },
  engineer: { icon: '🔧', name: 'Engineer', bonus: 'Repairs power 50% faster' },
  medic: { icon: '⛑️', name: 'Medic', bonus: 'Treats sickness 50% better' },
  farmer: { icon: '🌾', name: 'Farmer', bonus: 'Grows 50% more food' },
  guard: { icon: '🛡️', name: 'Guard', bonus: 'Reduces threat 50% faster' },
  speaker: { icon: '📣', name: 'Speaker', bonus: 'Every action also lifts morale' },
};

export type ActionDef = {
  id: ActionType;
  icon: string;
  title: string;
  effect: string;
  role: Role;
  toast: string;
};

export const ACTION_DEFS: readonly ActionDef[] = [
  { id: 'grow_food', icon: '🌾', title: 'Grow Food', effect: '+3 🍞', role: 'farmer', toast: '🍞 Food grown — the greenhouse holds' },
  { id: 'repair_power', icon: '🔧', title: 'Repair Power', effect: '+4 ⚡', role: 'engineer', toast: '⚡ Generator steadied' },
  { id: 'treat_sick', icon: '⛑️', title: 'Treat Sick', effect: '+2 🩹', role: 'medic', toast: '🩹 The sick rest easier' },
  { id: 'guard_wall', icon: '🛡️', title: 'Guard Wall', effect: '−5 ☠️ +2 🛡️', role: 'guard', toast: '🛡️ The wall holds' },
];

export type PlanDef = {
  icon: string;
  title: string;
  fill: string;
  action: ActionType | null;
};

export const PLAN_IDS: readonly StrategyPlanId[] = [
  'stockpile_food',
  'repair_power',
  'prepare_raid',
  'send_scouts',
  'treat_sick',
];

export const PLAN_DEFS: Record<StrategyPlanId, PlanDef> = {
  stockpile_food: { icon: '🍞', title: 'Stockpile Food', fill: 'var(--warn)', action: 'grow_food' },
  repair_power: { icon: '⚡', title: 'Repair Power', fill: 'var(--good)', action: 'repair_power' },
  prepare_raid: { icon: '🛡️', title: 'Prepare for Raid', fill: 'var(--danger)', action: 'guard_wall' },
  send_scouts: { icon: '🧭', title: 'Send Scouts', fill: 'var(--accent)', action: null },
  treat_sick: { icon: '⛑️', title: 'Treat the Sick', fill: 'var(--blue)', action: 'treat_sick' },
};

export type FactionDef = { icon: string; name: string; fill: string };

export const FACTION_IDS: readonly FactionId[] = ['builders', 'wardens', 'seekers', 'hearth'];

export const FACTION_DEFS: Record<FactionId, FactionDef> = {
  builders: { icon: '🔧', name: 'The Builders', fill: 'var(--warn)' },
  wardens: { icon: '🛡️', name: 'The Wardens', fill: 'var(--danger)' },
  seekers: { icon: '🧭', name: 'The Seekers', fill: 'var(--accent)' },
  hearth: { icon: '🕯️', name: 'The Hearth', fill: 'var(--good)' },
};

export type RouteDef = { id: MissionRoute; icon: string; title: string; blurb: string };

export const ROUTE_DEFS: readonly RouteDef[] = [
  { id: 'safe', icon: '🌤️', title: 'Safe Route', blurb: '4 crates · few hazards' },
  { id: 'deep', icon: '🌆', title: 'Deep Ruins', blurb: '7 crates · real risk' },
  { id: 'desperate', icon: '☠️', title: 'Desperate Dive', blurb: '9 crates · deadly, richer loot' },
];

// ---------- hook layer (Marked / pledge / drama) ----------

/** Optimistic bump applied to the Marked bar while the pledge is in flight. */
export const PLEDGE_OPTIMISTIC_BUMP = 3;

/** Past-tense line per pledge, used to build the confirmation toast. */
export const PLEDGE_VERBS: Record<PledgeKind, string> = {
  stand_vigil: 'You stood vigil',
  share_rations: 'You shared rations',
  run_messages: 'You ran messages',
  back_council: 'You backed the council',
};

export const MARKED_KIND_ICON: Record<Marked['kind'], string> = {
  person: '🧒',
  place: '🏰',
  symbol: '🕯️',
};

/** "Mira, the greenhouse child" → "Mira"; "The North Wall" → itself. */
export const markedShortName = (marked: Marked): string =>
  marked.name.split(',')[0]?.trim() ?? marked.name;

/** Verb for the goal framing: people are saved, places/symbols protected. */
export const markedGoalWord = (marked: Marked): string =>
  marked.kind === 'person' ? 'saved' : 'protected';

export const markedPct = (marked: Marked): number =>
  Math.max(0, Math.min(100, Math.round((marked.pledged / Math.max(1, marked.goal)) * 100)));

/** Accent color per drama-event kind (Live Drama Feed). */
export const DRAMA_TINTS: Record<DramaEvent['kind'], string> = {
  action: 'var(--good)',
  raid: 'var(--danger)',
  law: 'var(--violet)',
  marked: 'var(--accent)',
  city: 'var(--blue)',
  crisis: 'var(--warn)',
};

// ---------- resource formatting ----------

export type ResourceKey = keyof ResourceDelta;

export const RESOURCE_ICONS: Record<ResourceKey, string> = {
  population: '👥',
  food: '🍞',
  power: '⚡',
  medicine: '🩹',
  morale: '🙂',
  threat: '☠️',
  defense: '🛡️',
};

const DELTA_ORDER: readonly ResourceKey[] = [
  'population',
  'food',
  'power',
  'medicine',
  'morale',
  'threat',
  'defense',
];

/** "+30 👥 · −20 🍞 · +4 🙂" — compact effects line for crisis options. */
export const formatDelta = (delta: ResourceDelta): string => {
  const parts: string[] = [];
  for (const key of DELTA_ORDER) {
    const v = delta[key];
    if (v === undefined || v === 0) continue;
    parts.push(`${v > 0 ? '+' : '−'}${Math.abs(v)} ${RESOURCE_ICONS[key]}`);
  }
  return parts.length > 0 ? parts.join('  ') : 'no immediate change';
};

export const MEDALS: readonly string[] = ['🥇', '🥈', '🥉'];

// ---------- World of Cities (WORLD tab) ----------

export type WorldStatusDef = { icon: string; label: string; color: string; flavor: string };

/**
 * Node styling + one-line flavor per city status on the world map.
 * Colors are mirrored by the `.omd-wnode--{status}` rules in omd.css
 * (`--node` custom property) — keep the two in sync.
 */
export const WORLD_STATUS_DEFS: Record<CityStatusTag, WorldStatusDef> = {
  thriving: { icon: '🌿', label: 'Thriving', color: '#7fd6a2', flavor: 'Holding the line — and then some.' },
  holding: { icon: '🕯️', label: 'Holding', color: '#ffcf70', flavor: 'Holding the line.' },
  strained: { icon: '🩸', label: 'Strained', color: '#ff8a3d', flavor: 'Rationing candles. Still standing.' },
  under_raid: { icon: '🚨', label: 'Under raid', color: '#ff5b4d', flavor: 'Under raid — the wall decides tonight.' },
  fallen: { icon: '💀', label: 'Fallen', color: '#6b7089', flavor: 'The lights went out.' },
};
