# One More Dawn — Reddit-Native Hook Layer (LOCKED DIRECTION)

**Decided 2026-07-06.** Grounded in cited research (deep-research wf_0348073e:
Reddit motivation = community + **status** + entertainment, NOT information;
90% engage via **low-effort** acts; r/place proved **subreddit tribalism** +
"one small act, collectively meaningful" is the native engine; Devvit rewards
engagement, never monetization).

## The pivot

The survival sim is the **engine**. The hook is **status + tribe + one-tap
collective contribution**.

> **New pitch:** Every subreddit has a city. Every day, redditors make one
> small choice to keep it alive — and at dawn, the world sees which communities
> survived, which fell, and who became legend.

Positioning: *One More Dawn is the game for Reddit users who come to watch
strangers face impossible choices and argue about who's to blame — reimagined
as their own subreddit's last city.*

## UI direction (LOCKED)

**Fusion: World of Cities (frame) + Live Drama Feed (social) + Status Spine
(everywhere).** Command-HUD structure is implementation scaffolding, not the
identity. **Mobile-first, multi-screen with a bottom tab bar — never one long
page.**

**Home screen priority order (top → bottom):**
1. My city rank / survival streak
2. THE MARKED — today's objective + progress
3. One-tap pledge buttons
4. City status (vitals)
5. Today's crisis (vote)
6. Live Drama Feed

## The six systems

1. **World of Cities** — other subreddit-cities as a ranked map/list (day
   survived · alive/under-raid/fallen · threat). Sort: longest surviving, most
   saved, most raids survived, highest morale, most active. Drives tribal
   pride. *(Plan 2 — needs cross-installation data via `redis.global`.)*
2. **The Marked** — a daily NAMED objective the city rallies to save before
   dawn: a person/place/symbol with a resource/pressure goal. Saved → enters
   the City Archive; failed → the Memorial. NOT a real user, NOT permadeath of
   a player. Examples: "Save Mira, the greenhouse child", "Hold the North
   Wall", "Keep the Hospital Ward open", "Escort the Refugee Convoy",
   "Recover the Lost Scouts", "Protect the Generator Core".
3. **One-Tap Pledges** — the lurker path: low/no-energy, one per day, each adds
   "pressure" toward the Marked goal + a city stat. e.g. Stand Vigil (+defense),
   Share Rations (+food), Run Messages (+morale), Back the Council (+unity).
   Your one tap visibly moves a shared bar (the r/place mechanic).
4. **Pledge Ledger** — public credit: "You stood vigil · the Wall is 68%
   protected · Today's Vigil: u/paarth, u/abc and 42 others." Mobile shows: top
   helpers · recent helpers · my contribution. Status is the reward.
5. **Live Drama Feed** — a feed generated from game events (returns from ruins,
   faction seizes the law, a raid survived, the Marked saved/lost, a rival city
   falls). Updates on refetch; NO realtime/websockets.
6. **Status Titles** — contribution rank, role title, faction rep visible
   across screens. Earned public credit, a Hall of Heroes / City Archive.
   *(Titles/rep already exist server-side — surface them; Hall = Plan 3.)*

## MVP phasing

- **Plan 1 (now):** The Marked objective · One-tap pledge + ledger · Live Drama
  Feed (own city) · Status surfaced · **mobile-first multi-screen rebuild with a
  genuinely attractive city view** (the current grey-box skyline is rejected) ·
  varied citizen/Marked names (name generator).
- **Plan 2:** World of Cities cross-sub ranking (`redis.global`) · public status
  titles/flair · faction/status expansion.
- **Plan 3:** City Archive / Hall of Heroes · weekly city seasons.

## Guardrails (do NOT)

- No realtime chat · no city-vs-city attacks · no purchases ever · **never
  punish absence** (unspent energy auto-resolves diegetically, "you stood
  guard") · no spammy notifications / fake urgency / grindy titles.
- Status must feel **earned** — public credit for meaningful help, community
  pride, city memory — not a constant leaderboard grind.
- Don't bury status/tribe/pledge in a side panel — they're the main screen.

## Data contract (Plan 1) — added to `src/shared/types.ts`

```
Marked = { id, name, kind:'person'|'place'|'symbol', blurb,
           goal:number, pledged:number, unit:string /* "resolve" */,
           savedYesterday: { name, saved:boolean } | null }
PledgeKind = 'stand_vigil'|'share_rations'|'run_messages'|'back_council'
PledgeInfo = { options:[{id:PledgeKind,label,icon,effect}],
               usedToday:boolean, ledger:{ topHelpers:string[], recent:string[], mine:number } }
DramaEvent = { icon, text, kind:'action'|'raid'|'law'|'marked'|'city'|'crisis' }
Standing   = { survivalDays:number, rankLabel:string /* Plan1: within-sub / "rank coming" */,
               contributionRank:number|null }
// InitResponse += marked:Marked, pledge:PledgeInfo, drama:DramaEvent[], standing:Standing
```
Endpoints: `POST /api/pledge {kind}` · drama+marked+standing ride on `/api/init`.

Backend reuse: The Marked selection uses the seeded picker (provably fair,
publish seed); pledge is a capped low-energy action into a Redis counter;
drama feed is the timeline + today's events; standing reads existing
contribution/streak. Name generator seeds citizen + Marked names.
