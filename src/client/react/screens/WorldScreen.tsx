import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CityStatusTag, WorldCity, WorldResponse } from '../../../shared/types';
import { api } from '../../game/api';
import { WorldMap } from '../WorldMap';
import { MEDALS, WORLD_STATUS_DEFS } from '../defs';
import { Chip, SectionHead } from '../kit/bits';
import { Modal } from '../kit/Modal';

// WORLD — Plan 2's tribal engine: every subreddit's city as a node on one
// PUBG-style survey map, plus the cross-sub ranking that makes a community
// go "we need to defend our city / beat theirs". Data is lazy-loaded when
// the tab first opens (never on app boot) and cached across tab switches.

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

const flavorFor = (city: WorldCity): string =>
  city.status === 'fallen' ? `Fell on day ${city.day}.` : WORLD_STATUS_DEFS[city.status].flavor;

const STATUS_ORDER: readonly CityStatusTag[] = [
  'thriving',
  'holding',
  'strained',
  'under_raid',
  'fallen',
];

// ---------- rank strip / eligibility ----------

function RankStrip({ data, you, taunt }: { data: WorldResponse; you: WorldCity | null; taunt: string | null }) {
  const rank = data.yourRank;
  return (
    <section className="omd-card omd-world-rank">
      <div className="omd-world-rank-row">
        <div className="omd-world-rank-num omd-mono">
          {rank !== null ? `#${rank}` : '—'}
          <small> of {data.totalCities}</small>
        </div>
        <div className="omd-world-rank-main">
          <div className="omd-world-rank-name omd-mono">{you?.subreddit ?? 'your city'}</div>
          <div className="omd-world-rank-note">✅ Your city stands in the World.</div>
        </div>
        {rank !== null && rank <= 3 && (
          <span className="omd-world-rank-medal" aria-hidden="true">
            {MEDALS[rank - 1]}
          </span>
        )}
      </div>
      {taunt !== null && <div className="omd-world-taunt">{taunt}</div>}
    </section>
  );
}

function LockBanner({ data }: { data: WorldResponse }) {
  const have = data.subscribers ?? 0;
  const pct = Math.max(0, Math.min(100, Math.round((have / Math.max(1, data.minSubscribers)) * 100)));
  return (
    <section className="omd-card omd-world-lock">
      <span className="omd-world-lock-icon" aria-hidden="true">
        🔒
      </span>
      <div className="omd-world-lock-main">
        <div className="omd-world-lock-title">The World awaits</div>
        <p className="omd-world-lock-sub">
          Your city joins the World at <b>{data.minSubscribers}</b> members — you have{' '}
          <b>{data.subscribers ?? 'a few'}</b>. Keep it alive; the map awaits.
        </p>
        <div className="omd-vital-track">
          <div className="omd-vital-fill omd-vital-fill--warn" style={{ width: `${pct}%` }} />
        </div>
        <div className="omd-world-lock-pct omd-mono">{pct}% of the way there</div>
      </div>
    </section>
  );
}

// ---------- peek card (bottom sheet) ----------

function PeekStat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'warn' | 'danger' }) {
  return (
    <div className="omd-peek-stat">
      <div className={tone !== undefined ? `omd-peek-stat-num tone-${tone}` : 'omd-peek-stat-num'}>{value}</div>
      <div className="omd-peek-stat-label">{label}</div>
    </div>
  );
}

function PeekCard({ city, rank, total, onClose }: { city: WorldCity; rank: number; total: number; onClose: () => void }) {
  const def = WORLD_STATUS_DEFS[city.status];
  return (
    <Modal icon={def.icon} title={city.subreddit} onClose={onClose}>
      <div className="omd-peek-top">
        <span className="omd-peek-status" style={{ color: def.color }}>
          {def.label.toUpperCase()} · DAY {city.day}
        </span>
        <Chip icon="🏆" tone="accent">
          #{rank} of {total}
        </Chip>
      </div>
      <div className="omd-peek-flavor">&ldquo;{flavorFor(city)}&rdquo;</div>
      <div className="omd-peek-grid">
        <PeekStat label="DAWNS" value={city.survivalDays} />
        <PeekStat
          label="THREAT"
          value={city.threat}
          tone={city.threat >= 70 ? 'danger' : city.threat >= 40 ? 'warn' : 'good'}
        />
        <PeekStat label="SAVED" value={city.savedCount} />
        <PeekStat label="ACTIVE 24H" value={city.activePlayers} />
        <PeekStat label="SOULS" value={city.population} />
        <PeekStat label="CYCLE" value={city.cycle} />
      </div>
      {city.isYou ? (
        <div className="omd-peek-you">
          <span aria-hidden="true">🏙️</span>
          <span>
            <b>This is your city.</b> Every pledge, vote and watch shift moves this node. Hold the
            line.
          </span>
        </div>
      ) : city.status === 'fallen' ? (
        <div className="omd-note omd-note--center">The wasteland keeps its dead. Do not join them.</div>
      ) : (
        <div className="omd-note omd-note--center">Outlast them. The map remembers.</div>
      )}
    </Modal>
  );
}

// ---------- ready body (own hooks, mounted only when data is in) ----------

function WorldBody({ data }: { data: WorldResponse }) {
  const [sort, setSort] = useState<WorldSort>('dawns');
  const [selected, setSelected] = useState<string | null>(null);

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
  const selectedCity =
    selected !== null ? (data.cities.find((c) => c.subreddit === selected) ?? null) : null;

  // Tribal pride, computed against the ACTIVE sort.
  let taunt: string | null = null;
  if (you !== null && youIdx === 0) {
    taunt = `👑 ${you.subreddit} leads the world — keep it that way.`;
  } else if (you !== null && youIdx > 0) {
    const rival = ranked[youIdx - 1]!;
    const gap = sortDef.value(rival) - sortDef.value(you);
    taunt = `▲ ${rival.subreddit} just passed you — ${gap} ${sortDef.unit} ahead. Take it back.`;
  }

  return (
    <>
      {data.eligible ? <RankStrip data={data} you={you} taunt={taunt} /> : <LockBanner data={data} />}

      <WorldMap cities={data.cities} selected={selected} onSelect={setSelected} />

      <div className="omd-world-legend" aria-hidden="true">
        {STATUS_ORDER.map((k) => (
          <span key={k}>
            <i style={{ background: WORLD_STATUS_DEFS[k].color, color: WORLD_STATUS_DEFS[k].color }} />
            {WORLD_STATUS_DEFS[k].label.toUpperCase()}
          </span>
        ))}
      </div>

      <section className="omd-card">
        <SectionHead icon="🏆" title="WORLD STANDINGS" sub={`${data.totalCities} cities`} />
        <div className="omd-world-sorts">
          {SORT_DEFS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === sort ? 'omd-world-sort omd-world-sort--on' : 'omd-world-sort'}
              onClick={() => setSort(s.id)}
              aria-pressed={s.id === sort}
            >
              <span className="omd-world-sort-icon" aria-hidden="true">
                {s.icon}
              </span>
              <span className="omd-world-sort-label">{s.label}</span>
            </button>
          ))}
        </div>
        <div className="omd-world-list">
          {ranked.map((c, i) => {
            const def = WORLD_STATUS_DEFS[c.status];
            const medal = MEDALS[i];
            const cls = [
              'omd-world-row',
              c.isYou ? 'omd-world-row--me' : '',
              c.status === 'fallen' ? 'omd-world-row--fallen' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button key={c.subreddit} type="button" className={cls} onClick={() => setSelected(c.subreddit)}>
                <span className={medal !== undefined ? 'omd-world-row-rank omd-world-row-rank--medal' : 'omd-world-row-rank'}>
                  {medal ?? `#${i + 1}`}
                </span>
                <span
                  className="omd-world-row-dot"
                  style={{ background: def.color, color: def.color }}
                  aria-hidden="true"
                />
                <span className="omd-world-row-name">{c.subreddit}</span>
                {c.isYou && <span className="omd-tag omd-tag--mine">YOU</span>}
                {c.status === 'fallen' && <span className="omd-world-row-fell omd-mono">fell d{c.day}</span>}
                <span className="omd-world-row-val omd-mono">
                  {sortDef.value(c)} <small>{sortDef.unit}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <footer className="omd-foot">every city is a real subreddit · dawn spares no one</footer>

      {selectedCity !== null && (
        <PeekCard
          city={selectedCity}
          rank={ranked.findIndex((c) => c.subreddit === selectedCity.subreddit) + 1}
          total={data.totalCities}
          onClose={() => setSelected(null)}
        />
      )}
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

  return (
    <div className="omd-screen">
      <header className="omd-screen-head omd-world-head">
        <div>
          <div className="omd-screen-eyebrow">CROSS-SUB SURVEY · THE WORLD WATCHES</div>
          <h1 className="omd-screen-title">World of Cities</h1>
        </div>
        <button type="button" className="omd-iconbtn" onClick={load} aria-label="Rescan the world" title="Rescan">
          ↻
        </button>
      </header>
      <div className="omd-stack">
        {net.kind === 'loading' && (
          <div className="omd-world-scan">
            <div className="omd-boot-sun" aria-hidden="true" />
            <div className="omd-boot-sub">surveying the wasteland…</div>
          </div>
        )}
        {net.kind === 'error' && (
          <div className="omd-world-scan">
            <div style={{ fontSize: 30 }} aria-hidden="true">
              🛰️
            </div>
            <div className="omd-boot-sub">The survey link is down. {net.message}</div>
            <button type="button" className="omd-btn omd-btn--ghost" onClick={load}>
              Retry the scan
            </button>
          </div>
        )}
        {net.kind === 'ready' && <WorldBody data={net.data} />}
      </div>
    </div>
  );
}
