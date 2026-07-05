import type { InitResponse, StrategyPlanId } from '../../../shared/types';
import { PLAN_DEFS, PLAN_IDS, formatDelta } from '../defs';
import type { Handlers } from '../handlers';
import { SectionHead } from '../kit/bits';

// CRISIS — the decisions screen: today's moral crisis vote (api.vote) and the
// council strategy vote (api.strategy).

const LETTERS = ['A', 'B', 'C', 'D'];

function CrisisVote({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const { crisis, crisisVotes, yourCrisisVote, resolving } = data;
  const total = crisis.options.reduce((sum, o) => sum + (crisisVotes[o.id] ?? 0), 0);
  const voted = yourCrisisVote !== null;
  return (
    <section className="omd-card omd-card--danger">
      <SectionHead icon="⚔️" title="TODAY'S CRISIS" sub={`${total} vote${total === 1 ? '' : 's'} · dawn decides`} />
      <div className="omd-crisis-title">{crisis.title}</div>
      <p className="omd-crisis-narrative">{crisis.narrative}</p>
      <div className="omd-votes">
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
                <span className="omd-vote-desc">{o.description}</span>
                <span className="omd-vote-effects omd-mono">{formatDelta(o.effects)}</span>
                <span className="omd-vote-bar">
                  <span style={{ width: `${pct}%` }} />
                </span>
              </span>
              <span className="omd-vote-tally">
                <span className="omd-vote-pct">{pct}%</span>
                <span className="omd-vote-count">{count}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="omd-note omd-note--center">
        {voted
          ? 'Your voice is in — the city decides together at dawn.'
          : 'One citizen, one vote. The winning option hits the city at dawn.'}
      </div>
    </section>
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
    <section className="omd-card">
      <SectionHead icon="🏛️" title="THE COUNCIL" sub="tap a plan to back it" />
      <div className="omd-plans">
        {PLAN_IDS.map((id) => {
          const def = PLAN_DEFS[id];
          const count = strategyVotes[id] ?? 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const mine = yourStrategyVote === id;
          return (
            <button
              key={id}
              type="button"
              className={mine ? 'omd-plan omd-plan--mine' : 'omd-plan'}
              onClick={() => handlers.onStrategy(id)}
              disabled={resolving}
            >
              <span className="omd-plan-row">
                <span className="omd-plan-icon" aria-hidden="true">
                  {def.icon}
                </span>
                <span className="omd-plan-title">
                  {def.title}
                  {mine && <span className="omd-tag omd-tag--backed">BACKED</span>}
                  {leader === id && leaderVotes > 0 && <span className="omd-tag omd-tag--lead">LEADING</span>}
                </span>
                <span className="omd-plan-val omd-mono">
                  {pct}% <small>({count})</small>
                </span>
              </span>
              <span className="omd-plan-track">
                <span className="omd-plan-fill" style={{ width: `${pct}%`, background: def.fill }} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="omd-note">
        🤝 <b>Unity:</b> when the city&rsquo;s actions align with the leading plan, everyone gains
        morale at dawn. Strategy talk happens in the comments.
      </div>
    </section>
  );
}

export function CrisisScreen({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  return (
    <div className="omd-screen">
      <header className="omd-screen-head">
        <div className="omd-screen-eyebrow">DAY {data.city.day} · THE CITY DECIDES</div>
        <h1 className="omd-screen-title">Decisions</h1>
      </header>
      <div className="omd-stack">
        <CrisisVote data={data} handlers={handlers} />
        <CouncilVote data={data} handlers={handlers} />
      </div>
    </div>
  );
}
