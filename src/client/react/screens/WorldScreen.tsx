import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CityStatusTag, WorldCity, WorldResponse } from '../../../shared/types';
import { api } from '../../game/api';
import { MEDALS, WORLD_STATUS_DEFS } from '../defs';

// WORLD — Plan 2's tribal engine, pixel command-console skin. Every subreddit
// is a ranked city; the cross-sub standings make a community go "we need to
// beat theirs". Returns panels; the parent `.pxl-content` scrolls. Data is
// lazy-loaded when the tab first opens (never on app boot) and cached across
// tab switches.

// ---------- sorts ----------

type WorldSort = 'dawns' | 'saved' | 'souls';

type SortDef = {
  id: WorldSort;
  icon: string;
  label: string;
  unit: string;
  value: (c: WorldCity) => number;
};

const SORT_DEFS: readonly SortDef[] = [
  { id: 'dawns', icon: '🌅', label: 'LONGEST DAWN', unit: 'dawns', value: (c) => c.survivalDays },
  { id: 'saved', icon: '🕯️', label: 'MOST SAVED', unit: 'saved', value: (c) => c.savedCount },
  { id: 'souls', icon: '👥', label: 'BIGGEST', unit: 'souls', value: (c) => c.population },
];

const STATUS_ORDER: readonly CityStatusTag[] = [
  'thriving',
  'holding',
  'strained',
  'under_raid',
  'fallen',
];

// ---------- navigation: every city is a real subreddit you can travel to ----------

/** "r/meadowbrook" → https://www.reddit.com/r/meadowbrook (opened in a new tab). */
function visitCity(subreddit: string): void {
  const path = subreddit.replace(/^\/?/, '');
  window.open(`https://www.reddit.com/${path}`, '_blank', 'noopener');
}

/** "r/meadowbrook" → "meadowbrook"; caps length so map labels stay tidy. */
function shortSub(subreddit: string): string {
  const bare = subreddit.replace(/^\/?r\//i, '');
  return bare.length > 11 ? `${bare.slice(0, 10)}…` : bare;
}

// ---------- deterministic map layout (stable hash → x/y, never Math.random) ----------

/** FNV-1a-ish 32-bit hash — same subreddit always lands in the same spot. */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const MAP_W = 720;
const MAP_H = 420;

type PlacedCity = { city: WorldCity; x: number; y: number; r: number };

/**
 * Spread cities across the survey map from a stable hash of their name. Two
 * independent hash streams (name, name+salt) give x and y; a light jitter grid
 * plus per-node collision nudging keeps clusters from overlapping. Pure and
 * deterministic — identical every render, no RNG.
 */
function placeCities(cities: readonly WorldCity[]): PlacedCity[] {
  const padX = 46;
  const padY = 52;
  const placed: PlacedCity[] = [];
  for (const city of cities) {
    const hx = hashStr(city.subreddit);
    const hy = hashStr(`${city.subreddit}::y`);
    let x = padX + ((hx % 100000) / 100000) * (MAP_W - padX * 2);
    let y = padY + ((hy % 100000) / 100000) * (MAP_H - padY * 2);
    // node size grows gently with survival (the headline stat)
    const r = 7 + Math.min(9, Math.sqrt(Math.max(0, city.survivalDays)) * 1.6);
    // nudge away from already-placed nodes so labels don't collide
    for (let pass = 0; pass < 24; pass++) {
      let moved = false;
      for (const p of placed) {
        const dx = x - p.x;
        const dy = y - p.y;
        const dist = Math.hypot(dx, dy);
        const min = r + p.r + 46;
        if (dist < min && dist > 0.01) {
          const push = (min - dist) / 2;
          x += (dx / dist) * push;
          y += (dy / dist) * push;
          moved = true;
        }
      }
      x = Math.max(padX, Math.min(MAP_W - padX, x));
      y = Math.max(padY, Math.min(MAP_H - padY, y));
      if (!moved) break;
    }
    placed.push({ city, x, y, r });
  }
  return placed;
}

// ---------- the survey map (inline SVG, CSS-only glow, no per-frame JS) ----------

/** Scoped styles for the map + clickable rows. Injected once (single edited
 *  file); animations are CSS transforms/opacity only — no requestAnimationFrame. */
const MAP_CSS = `
.pxl-map-sweep { animation: pxlMapSweep 7s linear infinite; }
@keyframes pxlMapSweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.pxl-map-you-ring { animation: pxlMapPing 2.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
@keyframes pxlMapPing { 0%,100% { opacity: .9; } 50% { opacity: .35; } }
.pxl-map-node text { transition: fill .15s; }
.pxl-map-node:hover > circle:nth-of-type(2),
.pxl-map-node:focus-visible > circle:nth-of-type(2) { stroke: var(--gold); stroke-width: 2.5; }
.pxl-map-node:hover text, .pxl-map-node:focus-visible text { fill: var(--gold); }
.pxl-map-node:focus { outline: none; }
.pxl-wrow-btn { transition: transform .1s, border-color .12s; }
.pxl-wrow-btn:hover { border-color: var(--goldline); }
.pxl-wrow-btn:active { transform: scale(.99); }
@media (prefers-reduced-motion: reduce) {
  .pxl-map-sweep, .pxl-map-you-ring { animation: none; }
}
`;

function WorldMap({ cities }: { cities: readonly WorldCity[] }) {
  const placed = useMemo(() => placeCities(cities), [cities]);
  const you = placed.find((p) => p.city.isYou) ?? null;

  // faint topo grid lines
  const gridCols = 9;
  const gridRows = 5;

  return (
    <div className="pxl-panel card" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
      <style>{MAP_CSS}</style>
      <div className="pxl-phead" style={{ padding: '13px 16px 0' }}>
        <span className="lbl">🛰️ Survey Map</span>
        <span className="meta">tap a city to travel ↗</span>
      </div>
      <div style={{ position: 'relative', width: '100%' }}>
        <svg
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          width="100%"
          role="img"
          aria-label={`Survey map of ${cities.length} subreddit-cities`}
          style={{ display: 'block' }}
        >
          <defs>
            <radialGradient id="pxlMapBg" cx="50%" cy="42%" r="75%">
              <stop offset="0%" stopColor="#181410" />
              <stop offset="60%" stopColor="#0f0c0a" />
              <stop offset="100%" stopColor="#0a0807" />
            </radialGradient>
            <radialGradient id="pxlSweep" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(232,195,74,.16)" />
              <stop offset="70%" stopColor="rgba(232,195,74,.05)" />
              <stop offset="100%" stopColor="rgba(232,195,74,0)" />
            </radialGradient>
            <filter id="pxlNodeGlow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="3.4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* base */}
          <rect x="0" y="0" width={MAP_W} height={MAP_H} fill="url(#pxlMapBg)" />

          {/* topo / grid lines */}
          <g stroke="#2a2320" strokeWidth="1" opacity="0.55">
            {Array.from({ length: gridCols - 1 }).map((_, i) => {
              const x = ((i + 1) / gridCols) * MAP_W;
              return <line key={`v${i}`} x1={x} y1="0" x2={x} y2={MAP_H} />;
            })}
            {Array.from({ length: gridRows - 1 }).map((_, i) => {
              const y = ((i + 1) / gridRows) * MAP_H;
              return <line key={`h${i}`} x1="0" y1={y} x2={MAP_W} y2={y} />;
            })}
          </g>
          {/* concentric topo rings from map center */}
          <g stroke="#332a20" strokeWidth="1" fill="none" opacity="0.5">
            {[70, 140, 210, 280].map((rr) => (
              <ellipse key={rr} cx={MAP_W / 2} cy={MAP_H / 2} rx={rr * 1.25} ry={rr} />
            ))}
          </g>

          {/* slow radar sweep — pure CSS rotation, one element, cheap */}
          <g className="pxl-map-sweep" style={{ transformOrigin: `${MAP_W / 2}px ${MAP_H / 2}px` }}>
            <path
              d={`M ${MAP_W / 2} ${MAP_H / 2} L ${MAP_W / 2 + 460} ${MAP_H / 2 - 150} A 490 490 0 0 1 ${MAP_W / 2 + 460} ${MAP_H / 2 + 150} Z`}
              fill="url(#pxlSweep)"
            />
          </g>

          {/* link lines from your city to neighbors (travel routes) */}
          {you !== null && (
            <g stroke="var(--goldline)" strokeWidth="1" strokeDasharray="3 5" opacity="0.5">
              {placed
                .filter((p) => !p.city.isYou)
                .map((p) => (
                  <line key={`ln-${p.city.subreddit}`} x1={you.x} y1={you.y} x2={p.x} y2={p.y} />
                ))}
            </g>
          )}

          {/* city nodes */}
          {placed.map((p) => {
            const def = WORLD_STATUS_DEFS[p.city.status];
            const isYou = p.city.isYou;
            return (
              <g
                key={p.city.subreddit}
                className="pxl-map-node"
                onClick={() => visitCity(p.city.subreddit)}
                role="button"
                tabIndex={0}
                aria-label={`Visit ${p.city.subreddit}, ${def.label}, ${p.city.survivalDays} dawns survived`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    visitCity(p.city.subreddit);
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                {/* generous invisible hit area */}
                <circle cx={p.x} cy={p.y} r={p.r + 16} fill="transparent" />
                {isYou && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={p.r + 8}
                    fill="none"
                    stroke="var(--gold)"
                    strokeWidth="2"
                    className="pxl-map-you-ring"
                  />
                )}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={p.r}
                  fill={def.color}
                  stroke={isYou ? 'var(--gold)' : 'rgba(0,0,0,.5)'}
                  strokeWidth={isYou ? 2 : 1}
                  filter="url(#pxlNodeGlow)"
                />
                <circle cx={p.x - p.r * 0.3} cy={p.y - p.r * 0.3} r={p.r * 0.28} fill="rgba(255,255,255,.55)" />
                {/* label */}
                <text
                  x={p.x}
                  y={p.y + p.r + 13}
                  textAnchor="middle"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize="11"
                  fontWeight="700"
                  fill={isYou ? 'var(--gold)' : 'var(--ink)'}
                >
                  {shortSub(p.city.subreddit)}
                </text>
                <text
                  x={p.x}
                  y={p.y + p.r + 25}
                  textAnchor="middle"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize="9"
                  fill="var(--mut)"
                >
                  {def.icon} {p.city.survivalDays}d
                </text>
                {isYou && (
                  <text
                    x={p.x}
                    y={p.y - p.r - 9}
                    textAnchor="middle"
                    fontFamily="'Silkscreen','JetBrains Mono',monospace"
                    fontSize="8"
                    fill="var(--gold)"
                    letterSpacing="1"
                  >
                    ★ YOU
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ---------- ready body (own hooks, mounted only when data is in) ----------

function WorldBody({ data }: { data: WorldResponse }) {
  const [sort, setSort] = useState<WorldSort>('dawns');

  const sortDef = SORT_DEFS.find((s) => s.id === sort) ?? SORT_DEFS[0]!;
  const ranked = useMemo(
    () =>
      [...data.cities].sort(
        (a, b) => sortDef.value(b) - sortDef.value(a) || a.subreddit.localeCompare(b.subreddit),
      ),
    [data.cities, sortDef],
  );
  const you = data.cities.find((c) => c.isYou) ?? null;
  const youIdx = ranked.findIndex((c) => c.isYou);

  // Tribal pride, computed against the ACTIVE sort.
  let taunt: string | null = null;
  if (you !== null && youIdx === 0) {
    taunt = `👑 ${you.subreddit} leads the world — keep it that way.`;
  } else if (you !== null && youIdx > 0) {
    const rival = ranked[youIdx - 1]!;
    const gap = sortDef.value(rival) - sortDef.value(you);
    taunt = `▲ ${rival.subreddit} just passed you — ${gap} ${sortDef.unit} ahead. Take it back.`;
  }

  // No cities registered yet (empty world).
  if (data.cities.length === 0) {
    return (
      <div className="pxl-panel card">
        <div className="pxl-phead">
          <span className="lbl">World Standings</span>
          <span className="meta">0 cities</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--mut)' }}>
          No cities stand in the World yet. Keep yours alive — the map awaits.
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ---- prominent participation banner ---- */}
      <div
        className="pxl-panel card"
        style={{
          padding: '13px 16px',
          border: '1px solid var(--goldline)',
          background: 'linear-gradient(180deg,#1d1608,var(--card))',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--pixel)',
            fontSize: 13,
            letterSpacing: 1,
            color: 'var(--gold)',
            lineHeight: 1.5,
          }}
        >
          🌐 {data.totalCities} {data.totalCities === 1 ? 'CITY' : 'CITIES'} HOLDING THE LINE
        </div>
        <div style={{ fontSize: 11, color: 'var(--mut)', marginTop: 5 }}>
          {data.yourRank !== null ? (
            <>
              you&rsquo;re <b style={{ color: 'var(--ink)' }}>#{data.yourRank}</b> — every node is a real
              subreddit
            </>
          ) : (
            <>every node is a real subreddit · dawn spares no one</>
          )}
        </div>
      </div>

      {/* ---- the survey map ---- */}
      <WorldMap cities={data.cities} />

      {/* ---- your rank / eligibility gate ---- */}
      {data.eligible ? (
        <div className="pxl-panel card">
          <div className="pxl-phead">
            <span className="lbl">Your City</span>
            <span className="meta">among {data.totalCities} cities</span>
          </div>
          <div className="pxl-wrow you">
            <span className="rk" aria-hidden="true">
              {data.yourRank !== null ? MEDALS[data.yourRank - 1] ?? `#${data.yourRank}` : '—'}
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="wn">{you?.subreddit ?? 'your city'}</span>
              <span className="ws" style={{ color: 'var(--gold)' }}>
                {data.yourRank !== null
                  ? `YOU · RANK #${data.yourRank} OF ${data.totalCities}`
                  : 'YOU · HOLDING'}
              </span>
            </span>
            {you && (
              <span className="wd" aria-hidden="true">
                {WORLD_STATUS_DEFS[you.status].icon}
              </span>
            )}
          </div>
          {taunt !== null && (
            <div className="pxl-rnote" style={{ marginTop: 4 }}>
              <span aria-hidden="true">⚔️</span>
              <span>{taunt}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="pxl-panel card">
          <div className="pxl-phead">
            <span className="lbl">The World Awaits</span>
            <span className="meta">🔒 locked</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--mut)', lineHeight: 1.6, marginBottom: 12 }}>
            Your city joins the World at <b style={{ color: 'var(--ink)' }}>{data.minSubscribers}</b>{' '}
            members — you have{' '}
            <b style={{ color: 'var(--ink)' }}>{data.subscribers ?? 'a few'}</b>. Keep it alive; the
            map awaits.
          </p>
          {(() => {
            const have = data.subscribers ?? 0;
            const pct = Math.max(
              0,
              Math.min(100, Math.round((have / Math.max(1, data.minSubscribers)) * 100)),
            );
            return (
              <>
                <div className="pxl-track">
                  <i style={{ width: `${pct}%`, background: 'var(--gold)' }} />
                </div>
                <div
                  className="lbl"
                  style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--mut)', marginTop: 8 }}
                >
                  {pct}% of the way there
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ---- standings ---- */}
      <div className="pxl-panel card">
        <div className="pxl-phead">
          <span className="lbl">🏆 World Standings</span>
          <span className="meta">{data.totalCities} cities</span>
        </div>

        <div className="pxl-act-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 12 }}>
          {SORT_DEFS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === sort ? 'pxl-btn' : 'pxl-btn ghost'}
              style={{ marginTop: 0, fontSize: 9, padding: '9px 6px', gap: 5 }}
              onClick={() => setSort(s.id)}
              aria-pressed={s.id === sort}
            >
              <span aria-hidden="true">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>

        {ranked.map((c, i) => {
          const def = WORLD_STATUS_DEFS[c.status];
          const medal = MEDALS[i];
          return (
            <button
              key={c.subreddit}
              type="button"
              className={c.isYou ? 'pxl-wrow you pxl-wrow-btn' : 'pxl-wrow pxl-wrow-btn'}
              onClick={() => visitCity(c.subreddit)}
              title={`Travel to ${c.subreddit}`}
              aria-label={`Visit ${c.subreddit}, rank ${i + 1}, ${def.label}`}
              style={{ width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }}
            >
              <span className="rk" aria-hidden="true">
                {medal ?? `#${i + 1}`}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="wn">
                  {c.subreddit}
                  {c.isYou && (
                    <span className="pxl-tag" style={{ marginLeft: 7 }}>
                      YOU
                    </span>
                  )}
                </span>
                <span className="ws" style={{ color: def.color }}>
                  {def.icon} {def.label.toUpperCase()}
                  {c.status === 'fallen' ? ` · FELL D${c.day}` : ''}
                  <span style={{ color: 'var(--mut)', marginLeft: 6 }}>↗ visit</span>
                </span>
              </span>
              <span
                className="wd"
                style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--gold)' }}
              >
                {sortDef.value(c)}
                <span style={{ color: 'var(--mut)', fontSize: 8 }}> {sortDef.unit}</span>
              </span>
            </button>
          );
        })}

        <div className="pxl-legend" aria-hidden="true" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
          {STATUS_ORDER.map((k) => (
            <span
              key={k}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--pixel)', fontSize: 7, color: 'var(--mut)' }}
            >
              <i
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: WORLD_STATUS_DEFS[k].color,
                }}
              />
              {WORLD_STATUS_DEFS[k].label.toUpperCase()}
            </span>
          ))}
        </div>
      </div>

      <div
        className="lbl"
        style={{ textAlign: 'center', fontSize: 9, color: 'var(--mut)', fontFamily: 'var(--pixel)', padding: '4px 0' }}
      >
        every city is a real subreddit · dawn spares no one
      </div>
    </>
  );
}

// ---------- the screen (lazy fetch + cache) ----------

type WorldNet =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: WorldResponse };

/** Survives tab switches so reopening WORLD is instant (refetched in background). */
let worldCache: WorldResponse | null = null;

export function WorldScreen() {
  const [net, setNet] = useState<WorldNet>(() =>
    worldCache !== null ? { kind: 'ready', data: worldCache } : { kind: 'loading' },
  );

  const load = useCallback(() => {
    api
      .world()
      .then((data) => {
        worldCache = data;
        setNet({ kind: 'ready', data });
      })
      .catch((err: Error) => {
        setNet((n) => (n.kind === 'ready' ? n : { kind: 'error', message: err.message }));
      });
  }, []);

  // Lazy by design: fires when the WORLD tab first mounts, never on app boot.
  useEffect(() => {
    load();
  }, [load]);

  if (net.kind === 'loading') {
    return (
      <div className="pxl-full">
        <div className="inner">
          <div className="pxl-boot-sun" aria-hidden="true" />
          <h2>SURVEYING</h2>
          <p>surveying the wasteland…</p>
        </div>
      </div>
    );
  }

  if (net.kind === 'error') {
    return (
      <div className="pxl-full">
        <div className="inner">
          <div style={{ fontSize: 34, marginBottom: 10 }} aria-hidden="true">
            🛰️
          </div>
          <h2>LINK DOWN</h2>
          <p>The survey link is down. {net.message}</p>
          <button type="button" className="pxl-btn ghost" style={{ maxWidth: 220, margin: '14px auto 0' }} onClick={load}>
            Retry the scan
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pxl-phead" style={{ marginBottom: 2 }}>
        <span className="lbl" style={{ fontFamily: 'var(--pixel)', fontSize: 13, color: 'var(--gold)' }}>
          WORLD OF CITIES
        </span>
        <button
          type="button"
          className="pxl-sheet-x"
          onClick={load}
          aria-label="Rescan the world"
          title="Rescan"
        >
          ↻
        </button>
      </div>
      <WorldBody data={net.data} />
    </>
  );
}
