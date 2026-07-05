import { makeRng } from './rng';

/**
 * Deterministic, seeded name generation (Reddit-native hook layer, Plan 1).
 * Shared so the client can reproduce the same names from the same seeds.
 * Pools are contracts: names are picked by seeded index, so REORDERING or
 * REMOVING entries recolors every world. Append only.
 */

const ADJECTIVES = [
  'ashen', 'quiet', 'hollow', 'salt', 'rust', 'pale', 'feral', 'brave',
  'sable', 'lone', 'grey', 'amber', 'bitter', 'dust', 'ember', 'frost',
  'gaunt', 'iron', 'north', 'raw', 'still', 'worn', 'winter', 'copper',
] as const;

const NOUNS = [
  'fox', 'marrow', 'cedar', 'lantern', 'sparrow', 'wall', 'harbor', 'thistle',
  'crow', 'signal', 'garden', 'wolf', 'ash', 'beacon', 'cinder', 'dawn',
  'fern', 'gale', 'hare', 'moth', 'owl', 'reed', 'vale', 'wren',
] as const;

/**
 * Reddit-handle-ish citizen name, deterministic per seed: "ashen_fox",
 * "quiet_marrow". 24x24 pool = 576 combinations.
 */
export const citizenName = (seed: number): string => {
  const rng = makeRng(seed >>> 0);
  return `${ADJECTIVES[rng.int(ADJECTIVES.length)]}_${NOUNS[rng.int(NOUNS.length)]}`;
};

// ---------- The Marked: daily objective pool ----------

export type MarkedPoolEntry = {
  id: string;
  name: string;
  kind: 'person' | 'place' | 'symbol';
  blurb: string; // one line of stakes
};

/** People, places, and symbols the city rallies to save before dawn. */
export const MARKED_POOL: readonly MarkedPoolEntry[] = [
  {
    id: 'mira',
    name: 'Mira, the greenhouse child',
    kind: 'person',
    blurb: 'She knows which seedlings still take root in ash. Lose her, and spring never comes.',
  },
  {
    id: 'old_ansel',
    name: 'Old Ansel, the lamplighter',
    kind: 'person',
    blurb: 'Every dusk he walks the wall with his flame. The dark has started walking with him.',
  },
  {
    id: 'ferro_twins',
    name: 'The Ferro twins, message runners',
    kind: 'person',
    blurb: "Two kids, one route through raider ground. The city's word travels in their shoes.",
  },
  {
    id: 'refugee_convoy',
    name: 'The Refugee Convoy',
    kind: 'person',
    blurb: 'Thirty souls strung out on the north road, one cold night from the gate.',
  },
  {
    id: 'lost_scouts',
    name: 'The Lost Scouts',
    kind: 'person',
    blurb: 'Three of ours, overdue beyond the ridge. Nobody gets left in the ruins.',
  },
  {
    id: 'north_wall',
    name: 'The North Wall',
    kind: 'place',
    blurb: 'If it cracks, the raiders walk in standing up. Everything behind it is everything we have.',
  },
  {
    id: 'hospital_ward',
    name: 'The Hospital Ward',
    kind: 'place',
    blurb: 'Forty beds and one failing generator between the sick and the cold.',
  },
  {
    id: 'generator_core',
    name: 'The Generator Core',
    kind: 'place',
    blurb: 'The heartbeat of every light in the city. Tonight it is skipping beats.',
  },
  {
    id: 'greenhouse_dome',
    name: 'The Greenhouse Dome',
    kind: 'place',
    blurb: 'Glass, heat, and the only green left for miles. The frost knows it too.',
  },
  {
    id: 'deep_well',
    name: 'The Deep Well',
    kind: 'place',
    blurb: 'The last clean water. Something upstream has fouled all the rest.',
  },
  {
    id: 'last_archive',
    name: 'The Last Archive',
    kind: 'symbol',
    blurb: 'Every name, every map, every promise the old world kept. Paper burns fast.',
  },
  {
    id: 'dawn_bell',
    name: 'The Dawn Bell',
    kind: 'symbol',
    blurb: 'It has rung every survived morning since day one. A silent dawn breaks more than sleep.',
  },
];

/**
 * Deterministic pick of a Marked objective of the given kind. Same seed ->
 * same { name, blurb }. Callers salt the seed per (worldSeed, cycle, day) —
 * see src/server/game/marked.ts.
 */
export const markedName = (seed: number, kind: MarkedPoolEntry['kind']): MarkedPoolEntry => {
  const pool = MARKED_POOL.filter((e) => e.kind === kind);
  return pool[makeRng(seed >>> 0).int(pool.length)]!;
};
