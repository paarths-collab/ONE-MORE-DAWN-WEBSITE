export type Tab = 'home' | 'crisis' | 'feed' | 'you';

type TabDef = { id: Tab; icon: string; label: string };

const TABS: readonly TabDef[] = [
  { id: 'home', icon: '🏙️', label: 'Home' },
  { id: 'crisis', icon: '⚔️', label: 'Crisis' },
  { id: 'feed', icon: '📜', label: 'Feed' },
  { id: 'you', icon: '👤', label: 'You' },
];

export type TabBarProps = {
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** Red dot on CRISIS while today's vote is still open for you. */
  crisisPending: boolean;
};

/** Bottom tab bar — instant React-state switching, no reloads. */
export function TabBar({ tab, onTab, crisisPending }: TabBarProps) {
  return (
    <nav className="omd-tabbar" aria-label="Game sections">
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            className={active ? 'omd-tab omd-tab--active' : 'omd-tab'}
            onClick={() => onTab(t.id)}
            aria-current={active ? 'page' : undefined}
          >
            <span className="omd-tab-icon" aria-hidden="true">
              {t.icon}
              {t.id === 'crisis' && crisisPending && <span className="omd-tab-dot" />}
            </span>
            <span className="omd-tab-label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
