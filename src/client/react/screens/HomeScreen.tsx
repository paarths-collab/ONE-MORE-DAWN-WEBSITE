import { useEffect, useRef, useState } from 'react';
import type { AvatarConfig, InitResponse, Marked, VillageResponse } from '../../../shared/types';
import type { Tab } from '../TabBar';
import { PixelAvatar } from './avatarKit';
import {
  ACTION_DEFS,
  MARKED_KIND_ICON,
  markedGoalWord,
  markedPct,
  markedShortName,
  PLAN_DEFS,
  ROUTE_DEFS,
} from '../defs';
import type { Handlers } from '../handlers';

// HOME — the pixel command console. Marked + pledges, city stats, vitals,
// your-turn actions + expedition, then citizens + zones from /api/village.

const usePrev = <T,>(value: T): T | undefined => {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
};

export const hex = (n: number): string => `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

/**
 * Citizen avatar. Renders the player's chosen survivor look when one exists,
 * else a simple stable-color figure keyed off the villager's palette color
 * (for citizens who haven't built an avatar yet).
 */
export function Avatar({
  color,
  avatar = null,
  size = 32,
}: {
  color: number;
  avatar?: AvatarConfig | null;
  size?: number;
}) {
  if (avatar) return <PixelAvatar avatar={avatar} size={size} />;
  const c = hex(color);
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" shapeRendering="crispEdges" preserveAspectRatio="none">
      <rect width="20" height="20" fill="#231d1d" />
      <rect x="7" y="1" width="6" height="3" fill={c} />
      <rect x="6" y="3" width="8" height="6" fill="#d9a878" />
      <rect x="5" y="9" width="10" height="9" rx="1" fill={c} />
    </svg>
  );
}

// ---------- THE MARKED + one-tap pledge ----------

function SavedYesterday({ marked }: { marked: Marked }) {
  const y = marked.savedYesterday;
  if (y === null) return null;
  return (
    <div className={y.saved ? 'pxl-yesterday saved' : 'pxl-yesterday lost'}>
      {y.saved ? `Yesterday: ${y.name} was saved 🕯️` : `Yesterday: ${y.name} was lost. Remember it.`}
    </div>
  );
}

function MarkedCard({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const { marked, pledge } = data;
  const pct = markedPct(marked);
  const short = markedShortName(marked);
  const goalWord = markedGoalWord(marked);
  const prevPledged = usePrev(marked.pledged);
  const [surge, setSurge] = useState(false);
  useEffect(() => {
    if (prevPledged !== undefined && marked.pledged > prevPledged) {
      setSurge(true);
      const t = window.setTimeout(() => setSurge(false), 1400);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [marked.pledged]);

  return (
    <section className="pxl-marked card">
      <SavedYesterday marked={marked} />
      <div className="dawn">resolves at dawn</div>
      <div className="eye">✦ TONIGHT WE {goalWord === 'saved' ? 'SAVE' : 'HOLD'}</div>
      <div className="nm">
        <span aria-hidden="true">{MARKED_KIND_ICON[marked.kind]} </span>
        {marked.name}
      </div>
      <div className="stakes">{marked.blurb}</div>
      <div className="bar">
        <i style={{ width: `${pct}%`, boxShadow: surge ? '0 0 16px rgba(232,175,85,.9)' : undefined }} />
      </div>
      <div className="prow">
        <span style={{ color: 'var(--mut)' }}>
          {marked.pledged} / {marked.goal} {marked.unit}
        </span>
        <span style={{ color: 'var(--gold)' }}>
          {pct}% {goalWord}
        </span>
      </div>
      {pledge.usedToday ? (
        <div className="pxl-pledge-done">
          <span aria-hidden="true">🕯️</span>
          <span>
            You&rsquo;ve helped today — {short} is {pct}% {goalWord}. Come back at dawn.
          </span>
        </div>
      ) : (
        <div className="pxl-pledges">
          {pledge.options.map((o) => (
            <button key={o.id} type="button" className="pxl-pledge" onClick={() => handlers.onPledge(o.id)}>
              <span className="pi" aria-hidden="true">
                {o.icon}
              </span>
              <span className="pl">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- stat cards ----------

function Stats({ data, village }: { data: InitResponse; village: VillageResponse | null }) {
  const { city } = data;
  const online = village?.onlineCount ?? '—';
  const total = village?.totalCount ?? city.population;
  return (
    <div className="pxl-stat-grid">
      <div className="pxl-stat card">
        <div className="top">
          👥<span className="lbl">Citizens</span>
        </div>
        <div className="big">{total}</div>
        <div className="sub" style={{ color: 'var(--green)' }}>
          {city.population} souls
        </div>
      </div>
      <div className="pxl-stat card">
        <div className="top">
          ⚡<span className="lbl">Online</span>
        </div>
        <div className="big">{online}</div>
        <div className="sub" style={{ color: 'var(--mut)' }}>
          acting today
        </div>
      </div>
      <div className="pxl-stat card">
        <div className="top">
          ☠️<span className="lbl">Threat</span>
        </div>
        <div className="big">{city.threat}</div>
        <div className="sub" style={{ color: data.raidInDays <= 1 ? 'var(--danger)' : 'var(--mut)' }}>
          {data.raidInDays <= 0 ? 'raid tonight' : `raid in ${data.raidInDays}d`}
        </div>
      </div>
      <div className="pxl-stat card">
        <div className="top">
          🌅<span className="lbl">Survival</span>
        </div>
        <div className="big">{data.standing.survivalDays}</div>
        <div className="sub" style={{ color: 'var(--mut)' }}>
          dawns · cycle {city.cycle}
        </div>
      </div>
    </div>
  );
}

// ---------- city vitals ----------

const VIT_COLOR = (pct: number, danger = false): string =>
  danger ? (pct >= 70 ? '#c85040' : pct >= 40 ? '#e8c34a' : '#57c06a') : pct < 25 ? '#c85040' : pct < 50 ? '#e8c34a' : '#57c06a';

function Vitals({ data }: { data: InitResponse }) {
  const { city } = data;
  const rows: [string, string, number, number, boolean][] = [
    ['FOOD', '🍞', city.food, 300, false],
    ['POWER', '⚡', city.power, 100, false],
    ['MEDICINE', '🩹', city.medicine, 120, false],
    ['MORALE', '🙂', city.morale, 100, false],
    ['THREAT', '☠️', city.threat, 100, true],
    ['DEFENSE', '🛡️', city.defense, 100, false],
  ];
  return (
    <div className="pxl-panel card">
      <div className="pxl-phead">
        <span className="lbl">City Vitals</span>
        <span className="meta">
          {city.population} souls · def {city.defense}
        </span>
      </div>
      <div className="pxl-vit-grid">
        {rows.map(([k, ic, v, max, danger]) => {
          const p = (v / max) * 100;
          const col = VIT_COLOR(p, danger);
          return (
            <div key={k} className="pxl-vit">
              <div className="t">
                <span className="k">
                  {ic} {k}
                </span>
                <span className="v" style={{ color: col }}>
                  {v}
                  <span style={{ color: 'var(--mut)', fontSize: 9 }}>/{max}</span>
                </span>
              </div>
              <div className="pxl-track">
                <i style={{ width: `${Math.min(100, p)}%`, background: col }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- your turn: actions + expedition ----------

function YourTurn({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const { player, effectiveEnergy, yourActionsToday, missionUsedToday, city } = data;
  const energyLeft = effectiveEnergy - player.energyUsedToday;
  const injured = player.injuredUntilDay >= city.day;
  const [routes, setRoutes] = useState(false);

  // council pick = the leading strategy plan's action
  let leadPlan: keyof typeof PLAN_DEFS | null = null;
  let best = 0;
  for (const [k, n] of Object.entries(data.strategyVotes)) {
    if (n > best) {
      best = n;
      leadPlan = k as keyof typeof PLAN_DEFS;
    }
  }
  const pickAction = leadPlan ? PLAN_DEFS[leadPlan].action : null;

  return (
    <div className="pxl-panel card">
      <div className="pxl-phead">
        <span className="lbl">Your Turn</span>
        <span className="meta">spend energy</span>
      </div>
      <div className="pxl-energy">
        <span className="lbl" style={{ fontSize: 8, color: 'var(--mut)' }}>
          Energy
        </span>
        <div className="dots">
          {Array.from({ length: effectiveEnergy }).map((_, i) => (
            <span key={i} className="d" style={{ background: i < energyLeft ? 'var(--gold)' : 'transparent' }} />
          ))}
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 800, color: 'var(--gold)' }}>
          {energyLeft}/{effectiveEnergy}
          {injured ? ' · injured' : ''}
        </span>
      </div>
      <div className="pxl-act-grid">
        {ACTION_DEFS.map((a) => {
          const count = yourActionsToday[a.id] ?? 0;
          const isPick = pickAction === a.id;
          return (
            <button
              key={a.id}
              type="button"
              className="pxl-act"
              disabled={energyLeft <= 0}
              onClick={() => handlers.onAction(a.id)}
            >
              {isPick && <span className="pick">👑 COUNCIL</span>}
              <span className="ai">{a.icon}</span>
              <span style={{ minWidth: 0 }}>
                <span className="an">{a.title}</span>
                <span className="ae">
                  {a.effect}
                  {count > 0 ? ` · ${count}×` : ''}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {missionUsedToday ? (
        <button type="button" className="pxl-btn ghost" disabled>
          🎒 Expedition sent — returns at dawn
        </button>
      ) : routes ? (
        <div className="pxl-act-grid" style={{ marginTop: 11, gridTemplateColumns: '1fr 1fr 1fr' }}>
          {ROUTE_DEFS.map((r) => (
            <button
              key={r.id}
              type="button"
              className="pxl-act"
              style={{ flexDirection: 'column', alignItems: 'flex-start' }}
              disabled={energyLeft <= 0}
              onClick={() => handlers.onMission(r.id)}
            >
              <span className="ai">{r.icon}</span>
              <span style={{ minWidth: 0 }}>
                <span className="an">{r.title}</span>
                <span className="ae" style={{ color: 'var(--mut)' }}>
                  {r.blurb}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <button type="button" className="pxl-btn ghost" disabled={energyLeft <= 0} onClick={() => setRoutes(true)}>
          🎒 Launch Expedition
        </button>
      )}
    </div>
  );
}

// ---------- citizens + zones ----------

const ZONE_ICON: Record<string, string> = {
  grow_food: '🌱',
  repair_power: '⚙️',
  treat_sick: '✚',
  guard_wall: '🛡️',
};

function CitizensAndZones({
  village,
  selCit,
  setSelCit,
}: {
  village: VillageResponse | null;
  selCit: number;
  setSelCit: (i: number) => void;
}) {
  const villagers = village?.villagers ?? [];
  const zones = village?.zones ?? [];
  const maxZone = Math.max(1, ...zones.map((z) => z.count));
  return (
    <div className="pxl-cols">
      <div className="a">
        <div className="pxl-panel card">
          <div className="pxl-phead">
            <span className="lbl">Citizens</span>
            <span className="meta">{villagers.length} · masked</span>
          </div>
          {villagers.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--mut)' }}>No citizens have acted yet today.</div>
          ) : (
            <div className="pxl-cit-grid">
              {villagers.map((v, i) => (
                <button
                  key={i}
                  type="button"
                  className={i === selCit ? 'pxl-cit on' : 'pxl-cit'}
                  onClick={() => setSelCit(i)}
                >
                  <span className="av">
                    <Avatar color={v.color} avatar={v.avatar} />
                    <span className="sd" style={{ background: v.online ? 'var(--green)' : 'var(--mut)' }} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="nm">{v.maskedName}</span>
                    <span className="rz">
                      {v.role ?? 'undecided'}
                      {v.faction ? ` · ${v.faction}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="b">
        <div className="pxl-panel card">
          <div className="pxl-phead">
            <span className="lbl">Zone Activity</span>
            <span className="meta">today</span>
          </div>
          {zones.map((z) => (
            <div key={z.id} className="pxl-occ">
              <div className="t">
                {ZONE_ICON[z.id] ?? '▪'} {z.name}
                <span className="ct">{z.count}</span>
              </div>
              <div className="pxl-track">
                <i style={{ width: `${(z.count / maxZone) * 100}%`, background: 'var(--gold)' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- crisis peek ----------

function CrisisPeek({ data, go }: { data: InitResponse; go: (tab: Tab) => void }) {
  const { crisis, crisisVotes, yourCrisisVote } = data;
  const total = crisis.options.reduce((s, o) => s + (crisisVotes[o.id] ?? 0), 0);
  return (
    <button type="button" className="pxl-opt" style={{ marginBottom: 0 }} onClick={() => go('crisis')}>
      <span className="oi">⚔️</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="on">{crisis.title}</span>
        <span className="oe">
          {total} voted · {yourCrisisVote ? 'your voice is counted' : 'your voice is missing'}
        </span>
      </span>
      <span className="lbl" style={{ fontSize: 9, color: 'var(--gold)' }}>
        VOTE →
      </span>
    </button>
  );
}

// ---------- the screen ----------

export type HomeScreenProps = {
  data: InitResponse;
  handlers: Handlers;
  village: VillageResponse | null;
  selCit: number;
  setSelCit: (i: number) => void;
  go: (tab: Tab) => void;
};

export function HomeScreen({ data, handlers, village, selCit, setSelCit, go }: HomeScreenProps) {
  return (
    <>
      <MarkedCard data={data} handlers={handlers} />
      <Stats data={data} village={village} />
      <Vitals data={data} />
      <YourTurn data={data} handlers={handlers} />
      <CrisisPeek data={data} go={go} />
      <CitizensAndZones village={village} selCit={selCit} setSelCit={setSelCit} />
    </>
  );
}
