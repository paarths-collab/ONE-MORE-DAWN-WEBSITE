import type { CSSProperties, ReactNode } from 'react';
import type { InitResponse } from '../../shared/types';

// CITY SKY — the cinematic hero: a layered dusk skyline over the last city.
// Pure CSS (gradients + clip-paths, zero image assets): a dawn-orange →
// deep-indigo sky, twinkling stars, drifting haze, three parallax silhouette
// rows of a ruined city, flickering amber windows, chimney smoke and one
// pulsing watchtower beacon. State-reactive per the locked spec:
//   threat ≥ 70  → red glow creeps over the horizon
//   power  < 25  → the windows go dark
//   raid tonight → pulsing alarm wash + urgent beacon
//   morale       → saturation/warmth of the whole scene

type SkyShape = 'ruin' | 'ruinb' | 'slant' | 'spire';

type SkyBld = {
  /** relative width (flex-grow) */
  w: number;
  /** height as % of the scene */
  h: number;
  shape?: SkyShape;
  /** lit windows, [left%, top%] within the building (near row only) */
  win?: readonly (readonly [number, number])[];
  beacon?: boolean;
  smoke?: boolean;
};

// Distant ridge — hazy, bluish, almost part of the sky.
const FAR_ROW: readonly SkyBld[] = [
  { w: 1.2, h: 38 },
  { w: 0.8, h: 52, shape: 'spire' },
  { w: 1.4, h: 32 },
  { w: 1.0, h: 58 },
  { w: 1.3, h: 42, shape: 'slant' },
  { w: 0.7, h: 62 },
  { w: 1.5, h: 36 },
  { w: 0.9, h: 48, shape: 'ruin' },
  { w: 1.1, h: 40 },
];

// Middle band — broken rooflines start reading as ruins.
const MID_ROW: readonly SkyBld[] = [
  { w: 1.0, h: 34, shape: 'slant' },
  { w: 1.3, h: 24 },
  { w: 0.8, h: 44, shape: 'ruin' },
  { w: 1.2, h: 28 },
  { w: 0.9, h: 48, shape: 'spire' },
  { w: 1.4, h: 22 },
  { w: 1.0, h: 38, shape: 'ruinb' },
  { w: 1.2, h: 30 },
];

// Foreground — near-black silhouettes with the lit windows and the beacon.
const NEAR_ROW: readonly SkyBld[] = [
  { w: 1.1, h: 26, win: [[25, 28], [62, 48], [40, 72]] },
  { w: 0.8, h: 42, shape: 'spire', win: [[30, 20], [64, 34], [34, 54], [60, 74]], beacon: true },
  { w: 1.3, h: 18, win: [[22, 38], [52, 62]], smoke: true },
  { w: 0.9, h: 34, shape: 'ruin', win: [[42, 56], [66, 76]] },
  { w: 1.2, h: 22, win: [[30, 42], [70, 66]] },
  { w: 1.0, h: 38, shape: 'slant', win: [[36, 30], [62, 55], [30, 76]] },
  { w: 1.2, h: 16, win: [[46, 52]], smoke: true },
];

function Bld({ b, lit }: { b: SkyBld; lit: boolean }) {
  const cls = ['omd-sky-bld', b.shape !== undefined ? `omd-sky-bld--${b.shape}` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <i className={cls} style={{ flexGrow: b.w, height: `${b.h}%` }}>
      {lit &&
        b.win?.map(([x, y], i) => (
          <b
            key={i}
            className="omd-sky-win"
            style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${(i * 1.1 + x * 0.035).toFixed(2)}s` }}
          />
        ))}
      {b.beacon === true && <b className="omd-sky-beacon" />}
      {b.smoke === true && (
        <b className="omd-sky-smokes">
          <b className="omd-sky-smoke" />
          <b className="omd-sky-smoke omd-sky-smoke--2" />
        </b>
      )}
    </i>
  );
}

export type CitySkyProps = {
  data: InitResponse;
  /** Overlay content (the standing bar) rendered on top of the scene. */
  children?: ReactNode;
};

export function CitySky({ data, children }: CitySkyProps) {
  const { city, raidInDays } = data;

  const lowPower = city.power < 25;
  const raidNow = raidInDays <= 0;
  const highThreat = city.threat >= 70;
  const alarm = highThreat || raidNow;

  // Threat paints the horizon red: creeping in from 45, near-full at raid.
  const threatGlow = raidNow
    ? 0.9
    : city.threat >= 45
      ? Math.min(0.75, ((city.threat - 45) / 55) * 0.9)
      : 0;

  // Morale tunes the whole scene: gray and tired vs. warm and hopeful.
  const worldStyle: CSSProperties | undefined =
    city.morale < 30
      ? { filter: 'saturate(0.6) brightness(0.92)' }
      : city.morale >= 70
        ? { filter: 'saturate(1.15) brightness(1.04)' }
        : undefined;

  const cls = [
    'omd-sky',
    lowPower ? 'omd-sky--dark' : '',
    alarm ? 'omd-sky--alarm' : '',
    raidNow ? 'omd-sky--raid' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={cls} aria-label="The last city at dusk">
      <div className="omd-sky-world" aria-hidden="true" {...(worldStyle !== undefined ? { style: worldStyle } : {})}>
        <div className="omd-sky-stars" />
        <div className="omd-sky-stars omd-sky-stars--2" />
        <div className="omd-sky-glow" />
        <div className="omd-sky-threat" style={{ opacity: threatGlow }} />
        <div className="omd-sky-haze omd-sky-haze--1" />
        <div className="omd-sky-haze omd-sky-haze--2" />
        <div className="omd-sky-row omd-sky-row--far">
          {FAR_ROW.map((b, i) => (
            <Bld key={i} b={b} lit={false} />
          ))}
        </div>
        <div className="omd-sky-row omd-sky-row--mid">
          {MID_ROW.map((b, i) => (
            <Bld key={i} b={b} lit={false} />
          ))}
        </div>
        <div className="omd-sky-row omd-sky-row--near">
          {NEAR_ROW.map((b, i) => (
            <Bld key={i} b={b} lit={true} />
          ))}
        </div>
        <div className="omd-sky-ground" />
        {raidNow && <div className="omd-sky-alarm" />}
        <div className="omd-sky-fade" />
      </div>
      {children}
    </section>
  );
}
