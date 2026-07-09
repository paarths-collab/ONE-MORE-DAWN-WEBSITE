import type {
  ActionType,
  AvatarConfig,
  CityState,
  FactionId,
  PledgeKind,
  PlayerProfile,
  Role,
  StrategyPlanId,
  TimelineEntry,
} from '../../shared/types';
import type { PledgerEntry } from './pledges';
import { freshPlayer } from './dayLogic';
import { stageForCount } from './building';
import type { Store } from '../storage/store';

// DEMO SEED — writes a rich, self-consistent mid-run city through the same Store
// the game reads, so a judge (or the first visitor to a fresh post) lands in a
// living Day-5 city under an imminent raid instead of an empty Day-1 board.
// Extracted from the menu route so it's unit-testable without the Devvit
// runtime. `menu /reset` clears everything it writes.

export const DEMO_DAY = 5;

type DemoCitizen = {
  id: string;
  name: string;
  role: Role;
  faction: FactionId | null;
  avatar: AvatarConfig;
  active: boolean; // acted today (online)
  contribution: number;
};

export const DEMO_CITIZENS: readonly DemoCitizen[] = [
  { id: 't2_demo_ash', name: 'Ashen Fox', role: 'scout', faction: 'seekers', active: true, contribution: 210, avatar: { name: 'Ashen Fox', gender: 'nonbinary', skin: 2, hair: 5, hairStyle: 3, outfit: 2 } },
  { id: 't2_demo_wren', name: 'Wren Salt', role: 'engineer', faction: 'builders', active: true, contribution: 188, avatar: { name: 'Wren Salt', gender: 'woman', skin: 1, hair: 4, hairStyle: 2, outfit: 0 } },
  { id: 't2_demo_bram', name: 'Bram Cole', role: 'guard', faction: 'wardens', active: true, contribution: 164, avatar: { name: 'Bram Cole', gender: 'man', skin: 3, hair: 1, hairStyle: 0, outfit: 3 } },
  { id: 't2_demo_mara', name: 'Mara Quill', role: 'medic', faction: 'hearth', active: true, contribution: 141, avatar: { name: 'Mara Quill', gender: 'woman', skin: 4, hair: 0, hairStyle: 2, outfit: 4 } },
  { id: 't2_demo_sable', name: 'Sable Reed', role: 'farmer', faction: 'builders', active: true, contribution: 120, avatar: { name: 'Sable Reed', gender: 'nonbinary', skin: 0, hair: 6, hairStyle: 1, outfit: 6 } },
  { id: 't2_demo_pale', name: 'Pale Wick', role: 'speaker', faction: 'hearth', active: true, contribution: 96, avatar: { name: 'Pale Wick', gender: 'man', skin: 2, hair: 3, hairStyle: 4, outfit: 1 } },
  { id: 't2_demo_cold', name: 'Coldharbor', role: 'guard', faction: 'wardens', active: true, contribution: 74, avatar: { name: 'Coldharbor', gender: 'man', skin: 5, hair: 0, hairStyle: 5, outfit: 7 } },
  { id: 't2_demo_ivy', name: 'Ferrous Ivy', role: 'engineer', faction: 'builders', active: false, contribution: 58, avatar: { name: 'Ferrous Ivy', gender: 'woman', skin: 1, hair: 7, hairStyle: 2, outfit: 5 } },
  { id: 't2_demo_ember', name: 'Ember', role: 'scout', faction: 'seekers', active: false, contribution: 40, avatar: { name: 'Ember', gender: 'nonbinary', skin: 3, hair: 8, hairStyle: 3, outfit: 3 } },
];

const ROLE_ACTION: Record<Role, ActionType> = {
  farmer: 'grow_food',
  engineer: 'repair_power',
  medic: 'treat_sick',
  guard: 'guard_wall',
  scout: 'guard_wall',
  speaker: 'grow_food',
};

export type SeedOpts = { cycle: number; worldSeed: number; nowMs: number };

/** The Day-5 demo city, threat 94 ⇒ raid tomorrow (raidInDays = 1). */
export const demoCityState = (cycle: number, worldSeed: number): CityState => ({
  day: DEMO_DAY,
  cycle,
  status: 'alive',
  worldSeed,
  trait: 'standard', // hand-built demo — keep it modifier-free
  population: 143,
  food: 34,
  power: 41,
  medicine: 12,
  morale: 46,
  threat: 94,
  defense: 38,
  crisisId: 'refugee_convoy',
  activeLaw: null,
  lawExpiresDay: 0,
  // Mid-run progression so judges land in a growing Village: Shelter + Farm
  // already built, part-way toward the Clinic.
  unlockedBuildings: ['shelter', 'farm'],
  cityLevel: stageForCount(2),
  buildProgress: 12,
});

/** Write the full demo state. Idempotent-ish: re-running overwrites the city and
 *  re-adds the same players/timeline (counters would double — reset first). */
export async function seedDemoCity(store: Store, { cycle, worldSeed, nowMs }: SeedOpts): Promise<void> {
  await store.setCityState(demoCityState(cycle, worldSeed));

  // 1) Citizens — real profiles (drives villagers, online count, leaderboard).
  await Promise.all(
    DEMO_CITIZENS.map((d) => {
      const p: PlayerProfile = {
        ...freshPlayer(d.id, d.name, DEMO_DAY),
        role: d.role,
        roleChangedDay: 1,
        faction: d.faction,
        factionRep: 6,
        avatar: d.avatar,
        totalContribution: d.contribution,
        streak: d.active ? 4 : 2,
        lastActiveDay: d.active ? DEMO_DAY : DEMO_DAY - 1,
      };
      return store.savePlayer(p);
    }),
  );
  for (const d of DEMO_CITIZENS) {
    await store.registerHouse(d.id);
    await store.addContribution(d.id, d.contribution);
  }

  // 2) Yesterday's action-takers (day 4) — scales the Marked goal + dawn report.
  const yesterdayActors = DEMO_CITIZENS.filter((d) => d.active);
  await Promise.all(
    yesterdayActors.map((d) => store.recordAction(DEMO_DAY - 1, d.id, ROLE_ACTION[d.role])),
  );

  // 3) Today's activity (day 5): zone actions (drama + tallies) + expeditions.
  const todayActions: [string, ActionType][] = [
    ['t2_demo_sable', 'grow_food'],
    ['t2_demo_wren', 'repair_power'],
    ['t2_demo_mara', 'treat_sick'],
    ['t2_demo_bram', 'guard_wall'],
    ['t2_demo_cold', 'guard_wall'],
    ['t2_demo_ash', 'guard_wall'],
    ['t2_demo_pale', 'grow_food'],
  ];
  await Promise.all(todayActions.map(([id, a]) => store.recordAction(DEMO_DAY, id, a)));
  await store.bumpDayMissions(DEMO_DAY, {
    totalRuns: 3,
    totalFood: 9,
    totalMedicine: 4,
    totalScrap: 6,
    injuries: 1,
  });

  // 4) The Marked — a mid-rescue: 6 pledges of "resolve" (5 each = 30).
  const pledgers: [string, PledgeKind][] = [
    ['t2_demo_ash', 'stand_vigil'],
    ['t2_demo_mara', 'share_rations'],
    ['t2_demo_pale', 'run_messages'],
    ['t2_demo_wren', 'back_council'],
    ['t2_demo_sable', 'share_rations'],
    ['t2_demo_bram', 'stand_vigil'],
  ];
  for (const [id, kind] of pledgers) {
    const cz = DEMO_CITIZENS.find((d) => d.id === id)!;
    const entry: PledgerEntry = { kind, name: cz.name, at: nowMs, contribution: cz.contribution };
    await store.recordPledger(DEMO_DAY, id, entry);
    await store.bumpMarkedPledge(DEMO_DAY, 5); // BALANCE.marked.pledgePerTap
    await store.bumpPledgeKind(DEMO_DAY, kind);
  }
  await store.setMarkedOutcome(DEMO_DAY - 1, { name: 'The North Wall', saved: true });

  // 5) Crisis votes (refugee_convoy a/b/c) + council backing (raid-leaning).
  const crisisVotes: [string, string][] = [
    ['t2_demo_ash', 'a'], ['t2_demo_wren', 'a'], ['t2_demo_sable', 'a'], ['t2_demo_pale', 'a'],
    ['t2_demo_bram', 'c'], ['t2_demo_cold', 'c'], ['t2_demo_ivy', 'c'],
    ['t2_demo_mara', 'b'], ['t2_demo_ember', 'b'],
  ];
  await Promise.all(crisisVotes.map(([id, opt]) => store.recordVote(DEMO_DAY, id, opt)));
  const plans: [string, StrategyPlanId][] = [
    ['t2_demo_bram', 'prepare_raid'], ['t2_demo_cold', 'prepare_raid'], ['t2_demo_ash', 'prepare_raid'], ['t2_demo_ivy', 'prepare_raid'],
    ['t2_demo_sable', 'stockpile_food'], ['t2_demo_pale', 'stockpile_food'],
    ['t2_demo_mara', 'treat_sick'],
    ['t2_demo_wren', 'repair_power'],
  ];
  await Promise.all(plans.map(([id, plan]) => store.recordStrategyVote(DEMO_DAY, id, plan)));

  // 6) Faction influence standings (wardens leading into the raid).
  const influence: [FactionId, number][] = [['wardens', 14], ['builders', 9], ['seekers', 6], ['hearth', 4]];
  await Promise.all(influence.map(([f, by]) => store.bumpFactionInfluence(DEMO_DAY, f, by)));

  // 7) Chronicle — three days of consequences, ending on a repelled raid.
  const timeline: TimelineEntry[] = [
    {
      day: 2, cycle,
      headline: 'Day 2: Refugees at the gate — the city let them in.',
      events: ['30 souls taken in; food strained but morale lifted.', 'Farmers doubled the greenhouse shifts.'],
      deltas: { population: 28, food: -18, morale: 5 },
      crisisId: 'refugee_convoy', winningOptionId: 'a',
    },
    {
      day: 3, cycle,
      headline: 'Day 3: A blackout hit the medical ward.',
      events: ['Engineers rerouted power to the clinic.', 'The sick pulled through the night.', 'Threat crept higher beyond the wall.'],
      deltas: { power: -8, medicine: 2, threat: 7 },
      crisisId: 'blackout_ward', winningOptionId: 'a',
    },
    {
      day: 4, cycle,
      headline: 'Day 4: Raiders probed the North Wall — the watch held.',
      events: [
        'The North Wall was saved by citizens standing vigil.',
        '12 citizen actions strengthened the city.',
        '2 expeditions returned: +6 food, +3 medicine, +4 scrap.',
        'A scout was injured in the ruins. Threat is rising fast.',
      ],
      deltas: { food: -4, medicine: 1, morale: -3, threat: 9, defense: 4 },
      crisisId: 'blackout_ward', winningOptionId: 'a',
    },
  ];
  for (const entry of timeline) await store.appendTimeline(entry);
}
