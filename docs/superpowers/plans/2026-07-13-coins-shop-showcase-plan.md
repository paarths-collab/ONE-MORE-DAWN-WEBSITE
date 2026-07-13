# Coins, Shop, Civic Projects, and Launch Showcase Plan

Status: proposed. Approve the locked product rules before implementation.

## 0. Goal

Add a small, server-authoritative reward economy that strengthens the existing
"one Redditor, one house" loop:

1. Helpful actions earn Coins.
2. Coins buy persistent personal house cosmetics.
3. Players can fund shared cosmetic civic projects for built structures such as
   the Wall.
4. A separate localhost-only showcase branch provides deterministic scenes for
   rehearsing and recording the launch video.

This is not a paid currency and does not sell power.

## 1. Locked product rules

### Currency

- UI name and icon: `Coins` / `coin` icon.
- Coins are earned only from accepted server contributions.
- Suggested award: 1 Coin for an accepted daily action, build labor, crisis
  vote, strategy vote, or Marked pledge.
- Daily earning cap: 5 Coins per player.
- Rejected, repeated, stale, moderator, seed-demo, and retry requests earn 0.
- Coins are scoped to one subreddit installation, matching the shared city.
- Coins and owned personal cosmetics survive Phoenix cycles. A full moderator
  reset clears them with the player profile.

### Shop

- No real-money purchase path in this release.
- No energy, votes, survival guarantees, resource bundles, or combat power.
- Personal items are cosmetic, purchased once, and can be equipped repeatedly.
- One equipped item per slot: roof, banner, light, and yard.
- The actual Wall remains a shared labor unlock. It cannot be personally bought.
- Wall shop items are decorations that remain locked until the Wall exists.

### Initial catalog

Personal house cosmetics:

| Item | Slot | Price | Three.js result |
| --- | --- | ---: | --- |
| Hearth Lantern | light | 3 | Warm lantern on the player's house |
| Crimson Banner | banner | 5 | Small survivor banner |
| Garden Plot | yard | 6 | Planter and fence beside the house |
| Slate Roof | roof | 8 | Dark slate roof material |
| Dawn-Gold Trim | roof | 12 | Gold roof trim and ridge cap |

Shared civic projects:

| Project | Requirement | Community target | Three.js result |
| --- | --- | ---: | --- |
| Gate Braziers | Watchtower built | 20 Coins | Two lit gate braziers |
| Wall Standards | Wall built | 30 Coins | Banners on the finished Wall |
| Council Bell | Council Hall built | 40 Coins | Bell and banner at the hall |

Start with the five personal items. Civic projects are the second milestone and
must not delay testing the core currency and purchase path.

## 2. Shared contract

Create `src/shared/shop.ts` as the only catalog authority imported by both the
server and client.

```ts
export type ShopItemId =
  | 'hearth_lantern'
  | 'crimson_banner'
  | 'garden_plot'
  | 'slate_roof'
  | 'dawn_gold_trim';

export type CosmeticSlot = 'roof' | 'banner' | 'light' | 'yard';

export type ShopItem = {
  id: ShopItemId;
  name: string;
  slot: CosmeticSlot;
  price: number;
  description: string;
};

export type EconomyState = {
  coins: number;
  earnedToday: number;
  dailyCap: number;
  owned: ShopItemId[];
  equipped: Partial<Record<CosmeticSlot, ShopItemId>>;
};
```

`PlayerProfile` gains backward-compatible economy fields. `Store.revivePlayer`
must default old saves to 0 Coins, no owned items, and no equipped items.

`InitResponse` gains `economy`. Purchase and equip responses return the complete
new economy state so the client never guesses balances.

## 3. Server implementation

### Coin awarding

Add a pure helper such as `awardContributionCoin(player, cityDay)` that:

- resets `earnedToday` when the stored earning day differs from the city day;
- awards at most 1 Coin for the accepted contribution;
- never exceeds the daily cap;
- returns both the updated player and `coinsGained`.

Apply it inside the existing per-user optimistic transaction for:

- `POST /api/action`, including `build_city`;
- `POST /api/vote`;
- `POST /api/strategy`;
- `POST /api/pledge`.

The contribution must pass every existing validation first. Coin writes ride in
the same player commit as the accepted action so a retry cannot create money.

### Shop routes

Add:

- `POST /api/shop/purchase` with `{ itemId }`;
- `POST /api/shop/equip` with `{ itemId }`;
- later, `POST /api/shop/donate` with `{ projectId, amount }`.

Every route must:

- derive the user from Devvit context;
- look up price, slot, and prerequisites from `src/shared/shop.ts`;
- reject unknown IDs, duplicates, negative balances, and unavailable items;
- ignore any client-supplied price or balance;
- use `beginUserLock` and update the complete player JSON atomically;
- return 409 on a same-user conflict instead of charging twice.

For civic projects, use an installation-scoped Redis hash and atomic `hIncrBy`.
Debit the player's Coins and increment the civic fund in one transaction. Read
the resulting total after commit; concurrent donations commute safely.

### Reset behavior

- Phoenix cycle: preserve Coins and personal inventory.
- Full moderator reset: clear player economy with `players` and clear civic
  project funding.
- Malformed economy data: `revivePlayer` falls back safely; `/api/init` must not
  throw.

## 4. Client and UX implementation

### Navigation

- Add `SHOP` as a fifth CITY drawer tab: `MAP | CITY | LIVE | TOP | SHOP`.
- Show the Coin balance in the SHOP header, not as another permanent top-bar
  pill; the mobile HUD is already dense.
- Use two shop segments: `HOUSE` and `CIVIC`.
- Keep the drawer closed at boot on phones, as it is today.

### Shop rows

Each row includes an icon/swatch, name, one-line description, and one clear
state:

- price button when available;
- `OWNED` plus an `EQUIP` command;
- `EQUIPPED` when active;
- prerequisite text when locked.

Purchase feedback:

- `Hearth Lantern purchased. 7 Coins remain.`
- Equip feedback: `Your house now carries the Hearth Lantern.`
- Earning feedback: `+1 Coin - contribution accepted.`

Disable controls while a mutation is in flight. On refresh failure, preserve the
accepted response state and show a retryable warning, following the existing
mutation-guard pattern.

### Three.js integration

Extend the scene API with a small cosmetic state for the current user's house.
Do not rebuild the town or replace the house registry.

- Lantern: one emissive mesh; avoid adding many dynamic lights.
- Banner: a small plane/cloth mesh attached to the house.
- Garden: a few low-poly primitives next to the house footprint.
- Roof variants: swap only the current house roof material/trim.
- Civic projects attach to existing Watchtower, Wall, and Council Hall groups.
- Hide civic decorations when their prerequisite building is not unlocked.
- Reapply equipped cosmetics whenever `setHouses` remaps the current user's
  house after a refresh.

All assets remain local and CSP-safe. Keep draw calls and mobile memory bounded.

## 5. Codex and Claude ownership

Split work by stable file boundaries so both agents can work independently and
review each other without repeatedly resolving the same files.

### Codex track: economy, security, and release integration

Estimated effort: 3-4 engineering days for the launch slice.

- Land the existing audio-volume and advisor-layout fixes as the prerequisite
  PR, because those changes are already in the Codex worktree.
- Own `src/shared/shop.ts` and the economy additions to shared response types.
- Own all changes under `src/server/**` for coin awards, persistence, profile
  revival, reset behavior, purchase/equip routes, locking, and validation.
- Own server unit and API integration tests, especially retry, concurrency,
  malformed-state, forged-price, duplicate-purchase, and negative-balance cases.
- Run the final production gate suite after the Codex and Claude branches merge.
- Perform the final security and Devvit configuration review before the private
  subreddit test.

Codex must not redesign the SHOP interface or create new Three.js models.

### Claude track: product UX, Three.js, and launch presentation

Estimated effort: 3-4 engineering days for the launch slice.

- Own the SHOP tab, HOUSE segment, responsive states, purchase/equip feedback,
  loading/error states, and accessibility under `src/client/**`.
- Own the current-user house cosmetic rendering and mobile performance checks in
  the existing Three.js scene.
- Own local mock purchase/equip behavior in `vite.dev3d.config.mjs` once the
  shared contract is frozen.
- Own client smoke additions for earning, purchasing, equipping, persistence,
  narrow phone-landscape layout, and visible house cosmetics.
- Own `claude/demo-launch-showcase`, deterministic recording fixtures, visual
  rehearsal, and the final shot list. This branch remains local-only even though
  Claude owns its implementation.
- Perform the final design review after integration and report visual defects;
  production logic fixes return to the owning track.

Claude must not introduce client-authoritative balances, prices, inventory, or
server writes outside the agreed API.

### Shared handoff contract

Before parallel feature work begins, Codex lands the shared catalog and API
types. Both agents then branch from that commit. The contract is:

- `/api/init` returns the complete `economy` state;
- `/api/shop/purchase` accepts only `{ itemId }` and returns authoritative
  economy state plus feedback metadata;
- `/api/shop/equip` accepts only `{ itemId }` and returns authoritative economy
  state plus feedback metadata;
- the client never sends a price, balance, ownership list, or contribution
  reward;
- server route names and response shapes do not change during the Claude track
  without a coordinated contract update.

Avoid concurrent edits to `src/shared/types.ts`, `src/client/App.tsx`,
`src/client/styles.css`, `vite.dev3d.config.mjs`, and
`tools/client-smoke.mjs`. Their owner finishes and commits before another track
touches them.

### Fairness check

| Work | Codex | Claude |
| --- | ---: | ---: |
| Prerequisite and contract | 0.5 day | Contract review |
| Core implementation | 2-2.5 days | 2-2.5 days |
| Tests and QA | 0.5 day | 0.5 day |
| Release integration or showcase | 0.5 day | 0.5 day |
| Launch-slice total | 3-4 days | 3-4 days |

For the optional civic milestone, Codex owns civic Redis/API/reset logic and
Claude owns civic UI/Three.js decorations. Budget 1-1.5 additional days per
agent. This keeps the optional work equally split as well.

## 6. Delivery branches and PRs

### Prerequisite: land the current launch fixes

The current `main` worktree contains uncommitted volume/advisor changes. First:

1. Create `codex/audio-volume-coach-layout` from the current worktree.
2. Commit only the audio setting, responsive advisor, tests, and smoke changes.
3. Open and merge that PR after CI.
4. Return to a clean, updated `main`.

Do not mix those files into the economy history.

### PR 1 - Codex: `codex/coins-backend`

- Shared economy types and catalog.
- Player backfill/defaults.
- Coin awarding in all accepted contribution routes.
- `/api/init` economy shape.
- Storage, route, corruption, retry, cap, and reset tests.

### PR 2 - Codex: `codex/shop-purchase-api`

- Purchase and equip routes.
- Atomic debit and ownership validation.
- Duplicate, insufficient-funds, unknown-item, and concurrent-purchase tests.
- Server API integration tests and finalized response contract.

### PR 3 - Claude: `claude/shop-ui-three`

- SHOP dashboard tab and responsive states.
- Coin and purchase feedback.
- Current-house cosmetics in Three.js.
- Local mock API support.
- Client smoke for earn, buy, equip, refresh, and mobile layout.

### PR 4A - Codex, optional: `codex/civic-projects-server`

- Shared civic funding, atomic donations, prerequisites, and reset behavior.
- Server and two-user API coverage.

### PR 4B - Claude, optional: `claude/civic-projects-client`

- Gate, Wall, and Council Hall decorations.
- Civic contribution UI, local mocks, and client smoke coverage.

Both PR 4 branches can move post-launch without weakening the personal shop.

### Merge order

1. Codex audio/advisor prerequisite PR.
2. Codex PR 1, which freezes the shared contract.
3. Codex PR 2 and Claude PR 3 may proceed in parallel; merge PR 2 first, then
   rebase and merge PR 3 after its client smoke passes against the real routes.
4. Codex runs the complete gate suite on merged `main`.
5. Claude creates the showcase branch from that verified `main`.
6. PR 4A then PR 4B only when the launch deadline allows the civic milestone.

## 7. Test matrix

Server tests:

- accepted contribution adds exactly 1 Coin;
- rejected or repeated contribution adds 0;
- daily cap cannot be exceeded;
- next city day resets only the daily earned counter;
- two simultaneous requests cannot double-charge or double-award;
- unknown item and client-forged price are rejected;
- purchase cannot make balance negative;
- owned item cannot be purchased twice;
- only owned items can be equipped;
- old and malformed player JSON safely defaults;
- Phoenix preserves economy; full reset clears it;
- civic project increments remain correct with two users.

Client smoke:

- Coin balance appears in SHOP;
- one accepted action visibly adds 1 Coin;
- purchase subtracts the exact server price once;
- item changes from available to owned to equipped;
- refresh preserves ownership/equipment;
- current house visibly receives the cosmetic;
- civic items stay locked before their building exists;
- SHOP fits desktop, phone landscape, and portrait advisory layouts;
- no production mode uses showcase fixtures.

Human Devvit smoke:

- two real Reddit accounts earn independently;
- balances persist through close/reopen and UTC dawn;
- duplicate taps do not mint or charge twice;
- another player can see the equipped house cosmetic;
- civic donations combine across accounts;
- moderator reset and Phoenix behavior match the contract;
- audio, shop, and CITY controls fit the Reddit mobile webview.

## 8. Showcase branch

Create `claude/demo-launch-showcase` only after PRs 1-3 are merged. Claude owns
this recording-only branch. Never merge or
deploy this branch.

It may change only local tooling and recording fixtures:

- add `MOCK_SHOWCASE=1` to `vite.dev3d.config.mjs`;
- start with 12 Coins, four owned cosmetics, one affordable unowned item, a
  visible personal house, and two world cities;
- keep purchase/equip endpoints stateful so recorded clicks are real;
- provide deterministic local states for city, shop, raid warning, dawn report,
  and world view;
- add `tools/showcase-smoke.mjs` that verifies each recording state boots;
- never expose showcase switches in the Devvit production bundle;
- never show a fake `LIVE` claim or imply mock users are real Reddit activity.

Use the showcase branch for rehearsal and clean B-roll. Capture the final proof
of Redis persistence and multiplayer behavior from the private Devvit playtest.

## 9. Recording storyboard (55-65 seconds)

| Time | Shot | Proof shown |
| --- | --- | --- |
| 0-5s | Feed splash into expanded city | Name, kingdom art, immediate hook |
| 5-12s | Pan across the Three.js city and current house | Shared city and personal identity |
| 12-19s | Submit one daily action | `+1 Coin`, contribution, city consequence |
| 19-30s | Open SHOP, buy and equip Hearth Lantern | Real balance debit and owned/equipped state |
| 30-36s | Fly camera to the house | Visible lantern on the player's actual house |
| 36-43s | Show Wall civic project | Community target; Wall remains a shared build |
| 43-51s | Crisis vote, council choice, and The Marked | Reddit-scale collective decisions |
| 51-58s | Raid warning into Dawn Report | Return-at-dawn consequence loop |
| 58-65s | WORLD view with two cities | Multiple subreddits, one city each |

Record at 1920x1080 for the main video and one short phone-landscape clip. Keep
the cursor deliberate, music low, SFX audible, and advisor already completed.

## 10. Effort and launch decision

- Personal Coins and five-item house shop: 3-5 engineering days.
- Civic Wall/Watchtower/Council projects: 2-3 additional days.
- Deterministic showcase branch and recording rehearsal: 1 day.
- Real two-account Devvit regression and fixes: 1 day minimum.

Total for the full plan: approximately 6-9 engineering days plus the human
private-subreddit test. If the launch deadline is tighter, merge PRs 1-3,
record the personal house shop, and move PR 4 to the first post-launch update.

## 11. Definition of done

- Server is the only authority for earnings, prices, purchases, and equipment.
- No negative balance, duplicate charge, retry mint, or forged-price path.
- Coins and shop reinforce contributions without selling survival power.
- Equipped cosmetics appear on the correct Redditor's existing house.
- The existing Wall is still built by shared labor.
- Typecheck, lint, all tests, build, and client smoke pass.
- Private two-account Devvit smoke passes.
- Showcase branch remains local-only and is not merged or deployed.

## 11. Amendment (approved): PR 4 becomes Land Expansion

The decorative civic projects (braziers, standards, bell) are replaced by
COMMUNITY LAND PARCELS — the stronger version of the same mechanic. The city
must stop reading as a floating island: funded parcels attach CONNECTED
terrain to the city's edges.

Locked rules:

- Three parcels, funded with Coins via the civic-donate transaction pattern:
  | Parcel | Target | Prerequisite | Three.js result |
  | --- | ---: | --- | --- |
  | North Fields | 40 | Shelter built | Connected farmland terrace, crop rows |
  | East Terrace | 80 | Watchtower built | Connected plateau, footpath, huts |
  | South Quay | 120 | Wall built | Connected shoreline shelf, dock props |
- `POST /api/land/donate { parcelId, amount }`: debit the donor's Coins and
  increment the parcel fund in ONE transaction (per-user lock + hIncrBy);
  reject unknown parcels, amounts <= 0, amounts > balance, already-funded
  parcels, and missing prerequisites. Concurrent donations commute.
- Parcel funds live in an installation-scoped Redis hash. Funded = fund >=
  target (never resets below). Phoenix cycles PRESERVE funded land (the city
  remembers); full moderator reset clears funds.
- Scene: each parcel is a pre-built hidden group geometrically CONNECTED to
  the island edge (shared skirt/cliff geometry, no gaps). Show on funded.
  Keep draw calls phone-safe; no new dynamic lights beyond the existing
  budget.
- UI: CITY tab gains a CITY LANDS section under the build panel — per-parcel
  fund bar, target, prerequisite text, and a DONATE control with amount
  choices (1 / 5 / all-but-keep-2). One temporary message rule still holds.
- Tests: donate happy path, insufficient balance, prerequisite gate, funded
  parcel rejection, two-donor commutativity, Phoenix preservation, mod reset
  clearing, and a smoke walk (fund bar advances, terrain group appears).
