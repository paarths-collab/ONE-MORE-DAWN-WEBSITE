import { useState } from 'react';
import type { InitResponse, Role } from '../../../shared/types';
import { ACTION_DEFS, FACTION_DEFS, ROLE_DEFS, ROLE_IDS, ROUTE_DEFS } from '../defs';
import type { Handlers } from '../handlers';
import { Button } from '../kit/Button';
import { Chip, EnergyBadge } from '../kit/bits';
import { Modal } from '../kit/Modal';
import { SectionHead } from '../kit/bits';

// YOU — the status spine made personal: role, title, rank, streak, faction,
// energy, today's actions, the expedition, and the role switcher.

export function RoleCards({ current, onPick }: { current: Role | null; onPick: (role: Role) => void }) {
  return (
    <div className="omd-rolegrid">
      {ROLE_IDS.map((id) => {
        const def = ROLE_DEFS[id];
        return (
          <button
            key={id}
            type="button"
            className={current === id ? 'omd-rolecard omd-rolecard--active' : 'omd-rolecard'}
            onClick={() => onPick(id)}
          >
            <div className="omd-rolecard-icon" aria-hidden="true">
              {def.icon}
            </div>
            <div className="omd-rolecard-name">{def.name}</div>
            <div className="omd-rolecard-bonus">{def.bonus}</div>
          </button>
        );
      })}
    </div>
  );
}

function Identity({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const [picking, setPicking] = useState(false);
  const { player, effectiveEnergy, city, standing, yourFaction, yourFactionRep } = data;
  const role = player.role;
  const def = role !== null ? ROLE_DEFS[role] : null;
  const energyLeft = Math.max(0, effectiveEnergy - player.energyUsedToday);
  const injured = player.injuredUntilDay >= city.day;
  return (
    <section className="omd-card omd-identity">
      <div className="omd-identity-hero">
        <span className="omd-identity-orb" aria-hidden="true">
          {def?.icon ?? '❔'}
        </span>
        <span className="omd-identity-main">
          <span className="omd-identity-user omd-mono">u/{player.username}</span>
          <span className="omd-identity-role">{def?.name ?? 'Undecided'}</span>
          <span className="omd-identity-title">{player.title ?? 'No title yet — act for the city'}</span>
        </span>
        <EnergyBadge total={effectiveEnergy} filled={energyLeft} />
      </div>
      <div className="omd-identity-chips">
        <Chip icon="🔥">
          streak <b>{player.streak}</b>
        </Chip>
        <Chip icon="⭐">
          contribution <b>{player.totalContribution}</b>
        </Chip>
        {standing.contributionRank !== null && (
          <Chip icon="🎖️" tone="accent">
            #{standing.contributionRank} in the city
          </Chip>
        )}
        {yourFaction !== null ? (
          <Chip icon={FACTION_DEFS[yourFaction].icon}>
            {FACTION_DEFS[yourFaction].name} <small>rep {yourFactionRep}</small>
          </Chip>
        ) : (
          <Chip icon="🕊️">
            unaligned <small>actions earn faction rep</small>
          </Chip>
        )}
        {injured && (
          <Chip icon="🩸" tone="danger">
            injured — 1 less energy today
          </Chip>
        )}
      </div>
      <Button variant="ghost" onClick={() => setPicking(true)}>
        🎭 Change role
      </Button>
      {picking && (
        <Modal icon="🎖️" title="CHOOSE YOUR ROLE" onClose={() => setPicking(false)}>
          <div className="omd-note">One tap chooses. You can change again every 3 days.</div>
          <RoleCards
            current={role}
            onPick={(r) => {
              setPicking(false);
              handlers.onRole(r);
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function ActionsToday({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const { player, effectiveEnergy, yourActionsToday, resolving } = data;
  const energyLeft = Math.max(0, effectiveEnergy - player.energyUsedToday);
  const outOfEnergy = energyLeft <= 0;
  return (
    <section className="omd-card">
      <SectionHead
        icon="⚡"
        title="YOUR ACTIONS TODAY"
        sub={outOfEnergy ? 'rested at dawn' : `${energyLeft} energy left`}
      />
      {outOfEnergy && (
        <div className="omd-note">
          You&rsquo;ve given all you had today — the city rests easier for it. Energy returns at dawn.
        </div>
      )}
      <div className="omd-actiongrid">
        {ACTION_DEFS.map((a) => {
          const isRoleBonus = player.role === a.role;
          const doneToday = yourActionsToday[a.id] ?? 0;
          return (
            <button
              key={a.id}
              type="button"
              className="omd-action"
              onClick={() => handlers.onAction(a.id)}
              disabled={outOfEnergy || resolving}
            >
              {isRoleBonus && <span className="omd-action-badge">★ ROLE ×1.5</span>}
              <span className="omd-action-icon" aria-hidden="true">
                {a.icon}
              </span>
              <span className="omd-action-title">{a.title}</span>
              <span className="omd-action-effect omd-mono">{a.effect}</span>
              {doneToday > 0 && <span className="omd-action-count omd-mono">×{doneToday} today</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Expedition({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const { player, effectiveEnergy, missionUsedToday, resolving, city } = data;
  const energyLeft = Math.max(0, effectiveEnergy - player.energyUsedToday);
  const locked = missionUsedToday || energyLeft <= 0 || resolving;
  return (
    <section className="omd-card">
      <SectionHead icon="🎒" title="EXPEDITION" sub={`threat ${city.threat} shapes the ruins`} />
      {missionUsedToday ? (
        <div className="omd-note">
          🎒 Your expedition is underway. The team returns with the haul at dawn. One run per citizen
          per day.
        </div>
      ) : (
        <>
          <div className="omd-note">
            Send yourself into the ruins for food, medicine and scrap. Deeper means richer crates and
            thinner air.
          </div>
          <div className="omd-routes">
            {ROUTE_DEFS.map((r) => (
              <Button
                key={r.id}
                variant={r.id === 'desperate' ? 'danger' : r.id === 'deep' ? 'primary' : 'ghost'}
                onClick={() => handlers.onMission(r.id)}
                disabled={locked}
              >
                {r.icon} {r.title}
                <small>· {r.blurb}</small>
              </Button>
            ))}
          </div>
          {energyLeft <= 0 && <div className="omd-note omd-note--center">⚡ No energy left to launch today.</div>}
        </>
      )}
    </section>
  );
}

export function YouScreen({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  return (
    <div className="omd-screen">
      <header className="omd-screen-head">
        <div className="omd-screen-eyebrow">DAY {data.city.day} · YOUR STANDING</div>
        <h1 className="omd-screen-title">Citizen File</h1>
      </header>
      <div className="omd-stack">
        <Identity data={data} handlers={handlers} />
        <ActionsToday data={data} handlers={handlers} />
        <Expedition data={data} handlers={handlers} />
        <footer className="omd-foot">titles are earned, never bought · HL preview</footer>
      </div>
    </div>
  );
}
