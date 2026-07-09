# One Redditor, One House — Implementation Plan (Codex + Claude split)

Spec: [`docs/superpowers/specs/2026-07-09-one-redditor-one-house-design.md`](../specs/2026-07-09-one-redditor-one-house-design.md)

Two lanes with **exclusive file ownership** (no merge conflicts) built against a
**locked contract**. Lands on top of PR #30 (fab fix) + PR #31 (camp grow-in).

- **Codex → backend** — shared contract types, storage registry, contribution
  hook, `/api/init` house summary, server tests.
- **Claude → frontend** — client state, `scene.ts` house rendering, demo
  synthesis, mock fixture, client smoke, visual QA + integration.

---

## 0. LOCKED CONTRACT (both lanes build to this — do not change without agreeing)

### `src/shared/houses.ts` (new — Codex creates)
```ts
export type HouseTier = 0 | 1 | 2 | 3 | 4; // 0 = no house yet · 1 tent · 2 cottage · 3 house · 4 manor

export const HOUSE_CAP = 240;              // max personal houses rendered
export const NAMED_HOUSE_LIMIT = 8;        // how many top contributors get name labels

// min lifetime contribution for each tier (index 0 => tier 1, etc.)
export const HOUSE_TIER_MINS = [1, 6, 18, 40] as const;

export function tierForContribution(contribution: number): HouseTier {
  if (contribution >= 40) return 4;
  if (contribution >= 18) return 3;
  if (contribution >= 6) return 2;
  if (contribution >= 1) return 1;
  return 0;
}
```

### `src/shared/types.ts` (Codex adds)
```ts
export interface HouseSummary {
  total: number;                 // unique contributors this cycle (== houses raised)
  cap: number;                   // HOUSE_CAP
  founder: { username: string } | null;                 // index-0 contributor
  yours: { index: number; tier: HouseTier; isFounder: boolean } | null; // null until you contribute
  named: { username: string; index: number; tier: HouseTier }[];        // top contributors, for labels
}
// InitResponse gains:  houses: HouseSummary
```

`index` is the **first-contribution join order** (0 = founder). Tier is derived
from the contribution-leaderboard score via `tierForContribution`.

---

## 1. BACKEND PACKAGE — for Codex

> Self-contained brief. Follow existing patterns in `src/server/storage/store.ts`
> (the `RedisLike` interface, `safeParse`, installation-scoped keys, and how
> `addContribution` uses `zIncrBy`). Keep every existing test green.

**Owned files:** `src/shared/houses.ts` (new), `src/shared/types.ts`,
`src/server/storage/redisKeys.ts`, `src/server/storage/store.ts`,
`src/server/routes/api.ts`, plus tests. **Do NOT touch `src/client/**`.**

### 1a. Contract — create `src/shared/houses.ts` and extend `src/shared/types.ts`
Exactly as in §0.

### 1b. Redis keys — `src/server/storage/redisKeys.ts`
Add two keys, scoped/reset the **same way `lbContribution` is** (cleared on mod
reset / new cycle):
- `housesIndex` → hash `userId → joinIndex`
- `housesMeta`  → hash holding `seq` (a monotonic counter) and `founder` (userId)

### 1c. Storage — `src/server/storage/store.ts`
`RedisLike` has **no list/INCR ops** — use a hash + `hIncrBy` for the sequence.

```ts
/** Register the caller's house on their FIRST contribution. Idempotent: a user
 *  who already has a house keeps their original index. Returns their join index. */
async registerHouse(userId: string): Promise<{ index: number; isNew: boolean }> {
  const existing = await this.redis.hGet(KEYS.housesIndex, userId);
  if (existing !== undefined) return { index: Number(existing), isNew: false };
  // hIncrBy is atomic → distinct index per new user. Per-user action locks
  // prevent the same user racing itself, so no double-register.
  const seq = await this.redis.hIncrBy(KEYS.housesMeta, 'seq', 1); // 1-based
  const index = seq - 1;
  await this.redis.hSet(KEYS.housesIndex, { [userId]: String(index) });
  if (index === 0) await this.redis.hSet(KEYS.housesMeta, { founder: userId });
  return { index, isNew: true };
}

async getHouseCount(): Promise<number> {
  return Number((await this.redis.hGet(KEYS.housesMeta, 'seq')) ?? 0);
}
async getHouseIndex(userId: string): Promise<number | null> {
  const v = await this.redis.hGet(KEYS.housesIndex, userId);
  return v === undefined ? null : Number(v);
}
async getFounderId(): Promise<string | null> {
  return (await this.redis.hGet(KEYS.housesMeta, 'founder')) ?? null;
}
```
Add `KEYS.housesIndex`, `KEYS.housesMeta` to the **reset/new-cycle cleanup**
(wherever `lbContribution` is deleted).

### 1d. Contribution hook
A house is raised on the user's **first helpful act**. At the top of **each**
contribution handler — daily action, crisis vote, strategy vote, Marked pledge,
and `build_city` labor — call `await store.registerHouse(userId)` (idempotent, so
calling it every time is safe). Do this wherever the request is already
authenticated with the user id.

### 1e. `/api/init` — assemble `houses`
Build the summary from the registry + the existing contribution leaderboard.
Use the contribution-leaderboard score (`zScore` / `topContributors`) as the
"lifetime contribution" for tiers, so `yours` and `named` are consistent.

```ts
const total = await store.getHouseCount();
const founderId = await store.getFounderId();
const founder = founderId
  ? { username: (await store.getPlayer(founderId))?.username ?? 'a survivor' }
  : null;

const myIndex = await store.getHouseIndex(userId);
const myScore = (await store.redisZScoreContribution(userId)) ?? 0; // add a small helper or reuse zScore
const yours = myIndex === null
  ? null
  : { index: myIndex, tier: tierForContribution(myScore), isFounder: myIndex === 0 };

const top = await store.topContributors(NAMED_HOUSE_LIMIT);
const named = (await Promise.all(top.map(async (t) => {
  const idx = await store.getHouseIndex(t.userId);
  const p = await store.getPlayer(t.userId);
  return idx === null || !p ? null : { username: p.username, index: idx, tier: tierForContribution(t.score) };
}))).filter(Boolean);

// return in InitResponse:
houses: { total, cap: HOUSE_CAP, founder, yours, named };
```
All reads tolerate missing/corrupt data (fall back to `total: 0`, `founder: null`,
`yours: null`, `named: []`) — never throw into `/init`.

### 1f. Tests (Codex owns)
New `src/server/storage/houses.test.ts` (or extend `store.test.ts`):
- first `registerHouse` → `{index:0, isNew:true}`; same user again → `{index:0, isNew:false}`; second user → `{index:1, isNew:true}`.
- `getFounderId` = first user; `getHouseCount` counts unique users; `getHouseIndex` correct + `null` for a stranger.
- `tierForContribution`: 0→0, 1→1, 5→1, 6→2, 17→2, 18→3, 39→3, 40→4, 999→4.
- reset clears houses → `getHouseCount() === 0`, `getFounderId() === null`.
- Extend `api.integration.test.ts`: after two different users each take an action, `/init` returns `total:2`, correct `founder`, correct `yours` for each caller, and `named` includes them.
- Malformed/empty registry → `total:0, founder:null, yours:null, named:[]`.

### Backend acceptance
`npm run type-check`, `npm run lint`, `npm test` all green; `/api/init` returns a
valid `houses` summary; no `src/client/**` changes.

---

## 2. FRONTEND PACKAGE — for Claude

**Owned files:** `src/client/App.tsx`, `src/client/scene.ts`,
`src/client/api.ts` (type only), `tools/client-smoke.mjs`,
`vite.dev3d.config.mjs` (mock). Imports the §0 contract from shared.

1. **State** — `App.tsx` reads `init.houses` into a `HouseSummary` state (live).
   In **demo** mode, synthesise it: start `total:1` (founding house = "you"),
   grow `total` over time via the existing sim (repurpose `simBuyHouse`), tier
   from a local counter.
2. **Scene** — add `setHouses(summary)` to `VillageHandle`; replace PR #31's
   *build-fraction* house reveal with **contributor-count** reveal
   (`min(total, cap)` nearest-centre houses). Index 0 → founding-house model +
   "Founded by u/____" label; `yours.index` → highlight + tier model + "u/you";
   each `named[i]` → tier model + username label; the rest → tent/cottage crowd.
   Amenity gating (districts/farm/wall) stays on `setBuildStage`.
3. **Tier → model** — swap/scale the notable house's mesh by tier
   (tent → cottage → house → manor; manor gets the gold-trim roof).
4. **Counter** — surface "N souls have built here" (`total`) in the HUD
   (CITY tab / DASH), and reframe the TOP/leaderboard view as "the neighborhood."
5. **Mock** — add a `houses` object to the INIT fixture in `vite.dev3d.config.mjs`
   (and a `MOCK_CAMP` variant with `total:0`), matching the §0 shape.
6. **Smoke** — brand-new camp lists **no** houses + `total:0`; after a mocked
   contribution, your house + founding house appear and the counter increments.
7. **Verify** — via the `/shot` frame capture + live `window.__village.scene`
   inspection at `total` = 0 / 1 / mid / cap.

---

## 3. Integration & gates (Claude)

Land the backend, then wire the client to the real `init.houses`, run the full
five gates (type-check · lint · test · build · test:client), and QA the loop in
the mock harness (camp → contribute → your house rises → keep going → it grows).

## 4. Sequencing

1. Merge PR #30 (buttons) and PR #31 (camp grow-in) to `main`.
2. Land the **contract** (§0) — Codex, first commit of the backend lane.
3. **Parallel:** Codex backend (§1) · Claude frontend (§2), against the contract.
4. Claude integrates + runs all gates + visual QA (§3).
5. One PR per lane (backend, frontend), or a combined feature PR — reviewer's call.
