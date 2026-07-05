import { useCallback, useEffect, useState } from 'react';
import type { ActionType, InitResponse, MissionRoute, Role, StrategyPlanId } from '../../shared/types';
import { api } from '../game/api';
import './omd.css';
import { Dashboard } from './Dashboard';
import { ACTION_DEFS, ROLE_DEFS } from './defs';
import type { Handlers } from './handlers';
import { ToastLayer, useToasts } from './kit/Toast';
import { DawnReportModal, FallenCity } from './panels/moments';
import { RoleGate } from './panels/role';

// One More Dawn — dashboard-only React client. One rich command-center screen
// wired to the live backend (src/client/game/api.ts). Design source:
// docs/design/One More Dawn UI.dc.html (warm board-game HUD, 3 themes).

type Net =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: InitResponse };

type Theme = 'warm' | 'arctic' | 'clean';
const THEME_ORDER: readonly Theme[] = ['warm', 'arctic', 'clean'];
const THEME_LABEL: Record<Theme, string> = {
  warm: 'Field Report',
  arctic: 'Arctic Frost',
  clean: 'Clean Neutral',
};

const readTheme = (): Theme => {
  try {
    const t = window.localStorage.getItem('omd-theme');
    return t === 'arctic' || t === 'clean' ? t : 'warm';
  } catch {
    return 'warm';
  }
};

export function App() {
  const [net, setNet] = useState<Net>({ kind: 'loading' });
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [dawnSeen, setDawnSeen] = useState(false);
  const { toasts, push } = useToasts();

  // ---- data plumbing ----

  const load = useCallback((first: boolean) => {
    api
      .init()
      .then((data) => setNet({ kind: 'ready', data }))
      .catch((err: Error) => {
        if (first) setNet({ kind: 'error', message: err.message });
      });
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  const refresh = useCallback(() => {
    load(false);
  }, [load]);

  /** Apply an optimistic/reconciling patch to the ready state. */
  const patch = useCallback((fn: (d: InitResponse) => InitResponse) => {
    setNet((n) => (n.kind === 'ready' ? { kind: 'ready', data: fn(n.data) } : n));
  }, []);

  const cycleTheme = useCallback(() => {
    setTheme((t) => {
      const next = THEME_ORDER[(THEME_ORDER.indexOf(t) + 1) % THEME_ORDER.length] ?? 'warm';
      try {
        window.localStorage.setItem('omd-theme', next);
      } catch {
        // storage unavailable in some webviews — theme just won't persist
      }
      push(`🎨 Theme · ${THEME_LABEL[next]}`);
      return next;
    });
  }, [push]);

  // ---- mutations (optimistic + reconcile with server response) ----

  const onVote = useCallback(
    (optionId: string) => {
      patch((d) => ({
        ...d,
        yourCrisisVote: optionId,
        crisisVotes: { ...d.crisisVotes, [optionId]: (d.crisisVotes[optionId] ?? 0) + 1 },
      }));
      push('🗳️ Vote cast — the city shifts');
      api
        .vote(optionId)
        .then((r) =>
          patch((d) => ({ ...d, crisisVotes: r.crisisVotes, yourCrisisVote: r.yourCrisisVote })),
        )
        .catch((err: Error) => {
          push(`⚠️ ${err.message}`);
          refresh();
        });
    },
    [patch, push, refresh],
  );

  const onStrategy = useCallback(
    (planId: StrategyPlanId) => {
      patch((d) => {
        const votes = { ...d.strategyVotes };
        const prev = d.yourStrategyVote;
        if (prev === planId) return d;
        if (prev !== null) votes[prev] = Math.max(0, (votes[prev] ?? 1) - 1);
        votes[planId] = (votes[planId] ?? 0) + 1;
        return { ...d, strategyVotes: votes, yourStrategyVote: planId };
      });
      push('🏛️ You backed the plan');
      api
        .strategy(planId)
        .then((r) =>
          patch((d) => ({
            ...d,
            strategyVotes: r.strategyVotes,
            yourStrategyVote: r.yourStrategyVote,
          })),
        )
        .catch((err: Error) => {
          push(`⚠️ ${err.message}`);
          refresh();
        });
    },
    [patch, push, refresh],
  );

  const onAction = useCallback(
    (action: ActionType) => {
      const def = ACTION_DEFS.find((a) => a.id === action);
      patch((d) => ({
        ...d,
        player: { ...d.player, energyUsedToday: d.player.energyUsedToday + 1 },
        yourActionsToday: {
          ...d.yourActionsToday,
          [action]: (d.yourActionsToday[action] ?? 0) + 1,
        },
      }));
      push(def?.toast ?? '⚡ Action taken');
      api
        .takeAction(action)
        .then((r) => {
          patch((d) => ({
            ...d,
            player: r.player,
            effectiveEnergy: r.effectiveEnergy,
            yourActionsToday: r.yourActionsToday,
          }));
          if (r.unlockedTitle !== null) push(`🎖️ Title unlocked — ${r.unlockedTitle}`);
        })
        .catch((err: Error) => {
          push(`⚠️ ${err.message}`);
          refresh();
        });
    },
    [patch, push, refresh],
  );

  const onRole = useCallback(
    (role: Role) => {
      api
        .chooseRole(role)
        .then((r) => {
          patch((d) => ({ ...d, player: r.player }));
          push(`${ROLE_DEFS[role].icon} You are the ${ROLE_DEFS[role].name} now`);
        })
        .catch((err: Error) => push(`⚠️ ${err.message}`));
    },
    [patch, push],
  );

  const onMission = useCallback(
    (route: MissionRoute) => {
      patch((d) => ({ ...d, missionUsedToday: true }));
      push('🎒 Expedition launched — the team returns at dawn');
      api
        .missionStart(route)
        .then((r) => patch((d) => ({ ...d, player: r.player, effectiveEnergy: r.effectiveEnergy })))
        .catch((err: Error) => {
          push(`⚠️ ${err.message}`);
          refresh();
        });
    },
    [patch, push, refresh],
  );

  const handlers: Handlers = { onVote, onStrategy, onAction, onRole, onMission };

  // ---- render ----

  if (net.kind === 'loading') {
    return (
      <div className="omd-root" data-theme={theme}>
        <div className="omd-boot">
          <div style={{ fontSize: 36 }}>🌅</div>
          <div className="omd-boot-title">ONE MORE DAWN</div>
          <div>Waking the city…</div>
        </div>
      </div>
    );
  }

  if (net.kind === 'error') {
    return (
      <div className="omd-root" data-theme={theme}>
        <div className="omd-boot omd-boot--err">
          <div style={{ fontSize: 36 }}>🕯️</div>
          <div className="omd-boot-title">SIGNAL LOST</div>
          <div>Could not reach the city. {net.message}</div>
        </div>
      </div>
    );
  }

  const { data } = net;

  if (data.city.status === 'fallen') {
    return (
      <div className="omd-root" data-theme={theme}>
        <FallenCity data={data} />
        <ToastLayer toasts={toasts} />
      </div>
    );
  }

  if (data.player.role === null) {
    return (
      <div className="omd-root" data-theme={theme}>
        <RoleGate handlers={handlers} />
        <ToastLayer toasts={toasts} />
      </div>
    );
  }

  const showDawn = data.firstVisitToday && data.dawnReport !== null && !dawnSeen;

  return (
    <div className="omd-root" data-theme={theme}>
      <Dashboard data={data} handlers={handlers} onTheme={cycleTheme} onRefresh={refresh} />
      {showDawn && data.dawnReport !== null && (
        <DawnReportModal report={data.dawnReport} onDismiss={() => setDawnSeen(true)} />
      )}
      <ToastLayer toasts={toasts} />
    </div>
  );
}
