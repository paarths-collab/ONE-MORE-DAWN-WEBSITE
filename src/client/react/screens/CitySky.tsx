import type { InitResponse } from '../../../shared/types';

// CITY SKY — a living pixel skyline that reflects the city's state at a glance.
// The mood (derived from morale / threat / raid) drives the sky gradient, the
// celestial body, window lights, smoke, and a raid glow. This is the main
// "it's a place, not a dashboard" anchor on the Home screen.

export type CityMood = 'thriving' | 'holding' | 'strained' | 'raid' | 'fallen';

/** Collapse city vitals into one of five visual moods. */
export function cityMood(data: InitResponse): CityMood {
  if (data.city.status === 'fallen') return 'fallen';
  if (data.raidInDays <= 1) return 'raid';
  const { morale, threat } = data.city;
  if (morale < 40 || threat > 66) return 'strained';
  if (morale >= 65 && threat < 40) return 'thriving';
  return 'holding';
}

type MoodSkin = {
  sky: [string, string];
  body: string;
  window: string | null; // lit-window color, null = dark/dead city
  glow: string | null; // raid glow behind the skyline
  smoke: number; // 0 none, 1 a plume, 2 heavy
  orb: { fill: string; glow: string } | null; // sun / blood moon
  label: string;
  tint: string; // accent used for the caption
};

const SKINS: Record<CityMood, MoodSkin> = {
  thriving: {
    sky: ['#f6d9a4', '#e79f45'],
    body: '#3b302a',
    window: '#ffd97a',
    glow: null,
    smoke: 0,
    orb: { fill: '#fff0c2', glow: '#ffd27a' },
    label: 'The city is thriving',
    tint: 'var(--green)',
  },
  holding: {
    sky: ['#dcb488', '#b3743a'],
    body: '#352b25',
    window: '#f2c766',
    glow: null,
    smoke: 1,
    orb: { fill: '#ffe6ad', glow: '#e8a24a' },
    label: 'Holding the line',
    tint: 'var(--gold)',
  },
  strained: {
    sky: ['#c07a4a', '#5f3826'],
    body: '#2b221c',
    window: '#e8a24a',
    glow: null,
    smoke: 2,
    orb: { fill: '#e8b071', glow: '#b5602a' },
    label: 'Strained — rationing the light',
    tint: 'var(--orange)',
  },
  raid: {
    sky: ['#7c2b20', '#2e1210'],
    body: '#241615',
    window: '#ff7a4a',
    glow: '#ff4a33',
    smoke: 2,
    orb: { fill: '#d94a3a', glow: '#ff3a25' },
    label: 'Under raid — the wall decides tonight',
    tint: 'var(--red)',
  },
  fallen: {
    sky: ['#2c2723', '#141110'],
    body: '#1c1815',
    window: null,
    glow: null,
    smoke: 1,
    orb: null,
    label: 'The city has fallen',
    tint: 'var(--mut)',
  },
};

// Fixed silhouette: [x, width, height]. Baseline ground at y=84.
const BUILDINGS: readonly [number, number, number][] = [
  [6, 26, 36], [38, 20, 54], [64, 30, 28], [100, 22, 46], [128, 34, 62],
  [168, 24, 40], [198, 30, 50], [234, 20, 32], [260, 34, 44], [300, 18, 52],
];
const GROUND = 84;

// Windows as fixed positions per building index (keeps it deterministic + crisp).
const WINDOWS: Record<number, [number, number][]> = {
  1: [[44, 40], [50, 40], [44, 48], [50, 48]],
  4: [[135, 32], [143, 32], [151, 32], [135, 44], [143, 44], [151, 44], [135, 56], [151, 56]],
  6: [[204, 44], [212, 44], [204, 54], [218, 54]],
  8: [[266, 48], [274, 48], [282, 48], [266, 60]],
  9: [[304, 46], [304, 56]],
};

export function CitySky({ mood }: { mood: CityMood }) {
  const s = SKINS[mood];
  const gid = `sky-${mood}`;
  return (
    <div className={`pxl-sky pxl-sky--${mood}`}>
      <svg viewBox="0 0 320 96" preserveAspectRatio="xMidYMax slice" shapeRendering="crispEdges" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={s.sky[0]} />
            <stop offset="1" stopColor={s.sky[1]} />
          </linearGradient>
        </defs>
        <rect width="320" height="96" fill={`url(#${gid})`} />
        {s.glow && <ellipse className="pxl-sky-glow" cx="160" cy="86" rx="150" ry="34" fill={s.glow} opacity="0.5" />}
        {s.orb && (
          <g className="pxl-sky-orb">
            <circle cx="256" cy="26" r="18" fill={s.orb.glow} opacity="0.35" />
            <circle cx="256" cy="26" r="11" fill={s.orb.fill} />
          </g>
        )}
        {/* smoke plumes */}
        {s.smoke > 0 && (
          <g className="pxl-sky-smoke" fill="#0000004d">
            <ellipse cx="146" cy="18" rx="7" ry="5" />
            <ellipse cx="150" cy="10" rx="5" ry="4" />
            {s.smoke > 1 && <><ellipse cx="210" cy="26" rx="6" ry="4" /><ellipse cx="214" cy="18" rx="4" ry="3" /></>}
          </g>
        )}
        {/* skyline */}
        {BUILDINGS.map(([x, w, h], i) => (
          <rect key={i} x={x} y={GROUND - h} width={w} height={h} fill={s.body} />
        ))}
        {/* fallen city: knock a notch out of the tall tower */}
        {mood === 'fallen' && <polygon points="128,22 145,22 145,34 138,28 132,34" fill={s.sky[1]} />}
        {/* lit windows */}
        {s.window &&
          Object.entries(WINDOWS).flatMap(([, cells]) =>
            cells.map(([x, y], j) => <rect key={`${x}-${y}-${j}`} x={x} y={y} width="4" height="5" fill={s.window!} />),
          )}
        <rect x="0" y={GROUND} width="320" height={96 - GROUND} fill="#0d0a09" />
      </svg>
      <div className="pxl-sky-cap" style={{ color: s.tint }}>
        {s.label}
      </div>
    </div>
  );
}
