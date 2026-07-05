# One More Dawn — Plan 2: Conflict Layer + Submission

**Goal:** Ship the conflict layer that makes the game Reddit-native (factions
competing to shape the city's laws + external raid pressure), fix the
audit-confirmed balance problem, add a leaderboard, polish the pieces judges
will see in the demo, and prepare Devpost submission materials.

**Baseline:** commit `d3cb3ef` on `build/vertical-slice` (tag `vertical-slice`).
85 tests green, CI clean, spec §3.5 as the design source of truth.

**Non-goals (defer to Plan 3 if time):** dedicated Council screen (Dashboard
council panel + Vote screen strategy grid already cover it), city-vs-city,
comment-write integration, sfx assets, dedicated Timeline navigation UX.

## Dependency graph

```
P1 balance additions ────┬── P2 store methods ── P3 resolver ext ── P5 route wiring ── P6 dashboard
                          │
                          └── P4 balance retune (independent of factions, but shares balance.ts)
P7 leaderboard scene   (independent — reads existing sorted sets)
P8 polish              (independent — animation/tween only)
P9 integration test    (after P3 + P5)
P10 submission draft   (any time, mostly human review)
```

Parallel-safe cohorts: {P1, P4, P7, P8, P10}, then {P2}, then {P3}, then {P5, P6}, then {P9}.

## Global rules

- Every task ends with `type-check + lint + test + build` clean.
- Never cast types except at approved boundaries (`balance.ts`, `api.ts` request narrowing).
- Server writes go through `Store` over the `redisLike` adapter — no raw redis
  except in the tx flows already established.
- Types added to `src/shared/types.ts` first; every consumer imports from there.
- Faction/law fields already exist on `CityState`/`PlayerProfile` (Plan 1
  left them null/0-inert); this plan turns them on — no schema migration
  needed because Redis stores JSON and existing values are already
  compatible.

---

## P1 — Faction types + balance additions

**Files:**
- Modify: `src/shared/balance.ts`
- Modify: `src/shared/types.ts` (only if needed — most types already exist)

**Adds** (append to `BALANCE`):

```ts
factionPerAction: {
  grow_food: null,          // Farmers score through role, not action
  repair_power: 'builders',
  treat_sick: 'hearth',
  guard_wall: 'wardens',
} satisfies Record<ActionType, FactionId | null>,

factionPerMissionRun: 'seekers' as FactionId,  // every expedition run
factionRepPerAction: 2,
factionRepPerMissionRun: 3,

// Per-faction daily law: applied on the DAY AFTER victory, one day lifetime.
laws: {
  builders:  { id: 'builders',  label: 'Emergency Engineering', buff: 'Repair actions +25% power',    cost: 'Morale actions cost +1 energy' },
  wardens:   { id: 'wardens',   label: 'Wall Watch',            buff: 'Threat rises 25% slower',       cost: 'Food consumption +10%' },
  seekers:   { id: 'seekers',   label: 'Ruins Charter',          buff: 'Expedition loot +1 per crate',  cost: 'Injury risk +10%' },
  hearth:    { id: 'hearth',    label: 'Common Table',           buff: 'Treat Sick +50% medicine',      cost: 'Repair actions -25% power' },
} satisfies Record<FactionId, LawDef>,

lawLifespanDays: 1,

// Red Signal raid pressure
raid: {
  triggerThreshold: 100,     // >= 100 fires
  postRaidThreat: 40,        // reset after raid
  populationLoss: 8,
  foodLoss: 20,
  powerLoss: 15,
  moraleLoss: 15,
  guardDampenPerAction: 3,   // each guard action today reduces the raid's damage
},
```

**New type in `src/shared/types.ts`:**

```ts
export type LawDef = {
  id: FactionId;
  label: string;
  buff: string;
  cost: string;
};

// Extend InitResponse (append fields; don't reshape existing ones):
//   activeLaw: LawDef | null;
//   raidInDays: number;    // ceil((100 - threat) / dailyRise); 0 if firing tomorrow
//   factionInfluence: Record<FactionId, number>;  // today's tally
//   yourFaction: FactionId | null;  // current leaning
//   yourFactionRep: number;
```

**Test:** `src/shared/balance.test.ts` — assert every `ActionType` and every
`FactionId` appears in the config maps.

---

## P2 — Faction influence tracking (store)

**Files:**
- Modify: `src/server/storage/store.ts`
- Modify: `src/server/storage/store.test.ts`

**Adds to `Store`:**

```ts
async bumpFactionInfluence(day: number, faction: FactionId, by: number): Promise<void>
async getFactionInfluence(day: number): Promise<Record<FactionId, number>>
async bumpPlayerFactionRep(userId: string, faction: FactionId, by: number): Promise<PlayerProfile | null>
// The last: watch/multi over players, mutate player.factionRep + player.faction (assign to leading faction if beat by 2), return updated
```

`faction` derivation: `player.faction` is whichever faction has the most rep;
tie → keep existing; 0 rep → null.

**Tests:** round-trip influence hash, rep bumping picks the leader correctly,
tie-holds, zero-rep is null.

---

## P3 — Resolver extension: laws + raids + faction winner

**Files:**
- Modify: `src/server/game/resolver.ts`
- Modify: `src/server/game/resolver.test.ts`

**Adds to `DayInputs`:**

```ts
factionInfluence: Partial<Record<FactionId, number>>;
activeUserCount: number;  // used by P4 balance retune
```

**Adds to `resolveDay` (in order, after existing production/consumption but before finalizing):**

1. **Apply active law modifiers** to action effects before totalling — read
   `city.activeLaw` (the FactionId from yesterday's win) and multiply matching
   action outputs / adjust morale cost / etc per `BALANCE.laws[id]` semantics.
   Encode as a helper `applyLaw(rawEffects, city) → effects`.

2. **Faction winner selection**: whichever faction has the highest influence
   today wins tomorrow's law. Set `nextCity.activeLaw = winnerId` and
   `nextCity.lawExpiresDay = nextCity.day + BALANCE.lawLifespanDays`. If law
   from yesterday is expired, clear it before checking new winner. Tie-break:
   Builders → Wardens → Seekers → Hearth (deterministic).

3. **Raid clock**: `nextCity.threat >= BALANCE.raid.triggerThreshold`:
   apply raid deltas, subtract `guardActionsToday * guardDampenPerAction`
   from each raid loss (floor at 0), reset threat to `postRaidThreat`, push
   timeline event "The Red Signal came in the night. The city held."

**Tests:**
- Faction winner picked correctly under ties and empty tallies.
- Law modifier applied to matching actions (Builders → repair +25%).
- Law expires after `lawLifespanDays` days.
- Raid fires at exactly 100 and dampens by guard actions.

---

## P4 — Balance retune (audit finding #1)

**Files:**
- Modify: `src/shared/balance.ts` (add scaling knobs)
- Modify: `src/server/game/resolver.ts` (use them)
- Modify: `src/server/game/resolver.test.ts`

Audit finding: past ~5 active players, scarcity vanishes because drains are
population-linear while production is player-linear. Fix by making drains
scale with the greater of population or `activeUserCount * K`.

**Balance additions:**
```ts
scaling: {
  activePlayerFoodDrain: 0.5,   // each acting player adds 0.5 food/day to consumption
  activePlayerPowerDrain: 0.2,
  activePlayerThreatRise: 0.2,
  foodStoreCap: 300,
  medicineStoreCap: 120,
},
```

**Resolver:** replace `population * foodPerPopulation` with
`max(population * foodPerPopulation, population * foodPerPopulation + activeUserCount * activePlayerFoodDrain)`; similarly for power decay + threat rise. Clamp
food/medicine to their new caps in `clampStock` overloads.

**Test:** simulation with 10 active players over 10 days now shows food dip
below start value; 20 players triggers real scarcity by day 5.

---

## P5 — Route wiring: factions + laws in /init and /action

**Files:**
- Modify: `src/server/routes/api.ts`
- Modify: `src/shared/types.ts` (InitResponse extension per P1)
- Modify: `src/server/game/lazyResolve.ts` (pass activeUserCount + factionInfluence to resolver)

**In `/api/init`:** compute `factionInfluence` from today's hash, expose
`activeLaw` (look up `BALANCE.laws[city.activeLaw]` if set, null otherwise),
`raidInDays = max(0, ceil((100 - city.threat) / dailyThreatRise))`, plus
player's `yourFaction`/`yourFactionRep`.

**In `/api/action`:** after successful energy spend, bump faction influence
for that action's `factionPerAction[actionType]` if non-null, AND bump the
acting player's rep on that faction (via `bumpPlayerFactionRep` — updates
`player.faction` accordingly). Apply role-bonus multiplier from
`BALANCE.roleBonus` inside `recordAction`'s aggregate (multiply the count
stored so the resolver sees weighted actions).

Wait — resolver reads counts, not weighted. Cleaner: keep counts pure, apply
role bonuses AT resolver time by using `roleCounts` we already pass. Extend
`roleCounts` to `Partial<Record<Role, Partial<Record<ActionType, number>>>>`
so resolver knows "3 grow_food from farmers = ×1.5" without changing the raw
`actions` aggregate.

**In `/api/mission/complete`:** on escape or fail, bump Seekers influence by
`factionRepPerMissionRun` and bump the player's Seekers rep.

---

## P6 — Dashboard: law banner + raid clock + faction rep

**Files:**
- Modify: `src/client/game/scenes/Dashboard.ts`

**Adds** (above resources panel or below crisis, wherever it fits without breaking layout):

- **Active-law banner** with orange left-border stripe: `LAW OF [faction]`
  label, `buff` in green, `cost` in dim orange. Renders only when
  `data.activeLaw !== null`.
- **Raid meter**: threat bar already exists — add secondary text `RAID in N days`
  in `data.raidInDays > 0` else `RAID INBOUND` in red pulsing.
- **Faction rep row** below the crisis panel: `You lean toward [FACTION]
  (rep N)` — dim if `null`, accented if leaning.

Keep the existing panels; add without shifting the button layout at the
bottom.

---

## P7 — Leaderboard scene

**Files:**
- Modify: `src/client/game/scenes/Leaderboard.ts` (currently constructor-only stub — no, wait, it doesn't exist yet in the slice; check `game.ts` scene list)
- Modify: `src/client/game.ts` if needed (register scene)
- Modify: `src/server/routes/api.ts` (add `GET /api/leaderboard`)
- Modify: `src/client/game/api.ts` (add `api.leaderboard()`)
- Modify: `src/shared/types.ts` (LeaderboardResponse)

`/api/leaderboard` returns:
```ts
{
  type: 'leaderboard',
  contributors: [{userId, username, score}] (top 10 by lb:contribution),
  scouts: [{userId, username, score}] (top 10 by lb:scouts),
  factions: Record<FactionId, {rep: number, standing: number}> (aggregate rep by faction)
}
```

Client scene: three panels stacked vertically; button on Dashboard already
exists (`Leaderboard` scene target is referenced in Dashboard.ts) — wire it.

---

## P8 — Polish pass

**Files:**
- Modify: `src/client/game/scenes/Mission.ts` (air-timer heartbeat: tween scale 1→1.1 on the air text when airLeft ≤ 20)
- Modify: `src/client/game/scenes/Dashboard.ts` (low-power flicker: if power < 25, tween power bar alpha 1 → 0.7 → 1 slowly)
- Modify: `src/client/game/scenes/Timeline.ts` (raid entry accent: if headline mentions raid, render in red)
- Optional: `src/client/game/scenes/Mission.ts` add `this.cameras.main.shake(200, 0.005)` on each armed hazard arm (subtle warning shake)

No new assets. All tween-based.

---

## P9 — Integration test extension

**Files:**
- Modify: `src/server/routes/api.integration.test.ts`

Add scenarios to the existing `describe`:
- Two players spend 2 repair actions each → Builders faction wins → force-resolve → next day city has `activeLaw === 'builders'` → next day repair actions yield +25%.
- Set city.threat to 96, one guard action + force-resolve → threat still under 100. Set threat to 100 → force-resolve → raid event fires, threat drops to 40, timeline has raid line.

Keep runtime under 5 seconds.

---

## P10 — Submission draft

**Files:**
- Modify: `README.md` (add "Pitch" section)
- Create: `docs/submission/devpost.md` (Devpost form draft)
- Create: `docs/submission/video-script.md` (2-minute demo script + shot list)

**Pitch text (from spec §3.5 final line):**
> One More Dawn is a cooperative survival-strategy game where a subreddit
> manages the last city after collapse. Players gather resources, run
> dangerous expeditions, vote on moral crises, and compete through internal
> factions for influence over the city's laws. Everyone wants the city to
> survive — but not everyone agrees what kind of city it should become.

**Video shot list:** splash → dashboard → role pick → action spend → mission
run (grab crate, dodge hazard, exit) → mission-end haul → vote screen → mod
force-resolve → dashboard shows changed city + new active law + timeline.
2:00 target.

**Devpost fields:** tagline, description (pitch), built-with (Devvit Phaser
Hono Redis), demo video URL placeholder, category (Phaser prize +
main).

Mostly human-facing content — I write the drafts, you approve/edit.
