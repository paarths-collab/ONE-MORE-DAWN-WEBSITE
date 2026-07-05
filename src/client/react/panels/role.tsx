import { useState } from 'react';
import type { InitResponse, Role } from '../../../shared/types';
import { FACTION_DEFS, ROLE_DEFS, ROLE_IDS } from '../defs';
import type { Handlers } from '../handlers';
import { Button } from '../kit/Button';
import { Chip, EnergyBadge } from '../kit/bits';
import { Modal } from '../kit/Modal';
import { Panel } from '../kit/Panel';

// YOUR ROLE & ENERGY panel, the role-picker modal, and the first-visit gate.

function RoleCards({
  current,
  onPick,
}: {
  current: Role | null;
  onPick: (role: Role) => void;
}) {
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
            <div className="omd-rolecard-icon">{def.icon}</div>
            <div className="omd-rolecard-name">{def.name}</div>
            <div className="omd-rolecard-bonus">{def.bonus}</div>
          </button>
        );
      })}
    </div>
  );
}

export function RolePanel({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const [picking, setPicking] = useState(false);
  const { player, effectiveEnergy, city, yourFaction, yourFactionRep } = data;
  const role = player.role;
  const def = role !== null ? ROLE_DEFS[role] : null;
  const energyLeft = Math.max(0, effectiveEnergy - player.energyUsedToday);
  const injured = player.injuredUntilDay >= city.day;
  return (
    <Panel icon="🎖️" title="YOUR ROLE" sub={player.username}>
      <div className="omd-role-hero">
        <span className="omd-role-orb">{def?.icon ?? '❔'}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="omd-role-name" style={{ display: 'block' }}>
            {def?.name ?? 'Undecided'}
          </span>
          <span className="omd-role-title" style={{ display: 'block' }}>
            {player.title ?? 'No title yet — act for the city'}
          </span>
        </span>
        <EnergyBadge total={effectiveEnergy} filled={energyLeft} />
      </div>
      <div className="omd-role-meta">
        <Chip icon="🔥">
          Streak <b>{player.streak}</b>
        </Chip>
        <Chip icon="⭐">
          Contribution <b>{player.totalContribution}</b>
        </Chip>
        {yourFaction !== null ? (
          <Chip icon={FACTION_DEFS[yourFaction].icon}>
            {FACTION_DEFS[yourFaction].name} <small>rep {yourFactionRep}</small>
          </Chip>
        ) : (
          <Chip icon="🕊️">
            Unaligned <small>actions earn faction rep</small>
          </Chip>
        )}
        {injured && <Chip icon="🩸">Injured — 1 less energy today</Chip>}
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
    </Panel>
  );
}

/** Full-screen first-visit gate shown while player.role === null. */
export function RoleGate({ handlers }: { handlers: Handlers }) {
  return (
    <div className="omd-gate">
      <div className="omd-gate-card">
        <div style={{ fontSize: 40 }}>🌅</div>
        <div className="omd-gate-title">ONE MORE DAWN</div>
        <div className="omd-gate-sub">
          The city survived the night. It needs hands. Choose your role — your bonus shapes how you
          help every day.
        </div>
        <RoleCards current={null} onPick={handlers.onRole} />
        <div className="omd-note omd-note--center" style={{ marginTop: 12 }}>
          Every citizen here is a real Reddit user. You can change roles every 3 days.
        </div>
      </div>
    </div>
  );
}
