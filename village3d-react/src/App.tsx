import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createVillageScene,
  MAX_VILLAGERS,
  type BuildingMeta,
  type CompanionKind,
  type PoiInfo,
  type TimeOfDay,
  type VillageHandle,
} from './scene';

// ONE MORE DAWN — 3D town, React edition v3. Left panel: SCENE (time of day,
// villagers, companions). Right panel: CITY dashboard (vitals + the district
// directory — click a district and the camera flies to it). All React state.

const TIMES: { id: TimeOfDay; icon: string; label: string; tagline: string }[] = [
  { id: 'night', icon: '🌙', label: 'NIGHT', tagline: 'the city sleeps — dawn is coming' },
  { id: 'dawn', icon: '🌅', label: 'DAWN', tagline: 'dawn is coming — hold the line' },
  { id: 'day', icon: '☀️', label: 'DAY', tagline: 'the city works while the light lasts' },
  { id: 'dusk', icon: '🌇', label: 'DUSK', tagline: 'last light — count your stores' },
];

const COMPANIONS: { id: CompanionKind; icon: string; label: string }[] = [
  { id: 'horse', icon: '🐴', label: 'HORSE' },
  { id: 'flamingo', icon: '🦩', label: 'FLAMINGO' },
  { id: 'parrot', icon: '🦜', label: 'PARROT' },
  { id: 'stork', icon: '🕊️', label: 'STORK' },
];

// ---------- LIVE tab demo data (copied from the game's mock fixtures in
// src/client/game/api.ts + src/client/react/defs.ts — this prototype is not
// wired to the server, so the numbers drift on timers instead).

type CrisisOptId = 'a' | 'b' | 'c';
type PlanId = 'prepare_raid' | 'stockpile_food' | 'repair_power';
type LiveEvent = { icon: string; text: string; key: number };

const MARKED_GOAL = 40;

const PLEDGES: { id: string; icon: string; label: string }[] = [
  { id: 'stand_vigil', icon: '🕯️', label: 'Stand Vigil' },
  { id: 'share_rations', icon: '🍞', label: 'Share Rations' },
  { id: 'run_messages', icon: '🕊️', label: 'Run Messages' },
  { id: 'back_council', icon: '🏛️', label: 'Back the Council' },
];

const CRISIS_IDS: CrisisOptId[] = ['a', 'b', 'c'];
const CRISIS_OPTS: { id: CrisisOptId; nm: string; fx: string }[] = [
  { id: 'a', nm: 'Let them in', fx: '+30 👥 · −20 🍞 · +4 🙂' },
  { id: 'b', nm: 'Turn them away', fx: '−10 🙂 · +3 🛡️' },
  { id: 'c', nm: 'Inspect first', fx: '+15 👥 · −8 🍞 · +3 ☠️' },
];

const PLAN_IDS: PlanId[] = ['prepare_raid', 'stockpile_food', 'repair_power'];
const PLANS: { id: PlanId; nm: string }[] = [
  { id: 'prepare_raid', nm: '🛡️ Prepare for Raid' },
  { id: 'stockpile_food', nm: '🍞 Stockpile Food' },
  { id: 'repair_power', nm: '⚡ Repair Power' },
];

const DRAMA: { icon: string; text: string }[] = [
  { icon: '🕯️', text: 'ashen_fox stood vigil for Mira — the medics take heart.' },
  { icon: '⚔️', text: 'Raiders probed the North Wall at dusk. The watch held.' },
  { icon: '🎒', text: 'quiet_marrow crawled back from the deep ruins with 7 food.' },
  { icon: '🗳️', text: '25 citizens have voted on the Convoy at the Gate.' },
  { icon: '📜', text: 'The Council leans toward Prepare for Raid — 9 backers.' },
  { icon: '🩹', text: 'saltcedar treated the sick through the night shift.' },
  { icon: '🏚️', text: 'A rival city went dark last night. Theirs, not ours.' },
  { icon: '🌅', text: 'Dawn broke over the city — day 5, still standing.' },
];

// Demo vitals in the game dashboard's style (static — this prototype is not
// wired to the server).
const VITALS: { k: string; icon: string; v: number; max: number; danger?: boolean }[] = [
  { k: 'FOOD', icon: '🍞', v: 342, max: 500 },
  { k: 'POWER', icon: '⚡', v: 78, max: 100 },
  { k: 'MEDICINE', icon: '🩹', v: 12, max: 120 },
  { k: 'MORALE', icon: '🙂', v: 44, max: 100 },
  { k: 'THREAT', icon: '☠️', v: 68, max: 100, danger: true },
  { k: 'DEFENSE', icon: '🛡️', v: 35, max: 100 },
];
const vitColor = (pct: number, danger = false): string =>
  danger ? (pct >= 70 ? '#c85040' : pct >= 40 ? '#e8c34a' : '#57c06a') : pct < 25 ? '#c85040' : pct < 50 ? '#e8c34a' : '#57c06a';

function VillageCanvas({
  onReady,
  onProgress,
  onLoad,
  onSelect,
  onPois,
}: {
  onReady: (h: VillageHandle) => void;
  onProgress: (pct: number) => void;
  onLoad: () => void;
  onSelect: (meta: BuildingMeta | null) => void;
  onPois: (pois: PoiInfo[]) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return undefined;
    const handle = createVillageScene(el, { onProgress, onLoad, onSelect, onPois });
    onReady(handle);
    return () => handle.dispose();
    // mount once — callbacks are stable (useCallback in App)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={mountRef} className="canvas-mount" />;
}

function TopBar() {
  const RES: [string, string][] = [
    ['🍞', '342'],
    ['⚡', '78'],
    ['🩹', '12'],
    ['👥', '143'],
  ];
  return (
    <div className="hud topbar">
      <div className="title card-bit">
        <h1>THE LAST CITY</h1>
        <div className="sub">3D town · React + three.js · not wired to the game</div>
      </div>
      <div className="res">
        {RES.map(([icon, value]) => (
          <span key={icon} className="pill card-bit">
            {icon} <b>{value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function DayPill({ time, auto, raidSoon }: { time: TimeOfDay; auto: boolean; raidSoon: boolean }) {
  const def = TIMES.find((t) => t.id === time)!;
  return (
    <div className={time === 'dawn' ? 'hud day card-bit glow' : 'hud day card-bit'}>
      <div className="dn">
        {def.icon} {def.label}
        {auto && <span className="auto-tag">AUTO</span>}
      </div>
      <div className="dt">{def.tagline}</div>
      {raidSoon && <div className="dp-warn">⚠ raiders sighted beyond the wall</div>}
    </div>
  );
}

function ScenePanel({
  open,
  setOpen,
  time,
  setTime,
  auto,
  setAuto,
  villagers,
  bumpVillagers,
  companions,
  toggleCompanion,
}: {
  open: boolean;
  setOpen: (b: boolean) => void;
  time: TimeOfDay;
  setTime: (t: TimeOfDay) => void;
  auto: boolean;
  setAuto: (b: boolean) => void;
  villagers: number;
  bumpVillagers: (delta: number) => void;
  companions: Record<CompanionKind, boolean>;
  toggleCompanion: (k: CompanionKind) => void;
}) {
  return (
    <>
      <button type="button" className="hud panel-fab card-bit" onClick={() => setOpen(!open)} aria-expanded={open}>
        ⚙ SCENE
      </button>
      <div className={open ? 'hud panel card-bit on' : 'hud panel card-bit'}>
        <div className="p-head">
          <span>SCENE</span>
          <button type="button" className="p-x" onClick={() => setOpen(false)} aria-label="Close panel">
            ✕
          </button>
        </div>

        <div className="p-sec">TIME OF DAY</div>
        <div className="seg">
          {TIMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === time && !auto ? 'seg-btn on' : 'seg-btn'}
              onClick={() => {
                setAuto(false);
                setTime(t.id);
              }}
              aria-pressed={t.id === time}
            >
              <span className="si">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className={auto ? 'auto-btn on' : 'auto-btn'} onClick={() => setAuto(!auto)} aria-pressed={auto}>
          {auto ? '◉' : '○'} AUTO — let the day turn
        </button>

        <div className="p-sec">VILLAGERS</div>
        <div className="stepper">
          <button type="button" onClick={() => bumpVillagers(-1)} aria-label="Fewer villagers">
            −
          </button>
          <span className="count">
            {villagers} <i>walking</i>
          </span>
          <button type="button" onClick={() => bumpVillagers(1)} aria-label="More villagers">
            +
          </button>
        </div>

        <div className="p-sec">COMPANIONS</div>
        <div className="chips">
          {COMPANIONS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={companions[c.id] ? 'chip-t on' : 'chip-t'}
              onClick={() => toggleCompanion(c.id)}
              aria-pressed={companions[c.id]}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

type LiveState = {
  pledged: number;
  pledgedToday: boolean;
  onPledge: () => void;
  crisisVotes: Record<CrisisOptId, number>;
  myCrisisVote: CrisisOptId | null;
  onCrisisVote: (id: CrisisOptId) => void;
  councilVotes: Record<PlanId, number>;
  raidDays: number;
  events: LiveEvent[];
};

function LiveTab({
  pledged,
  pledgedToday,
  onPledge,
  crisisVotes,
  myCrisisVote,
  onCrisisVote,
  councilVotes,
  raidDays,
  events,
}: LiveState) {
  const mkPct = Math.round((pledged / MARKED_GOAL) * 100);
  const crisisTotal = Math.max(1, crisisVotes.a + crisisVotes.b + crisisVotes.c);
  const councilMax = Math.max(1, ...PLAN_IDS.map((id) => councilVotes[id]));
  const raidSoon = raidDays <= 1;
  return (
    <>
      <div className="p-sec">THE MARKED</div>
      <div className="marked">
        <div className="mk-head">
          <span className="mi">🧒</span>
          <span className="mn">Mira, the greenhouse child</span>
        </div>
        <div className="mk-bar">
          <i style={{ width: `${mkPct}%` }} />
        </div>
        <div className="mk-meta">
          <span>
            {pledged} / {MARKED_GOAL} resolve
          </span>
          <span>{pledgedToday ? "You've helped today" : `${mkPct}% saved`}</span>
        </div>
        <div className="mk-pledges">
          {PLEDGES.map((p) => (
            <button key={p.id} type="button" className="mk-pledge" disabled={pledgedToday} onClick={onPledge}>
              {p.icon} {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-sec">TODAY'S CRISIS</div>
      <div className="crisis">
        <div className="cr-title">⚔️ The Convoy at the Gate</div>
        {CRISIS_OPTS.map((o) => {
          const pct = Math.round((crisisVotes[o.id] / crisisTotal) * 100);
          return (
            <button
              key={o.id}
              type="button"
              className={myCrisisVote === o.id ? 'cr-opt mine' : 'cr-opt'}
              disabled={myCrisisVote !== null}
              onClick={() => onCrisisVote(o.id)}
            >
              <span className="cr-nm">{o.nm}</span>
              <span className="cr-fx">{o.fx}</span>
              <span className="cr-pct">{pct}%</span>
            </button>
          );
        })}
      </div>

      <div className="p-sec">THE COUNCIL</div>
      <div className="council">
        {PLANS.map((p) => {
          const v = councilVotes[p.id];
          const lead = v === councilMax;
          return (
            <div key={p.id} className={lead ? 'co-plan lead' : 'co-plan'}>
              <span className="co-nm">{p.nm}</span>
              <div className="co-bar">
                <i style={{ width: `${Math.round((v / councilMax) * 100)}%` }} />
              </div>
              <span className="co-v">{v}</span>
            </div>
          );
        })}
      </div>

      <div className="p-sec">RAID WATCH</div>
      <div className={raidSoon ? 'raid soon' : 'raid'}>
        <span className="raid-ic">☠️</span>
        <div className="raid-body">
          <div className="raid-count">{raidSoon ? 'RAID AT NEXT DAWN' : `RAID IN ${raidDays} DAWNS`}</div>
          <div className="raid-note">guard the wall — every point of defense counts</div>
        </div>
      </div>

      <div className="p-sec">LIVE EVENTS</div>
      <div className="events">
        {events.map((e, i) => (
          <div key={e.key} className={i === 0 ? 'ev new' : 'ev'}>
            <span className="ei">{e.icon}</span>
            <span className="et">{e.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function CityDashboard({
  open,
  setOpen,
  tab,
  setTab,
  pois,
  selectedName,
  onVisit,
  live,
}: {
  open: boolean;
  setOpen: (b: boolean) => void;
  tab: 'city' | 'live';
  setTab: (t: 'city' | 'live') => void;
  pois: PoiInfo[];
  selectedName: string | null;
  onVisit: (name: string) => void;
  live: LiveState;
}) {
  return (
    <>
      <button type="button" className="hud dash-fab card-bit" onClick={() => setOpen(!open)} aria-expanded={open}>
        ▦ CITY
      </button>
      <div className={open ? 'hud dash card-bit on' : 'hud dash card-bit'}>
        <div className="p-head">
          <span>CITY</span>
          <button type="button" className="p-x" onClick={() => setOpen(false)} aria-label="Close dashboard">
            ✕
          </button>
        </div>

        <div className="dash-tabs">
          <button type="button" className={tab === 'city' ? 'dash-tab on' : 'dash-tab'} onClick={() => setTab('city')} aria-pressed={tab === 'city'}>
            CITY
          </button>
          <button type="button" className={tab === 'live' ? 'dash-tab on' : 'dash-tab'} onClick={() => setTab('live')} aria-pressed={tab === 'live'}>
            LIVE
          </button>
        </div>

        {tab === 'live' && <LiveTab {...live} />}

        {tab === 'city' && (
          <>
            <div className="p-sec">CITY VITALS</div>
            <div className="vits">
              {VITALS.map((r) => {
                const pct = Math.min(100, (r.v / r.max) * 100);
                const col = vitColor(pct, r.danger);
                return (
                  <div key={r.k} className="vit">
                    <div className="t">
                      <span className="k">
                        {r.icon} {r.k}
                      </span>
                      <span className="v" style={{ color: col }}>
                        {r.v}
                        <em>/{r.max}</em>
                      </span>
                    </div>
                    <div className="track">
                      <i style={{ width: `${pct}%`, background: col }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-sec">DISTRICTS — TAP TO VISIT</div>
            <div className="districts">
              {pois.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className={selectedName === p.name ? 'district on' : 'district'}
                  onClick={() => onVisit(p.name)}
                  title={p.blurb}
                >
                  <span className="di">{p.icon}</span>
                  <span className="dn2">
                    {p.name}
                    <i>LVL {p.level}</i>
                  </span>
                  <span className="go">→</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function BuildingChip({ meta }: { meta: BuildingMeta | null }) {
  const [shown, setShown] = useState<BuildingMeta | null>(meta);
  useEffect(() => {
    if (meta) setShown(meta);
  }, [meta]);
  return (
    <div className={meta ? 'hud chip card-bit on' : 'hud chip card-bit'}>
      <div className="nm">{shown?.name ?? ''}</div>
      <div className="lv">LEVEL {shown?.level ?? 1}</div>
      <div className="bl">{shown?.blurb ?? ''}</div>
      <button type="button" className="up" disabled>
        ⬆ UPGRADE — SOON
      </button>
    </div>
  );
}

function BuildDock() {
  const [toast, setToast] = useState(false);
  const timer = useRef<number | null>(null);
  const pop = useCallback(() => {
    setToast(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(false), 2200);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="hud dock">
      <div className="credits">villagers &amp; wildlife: three.js example models (threejs.org)</div>
      <div style={{ position: 'relative' }}>
        <div className={toast ? 'toast on' : 'toast'}>Building placement — coming soon</div>
        <button type="button" className="build" onClick={pop} aria-label="Build">
          🔨
        </button>
      </div>
      <span className="btag">BUILD</span>
    </div>
  );
}

function Loader({ pct, done }: { pct: number; done: boolean }) {
  return (
    <div className={done ? 'loader done' : 'loader'}>
      <div className="sun" />
      <h2>ONE MORE DAWN</h2>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="st">waking the village…</div>
    </div>
  );
}

export function App() {
  const [pct, setPct] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<BuildingMeta | null>(null);
  const [pois, setPois] = useState<PoiInfo[]>([]);
  const [time, setTimeState] = useState<TimeOfDay>('dawn');
  const [auto, setAuto] = useState(true);
  const [villagers, setVillagersState] = useState(3);
  const [companions, setCompanions] = useState<Record<CompanionKind, boolean>>({
    horse: true,
    flamingo: true,
    parrot: true,
    stork: true,
  });
  const [panelOpen, setPanelOpen] = useState(true);
  const [dashOpen, setDashOpen] = useState(true);
  const [dashTab, setDashTab] = useState<'city' | 'live'>('live');
  // LIVE tab state — all demo numbers, drifting on timers.
  const [pledged, setPledged] = useState(23);
  const [pledgedToday, setPledgedToday] = useState(false);
  const [crisisVotes, setCrisisVotes] = useState<Record<CrisisOptId, number>>({ a: 12, b: 5, c: 8 });
  const [myCrisisVote, setMyCrisisVote] = useState<CrisisOptId | null>(null);
  const [councilVotes, setCouncilVotes] = useState<Record<PlanId, number>>({
    prepare_raid: 9,
    stockpile_food: 6,
    repair_power: 4,
  });
  const [raidDays, setRaidDays] = useState(5);
  // seed newest-first: DRAMA[2] is the freshest, rotation continues at index 3
  const [events, setEvents] = useState<LiveEvent[]>(() => [2, 1, 0].map((i) => ({ ...DRAMA[i]!, key: i })));
  const handleRef = useRef<VillageHandle | null>(null);
  const manualPauseRef = useRef(0); // Date.now() until which the auto-ramp holds off
  const pledgedRef = useRef(false); // click guard (double-tap before re-render)
  const votedRef = useRef(false);
  const nextEvRef = useRef(3);

  const onReady = useCallback((h: VillageHandle) => {
    handleRef.current = h;
  }, []);
  const onProgress = useCallback((p: number) => setPct(p), []);
  const onLoad = useCallback(() => setLoaded(true), []);
  const onSelect = useCallback((meta: BuildingMeta | null) => setSelected(meta), []);
  const onPois = useCallback((list: PoiInfo[]) => setPois(list), []);

  const setTime = useCallback((t: TimeOfDay) => {
    setTimeState(t);
    handleRef.current?.setTimeOfDay(t);
  }, []);
  // Functional updates + effect-driven sync: rapid +/- taps land between React
  // renders, so reading `villagers` in a click handler would use stale state.
  // A manual tap also pauses the auto-ramp for 30s so it doesn't fight the user.
  const bumpVillagers = useCallback((delta: number) => {
    manualPauseRef.current = Date.now() + 30_000;
    setVillagersState((v) => Math.max(0, Math.min(MAX_VILLAGERS, v + delta)));
  }, []);
  useEffect(() => {
    handleRef.current?.setVillagers(villagers);
  }, [villagers, loaded]);
  const toggleCompanion = useCallback((k: CompanionKind) => {
    setCompanions((prev) => ({ ...prev, [k]: !prev[k] }));
  }, []);
  useEffect(() => {
    const h = handleRef.current;
    if (!h) return;
    (Object.keys(companions) as CompanionKind[]).forEach((k) => h.setCompanion(k, companions[k]));
  }, [companions, loaded]);

  const visitDistrict = useCallback((name: string) => {
    handleRef.current?.focusOn(name);
  }, []);

  // AUTO: the day slowly turns — night → dawn → day → dusk, ~12s per phase.
  useEffect(() => {
    if (!auto) return undefined;
    const order: TimeOfDay[] = ['night', 'dawn', 'day', 'dusk'];
    const id = window.setInterval(() => {
      setTimeState((cur) => {
        const next = order[(order.indexOf(cur) + 1) % order.length]!;
        handleRef.current?.setTimeOfDay(next);
        return next;
      });
    }, 12000);
    return () => window.clearInterval(id);
  }, [auto]);

  // AUTO: villager count random-walks ±1 within [3, MAX_VILLAGERS] every ~6s.
  // Holds off while manualPauseRef says a human just used the stepper.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (Date.now() < manualPauseRef.current) return;
      const delta = Math.random() < 0.5 ? -1 : 1;
      setVillagersState((v) => Math.max(3, Math.min(MAX_VILLAGERS, v + delta)));
    }, 6000);
    return () => window.clearInterval(id);
  }, []);

  // LIVE tab handlers — one pledge / one crisis vote per "day" (session).
  const onPledge = useCallback(() => {
    if (pledgedRef.current) return;
    pledgedRef.current = true;
    setPledged((p) => Math.min(MARKED_GOAL, p + 3));
    setPledgedToday(true);
    // optional scene API (added by another agent) — never crash if absent
    (handleRef.current as any)?.pulseMarked?.();
  }, []);
  const onCrisisVote = useCallback((id: CrisisOptId) => {
    if (votedRef.current) return;
    votedRef.current = true;
    setMyCrisisVote(id);
    setCrisisVotes((v) => ({ ...v, [id]: v[id] + 1 }));
  }, []);

  // LIVE tab simulation — every number drifts on its own clock:
  //   pledges +1 / ~7s · crisis votes +1 / ~9s · council votes +1 / ~11s ·
  //   raid countdown −1 / 48s (wraps 0 → 5) · event feed rotates / ~8s.
  useEffect(() => {
    const ids: number[] = [
      window.setInterval(() => setPledged((p) => Math.min(MARKED_GOAL, p + 1)), 7000),
      window.setInterval(() => {
        const id = CRISIS_IDS[Math.floor(Math.random() * CRISIS_IDS.length)]!;
        setCrisisVotes((v) => ({ ...v, [id]: v[id] + 1 }));
      }, 9000),
      window.setInterval(() => {
        const id = PLAN_IDS[Math.floor(Math.random() * PLAN_IDS.length)]!;
        setCouncilVotes((v) => ({ ...v, [id]: v[id] + 1 }));
      }, 11000),
      window.setInterval(() => setRaidDays((d) => (d <= 0 ? 5 : d - 1)), 48000),
      window.setInterval(() => {
        const idx = nextEvRef.current;
        nextEvRef.current = idx + 1;
        const src = DRAMA[idx % DRAMA.length]!;
        setEvents((prev) => [{ icon: src.icon, text: src.text, key: idx }, ...prev].slice(0, 6));
      }, 8000),
    ];
    return () => ids.forEach((id) => window.clearInterval(id));
  }, []);

  // Raid watch → optional scene API (defensive: the handle may not have it).
  useEffect(() => {
    const h = handleRef.current as any;
    if (raidDays <= 1) h?.setRaidWatch?.(true);
    else if (raidDays >= 5) h?.setRaidWatch?.(false);
  }, [raidDays, loaded]);

  return (
    <>
      <VillageCanvas onReady={onReady} onProgress={onProgress} onLoad={onLoad} onSelect={onSelect} onPois={onPois} />
      <TopBar />
      <DayPill time={time} auto={auto} raidSoon={raidDays <= 1} />
      <ScenePanel
        open={panelOpen}
        setOpen={setPanelOpen}
        time={time}
        setTime={setTime}
        auto={auto}
        setAuto={setAuto}
        villagers={villagers}
        bumpVillagers={bumpVillagers}
        companions={companions}
        toggleCompanion={toggleCompanion}
      />
      <CityDashboard
        open={dashOpen}
        setOpen={setDashOpen}
        tab={dashTab}
        setTab={setDashTab}
        pois={pois}
        selectedName={selected?.name ?? null}
        onVisit={visitDistrict}
        live={{
          pledged,
          pledgedToday,
          onPledge,
          crisisVotes,
          myCrisisVote,
          onCrisisVote,
          councilVotes,
          raidDays,
          events,
        }}
      />
      <BuildingChip meta={selected} />
      <BuildDock />
      <div className="hud hint card-bit">drag to pan · scroll / pinch to zoom · click a district</div>
      <Loader pct={pct} done={loaded} />
    </>
  );
}
