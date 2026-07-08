# One More Dawn — 3D Village Prototype

A standalone Clash-of-Clans-style Three.js diorama of the game's village.
**UI only — nothing here talks to the game server.** Built as a look-and-feel
prototype for a possible 3D village view.

## Run

```bash
node village3d/serve.mjs   # → http://localhost:4620
```

Serves the repo root so the import map can load `three` from `node_modules`
(no CDN; works offline). The only network fetch is Google Fonts for the HUD.

## What's in it

- Procedural voxel village on a checkerboard grass island: town hall (flag),
  huts, farm, barracks (+ practice dummies), windmill generator, clinic,
  storehouse, market stall, well, perimeter walls with a south gate, corner
  watchtowers, torches, trees/rocks/flowers. Deterministic (seeded RNG).
- Animated characters from the official three.js example models
  (`village3d/assets/*.glb`, downloaded from threejs.org/examples):
  - `Soldier.glb` — villagers walking waypoint routes + an idle gate guard
  - `Horse.glb` — grazing loop in the pasture
  - `Flamingo.glb` / `Parrot.glb` / `Stork.glb` — circling overhead
- CoC-style controls: drag to pan (clamped to the island), scroll/pinch zoom,
  right-drag rotate (clamped). Tap a building → gold selection ring + info chip.
- Game-flavored HUD: title/resources, day pill, BUILD button (toast stub),
  building chip with an UPGRADE placeholder. Pure DOM overlay.

## Dev notes

- `window.__village` exposes `{ pause, resume, frame, camera, controls, scene,
  renderer }` for headless QA (screenshot tooling drives `frame()` manually —
  rAF never fires in a hidden tab).
- `POST /shot` on the dev server writes the page's canvas to `shot.png`
  (QA hook; `shot.png` / `qa-*.png` are gitignored).
- Hard-won model facts: `Box3` on the Soldier's *skinned* mesh reports
  bind-space cm units, so it's placed at a known-good fixed scale instead of
  measured normalization; flat flying birds must be normalized by their
  *largest* dimension (wingspan), never height.

## Credits

Character models are the sample assets from the
[three.js examples](https://threejs.org/examples/): Soldier (Mixamo),
Horse / Flamingo / Parrot / Stork (ro.me "3 Dreams of Black" project),
bundled here unmodified for prototyping.
