# Private-Subreddit V1 Smoke Test (human-run)

The final gate before publish. Everything above this in CI (type-check, lint,
`npm test`, `npm run build`, `npm run test:client`) is automated. **This checklist
must be run by a human on a real private test subreddit**, because it exercises
the real Devvit runtime (Redis, Reddit user/mod context, `postId`) that no local
mock can prove.

## 0. Publish/runtime steps — HUMAN ONLY (do not automate)

> These authenticate as you. Run them yourself; never script them.

- [ ] `npm run login` — auth the Devvit CLI (browser popup)
- [ ] Verify the exact Devvit app identity is **one-more-dawn** and the expected app account is selected.
- [ ] Verify the target subreddit name before running playtest.
- [ ] In target subreddit mod tools, verify the app account is **not banned**.
- [ ] `npx devvit init` — register/select the app only if needed; do **not** use `--force` unless the app identity is proven wrong.
- [ ] `npm run dev -- <private_test_subreddit>` — playtest on your **private test subreddit**
- [ ] (later, only after this checklist passes) `npm run deploy` → `npm run launch`

Create a game post (mod menu **"One More Dawn: create game post"**), then run the
checks below **inside that post's webview**.

## 1. First-time user

| Check | Expected result | Pass |
|---|---|---|
| Open the game post | Town loads; subtitle is **not** "demo mode" (i.e. it's live) | [ ] |
| Onboarding appears | "CHOOSE YOUR ROLE" panel with the loop intro + 6 roles | [ ] |
| Loop is understandable | You grasp: shared city, one daily action, vote, pledge, dawn, return — in ~60s | [ ] |
| Pick a role + name → "ENTER THE CITY" | Overlay closes; "role set" notification | [ ] |

## 2. Role / name persistence

| Check | Expected result | Pass |
|---|---|---|
| After entering, note your role/name | Reflected in state | [ ] |
| **Refresh / reopen the post** | You are NOT asked to onboard again; role persists | [ ] |

## 3. Daily action

| Check | Expected result | Pass |
|---|---|---|
| Take one action (e.g. Grow Food) | "lands at next dawn" notification; energy decrements | [ ] |
| Try the same action again | Blocked (✓ done / out of energy) | [ ] |

## 4. Build contribution / start-from-zero

| Check | Expected result | Pass |
|---|---|---|
| Open CITY tab on a fresh game post | Build panel shows **Camp**, **Next: Shelter**, `0/24 labor`, and "Nothing stands here yet. Contribute labor to build the first Shelter." | [ ] |
| Tap **ADD LABOR** | Notification appears; energy decrements; contribution is shown/remembered; first contribution says "Your house now stands in the city." | [ ] |
| Repeat contribution later as the same Redditor | House count/order does not duplicate for that user | [ ] |
| Refresh / reopen the post | Build progress and your contributed-today state persist from Redis | [ ] |
| After enough labor + force-resolve day | Next building unlocks for the whole city; stage/visuals update; no individual ownership copy appears | [ ] |

## 5. Crisis vote

| Check | Expected result | Pass |
|---|---|---|
| Open LIVE tab → vote on the crisis | Your option marks selected; tally updates | [ ] |
| Try to vote again | Options disabled (one vote/day) | [ ] |

## 6. Council strategy vote

| Check | Expected result | Pass |
|---|---|---|
| Back a council plan | Notification; plan locks | [ ] |
| Try again | Disabled | [ ] |

## 7. The Marked pledge

| Check | Expected result | Pass |
|---|---|---|
| Pledge to The Marked | Marked bar updates; "you stood for them" notification | [ ] |
| Try again | Blocked (one pledge/day) | [ ] |

## 8. Raid countdown / status

| Check | Expected result | Pass |
|---|---|---|
| RAID WATCH shows a countdown | "Raid in N dawns" / "RAID AT NEXT DAWN" | [ ] |
| Forecast line when raid is near | "⚠ raiders move at dawn" guidance | [ ] |

## 9. Dawn resolution + report (mod)

| Check | Expected result | Pass |
|---|---|---|
| Run mod menu **"seed demo state"** | A populated mid-run city loads | [ ] |
| Run mod menu **"force-resolve day"** | Day advances; a **Dawn Report** is available | [ ] |
| Open the Dawn Report | Yesterday's summary + your personal impact | [ ] |

## 10. World view

| Check | Expected result | Pass |
|---|---|---|
| Open MAP → WORLD | Your city shows; if others exist, they rank; else an honest empty/"not eligible" state | [ ] |

## 11. Leaderboard / TOP view

| Check | Expected result | Pass |
|---|---|---|
| Open TOP tab | Contributors listed (username + score); empty state if none | [ ] |

## 12. Fallen city (if reachable)

| Check | Expected result | Pass |
|---|---|---|
| Drive the city to fall (or seed a near-fall + force-resolve) | Terminal "THE CITY HAS FALLEN" screen; actions disabled | [ ] |
| Mod **"reset city"** | New cycle begins; screen clears | [ ] |

## 13. Persistence & refresh

| Check | Expected result | Pass |
|---|---|---|
| After acting, refresh the post | Your actions/votes/pledges persist (server truth) | [ ] |
| Reopen later | State loads from real Redis, no reset | [ ] |

## 14. Mobile Reddit app / webview

| Check | Expected result | Pass |
|---|---|---|
| Open the post in the **Reddit mobile app** | HUD fits; no horizontal overflow; tabs reachable; onboarding readable | [ ] |
| Hold the phone portrait | Rotate advisory is visible but does not block taps; CITY/DASH controls remain usable | [ ] |
| Take one action on mobile | Works; feedback visible | [ ] |
| Toggle mute on mobile | Sound button flips and persists; gameplay is unaffected if audio is blocked | [ ] |

## 15. Multiple posts / cities (if possible)

| Check | Expected result | Pass |
|---|---|---|
| Create a **second** game post in the same test sub | It shows the same subreddit city/day/state as the first post | [ ] |
| Create or test in another private subreddit, if available | It has a separate city because each subreddit builds one shared city | [ ] |

## 16. Mod menu coverage

| Check | Expected result | Pass |
|---|---|---|
| Mod **"create game post"** | New game post opens/navigates correctly | [ ] |
| Mod **"seed demo state"** | A populated Day-5 city loads | [ ] |
| Mod **"force-resolve day"** | Day advances; Dawn Report appears | [ ] |
| Mod **"reset city"** | New cycle starts; house/build/action state clears | [ ] |

## 17. Failure behavior (optional)

| Check | Expected result | Pass |
|---|---|---|
| Open the client outside a proper post context / logged out | "CITY LINK LOST" + **RETRY**, not a fake city | [ ] |

---

**Result:** if every applicable row passes, the app is verified on the real Devvit
runtime and is ready to `npm run deploy` → `npm run launch`. Log any failure with
the exact step + what you saw, and fix before publishing.
