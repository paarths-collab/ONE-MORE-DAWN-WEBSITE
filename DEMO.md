# One More Dawn — Frontend-Only Judge Demo

This branch (`demo-judge-frontend`) builds a **self-contained, deployable, frontend-only** version of
_One More Dawn_ so **judges can click through the whole game in a normal browser** — no Reddit
account, no Devvit runtime, no server.

> **This is a visual way to experience the game, not the live product.** _One More Dawn_ is a Reddit
> (Devvit) app: one shared, persistent city per subreddit that a whole community keeps alive together.
> This demo simulates all of that **in your browser** — every `/api/*` call is answered by an in-memory
> mock, nothing is saved, and a refresh restarts the day. The app itself says so up front: an
> **"ENTER THE CITY" notice** appears on load and a small **"◆ FRONTEND DEMO"** ribbon stays visible.
> Choosing **ENTER THE CITY** starts Maren's complete 14-stop judge tour. She opens and spotlights the
> core loop, role duty, world, shop and land expansion, puzzle, leaderboard, and badge wall in place.

## What judges can experience

The client boots into its full **LIVE** experience — everything is interactive:

- The **daily mission** and, next to it, the **role duty** (your role's signature task).
- The **BADGES** wall in the STATS ledger (streak / house tier / rank / phoenix / founder…).
- **City actions** (grow food, repair, treat, guard, build), the **crisis vote**, **council plans**,
  and **The Marked** pledge.
- The **cosmetic shop** + **community land expansion**, the **daily puzzle**, the **world map**,
  the **leaderboard**, and **City Chatter**.
- The self-running 3D pixel town (three.js), sound, and music.

## How it works (so it needs no backend)

Every API call in the client goes through one `fetch('/api/*')` helper. In the demo build the entry
(`src/client/game.tsx`) installs `src/client/frontendMock.ts`, which patches `window.fetch` to answer
`/api/*` from in-memory fixtures **before React mounts**. This is gated by the `__DEMO__` build flag
(set only by `vite.demo.config.mjs`), so the **real Devvit build never ships the mock or the banner**.
Asset paths are relative and the build uses `base: './'`, so it runs from any URL (root **or** subpath).

## Deploy it

The static site builds to **`dist-demo/`** via `npm run build:demo`.

### Vercel (recommended, config included)
Import this repo in Vercel and pick the **`demo-judge-frontend`** branch. `vercel.json` already sets the
build command (`npm run build:demo`) and output dir (`dist-demo`) — just deploy. Every push to the branch
redeploys.

### Netlify (config included)
New site → pick this branch. `netlify.toml` sets `command = "npm run build:demo"` and
`publish = "dist-demo"`.

### GitHub Pages / any static host
```bash
npm install
npm run build:demo      # → dist-demo/  (contains index.html)
```
Upload `dist-demo/` to any static host (GitHub Pages, Cloudflare Pages, S3, `netlify deploy`, etc.).
Because the build is fully relative-pathed, it works served from a domain root **or** a subpath like
`https://user.github.io/reddit-game/`.

## Run it locally

```bash
npm install
npm run build:demo
npx vite preview --config vite.demo.config.mjs   # serves dist-demo/ at http://localhost:4650
```

## Notes

- **Nothing is persistent.** All state (coins, votes, pledges, shop, puzzle progress) lives in the tab
  and resets on reload — by design, since there is no server.
- This branch is a **deployment target only**; it is not intended to merge into `main`. The mock and
  banner are inert in the real Devvit build regardless (they compile out when `__DEMO__` is unset).
- Requires WebGL / hardware acceleration (same as the real game); a fallback notice shows otherwise.
