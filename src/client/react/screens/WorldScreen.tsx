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
            <div key={c.subreddit} className={c.isYou ? 'pxl-wrow you' : 'pxl-wrow'}>
              <span className="rk" aria-hidden="true">
                {medal ?? `#${i + 1}`}
              </span>
              <span style={{ minWidth: 0 }}>
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
                </span>
              </span>
              <span
                className="wd"
                style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--gold)' }}
              >
                {sortDef.value(c)}
                <span style={{ color: 'var(--mut)', fontSize: 8 }}> {sortDef.unit}</span>
              </span>
            </div>
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
