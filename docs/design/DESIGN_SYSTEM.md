# Pixel Village — Design System (extracted from Pixel Village.dc.html)

The game's front-end reskin. Two views toggled by a VILLAGE / DASHBOARD switch:
**Village** (pixel top-down town, villagers = real masked users, buildings =
zones with live counts) and **Dashboard** (dark data console). Warm-dark retro
terminal aesthetic. Reference screenshots in `docs/design/screenshots/`.

Implemented in **Phaser** (our engine), wired to the live backend. All values
below are the source of truth — no ad-hoc colors/sizes in scene code.

## Fonts
- **Silkscreen** (pixel display) — labels, headings, HUD chips. Weights 400/700.
- **JetBrains Mono** — numeric values, body, roles. Weights 400/500/700/800.
- Loaded via Google Fonts in `game.html` `<head>`; if the webview CSP blocks
  external fonts, fall back to a bundled/monospace stack and log it.
- Type scale: Silkscreen 6–19px; JetBrains 8–15px. Letter-spacing 0.5–1px on
  Silkscreen headings.

## Palette (CSS var → hex → Phaser 0x)
```
bg0    #0C0A0A  0x0c0a0a   page/base
bg1    #131010  0x131010   panel base
card   #1B1717  0x1b1717   card
card2  #231D1D  0x231d1d   raised card / avatar box
line   #2F2828  0x2f2828   hairline
line2  #403636  0x403636   stronger line
ink    #E8E2D6  '#e8e2d6'  primary text
mut    #8F8578  '#8f8578'  muted text
gold   #E8C34A  0xe8c34a   PRIMARY ACCENT (ribbons, values, active)
goldbg #2A2312  0x2a2312
goldline #6E5B1E 0x6e5b1e
green  #4CAF50  0x4caf50   ok / online / wave
greenbg #152914 / greenline #2E5B2C
blue   #6C8BE0  0x6c8be0   info
bluebg #161F33 / blueline #2C3E66
red    #A03030  0xa03030   danger / overseer / exit
redbg  #2A1212 / redline #5E2020
```
Village terrain (from screenshot): grass stripes ~`0x5b8c3a` / `0x548334`
(24px bands), cross-paths brown `0xc7a768` with `0x9c7d44` edge, shoreline sand
`0xd9c79b`/`0xb8a578`, water `0x3a78a0`/`0x346c90` (animated wave bands), dock
`0x8f6a42`.

## Components (Phaser factory functions live in `src/client/game/pixelUi.ts`)
- **cycleBadge** — 54px circle, card2 fill, 3px gold border; big Silkscreen
  number + "CYCLE" label. Top-left.
- **namePlate** — village name (Silkscreen 11px ink) + sub (JetBrains 9px mut)
  on a `rgba(20,14,8,.92)` gold-lined rounded chip.
- **prosperityBar** — 150×10 rounded, gold-line border, gradient gold fill; %
  driven; "PROSPERITY" label.
- **resourcePill** — rounded-99 chip, 2px goldline border, icon + big JetBrains
  value (gold) + small Silkscreen label (mut). Top-center row.
- **ribbon** — building label floating above a zone: gold-bordered dark pill,
  icon + Silkscreen name (gold) + JetBrains count (ink).
- **bottomButton** — 52px rounded-9 square, dark fill, colored 2px border,
  centered icon; Silkscreen 7px label beneath.
- **villager** — 26px pixel avatar (hair cap + face + body rect, 2px `#0E0C0C`
  outline), name tag (Silkscreen 8px on dark), optional status bubble, oval
  shadow. Bobs (translateY ±2px). Walks between points (slow tween).
- **statCard** (dashboard) — bordered card: icon+label (mut), big value, delta
  subtext. 4-up grid.
- **occupancyBar** (dashboard) — labeled zone row, `count/cap` right-aligned,
  colored fill bar.
- **navItem / sidebarVillage** (dashboard) — left-edge accent, icon + label.
- **inspector** — right-side floating panel (gold-lined): VILLAGER FILE,
  avatar, name + role·zone, status row, SINCE/CONTACT/ID rows, SEND WAVE button.
- **noticeBoard** — centered popup, bulleted notices.

Icons: the design uses inline pixel SVGs. In Phaser, reproduce as small
generated shapes or emoji-free 2–3 rect glyphs; keep them tiny and monochrome
(gold/ink). Don't block on pixel-perfect icons — silhouette + label is enough.

## Layout — Village view (design canvas 1300×800; our frame 720×1280 portrait)
The design is landscape; we adapt to portrait. HUD zones:
- Top-left: cycle badge + name plate + prosperity.
- Top-center: resource pills row (FOOD/POWER/MED/THREAT).
- Top-right: village chip + day/night toggle.
- Below top-center: VILLAGE / DASHBOARD segmented toggle.
- Center: the town — grass, cross-paths, buildings (zones), villagers, water at
  the bottom edge with dock.
- Bottom: action buttons row + "SANDBOXED · MASKED" privacy tag.
- Right (on select): inspector panel.

## Game mapping (design concept → One More Dawn live data)
| Design | Our data / action |
|---|---|
| Village name + `r/sub` | city + subreddit; "every villager is a real user" |
| CYCLE badge | `city.cycle` |
| PROSPERITY bar | `city.morale` (0–100) |
| Resource pills | FOOD / POWER / MEDICINE / THREAT |
| Day/Night toggle | night = raid inbound (`raidInDays===0`) + manual |
| Zone: FARM | action `grow_food`, count = today's grow_food tally |
| Zone: GENERATOR | `repair_power` (windows dark < 25% power) |
| Zone: CLINIC | `treat_sick` |
| Zone: WATCHTOWER | `guard_wall` (red pennant when threat ≥ 70) |
| Zone: COUNCIL HALL | opens Vote (crisis + council) |
| Zone: GATE / DOCK | opens expedition route picker |
| Zone: PLAZA | opens Leaderboard |
| Notice board / OBELISK | opens Timeline |
| Villagers walking | real players from `players` hash, privacy-masked |
| Villager inspector | masked name, role, faction ("zone"), streak/since |
| SEND WAVE | post-MVP: greet in comments; MVP = toast |
| Dashboard stat cards | villagers, online today, zones acted, waves(=actions) today |
| Zone occupancy bars | per-action counts today |
| Live activity feed | recent timeline events |

## New backend: `GET /api/village`
Returns everything the village HUD needs in one call (privacy-masked):
```
{ type:'village', villageName, subreddit, cycle, day, status,
  prosperity /*morale*/, pills:{food,power,medicine,threat},
  raidInDays, activeLaw|null,
  zones:[{ id:'grow_food'|'repair_power'|'treat_sick'|'guard_wall', name, count }],
  villagers:[{ maskedName, role|null, faction|null, color, online /*acted today*/, since /*"day N"*/ }],
  onlineCount, totalCount, notices:string[] /* recent timeline lines */ }
```
Masking: username → first 2 chars + "•••" (Reddit names are public, but the
design's privacy theme + safety → mask). Villager color derived from a stable
hash of userId. `online` = `lastActiveDay === city.day`. Bounded (top ~20
recent players) to keep the payload small.

## Scope & isolation
- New scenes are ADDITIVE. `Village` becomes the landing hub (Preloader →
  Village). Existing scenes (Actions, Vote, Mission, Leaderboard, Timeline,
  Dashboard) stay reachable and unchanged in logic — Village and the new
  console are new front-doors, not rewrites.
- A `PIXEL_HUB` flag (default on) lets us fall back to the old Dashboard hub if
  the pixel view misbehaves in playtest.
- The existing test suite stays green; new backend gets its own tests.
