# One More Dawn — First-Session UX Copy

> Ready-to-use copy for the onboarding and first-session experience. Tone: **dark
> survival, clear, simple, not lore-heavy, mobile-friendly** (short lines, no
> paragraphs on small screens). This is a copy spec — apply to the client when
> code changes are approved. Every string is intentionally short for a phone.

## 1. Splash / first frame (before onboarding)

**Title:** `ONE MORE DAWN`
**Line 1:** `This subreddit is a dying city.`
**Line 2:** `Keep it alive — one dawn at a time.`
**Continue CTA:** `ENTER THE CITY`

## 2. Onboarding panel (role + name)

**Header:** `CHOOSE YOUR ROLE`
**Subhead:** `Your role decides what you're best at. You can change it later.`

Role cards (icon · label · one-line):
- 🧭 `SCOUT` — `Tracks danger and helps the city read the map.`
- 🔧 `ENGINEER` — `Repair Power to raise your standing with the Builders.`
- ⛑️ `MEDIC` — `Treat the Sick to raise your standing with the Hearth.`
- 🌾 `FARMER` — `Grow Food to feed the city and earn your title.`
- 🛡️ `GUARD` — `Guard the Wall to raise your standing with the Wardens.`
- 📣 `SPEAKER` — `Every action you take also lifts morale.`

**Name field placeholder:** `Name your survivor, or we'll use your Reddit name`
(Skipping the field is fine: the game falls back to the player's Reddit
username — masked as `abcd•••` in the villager roster, full `u/name` on
houses and the leaderboard.)
**Primary CTA (enabled once a role is picked):** `ENTER THE CITY`
**Disabled hint (no role yet):** `Pick a role to begin`

> Note: V1 captures a **name only** — no pixel-look editor. Keep the label
> "Name your survivor," not "Create your avatar."

## 3. One-time first-session coachmarks (3 taps, dismissible)

Show once, after entering. Each is one short card with a "GOT IT" / "NEXT" button.

1. **This is your city.** `Everyone in this subreddit shares one city. What you do adds up.`
2. **One action a day.** `Spend your energy on the wall or the fields. It lands at the next dawn.`
3. **Decide together.** `Vote on the crisis, back a plan, pledge to save The Marked. Then come back at dawn.`

**Final coachmark CTA:** `START`

## 4. Helper text (inline, per control)

- **Daily action (hotbar):**
  - Section label: `DAWN ACTIONS`
  - Helper: `One of each per day. Your work lands at the next dawn.`
  - Disabled (already used): `✓ done today`
  - Disabled (no energy): `out of energy — back at dawn`
  - Energy pill tooltip: `Energy left today`

- **Crisis vote:**
  - Label: `TODAY'S CRISIS`
  - Helper: `One vote. It resolves at dawn.`
  - After voting: `Your vote is in — see the outcome at dawn.`

- **Council plan:**
  - Label: `THE COUNCIL`
  - Helper: `Back the plan you want the city to follow.`

- **The Marked pledge:**
  - Label: `THE MARKED`
  - Helper: `Pledge to save them before dawn. One pledge a day — no energy needed.`
  - After pledging: `You stood for them today.`

- **Raid countdown:**
  - Label: `RAID WATCH`
  - Countdown: `Raid in {n} dawns` / `RAID AT NEXT DAWN`
  - Helper: `Guard the Wall to soften the blow.`
  - Forecast active: `⚠ The forecast says raiders move at dawn.`

- **Dawn Report teaser:**
  - Label: `DAWN REPORT`
  - Body: `The city changed overnight.`
  - CTA: `VIEW`

## 5. Empty states

- **World map, no cities yet:** `No cities have reported yet. Check back after the next dawn.`
- **World map, sub too small:** `This city isn't on the world map yet ({subs}/{min} subscribers). Keep playing locally.`
- **Leaderboard, no contributors:** `No one has contributed yet. Be the first — take an action.`
- **Dawn Report, quiet night:** `A quiet night. Nothing to report.`
- **Your impact, you rested:** `You rested. The city carried on without you — today, change that.`

## 6. Error / loading states

- **Loading (boot):** `Waking the city…`
- **Offline / API failure (title):** `CITY LINK LOST`
- **Offline body:** `Reddit didn't return the live city. Open the game from a post and make sure you're logged in.`
- **Offline CTA:** `↻ RETRY`
- **Action failed:** `That didn't go through — try again.`
- **Already acted (409):** `Already done today. Pull to refresh.`
- **Vote failed:** `Couldn't cast your vote — try again.`
- **Pledge failed:** `Couldn't record your pledge — try again.`

## 7. Fallen city (terminal)

- **Title:** `THE CITY HAS FALLEN`
- **Stats:** `Survived {n} dawns · {souls} souls remained · Cycle {c}, Day {d}`
- **Note:** `Only a moderator's reset can begin a new cycle.`

## 8. CTA label reference (quick list)

`ENTER THE CITY` · `START` · `GOT IT` · `NEXT` · `VIEW` · `↻ RETRY` ·
`GROW FOOD` · `REPAIR` · `TREAT` · `GUARD` · `PLEDGE` · `VOTE`
