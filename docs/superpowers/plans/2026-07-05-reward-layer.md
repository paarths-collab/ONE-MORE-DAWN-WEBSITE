# Plan 3 — Reward & Retention Layer (2026-07-05)

Implements spec §12. Two implementer agents run IN PARALLEL; this documents
the in-flight work. Standard protocol: agents touch only their listed files,
never run git; controller runs the full gate and commits.

## R1 — Server (types, balance, store, routes, tests)

- **types** (`src/shared/types.ts`): `DawnReport`;
  `InitResponse.dawnReport` + `InitResponse.firstVisitToday`;
  `PlayerProfile.roleRep` + `PlayerProfile.title`;
  `ActionResponse.unlockedTitle`; `MissionCompleteResponse.unlockedTitle`.
- **balance** (`src/shared/balance.ts`): `roleRepPerAction: 3`,
  `roleRepPerMission: 4`, `titles` table (3 thresholds per role, all 6 roles,
  e.g. Scout 25/75/150).
- **store**: record per-user mission loot into `day:{n}:userActions` so the
  Dawn Report can show "loot banked" per player.
- **routes**:
  - `/api/init` — builds `dawnReport` from yesterday's day data on the first
    visit of the day (`firstVisitToday`), alongside the existing daily reset.
  - `/api/action` + `/api/mission/complete` — bump `roleRep`, detect
    threshold crossings, return `unlockedTitle`.
- **tests**: unit coverage for rep/title math; extend
  `src/server/routes/api.integration.test.ts` (do not replace).

## R2 — Client (scenes)

- **Dashboard**: dawn-report overlay on first visit of the day; player title
  shown under the player subtitle.
- **MissionEnd + Actions**: toast when the response carries `unlockedTitle`.
- **Leaderboard**: show titles next to players.

## Acceptance

- Full gate green (type-check, lint, test, build).
- Dawn report appears exactly once per day per player.
- Titles unlock at the balance.ts thresholds and are announced in the same
  response that crossed them.
