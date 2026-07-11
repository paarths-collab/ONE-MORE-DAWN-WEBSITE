// Every city gets its own ancient name, derived deterministically from the
// installation's worldSeed (hash of the subreddit id) — same pattern as the
// crisis/trait picks. 32×32 = 1024 combinations; two subreddits collide only
// if their seeds collide in the low 10 bits, which is fine for flavor text.

const FIRST = [
  'Vael', 'Thal', 'Ashen', 'Eld', 'Mor', 'Kar', 'Ory', 'Nym',
  'Sol', 'Umber', 'Bryn', 'Cael', 'Dun', 'Fen', 'Gilder', 'Hollow',
  'Iron', 'Jarn', 'Kel', 'Lorn', 'Myr', 'Noct', 'Ost', 'Pyre',
  'Quel', 'Rud', 'Sable', 'Tor', 'Ulm', 'Varn', 'Wyn', 'Zeph',
] as const;

const LAST = [
  'mar', 'eth', 'holm', 'spire', 'reach', 'fell', 'gard', 'heim',
  'wick', 'ford', 'crest', 'vale', 'moor', 'stead', 'march', 'haven',
  'rest', 'watch', 'fall', 'row', 'den', 'port', 'shade', 'loft',
  'barrow', 'cairn', 'keep', 'light', 'root', 'strand', 'vein', 'ward',
] as const;

/** Deterministic ancient city name for a worldSeed (uppercase, e.g. "THALMAR"). */
export const cityNameFromSeed = (seed: number): string => {
  const s = Math.abs(Math.trunc(seed)) >>> 0;
  const first = FIRST[s % FIRST.length]!;
  const last = LAST[Math.trunc(s / FIRST.length) % LAST.length]!;
  return (first + last).toUpperCase();
};

/**
 * The city's epithet — its "house words," tied to the founding trait the
 * server already rolls per (worldSeed, cycle). Name + epithet correlate:
 * a Frozen Start city IS the frostbound one, wherever it's mentioned.
 */
export const cityEpithet = (traitId: string): string => {
  switch (traitId) {
    case 'frozen': return 'the frostbound';
    case 'crowded': return 'the teeming';
    case 'militarized': return 'the walled';
    case 'sick': return 'the fevered';
    default: return 'the last refuge'; // 'standard' + any future trait
  }
};
