import { useMemo } from 'react';
import type { WorldCity } from '../../shared/types';
import { WORLD_STATUS_DEFS } from './defs';

// WORLD MAP — a PUBG-style tactical survey of the post-collapse region.
// Pure CSS/SVG, zero image assets: dark wasteland terrain, topo contour
// blobs, a western coastline with shore hatching, a drowned lake, an old
// highway, a red "dead zone", a faint sector grid with A–D / 1–4 coordinates,
// edge fog and a slow radar sweep. Every subreddit-city is a status-lit blip
// placed deterministically from a hash of its name (see layoutWorld), so the
// world never rearranges between refetches.

// ---------- deterministic layout ----------

/** Keep-out border so nodes never kiss the map frame. */
const MARGIN = 0.09;

/** FNV-1a 32-bit — a node's home coordinates are a pure function of its name. */
const fnv1a = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

export type MapPoint = { x: number; y: number };

/**
 * Hash-seeded scatter + deterministic pairwise repulsion.
 *
 * 1. Each name hashes to a seed point (low 16 bits → x, high 16 → y).
 * 2. 40 relaxation passes push any pair closer than `minDist` apart —
 *    iteration order is the sorted name list, so the same city set always
 *    produces the same layout (stable across refetches; a new city only
 *    nudges its neighbours).
 * 3. `minDist` shrinks with √n, so 1–50 cities all stay readable.
 * 4. Tiny worlds (< 5 cities) get a mild pull to centre stage so a lone
 *    city doesn't hug an edge.
 */
export const layoutWorld = (names: readonly string[]): Map<string, MapPoint> => {
  const sorted = [...names].sort();
  const pts = sorted.map((name) => {
    const h = fnv1a(name);
    return {
      name,
      x: MARGIN + ((h & 0xffff) / 0xffff) * (1 - 2 * MARGIN),
      y: MARGIN + (((h >>> 16) & 0xffff) / 0xffff) * (1 - 2 * MARGIN),
    };
  });
  const minDist = Math.min(0.3, Math.max(0.11, 0.68 / Math.sqrt(Math.max(1, pts.length))));
  for (let pass = 0; pass < 40; pass++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]!;
        const b = pts[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minDist) continue;
        if (d < 1e-6) {
          // identical seed points: split along a hash-picked angle
          const ang = ((fnv1a(a.name + b.name) % 360) * Math.PI) / 180;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const push = (minDist - d) / (2 * d);
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
      }
    }
    for (const p of pts) {
      p.x = Math.min(1 - MARGIN, Math.max(MARGIN, p.x));
      p.y = Math.min(1 - MARGIN, Math.max(MARGIN, p.y));
    }
  }
  const pull = Math.max(0, 5 - pts.length) * 0.07;
  if (pull > 0) {
    for (const p of pts) {
      p.x += (0.5 - p.x) * pull;
      p.y += (0.46 - p.y) * pull;
    }
  }
  return new Map(pts.map((p) => [p.name, { x: p.x, y: p.y }]));
};

// ---------- terrain (static SVG, stretched to the map box) ----------

function Terrain() {
  return (
    <svg
      className="omd-world-svg"
      viewBox="0 0 360 400"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <pattern id="omdWorldGrid" width="36" height="36" patternUnits="userSpaceOnUse">
          <path d="M36 0H0V36" fill="none" stroke="rgba(233,226,209,0.05)" strokeWidth="0.7" />
        </pattern>
      </defs>
      {/* the western sea */}
      <path
        d="M0 0 H84 C66 42 98 76 78 112 C58 150 94 182 72 220 C52 256 88 294 66 332 C52 360 76 386 62 400 H0 Z"
        fill="rgba(96,150,255,0.07)"
        stroke="rgba(127,179,255,0.28)"
        strokeWidth="1.3"
      />
      <path
        d="M84 0 C66 42 98 76 78 112 C58 150 94 182 72 220 C52 256 88 294 66 332 C52 360 76 386 62 400"
        fill="none"
        stroke="rgba(127,179,255,0.10)"
        strokeWidth="7"
        strokeDasharray="2 8"
      />
      {/* drowned lake, south-east */}
      <path
        d="M286 338 C300 326 330 330 340 344 C350 358 336 372 316 372 C296 372 274 350 286 338 Z"
        fill="rgba(96,150,255,0.07)"
        stroke="rgba(127,179,255,0.22)"
        strokeWidth="1"
      />
      {/* highland contours, north-east */}
      <path
        d="M200 64 C238 40 298 48 314 86 C330 124 300 158 252 162 C204 166 174 138 180 104 C184 82 186 73 200 64 Z"
        fill="none"
        stroke="rgba(233,226,209,0.06)"
        strokeWidth="1"
      />
      <path
        d="M216 78 C244 62 288 68 300 94 C312 120 290 142 254 145 C218 148 196 128 200 106 C203 92 206 84 216 78 Z"
        fill="none"
        stroke="rgba(233,226,209,0.08)"
        strokeWidth="1"
      />
      <path
        d="M232 92 C250 82 276 86 284 102 C292 118 278 130 256 131 C234 132 222 118 226 106 C228 99 227 95 232 92 Z"
        fill="none"
        stroke="rgba(233,226,209,0.11)"
        strokeWidth="1"
      />
      {/* highland contours, south-west */}
      <path
        d="M92 268 C120 240 186 244 202 278 C218 312 190 344 146 348 C102 352 70 322 78 294 C82 280 84 275 92 268 Z"
        fill="none"
        stroke="rgba(233,226,209,0.06)"
        strokeWidth="1"
      />
      <path
        d="M110 280 C130 262 176 264 188 288 C200 312 180 330 148 333 C116 336 96 312 102 294 C105 287 106 284 110 280 Z"
        fill="none"
        stroke="rgba(233,226,209,0.08)"
        strokeWidth="1"
      />
      <path
        d="M128 292 C140 282 164 284 171 298 C178 312 168 322 150 323 C132 324 120 306 128 292 Z"
        fill="none"
        stroke="rgba(233,226,209,0.11)"
        strokeWidth="1"
      />
      {/* the old highway + a dead spur */}
      <path
        d="M28 396 C96 330 148 268 196 196 C238 132 288 84 344 24"
        fill="none"
        stroke="rgba(233,226,209,0.07)"
        strokeWidth="2"
        strokeDasharray="7 6"
      />
      <path
        d="M0 236 C70 226 150 244 226 232 C282 224 330 236 360 228"
        fill="none"
        stroke="rgba(233,226,209,0.05)"
        strokeWidth="1.6"
        strokeDasharray="5 7"
      />
      {/* dead zone — do not enter */}
      <circle
        cx="300"
        cy="64"
        r="30"
        fill="rgba(255,91,77,0.05)"
        stroke="rgba(255,91,77,0.25)"
        strokeWidth="1.2"
        strokeDasharray="4 5"
      />
      <path d="M292 56 L308 72 M308 56 L292 72" stroke="rgba(255,91,77,0.35)" strokeWidth="1.2" />
      {/* sector grid on top of everything */}
      <rect x="0" y="0" width="360" height="400" fill="url(#omdWorldGrid)" />
    </svg>
  );
}

const COLS = ['A', 'B', 'C', 'D'] as const;
const ROWS = ['1', '2', '3', '4'] as const;

// ---------- nodes ----------

type MapNodeProps = {
  city: WorldCity;
  pt: MapPoint;
  selected: boolean;
  onSelect: () => void;
};

function MapNode({ city, pt, selected, onSelect }: MapNodeProps) {
  const def = WORLD_STATUS_DEFS[city.status];
  const fallen = city.status === 'fallen';
  const cls = [
    'omd-wnode',
    `omd-wnode--${city.status}`,
    city.isYou ? 'omd-wnode--me' : '',
    selected ? 'omd-wnode--sel' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      style={{ left: `${(pt.x * 100).toFixed(2)}%`, top: `${(pt.y * 100).toFixed(2)}%` }}
      onClick={onSelect}
      aria-label={`${city.subreddit}: ${def.label}, day ${city.day}, ${city.survivalDays} dawns survived${city.isYou ? ' — your city' : ''}`}
    >
      {city.isYou && <span className="omd-wnode-youtag">YOU</span>}
      <span className="omd-wnode-blip" aria-hidden="true">
        <span className="omd-wnode-ping" />
        {city.isYou && <span className="omd-wnode-mering" />}
        <span className="omd-wnode-core">{fallen ? '☠' : ''}</span>
      </span>
      <span className="omd-wnode-label">{city.subreddit.replace(/^r\//, '')}</span>
      <span className="omd-wnode-meta omd-mono">
        {fallen ? `FELL D${city.day}` : `DAY ${city.day} · ${city.survivalDays}d`}
      </span>
    </button>
  );
}

// ---------- the map ----------

export type WorldMapProps = {
  cities: readonly WorldCity[];
  /** subreddit of the currently peeked city, or null */
  selected: string | null;
  onSelect: (subreddit: string) => void;
};

export function WorldMap({ cities, selected, onSelect }: WorldMapProps) {
  const layout = useMemo(() => layoutWorld(cities.map((c) => c.subreddit)), [cities]);
  const n = cities.length;
  // the region grows taller as more cities join (page scroll handles it)
  const aspectH = Math.min(1.85, Math.max(1.04, 1.04 + Math.max(0, n - 14) * 0.024));
  const dense = n > 22;
  return (
    <section
      className={dense ? 'omd-world-map omd-world-map--dense' : 'omd-world-map'}
      style={{ aspectRatio: `1 / ${aspectH.toFixed(3)}` }}
      aria-label="World map of subreddit cities"
    >
      <Terrain />
      <div className="omd-world-sweep" aria-hidden="true" />
      {COLS.map((c, i) => (
        <span key={c} className="omd-world-coord" style={{ left: `${(i + 0.5) * 25}%`, top: 5 }} aria-hidden="true">
          {c}
        </span>
      ))}
      {ROWS.map((r, i) => (
        <span
          key={r}
          className="omd-world-coord omd-world-coord--row"
          style={{ top: `${(i + 0.5) * 25}%`, left: 7 }}
          aria-hidden="true"
        >
          {r}
        </span>
      ))}
      <div className="omd-world-fog" aria-hidden="true" />
      {cities.map((c) => {
        const pt = layout.get(c.subreddit);
        if (pt === undefined) return null;
        return (
          <MapNode
            key={c.subreddit}
            city={c}
            pt={pt}
            selected={selected === c.subreddit}
            onSelect={() => onSelect(c.subreddit)}
          />
        );
      })}
      <span className="omd-world-maptag omd-mono">
        WASTELAND SURVEY · {n} {n === 1 ? 'CITY' : 'CITIES'}
      </span>
      <span className="omd-world-compass omd-mono" aria-hidden="true">
        N ▲
      </span>
    </section>
  );
}
