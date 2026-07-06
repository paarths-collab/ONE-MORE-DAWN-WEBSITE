# One More Dawn — Asset & Audio Manifest

The complete list of art, backgrounds, sound effects, and music the game needs,
tied to the real screens and events, with delivery constraints and a prioritised
checklist. Use this to brief an illustrator / sound designer, or to sequence the
work yourself.

## 0. Baseline — what exists today

The game currently ships with **zero raster art and zero audio**. Everything is
procedural:

- **Backgrounds/UI** — CSS gradients + SVG (`src/client/react/omd.css`,
  `CitySky.tsx`, `WorldMap.tsx`).
- **Icons** — emoji (🌾 ⚡ 🩹 ☠️ 🕯️ 🗳️ 🏛️) throughout.
- **Mission mini-game** — colored rectangles in Phaser (`scenes/Mission.ts`).
- **Fonts** — Fraunces (display), Sora (UI), JetBrains Mono (numbers), Silkscreen
  (pixel) — already loaded, no change needed.
- **Sound** — none.

This is a genuine strength (tiny ~150 KB bundle, no CSP problems, consistent look).
Everything below is *additive polish*, not a rebuild. Prioritise ruthlessly (see §8).

## 1. Delivery constraints (these shape every asset decision)

This is a **Devvit webview**, so:

- [ ] **Same-origin only.** The webview CSP blocks external CDNs/hosts. Every asset
      ships **bundled** or as a **base64 data URI** — no streaming from elsewhere.
- [ ] **Bundle budget is real.** Client is ~150 KB today. Keep individual SFX
      < 30 KB, music loops < 200 KB, and prefer **SVG** for anything vector
      (icons, crests, badges) and **WebP / PNG atlases** for portraits & tiles.
- [ ] **Audio formats:** `.webm`/Opus (tiny) with `.mp3` fallback.
- [ ] **Two audio paths:** Phaser's sound manager for the **mission**; a small
      Web Audio helper for the **React app** SFX (proposed `src/client/game/sound.ts`).
- [ ] **Mobile autoplay:** audio must be unlocked by a user gesture — use the
      splash "Enter the City" tap as the unlock point.
- [ ] **Global mute toggle** + respect `prefers-reduced-motion` (already honored
      for animation; extend it to disable ambience).

## 2. Backgrounds (per screen)

State variants matter more than raw count — the Home sky alone needs ~5.

- [ ] **Home / city sky** (`CitySky.tsx`, `.omd-sky`) — illustrated post-collapse
      skyline. **States:** thriving · holding · strained · raid-tonight · fallen.
      Drifting ash, distant fires, watchtower beacon. *Highest visual-impact bg.*
- [ ] **Mission ruins** (`scenes/Mission.ts`) — floor tiles (cracked concrete),
      wall tiles (rubble), exit portal (glowing), darkness/fog beyond scout vision.
- [ ] **World map** (`WorldMap.tsx`) — painted "wasteland survey": terrain zones,
      coastline, roads, fog-of-war, your-city marker.
- [ ] **Crisis** — subtle themed vignette that shifts with the crisis (fire /
      blackout / sickness / convoy).
- [ ] **Feed / You** — light paper or brushed-metal texture so cards sit on a
      surface.
- [ ] **Boot / splash** — animated sunrise loop.
- [ ] **Fallen city** — candlelit memorial.
- [ ] **Dawn report** — dawn light-ray sweep overlay.

## 3. Sprites & illustrated components

- [ ] **The Marked portraits** — *highest emotional-impact art in the game.* The
      daily rally objective is currently text only. **12 in the pool**
      (`src/shared/names.ts`, person/place/symbol). Illustrated portrait cards.
- [ ] **Mission actors** — player character, loot crate (closed/opened), hazard
      (idle/arming/armed), exit portal, injured overlay.
- [ ] **Villager avatars** — small survivor avatars with role tint (replace the
      colored dots in the village view).
- [ ] **Faction crests** ×4 — Builders, Wardens, Seekers, Hearth.
- [ ] **Role emblems** ×6 — scout, engineer, medic, farmer, guard, speaker.
- [ ] **Pledge sigils** ×4 — Stand Vigil, Share Rations, Run Messages, Back Council.
- [ ] **Status badges & title medals** — the status spine (Runner → Ruin Walker,
      etc., see `BALANCE.titles`) and Hall of Heroes (Plan 3).
- [ ] **Particle/FX sheets** — falling ash, ember drift, smoke plumes, dawn light
      rays, raid alarm wash, loot sparkle, pledge candle-flame.

## 4. Icon system

- [ ] Replace **all emoji** with a **cohesive custom icon set** — ~30 glyphs:
      6 vitals (food/power/medicine/morale/threat/defense), 4 actions, 6 roles,
      4 factions, 4 pledges, 5 tabs, misc. Emoji render differently per device and
      read as "prototype"; one consistent SVG set is the fastest premium upgrade
      after the Marked portraits.

## 5. Sound effects

### UI / interaction
- [ ] Tab switch — soft tick
- [ ] Button / action tap — tactile click
- [ ] **Pledge tap** (core one-tap) — warm confirming thunk + candle whoosh
- [ ] Crisis vote cast — firm stamp
- [ ] Council plan backed — gavel / seal
- [ ] Role chosen — identity chime
- [ ] Rejection / error — dull buzz
- [ ] Bottom sheet open / close — paper slide

### City / daily events
- [ ] **Dawn arrives** (signature moment) — rising chime + hopeful swell
- [ ] Marked **saved** — triumphant bell
- [ ] Marked **lost** — somber single toll (memorial)
- [ ] **Raid / Red Signal** — low siren + alarm
- [ ] Low power — electrical hum / flicker
- [ ] **City falls** — heavy final boom, then silence

### Mission mini-game (Phaser — easiest to wire, biggest arcade payoff)
- [ ] Descend / start — door + footsteps into echo
- [ ] Move step — soft footstep tick
- [ ] Crate pickup — satisfying loot chime
- [ ] Hazard **arming** — escalating warning beep
- [ ] Hazard **triggers** — trap snap / gas hiss
- [ ] Low air — heartbeat (pairs with the existing visual heartbeat)
- [ ] **Escape** — success sting + surface ambience
- [ ] Timeout — air-out gasp

### World map
- [ ] Radar ping (sweep)
- [ ] Rank-up shimmer
- [ ] "A rival passed you" alert

## 6. Music & ambience (loops)

~5 short loops + 3 stingers cover the whole game.

- [ ] **Home ambient loop** — sparse, melancholy post-collapse dusk (idle bed)
- [ ] **Mission tension loop** — low underground drone that tightens as air drops
- [ ] **Dawn stinger** — 3–5s hopeful cue over the daily report
- [ ] **Fallen-city dirge** — one-shot on death
- [ ] **Legend / victory cue** — status milestones & Hall of Heroes

## 7. Sourcing

- **SFX:** Kenney.nl (CC0, game-ready), Freesound, or sfxr/jsfxr for retro mission
  blips.
- **Music:** commission a short loop set, or CC0 libraries (Kenney, Incompetech).
  Keep it original-adjacent for the Devpost submission.
- **Art:** the Marked portraits + icon set warrant a real illustrator (or
  AI-generated then hand-cleaned). Mission tiles/particles can stay procedural.
  A **pixel-art** direction fits the existing Silkscreen font and keeps files tiny.

## 8. Priority tiers (given the hackathon clock)

### P0 — most impact, least effort (pure audio, no art pipeline)
- [ ] Mission SFX pack (instant arcade feel)
- [ ] Signature sounds: dawn, pledge, raid, city-falls
- [ ] Global mute toggle
- [ ] `sound.ts` helper + Phaser sound hooks (wiring — can land before any files)

### P1 — the identity upgrade
- [ ] Custom icon set (kills the emoji look)
- [ ] Illustrated **Marked portraits** (the emotional hook)
- [ ] Home-sky state art (5 states)
- [ ] Home ambient loop

### P2 — polish
- [ ] World-map painting
- [ ] Faction crests + role emblems
- [ ] Title medals + status badges
- [ ] Particle FX sheets
- [ ] Hall-of-Heroes art (Plan 3)

## 9. Wiring map (where each asset plugs in)

| Asset group | Code touch-point |
|---|---|
| Home sky states | `src/client/react/CitySky.tsx`, `.omd-sky*` in `omd.css` |
| Marked portrait | `HomeScreen.tsx` marked card; keyed by `marked.id` (`src/shared/names.ts`) |
| Icons | `src/client/react/defs.ts` (icon strings), all screens |
| Mission art/SFX | `src/client/game/scenes/Mission.ts` (Phaser sound + sprites) |
| World map art | `src/client/react/WorldMap.tsx` |
| App SFX | proposed `src/client/game/sound.ts`, called from `App.tsx` handlers |
| Mute toggle | `App.tsx` + a settings control; persist in `localStorage` |

> **Note:** proposed audio plumbing (`sound.ts` + mute toggle + mission hooks) can
> be built *now*, before any asset files exist — dropping in files later then
> "just works." See P0.
