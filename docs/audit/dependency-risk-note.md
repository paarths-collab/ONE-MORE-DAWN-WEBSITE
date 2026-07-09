# Dependency Risk Note — V1

Date: 2026-07-08 · Status: **known platform risk, does not block V1 publish.**

## What `npm audit` reports

`npm audit` reports **31 vulnerabilities (4 high, 25 moderate, 2 low)**. Essentially
all of them are **transitive**, pulled in through the **Devvit toolchain**
(`devvit`, `@devvit/web`, `@devvit/start`) and their build/CLI dependencies —
packages like `ws`, `tmp`, and `protobufjs`. They are not in our own application
code paths.

## Why we are NOT running `npm audit fix --force`

- `--force` will happily bump **major versions of Devvit packages** (pinned at
  `0.13.6`) to satisfy a transitive advisory. That can silently break the Devvit
  Web build, the webview contract, or the server runtime.
- The Devvit stack is tightly coupled (`@devvit/web` + `@devvit/start` + `devvit`
  must move together). A blind force-fix desyncs them.
- These advisories are in **build/CLI tooling**, not in code that runs in the
  Reddit webview or handles untrusted user input in our app.

## Recommended path (post-V1)

1. Wait for / pick a compatible Devvit release that moves the whole stack together.
2. Do a **deliberate, single-PR Devvit upgrade** (`devvit` + `@devvit/web` +
   `@devvit/start` in lockstep).
3. Run the **full regression**: `npm run type-check`, `npm run lint`, `npm test`,
   `npm run build`, `npm run test:client`, then a real `npm run dev` playtest.
4. Re-run `npm audit` and re-assess.

## V1 decision

**Accepted as known dependency risk.** No direct exploitable path was found in our
own application code (server routes validate input and require auth; the client
makes only same-origin `/api` calls). The advisories live in the Devvit build/CLI
chain. **This does not block V1 publish.** Do not force-upgrade dependencies as
part of the V1 cut.
