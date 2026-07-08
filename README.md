# One More Dawn

> A cooperative survival-strategy game for Reddit. Every subreddit is a shared
> "last city." The whole community keeps it alive — one dawn at a time — but not
> everyone agrees what kind of city it should become.

Built for **Reddit's Games with a Hook Hackathon** on **Devvit Web**. The
client is a **three.js 3D town** with a React HUD.

## Pitch

Every subreddit gets a dying city. Each real day is one game day. Pledge to save
tonight's **Marked** survivor, vote on the day's **crisis**, back a **council**
plan, spend your energy on the wall or the fields — then come back at dawn to see
what the community's choices did to the city. It's Frostpunk-style resource
pressure filtered through a subreddit's daily rhythm, resolved **async** so nobody
has to be online at the same time.

## The client: a living 3D town

The frontend is a **three.js town** (`src/client/scene.ts`) — a low-poly city on
a plateau with districts, villagers, companions, day/night cycles and raids —
wrapped in a **React HUD** (`src/client/App.tsx`) for the map, city dashboard,
live feed and leaderboard.

The fonts (Silkscreen + JetBrains Mono) are **self-hosted and bundled
same-origin**, so the pixel aesthetic survives the Devvit webview CSP.

## Why it's Reddit-native

- **The subreddit is the parliament.** The community casts the daily crisis vote
  and the council plan; the game doesn't simulate a legislature, it *uses* one.
- **Factions form from behavior, not menus.** Repairs feed the Builders, guarding
  the Wardens, expeditions the Seekers, healing the Hearth. The leading faction
  sets tomorrow's law.
- **Consequences are collective and delayed.** Food stores, threat, and the raid
  clock all carry overnight. Come back tomorrow to see the fallout.
- **Comments are the strategy layer.** Rally the vote, argue the plan, mourn the
  Marked — the debate is the mechanic.
- **No realtime needed.** Everything is async through shared Redis state — no
  websockets, no lobbies, no sync problems. One app → many subreddit installs,
  each its own isolated city.

## How it maps to the judging criteria

| Criterion | In the game |
|---|---|
| **Delightful UX** | 10-second hook splash + guided 3-tap tour; living pixel skyline; one-tap pledge; survivor avatar |
| **Polish** | Self-hosted fonts, synthesized SFX + mute, animated vitals, danger ambient, mobile-clean, zero console errors |
| **Reddit-y** | Each subreddit is a city; the community votes, pledges, and debates in comments; masked real redditors |
| **Hook-y** | Dawn Report + raid countdown: come back at sunrise to see what your choices did |
| **Retention** | Daily Marked objective, crisis vote, council plan, city timeline, contribution rank, raids |
| **User contributions** | Pledges, votes, city actions, expeditions, faction influence, public strategy in comments |

## Features

- **Persistent per-subreddit city**, resolved once per real day via a lazy,
  lock-guarded resolver (no cron).
- **The Marked** — a named survivor/place the city rallies to save before dawn —
  with free **one-tap pledges** (the lurker path: no energy cost).
- **Crisis vote** (one per day, visible tradeoffs) and a **council strategy vote**.
- **6 roles** (Scout, Engineer, Medic, Farmer, Guard, Speaker) with bonuses and a
  3-day change cooldown; earned **titles** and contribution rank.
- **3 energy/day** on city actions (Grow Food, Repair Power, Treat Sick, Guard
  Wall) or a **Phaser expedition** into the ruins (seeded, anti-cheat).
- **Survivor avatar** — chosen name, pronouns, and a pixel look.
- **Dawn Report** — yesterday's city summary + your personal impact.
- **Live drama feed**, **city vitals** with change-flash, and a **World of Cities**
  map ranking participating subreddits.
- **Factions & laws** (Builders / Wardens / Seekers / Hearth).
- **Synthesized SFX + mute**, a **living skyline** that shifts with city mood, and
  a **danger ambient** that reddens as a raid nears.
- **Mod tools**: create post, force-resolve, reset, and a rich **seed-demo** that
  spins up a judge-ready mid-run city.

## Stack

| Layer | Tech |
|---|---|
| Platform | Devvit Web (`@devvit/web` 0.13) |
| UI | **React 18** + TypeScript + Vite 8 (self-hosted fonts) |
| Mini-game | Phaser 4.2 (expedition only) |
| Server | Hono 4 (serverless request/response) |
| State | Devvit Redis (hashes + sorted sets; `redis.global` for the World map) |

## Repo layout

```
src/
  shared/     types · balance · crises · rng · mapgen · avatar (client + server)
  server/
    game/     resolver · dayLogic · lazyResolve · missionRules · marked ·
              pledges · drama · standing · village · world · demoSeed
    routes/   api (init/role/avatar/action/vote/strategy/pledge/world/…) ·
              mission · menu · triggers
    storage/  store · redisKeys · worldRegistry
  client/
    game/     api.ts (fetch wrapper + mock mode)
    react/
      App.tsx           shell, routing, onboarding gates, mutation handlers
      screens/          Home · Crisis · Feed · World · You · Rules · moments ·
                        onboarding · avatarKit · CitySky
      mission/          Phaser expedition overlay
      kit/              Toast · sound · MuteButton · useFetch
      pixel.css         the pixel command-console design system

docs/
  game/               scenario bible · matrix · ux-capabilities · asset-manifest
  submission/         devpost · video-script
  superpowers/        specs + implementation plans
```

## Development

```bash
npm ci
npm run type-check    # tsc --build
npm run lint          # eslint
npm test              # vitest (416 tests)
npm run build         # vite build → dist/{client,server}
```

Review the whole UI in a plain browser (mock mode auto-engages on localhost):

```bash
npm run build && node tools/preview-server.mjs   # → http://localhost:4519
# ?newuser=1 → first-run onboarding · ?worldlocked=1 → sub-500 World view
```

## Playtest & deploy

Requires a Reddit account, Devvit developer access, and a private test subreddit
you moderate.

```bash
npm run login         # auth the Devvit CLI (browser popup)
npx devvit init       # register the app on your account
npm run dev           # devvit playtest
npm run deploy        # type-check + lint + devvit upload
npm run launch        # deploy + devvit publish (submission)
```

To see the full experience instantly on a post, run the **"One More Dawn: seed
demo state"** mod menu action — it loads a Day-5 city mid-raid with citizens,
pledges, live votes, and a 3-day chronicle.

## CI

Every push and PR to `main` runs type-check + lint + test + build on Node 22
(`.github/workflows/ci.yml`). Publishing to Reddit is done manually via
`npm run launch`.
