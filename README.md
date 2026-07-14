# One More Dawn

> A cooperative survival-strategy game for Reddit. Every subreddit is a shared
> "last city." The whole community keeps it alive — one dawn at a time — but not
> everyone agrees what kind of city it should become.

Built for **Reddit's Games with a Hook Hackathon** on **Devvit Web**. The client
is a **three.js 3D town** with a **React HUD**.

> **V1 scope:** this README describes what actually ships. For the frozen V1
> feature set (and what's intentionally cut), see [`docs/V1_SCOPE.md`](docs/V1_SCOPE.md).

## What it is

Every subreddit gets a dying city. Each real day is one game day. Choose a role,
spend three energy on meaningful actions, **vote** on the day's crisis, back a **council** plan,
and **pledge** to save tonight's **Marked** survivor — then come back at dawn to
see what the community's choices did to the city. Frostpunk-style resource
pressure filtered through a subreddit's daily rhythm, resolved **async** so nobody
has to be online at once.

## The client: a living 3D town

The frontend is a **three.js town** (`src/client/scene.ts`) — a low-poly city on
a plateau with districts, villagers, companions, and a day/night cycle — wrapped
in a **React HUD** (`src/client/App.tsx`) for the map, city dashboard, live feed,
world map, and leaderboard.

Fonts (Silkscreen + JetBrains Mono) are **self-hosted and bundled same-origin**,
so the pixel aesthetic survives the Devvit webview CSP.

The client runs in three honest modes, decided by one `/api/init` call:
- **live** — talking to the real shared city (production).
- **demo** — the self-running town, only on a `localhost` dev harness.
- **offline** — production API/auth failure shows an explicit "city link lost" +
  retry, never a fake city.

## The V1 gameplay loop

1. **Open** the game post → the town loads; this subreddit is the city. A new
   city starts as a bare **Camp** — no wall, no farm, everything still to build.
2. **Onboard** — pick one of 6 roles (Scout, Engineer, Medic, Farmer, Guard,
   Speaker) and optionally name your survivor.
3. **Read the city** — live vitals (FOOD, POWER, MEDICINE, MORALE, THREAT,
   DEFENSE) and the **build stage** (Camp → Settlement → Village → Fortified Town
   → Surviving City).
4. **Act** — spend energy on a daily action (Grow Food / Repair Power / Treat the
   Sick / Guard the Wall) **or add labor to the next building**. It counts toward
   tomorrow's dawn.
4b. **Build it together** — a shared progress bar fills from everyone's labor; at
   dawn the next building unlocks (Shelter → Farm → Clinic → Watchtower →
   Storehouse → Wall → Council Hall) and appears in the town. Those shared
   **amenities** are community-built (no free placement), while **every
   contributor raises their own house** — the first contributor founds the city
   and the town fills one redditor at a time.
5. **Decide together** — vote on the day's **crisis**, back a **council** plan,
   and **pledge** to save **The Marked**. The weekly **City Chatter Hub** brings
   Reddit comments into the LIVE panel for strategy, raids, rebuilding, and
   general discussion; binding decisions remain in-game.
6. **Brace** — watch the **raid countdown**; raids resolve at dawn.
7. **Return** — the **Dawn Report** shows what the community's choices did, and the
   city timeline remembers it. If the city falls, a memorial holds for the day,
   then the **Phoenix Dawn** rebirths it as a fresh Camp in the next cycle;
   every player's titles, streaks, and lifetime standing carry over.

## Why it's Reddit-native

- **The subreddit is the parliament** — the community casts the daily crisis vote
  and council plan, while an app-created weekly Chatter Hub organizes real
  Reddit discussion beneath daily prompts; the game *uses* a real community
  instead of simulating one.
- **Consequences are collective and delayed** — food, threat, and the raid clock
  carry overnight; come back tomorrow for the fallout.
- **No realtime needed** — everything is async through shared Redis state. One app
  → many subreddit installs, each its own isolated city.

## Stack

| Layer | Tech |
|---|---|
| Platform | Devvit Web (`@devvit/web` 0.13) |
| UI | three.js 0.171 + **React 18** + TypeScript + Vite (self-hosted fonts) |
| Server | Hono 4 (serverless request/response) |
| State | Devvit Redis (hashes + sorted sets; `redis.global` for the World map) |

## Repo layout

```
src/
  shared/     types · balance · crises · rng · mapgen · avatar (client + server)
  server/
    core/     moderator (auth guard) · post
    game/     resolver · dayLogic · lazyResolve · missionRules · marked ·
              pledges · drama · standing · village · world · demoSeed
    routes/   api (init/role/avatar/action/vote/strategy/pledge/world/…) ·
              chatter · mission · menu · scheduler · triggers
    storage/  store · redisKeys · worldRegistry
  client/
    App.tsx       React HUD: onboarding, dashboard, live/demo/offline, modals
    scene.ts      the three.js town (scene, districts, villagers, camera)
    api.ts        typed same-origin fetch helpers for /api/*
    liveUi.ts     pure live-mode helpers (+ liveUi.test.ts)
    game.tsx      entry (self-hosted fonts) · game.html · styles.css
docs/
  V1_SCOPE.md         the frozen V1 feature set
  audit/              v1-readiness-audit · private-subreddit smoke · dependency risk
  game/               scenario bible · matrix
  submission/         devpost · video-script
```

## Development

```bash
npm ci
npm run type-check    # tsc --build
npm run lint          # eslint
npm test              # vitest server/shared/client unit tests
npm run build         # vite build → dist/{client,server}
npm run test:client   # local mock-live browser smoke
```

Review the built client in a plain browser (boots in **demo mode** — no backend):

```bash
npm run build && node tools/preview-server.mjs   # → http://localhost:4519
```

Iterate on the client source with the standalone dev harness (port 4630):

```bash
node node_modules/vite/bin/vite.js --config vite.dev3d.config.mjs   # demo mode
MOCK_API=1 node node_modules/vite/bin/vite.js --config vite.dev3d.config.mjs   # mocked "live"
# MOCK_API + MOCK_ROLE_NULL=1 → onboarding · MOCK_FALLEN=1 → fallen-city screen
```

## Playtest & deploy (human-only)

Requires a Reddit account, Devvit developer access, and a private test subreddit
you moderate. **These steps authenticate as you — run them yourself; do not
automate them.**

```bash
npm run login         # auth the Devvit CLI (browser popup)
npx devvit init       # register the app on your account (one-time)
npm run dev           # devvit playtest on your test subreddit
npm run deploy        # type-check + lint + test + build, then devvit upload
npm run launch        # deploy + devvit publish (submission)
```

Before publishing, run the human smoke test in
[`docs/audit/private-subreddit-v1-smoke.md`](docs/audit/private-subreddit-v1-smoke.md).
To see a full city instantly on a post, run the **"One More Dawn: seed demo
state"** mod menu action.

## Known V1 limitations

Deliberately cut or hidden for a small, honest V1 (see `docs/V1_SCOPE.md`):

- **No scavenge/expedition minigame in V1** — the unfinished backend module is
  fail-closed at its route, and the action is absent from the live 3D town.
- **Sound + music, each muteable** — Kenney CC0 SFX cues on key events (action,
  vote, pledge, raid warning, dawn report, fallen city) plus three CC0 ambient
  tracks that follow the game state (dusk / raid / dawn; music defaults off),
  behind separate persisted toggles; all local files, fail-silent, never blocks
  gameplay — see [`docs/ATTRIBUTION.md`](docs/ATTRIBUTION.md).
- **Avatar is name-only** — you name your survivor; a full look editor and
  in-world avatar rendering are post-V1.
- **City trait and active law** are computed server-side but not yet surfaced in
  the UI.
- **One city per subreddit** — every game post in the same subreddit reads the
  same shared city state for this V1.
- **City Chatter posts are public Reddit actions** — the composer is optional,
  discloses the side effect, waits for Reddit confirmation, and links each
  message back to native Reddit moderation. In unapproved playtests, Reddit may
  attribute a non-owner's `runAs: USER` comment to the app account; verify real
  attribution during the private-subreddit smoke test.
- **Live raids are forecast/report-driven** — the animated raid cinematic runs in
  demo mode only.
- **`npm audit`** reports transitive vulnerabilities through the Devvit toolchain —
  see [`docs/audit/dependency-risk-note.md`](docs/audit/dependency-risk-note.md).

## CI

Every push and PR to `main` runs type-check + lint + test + build on Node 22
(`.github/workflows/ci.yml`). Publishing to Reddit is done manually via
`npm run launch`.
