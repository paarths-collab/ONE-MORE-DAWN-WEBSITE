# Devpost Submission Draft — One More Dawn

Copy-paste ready. Every claim is grounded in the vertical-slice snapshot
(commit `c06f4d7`, tag `vertical-slice`). Update the video URL and playtest
subreddit URL before submitting.

---

## Tagline (max 200 chars)

A cooperative survival-strategy game where your subreddit keeps the last city alive — one dawn at a time.

---

## Elevator pitch (short paragraph)

One More Dawn is a cooperative survival-strategy game where a subreddit
manages the last city after collapse. Players gather resources, run
dangerous expeditions, vote on moral crises, and compete through internal
factions for influence over the city's laws. Everyone wants the city to
survive — but not everyone agrees what kind of city it should become.

---

## Inspiration

Most Devvit games are mini-games with a Reddit skin — a puzzle you happen
to launch from a post. We wanted the opposite: a game that could only exist
on Reddit, because it uses Reddit's own comment-and-vote culture as the
core mechanic. Frostpunk-style resource pressure, filtered through a
subreddit's daily rhythm, resolved async so nobody has to be online at the
same time.

The design brief was simple: not a mini-game, a subreddit-scale strategy
simulation.

---

## What it does

- One real day is one game day. The city is per-subreddit and persistent —
  every post shows the same city.
- Each player sees a daily **City Report**: resources (food, power,
  medicine, morale, threat, population), the active crisis, the active law,
  and yesterday's timeline entry.
- Six **roles** (Scout, Engineer, Medic, Farmer, Guard, Speaker), each with
  a bonus to matching actions. Changeable once every three days.
- Three daily **energy** points spent on city actions — Grow Food, Repair
  Power, Treat Sick, Guard Wall — or one 90-second **expedition mission**
  into the ruins.
- One **crisis vote** and one **Council Plan** strategy vote per player
  per day. Locked once cast.
- The expedition is a seeded top-down mini-game: same map for the whole
  subreddit, personalized loot per player, air timer, warning-shot hazards,
  a bank-your-haul exit.
- A **timeline** scene shows the city's permanent history — every day, the
  headline, the events, the deltas.
- A mod-only admin menu with **force-resolve**, **reset**, and **seed-demo**
  actions for judging and testing.

---

## How we built it

- **Devvit Web** app running inside Reddit posts (`@devvit/web` 0.13).
- **Phaser 4.2** for the client scenes (Boot, Preloader, Dashboard,
  RoleSelect, Actions, Vote, Mission, MissionEnd, Timeline).
- **Hono 4** for server endpoints under `/api/`.
- **Devvit Redis** for all persistent state — hashes for city and players,
  sorted sets for leaderboards and the timeline, per-day hash keys for
  action and vote tallies. No lists (Devvit Redis does not support them).
- **Vite 8 + TypeScript** with `exactOptionalPropertyTypes: true` on the
  client, strict throughout.
- **Deterministic seeded map generation** shared between client (render)
  and server (anti-cheat validation) via `src/shared/mapgen.ts` — same
  seed, byte-identical map.
- **Lazy day resolver** under an NX lock — no cron infrastructure. The
  first request after midnight UTC triggers resolution of the previous
  day.
- **Optimistic-concurrency** energy spend and vote lock-in via
  watch/multi/exec.
- **85 tests** including a full-loop integration proof that drives the
  store and pure game logic end-to-end.

---

## Challenges we ran into

**Devvit transaction semantics were quietly wrong in our first pass.**
`tx.exec()` is typed `Promise<any[]>` and never returns null — the conflict
signal is a caught throw or an empty result array, not a null return. Our
original `exec() === null` guard was dead code; conflicts were being
silently ignored. Discovered by reading the actual
`@devvit/redis/RedisClient.js` sources and fixed with a shared
`execOrConflict` helper used across every atomic write path.

**Async multiplayer without websockets.** Devvit Web doesn't support them
and the runtime is request/response only. We made the resolver the ONLY
writer of state transitions, lazy-triggered on any request, gated by a
short-TTL NX lock so two concurrent visitors can't fork the day.

**Anti-cheat in a shared-map mini-game.** The client sends crate IDs, not
raw loot. The server regenerates the map from the token seed and prices
everything server-side. The mission token is consumed atomically via
watch/multi/del to prevent parallel-request double-banking.

**Crisis-picker orbit collapse.** Our first picker was a linear stride
`(day * 7 + cycle * 13) % pool.length`. Under the no-repeat rule, it
degenerated to a 3-crisis loop within a week — a subreddit would see the
same three crises forever. Replaced with a seeded PRNG so consecutive days
decorrelate. Now covered by a "no short-orbit lock-in" regression test.

**Balance that scales with subreddit size.** Initial constants worked for
3–5 players but any larger subreddit had zero scarcity, because drains
were population-linear while production was player-linear. Retuned to add
per-active-player drain terms so a 20-player subreddit still faces real
food and power pressure.

---

## Accomplishments that we're proud of

- Full vertical slice from empty repo to tested, integration-proofed,
  CI-green in under a week.
- 85 automated tests, including a full-loop end-to-end proof that drives
  the store and pure game logic (role → actions → mission → votes → day
  rollover).
- Reddit-native hook that doesn't feel bolted on: factions form from what
  people actually do, laws come from the leading faction, and the whole
  subreddit shares the consequences.
- Deterministic, replayable resolver — retries can't fork reality.

---

## What we learned

- Reddit's async pattern is a design constraint that becomes a design
  feature. Players return tomorrow to see collective consequences, which
  is more compelling than any "one-more-turn" solo loop.
- Adversarial audits catch what unit tests miss. Our review pass surfaced
  the dead conflict check, the orbit-collapsing crisis picker, and a
  scarcity-vanishing balance issue — none of which had a failing test
  until we wrote one.
- Devvit's platform is closer to "serverless + shared kv" than a game
  runtime. Once you accept that, the design ideas that survive are the
  ones that lean into async and shared state.

---

## What's next for One More Dawn

- Sound design and animation polish.
- Comment-write integration for scout reports and council rallies — turn
  in-game events into first-class Reddit posts and threads.
- City-vs-city Olympics season mode.
- Larger crisis pool and richer law effects.
- Dedicated Council screen (the Dashboard council panel and Vote screen
  strategy grid cover the mechanic for now).

---

## Built With

Devvit, Devvit Web, Devvit Redis, Phaser 4, TypeScript, Hono, Vite, Node.js 22.

---

## Try it out

- [GitHub repo](https://github.com/paarths-collab/reddit-game)
- Playtest link: [TBD — subreddit URL after publishing]
- Demo video: [TBD]

---

## Video pitch (2 min)

See `docs/submission/video-script.md` in the repo for the shot list and
narration.
