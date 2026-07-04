# One More Dawn — Design Spec

**Date:** 2026-07-04
**Target:** Reddit's Games with a Hook Hackathon (Devpost)
**Real deadline:** Wed Jul 15, 2026, 6:00pm PDT (Thu Jul 16, 6:30am IST)
**Internal build freeze:** Fri Jul 10, 2026
**Test subreddit:** r/OneMoreDawnDev (private)

> **Pitch:** One More Dawn is a cooperative survival-strategy game where a subreddit
> manages the last city after collapse. Players gather resources, run dangerous
> expeditions, vote on moral crises, and compete through internal factions for
> influence over the city's laws. Everyone wants the city to survive — but not
> everyone agrees what kind of city it should become.

---

## 1. Concept & Core Loop

A persistent, cooperative survival-strategy game. One real-world day = one game
day. The city is **per-subreddit** (one shared city; every post shows the same
city), with a mod-only reset that starts a new cycle.

**The hook:** the city remembers. Players' combined actions + one community vote
resolve into tomorrow's city state, and consequences compound — food shortages,
blackouts, refugees, disease, raids.

### One player session (~10–15 min)

1. Open the game post → today's **City Report** (resources, active crisis, active
   law, threat/raid clock, yesterday's consequences)
2. Pick/confirm **role** — Scout, Engineer, Medic, Farmer, Guard, Speaker. Role
   gives a bonus to matching actions. Changeable once per 3 days.
3. Spend **3 daily energy** on actions: Grow Food, Repair Generator, Treat Sick,
   Guard Wall — or launch an **Expedition** (Phaser mini-game, see §4)
4. Cast a vote on today's **Crisis Decision** (one moral/strategic dilemma per day)
5. Check **leaderboards**, **faction standings**, and the **timeline** (the
   city's permanent history)

### Resources

`food`, `power`, `medicine`, `morale`, `threat`, `population`

### Day resolution

**Lazy resolver:** the first request after midnight UTC triggers resolution of
the previous day, guarded by `resolver:lock` (short-TTL). The resolver:

1. Tallies all actions (with role and law modifiers) + winning crisis vote
2. Applies balance formulas from `balance.ts`
3. Tallies faction influence → enacts tomorrow's law
4. Advances the threat/raid clock; triggers a Raid Event at `threat >= 100`
5. Writes the timeline entry and `city:history` snapshot
6. Picks tomorrow's crisis from a hand-written pool of ~10, filtered by city
   conditions (low food → hunger crises unlock, etc.)

### Failure is real

Resources can hit zero → population starts dying → the city can fall. A fallen
city shows a memorial timeline; mods can start a new city (next cycle).

---

## 2. Architecture

Stack (from the official Devvit Phaser template,
`npm create devvit@latest --template=phaser`):

```
Reddit post (interactive unit)
   └─ WebView client — Phaser 3 + TypeScript + Vite
        │  fetch("/api/…")
   └─ Devvit server — Hono endpoints (serverless, request/response only)
        │
   └─ Devvit Redis — all persistent state
```

No external services. No websockets (unsupported on Devvit) — multiplayer is
async: everyone reads/writes shared Redis state; the day resolver aggregates.
All persistent state lives in Redis, never client storage (localStorage clears
on app updates).

### Client scenes (Phaser)

| Scene | Purpose |
|---|---|
| `Boot` | Load assets, call `/api/init` |
| `Dashboard` | City report, resources, crisis banner, law, raid clock — the hub |
| `RoleSelect` | First-visit role pick (changeable once per 3 days) |
| `Actions` | Spend energy on city actions |
| `Mission` | Expedition mini-game (§4) |
| `Vote` | Daily crisis vote |
| `Leaderboard` | Top contributors, best scouts, faction standings |
| `Timeline` | City history |

### Server endpoints (Hono)

| Endpoint | Does |
|---|---|
| `GET /api/init` | Runs lazy resolver if needed; returns city state + player profile + today's crisis |
| `POST /api/role` | Set/change role (3-day cooldown) |
| `POST /api/action` | Spend 1 energy on a city action (server-validated, watch/multi) |
| `POST /api/mission/start` | Deducts 1 energy, issues mission token `{tokenId, seed}` |
| `POST /api/mission/complete` | Validates crate IDs against token seed; banks server-calculated loot |
| `POST /api/vote` | One vote per user per day (watch/multi) |
| `GET /api/leaderboard` | Reads sorted sets + faction standings |
| `GET /api/timeline` | Reads timeline hash |
| `POST /api/admin/reset` | Mod/owner only: new cycle |
| `POST /api/admin/force-resolve` | Mod/owner only: resolve day immediately (dev/testing) |
| `POST /api/admin/seed-demo-state` | Mod/owner only: load a rich demo state |

All game rules live server-side; the client is presentation.

### Redis model

Devvit Redis supports strings, hashes, sorted sets, numbers, bitfields, and
transactions — **no lists, no plain sets, no global key listing**. All
collections use stable keys.

```
city:state
  JSON {day, population, food, power, medicine, morale, threat, crisisId,
        cycle, status, activeLaw, lawExpiresDay, raidInDays, defense}

city:meta
  hash {lastResolvedDate, schemaVersion, balanceVersion, resolverStatus}

players
  hash: userId -> JSON {role, roleChangedDay, faction, factionRep,
        energyUsedToday, lastActiveDay, injuredUntilDay,
        totalContribution, streak}

day:{n}:actions
  hash: actionType -> count

day:{n}:userActions
  hash: userId -> JSON {actionsTaken, energySpent, missionStarted,
        missionCompleted, voteId}

day:{n}:votes
  hash: optionId -> count

day:{n}:voters
  hash: userId -> optionId

day:{n}:missions
  hash {totalRuns, totalFood, totalMedicine, totalScrap, injuries}

day:{n}:factionInfluence
  hash: factionId -> points

mission:tokens
  hash: tokenId -> JSON {userId, day, seed, roleAtStart,
        startedAtServerMs, expiresAtServerMs, consumed}

lb:contribution
  sorted set: userId -> lifetime contribution score

lb:scouts
  sorted set: userId -> best mission haul

timeline
  hash: dayNumber -> JSON day summary

city:history
  hash: dayNumber -> JSON city snapshot after resolution

resolver:lock
  string with short TTL

game:config
  hash {schemaVersion, balanceVersion}
```

### Transactions & locking

- **watch/multi** only for small correctness-critical flows: energy spend, vote
  cast, mission token consume. Never wrap the resolver in one big transaction.
- **Resolver** runs under `resolver:lock` (short TTL) with plain bounded writes:

```
GET /api/init
  if city already resolved today: return state
  try acquire resolver:lock
    acquired  → run resolver, update city:meta.lastResolvedDate, release lock
    otherwise → return current state with resolving: true
```

### Resolver design

`resolver.ts` is a **pure function**:
`(cityState, dayActions, dayMissions, factionInfluence, voteResult, balance) →
(newCityState, timelineEntry, newCrisis)` — trivially unit-testable. All tuning
numbers live in `src/server/game/balance.ts`.

---

## 3. Conflict Layer

Model: **cooperative survival + controlled internal competition + PvE
pressure.** No city-vs-city for MVP (future "Olympics-style" season mode —
indirect competition on weekly survival score; explicitly out of scope. No
direct PvP attacks ever planned for MVP-adjacent work: griefing/balance risk).

### Factions (earned, not picked)

Players choose a *role*; their *faction* emerges from what they do. Zero extra
onboarding UI; faction identity is deserved, not flag-waved. Profile shows the
leaning ("Seeker-aligned, Rep 34").

| Faction | Believes | Earned by | Gameplay bonus |
|---|---|---|---|
| The Builders | Infrastructure first | Repair actions | Repair actions give more power |
| The Wardens | Security first | Guard actions | Guard actions reduce more threat |
| The Seekers | Explore outside | Missions | Missions give better loot |
| The Hearth | People first | Medicine/morale actions | Medicine/morale actions stronger |

Each action emits faction points as a side effect (e.g. `repair_generator →
Builders +2`) into `day:{n}:factionInfluence`.

### Daily laws

At resolution, the faction with the most influence that day enacts tomorrow's
law — a buff **and** a cost, from a hand-written table of 4 (one per faction),
e.g. Builders → "Emergency Engineering": repair +25%, morale actions cost +1
energy. Laws are stored in `city:state.activeLaw` / `lawExpiresDay` and
implemented purely as modifier lookups in `balance.ts`.

### The Red Signal (external threat)

- `threat` rises passively each day and from noisy actions (missions); falls
  from guarding
- Dashboard shows the raid clock: `THREAT 71/100 — projected raid: 2 days`
- `threat >= 100` at resolution → **Raid Event**: lose food/power/morale/small
  population; threat resets to 40; major timeline entry
- Raid severity is reduced by that day's guard actions — "we need Wardens
  tonight" becomes a real community call-to-action

### Degradation path

If schedule slips, **laws** degrade to flavor text ("coming tomorrow") while
factions + influence standings remain. Factions and raids are never cut.

---

## 4. Expedition Mini-Game

> **Promise:** a 90-second risk/reward mission where your haul directly affects
> tomorrow's city.

**Fantasy:** you're a scout slipping into the ruins outside the wall. Grab what
you can, get out before your air runs out. Greed is the tension: the best loot
is deepest in.

### Core rules

- Top-down 2D grid, **one screen, no scrolling/camera** (~12x8 to 14x9 tiles)
- **90-second air timer**, always ticking
- Desktop: WASD/arrow keys. Mobile: **tap-to-move pathfinding** (tap tile →
  path preview → scout walks). Polish: green path = safe, yellow = near hazard,
  red tile = unreachable/dangerous
- Map contains supply crates (contents hidden until grabbed), hazard tiles, and
  the exit
- Loot banks **only if you reach the exit before 0:00**. Fail → keep half
  (rounded down) + **injured: −1 energy tomorrow**

### Hazards: warning-based, not instant

```
Step on warning tile → screen pulse + warning sound + tile flashes ~1.2s
Still on tile when collapse triggers → mission ends: keep half loot, injured
```

Fair, reactive, skill-based — a single stray tap can't instantly ruin a run.

### Risk/reward gradient

Crates near the exit hold 1 item; deep crates hold 2–3 with better medicine
odds (scarcest resource). Hazard density scales with city `threat` — the
strategy layer reshapes the mini-game.

### Seeds: shared layout, personal loot

```
layoutSeed = daySeed                 (same map/hazards/crate positions for all)
lootSeed   = hash(daySeed + userId)  (crate contents personalized)
```

Shared routes fuel comment discussion ("medkit behind the bus") without full
reward spoilers.

### Role hook

Scouts see crate contents from 2 tiles away and get +15s air. All roles can run
missions — Scouts are just better.

### Mission flow & anti-cheat

**Energy is deducted at `/api/mission/start`, not complete** — abandoned
missions still count and cannot be rerolled.

```
POST /api/mission/start
  check energy available; check no mission already started/completed today
  spend 1 energy (watch/multi); record in day:{n}:userActions
  create token {tokenId, userId, day, seed, roleAtStart,
                startedAtServerMs, expiresAtServerMs (5–10 min), consumed: false}
  return {tokenId, seed}
```

**Client submits collected crate IDs, not raw loot:**

```json
{ "tokenId": "abc", "status": "escaped",
  "collectedCrateIds": ["c1", "c4", "c7"], "clientDurationMs": 72300 }
```

Server validates: token exists · token.userId matches · token.day is current ·
not consumed · within expiry · duration plausible · crate IDs exist in the
seed-generated map · loot ≤ crate manifest · mission not already completed
today. Then the server **regenerates the map from the token seed and calculates
loot itself**, banks into `day:{n}:missions`, updates `lb:scouts`, marks the
token consumed. `roleAtStart` is snapshotted so Scout bonuses and validation
can't change mid-run.

### Feel targets

Air-timer heartbeat under 20s · screen shake on hazard · crate-open pop · end
screen: "HAUL BANKED: +3 food, +1 medicine → delivered to the city at dawn."

### Scope guard

One tileset, one biome, ~6 hand-authored map templates that the seed
picks-and-mutates (crate/hazard placement varies). **No enemies, no combat, no
scrolling** — enemies are formally cut (budget went to the conflict layer).

---

## 5. Build Plan

**7-day internal build freeze plan** — freeze Fri Jul 10; real deadline Wed
Jul 15 6:00pm PDT; Jul 11–15 is buffer for bugs, Devvit review follow-up, final
demo, and Devpost submission.

Milestone logic:

```
Jul 4–6:   playable core (vertical slice)
Jul 7–8:   conflict layer, balance, full loop
Jul 9–10:  polish, review follow-up, video prep → FREEZE
Jul 11–15: bug buffer, Devvit review, final demo, Devpost submission
```

Each day ends with something demoable. **🧑 = needs the human.**

### Day 1 — Sat Jul 4: Foundation
- Scaffold from official Phaser template; git init; repo structure per spec
- 🧑 `npm run login` (browser auth) + accept dev terms if not done
- First playtest deploy to r/OneMoreDawnDev
- Redis store layer + `/api/init` with hardcoded city state; Dashboard renders it
- **Ship check:** game post opens in the test sub. 🧑 confirm it loads on mobile.

### Day 2 — Sun Jul 5: The strategy loop
- `players` hash, role select, energy actions (watch/multi), crisis vote, all
  `day:{n}` keys
- Resolver v1 (pure function + unit tests) + `resolver:lock`; timeline;
  `city:history`
- Admin endpoints (`reset`, `force-resolve`, `seed-demo-state`) — built now;
  force-resolve is the day-simulation tool for all later testing
- **Ship check:** role up → spend energy → vote → force-resolve → city changes
  + timeline entry

### Day 3 — Mon Jul 6: The expedition + vertical slice lock
- Map templates, seeded generation, tap-to-move + WASD, crates/hazards/exit,
  90s timer, token issue/validate flow per §4
- 🧑 **Critical playtest: do mobile controls feel good?** If not, fixed Day 4
  morning before anything else.
- 🧑 **Submit first Devvit review build** (Day 3 night or Day 4) — review takes
  ~1 week; an honest description + basic playable loop is enough, we keep
  improving after
- **VERTICAL SLICE LOCK (Day 3 night):** open post → see city → pick role →
  start mission → finish mission → bank loot → see city/timeline affected.
  **If this slice isn't working, stop adding features until it is.**

### Day 4 — Tue Jul 7: Conflict layer
- **Must-have:** faction influence, daily law selection, threat/raid clock,
  mission end screen, Leaderboard scene, Timeline scene
- **Nice-to-have (first cut if tight):** path preview coloring, extra hazard
  polish, animation juice
- Never cut: factions, raids
- **Ship check:** simulated 5-day run (force-resolve ×5) shows laws changing
  hands and a raid firing

### Day 5 — Wed Jul 8: Integration + balance + Devpost draft
- Full-loop test with fresh state; bug triage
- Balance pass: script ~30 simulated days against the resolver; tune
  `balance.ts` so a moderately active city survives but scarcity bites around
  day 4–6
- 🧑 Real playtest with a second account (or a friend) — find confusion points
- **Devpost draft starts today:** 🧑+me — tagline, 3 screenshots, judging
  explanation draft, video script draft

### Day 6 — Thu Jul 9: Polish
- Juice: screen shake, power-flicker at low power, animated resource bars,
  air-timer heartbeat, SFX (Kenney/Freesound); title screen; first-visit
  onboarding; mobile layout pass
- Devvit review follow-up if feedback arrived
- 🧑 Phone QA sweep

### Day 7 — Fri Jul 10: FREEZE
- Demo video: I write shot list + script; 🧑 records (~2–3 min screen capture)
- README, screenshots, submission checklist
- Feature freeze at end of day

### Buffer — Sat Jul 11 → Wed Jul 15
- Bug fixes only; Devvit review iterations; final video edit
- 🧑 Devpost submission — target **Jul 14**, one full day before the deadline

### Risk rules

1. Behind at the Day-3 gate → mission scope shrinks (fewer templates, simpler
   hazards); the mission itself is never cut
2. Day 4 slips → laws degrade to flavor text; factions/influence stay
3. Polish day is untouchable
4. Devvit review is the hard external dependency → first submission Day 3/4

---

## 6. Repo Structure

```
one-more-dawn/
  src/
    client/
      main.ts
      game/
        scenes/        Boot, Dashboard, RoleSelect, Actions, Mission,
                       Vote, Leaderboard, Timeline
        systems/       api.ts, constants.ts, ui.ts
        assets/        sprites/, audio/
    server/
      index.ts
      routes/          init.ts, role.ts, actions.ts, mission.ts, vote.ts,
                       leaderboard.ts, timeline.ts, admin.ts
      game/            resolver.ts, crises.ts, laws.ts, balance.ts,
                       mapgen.ts, types.ts
      storage/         redisKeys.ts, redisStore.ts
  docs/superpowers/specs/
  devvit.json
  package.json
  README.md
```

All balance numbers in `src/server/game/balance.ts` — single tuning surface.

## 7. Testing

- **Resolver:** pure function → unit tests for every crisis/law/raid branch,
  plus a 30-day simulation script for balance tuning
- **Mission validation:** unit tests for token expiry, double-submit, crate-ID
  spoofing, implausible duration
- **Map generation:** deterministic seed test — same seed, same map; every
  template solvable (exit reachable, all crates reachable) verified by test
- **Manual:** phone playtests at Day 1/3/5/6 gates (🧑); two-account test Day 5

## 8. Out of Scope (MVP)

City-vs-city war/attacks · mini-game enemies/combat · scrolling maps · crafting ·
world map locations · comment/post API integration · achievements/flairs ·
scheduled cron jobs (lazy resolver instead) · websockets/realtime · external
DB/hosting · AI-driven content

## 9. Success Criteria

1. A new player understands the game from the first screen in <30 seconds
2. Full session (report → action → mission → vote) works on mobile Reddit
3. The city visibly changes day over day; timeline tells a story
4. Laws change hands between factions across a simulated week
5. A raid fires and the community can see it coming and respond
6. Demo video + Devpost submitted ≥1 day before the deadline
