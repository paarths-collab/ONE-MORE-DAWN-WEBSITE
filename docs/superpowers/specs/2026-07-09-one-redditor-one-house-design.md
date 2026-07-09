# One Redditor, One House — V1 Design

> Status: **approved for V1** (2026-07-09). Post-launch we iterate per real users.
> The city literally *is* the subreddit made visible: every contributor is a house.

## 1. Vision

A new subreddit city starts as a bare **Camp**. It grows along **two independent
layers**:

- **People layer (this spec):** every redditor who contributes gets their **own
  house**. The neighborhood = who actually showed up. The first contributor
  raises the **founding house**. Your house **evolves** the more you contribute.
- **Amenity layer (already built):** the shared **build bar** still unlocks
  community buildings in order (shelter → farm → clinic → watchtower → storehouse
  → wall → council hall). Unchanged by this spec.

The two layers are orthogonal: people arrive **and** the community builds
amenities. Together they turn the Camp into a surviving city.

## 2. Player-facing behaviour

| Moment | What happens |
|---|---|
| First-ever contributor in the sub does anything that helps (a daily action, crisis vote, council vote, Marked pledge, or build labor) | The **founding house** rises at the town centre, tagged *"Founded by u/____"* |
| Any later redditor's **first contribution** | Their **own house** auto-places, spiralling outward from the founding house |
| A redditor keeps contributing | **Their house upgrades** through tiers: ⛺ Tent → 🏚 Cottage → 🏠 House → 🏰 Manor |
| You open the city | **Your** house is highlighted; tapping it focuses the camera on it |
| The sub keeps growing past the render cap | New contributors still count toward the **"N souls have built here"** counter; the skyline stays full without over-rendering |

**No free placement.** Houses auto-place deterministically in join order. There is
no drag/drop, no plot editor. (Free placement / personal plots are explicitly
**post-V1** — see §8.)

## 3. House tiers (evolution)

A house's tier is derived from that player's **`totalContribution`** (already
tracked on the player profile). Thresholds live in `balance.ts` so they're tunable:

| Tier | Name | Contribution ≥ | Visual |
|---|---|---|---|
| 1 | Tent | 1 (first contribution) | small canvas tent |
| 2 | Cottage | 6 | plaster hut, slate roof |
| 3 | House | 18 | timber house, taller |
| 4 | Manor | 40 | larger footprint, gold-trim roof |

Tiers are applied to **notable** houses (yours, the founder, and the labelled top
contributors). The anonymous majority render at Tent/Cottage as the crowd — this
keeps the data light and the notable houses legible. (Sending every user's exact
tier is post-V1.)

## 4. Placement & scale

- The scene already computes ~240 candidate house positions along the roads.
  Sort them by distance from the town centre. **House index `i` → candidate[i]**,
  so the town fills **outward from the founding house** (index 0 = centre).
- **Render cap: `HOUSE_CAP = 240`** (the scene's existing house budget). The scene
  renders `min(total, HOUSE_CAP)` houses.
- The true unique-contributor total is always shown as a **counter** ("312 souls
  have built here") so large subs read as bustling without rendering thousands of
  meshes.
- **Beyond the cap:** if a user's `index ≥ HOUSE_CAP`, they're counted in `total`
  but have no individually-rendered house in V1 (they're part of the crowd/counter).
  Guaranteeing every user their own visible house at any scale is post-V1 (§8).

## 5. Data model (server)

Installation-scoped Redis, per city:

- **`houses:order`** — a list of userIds in **first-contribution order**. Append a
  userId the first time they contribute. `index = position in this list`.
  `founder = houses:order[0]`.
- **`houses:members`** — a set of userIds for O(1) "have they contributed before?"
  checks (so we append to `houses:order` exactly once per user).
- **House tier** is derived on read from `player.totalContribution` (no new
  storage) using the §3 thresholds.

**Hook point:** the single place every contribution flows through on the server
(the action/vote/pledge/build handlers all bump `totalContribution`). On the first
contribution for a user, also register them in `houses:members` / `houses:order`.

### `/api/init` addition

```ts
houses: {
  total: number;                          // unique contributors (== houses:order length)
  cap: number;                            // HOUSE_CAP
  founder: { username: string } | null;   // houses:order[0]'s username
  yours: { index: number; tier: number; isFounder: boolean } | null; // null until you contribute
  named: { username: string; index: number; tier: number }[]; // top contributors (from the leaderboard) for labels
}
```

All reads go through the existing `safeParse` / storage layer; malformed data
falls back to `total: 0` (a bare Camp) — never a crash.

## 6. Client + scene

- `App.tsx` reads `init.houses` into state (live) or synthesises it in demo mode
  (the demo sim already fakes contributors joining — repurpose it to grow the
  house count over time, founding house first).
- `scene.ts`: replace the current **build-fraction** house reveal (PR #31) with a
  **contributor-count** reveal:
  - `setHouses({ total, yours, founder, named })` reveals `min(total, cap)` houses
    nearest the centre.
  - Index 0 → founding house model + "Founded by u/____" label.
  - `yours.index` → highlighted + tier model + "u/you" label.
  - each `named[i].index` → tier model + username label.
  - remaining revealed houses → default Tent/Cottage crowd.
- **Amenity gating stays on the build bar** (districts + farm/clinic/wall from the
  existing `setBuildStage`). Only the *house* reveal driver changes.
- The **leaderboard/TOP view** is reframed as **"the neighborhood"** — the same
  data, now tied to visible houses.

## 7. Testing

- **Server unit tests:** first contribution registers exactly one house; founder =
  first contributor; repeat contributions don't add a second house; tier
  thresholds; `total` counter; `/api/init` house summary shape; malformed-JSON
  fallback → `total: 0`.
- **Client smoke:** brand-new city (0 contributors) shows Camp with **no** houses;
  after a contribution, **your house + founding house** appear and the counter
  increments; tier label reflects contribution.
- Keep every existing gate green (type-check · lint · vitest · build · test:client).

## 8. Out of scope for V1 (revisit per users)

- Free placement, drag/drop, personal **plots/areas** you expand (the "areas"
  model we considered).
- Exact per-user tier for **every** house (V1 shows tiers for notable houses only).
- House customisation (colour/style), house interiors, neighbours/adjacency
  bonuses.
- Moving the render cap above 240 or LOD/instancing for very large subs.

## 9. Sequencing

This builds on two open PRs that should land first:
1. **#30** — fab click fix (buttons work).
2. **#31** — camp-start grow-in (establishes the bare-Camp start + house
   collection infrastructure this feature reuses).

Then this feature evolves the house-reveal driver from build-fraction to
contributor-count and adds the server house registry + `/api/init` summary.
