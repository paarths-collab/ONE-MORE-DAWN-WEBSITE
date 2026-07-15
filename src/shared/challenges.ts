// Daily personal missions: every survivor gets their own task each day, and
// the difficulty climbs a 100-level ladder as they contribute. Fully
// procedural: the pick is seeded from (userId, day, worldSeed) — the same
// deterministic pattern as crises/traits — so there is nothing to store and
// no two neighbors share a task. 25 templates × level-scaled targets × 100
// levels = well over 1000 distinct missions.

import type { ActionType, Role } from './types';
import { hashString } from './rng';

export const CHALLENGE_LEVELS = 100;

/** Survivor level 1..100 from lifetime contribution (slow, sqrt-shaped curve). */
export const levelForContribution = (c: number): number => {
  const safe = Number.isFinite(c) && c > 0 ? c : 0;
  return Math.min(CHALLENGE_LEVELS, 1 + Math.floor(Math.sqrt(safe)));
};

/** What the mission asks the player to do (all provable from existing state). */
export type ChallengeKind =
  | 'action' // N of one specific daily action
  | 'any_action' // N daily actions of any kind
  | 'vote' // cast the crisis vote
  | 'strategy' // back a council plan
  | 'pledge' // pledge for The Marked
  | 'civic' // vote + back a plan
  | 'devout'; // vote + pledge

type Template = {
  kind: ChallengeKind;
  icon: string;
  action?: ActionType;
  /** {n} = target count, {act} = action label. */
  text: string;
};

const ACTION_LABEL: Record<ActionType, string> = {
  grow_food: 'Grow Food',
  repair_power: 'Repair Power',
  treat_sick: 'Treat the Sick',
  guard_wall: 'Guard the Wall',
  build_city: 'Add Labor',
};

// 25 templates. Flavor varies so repeat kinds still read as fresh missions.
const TEMPLATES: Template[] = [
  { kind: 'action', action: 'grow_food', icon: '🌾', text: 'Feed the stores: {act} ×{n} today.' },
  { kind: 'action', action: 'grow_food', icon: '🍞', text: 'The granary runs thin. {act} ×{n}.' },
  { kind: 'action', action: 'repair_power', icon: '🔧', text: 'Keep the lights on: {act} ×{n} today.' },
  { kind: 'action', action: 'repair_power', icon: '⚡', text: 'The grid sparks and fails. {act} ×{n}.' },
  { kind: 'action', action: 'treat_sick', icon: '⛑️', text: 'The ward is full: {act} ×{n} today.' },
  { kind: 'action', action: 'treat_sick', icon: '🩹', text: 'Fevers spread in the shelter rows. {act} ×{n}.' },
  { kind: 'action', action: 'guard_wall', icon: '🛡️', text: 'Take a watch shift: {act} ×{n} today.' },
  { kind: 'action', action: 'guard_wall', icon: '🌙', text: 'The night is long. {act} ×{n}.' },
  { kind: 'action', action: 'build_city', icon: '🔨', text: 'Raise the next stone: {act} ×{n} today.' },
  { kind: 'action', action: 'build_city', icon: '🏗️', text: 'The scaffolds stand empty. {act} ×{n}.' },
  { kind: 'any_action', icon: '💪', text: 'Put your back into it: take {n} actions of any kind.' },
  { kind: 'any_action', icon: '🔥', text: 'No idle hands today: {n} actions, your choice.' },
  { kind: 'any_action', icon: '⭐', text: 'Maren is watching. Spend {n} energy on the city.' },
  { kind: 'vote', icon: '🗳️', text: "Make your voice count: vote on today's crisis." },
  { kind: 'vote', icon: '⚖️', text: 'The council is split. Cast your crisis vote.' },
  { kind: 'vote', icon: '📜', text: 'History remembers voters. Decide the crisis.' },
  { kind: 'strategy', icon: '🏛️', text: "Back a council plan for tomorrow's dawn." },
  { kind: 'strategy', icon: '🧭', text: 'Chart the course: back a strategy today.' },
  { kind: 'pledge', icon: '🕯️', text: 'One soul needs you tonight. Pledge for The Marked.' },
  { kind: 'pledge', icon: '❤️', text: "Don't let the night take them. Pledge for The Marked." },
  { kind: 'civic', icon: '🏙️', text: 'Full citizen: vote the crisis AND back a plan.' },
  { kind: 'civic', icon: '🎖️', text: 'Lead by example: cast both votes today.' },
  { kind: 'devout', icon: '🌅', text: 'Heart and voice: vote the crisis AND pledge for The Marked.' },
  { kind: 'devout', icon: '🙏', text: 'Keep faith with the city: vote and pledge today.' },
  { kind: 'any_action', icon: '🏠', text: 'Your house grows with your deeds: take {n} actions.' },
];

export type Challenge = {
  id: string; // stable per (user, day): template index + target
  icon: string;
  text: string;
  kind: ChallengeKind;
  action: ActionType | null;
  target: number;
  level: number; // the survivor's mission level 1..100
  reward: number; // bonus contribution on completion
};

/** Target count scaling: levels 1-19 ask 1, 20-59 ask 2, 60+ ask 3 (capped by daily energy). */
const targetForLevel = (level: number, template: Template, maxActions: number): number => {
  if (template.kind === 'civic' || template.kind === 'devout') return 2;
  if (template.kind !== 'action' && template.kind !== 'any_action') return 1;
  if (template.action === 'build_city') return 1;
  const scaled = level >= 60 ? 3 : level >= 20 ? 2 : 1;
  return Math.max(1, Math.min(scaled, maxActions));
};

/** Completion bonus grows gently with level (contribution points). */
export const rewardForLevel = (level: number): number => 2 + Math.floor(level / 10);

/** The player's mission for (userId, day) — deterministic, no storage. */
export const dailyChallenge = (
  userId: string,
  day: number,
  worldSeed: number,
  totalContribution: number,
  maxActions = 3,
): Challenge => {
  const level = levelForContribution(totalContribution);
  const roll = hashString(`${userId}:${day}:${worldSeed}:mission`);
  const t = TEMPLATES[roll % TEMPLATES.length]!;
  const target = targetForLevel(level, t, maxActions);
  const text = t.text
    .replace(/\{n\}/g, String(target))
    .replace(/\{act\}/g, t.action ? ACTION_LABEL[t.action] : '');
  return {
    id: `${roll % TEMPLATES.length}:${target}`,
    icon: t.icon,
    text,
    kind: t.kind,
    action: t.action ?? null,
    target,
    level,
    reward: rewardForLevel(level),
  };
};

export const isChallenge = (value: unknown): value is Challenge => {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'id' in value && typeof value.id === 'string' &&
    'icon' in value && typeof value.icon === 'string' &&
    'text' in value && typeof value.text === 'string' &&
    'kind' in value && typeof value.kind === 'string' &&
    'action' in value && (value.action === null || typeof value.action === 'string') &&
    'target' in value && typeof value.target === 'number' && value.target >= 1 &&
    'level' in value && typeof value.level === 'number' && value.level >= 1 && value.level <= CHALLENGE_LEVELS &&
    'reward' in value && typeof value.reward === 'number' && value.reward >= 0
  );
};

/** Progress toward the mission, provable from state the server already keeps. */
export const challengeProgress = (
  ch: Challenge,
  state: {
    actionsToday: Partial<Record<ActionType, number>>;
    voted: boolean;
    backedPlan: boolean;
    pledged: boolean;
  },
): { progress: number; done: boolean } => {
  const acts = Object.values(state.actionsToday).reduce((a, b) => a + (b ?? 0), 0);
  let progress = 0;
  switch (ch.kind) {
    case 'action':
      progress = ch.action ? (state.actionsToday[ch.action] ?? 0) : 0;
      break;
    case 'any_action':
      progress = acts;
      break;
    case 'vote':
      progress = state.voted ? 1 : 0;
      break;
    case 'strategy':
      progress = state.backedPlan ? 1 : 0;
      break;
    case 'pledge':
      progress = state.pledged ? 1 : 0;
      break;
    case 'civic':
      progress = (state.voted ? 1 : 0) + (state.backedPlan ? 1 : 0);
      break;
    case 'devout':
      progress = (state.voted ? 1 : 0) + (state.pledged ? 1 : 0);
      break;
  }
  const clamped = Math.min(progress, ch.target);
  return { progress: clamped, done: clamped >= ch.target };
};

// ---------- Per-role daily duty (signature task per role) ----------
// A role task is a Challenge — same type, same progress/reward plumbing — but
// keyed by ROLE instead of a random roll, so it's deterministic (nothing to
// store) and every survivor with a role feels their choice in the daily loop.
// This is on TOP of the resolver's roleBonus production multiplier: the bonus
// rewards playing to your role, the duty gives the role a face in the HUD.
const ROLE_TASK_TEMPLATES: Record<Role, Template> = {
  farmer: { kind: 'action', action: 'grow_food', icon: '🌾', text: 'Work the fields: {act} ×{n} today — the city eats because of you.' },
  engineer: { kind: 'action', action: 'repair_power', icon: '🔧', text: 'Keep the grid alive: {act} ×{n} today.' },
  medic: { kind: 'action', action: 'treat_sick', icon: '⛑️', text: 'Tend the ward: {act} ×{n} today.' },
  guard: { kind: 'action', action: 'guard_wall', icon: '🛡️', text: 'Hold the wall: {act} ×{n} today.' },
  speaker: { kind: 'any_action', icon: '📣', text: 'Rally the city: take {n} action{s} today — every deed lifts morale.' },
  scout: { kind: 'civic', icon: '🧭', text: 'Scout ahead: vote the crisis AND back a council plan.' },
};

/** The role duty's completion bonus (contribution points); grows gently with level. */
export const roleTaskReward = (level: number): number => 2 + Math.floor(level / 15);

/**
 * The player's signature duty for their ROLE — deterministic from (role,
 * lifetime contribution), so like the daily challenge there is nothing to
 * store. Same Challenge shape, so it reuses challengeProgress and the reward
 * plumbing untouched.
 */
export const roleTask = (role: Role, totalContribution: number, maxActions = 3): Challenge => {
  const level = levelForContribution(totalContribution);
  const t = ROLE_TASK_TEMPLATES[role];
  const target = targetForLevel(level, t, maxActions);
  const text = t.text
    .replace(/\{n\}/g, String(target))
    .replace(/\{s\}/g, target === 1 ? '' : 's')
    .replace(/\{act\}/g, t.action ? ACTION_LABEL[t.action] : '');
  return {
    id: `role:${role}:${target}`,
    icon: t.icon,
    text,
    kind: t.kind,
    action: t.action ?? null,
    target,
    level,
    reward: roleTaskReward(level),
  };
};
