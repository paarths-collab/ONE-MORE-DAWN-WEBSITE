# Raid Cinematic + Community Reconstruction — Implementation Contract

The raid becomes a short stylized siege-at-dawn (warning → fireballs → impact →
damage state → aftermath), and destroyed houses enter a SHARED reconstruction
queue the whole city rebuilds. A house belongs to one Redditor; when it falls,
the community rebuilds it — ownership is never lost. Deadline-safe: everything
ships on `feat/raid-cinematic-reconstruction`, isolated from launchable `main`.

## Lanes (parallel, disjoint files)
- **Backend** (owner: orchestrator): `shared/types.ts`, `shared/balance.ts`,
  `server/game/reconstruction.ts` (new), `server/game/resolver.ts`,
  `server/storage/redisKeys.ts`, `server/storage/store.ts`,
  `server/routes/api.ts`, + tests.
- **Scene** (agent): `src/client/scene.ts` ONLY.
- **SFX** (agent): `public/assets/sfx/*`, `src/client/sound.ts`, `docs/ATTRIBUTION.md`.
- **Client integration** (orchestrator, after the above): `src/client/App.tsx`,
  `src/client/styles.css`, `vite.dev3d.config.mjs`, `tools/client-smoke.mjs`.

---

## 1. House state model (shared, backend-owned)
A registered house's `userId→index` registry is IMMUTABLE. Damage is a transient
overlay cleared on reconstruction (and on Phoenix rebirth / mod reset).

- Redis hash `houses:damage` = `{ [userId]: 'destroyed' | 'damaged' }` (absent = standing).
- Redis hash `houses:rebuild` = `{ [userId]: '<laborDone>' }` (reconstruction progress).
- Rebuild order = ascending house index (deterministic, fair).
- Labor needed: destroyed = 12, damaged = 5 (BALANCE.reconstruction).

`shared/types.ts` additions:
```ts
export type HouseStatus = 'standing' | 'damaged' | 'destroyed' | 'rebuilding';
export type DamagedHouse = { index: number; username: string; status: 'destroyed' | 'damaged' };
export type ReconstructionState = {
  active: boolean;               // any incomplete damaged/destroyed house
  required: number;              // total labor to clear the whole queue
  contributed: number;          // labor applied so far toward the queue
  destroyed: number; damaged: number; // counts still outstanding
  next: { username: string; index: number; status: 'destroyed' | 'damaged'; done: number; needed: number } | null;
};
```
`HouseSummary` gains: `damaged: DamagedHouse[]` (for the scene to render ruins).
`InitResponse` gains: `reconstruction: ReconstructionState`.
`DawnReport` gains: `raidAftermath: { held: boolean; wallBreached: boolean; housesDestroyed: string[]; housesDamaged: number; reconstructionRequired: number } | null`.
`ActionResponse` (build_city) gains: `rebuilt?: { username: string } | null` (a house the community just restored) and `reconstruction: ReconstructionState`.

## 2. Balance (`shared/balance.ts`)
```ts
reconstruction: {
  laborPerDestroyed: 12,
  laborPerDamaged: 5,
  // per raid outcome: [minDestroyed, maxDestroyed], [minDamaged, maxDamaged]
  select: {
    held:   { destroy: [0, 0], damage: [0, 1] },
    breach: { destroy: [1, 3], damage: [1, 2] },
    fallen: { destroy: [3, 5], damage: [0, 2] },
  },
},
```

## 3. Raid house selection (`server/game/reconstruction.ts` + resolver hook)
Pure module `selectRaidDamage(houseIndices: number[], outcome: 'held'|'breach'|'fallen', seed: number)`:
- Deterministic seeded pick (hashString) of counts within the balance ranges, then
  picks that many distinct house indices from `houseIndices` EXCLUDING index 0 (founder
  landmark is spared destruction; may be damaged only if no other target). Never
  personally targeted — pure seeded random.
- Returns `{ destroy: number[], damage: number[] }` (house indices).

`resolver.ts` Red-Signal block: after computing held/breach/fallen, the resolver
returns the chosen outcome tag + selected indices in `ResolveResult` (new field
`raid?: { outcome, destroyIdx, damageIdx }`). `lazyResolve` (which has store access)
writes `houses:damage` for the picked indices and appends the aftermath to the
Dawn Report. Keep resolver PURE (no store writes) — it just decides; lazyResolve applies.

## 4. Reconstruction labor routing (`api.ts` build_city path)
When a player's `build_city` action commits, BEFORE adding to normal building progress:
- If `houses:rebuild` has an incomplete lowest-index damaged/destroyed house, add 1
  labor to it (`store.contributeRebuild`). If it reaches its need, clear its
  `houses:damage` + `houses:rebuild` entries → RESTORED; response `rebuilt = { username }`.
- Only when the reconstruction queue is EMPTY does build_city labor add to
  `city.buildProgress` (existing path). So the community rebuilds homes first.
- All under the existing per-user lock; the rebuild counter uses atomic `hIncrBy`
  under the lock so two contributors can't double-apply.

Owner experience: `/init` yourImpact / a notif — if the caller's own house is
`destroyed`/`damaged`, surface "Your house was destroyed in the raid. The city is
rebuilding it." When restored, the owner sees "Your house stands again — N citizens rebuilt it."

## 5. Reset semantics
- Phoenix rebirth: CLEAR `houses:damage` + `houses:rebuild` (new city, fresh start) — same batch as the existing house/day-key clears in lazyResolve.
- Mod reset: same keys cleared with the rest.

## 6. Scene handle API (`scene.ts`, agent) — additive, never break existing calls
```ts
playRaidCinematic(opts: {
  outcome: 'held' | 'breach' | 'fallen';
  fireballs: number;                 // 2-3 held, 5-6 breach/fallen
  hitHouseIndices: number[];         // houses struck (destroyed+damaged)
}): void;
setHouseDamage(states: { index: number; status: 'destroyed' | 'damaged' }[]): void; // ruined/burnt meshes + lingering smoke + keep owner label; idempotent, re-applied after setHouses
rebuildHouse(index: number): void;   // ruins -> frame -> roof -> house grow-back (reuse the build grow-in)
```
Cinematic (6-12s, 15 max): red-orange dawn sky shift + ambient darken; watchtower
beacon pulse; `fireballs` arcs from beyond the wall, each arc = orange/red trail +
smoke, landing on wall/gate/watchtower/struck-house with a flash + ember burst +
dust ring + camera/scene shake; on breach swap a wall segment to a cracked/broken
mesh; smoke plumes linger a few seconds; scorch decals remain. Outcome-scaled
intensity per the design (held = light, breach = wall breaks + house fires, fallen
= multiple fires + broken skyline haze). Phone budget: reuse materials, pool the
fireball/particle objects, no per-frame allocations, ≤2 transient extra lights.

## 7. SFX cues (`sound.ts` + assets, agent) — CC0 from Kenney, ffmpeg-composed
New cues (fail-silent, same pattern as existing): `siege_bell` (warning toll),
`fireball` (incoming whistle/arc), `impact_hit` (heavy strike), `wall_crack`
(breach), `house_collapse` (destroyed), `rebuild_done` (hopeful restore chime).
Register each in `sound.ts` and document in `docs/ATTRIBUTION.md`. Reuse existing
`raid_warning`/`city_fallen` where they already fit.

## 8. Client integration (`App.tsx`, orchestrator)
- Raid orchestration: when the dawn resolves a raid (init.dawnReport.raidAftermath),
  drive `playRaidCinematic` with outcome + fireball count + hit indices, sequence the
  SFX (siege_bell → fireball×N → impact → wall_crack/house_collapse → outcome banner),
  then `setHouseDamage` for the aftermath and open the Dawn Report.
- CITY panel "REBUILD THE NEIGHBORHOOD": a shared progress bar (contributed/required),
  counts (N homes lost), the next house being rebuilt with its owner, and the existing
  ADD LABOR CTA now routes to reconstruction first (server-driven). On a `rebuilt`
  response, cheer + `rebuildHouse(index)` + "THE CITY REBUILT A HOME — u/x's house
  stands again."
- Keep the existing demo-mode `startRaid` but upgrade it to call the cinematic too.

## 9. Tests
- `reconstruction.test.ts`: seeded selection counts within ranges, founder spared,
  determinism, labor routing (rebuild before build, restore clears state), reset clears.
- `api.routes.test.ts`: build_city routes to reconstruction first; restore fires
  `rebuilt`; two contributors don't double-apply (lock); Phoenix/mod-reset clears damage.
- client smoke: a raid-aftermath fixture shows REBUILD THE NEIGHBORHOOD + contributing
  advances it; the cinematic hook is invoked (DOM/console assertion).

## Definition of done
Type-check, lint, all tests, build, client smoke green. The raid reads as a
consequence of community readiness; destroyed houses are rebuilt by the whole
city with ownership preserved; on its own PR, `main` untouched until merged.
