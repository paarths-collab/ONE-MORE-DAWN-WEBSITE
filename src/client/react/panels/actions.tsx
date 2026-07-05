import type { InitResponse, StrategyPlanId } from '../../../shared/types';
import { ACTION_DEFS, PLAN_DEFS, PLAN_IDS, ROLE_DEFS, ROUTE_DEFS } from '../defs';
import type { Handlers } from '../handlers';
import { Button } from '../kit/Button';
import { EnergyBadge } from '../kit/bits';
import { Panel } from '../kit/Panel';

// CITY ACTIONS (api.takeAction) and EXPEDITION launcher (api.missionStart).

const leadingPlan = (data: InitResponse): StrategyPlanId | null => {
  let leader: StrategyPlanId | null = null;
  let best = 0;
  for (const id of PLAN_IDS) {
    const v = data.strategyVotes[id] ?? 0;
    if (v > best) {
      best = v;
      leader = id;
    }
  }
  return leader;
};

export function ActionsPanel({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const { player, effectiveEnergy, yourActionsToday, resolving } = data;
  const energyLeft = Math.max(0, effectiveEnergy - player.energyUsedToday);
  const outOfEnergy = energyLeft <= 0;
  const lead = leadingPlan(data);
  const councilAction = lead !== null ? PLAN_DEFS[lead].action : null;
  return (
    <Panel icon="⚡" title="CITY ACTIONS" sub="spend energy to help today">
      <div className="omd-spread">
        <span className="omd-note">
          {outOfEnergy ? '⚡ No energy left — rest until dawn.' : 'Every action moves the meters.'}
        </span>
        <EnergyBadge total={effectiveEnergy} filled={energyLeft} />
      </div>
      <div className="omd-actiongrid">
        {ACTION_DEFS.map((a) => {
          const isRoleBonus = player.role === a.role;
          const isCouncilPick = councilAction === a.id;
          const doneToday = yourActionsToday[a.id] ?? 0;
          return (
            <button
              key={a.id}
              type="button"
              className="omd-action"
              onClick={() => handlers.onAction(a.id)}
              disabled={outOfEnergy || resolving}
            >
              {isRoleBonus ? (
                <span className="omd-action-badge omd-action-badge--star">★ ROLE BONUS</span>
              ) : isCouncilPick ? (
                <span className="omd-action-badge">👑 COUNCIL PICK</span>
              ) : null}
              <span className="omd-action-top">
                <span className="omd-action-icon">{a.icon}</span>
                <span>
                  <span className="omd-action-title" style={{ display: 'block' }}>
                    {a.title}
                    {isRoleBonus ? ' ★' : ''}
                  </span>
                  <span className="omd-action-effect" style={{ display: 'block' }}>
                    {a.effect}
                    {isRoleBonus ? ' ×1.5' : ''}
                  </span>
                </span>
              </span>
              <span className="omd-action-foot">
                <span>{ROLE_DEFS[a.role].icon}</span>
                Best with {ROLE_DEFS[a.role].name}
                {doneToday > 0 && (
                  <span className="omd-mono" style={{ marginLeft: 'auto', color: 'var(--accent)' }}>
                    ×{doneToday} today
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

export function ExpeditionPanel({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const { player, effectiveEnergy, missionUsedToday, resolving, city } = data;
  const energyLeft = Math.max(0, effectiveEnergy - player.energyUsedToday);
  const locked = missionUsedToday || energyLeft <= 0 || resolving;
  return (
    <Panel icon="🎒" title="EXPEDITION" sub={`threat ${city.threat} shapes the ruins`}>
      {missionUsedToday ? (
        <>
          <div className="omd-note" style={{ lineHeight: 1.5 }}>
            🎒 Your expedition is underway. The team returns with the haul at dawn.
          </div>
          <div className="omd-note omd-note--center">One expedition per citizen per day.</div>
        </>
      ) : (
        <>
          <div className="omd-note" style={{ lineHeight: 1.5 }}>
            Send yourself into the ruins for food, medicine and scrap. Pick a route — deeper means
            richer crates and thinner air.
          </div>
          {ROUTE_DEFS.map((r) => (
            <Button
              key={r.id}
              variant={r.id === 'desperate' ? 'danger' : r.id === 'deep' ? 'primary' : 'ghost'}
              onClick={() => handlers.onMission(r.id)}
              disabled={locked}
            >
              {r.icon} {r.title}
              <small style={{ fontWeight: 700, opacity: 0.85 }}>· {r.blurb}</small>
            </Button>
          ))}
          <div className="omd-note omd-note--center">
            {energyLeft <= 0
              ? '⚡ No energy left to launch today.'
              : 'Tile mini-game lands soon — launching banks the run for now.'}
          </div>
        </>
      )}
    </Panel>
  );
}
