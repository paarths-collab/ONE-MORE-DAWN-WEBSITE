# V1 Known Risks

Accepted, non-blocking risks for the V1 publish. Each has a rationale and a
post-V1 follow-up.

## 1. Build warnings (Vite/Rollup output options)

`npm run build` **passes** but prints one warning:

```
Warning: Invalid output options (1 issue found)
- For the "sourcemapFileNames". Invalid key: Expected never but received "sourcemapFileNames".
```

**Why we are not fixing it now:** this option is set **inside the
`@devvit/start` Vite plugin** (`vite.config.ts` only calls `devvit({...})` and
sets `chunkSizeWarningLimit`; it does not set `sourcemapFileNames`). Overriding
the plugin's Rollup output to silence the warning risks changing the Devvit
client/server bundle shape, which the webview and server runtime depend on. The
Devvit `0.13.7` patch removed the former `inlineDynamicImports` warning.

**Impact:** cosmetic — the build succeeds and `dist/{client,server}` is correct.

**Post-V1 follow-up:** re-check after future Devvit toolchain upgrades; this
output option lives inside the plugin.

**Decision:** accepted for V1. Does not block publish.

## 2. Dependency advisories

See `dependency-risk-note.md`. `npm audit --omit=dev` reports **0 production
vulnerabilities** after the lockstep Devvit `0.13.7` patch. Full `npm audit`
retains 5 CLI-only findings through Devvit's local interactive tooling; the only
automated fix is a major `1.0.0` migration, deferred until after V1.

## 3. Features intentionally cut/hidden (not risks, but noted)

Per `docs/V1_SCOPE.md`: scavenge/expedition minigame, avatar look editor, and
law/trait UI are **not in V1** and are not shown as playable in the live client.
The client smoke test (`tools/client-smoke.mjs`) asserts that no playable
scavenge action appears in live mode.

## 4. Audio is fail-silent by design

V1 ships real audio: eight Kenney-derived **CC0 SFX cues** in
`public/assets/sfx/` and three **CC0 background music loops** in
`public/assets/music/` (dusk, raid, dawn) crossfaded by game state. Both layers
are fail-silent — a missing file or blocked autoplay never affects gameplay.
SFX has a persistent mute toggle; music defaults OFF until enabled from the
settings menu. Sources and licenses live in `docs/ATTRIBUTION.md`. The residual
risk is platform-side only: webview autoplay policies can delay the first sound
until a user gesture.
