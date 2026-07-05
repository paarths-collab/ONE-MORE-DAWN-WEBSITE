import type { InitResponse } from '../../../shared/types';
import { DRAMA_TINTS, MEDALS, markedGoalWord, markedPct, markedShortName } from '../defs';
import { Chip, SectionHead } from '../kit/bits';

// FEED — the full Live Drama Feed plus the pledge ledger (public credit:
// top helpers · recent helpers · my impact). Status is the reward.

function DramaFeed({ data }: { data: InitResponse }) {
  return (
    <section className="omd-card">
      <SectionHead icon="📜" title="LIVE DRAMA FEED" sub="updates through the day" />
      <div className="omd-drama">
        {data.drama.map((e, i) => (
          <div key={i} className="omd-drama-row" style={{ borderLeftColor: DRAMA_TINTS[e.kind] }}>
            <span className="omd-drama-icon" aria-hidden="true">
              {e.icon}
            </span>
            <span className="omd-drama-text">{e.text}</span>
          </div>
        ))}
        {data.drama.length === 0 && (
          <div className="omd-note">Nothing on the wire yet. The city is holding its breath.</div>
        )}
      </div>
    </section>
  );
}

function PledgeLedger({ data }: { data: InitResponse }) {
  const { pledge, marked } = data;
  const { ledger } = pledge;
  const pct = markedPct(marked);
  return (
    <section className="omd-card">
      <SectionHead icon="🕯️" title="THE PLEDGE LEDGER" sub={`${markedShortName(marked)} · ${pct}% ${markedGoalWord(marked)}`} />

      <div className="omd-ledger-mine">
        {pledge.usedToday ? (
          <span>
            🕯️ <b>You pledged today.</b> Your name is on the ledger.
          </span>
        ) : (
          <span>
            Your pledge is still unspoken today — the Marked is waiting on the <b>Home</b> screen.
          </span>
        )}
        <Chip icon="⭐" tone="accent">
          {ledger.mine} pledge{ledger.mine === 1 ? '' : 's'} this cycle
        </Chip>
      </div>

      <div className="omd-ledger-block">
        <div className="omd-ledger-head">TOP HELPERS</div>
        {ledger.topHelpers.length === 0 && <div className="omd-note">No names carved yet — be the first.</div>}
        {ledger.topHelpers.slice(0, 3).map((name, i) => (
          <div key={name} className="omd-ledger-row">
            <span className="omd-ledger-medal" aria-hidden="true">
              {MEDALS[i] ?? `${i + 1}.`}
            </span>
            <span className="omd-ledger-name omd-mono">{name}</span>
            <span className="omd-ledger-note">held the line</span>
          </div>
        ))}
      </div>

      <div className="omd-ledger-block">
        <div className="omd-ledger-head">RECENT HELPERS</div>
        {ledger.recent.length === 0 ? (
          <div className="omd-note">Quiet so far today.</div>
        ) : (
          <div className="omd-ledger-chips">
            {ledger.recent.slice(0, 6).map((name) => (
              <span key={name} className="omd-ledger-chip omd-mono">
                {name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="omd-note omd-note--center">public credit for real help · never a punishment</div>
    </section>
  );
}

export function FeedScreen({ data }: { data: InitResponse }) {
  return (
    <div className="omd-screen">
      <header className="omd-screen-head">
        <div className="omd-screen-eyebrow">DAY {data.city.day} · THE WIRE</div>
        <h1 className="omd-screen-title">City Feed</h1>
      </header>
      <div className="omd-stack">
        <DramaFeed data={data} />
        <PledgeLedger data={data} />
      </div>
    </div>
  );
}
