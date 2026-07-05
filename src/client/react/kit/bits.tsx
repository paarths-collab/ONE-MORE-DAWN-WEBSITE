import type { ReactNode } from 'react';

// Small display atoms: chip, energy dots, section header.

export type ChipProps = { icon: string; children: ReactNode; tone?: 'default' | 'accent' | 'danger' };

/** Rounded status chip (streak, rank, faction, injuries…). */
export function Chip({ icon, children, tone = 'default' }: ChipProps) {
  return (
    <span className={`omd-chip omd-chip--${tone}`}>
      <span className="omd-chip-icon">{icon}</span>
      {children}
    </span>
  );
}

export type DotsProps = { total: number; filled: number };

/** Energy dots: amber-filled up to `filled`, hollow after. */
export function Dots({ total, filled }: DotsProps) {
  const dots: ReactNode[] = [];
  for (let i = 0; i < total; i++) {
    dots.push(<span key={i} className={i < filled ? 'omd-dot omd-dot--on' : 'omd-dot'} />);
  }
  return <span className="omd-dots">{dots}</span>;
}

export type EnergyBadgeProps = { total: number; filled: number };

/** Boxed ENERGY n/m readout. */
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

export type SectionHeadProps = { icon: string; title: string; sub?: string; action?: ReactNode };

/** Card section header: icon + letterspaced title + right-aligned sub/action. */
export function SectionHead({ icon, title, sub, action }: SectionHeadProps) {
  return (
    <header className="omd-card-head">
      <span className="omd-card-icon" aria-hidden="true">
        {icon}
      </span>
      <h2 className="omd-card-title">{title}</h2>
      {sub !== undefined && <span className="omd-card-sub">{sub}</span>}
      {action !== undefined && <span className="omd-card-action">{action}</span>}
    </header>
  );
}
