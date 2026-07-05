import type { ReactNode } from 'react';

export type PanelProps = {
  icon: string;
  title: string;
  sub?: string;
  span2?: boolean;
  danger?: boolean;
  children: ReactNode;
};

/** Parchment dashboard card with a Cinzel header. */
export function Panel({ icon, title, sub, span2, danger, children }: PanelProps) {
  const cls = [
    'omd-panel',
    span2 ? 'omd-span2' : '',
    danger ? 'omd-panel--danger' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <section className={cls}>
      <header className="omd-panel-head">
        <span className="omd-panel-icon">{icon}</span>
        <h2 className="omd-panel-title" style={{ margin: 0 }}>
          {title}
        </h2>
        {sub !== undefined && <span className="omd-panel-sub">{sub}</span>}
      </header>
      <div className="omd-panel-body">{children}</div>
    </section>
  );
}
