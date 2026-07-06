import type { InitResponse, StrategyPlanId } from '../../../shared/types';
import { PLAN_DEFS, PLAN_IDS, formatDelta } from '../defs';
import type { Handlers } from '../handlers';

// CRISIS — the decisions screen, pixel command console. Today's moral crisis
// vote (api.vote) and the council strategy vote (api.strategy). Both are
// one-per-day: once you've voted / backed, every option locks.

const LETTERS = ['A', 'B', 'C', 'D'];

function CrisisVote({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const { crisis, crisisVotes, yourCrisisVote, resolving } = data;
  const total = crisis.options.reduce((sum, o) => sum + (crisisVotes[o.id] ?? 0), 0);
  const voted = yourCrisisVote !== null;
  return (
    <div className="pxl-panel card" style={{ borderColor: 'var(--red)' }}>
      <div className="pxl-phead">
        <span className="lbl">{crisis.title}</span>
        <span className="meta">
          ⚔️ {total} vote{total === 1 ? '' : 's'} · dawn
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--mut)', margin: '0 0 12px', lineHeight: 1.5 }}>{crisis.narrative}</p>
      {crisis.options.map((o, i) => {
        const count = crisisVotes[o.id] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const mine = yourCrisisVote === o.id;
        return (
          <button
            key={o.id}
            type="button"
            className={mine ? 'pxl-opt mine' : 'pxl-opt'}
            onClick={() => handlers.onVote(o.id, crisis.id)}
            disabled={voted || resolving}
          >
            <span className="oi" aria-hidden="true">
              {LETTERS[i] ?? '·'}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="on">
                {o.label}
                {mine && (
                  <span className="pxl-tag" style={{ marginLeft: 7 }}>
                    YOUR VOTE
                  </span>
                )}
              </span>
              <span className="oe">{o.description}</span>
              <span className="oe" style={{ color: 'var(--green)' }}>
                {formatDelta(o.effects)}
              </span>
              <span className="pxl-track" style={{ marginTop: 6 }}>
                <i style={{ width: `${pct}%`, background: 'var(--gold)' }} />
              </span>
            </span>
            <span className="tally">{pct}%</span>
          </button>
        );
      })}
      <div style={{ fontSize: 10, color: 'var(--mut)', textAlign: 'center', marginTop: 4 }}>
        {voted
          ? 'Your voice is in — the city decides together at dawn.'
          : 'One citizen, one vote. The winning option hits the city at dawn.'}
      </div>
    </div>
  );
}

function CouncilVote({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const { strategyVotes, yourStrategyVote, resolving } = data;
  const total = PLAN_IDS.reduce((sum, id) => sum + (strategyVotes[id] ?? 0), 0);
  let leader: StrategyPlanId | null = null;
  let leaderVotes = 0;
  for (const id of PLAN_IDS) {
    const v = strategyVotes[id] ?? 0;
    if (v > leaderVotes) {
      leader = id;
      leaderVotes = v;
    }
  }
  return (
    <div className="pxl-panel card">
      <div className="pxl-phead">
        <span className="lbl">The Council</span>
        <span className="meta">🏛️ back a plan</span>
      </div>
      {PLAN_IDS.map((id) => {
        const def = PLAN_DEFS[id];
        const count = strategyVotes[id] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const mine = yourStrategyVote === id;
        return (
          <button
            key={id}
            type="button"
            className={mine ? 'pxl-opt mine' : 'pxl-opt'}
            onClick={() => handlers.onStrategy(id)}
            // One plan per day: once backed, the council is locked (the server
            // rejects a re-vote), so disable every plan button — not just yours.
            disabled={resolving || yourStrategyVote !== null}
          >
            <span className="oi" aria-hidden="true">
              {def.icon}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="on">
                {def.title}
                {mine && (
                  <span className="pxl-tag" style={{ marginLeft: 7 }}>
                    BACKED
                  </span>
                )}
                {leader === id && leaderVotes > 0 && (
                  <span className="pxl-tag" style={{ marginLeft: 7, color: 'var(--green)', borderColor: 'var(--green)' }}>
                    LEADING
                  </span>
                )}
              </span>
              <span className="oe">
                {count} vote{count === 1 ? '' : 's'}
              </span>
              <span className="pxl-track" style={{ marginTop: 6 }}>
                <i style={{ width: `${pct}%`, background: def.fill }} />
              </span>
            </span>
            <span className="tally">{pct}%</span>
          </button>
        );
      })}
      <div className="pxl-rnote" style={{ marginTop: 4 }}>
        <span aria-hidden="true">🤝</span>
        <span>
          <b style={{ color: 'var(--ink)' }}>Unity:</b> when the city&rsquo;s actions align with the leading plan,
          everyone gains morale at dawn. Strategy talk happens in the comments.
        </span>
      </div>
    </div>
  );
}

export function CrisisScreen({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  return (
    <>
      <CrisisVote data={data} handlers={handlers} />
      <CouncilVote data={data} handlers={handlers} />
    </>
  );
}
