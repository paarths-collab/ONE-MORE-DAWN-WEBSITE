# Dependency Risk Note — V1

Date: 2026-07-10 · Status: **production dependency audit clean; residual CLI-only risk accepted.**

## Current audit result

The Devvit packages move together on `0.13.7`:

- `@devvit/web` is the production dependency.
- `@devvit/start` and `devvit` are development dependencies used to build,
  playtest, and upload the app.
- `npm audit --omit=dev` reports **0 vulnerabilities**.
- Full `npm audit` reports **5 development-tool findings** (1 high, 4 low)
  through the Devvit CLI's `inquirer` → `external-editor` → `tmp` chain.

The V1 game server and webview do not import or execute that editor path. The
remaining high advisory requires local CLI use with attacker-controlled temporary
file options; it is not reachable from a Reddit player request.

## What changed

The lockstep patch from Devvit `0.13.6` to `0.13.7` removed the prior runtime and
toolchain advisories involving `ws`, `protobufjs`, and `js-yaml`. The build,
typecheck, lint, unit/integration suite, and client smoke all pass on `0.13.7`.

## Why we are not running `npm audit fix --force`

The remaining automated fix is Devvit `1.0.0`, a major-version upgrade. Taking a
major platform migration immediately before the V1 private playtest would create
more launch risk than the CLI-only advisory removes. Do not force-upgrade it as
part of this release.

## V1 decision

**Accepted as a development-tool risk, not a production runtime risk.** Revisit
Devvit `1.x` in a dedicated post-V1 upgrade with the full automated gate and a
real private-subreddit regression playtest.
