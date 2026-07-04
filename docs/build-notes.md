# Build Notes — lessons for agents working in this repo

One lesson per bullet. Update rather than duplicate; delete if proven wrong.

## Environment
- Windows 11, Git Bash for shell tasks. npm scripts with single-quoted globs
  break on Windows — use escaped double quotes (fixed in `lint` script, commit 548efe6).
- `npm run build` emits two PRE-EXISTING rollup warnings (`sourcemapFileNames`,
  `inlineDynamicImports`) — harmless template noise, not caused by your change.
- `npm install` reports 31 audit advisories inherited from the upstream Devvit
  template — out of scope, do not attempt to fix.
- Git warns "LF will be replaced by CRLF" on Windows — cosmetic, ignore.
- Node v24, npm 11. Devvit CLI commands (`devvit login/upload/playtest`,
  `npm run dev`) require Reddit auth owned by the human — never run them.

## Execution protocol (Fable parallel mode)
- Implementer agents working in parallel touch ONLY their listed files and
  NEVER run git commands (no add/commit) — the controller verifies the full
  gate (type-check, lint, test, build) and commits each task separately.
- Run targeted tests while working (`npx vitest run src/path/file.test.ts`);
  the controller runs the full suite at commit time.
- Ground every report claim in a tool result from your session; if unverified,
  say so explicitly.

## Project facts
- Type contract: `src/shared/types.ts` (Task 3, verified). Balance numbers:
  `src/shared/balance.ts` only — no magic numbers elsewhere.
- Redis: Devvit Redis has no lists/sets, no key enumeration; hash fields
  cannot expire (mission tokens are per-token keys with TTL for this reason).
- `src/shared/api.ts` is the template's old counter types — still imported by
  template client scenes until Task 16; do not delete before then.
- Conventions: type aliases over interfaces, named exports, never cast types
  (exception: approved casts inside `src/shared/balance.ts`).
