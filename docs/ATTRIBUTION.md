# Asset Attribution

## Sound effects (V1)

The V1 sound cues shipped in `public/assets/sfx/` are **procedurally-generated
placeholder tones**, synthesized locally by `tools/gen-sfx.mjs` (short sine/tri
envelopes). They contain **no third-party content** and are therefore
**public-domain / CC0-equivalent** — no attribution required, safe to ship.

| File | Event | Source | License |
|---|---|---|---|
| `button_click.wav` | UI / mute toggle | Generated (`tools/gen-sfx.mjs`) | CC0 / public domain |
| `action_confirm.wav` | daily action success | Generated | CC0 / public domain |
| `vote_cast.wav` | crisis / council vote | Generated | CC0 / public domain |
| `pledge.wav` | Marked pledge | Generated | CC0 / public domain |
| `raid_warning.wav` | raid forecast active | Generated | CC0 / public domain |
| `dawn_report.wav` | Dawn Report appears | Generated | CC0 / public domain |
| `city_fallen.wav` | fallen-city screen | Generated | CC0 / public domain |
| `error_soft.wav` | failed / blocked action | Generated | CC0 / public domain |

Regenerate with: `node tools/gen-sfx.mjs`.

### Swapping in real CC0 audio (recommended for polish)

To replace the placeholders with higher-quality free sounds, drop files with the
**same base names** into `public/assets/sfx/`. If you use a different extension
(e.g. `.ogg`), change the single `EXT` constant in `src/client/sound.ts`.

**Recommended source — Kenney (CC0, no attribution required):**

| Pack | Files | License | URL | Notes |
|---|---|---|---|---|
| Interface Sounds | 100 | CC0 | https://kenney.nl/assets/interface-sounds | best fit for button/vote/confirm |
| UI Audio | 50 | CC0 | https://kenney.nl/assets/ui-audio | UI clicks/confirms |
| RPG Audio | — | CC0 | https://kenney.nl/assets/rpg-audio | raid/dawn/fallen ambience cues |
| Impact Sounds | — | CC0 | https://kenney.nl/assets/impact-sounds | raid warning |

> When adding third-party audio, record the pack name, license (must be CC0 or a
> permissive license you've verified on the asset page), the download URL, and the
> date added **in this file** — even for CC0 — so provenance is auditable.

**Other safe sources:** [Freesound](https://freesound.org) — filter to **CC0
only** (avoid CC-BY-NC / Sampling+ / unclear); [OpenGameArt](https://opengameart.org)
— check every file's license individually.

_Last updated: 2026-07-09 · current sfx = generated placeholders (CC0-equivalent)._

## 3D models (villagers & wildlife)

three.js example models (Soldier, Horse, Flamingo, Parrot, Stork) from
[threejs.org/examples](https://threejs.org/examples) — see in-app credit line.
