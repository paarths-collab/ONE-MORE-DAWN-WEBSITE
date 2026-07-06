import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ActionType,
  InitResponse,
  MissionRoute,
  PledgeKind,
  Role,
  StrategyPlanId,
  VillageResponse,
} from '../../shared/types';
import { api } from '../game/api';
import './omd.css';
import { TabBar } from './TabBar';
import type { Tab } from './TabBar';
import {
  ACTION_DEFS,
  PLEDGE_OPTIMISTIC_BUMP,
  PLEDGE_VERBS,
  ROLE_DEFS,
  markedGoalWord,
  markedPct,
  markedShortName,
} from './defs';
import type { Handlers } from './handlers';
import { ToastLayer, useToasts } from './kit/Toast';
import { useFetch } from './kit/useFetch';
import { CrisisScreen } from './screens/CrisisScreen';
import { FeedScreen } from './screens/FeedScreen';
import { HomeScreen } from './screens/HomeScreen';
import { WorldScreen } from './screens/WorldScreen';
import { YouScreen } from './screens/YouScreen';
import { DawnReportModal, FallenCity, RoleGate } from './screens/moments';

// One More Dawn — mobile-first hook-layer client (locked direction,
// docs/superpowers/plans/2026-07-06-reddit-native-hook-layer.md).
// Five screens behind a bottom tab bar: HOME · CRISIS · FEED · WORLD · YOU.
// WORLD lazy-loads its own data (api.world) the first time the tab opens.

type Net =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: InitResponse };

export function App() {
  const [net, setNet] = useState<Net>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('home');
  const [dawnSeen, setDawnSeen] = useState(false);
  const { toasts, push } = useToasts();
  const village = useFetch<VillageResponse>(() => api.village());
  const subreddit = village.kind === 'ready' ? village.data.subreddit : null;

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

  /** Latest ready data, for handlers that need to read state before patching. */
  const dataRef = useRef<InitResponse | null>(null);
  useEffect(() => {
    dataRef.current = net.kind === 'ready' ? net.data : null;
  }, [net]);

  // ---- mutations (optimistic + reconcile with server response) ----

  const onPledge = useCallback(
    (kind: PledgeKind) => {
      const current = dataRef.current;
      patch((d) => ({
        ...d,
        marked: {
          ...d.marked,
          pledged: Math.min(d.marked.goal, d.marked.pledged + PLEDGE_OPTIMISTIC_BUMP),
        },
        pledge: {
          ...d.pledge,
          usedToday: true,
          ledger: { ...d.pledge.ledger, mine: d.pledge.ledger.mine + 1 },
        },
      }));
      if (current !== null) {
        const after = {
          ...current.marked,
          pledged: Math.min(current.marked.goal, current.marked.pledged + PLEDGE_OPTIMISTIC_BUMP),
        };
        push(
          `🕯️ ${PLEDGE_VERBS[kind]} — ${markedShortName(after)} is ${markedPct(after)}% ${markedGoalWord(after)}`,
        );
      } else {
        push('🕯️ Your pledge is counted');
      }
      api
        .pledge(kind)
        .then((r) => patch((d) => ({ ...d, marked: r.marked, pledge: r.pledge, player: r.player })))
        .catch((err: Error) => {
          push(`⚠️ ${err.message}`);
          refresh();
        });
    },
    [patch, push, refresh],
  );

  const onVote = useCallback(
    (optionId: string, crisisId: string) => {
      patch((d) => ({
        ...d,
        yourCrisisVote: optionId,
        crisisVotes: { ...d.crisisVotes, [optionId]: (d.crisisVotes[optionId] ?? 0) + 1 },
      }));
      push('🗳️ Vote cast — the city shifts');
      api
        .vote(optionId, crisisId)
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
      // One plan per day, no switching — the server 409s a re-vote, so never
      // optimistically move the vote. Ignore taps once a plan is already backed.
      let accepted = false;
      patch((d) => {
        if (d.yourStrategyVote !== null) return d;
        accepted = true;
        const votes = { ...d.strategyVotes };
        votes[planId] = (votes[planId] ?? 0) + 1;
        return { ...d, strategyVotes: votes, yourStrategyVote: planId };
      });
      if (!accepted) return;
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

  const handlers: Handlers = { onPledge, onVote, onStrategy, onAction, onRole, onMission };

  // ---- render ----

  const frame = (inner: ReactNode) => (
    <div className="omd-root">
      <div className="omd-phone">
        {inner}
        <ToastLayer toasts={toasts} />
      </div>
    </div>
  );

  if (net.kind === 'loading') {
    return frame(
      <div className="omd-boot">
        <div className="omd-boot-sun" aria-hidden="true" />
        <div className="omd-boot-title">One More Dawn</div>
        <div className="omd-boot-sub">waking the city…</div>
      </div>,
    );
  }

  if (net.kind === 'error') {
    return frame(
      <div className="omd-boot omd-boot--err">
        <div style={{ fontSize: 36 }}>🕯️</div>
        <div className="omd-boot-title">Signal Lost</div>
        <div className="omd-boot-sub">Could not reach the city. {net.message}</div>
      </div>,
    );
  }

  const { data } = net;

  if (data.city.status === 'fallen') {
    return frame(<FallenCity data={data} />);
  }

  if (data.player.role === null) {
    return frame(<RoleGate handlers={handlers} />);
  }

  const showDawn = data.firstVisitToday && data.dawnReport !== null && !dawnSeen;

  return frame(
    <>
      <div className="omd-view">
        {tab === 'home' && (
          <HomeScreen data={data} handlers={handlers} subreddit={subreddit} onRefresh={refresh} go={setTab} />
        )}
        {tab === 'crisis' && <CrisisScreen data={data} handlers={handlers} />}
        {tab === 'feed' && <FeedScreen data={data} />}
        {tab === 'world' && <WorldScreen />}
        {tab === 'you' && <YouScreen data={data} handlers={handlers} />}
      </div>
      <TabBar tab={tab} onTab={setTab} crisisPending={data.yourCrisisVote === null} />
      {showDawn && data.dawnReport !== null && (
        <DawnReportModal report={data.dawnReport} onDismiss={() => setDawnSeen(true)} />
      )}
    </>,
  );
}
