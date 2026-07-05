import type { DawnReport, InitResponse, TimelineResponse } from '../../../shared/types';
import { api } from '../../game/api';
import type { Handlers } from '../handlers';
import { Button } from '../kit/Button';
import { Modal } from '../kit/Modal';
import { useFetch } from '../kit/useFetch';
import { RoleCards } from './YouScreen';

// Big moments: the DAWN REPORT sheet (first visit of the day), the first-visit
// role gate, and the memorial screen when the city has fallen.

export function DawnReportModal({ report, onDismiss }: { report: DawnReport; onDismiss: () => void }) {
  return (
    <Modal icon="🌅" title={`DAWN REPORT — DAY ${report.day}`}>
      <div className="omd-dawn-sun" aria-hidden="true">
        🌅
      </div>
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
          <div className="omd-dawn-line">The city moved without you yesterday. Today, change that.</div>
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
          🎖️ You carry the title <b className="tone-accent">{report.title}</b>
        </div>
      )}
      <Button onClick={onDismiss}>🌇 Face the Day</Button>
    </Modal>
  );
}

/** Full-screen first-visit gate shown while player.role === null. */
export function RoleGate({ handlers }: { handlers: Handlers }) {
  return (
    <div className="omd-gate">
      <div className="omd-gate-card">
        <div className="omd-gate-sun" aria-hidden="true">
          🌅
        </div>
        <div className="omd-gate-title">One More Dawn</div>
        <div className="omd-gate-sub">
          The city survived the night. It needs hands. Choose your role — your bonus shapes how you
          help every day.
        </div>
        <RoleCards current={null} onPick={handlers.onRole} />
        <div className="omd-note omd-note--center">
          Every citizen here is a real Reddit user. You can change roles every 3 days.
        </div>
      </div>
    </div>
  );
}

export function FallenCity({ data }: { data: InitResponse }) {
  const timeline = useFetch<TimelineResponse>(() => api.timeline());
  const { city } = data;
  return (
    <div className="omd-fallen">
      <div className="omd-fallen-card">
        <div className="omd-fallen-candle" aria-hidden="true">
          🕯️
        </div>
        <div className="omd-fallen-title">The City Has Fallen</div>
        <div className="omd-fallen-sub">
          It saw {city.day} dawn{city.day === 1 ? '' : 's'} in cycle {city.cycle}. Its citizens —
          real people, all of them — held the wall as long as they could.
        </div>
        <div className="omd-fallen-feed">
          {timeline.kind === 'loading' && <div className="omd-fallen-line">Recovering the chronicle…</div>}
          {timeline.kind === 'error' && <div className="omd-fallen-line">The chronicle burned with the rest.</div>}
          {timeline.kind === 'ready' &&
            [...timeline.data.entries]
              .sort((a, b) => b.cycle - a.cycle || b.day - a.day)
              .slice(0, 8)
              .map((e) => (
                <div key={`${e.cycle}-${e.day}`} className="omd-fallen-entry">
                  <div className="omd-fallen-day">DAY {e.day}</div>
                  <div className={/raid/i.test(e.headline) ? 'omd-fallen-line omd-fallen-line--raid' : 'omd-fallen-line'}>
                    {e.headline}
                  </div>
                </div>
              ))}
        </div>
        <div className="omd-fallen-sub">A new dawn will come. The next cycle begins soon.</div>
      </div>
    </div>
  );
}
