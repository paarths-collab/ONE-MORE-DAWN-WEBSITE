import type { DawnReport, InitResponse, TimelineResponse } from '../../../shared/types';
import { api } from '../../game/api';
import { Button } from '../kit/Button';
import { Modal } from '../kit/Modal';
import { useFetch } from './community';

// Big moments: the DAWN REPORT modal (first visit of the day) and the
// memorial screen when the city has fallen.

export function DawnReportModal({
  report,
  onDismiss,
}: {
  report: DawnReport;
  onDismiss: () => void;
}) {
  return (
    <Modal icon="🌅" title={`DAWN REPORT — DAY ${report.day}`}>
      <div className="omd-dawn-sun">🌅</div>
      <div className="omd-dawn-box">
        <div className="omd-dawn-head">BECAUSE OF YESTERDAY</div>
        {report.citySummary.length === 0 ? (
          <div className="omd-dawn-line">A quiet day. The city held its breath.</div>
        ) : (
          report.citySummary.map((line, i) => (
            <div key={i} className="omd-dawn-line">
              {line}
            </div>
          ))
        )}
      </div>
      <div className="omd-dawn-box">
        <div className="omd-dawn-head">YOUR IMPACT</div>
        {report.yourImpact.length === 0 ? (
          <div className="omd-dawn-line">
            The city moved without you yesterday. Today, change that.
          </div>
        ) : (
          report.yourImpact.map((line, i) => (
            <div key={i} className="omd-dawn-line">
              {line}
            </div>
          ))
        )}
      </div>
      {report.title !== null && (
        <div className="omd-note omd-note--center">
          🎖️ You carry the title <b style={{ color: 'var(--accent)' }}>{report.title}</b>
        </div>
      )}
      <Button onClick={onDismiss}>🌇 Face the Day</Button>
    </Modal>
  );
}

export function FallenCity({ data }: { data: InitResponse }) {
  const timeline = useFetch<TimelineResponse>(() => api.timeline());
  const { city } = data;
  return (
    <div className="omd-fallen">
      <div className="omd-fallen-card">
        <div style={{ fontSize: 46 }}>🕯️</div>
        <div className="omd-fallen-title">THE CITY HAS FALLEN</div>
        <div className="omd-fallen-sub">
          It saw {city.day} dawn{city.day === 1 ? '' : 's'} in cycle {city.cycle}. Its citizens —
          real people, all of them — held the wall as long as they could.
        </div>
        <div className="omd-fallen-feed">
          {timeline.kind === 'loading' && <div className="omd-feed-line">Recovering the chronicle…</div>}
          {timeline.kind === 'error' && <div className="omd-feed-line">The chronicle burned with the rest.</div>}
          {timeline.kind === 'ready' &&
            [...timeline.data.entries]
              .sort((a, b) => b.cycle - a.cycle || b.day - a.day)
              .slice(0, 8)
              .map((e) => (
                <div key={`${e.cycle}-${e.day}`} style={{ marginBottom: 10 }}>
                  <div className="omd-feed-day">DAY {e.day}</div>
                  <div className={/raid/i.test(e.headline) ? 'omd-feed-line omd-feed-line--raid' : 'omd-feed-line'}>
                    {e.headline}
                  </div>
                </div>
              ))}
        </div>
        <div className="omd-fallen-sub" style={{ marginTop: 16 }}>
          A new dawn will come. The next cycle begins soon.
        </div>
      </div>
    </div>
  );
}
