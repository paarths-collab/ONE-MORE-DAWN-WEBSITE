import { BALANCE } from '../../shared/balance';
import type {
  CityState, DramaEvent, FactionId, Marked, TimelineEntry,
} from '../../shared/types';
import { winningFaction } from './resolver';

/**
 * Live Drama Feed (hook layer, Plan 1): assembled from game events on every
 * /init refetch — no realtime, no websockets. Pure and deterministic given its
 * inputs, so it is unit-tested directly.
 */

const ICONS: Record<DramaEvent['kind'], string> = {
  raid: '🚨',
  law: '⚖️',
  marked: '🕯️',
  action: '🔨',
  crisis: '⚡',
  city: '🏙️',
};

const event = (kind: DramaEvent['kind'], text: string, icon?: string): DramaEvent => ({
  icon: icon ?? ICONS[kind],
  text,
  kind,
});

/** Classify a resolver timeline line into a drama kind (best-effort regexes). */
const kindForLine = (line: string): DramaEvent['kind'] => {
  if (/red signal|raid/i.test(line)) return 'raid';
  if (/crisis/i.test(line)) return 'crisis';
  if (/memorial|was saved|resolve pledged|pledge/i.test(line)) return 'marked';
  if (/law|faction/i.test(line)) return 'law';
  if (/expedition|scout|citizen action/i.test(line)) return 'action';
  return 'city';
};

/**
 * ~8 events, newest first: today's live warnings and tallies, then yesterday's
 * dawn story from the timeline.
 */
export const buildDrama = (
  city: CityState,
  timeline: TimelineEntry[],
  dayActions: Record<string, number>,
  dayMissions: Record<string, number>,
  marked: Marked,
  factionInfluence: Record<FactionId, number>,
): DramaEvent[] => {
  const out: DramaEvent[] = [];

  // Raid status: imminent if tonight's passive rise alone would trigger it.
  if (city.status === 'fallen') {
    out.push(event('city', `The city fell on day ${city.day}. The fires are out.`, '🕯️'));
  } else if (city.threat + BALANCE.passiveThreatRise >= BALANCE.raid.triggerThreshold) {
    out.push(event('raid', 'The Red Signal glows on the horizon — a raid is imminent.'));
  }

  // The Marked: yesterday's dawn verdict, then today's rally.
  if (marked.savedYesterday) {
    out.push(
      marked.savedYesterday.saved
        ? event('marked', `${marked.savedYesterday.name} was saved at dawn — the city remembers.`)
        : event('marked', `${marked.savedYesterday.name} was lost at dawn — a memorial grows by the gate.`, '🖤'),
    );
  }
  out.push(
    event(
      'marked',
      `${marked.pledged}/${marked.goal} ${marked.unit} pledged to save ${marked.name}.`,
      '🤝',
    ),
  );

  // Law today, or the faction leading the race for tomorrow's.
  const activeLaw =
    city.activeLaw && city.lawExpiresDay >= city.day
      ? BALANCE.laws[city.activeLaw as FactionId]
      : null;
  if (activeLaw) {
    out.push(event('law', `${activeLaw.label} is law today — the ${city.activeLaw} hold the council.`));
  } else {
    const leader = winningFaction(factionInfluence);
    if (leader) {
      out.push(event('law', `The ${leader} lead today's influence — tomorrow's law is theirs to lose.`));
    }
  }

  // Today's activity aggregates.
  const runs = dayMissions['totalRuns'] ?? 0;
  if (runs > 0) {
    out.push(event('action', `${runs} expedition${runs > 1 ? 's' : ''} returned from the ruins today.`, '🎒'));
  }
  const acted = Object.values(dayActions).reduce((s, n) => s + n, 0);
  if (acted > 0) {
    out.push(event('action', `${acted} citizen action${acted > 1 ? 's' : ''} strengthened the city today.`));
  }

  // Low-vital warnings (thresholds derived from balance, not invented here).
  if (city.food < Math.ceil(city.population * BALANCE.foodPerPopulation) * 2) {
    out.push(event('city', 'The granary echoes — food runs out within two dawns.', '🍞'));
  }
  if (city.power < BALANCE.lowPowerThreshold) {
    out.push(event('city', 'The grid is failing — darkness weighs on everyone.', '🔌'));
  }
  if (city.medicine < BALANCE.sickness.threshold) {
    out.push(event('city', 'Medicine is short — the ward whispers of the cough.', '🩹'));
  }

  // Yesterday's dawn story, straight from the timeline.
  for (const line of timeline[0]?.events ?? []) {
    out.push(event(kindForLine(line), line));
  }

  return out.slice(0, BALANCE.drama.maxEvents);
};
