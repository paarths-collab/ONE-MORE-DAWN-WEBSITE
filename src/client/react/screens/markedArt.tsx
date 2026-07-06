import type { Marked } from '../../../shared/types';
import { SKINS, HAIRS, OUTFITS } from '../../../shared/avatar';

// MARKED PORTRAIT — procedural pixel art for the daily objective, so The Marked
// reads as a *someone/somewhere* worth saving, not a text row. Distinct art per
// kind (person / place / symbol), varied deterministically by the Marked id, and
// framed with an urgency glow that greens as the city closes on the goal. Pure
// SVG (no assets) so it's crisp and CSP-safe.

const fnv = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const pick = <T,>(arr: readonly T[], n: number): T => arr[n % arr.length]!;

/** Frame tint: red when far, amber mid, green as the goal nears. */
const urgency = (pct: number): string => (pct >= 80 ? '#57c06a' : pct >= 45 ? '#e8c34a' : '#c85040');

function PersonArt({ h }: { h: number }) {
  const skin = pick(SKINS, h >> 2);
  const hair = pick(HAIRS, h >> 6);
  const coat = pick(OUTFITS, h >> 10);
  return (
    <>
      {/* shoulders */}
      <rect x="4" y="17" width="16" height="7" rx="2" fill={coat} />
      {/* neck + head */}
      <rect x="10" y="13" width="4" height="3" fill={skin} />
      <rect x="7.5" y="5.5" width="9" height="9" rx="3" fill={skin} />
      {/* hair sweep */}
      <rect x="7" y="4.5" width="10" height="3.2" rx="1.4" fill={hair} />
      <rect x="7" y="6.5" width="2.4" height="2.6" fill={hair} />
      {/* eyes */}
      <rect x="9.4" y="9" width="1.5" height="1.7" rx="0.4" fill="#20170f" />
      <rect x="13" y="9" width="1.5" height="1.7" rx="0.4" fill="#20170f" />
      {/* a small candle held at the shoulder — the vigil */}
      <rect x="15.6" y="15" width="1.6" height="4" fill="#e7dcc4" />
      <rect x="15.9" y="12.6" width="1" height="2.4" rx="0.5" fill="#ffcf70">
        <animate attributeName="opacity" values="1;0.55;1" dur="1.3s" repeatCount="indefinite" />
      </rect>
    </>
  );
}

function PlaceArt({ h }: { h: number }) {
  const stone = pick(['#6b5f52', '#5a5348', '#736354'], h >> 4);
  const flag = pick(OUTFITS, h >> 9);
  return (
    <>
      {/* battlement wall */}
      <rect x="3" y="12" width="18" height="10" fill={stone} />
      <rect x="3" y="10" width="3" height="3" fill={stone} />
      <rect x="8" y="10" width="3" height="3" fill={stone} />
      <rect x="13" y="10" width="3" height="3" fill={stone} />
      <rect x="18" y="10" width="3" height="3" fill={stone} />
      {/* seams */}
      <rect x="3" y="16" width="18" height="0.7" fill="#00000030" />
      <rect x="11" y="12" width="0.7" height="10" fill="#00000030" />
      {/* gate */}
      <rect x="9.5" y="16" width="5" height="6" rx="2.5" fill="#241a12" />
      {/* watch banner */}
      <rect x="16.4" y="3" width="0.9" height="8" fill="#3a2f26" />
      <rect x="12.6" y="3" width="4" height="3" fill={flag}>
        <animate attributeName="width" values="4;3.4;4" dur="1.6s" repeatCount="indefinite" />
      </rect>
    </>
  );
}

function SymbolArt({ h }: { h: number }) {
  const bowl = pick(['#7a4a2b', '#6b5f52', '#8a5a2b'], h >> 5);
  return (
    <>
      {/* brazier bowl + stand */}
      <rect x="7" y="16" width="10" height="3" rx="1.4" fill={bowl} />
      <rect x="10.4" y="19" width="3.2" height="4" fill={bowl} />
      <rect x="8" y="21.5" width="8" height="1.6" rx="0.8" fill={bowl} />
      {/* flame — the beacon that must not go out */}
      <g>
        <rect x="10.4" y="9" width="3.2" height="7" rx="1.6" fill="#e8712e" />
        <rect x="11" y="6.5" width="2" height="6" rx="1" fill="#ffcf70" />
        <rect x="11.4" y="5" width="1.2" height="4" rx="0.6" fill="#fff2c9">
          <animate attributeName="height" values="4;5.6;4" dur="0.9s" repeatCount="indefinite" />
          <animate attributeName="y" values="5;3.8;5" dur="0.9s" repeatCount="indefinite" />
        </rect>
      </g>
    </>
  );
}

/** The framed portrait tile shown in the Marked card. */
export function MarkedPortrait({ marked, pct, size = 72 }: { marked: Marked; pct: number; size?: number }) {
  const h = fnv(marked.id);
  const ring = urgency(pct);
  const sky = pick(
    [
      ['#2a2036', '#171019'],
      ['#31241c', '#191012'],
      ['#22303a', '#101820'],
    ] as const,
    h,
  );
  const gid = `mk-${marked.id.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <div
      className="pxl-marked-art"
      style={{ width: size, height: size, borderColor: ring, boxShadow: `0 0 14px -2px ${ring}66` }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width="100%" height="100%" shapeRendering="crispEdges" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={sky[0]} />
            <stop offset="1" stopColor={sky[1]} />
          </linearGradient>
        </defs>
        <rect width="24" height="24" fill={`url(#${gid})`} />
        {marked.kind === 'person' && <PersonArt h={h} />}
        {marked.kind === 'place' && <PlaceArt h={h} />}
        {marked.kind === 'symbol' && <SymbolArt h={h} />}
      </svg>
    </div>
  );
}
