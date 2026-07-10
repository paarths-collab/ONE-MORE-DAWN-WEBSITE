# One More Dawn — V1 Launch-Readiness Audit

> Read-only audit. No game code was modified; this is the only file created/edited.
> (It replaces an earlier draft at this path — a prior pass reached a compatible
> ~7.2/10; this version is re-verified against the current `main` with `file:line`
> citations and a fresh gate run + client boot.)
>
> **Superseded 2026-07-10:** any "sound absent" note and exact test counts
> (e.g. "474 tests") below are now stale — minimal SFX + persistent mute ship
> (`src/client/sound.ts`, `docs/ATTRIBUTION.md`) and the suite has grown since.
> Treat "the full Vitest suite passes green in CI" as the durable claim.
>
> Method: read the actual code, ran the full gate suite, drove the running client
> via the dev harness (demo) and — earlier this session — via the `MOCK_API`
> harness (live/onboarding/fallen). **Not verifiable here:** a real Redis-backed
> Devvit runtime (`npm run dev` on a test subreddit — human-only). Every "live"
> behavior below was proven against a *faithful mock*, never real Reddit. That is
> the crux of the verdict.

Date: 2026-07-08 · Branch: `main` (V1 work merged: PRs #24/#25/#26/#27/#22).

---

## 1. V1 launch verdict

- **Ready to publish V1?** **Almost** — publish after the P0 real-runtime smoke test and a scope-truth cleanup.
- **Demo-ready?** **Yes** (standalone demo + mocked-live loop are solid today).
- **Biggest blocker:** the app has **never run on a real Devvit runtime**. All live proof is a mock; real `/api/init`, Redis, mod checks, and `postId` are unexercised.
- **Biggest UX risk:** **scope truth** — the README + first-run expectations promise features the shipped client doesn't have (Phaser expedition, sound/mute, full avatar). A user told "create a survivor avatar (name, pronouns, look)" gets a name field, and the avatar is never shown in-world.
- **Biggest technical risk:** unguarded `JSON.parse` on every Redis read (`src/server/storage/store.ts:40,74,79,90,101,108`) — one corrupt record 500s a core route.
- **Overall readiness score: 7 / 10.** Strong, tested backend and a real end-to-end core loop; deductions are the untested-on-real-Devvit risk plus doc/feature mismatch.

---

## 2. 60-second new user test

| Step | Pass/Fail | Evidence | Problem | Fix needed |
|---|---|---|---|---|
| Understand what OMD is | **Partial** | Topbar "THE LAST CITY"; subtitle = `standing.rankLabel` (`App.tsx` TopBar). Splash is static. | No one-line premise on first load. | One-line pitch in splash or first coachmark. |
| Know which city/community | **Partial** | World map uses `you.subreddit` (`App.tsx:827`); main HUD title is generic. | Subreddit/city name not on the primary screen. | Show city/subreddit name in the live topbar. |
| Create / see identity | **Partial** | Onboarding = role + optional **name only**; look hardcoded (`App.tsx:2162`). Avatar **never displayed** (only a type import, `api.ts:9`). | "Avatar creation" is thin + invisible. | Relabel "name your survivor"; look post-V1. |
| Find the main action | **Pass** | Dawn-actions hotbar always visible; onboarding funnels into it. | — | — |
| Complete one action | **Pass** | Live `runAction`→`/api/action`; energy 2→1 (observed via mock). | — | — |
| Feedback something happened | **Pass** | `pushNotif`, toast, event feed. | Vitals move at dawn, not instantly (correct, but may surprise). | Copy already says "lands at next dawn". |
| Know when to return | **Pass** | Dawn Report teaser; raid forecast line (`App.tsx:631,1484`); RAID WATCH. | — | — |

**Verdict:** the 60-second promise is *achievable*; identity + city-name clarity are the soft spots.

---

## 3. Core game loop readiness

| Step | Implemented | Wired e2e | Feedback | Survives refresh | Understandable |
|---|---|---|---|---|---|
| Boot → mode decision | Yes | Yes (`App.tsx:1984`) | Loader (`:1619`) | Yes | Yes |
| Onboarding (role) | Yes | Yes (`postRole`→`/api/role`) | "role set" notif | Yes (server persists) | Yes |
| Avatar | **Partial** | Name persists (`/api/avatar`→`savePlayer`) | None (never shown) | Persists | **Weak** |
| City overview | Yes | Yes | Vitals bars, day pill | Yes (30s poll) | Yes |
| Daily action | Yes | Yes (`/api/action`) | Notif + energy | Yes | Yes |
| Scavenge | **Cut in live** | Demo-only; hidden live (`App.tsx:1188,1212`) | n/a | n/a | Honest (hidden) |
| Crisis vote | Yes | Yes (`/api/vote`, disables) | Tally + notif | Yes | Yes |
| Council vote | Yes | Yes (`/api/strategy`) | Notif | Yes | Yes |
| Marked pledge | Yes | Yes (`/api/pledge`) | Marked bar + notif | Yes | Yes |
| Server update | Yes | Yes (poll re-applies init) | Numbers refresh | Yes | Yes |
| Raid / status | **Partial (live)** | Server threat/`raidInDays`; **no live raiders** | Forecast + banner | Yes | Partial |
| Dawn Report | Yes | Yes | Teaser | Yes | Yes |
| Fallen (terminal) | Yes | Yes (surfaces suppressed) | Full screen | Yes | Yes |

**The spine is wired end-to-end.** Soft spots: avatar (partial), live raid legibility (report-only).

---

## 4. Feature readiness table

| Feature | V1 status | Evidence | User impact | Required before publish? |
|---|---|---|---|---|
| Onboarding | **Ready** | Role overlay on `role===null`; observed | Clear identity gate | — |
| Avatar creation | **Partial** | Name only; look hardcoded `App.tsx:2162` | Thin vs promise | Relabel |
| Avatar persistence | **Partial** | `/api/avatar`→`savePlayer`; never displayed | Persists but unseen | No |
| Home/dashboard | **Ready** | `CityDashboard` MAP/CITY/LIVE/TOP | Good | — |
| City vitals (6) | **Ready** | TopBar + CITY tab; observed at server caps | Clear | — |
| Daily actions (4) | **Ready** | Hotbar → `/api/action`, energy-gated | Core loop | — |
| Scavenge (3) | **Cut in live** | Hidden `App.tsx:1188,1212`; demo-only | Pillar absent to real players | Cut officially |
| The Marked | **Ready** | `/api/pledge` | Works | — |
| Crisis vote | **Ready** | `/api/vote`, one/day | Works | — |
| Council vote | **Ready** | `/api/strategy` | Works | — |
| Raid state | **Partial (live)** | Forecast/`raidInDays` only | Drama less legible | No |
| Raid resolution | **Ready (backend)** | `resolver.ts` + timeline/dawn notif | Consequences real | — |
| Laws | **Absent (UI)** | `activeLaw` in init, **not rendered** (grep empty) | Invisible | No (cut/label) |
| Traits | **Absent (UI)** | `city.trait` in init, **not rendered** | Invisible | No (cut/label) |
| Chronicle | **Ready (as feed)** | Drama/events feed (`App.tsx:1952`) | History visible | — |
| Forecast | **Ready** | `raidLikely`/`raidNote` (`App.tsx:631,1484`) | Clear | — |
| World status (5) | **Ready** | World map; observed 6 cities | Works | — |
| Sound / mute | **Absent** | No audio in `src/client` (grep 0); no mute button (observed) | Listed feature missing | Cut officially |
| Demo seed | **Ready** | Mod menu `/internal/menu/seed-demo` (`devvit.json`) | Judge-friendly | — |
| Error states | **Ready** | `OfflineNotice`+retry `App.tsx:1603,1611`; `toastFailure` | Fails safe | — |
| Loading states | **Ready** | `Loader` (`App.tsx:1619`) | Fine | — |
| Mobile layout | **Ready** | Media queries; 375px: no overflow, tabs fit (observed) | Good | — |
| Reddit comments/participation | **Partial (cosmetic)** | "SAY HI/comments" feed = chatter/drama, **not** real comment posting; real participation = async shared votes/pledges | Label may mislead | Relabel |

---

## 5. Publish blockers

**P0 — must fix before publish**
- **P0 · Server/Devvit · (process gap):** never run on a real Devvit runtime. **Breaks:** unknown — a real-server↔client shape mismatch (my proof was a mock) would break live for all users. **Fix:** `npm run dev` playtest on a test subreddit; walk onboard→act→vote→mod force-resolve→Dawn Report; confirm subtitle ≠ "demo mode". Human-only.

**P1 — should fix before publish if time allows**
- **P1 · Docs/Scope · `README.md:49,65,66,71,82`:** README promises **Phaser expedition** (removed in PR #25), **synthesized SFX + mute** (no audio ships), and **avatar with pronouns + pixel look** (client captures name only). **Breaks:** scope truth — users/judges are promised features that don't exist. **Fix (docs-only):** update README + any player-facing copy to the shipped 3D scope. *(Not applied — read-only audit.)*
- **P1 · Data · `store.ts:40,74,79,…`:** unguarded `JSON.parse`. **Fix:** `safeParse<T>(raw, fallback)`.
- **P1 · UX · Avatar (`App.tsx:2162`):** name-only. **Fix (copy):** "Name your survivor."
- **P1 · UX · Scavenge (`App.tsx:1188`):** hidden in live, unexplained. **Fix:** officially cut; remove from feature copy.

**P2 — safe to ship, improve later**
- **P2 · UI · Laws/traits** received in init, never rendered — add a read-only line later.
- **P2 · Deps · `npm audit`** 31 vulns (4 high/25 mod/2 low), Devvit transitive — accept/annotate for V1.
- **P2 · Build** 2 warnings (`sourcemapFileNames`, `inlineDynamicImports`) — cosmetic.
- **P2 · Feature · Sound/mute** absent — cut officially or re-add post-V1.

---

## 6. Smoothness audit

| Screen/flow | Smooth? | Evidence | Friction | Fix |
|---|---|---|---|---|
| Boot / loader | Yes | `Loader` pct; clean load | No distinct "logging in" copy | Minor |
| Onboarding | Yes | ENTER disabled until role picked (observed) | ✕ can dismiss role-less | Require role in live |
| Main HUD | Yes | Organized; 375px no overflow | Dense chrome | Progressive disclosure (later) |
| LIVE tab | Yes | Server-driven crisis/marked/council | No "do this next" priority | Highlight best action |
| Hotbar | Yes | Energy pill; disabled from `yourActionsToday` | Energy meaning subtle | Tooltip |
| Scavenge | n/a (live) | Hidden | Silent absence | Cut officially |
| MAP (town/world) | Yes | Fly-to; honest empty state (`App.tsx:843`) | Long sub names could overflow SVG | Truncate |
| STATS ledger | Yes | Structured tables | Long scroll | Summary row |
| Dawn Report | Yes | Non-blocking teaser + modal | — | — |
| Offline | Yes | "CITY LINK LOST" + ↻ RETRY (`:1603,1611`) | Same copy auth vs network | Split |
| Fallen | Yes | Terminal; surfaces suppressed | — | — |
| Dead buttons | **None** | BUILD/UPGRADE + scavenge correctly hidden in live | — | — |

No placeholder screens; no dead buttons; 1 legit `console.error` (`triggers.ts:21`).

---

## 7. Game logic correctness

| Check | Result | Evidence |
|---|---|---|
| Action once/day | **Correct** | `yourActionsToday` + energy gate client; server per-user lock (`api.ts` `/action`, `userLock`). |
| Vote once/user | **Correct** | `yourCrisisVote` disables; server per-day hash 409s. |
| Vitals clamp | **Correct** | Server `clampPct`/`clampStock` (`resolver.ts`); client `clampVit`. |
| Raid threshold | **Correct (server)** | `threat>=raid.triggerThreshold` (`balance.ts`); client `raidInDays`. Demo's `DEFENSE>=40` is demo-only, not shipped. |
| Fallen city | **Correct** | Server `status='fallen'`; client terminal + handlers dead (observed). |
| Returning user | **Correct** | `/init` loads persisted state; `revivePlayer` backfills (`store.ts:62`). |
| First-time init | **Correct** | `loadOrCreatePlayer` persists; onboarding gates on `role===null`. |
| Async stale state | **Guarded** | Refs mirror timer/handler reads; functional `setState`. |
| Server↔client desync | **Low** | Live = server truth; local sims gated `mode==='demo'` (food stable in live, observed). |
| Silent failures | **Handled** | Mutations `.catch(toastFailure)`; boot failure → offline/demo, not blank. |

**Suspicion (unconfirmed live):** onboarding ✕ dismiss admits a role-less player for the session; low harm (role-gated server actions 400→toast) but confirm in the real playtest.

---

## 8. Reddit/Devvit publish fitness

| Check | Result | Evidence |
|---|---|---|
| No CSP-blocked assets | **Pass** | GLBs same-origin `public/assets`; scene loads `assets/*.glb`. |
| No external fonts | **Pass** | Self-hosted `@fontsource` in `game.tsx`. |
| No secrets exposed | **Pass** | 0 `any`, no tokens in client; server uses Devvit context. |
| No deploy-only assumptions | **Pass** | Build → `dist/{client,server}`; `devvit.json` → `dist/client` + `index.cjs`. |
| No dev mock in prod | **Pass** | Demo gated on `localhost` (`liveUi.ts:8`); `MOCK_API` env-gated (`vite.dev3d.config.mjs`), never in Devvit build. |
| Works in webview | **Unverified (real runtime)** | Mock only — **the P0**. |
| Human-only publish documented | **Pass** | README "Playtest & deploy"; `deploy.yml` `workflow_dispatch` + needs `DEVVIT_TOKEN`. |
| Setup clear | **Partial** | README steps are clear, but its **feature list is stale** (P1 above). |

---

## 9. Tests and confidence

- **Typecheck:** PASS. **Lint:** PASS (0 problems; 0 `any` in non-test src). **Build:** PASS (2 warnings).
- **Tests:** PASS — **474 / 30 files**. Split: 16 game-logic, 3 route, 3 storage, 7 shared, **1 client** (`liveUi.test.ts`).
- **npm audit:** 31 (4 high/25 mod/2 low), Devvit transitive.

**Minimum client tests to add before/just-after publish (the coverage gap is entirely client):**
1. Boot/mode decision (success→live; localhost-fail→demo; prod-fail→offline).
2. Onboarding gate (role null → overlay; `postRole` closes).
3. Fallen state (surfaces suppressed; handlers no-op).
4. Live action/vote/pledge update + disable.
5. Avatar persistence round-trip.

Server already covers action-once, vote-once, mission anti-replay, raid threshold/resolution, fallen guards, mod auth (`menu.test.ts`, `api.routes.test.ts`). The `MOCK_API` harness is the ready backend for the client tests.

---

## 10. What to cut from V1

| Feature | Recommendation | Rationale |
|---|---|---|
| Scavenge (missions) | **Cut / keep hidden** | Already hidden in live; not wired to the 3D client. Don't advertise. |
| Sound / mute | **Remove from V1 list** | Entirely absent; re-add later. |
| Avatar look editor | **Relabel "name your survivor"** | Ship the working subset; look post-V1. |
| Laws / traits display | **"Coming soon" or omit** | Data exists server-side; chronicle+forecast carry the "history" feel. |
| Live raid visuals | **Later** | Forecast + Dawn Report convey consequence today. |
| Phaser mini-game (README) | **Remove from docs** | Deleted in PR #25; the README is stale. |

**No dead buttons in the live surface** — everything visible is real or intentionally hidden. Right V1 posture.

---

## 11. What is already good

- **Backend is genuinely strong + tested:** lazy resolution, per-user locks, one/day guards, mission anti-replay, raid/fall logic, laws — 474 tests (`resolver.ts`, `lazyResolve.ts`, `missionRules.ts`, `store.ts`).
- **Security posture:** `requireUser` on every `/api` route (`api.ts:204,377,406,423,500,545,588,662,714,722,775`); `requireModerator` fail-closed on `/internal/menu/*` (`src/server/core/moderator.ts`); `userId` stripped from leaderboard.
- **Honest modes:** live/demo/offline from one `/api/init`; demo only on `localhost` (`liveUi.ts:8`); offline shows real retry (`App.tsx:1603`).
- **Code hygiene:** 0 `any`, 1 legit `console.*`, no TODO/FIXME, strong shared types honored both sides.
- **The 3D town:** distinctive, mobile-safe (375px verified), with real onboarding and a real fallen-city terminal state.
- **Judge ergonomics:** mod "seed demo" + "force-resolve" menu actions; standalone demo mode with no backend.

---

## 12. Final launch checklist

**Must fix before publish**
- [ ] **Real `npm run dev` playtest** on a test subreddit: onboard → role → action → crisis vote → pledge → mod "seed demo" → "force-resolve" → Dawn Report; confirm subtitle ≠ "demo mode". (P0, human-only.)
- [ ] Confirm the real `/api/init` payload matches the client (proof was a mock).

**Can ship with known limitation**
- [ ] Update README/feature copy to shipped scope (remove Phaser expedition, SFX/mute, avatar pronouns/look).
- [ ] Scavenge cut from V1 (hidden in live).
- [ ] Sound/mute absent.
- [ ] Avatar = name only, not shown; relabel.
- [ ] Laws/traits not surfaced.
- [ ] Live raids report/forecast-driven.
- [ ] `npm audit` 31 transitive vulns — accepted.

**Post-V1 polish**
- [ ] Client tests via `MOCK_API` harness.
- [ ] `safeParse` in `store.ts`.
- [ ] Split `App.tsx` (~2,900 lines).
- [ ] Live raid-aftermath visuals; avatar look editor; laws/traits line; long-name truncation.
- [ ] Clear build warnings; bump Devvit stack.

---

## Final answer

**Publish after the P0 fix (+ a quick scope-truth cleanup).**

The core V1 loop is real, wired end-to-end, and verified against a faithful mock — a new user can understand the game, onboard with a role, take a meaningful action, get feedback, and see a return hook, all against server truth with honest live/demo/offline modes and no dead buttons. The backend is production-quality and well-tested.

But **do not `launch` until it has run once on a real Devvit runtime** (`npm run dev`), and **align the README/feature copy with what actually ships** (drop Phaser expedition, SFX/mute, and full-avatar promises). The remaining gaps (avatar look, scavenge, sound, laws/traits) are safe to **cut or relabel** — a smaller, honest V1 that nails the survival loop is the right ship.

**Score: 7/10 — Almost ready; one real playtest and a docs pass away.**
