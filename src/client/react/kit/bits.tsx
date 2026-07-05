import type { ReactNode } from 'react';

// Small display atoms: resource pill, chip, energy dots.

export type Trend = 'up-good' | 'up-bad' | 'down-good' | 'down-bad' | 'flat' | 'none';

const trendArrow = (t: Trend): string => {
  if (t === 'up-good' || t === 'up-bad') return '↑';
  if (t === 'down-good' || t === 'down-bad') return '↓';
  if (t === 'flat') return '→';
  return '';
};

const trendTone = (t: Trend): string => {
  if (t === 'up-good' || t === 'down-good') return 'tone-good';
  if (t === 'up-bad' || t === 'down-bad') return 'tone-danger';
  return 'tone-muted';
};

export type PillProps = {
  icon: string;
  label: string;
  value: number;
  trend?: Trend;
  tone?: 'good' | 'warn' | 'danger' | 'muted' | 'ink';
};

/** Rounded resource pill: icon + mono value + trend arrow. */
export function Pill({ icon, label, value, trend = 'none', tone = 'ink' }: PillProps) {
  return (
    <div className="omd-pill" title={label}>
      <span className="omd-pill-icon">{icon}</span>
      <span className={`omd-pill-val tone-${tone}`}>{value}</span>
      {trend !== 'none' && (
        <span className={`omd-pill-trend ${trendTone(trend)}`}>{trendArrow(trend)}</span>
      )}
      <span className="omd-pill-label">{label}</span>
    </div>
  );
}

export type ChipProps = { icon: string; children: ReactNode };

/** Neutral rounded chip for the alert strip (law, trait, faction). */
export function Chip({ icon, children }: ChipProps) {
  return (
    <span className="omd-chip">
      <span>{icon}</span>
      {children}
    </span>
  );
}

export type DotsProps = { total: number; filled: number };

/** Energy dots: warm-filled up to `filled`, hollow after. */
export function Dots({ total, filled }: DotsProps) {
  const dots: ReactNode[] = [];
  for (let i = 0; i < total; i++) {
    dots.push(<span key={i} className={i < filled ? 'omd-dot omd-dot--on' : 'omd-dot'} />);
  }
  return <span className="omd-dots">{dots}</span>;
}

export type EnergyBadgeProps = { total: number; filled: number };

/** Boxed ENERGY n/m readout used in the role and actions panels. */
export function EnergyBadge({ total, filled }: EnergyBadgeProps) {
  return (
    <span className="omd-energy">
      <Dots total={total} filled={filled} />
      <span className="omd-energy-label">
        ENERGY {filled}/{total}
      </span>
    </span>
  );
}
