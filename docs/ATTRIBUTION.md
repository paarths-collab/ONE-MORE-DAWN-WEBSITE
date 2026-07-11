# Asset Attribution

## Sound effects (V1)

The V1 sound cues shipped in `public/assets/sfx/` are built from **Kenney's
CC0 audio packs** (downloaded 2026-07-11 from kenney.nl — CC0 / public domain,
no attribution required, credited as a courtesy). The three "big moment" cues
(raid, dawn, fallen) are ffmpeg-composed derivatives of the same CC0 material
(pitch shifts + echo), which remain CC0.

| File | Event | Built from | Pack | License |
|---|---|---|---|---|
| `button_click.wav` | UI / mute toggle | `click_002` | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `action_confirm.wav` | daily action success | `confirmation_002` | Interface Sounds | CC0 |
| `vote_cast.wav` | crisis / council vote | `select_003` | Interface Sounds | CC0 |
| `pledge.wav` | Marked pledge | `glass_001` + echo | Interface Sounds | CC0 |
| `raid_warning.wav` | raid forecast active | `bong_001` −1 octave, double toll | Interface Sounds | CC0 |
| `dawn_report.wav` | Dawn Report appears | `jingles_PIZZI07` + reverb | [Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |
| `city_fallen.wav` | fallen-city screen | `bong_001` −2 octaves, death-knell decay | Interface Sounds | CC0 |
| `error_soft.wav` | failed / blocked action | `error_006` | Interface Sounds | CC0 |

The earlier procedural placeholders can still be regenerated with
`node tools/gen-sfx.mjs` if these files are ever removed.

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

_Last updated: 2026-07-11 · current sfx = Kenney CC0 (Interface Sounds + Music Jingles)._

## Background music (V1)

Three ambient loops shipped in `public/assets/music/`, selected via `deep-research`
against OpenGameArt.org's CC0 filter and adversarially verified (license text +
direct-download URL both confirmed by an independent second agent). All three
are **CC0 / Creative Commons Zero (public domain dedication)** — no attribution
required, but the authors are credited here as a courtesy.

| File | Track | Artist | Duration | Size | Source | License |
|---|---|---|---|---|---|---|
| `dusk.mp3` | *Medieval: The Old Tower Inn* | RandomMind | ~2:36 | 2.5 MB | [OpenGameArt](https://opengameart.org/content/medieval-the-old-tower-inn) | CC0 |
| `raid.ogg` | *Loopable Dungeon Ambience* | JaggedStone | ~1:40 | 1.6 MB | [OpenGameArt](https://opengameart.org/content/loopable-dungeon-ambience) | CC0 |
| `dawn.ogg` | *Heavenly Loop* | isaiah658 | ~1:15 | 1.2 MB | [OpenGameArt](https://opengameart.org/content/heavenly-loop) | CC0 |

**When it plays:** `dusk` under most gameplay, `raid` when a raid is imminent
(`raidDays <= 1` or `raidLikely`), `dawn` on the dawn transition. All three
fail-silent, autoplay-blocked-safe, and gated behind a separate 🎵 toggle
(default OFF, persisted in `omd_music_muted`). Engine: `src/client/music.ts`.

_Music added 2026-07-11 · verified CC0 via workflow deep-research-omd-music._

## 3D models (villagers & wildlife)

three.js example models (Soldier, Horse, Flamingo, Parrot, Stork) from
[threejs.org/examples](https://threejs.org/examples) (MIT) — credited here;
the in-app credit line was removed for V1 to keep the HUD clean.
