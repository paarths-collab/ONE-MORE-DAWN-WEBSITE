import { useEffect, useState } from 'react';
import type {
  LeaderboardEntry,
  LeaderboardResponse,
  TimelineEntry,
  TimelineResponse,
  VillageResponse,
} from '../../../shared/types';
import { api } from '../../game/api';
import { MEDALS, ROLE_DEFS, villagerColor } from '../defs';
import { Panel } from '../kit/Panel';

// Lazily-loaded community panels: CITIZENS (api.village), ACTIVITY
// (api.timeline) and LEADERBOARD (api.leaderboard).

type Fetch<T> = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: T };

function useFetch<T>(fetcher: () => Promise<T>): Fetch<T> {
  const [state, setState] = useState<Fetch<T>>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    fetcher()
      .then((data) => {
        if (alive) setState({ kind: 'ready', data });
      })
      .catch(() => {
        if (alive) setState({ kind: 'error' });
      });
    return () => {
      alive = false;
    };
    // fetch once on mount by design (deps intentionally empty)
  }, []);
  return state;
}

const isRaidLine = (line: string): boolean => /raid/i.test(line);

export function CitizensPanel({ village }: { village: Fetch<VillageResponse> }) {
  return (
    <Panel
      icon="👥"
      title="CITIZENS"
      sub={
        village.kind === 'ready'
          ? `${village.data.onlineCount} online / ${village.data.totalCount} total`
          : '…'
      }
    >
      {village.kind === 'loading' && <div className="omd-note">Counting heads…</div>}
      {village.kind === 'error' && <div className="omd-note">The census office is dark.</div>}
      {village.kind === 'ready' && (
        <>
          <div className="omd-roster">
            {village.data.villagers.length === 0 && (
              <div className="omd-note">No citizens registered yet — you are the first.</div>
            )}
            {village.data.villagers.map((v, i) => (
              <div key={`${v.maskedName}-${i}`} className="omd-cit">
                <span
                  className="omd-cit-avatar"
                  style={{ background: villagerColor(v.color) }}
                >
                  {v.role !== null ? ROLE_DEFS[v.role].icon : '❔'}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="omd-cit-name" style={{ display: 'block' }}>
                    {v.maskedName}
                  </span>
                  <span className="omd-cit-role" style={{ display: 'block' }}>
                    {v.role !== null ? ROLE_DEFS[v.role].name : 'undecided'} · {v.since}
                  </span>
                </span>
                <span className="omd-cit-right">
                  {v.online ? 'online' : 'away'}
                  <span className={v.online ? 'omd-onlinedot omd-onlinedot--on' : 'omd-onlinedot'} />
                </span>
              </div>
            ))}
          </div>
          <div className="omd-note omd-note--center">
            Every citizen is a real Reddit user · names masked
          </div>
        </>
      )}
    </Panel>
  );
}

export type { Fetch };
export { useFetch };

export function ActivityPanel() {
  const timeline = useFetch<TimelineResponse>(() => api.timeline());
  let entries: TimelineEntry[] = [];
  if (timeline.kind === 'ready') {
    entries = [...timeline.data.entries].sort((a, b) => b.cycle - a.cycle || b.day - a.day);
  }
  return (
    <Panel icon="📜" title="ACTIVITY" sub="the city's story so far">
      {timeline.kind === 'loading' && <div className="omd-note">Unrolling the chronicle…</div>}
      {timeline.kind === 'error' && <div className="omd-note">The chronicle is missing.</div>}
      {timeline.kind === 'ready' && entries.length === 0 && (
        <div className="omd-note">The story begins today. Act, vote, survive.</div>
      )}
      {entries.length > 0 && (
        <div className="omd-feed">
          {entries.map((e) => {
            const raid = isRaidLine(e.headline) || e.events.some(isRaidLine);
            return (
              <div
                key={`${e.cycle}-${e.day}`}
                className={raid ? 'omd-feed-entry omd-feed-entry--raid' : 'omd-feed-entry'}
              >
                <div className="omd-feed-day">
                  DAY {e.day} — {e.headline}
                </div>
                {e.events.map((line, i) => (
                  <div
                    key={i}
                    className={isRaidLine(line) ? 'omd-feed-line omd-feed-line--raid' : 'omd-feed-line'}
                  >
                    {line}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function LbList({ head, rows, unit }: { head: string; rows: LeaderboardEntry[]; unit: string }) {
  return (
    <div>
      <div className="omd-lb-head">{head}</div>
      {rows.length === 0 && <div className="omd-note">No names carved yet.</div>}
      {rows.slice(0, 5).map((r, i) => (
        <div key={r.userId} className="omd-lb-row">
          <span className="omd-lb-medal">{MEDALS[i] ?? `${i + 1}.`}</span>
          <span className="omd-lb-name">{r.username}</span>
          <span className="omd-lb-score">
            {r.score} {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

export function LeaderboardPanel() {
  const lb = useFetch<LeaderboardResponse>(() => api.leaderboard());
  return (
    <Panel icon="🏆" title="LEADERBOARD" sub="this cycle">
      {lb.kind === 'loading' && <div className="omd-note">Polishing the medals…</div>}
      {lb.kind === 'error' && <div className="omd-note">The plaza board fell over.</div>}
      {lb.kind === 'ready' && (
        <div className="omd-lb-cols">
          <LbList head="TOP CONTRIBUTORS" rows={lb.data.contributors} unit="pts" />
          <LbList head="BEST SCOUTS" rows={lb.data.scouts} unit="runs" />
        </div>
      )}
    </Panel>
  );
}
