import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ActionType,
  AvatarConfig,
  InitResponse,
  MissionCompleteResponse,
  MissionRoute,
  MissionStartResponse,
  PledgeKind,
  Role,
  StrategyPlanId,
  VillageResponse,
} from '../../shared/types';
import { api } from '../game/api';
import './omd.css';
import './pixel.css';
import { MissionOverlay } from './mission/MissionOverlay';
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
import { Avatar, HomeScreen } from './screens/HomeScreen';
import { AvatarCreator, PixelAvatar } from './screens/avatarKit';
import { RulesScreen } from './screens/RulesScreen';
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
  const [selCit, setSelCit] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
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

  /**
   * A mutation failed. Roll the optimistic patch back to the snapshot captured
   * before it, THEN try to reconcile with the server. The rollback matters when
   * the reconciling refetch ALSO fails (same outage): load(false)'s catch is a
   * no-op, so without this the UI would keep claiming an action ("You've helped
   * today") the server never recorded. Restoring the snapshot first makes the
   * pre-mutation state the fallback truth.
   */
  const rollback = useCallback(
    (snapshot: InitResponse | null, err: Error) => {
      push(`⚠️ ${err.message}`);
      if (snapshot) setNet({ kind: 'ready', data: snapshot });
      refresh();
    },
    [push, refresh],
  );

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
        .catch((err: Error) => rollback(current, err));
    },
    [patch, push, rollback],
  );

  const onVote = useCallback(
    (optionId: string, crisisId: string) => {
      const snapshot = dataRef.current;
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
        .catch((err: Error) => rollback(snapshot, err));
    },
    [patch, push, rollback],
  );

  const onStrategy = useCallback(
    (planId: StrategyPlanId) => {
      // One plan per day, no switching — the server 409s a re-vote, so never
      // optimistically move the vote. Ignore taps once a plan is already backed.
      const snapshot = dataRef.current;
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
        .catch((err: Error) => rollback(snapshot, err));
    },
    [patch, push, rollback],
  );

  const onAction = useCallback(
    (action: ActionType) => {
      const snapshot = dataRef.current;
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
        .catch((err: Error) => rollback(snapshot, err));
    },
    [patch, push, rollback],
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

  const onAvatar = useCallback(
    (avatar: AvatarConfig) => {
      setSavingAvatar(true);
      api
        .saveAvatar(avatar)
        .then((r) => {
          patch((d) => ({ ...d, player: r.player }));
          setEditingAvatar(false);
          push(`☀️ Welcome, ${avatar.name}`);
        })
        .catch((err: Error) => push(`⚠️ ${err.message}`))
        .finally(() => setSavingAvatar(false));
    },
    [patch, push],
  );

  // Expedition mini-game session (RX5). Energy is spent server-side at START, so
  // we only open the game once /mission/start succeeds — the game IS the
  // feedback, no optimistic patch needed.
  const [mission, setMission] = useState<{ start: MissionStartResponse; threat: number } | null>(
    null,
  );

  const onMission = useCallback(
    (route: MissionRoute) => {
      const threat = dataRef.current?.city.threat ?? 0;
      api
        .missionStart(route)
        .then((r) => {
          patch((d) => ({
            ...d,
            player: r.player,
            effectiveEnergy: r.effectiveEnergy,
            missionUsedToday: true,
          }));
          setMission({ start: r, threat });
        })
        .catch((err: Error) => push(`⚠️ ${err.message}`));
    },
    [patch, push],
  );

  const onMissionClose = useCallback(
    (completed: MissionCompleteResponse | null) => {
      setMission(null);
      if (completed) {
        patch((d) => ({ ...d, player: completed.player }));
        if (completed.unlockedTitle !== null) push(`🎖️ Title unlocked — ${completed.unlockedTitle}`);
        refresh(); // banked loot lands in the city aggregate — resync
      }
    },
    [patch, push, refresh],
  );

  const handlers: Handlers = { onPledge, onVote, onStrategy, onAction, onRole, onMission, onAvatar };

  // ---- render ----

  const shell = (inner: ReactNode) => (
    <div className="pxl">
      {inner}
      <ToastLayer toasts={toasts} />
    </div>
  );

  const boot = (icon: ReactNode, title: string, sub: string) =>
    shell(
      <div className="pxl-app">
        <div className="pxl-mid">
          <div className="pxl-full">
            <div className="inner">
              {icon}
              <h2>{title}</h2>
              <p>{sub}</p>
            </div>
          </div>
        </div>
      </div>,
    );

  if (net.kind === 'loading') {
    return boot(<div className="pxl-boot-sun" aria-hidden="true" />, 'ONE MORE DAWN', 'waking the city…');
  }
  if (net.kind === 'error') {
    return boot(<div style={{ fontSize: 40 }}>🕯️</div>, 'SIGNAL LOST', `Could not reach the city. ${net.message}`);
  }

  const { data } = net;

  if (data.city.status === 'fallen') {
    return shell(<div className="pxl-app">{<FallenCity data={data} />}</div>);
  }
  if (data.player.avatar === null) {
    return shell(
      <div className="pxl-app">
        <div className="pxl-mid">
          <div className="pxl-content" style={{ maxWidth: 500 }}>
            <div className="pxl-cre-head">
              <div className="pxl-boot-sun" aria-hidden="true" />
              <h2>BUILD YOUR SURVIVOR</h2>
              <p>
                Before you step through the gate, make yourself known. Choose a name, your pronouns,
                and a face the city will remember.
              </p>
            </div>
            <div className="pxl-panel card">
              <AvatarCreator
                initial={null}
                seed={data.player.userId}
                busy={savingAvatar}
                onSave={handlers.onAvatar}
              />
            </div>
          </div>
        </div>
      </div>,
    );
  }
  if (data.player.role === null) {
    return shell(<div className="pxl-app">{<RoleGate handlers={handlers} />}</div>);
  }

  const showDawn = data.firstVisitToday && data.dawnReport !== null && !dawnSeen;
  const vil = village.kind === 'ready' ? village.data : null;
  const subName = subreddit !== null ? `r/${subreddit.replace(/^r\//, '')}` : 'the last city';
  const crisisPending = data.yourCrisisVote === null;
  const cit =
    vil !== null && vil.villagers.length > 0
      ? vil.villagers[Math.min(selCit, vil.villagers.length - 1)] ?? null
      : null;
  const NAVS: [Tab, string, string][] = [
    ['home', '🏠', 'Home'],
    ['crisis', '⚔️', 'Crisis'],
    ['feed', '📣', 'Feed'],
    ['world', '🌐', 'World'],
    ['you', '🎖️', 'You'],
  ];

  return shell(
    <>
      <div className="pxl-app">
        <aside className="pxl-side">
          <div className="pxl-overseer">
            <div className="pxl-avatar-ring">
              {data.player.avatar ? (
                <PixelAvatar avatar={data.player.avatar} size={62} />
              ) : (
                <svg width="40" height="40" viewBox="0 0 20 20" shapeRendering="crispEdges">
                  <rect x="7" y="2" width="6" height="6" rx="1" fill="#e8c34a" />
                  <rect x="5" y="8" width="10" height="8" rx="2" fill="#c85040" />
                  <rect x="4" y="10" width="2" height="5" fill="#c85040" />
                  <rect x="14" y="10" width="2" height="5" fill="#c85040" />
                </svg>
              )}
            </div>
            <h3>{data.player.avatar?.name ?? data.player.username}</h3>
            <div className="handle">{data.player.title ?? `u/${data.player.username}`}</div>
            <button type="button" className="pxl-edit-av" onClick={() => setEditingAvatar(true)}>
              ✎ Edit avatar
            </button>
          </div>
          <div>
            <div className="pxl-side-sec">Your Cities</div>
            <div className="pxl-vrow on">
              <span className="sq" style={{ background: 'var(--green)' }} />
              <span className="nm">{subName}</span>
              <span className="on-ct">{vil?.onlineCount ?? 0}•</span>
            </div>
            <button
              type="button"
              className="pxl-vrow"
              style={{ width: '100%', background: 'none', fontFamily: 'var(--mono)', color: 'var(--blue)' }}
              onClick={() => setTab('world')}
            >
              <span className="sq" style={{ background: 'var(--blue)' }} />
              <span className="nm">↗ travel to other cities</span>
            </button>
          </div>
          <div>
            <div className="pxl-side-sec">Navigate</div>
            {NAVS.map(([t, ic, l]) => (
              <button
                key={t}
                type="button"
                className={tab === t ? 'pxl-navrow on' : 'pxl-navrow'}
                onClick={() => setTab(t)}
              >
                <span className="ic">{ic}</span>
                {l}
                {t === 'crisis' && crisisPending && <span className="badge">!</span>}
              </button>
            ))}
          </div>
          <div className="pxl-sandbox">🔒 EVERY CITIZEN IS A REAL REDDITOR · NAMES MASKED</div>
        </aside>

        <div className="pxl-mid">
          <header className="pxl-topbar">
            <div className="pxl-home-ic">🏠</div>
            <div className="pxl-title">
              <h2>THE LAST CITY</h2>
              <div className="sub">
                {subName} · cycle {data.city.cycle} · day {data.city.day}
              </div>
            </div>
            <div className="pxl-pill">
              ⚡ {vil?.onlineCount ?? '—'}/{vil?.totalCount ?? data.city.population}
            </div>
            <button
              type="button"
              className="pxl-pill"
              style={{ cursor: 'pointer', borderColor: 'var(--line2)', background: 'var(--card2)', color: 'var(--ink)' }}
              onClick={() => setShowRules(true)}
              aria-label="How to play"
              title="How to play"
            >
              ? RULES
            </button>
          </header>
          <div className="pxl-content">
            {tab === 'home' && (
              <HomeScreen
                data={data}
                handlers={handlers}
                village={vil}
                selCit={selCit}
                setSelCit={setSelCit}
                go={setTab}
              />
            )}
            {tab === 'crisis' && <CrisisScreen data={data} handlers={handlers} />}
            {tab === 'feed' && <FeedScreen data={data} />}
            {tab === 'world' && <WorldScreen />}
            {tab === 'you' && (
              <YouScreen data={data} handlers={handlers} onEditAvatar={() => setEditingAvatar(true)} />
            )}
          </div>
        </div>

        {tab === 'home' && (
          <aside className="pxl-rail">
            <span className="lbl">Citizen File</span>
            {cit !== null ? (
              <>
                <div className="pxl-fhead">
                  <span className="av">
                    <Avatar color={cit.color} avatar={cit.avatar} size={52} />
                  </span>
                  <div>
                    <div className="nm">{cit.maskedName}</div>
                    <div className="rl">
                      {cit.role ?? 'undecided'}
                      {cit.faction ? ` · ${cit.faction}` : ''}
                    </div>
                  </div>
                </div>
                <div className="pxl-schip">
                  <span className="dot" style={{ background: cit.online ? 'var(--green)' : 'var(--mut)' }} />
                  {cit.online ? 'ACTIVE TODAY' : 'AWAY'}
                </div>
                <div className="pxl-frows">
                  <div className="r">
                    <span className="k">City</span>
                    <span className="v">{subName}</span>
                  </div>
                  <div className="r">
                    <span className="k">Role</span>
                    <span className="v">{cit.role ?? '—'}</span>
                  </div>
                  <div className="r">
                    <span className="k">Faction</span>
                    <span className="v">{cit.faction ?? '—'}</span>
                  </div>
                  <div className="r">
                    <span className="k">Since</span>
                    <span className="v">{cit.since}</span>
                  </div>
                </div>
                <button type="button" className="pxl-wave" onClick={() => push(`📣 You waved to ${cit.maskedName}`)}>
                  📣 SEND A WAVE
                </button>
                <div className="pxl-rnote">
                  🔒 A wave greets them in the comments — presence only, no DMs, no real location.
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--mut)' }}>No citizens have acted yet today.</div>
            )}
          </aside>
        )}

        <nav className="pxl-mnav">
          {NAVS.map(([t, ic, l]) => (
            <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              <span className="ic">{ic}</span>
              {l.toUpperCase()}
              {t === 'crisis' && crisisPending && <span className="ndot" />}
            </button>
          ))}
        </nav>
      </div>

      {showDawn && data.dawnReport !== null && (
        <DawnReportModal report={data.dawnReport} onDismiss={() => setDawnSeen(true)} />
      )}
      {mission && <MissionOverlay start={mission.start} threat={mission.threat} onClose={onMissionClose} />}
      {editingAvatar && (
        <div className="pxl-overlay" onClick={() => setEditingAvatar(false)}>
          <div className="pxl-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="pxl-sheet-head">
              <span className="pxl-sheet-title">✎ EDIT AVATAR</span>
              <button
                type="button"
                className="pxl-sheet-x"
                onClick={() => setEditingAvatar(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="pxl-sheet-body">
              <AvatarCreator
                initial={data.player.avatar}
                seed={data.player.userId}
                busy={savingAvatar}
                mode="edit"
                onSave={handlers.onAvatar}
                onCancel={() => setEditingAvatar(false)}
              />
            </div>
          </div>
        </div>
      )}
      {showRules && (
        <div className="pxl-overlay" onClick={() => setShowRules(false)}>
          <div className="pxl-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="pxl-sheet-head">
              <span className="pxl-sheet-title">📖 HOW TO PLAY</span>
              <button type="button" className="pxl-sheet-x" onClick={() => setShowRules(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="pxl-sheet-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <RulesScreen />
            </div>
          </div>
        </div>
      )}
    </>,
  );
}
