import type { InitResponse, TimelineResponse } from '../../../shared/types';
import { api } from '../../game/api';
import { DRAMA_TINTS, MEDALS, formatDelta, markedGoalWord, markedPct, markedShortName } from '../defs';
import { useFetch } from '../kit/useFetch';

// FEED — the full Live Drama Feed plus the pledge ledger (public credit:
// top helpers · recent helpers · my impact). Status is the reward.
// Pixel command-console skin: returns panels; the parent `.pxl-content` scrolls.

function DramaFeed({ data }: { data: InitResponse }) {
  return (
    <div className="pxl-panel card">
      <div className="pxl-phead">
        <span className="lbl">Live Drama Feed</span>
        <span className="meta">updates through the day</span>
      </div>
      {data.drama.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--mut)' }}>The wire is quiet. Make some news.</div>
      ) : (
        <div className="pxl-feed">
          {data.drama.map((e, i) => (
            <div
              key={i}
              className="fi"
              style={{ borderLeft: `2px solid ${DRAMA_TINTS[e.kind]}`, paddingLeft: 10 }}
            >
              <span className="ic" aria-hidden="true">
                {e.icon}
              </span>
              <span className="tx">{e.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PledgeLedger({ data }: { data: InitResponse }) {
  const { pledge, marked } = data;
  const { ledger } = pledge;
  const pct = markedPct(marked);
  return (
    <div className="pxl-panel card">
      <div className="pxl-phead">
        <span className="lbl">The Pledge Ledger</span>
        <span className="meta">
          {markedShortName(marked)} · {pct}% {markedGoalWord(marked)}
        </span>
      </div>

      <div className="pxl-schip">
        <span aria-hidden="true">🕯️</span>
        {pledge.usedToday ? (
          <span>You pledged today — your name is on the ledger.</span>
        ) : (
          <span>Your pledge is still unspoken today — the Marked waits on Home.</span>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div className="lbl" style={{ fontSize: 9, color: 'var(--mut)', marginBottom: 8 }}>
          Top Helpers
        </div>
        {ledger.topHelpers.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--mut)' }}>No names carved yet — be the first.</div>
        ) : (
          ledger.topHelpers.slice(0, 3).map((name, i) => (
            <div key={name} className="pxl-wrow">
              <span className="rk" aria-hidden="true">
                {MEDALS[i] ?? `${i + 1}.`}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="wn" style={{ fontFamily: 'var(--mono)' }}>
                  {name}
                </span>
                <span className="ws" style={{ color: 'var(--mut)' }}>
                  HELD THE LINE
                </span>
              </span>
            </div>
          ))
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div className="lbl" style={{ fontSize: 9, color: 'var(--mut)', marginBottom: 8 }}>
          Recent Helpers
        </div>
        {ledger.recent.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--mut)' }}>Quiet so far today.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {ledger.recent.slice(0, 6).map((name) => (
              <span key={name} className="pxl-tag" style={{ fontFamily: 'var(--mono)' }}>
                {name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="pxl-rnote">
        <span aria-hidden="true">⭐</span>
        <span>
          You: {ledger.mine} pledge{ledger.mine === 1 ? '' : 's'} this cycle · public credit for real
          help, never a punishment.
        </span>
      </div>
    </div>
  );
}

// The city's permanent memory — every resolved dawn, its headline and deltas.
// Lazy-loaded so the Feed tab pays for the timeline only when opened.
function Chronicle() {
  const timeline = useFetch<TimelineResponse>(() => api.timeline());
  return (
    <div className="pxl-panel card">
      <div className="pxl-phead">
        <span className="lbl">City Chronicle</span>
        <span className="meta">what the city remembers</span>
      </div>
      {timeline.kind === 'loading' && (
        <div style={{ fontSize: 12, color: 'var(--mut)' }}>Recovering the chronicle…</div>
      )}
      {timeline.kind === 'error' && (
        <div style={{ fontSize: 12, color: 'var(--mut)' }}>The chronicle is quiet for now.</div>
      )}
      {timeline.kind === 'ready' &&
        (timeline.data.entries.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--mut)' }}>
            No dawns recorded yet. Survive the night and history begins.
          </div>
        ) : (
          [...timeline.data.entries]
            .sort((a, b) => b.cycle - a.cycle || b.day - a.day)
            .slice(0, 8)
            .map((e) => {
              const raid = /raid/i.test(e.headline);
              return (
                <div key={`${e.cycle}-${e.day}`} className="pxl-chron">
                  <div className="d">DAY {e.day}</div>
                  <div className="b">
                    <div className="h" style={{ color: raid ? 'var(--red)' : 'var(--ink)' }}>
                      {e.headline}
                    </div>
                    <div className="delta">{formatDelta(e.deltas)}</div>
                  </div>
                </div>
              );
            })
        ))}
    </div>
  );
}

export function FeedScreen({ data }: { data: InitResponse }) {
  return (
    <>
      <DramaFeed data={data} />
      <Chronicle />
      <PledgeLedger data={data} />
    </>
  );
}
