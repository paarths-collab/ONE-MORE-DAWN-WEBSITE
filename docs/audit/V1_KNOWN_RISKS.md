# V1 Known Risks

Accepted, non-blocking risks for the V1 publish. Each has a rationale and a
post-V1 follow-up.

## 1. Build warnings (Vite/Rollup output options)

`npm run build` **passes** but prints two warnings:

```
Warning: Invalid output options (1 issue found)
- For the "sourcemapFileNames". Invalid key: Expected never but received "sourcemapFileNames".
WARN  inlineDynamicImports option is deprecated, please use codeSplitting: false instead.
```

**Why we are not fixing them now:** these options are set **inside the
`@devvit/start` Vite plugin** (`vite.config.ts` only calls `devvit({...})` and
sets `chunkSizeWarningLimit`; it does not set `sourcemapFileNames` or
`inlineDynamicImports`). Overriding the plugin's Rollup output to silence the
warnings risks changing the Devvit client/server bundle shape, which the webview
and server runtime depend on.

**Impact:** cosmetic — the build succeeds and `dist/{client,server}` is correct.

**Post-V1 follow-up:** resolved by a deliberate Devvit toolchain upgrade (see
`dependency-risk-note.md`), which is where these output options live.

**Decision:** accepted for V1. Does not block publish.

## 2. Transitive dependency advisories

See `dependency-risk-note.md`. `npm audit` = 31 transitive advisories through the
Devvit chain. Accepted as known platform risk; no blind `--force` fix.

## 3. Features intentionally cut/hidden (not risks, but noted)

Per `docs/V1_SCOPE.md`: scavenge/expedition minigame, avatar look editor, and
law/trait UI are **not in V1** and are not shown as playable in the live client.
The client smoke test (`tools/client-smoke.mjs`) asserts that no playable
scavenge action appears in live mode.

## 4. Minimal placeholder sound

V1 includes only local, procedurally-generated placeholder SFX in
`public/assets/sfx/` plus a persistent global mute toggle. This is intentionally
small and fail-silent; it is not a rich synthesized sound system or music layer.
Attribution and replacement guidance live in `docs/ATTRIBUTION.md`.
