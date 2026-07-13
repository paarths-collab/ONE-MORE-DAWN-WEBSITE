# Devpost Submission Draft — One More Dawn

Copy-paste ready. Reflects the current V1 build (Devvit Web + Three.js + React).
Update the video URL and playtest subreddit URL before submitting.

---

## Tagline (max 200 chars)

A cooperative survival-strategy game where your subreddit keeps the last city alive — one dawn at a time.

---

## Elevator pitch (short paragraph)

One More Dawn is a cooperative survival-strategy game where each subreddit
builds one shared city after collapse. Players gather resources, pledge to
save the Marked, vote on moral crises, back a council strategy, and raise
personal houses in first-contribution order. Everyone wants the city to survive
— but not everyone agrees what kind of city it should become.

---

## Inspiration

We wanted a game that treats a subreddit as a real place rather than a login
provider. One More Dawn opens the current post's Reddit comments for council
debate, then turns each member's binding in-game actions, votes, pledges, and
personal house into shared city state. Frostpunk-style resource pressure, filtered through a
subreddit's daily rhythm, resolved async so nobody has to be online at the
same time.

The design brief was simple: not a mini-game, a subreddit-scale strategy
simulation.

---

## What it does

- One real day is one game day. The city is per-subreddit and persistent:
  every post in a subreddit shows that subreddit’s same shared city.
- **The Marked** — a named survivor or landmark in danger tonight. Anyone can
  save it with **one tap** (no energy needed): the lurker path into the game.
- A daily **crisis vote** with visible tradeoffs and a **council plan** strategy
  vote — one each per player per day, locked once cast.
- Three **energy** points a day on city actions — Grow Food, Repair Power, Treat
  Sick, Guard Wall, or add labor toward the next shared building.
- A stable daily **personal mission**, 100 contribution levels, return streaks,
  and a standing-cost **Rekindle** option when a hard-earned streak lapses.
- **One redditor, one house** — the first accepted contribution raises your
  house in first-contribution order; the first contributor is the founder.
- **Six roles** (Scout, Engineer, Medic, Farmer, Guard, Speaker) with a 3-day
  change cooldown; each earns its own **title** track and raises a faction's
  voice (Speakers also lift morale), plus contribution rank.
- A **survivor identity** — choose a role and name your survivor so every
  masked redditor has a place in the city.
- The **Dawn Report** on the first visit each day: yesterday's city summary plus
  your personal impact. This is the "come back tomorrow" hook.
- A **living 3D town** that shifts with the city's mood, **vitals** that flash on
  change, and raid pressure that reddens as danger nears.
- A **live drama feed**, a permanent **timeline**, and a **World of Cities** map
  ranking participating subreddits against each other.
- A real **Open Reddit Comments** council path for discussion before players
  cast the binding crisis and strategy votes in the game.
- **Phoenix Dawn**: a fallen city starts a new cycle as a Camp while preserving
  long-term identity, titles, and contribution history.
- Server-side faction pressure from what players do, with richer law display
  intentionally left for post-V1.
- A mod-only admin menu with **force-resolve**, **reset**, and a rich
  **seed-demo** that spins up a judge-ready mid-run city.

---

## How we built it

- **Devvit Web** app running inside Reddit posts (`@devvit/web` 0.13).
- **Three.js + React 18 + TypeScript + Vite 8** for the town and HUD — a
  mobile-first pixel command console (`exactOptionalPropertyTypes: true`, strict
  throughout). We chose React deliberately: this is an async community strategy
  *dashboard*, with Three.js carrying the living town.
- **Self-hosted fonts** (Silkscreen + JetBrains Mono via `@fontsource`), bundled
  same-origin so the pixel aesthetic survives the Devvit webview CSP.
- **Hono 4** for server endpoints under `/api/`.
- **Devvit Redis** for all persistent state — hashes for city and players,
  sorted sets for leaderboards, per-day hash keys for action/vote/pledge
  tallies, and `redis.global` for the cross-subreddit World map. No lists
  (Devvit Redis does not support them).
- **Lazy day resolver** under an NX lock — no cron. The first request after
  midnight UTC resolves the previous day.
- **Optimistic-concurrency** energy spend and vote lock-in via watch/multi/exec.
- Automated tests and browser smoke coverage for the V1 loop, including a
  full-loop integration proof and property tests that drive the store and pure
  game logic end-to-end.

---

## Challenges we ran into

**Devvit transaction semantics were quietly wrong in our first pass.**
`tx.exec()` is typed `Promise<any[]>` and never returns null — the conflict
signal is a caught throw or an empty result array, not a null return. Our
original `exec() === null` guard was dead code; conflicts were being
silently ignored. Discovered by reading the actual
`@devvit/redis/RedisClient.js` sources and fixed with conflict-aware
transaction guards: an `execOrConflict` helper on the mission path and a
shared `beginUserLock` watch/multi/exec wrapper on every per-player
mutation route (`/action`, `/vote`, `/strategy`, `/pledge`, `/rekindle`).

**Async multiplayer without websockets.** Devvit Web doesn't support them
and the runtime is request/response only. We made the resolver the ONLY
writer of state transitions, lazy-triggered on any request, gated by a
short-TTL NX lock so two concurrent visitors can't fork the day.

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

- A focused V1 survival loop — CI-green with automated tests, including a
  full-loop end-to-end proof (role → actions → votes → day rollover) and
  property tests.
- A React UI that reads like a *place*: a living skyline, a one-tap pledge, a
  Dawn Report, and a survivor you build yourself — all crisp on mobile.
- Reddit-native hook that doesn't feel bolted on: daily actions, votes, pledges,
  and houses all come from real contributors, and the whole subreddit shares the
  consequences.
- Deterministic, replayable resolver — retries can't fork reality.
- Ships CSP-clean: fonts self-hosted, no external requests, no inline scripts.

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

- Deeper comment integration for event summaries after V1.
- A cohesive custom icon set to replace the remaining emoji.
- Marked portrait art with saved/lost states.
- City-vs-city Olympics season mode on top of the World map.
- Larger crisis pool and richer law effects.

---

## Built With

Devvit, Devvit Web, Devvit Redis, **React**, Three.js, TypeScript, Hono, Vite,
`@fontsource`, Node.js 22.

---

## Try it out

- [GitHub repo](https://github.com/paarths-collab/reddit-game)
- Playtest link: [TBD — subreddit URL after publishing]
- Demo video: [TBD]

---

## Video pitch (under 1 min)

See `docs/submission/video-script.md` in the repo for the shot list and
narration.
