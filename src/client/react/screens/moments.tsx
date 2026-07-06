import type { DawnReport, InitResponse, TimelineResponse } from '../../../shared/types';
import { api } from '../../game/api';
import { ROLE_DEFS, ROLE_IDS } from '../defs';
import type { Handlers } from '../handlers';
import { useFetch } from '../kit/useFetch';

// Big moments: the DAWN REPORT sheet (first visit of the day), the first-visit
// role gate, and the memorial screen when the city has fallen. Reskinned to the
// pixel command console (see pixel.css / HomeScreen.tsx).

export function DawnReportModal({ report, onDismiss }: { report: DawnReport; onDismiss: () => void }) {
  return (
    <div
      className="pxl-overlay"
      onClick={onDismiss}
      role="dialog"
      aria-modal="true"
      aria-label={`Dawn report, day ${report.day}`}
    >
      <div className="pxl-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pxl-sheet-head">
          <span className="pxl-sheet-title">
            <span aria-hidden="true">🌅 </span>
            DAWN — DAY {report.day}
          </span>
          <button type="button" className="pxl-sheet-x" onClick={onDismiss} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="pxl-sheet-body">
          <div className="pxl-boot-sun" aria-hidden="true" />
          <div className="pxl-panel card" style={{ marginBottom: 12 }}>
            <div className="pxl-phead">
              <span className="lbl">Because of yesterday</span>
            </div>
            {report.citySummary.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--mut)', lineHeight: 1.5 }}>
                A quiet day. The city held its breath.
              </div>
            ) : (
              report.citySummary.map((line, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 4 }}>
                  {line}
                </div>
              ))
            )}
          </div>
          <div className="pxl-panel card">
            <div className="pxl-phead">
              <span className="lbl">Your impact</span>
            </div>
            {report.yourImpact.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--mut)', lineHeight: 1.5 }}>
                The city moved without you yesterday. Today, change that.
              </div>
            ) : (
              report.yourImpact.map((line, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 4 }}>
                  {line}
                </div>
              ))
            )}
          </div>
          {report.title !== null && (
            <div className="pxl-rnote" style={{ marginTop: 12 }}>
              <span aria-hidden="true">🎖️</span>
              <span>
                You carry the title <b style={{ color: 'var(--gold)' }}>{report.title}</b>
              </span>
            </div>
          )}
          <button type="button" className="pxl-btn" onClick={onDismiss}>
            🌇 Face the Day
          </button>
        </div>
      </div>
    </div>
  );
}

/** Full-screen first-visit gate shown while player.role === null. */
export function RoleGate({ handlers }: { handlers: Handlers }) {
  return (
    <div className="pxl-full">
      <div className="inner">
        <div className="pxl-boot-sun" aria-hidden="true" />
        <h2>One More Dawn</h2>
        <p>
          The city survived the night. It needs hands. Choose your role — your bonus shapes how you
          help every day.
        </p>
        <div className="pxl-phead" style={{ margin: '18px 0 10px', justifyContent: 'center' }}>
          <span className="lbl" style={{ color: 'var(--gold)' }}>
            Choose your role
          </span>
        </div>
        <div className="pxl-role-grid">
          {ROLE_IDS.map((id) => {
            const def = ROLE_DEFS[id];
            return (
              <button key={id} type="button" className="pxl-role" onClick={() => handlers.onRole(id)}>
                <div className="ri" aria-hidden="true">
                  {def.icon}
                </div>
                <div className="rn">{def.name}</div>
                <div className="rb">{def.bonus}</div>
              </button>
            );
          })}
        </div>
        <p style={{ marginTop: 14 }}>
          Every citizen here is a real Reddit user. You can change roles every 3 days.
        </p>
      </div>
    </div>
  );
}

export function FallenCity({ data }: { data: InitResponse }) {
  const timeline = useFetch<TimelineResponse>(() => api.timeline());
  const { city } = data;
  return (
    <div className="pxl-full">
      <div className="inner">
        <div style={{ fontSize: 44, marginBottom: 10 }} aria-hidden="true">
          🕯️
        </div>
        <h2 style={{ color: 'var(--red)' }}>THE CITY HAS FALLEN</h2>
        <p>
          It saw {city.day} dawn{city.day === 1 ? '' : 's'} in cycle {city.cycle}. Its citizens —
          real people, all of them — held the wall as long as they could.
        </p>
        <div className="pxl-panel card" style={{ marginTop: 16, textAlign: 'left' }}>
          <div className="pxl-phead">
            <span className="lbl">The Chronicle</span>
            <span className="meta">last days</span>
          </div>
          {timeline.kind === 'loading' && (
            <div style={{ fontSize: 12, color: 'var(--mut)' }}>Recovering the chronicle…</div>
          )}
          {timeline.kind === 'error' && (
            <div style={{ fontSize: 12, color: 'var(--mut)' }}>The chronicle burned with the rest.</div>
          )}
          {timeline.kind === 'ready' &&
            [...timeline.data.entries]
              .sort((a, b) => b.cycle - a.cycle || b.day - a.day)
              .slice(0, 8)
              .map((e) => {
                const raid = /raid/i.test(e.headline);
                return (
                  <div key={`${e.cycle}-${e.day}`} className="pxl-occ" style={{ marginBottom: 9 }}>
                    <div className="t">
                      <span className="lbl" style={{ fontSize: 8, color: 'var(--mut)' }}>
                        DAY {e.day}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, lineHeight: 1.4, color: raid ? 'var(--red)' : 'var(--ink)' }}>
                      {e.headline}
                    </div>
                  </div>
                );
              })}
        </div>
        <p style={{ marginTop: 16 }}>A new dawn will come. The next cycle begins soon.</p>
      </div>
    </div>
  );
}
