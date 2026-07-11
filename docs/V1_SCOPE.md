# One More Dawn — V1 Scope Lock

> Purpose: freeze a small, honest, publishable V1. Anything not in **Included**
> is either cut or hidden so the shipped app never promises what it can't do.
> Verified against the V1 release branch after the final cleanup — see
> `docs/audit/private-subreddit-v1-smoke.md` for the human runtime gate.

## The core V1 promise (one sentence)

**Each subreddit builds one shared city: it starts as an empty camp, everyone gets one meaningful action a day, and the community builds it — dawn by dawn — from campfire to surviving city, or watches it fall.**

## The 60-second first-user experience

1. Open the game post → the 3D town loads; this subreddit **is** the city. A brand-new city is only a **camp** — no wall, no farm, everything still to build.
2. A first-run panel: **pick your role** (and optionally name your survivor) → **Enter the City**.
3. See the city's live vitals (food, power, medicine, morale, threat, defense), the day, and the **build stage** (Camp → Settlement → … → Surviving City).
4. Take **one daily action** — Grow Food / Repair / Treat / Guard, or **add labor to the next building**. It counts toward tomorrow's dawn.
5. **Vote** on today's crisis, **pledge** to save The Marked, and see the **raid countdown**.
6. Understand the hook: *come back at dawn to see what the community built and what the choices did.*

---

## ✅ Included in V1 (verified working)

| Feature | Notes |
|---|---|
| Three.js city/town view | The living 3D town + React HUD |
| Onboarding — role + name | 6 roles; optional survivor name (see exclusions for "look") |
| City vitals | FOOD, POWER, MEDICINE, MORALE, THREAT, DEFENSE (+ souls) |
| Daily actions | Grow Food, Repair Power, Treat the Sick, Guard the Wall (energy-gated, once-each/day) |
| Build from zero (shared unlocks) | Every city starts as a **Camp** and grows through community labor: a daily **Add Labor** action fills a shared progress bar; at dawn, buildings unlock in order (Shelter → Farm → Clinic → Watchtower → Storehouse → Wall → Council Hall), each applying a modest effect and appearing in the 3D town. **Community-built, not individually owned** — no free placement. |
| Crisis voting | One vote per day, visible tradeoffs |
| Council strategy voting | Back a plan |
| The Marked pledge | One-tap, one-per-day, low/no energy |
| Raid countdown / status | Server threat + `raidInDays` forecast; RAID WATCH |
| Fallen city state | Terminal memorial screen; actions disabled |
| World view | World-of-Cities map with 5 statuses (thriving/holding/strained/under_raid/fallen) |
| Leaderboard / TOP view | Contribution leaderboard (username + score) |
| Chronicle / live feed | The events/drama feed (visible, seeded from the server) |
| Dawn Report | Yesterday's summary + your personal impact |
| Demo/judge seed | Mod menu action "seed demo state" |
| Live / demo / offline modes | Honest state: demo only on localhost; production API failure → explicit offline + retry |
| Sound + music, each muteable | Kenney CC0 SFX cues on key events + three CC0 ambient tracks that follow the game state (music defaults off); separate persisted toggles, fail-silent (see `docs/ATTRIBUTION.md`). |
| One redditor, one house | Each unique contributor raises one automatic personal house in first-contribution order; the first contributor is the founder. |

## ❌ Not in V1 (cut or hidden — do not advertise)

These were reviewed and are **not fully wired into the live 3D client**, so they are excluded:

| Feature | Status | V1 handling |
|---|---|---|
| Phaser expedition / minigame | Removed from the client (Phaser dependency deleted) | Cut; remove from all docs/copy |
| Full scavenge gameplay | Unfinished backend module retained, but its route is **disabled for V1** | Absent in live; direct calls return 404 |
| Complex avatar creator (pronouns + pixel look) | Client captures **name only**; avatar not rendered in-world | Ship as "name your survivor" |
| Rich law / trait management UI | `activeLaw` / `trait` are received from the server but **not rendered** | Hidden in V1 |
| Advanced raid-aftermath cinematic (live) | Cinematic raiders exist in demo only; live is forecast/report-driven | Post-V1 |

## 🔭 Post-V1 (revisit after launch)

- **Free-placement city building** (drag/drop/custom layouts) — V1 uses **shared ordered unlocks** plus one automatic house per contributor; freeform placement is post-V1.
- Deeper building trees, per-building upgrade levels, and richer construction visuals.
- Live scavenge/mission flow wired into the 3D town.
- A richer, custom-composed soundtrack and per-event sound design pass.
- Avatar look editor (skin/hair/outfit) and rendering the player's avatar in-world.
- City **trait** + **active law** surfaced in the CITY tab.
- Live raid-aftermath visualization (wall damage, sky tint from the timeline).
- `App.tsx` split into hooks + panels.
- Deliberate Devvit dependency upgrade (see `docs/audit/dependency-risk-note.md`).

---

## Decision rule for V1

> If a button or claim can't be backed by real server state, it is **hidden** or
> **relabeled** — never shown as playable. The shipped live surface has no dead
> buttons. A smaller, honest V1 beats a wider, half-wired one.
