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
5. Cast a **Council Plan** vote — the day's strategic priority (see §10)
6. Check **leaderboards**, **faction standings**, and the **timeline** (the
   city's permanent history)

### First-screen copy (onboarding is copy, not just UI)

```
You live in the last city.
Spend today's energy to gather resources, vote on a crisis,
and help the city survive one more dawn.
Tomorrow, the city changes based on what everyone did.
```

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
| `Dashboard` | City report, resources, crisis banner, law, raid clock, **Council panel** (§10) — the hub |
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
| `POST /api/vote` | One crisis vote per user per day (watch/multi) |
| `POST /api/strategy` | One Council Plan vote per user per day (watch/multi) |
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

day:{n}:strategyPlan
  hash: planId -> count

day:{n}:strategyVoters
  hash: userId -> planId

day:{n}:scoutReports
  hash: userId -> JSON {crateCount, escaped, injury, shortSummary}

mission:tokens
  hash: tokenId -> JSON {userId, day, layoutSeed, lootSeed, roleAtStart,
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

### Daily player reset (in `/api/init`)

Explicit, or energy bugs happen fast. On every `/api/init`, after any day
resolution:

```
if player.lastActiveDay < city.day:
  player.energyUsedToday = 0
  player.lastActiveDay = city.day
  effectiveEnergy = injuredUntilDay >= city.day ? dailyEnergy - 1 : dailyEnergy
  update streak (consecutive-day check: lastActiveDay == city.day - 1 ? +1 : 1)
```

`effectiveEnergy` is computed, never stored — the injury penalty derives from
`injuredUntilDay` so it can't double-apply on refresh.

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

Shared routes fuel comment discussion — "there's a deep crate behind the bus,
but the collapse tile near it is risky" — without full reward spoilers.

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
  create token {tokenId, userId, day, layoutSeed, lootSeed, roleAtStart,
                startedAtServerMs, expiresAtServerMs (5–10 min), consumed: false}
  return {tokenId, layoutSeed, lootSeed}
```

**Client submits collected crate IDs, not raw loot:**

```json
{ "tokenId": "abc", "status": "escaped",
  "collectedCrateIds": ["c1", "c4", "c7"], "clientDurationMs": 72300 }
```

Server validates: token exists · token.userId matches · token.day is current ·
not consumed · within expiry · duration plausible · crate IDs exist in the
seed-generated map · loot ≤ crate manifest · mission not already completed
today. Then the server **regenerates the map from `layoutSeed`, prices the
crates from `lootSeed`, and calculates loot itself**, banks into
`day:{n}:missions`, updates `lb:scouts`, marks the token consumed. `roleAtStart` is snapshotted so Scout bonuses and validation
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

### Parallel tracks (what can be built simultaneously)

The type contract enables parallelism: `src/server/game/types.ts` (shared API
types) is written Day 1, then tracks proceed independently:

| Track | Independent because | Runs in parallel during |
|---|---|---|
| **Server routes + Redis store** | Only depends on types + redisKeys | Days 1–4 |
| **Client scenes on a mock API** | `api.ts` has a mock mode returning fixture JSON; scenes are built against fixtures, swapped to real endpoints when ready | Days 1–4 |
| **Resolver + balance** | Pure functions, no I/O — developed and unit-tested standalone | Days 2, 5 |
| **Map generation (`mapgen.ts`)** | Pure seeded function used identically by client and server | Day 3 |
| **Crisis pool + law table + copy** | Data files (`crises.ts`, `laws.ts`) — content, not systems | Any day |

🧑 **Human-parallel work** (while I code — none of this blocks the code):

- Days 1–2: pick the Kenney tileset + scout sprite + SFX pack (I shortlist 2–3
  options, you pick the vibe)
- Days 2–5: playtest every ship check on your phone; note confusion points
- Day 5+: Devpost copy drafts, screenshot capture, video script review
- Any day: recruit 1–2 friends for the Day 5 two-human playtest

### Day 1 — Sat Jul 4: Foundation
- Scaffold from official Phaser template; git init; repo structure per spec
- 🧑 `npm run login` (browser auth) + accept dev terms if not done
- First playtest deploy to r/OneMoreDawnDev
- Redis store layer + `/api/init` with hardcoded city state; Dashboard renders it
- **Ship check:** game post opens in the test sub. 🧑 confirm it loads on mobile.

### Day 2 — Sun Jul 5: The strategy loop
- `players` hash, role select, energy actions (watch/multi), crisis vote,
  Council strategy vote (`/api/strategy` — same pipeline as crisis vote), all
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
- 🧑 **Submit first Devvit review build as soon as the vertical slice works**,
  ideally Day 3 night or Day 4 morning — review takes ~1 week; an honest
  description + basic playable loop is enough, we keep improving after. If the
  slice is broken, fix it first — submitting a broken build wastes review time.
- **VERTICAL SLICE LOCK (Day 3 night):** open post → see city → pick role →
  start mission → finish mission → bank loot → see city/timeline affected.
  **If this slice isn't working, stop adding features until it is.**

### Day 4 — Tue Jul 7: Conflict layer
- **Must-have:** faction influence, daily law selection, threat/raid clock,
  mission end screen, Council panel on Dashboard (plan standings + priority
  badge on Actions screen), Leaderboard scene, Timeline scene
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
world map locations · achievements/flairs · scheduled cron jobs (lazy resolver
instead) · websockets/realtime · external DB/hosting · AI-driven content ·
**in-app realtime chat / Redis message feed / DM system / free-text
unmoderated chat** (Reddit comments are the chat layer — see §10) ·
`POST /api/share-report` comment creation (stretch only, buffer days, subject
to Reddit's app-content attribution rules)

## 9. Success Criteria

1. A new player understands the game from the first screen in <30 seconds
2. Full session (report → action → mission → vote) works on mobile Reddit
3. The city visibly changes day over day; timeline tells a story
4. Laws change hands between factions across a simulated week
5. A raid fires and the community can see it coming and respond
6. Demo video + Devpost submitted ≥1 day before the deadline

## 10. Multiplayer & Community Strategy

One More Dawn is multiplayer through shared city state, collective daily
resolution, faction influence, leaderboards, council planning, and Reddit
comments. **It is not realtime socket multiplayer.** The city is the shared
object everyone changes asynchronously. The multiplayer *feel* comes from
coordination: "We need more Wardens today." "Stop scouting, threat is too
high." "Vote for rationing or we die tomorrow."

### Multiplayer surfaces

1. Shared city resources
2. Shared daily crisis vote
3. Shared Council strategy plan
4. Shared faction influence race
5. Shared raid/threat response
6. Shared timeline/memorial
7. Reddit comment strategy thread
8. Leaderboards

### The Council (structured strategy voting)

Separate from the crisis vote. The crisis vote answers *"what decision should
the city make?"*; the Council Plan answers *"what should players focus their
energy on today?"*

```
Today's Council Plan:
[Stockpile Food] [Repair Power] [Prepare for Raid] [Send Scouts] [Treat the Sick]
```

- `POST /api/strategy` — one plan vote per user per day (watch/multi), stored
  in `day:{n}:strategyPlan` / `day:{n}:strategyVoters`
- **Council panel on the Dashboard** (folded in for MVP, not a separate scene):

```
THE COUNCIL
Top plan today: Prepare for Raid — 48%
Suggested actions: Guard Wall, Repair Generator
Discuss strategy in the comments.
```

- The Actions screen shows a nudge badge: `Council Priority: Prepare for Raid`
- The plan is a **coordination signal, not a mechanic** — it does not modify
  the resolver. Its power is social: it aligns energy spending.

### Reddit comments are the chat

No custom chat is built. Reddit already has threading, voting, moderation, and
identity — and Devvit Web is request/response (no websockets), so comments are
both the native and the technically correct chat layer. The game links out:
"Discuss strategy in the comments."

**Stretch (buffer days only):** `POST /api/share-report` — post-mission, offer
"Share a scout report?" which creates a Reddit comment like *"Scout Report —
Day 4: escaped with food and medicine. Watch the collapse tiles near the
eastern lane."* Requires the userActions permission and must follow Reddit's
content-attribution rules for app-created comments. Cut without hesitation if
time is short.

### Explicitly not building

In-app realtime chat · Redis message feed · DM system · websocket chat ·
city-vs-city live war · free-text unmoderated chat inside the app.

## 11. Multi-Subreddit Scope (verified)

**One subreddit = one city.** Devvit Redis is installation-scoped: the SDK's
default client is constructed with `RedisKeyScope.INSTALLATION`
(`@devvit/redis/index.js:5`) and every RPC in `RedisClient.js` passes
`scope: this.scope`. Two installs of this app can never see each other's keys,
so `city:state`, `players`, `day:{n}:*`, and `mission:tokens` are all
per-subreddit with zero app code.

**One Reddit user = many independent city memberships.** The same user in
r/CityA and r/CityB has a separate role, energy, injury, streak, and faction
in each — the `players` hash lives inside each installation's keyspace.

Key prefixes like `sub:{id}:` are **deliberately not used**: the platform
already partitions harder than app code can, and prefixes would only add
noise and bugs.

Global cross-city features (global leaderboard, "which city survived
longest?") are post-MVP and would use `redis.global`
(`new RedisClient(RedisKeyScope.GLOBAL)` per `RedisClient.js`) — a shared
keyspace across all installations of the app.

## 12. Reward & Retention Layer (Plan 3)

**Hook:** *"My city changes tomorrow because of what I did today — and
everyone can see my contribution."*

### The Dawn Report

On the **first visit of each day**, before the Dashboard, the player sees:

- Yesterday's city summary (what the resolver did overnight)
- A personalized **YOUR IMPACT** list: actions taken, loot banked, vote cast,
  rep gained
- Their current title

Shown exactly once per day (`firstVisitToday` from `/api/init`).

### Role reputation

Each player accrues **rep per role**, stored on the player profile
(`roleRep`). City actions bump the acting role's rep; completing an
expedition bumps rep for the role the player held at mission start
(scout-style credit). Rep never decays.

### Titles

Threshold table per role in `balance.ts` — e.g. Scout: 25 → *Runner*,
75 → *Night Scout*, 150 → *Ruin Walker*, with equivalents for all six roles
(scout, engineer, medic, farmer, guard, speaker). Unlocks are announced
**instantly** in the action/mission response (`unlockedTitle`) and displayed
on the Leaderboard and Dashboard.

### Instant reward framing

The mission end screen already shows haul + contribution; title unlocks stack
onto the same moment. Recognition lands in the same tap that earned it.

### Explicitly deferred (post-MVP)

- **City projects** — multi-day shared builds; needs a stable resource economy
  first, then it's the natural long-horizon goal.
- **Expedition route choice** — risk/reward branching; right after the base
  mini-game loop is proven fun.
- **Council unity bonus** — small resolver bonus when energy follows the plan;
  turns the social signal into a mechanic once trust in the signal exists.
- **Forecasting** — "tomorrow's raid odds" preview; valuable once players have
  history to reason from.
- **Crisis chains** — multi-day narrative crises; needs the single-day crisis
  cadence validated first.
- **City archive collectibles** — mementos of past cycles; only meaningful
  after cities have died at least once.
- **Global cross-city competition** — `redis.global` leaderboards (§11); only
  worth it with multiple live cities.

### Anti-dark-pattern note

No loot boxes, no punishing streak loss, no fake urgency. Retention comes
from **consequence** (the city is different tomorrow because of you) and
**recognition** (titles, leaderboards, the Dawn Report) — not from
manufactured anxiety.
