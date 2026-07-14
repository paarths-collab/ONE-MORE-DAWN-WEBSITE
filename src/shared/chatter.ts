export const CHATTER_MAX_LENGTH = 250;
export const CHATTER_COOLDOWN_SECONDS = 15;
export const CHATTER_DUPLICATE_SECONDS = 10 * 60;

export const CHATTER_CATEGORIES = [
  { id: 'strategy', icon: '🧭', label: 'Strategy' },
  { id: 'raid', icon: '⚔️', label: 'Raid' },
  { id: 'rebuilding', icon: '🔨', label: 'Rebuilding' },
  { id: 'general', icon: '💬', label: 'General' },
] as const;

export type ChatterCategory = (typeof CHATTER_CATEGORIES)[number]['id'];

export type ChatterMessage = {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  permalink: string;
};

export type ChatterState = {
  type: 'chatter';
  ready: boolean;
  weekKey: string | null;
  cityDay: number;
  category: ChatterCategory;
  rootCommentId: string | null;
  threadUrl: string | null;
  messages: ChatterMessage[];
  feedAvailable: boolean;
  maxLength: number;
  cooldownSeconds: number;
  attributionNotice: string;
};

export type ChatterPostRequest = {
  category: ChatterCategory;
  text: string;
};

export type ChatterPostResponse = {
  type: 'chatter-post';
  message: ChatterMessage;
  postedAs: string;
  threadUrl: string;
};

export const isChatterCategory = (value: unknown): value is ChatterCategory =>
  typeof value === 'string' && CHATTER_CATEGORIES.some((category) => category.id === value);

const LINK_PATTERN = /(?:https?:\/\/|www\.|(?:^|\s)[a-z0-9-]+\.(?:com|net|org|gg|io)(?:[\s/]|$))/i;
const ABUSE_PATTERN = /\b(?:kill\s+yourself|kys|doxx?(?:ed|ing)?|swatt?(?:ed|ing)?)\b/i;

export type ChatterTextResult =
  | { ok: true; text: string; duplicateKey: string }
  | { ok: false; message: string };

export const validateChatterText = (value: unknown): ChatterTextResult => {
  if (typeof value !== 'string') return { ok: false, message: 'Write a message first.' };
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, message: 'Write a message first.' };
  if ([...text].length > CHATTER_MAX_LENGTH) {
    return { ok: false, message: `Keep city chatter to ${CHATTER_MAX_LENGTH} characters.` };
  }
  if (LINK_PATTERN.test(text)) return { ok: false, message: 'Links are disabled in City Chatter for launch.' };
  if (ABUSE_PATTERN.test(text)) return { ok: false, message: 'That message cannot be posted to City Chatter.' };
  return { ok: true, text, duplicateKey: text.toLocaleLowerCase('en-US') };
};

const pad = (value: number): string => String(value).padStart(2, '0');

export const chatterWeekStart = (date: Date): Date => {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const mondayOffset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  return start;
};

export const chatterWeekKey = (date: Date): string => {
  const start = chatterWeekStart(date);
  return `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export const chatterWeekLabel = (date: Date): string => {
  const start = chatterWeekStart(date);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const startLabel = `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`;
  const endLabel = `${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}`;
  return `${startLabel}–${endLabel}, ${end.getUTCFullYear()}`;
};
