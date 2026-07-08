export type WorldGateInfo = {
  eligible: boolean;
  subscribers: number | null;
  minSubscribers: number;
  cityCount: number;
};

export const isLocalHarnessHost = (host: string): boolean =>
  host === 'localhost' || host === '127.0.0.1';

export const worldUnavailableMessage = (w: WorldGateInfo): string | null => {
  if (!w.eligible) {
    const subCount = w.subscribers === null ? 'unknown subscribers' : `${w.subscribers}/${w.minSubscribers} subscribers`;
    return `This city is not on the world map yet (${subCount}). Keep playing locally.`;
  }
  if (w.cityCount === 0) {
    return 'No cities have reported to the world registry yet. Check back after the next dawn.';
  }
  return null;
};

export const raidNoteFromEvents = (
  events: readonly string[] | undefined,
  raidLikely: boolean,
): string | null => {
  const line = events?.find((e) => /raid|red signal/i.test(e)) ?? null;
  return line ?? (raidLikely ? '⚠ Red Signal forecast: raiders may move at dawn.' : null);
};
