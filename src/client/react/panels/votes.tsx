import type { InitResponse, StrategyPlanId } from '../../../shared/types';
import { formatDelta, PLAN_DEFS, PLAN_IDS } from '../defs';
import type { Handlers } from '../handlers';
import { Bar } from '../kit/bars';
import { Panel } from '../kit/Panel';

// TODAY'S CRISIS (api.vote) and THE COUNCIL strategy plan (api.strategy).

const LETTERS = ['A', 'B', 'C', 'D'];

export function CrisisPanel({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const { crisis, crisisVotes, yourCrisisVote, resolving } = data;
  const total = crisis.options.reduce((sum, o) => sum + (crisisVotes[o.id] ?? 0), 0);
  const voted = yourCrisisVote !== null;
  return (
    <Panel
      icon="🚪"
      title="TODAY'S CRISIS"
      sub={`${total} vote${total === 1 ? '' : 's'} · resolves at dawn`}
      span2
      danger
    >
      <div style={{ font: '700 13px var(--font-display)', letterSpacing: '0.6px' }}>
        {crisis.title}
      </div>
      <p className="omd-note" style={{ margin: 0, lineHeight: 1.5 }}>
        {crisis.narrative}
      </p>
      {crisis.options.map((o, i) => {
        const count = crisisVotes[o.id] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const mine = yourCrisisVote === o.id;
        return (
          <button
            key={o.id}
            type="button"
            className={mine ? 'omd-vote omd-vote--mine' : 'omd-vote'}
            onClick={() => handlers.onVote(o.id)}
            disabled={voted || resolving}
          >
            <span className="omd-vote-letter">{LETTERS[i] ?? '·'}</span>
            <span className="omd-vote-main">
              <span className="omd-vote-title">
                {o.label}
                {mine && <span className="omd-tag omd-tag--mine">YOUR VOTE</span>}
              </span>
              <span className="omd-vote-desc" style={{ display: 'block' }}>
                {o.description}
              </span>
              <span className="omd-vote-effects" style={{ display: 'block' }}>
                {formatDelta(o.effects)}
              </span>
            </span>
            <span className="omd-vote-tally">
              <span className="omd-vote-pct" style={{ display: 'block' }}>
                {pct}%
              </span>
              <span className="omd-vote-count">{count} votes</span>
              <span className="omd-minibar">
                <span style={{ width: `${pct}%` }} />
              </span>
            </span>
          </button>
        );
      })}
      <div className="omd-note omd-note--center">
        {voted
          ? 'Your voice is in — the city decides together at dawn.'
          : 'One citizen, one vote. The winning option hits the city at dawn.'}
      </div>
    </Panel>
  );
}

export function CouncilPanel({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
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
    <Panel icon="🏛️" title="THE COUNCIL" sub="tap a plan to back it">
      {PLAN_IDS.map((id) => {
        const def = PLAN_DEFS[id];
        const count = strategyVotes[id] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const mine = yourStrategyVote === id;
        return (
          <Bar
            key={id}
            icon={def.icon}
            title={
              <>
                {def.title}
                {mine && <span className="omd-tag omd-tag--backed">BACKED</span>}
                {leader === id && <span className="omd-tag omd-tag--lead">👑 LEADING</span>}
              </>
            }
            pct={pct}
            fill={def.fill}
            value={
              <>
                {pct}% <small>({count})</small>
              </>
            }
            mine={mine}
            onClick={() => handlers.onStrategy(id)}
            disabled={resolving}
          />
        );
      })}
      <div className="omd-note">
        🤝 <b>Unity:</b> when the city's actions align with the leading plan, everyone gains morale
        at dawn. Strategy talk happens in the comments.
      </div>
    </Panel>
  );
}
