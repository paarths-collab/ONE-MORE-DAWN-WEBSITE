import type { FactionId, InitResponse } from '../../../shared/types';
import { FACTION_DEFS, FACTION_IDS } from '../defs';
import { Bar } from '../kit/bars';
import { Panel } from '../kit/Panel';

// FACTIONS & LAW — today's influence race and the active law it enacted.

export function FactionsPanel({ data }: { data: InitResponse }) {
  const { factionInfluence, yourFaction, activeLaw } = data;
  let leader: FactionId | null = null;
  let best = 0;
  let max = 0;
  for (const id of FACTION_IDS) {
    const v = factionInfluence[id];
    if (v > best) {
      best = v;
      leader = id;
    }
    if (v > max) max = v;
  }
  return (
    <Panel icon="🏴" title="FACTIONS & LAW" sub="influence resets each day">
      {FACTION_IDS.map((id) => {
        const def = FACTION_DEFS[id];
        const v = factionInfluence[id];
        return (
          <Bar
            key={id}
            icon={def.icon}
            title={
              <>
                {def.name}
                {leader === id && v > 0 && <span className="omd-tag omd-tag--lead">👑 LEADS</span>}
                {yourFaction === id && <span className="omd-tag omd-tag--backed">YOURS</span>}
              </>
            }
            pct={max > 0 ? (v / max) * 100 : 0}
            fill={def.fill}
            value={v}
          />
        );
      })}
      {activeLaw !== null ? (
        <div className="omd-lawcard">
          <span className="omd-lawcard-name">
            📜 {activeLaw.label}
            <span className="omd-tag omd-tag--star">{FACTION_DEFS[activeLaw.id].name}</span>
          </span>
          <span className="omd-lawcard-line tone-good">▲ {activeLaw.buff}</span>
          <span className="omd-lawcard-line tone-danger">▼ {activeLaw.cost}</span>
        </div>
      ) : (
        <div className="omd-note">
          📜 No law active — the faction that leads at dawn enacts one for a day.
        </div>
      )}
    </Panel>
  );
}
