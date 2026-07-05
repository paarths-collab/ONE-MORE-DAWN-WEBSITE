import type { ReactNode } from 'react';

// Meter bars (city vitals) and labeled tally bars (council plans, factions).

export type MeterTone = 'good' | 'warn' | 'danger';

export type MeterBarProps = {
  icon: string;
  label: string;
  value: number;
  max: number;
  tone: MeterTone;
  /** "Tomorrow if nobody acts" target — rendered as a ghost tick + delta. */
  forecast?: number;
};

const pct = (value: number, max: number): number =>
  Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));

export function MeterBar({ icon, label, value, max, tone, forecast }: MeterBarProps) {
  const fillPct = pct(value, max);
  const delta = forecast === undefined ? null : forecast - value;
  return (
    <div className="omd-meter">
      <span className="omd-meter-label">
        <span>{icon}</span>
        {label}
      </span>
      <span className="omd-meter-track">
        <span
          className="omd-meter-fill"
          style={{ width: `${fillPct}%`, background: `var(--${tone})` }}
        />
        {forecast !== undefined && (
          <span
            className="omd-meter-ghost"
            style={{ left: `calc(${pct(forecast, max)}% - 1px)` }}
            title={`Tomorrow if nobody acts: ${forecast}`}
          />
        )}
      </span>
      <span className={`omd-meter-num tone-${tone}`}>
        {value}
        {delta !== null && delta !== 0 && (
          <small>
            {' '}
            {delta > 0 ? '+' : '−'}
            {Math.abs(delta)}
          </small>
        )}
      </span>
    </div>
  );
}

export type BarProps = {
  icon: string;
  title: ReactNode;
  /** 0..100 fill width */
  pct: number;
  fill: string;
  value: ReactNode;
  mine?: boolean;
  onClick?: () => void;
  disabled?: boolean;
};

/** Clickable (or static) labeled tally bar row. */
export function Bar({ icon, title, pct: width, fill, value, mine, onClick, disabled }: BarProps) {
  const cls = [
    'omd-bar',
    onClick === undefined ? 'omd-bar--static' : '',
    mine ? 'omd-bar--mine' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const inner = (
    <>
      <span className="omd-bar-row">
        <span className="omd-bar-icon">{icon}</span>
        <span className="omd-bar-title">{title}</span>
        <span className="omd-bar-val">{value}</span>
      </span>
      <span className="omd-bar-track">
        <span
          className="omd-bar-fill"
          style={{ width: `${Math.max(0, Math.min(100, width))}%`, background: fill }}
        />
      </span>
    </>
  );
  if (onClick === undefined) {
    return <div className={cls}>{inner}</div>;
  }
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled === true}>
      {inner}
    </button>
  );
}
