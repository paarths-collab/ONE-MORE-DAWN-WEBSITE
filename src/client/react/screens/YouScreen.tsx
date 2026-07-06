import { useState } from 'react';
import type { InitResponse, Role } from '../../../shared/types';
import { ACTION_DEFS, FACTION_DEFS, ROLE_DEFS, ROLE_IDS, ROUTE_DEFS } from '../defs';
import type { Handlers } from '../handlers';
import { Avatar } from './HomeScreen';

// YOU — the citizen file, pixel command-console skin. Identity header, the role
// switcher (3-day cooldown), your-turn actions, and the expedition. Returns
// panels; the parent `.pxl-content` scrolls.

// Roles can be changed, but only once every 3 days.
const ROLE_COOLDOWN_DAYS = 3;

/** Stable pixel-avatar color from a user id — display only, no game data. */
function avatarColor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h & 0xffffff;
}

// ---------- role picker (inline, in-panel) ----------

export function RoleCards({
  current,
  onPick,
  disabled = false,
}: {
  current: Role | null;
  onPick: (role: Role) => void;
  disabled?: boolean;
}) {
  return (
    <div className="pxl-role-grid">
      {ROLE_IDS.map((id) => {
        const def = ROLE_DEFS[id];
        return (
          <button
            key={id}
            type="button"
            className={current === id ? 'pxl-role on' : 'pxl-role'}
            disabled={disabled}
            onClick={() => onPick(id)}
          >
            <div className="ri" aria-hidden="true">
              {def.icon}
            </div>
            <div className="rn">{def.name}</div>
            <div className="rb">{def.bonus}</div>
          </button>
        );
      })}
    </div>
  );
}

// ---------- identity header + role switcher ----------

function Identity({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const [picking, setPicking] = useState(false);
  const { player, city, standing, yourFaction, yourFactionRep } = data;
  const role = player.role;
  const def = role !== null ? ROLE_DEFS[role] : null;
  const injured = player.injuredUntilDay >= city.day;

  // 3-day role-change cooldown: measured from the last change day vs today.
  const daysSinceChange = city.day - player.roleChangedDay;
  const cooldownLeft = Math.max(0, ROLE_COOLDOWN_DAYS - daysSinceChange);
  const roleLocked = cooldownLeft > 0;

  return (
    <div className="pxl-panel card">
      <div className="pxl-fhead">
        <span className="av">
          <Avatar color={avatarColor(player.userId)} size={52} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="nm">u/{player.username}</div>
          <div className="rl">
            {def ? `${def.icon} ${def.name}` : 'Undecided'}
            {yourFaction !== null ? ` · ${FACTION_DEFS[yourFaction].name}` : ' · unaligned'}
          </div>
        </div>
      </div>

      <div className="pxl-schip">
        <span className="dot" style={{ background: injured ? 'var(--red)' : 'var(--green)' }} />
        {injured ? 'INJURED — 1 LESS ENERGY' : 'ACTIVE TODAY'}
      </div>

      <div className="pxl-frows">
        <div className="r">
          <span className="k">Role</span>
          <span className="v">{def?.name ?? 'Undecided'}</span>
        </div>
        <div className="r">
          <span className="k">Title</span>
          <span className="v" style={{ color: 'var(--gold)' }}>
            {player.title ?? 'No title yet'}
          </span>
        </div>
        <div className="r">
          <span className="k">Streak</span>
          <span className="v">🔥 {player.streak} dawns</span>
        </div>
        <div className="r">
          <span className="k">Contribution</span>
          <span className="v">
            ⭐ {player.totalContribution}
            {standing.contributionRank !== null ? ` · #${standing.contributionRank}` : ''}
          </span>
        </div>
        <div className="r">
          <span className="k">Faction</span>
          <span className="v">
            {yourFaction !== null
              ? `${FACTION_DEFS[yourFaction].icon} ${FACTION_DEFS[yourFaction].name} · rep ${yourFactionRep}`
              : '🕊️ unaligned'}
          </span>
        </div>
      </div>

      {picking ? (
        <>
          <RoleCards
            current={role}
            disabled={roleLocked}
            onPick={(r) => {
              setPicking(false);
              handlers.onRole(r);
            }}
          />
          <button type="button" className="pxl-btn ghost" onClick={() => setPicking(false)}>
            ✕ Close
          </button>
        </>
      ) : roleLocked ? (
        <button type="button" className="pxl-btn ghost" disabled>
          🎭 Role locked — {cooldownLeft} {cooldownLeft === 1 ? 'day' : 'days'} left
        </button>
      ) : (
        <button type="button" className="pxl-btn ghost" onClick={() => setPicking(true)}>
          🎭 Change role
        </button>
      )}
      {picking && (
        <div className="pxl-rnote" style={{ marginTop: 11 }}>
          🎖️ One tap chooses. You can change again every 3 days.
        </div>
      )}
    </div>
  );
}

// ---------- your turn: actions ----------

function ActionsToday({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const { player, effectiveEnergy, yourActionsToday, resolving } = data;
  const energyLeft = Math.max(0, effectiveEnergy - player.energyUsedToday);
  const outOfEnergy = energyLeft <= 0;
  return (
    <div className="pxl-panel card">
      <div className="pxl-phead">
        <span className="lbl">Your Actions Today</span>
        <span className="meta">{outOfEnergy ? 'rested at dawn' : `${energyLeft} energy left`}</span>
      </div>
      <div className="pxl-energy">
        <span className="lbl" style={{ fontSize: 8, color: 'var(--mut)' }}>
          Energy
        </span>
        <div className="dots">
          {Array.from({ length: effectiveEnergy }).map((_, i) => (
            <span key={i} className="d" style={{ background: i < energyLeft ? 'var(--gold)' : 'transparent' }} />
          ))}
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 800, color: 'var(--gold)' }}>
          {energyLeft}/{effectiveEnergy}
        </span>
      </div>
      {outOfEnergy && (
        <div className="pxl-rnote" style={{ marginBottom: 11 }}>
          🌅 You&rsquo;ve given all you had today — the city rests easier for it. Energy returns at dawn.
        </div>
      )}
      <div className="pxl-act-grid">
        {ACTION_DEFS.map((a) => {
          const isRoleBonus = player.role === a.role;
          const doneToday = yourActionsToday[a.id] ?? 0;
          return (
            <button
              key={a.id}
              type="button"
              className="pxl-act"
              onClick={() => handlers.onAction(a.id)}
              disabled={outOfEnergy || resolving}
            >
              {isRoleBonus && <span className="pick">★ ROLE ×1.5</span>}
              <span className="ai" aria-hidden="true">
                {a.icon}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="an">{a.title}</span>
                <span className="ae">
                  {a.effect}
                  {doneToday > 0 ? ` · ${doneToday}×` : ''}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- expedition ----------

function Expedition({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const { player, effectiveEnergy, missionUsedToday, resolving, city } = data;
  const energyLeft = Math.max(0, effectiveEnergy - player.energyUsedToday);
  const locked = missionUsedToday || energyLeft <= 0 || resolving;
  const [routes, setRoutes] = useState(false);
  return (
    <div className="pxl-panel card">
      <div className="pxl-phead">
        <span className="lbl">Expedition</span>
        <span className="meta">threat {city.threat}</span>
      </div>
      {missionUsedToday ? (
        <div className="pxl-rnote">
          🎒 Your expedition is underway. The team returns with the haul at dawn. One run per citizen
          per day.
        </div>
      ) : routes ? (
        <div className="pxl-act-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          {ROUTE_DEFS.map((r) => (
            <button
              key={r.id}
              type="button"
              className="pxl-act"
              style={{ flexDirection: 'column', alignItems: 'flex-start' }}
              disabled={locked}
              onClick={() => handlers.onMission(r.id)}
            >
              <span className="ai" aria-hidden="true">
                {r.icon}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="an">{r.title}</span>
                <span className="ae" style={{ color: 'var(--mut)' }}>
                  {r.blurb}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="pxl-rnote" style={{ marginBottom: 11 }}>
            🎒 Send yourself into the ruins for food, medicine and scrap. Deeper means richer crates
            and thinner air.
          </div>
          <button
            type="button"
            className="pxl-btn ghost"
            disabled={energyLeft <= 0 || resolving}
            onClick={() => setRoutes(true)}
          >
            🎒 Launch Expedition
          </button>
        </>
      )}
    </div>
  );
}

// ---------- the screen ----------

export function YouScreen({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  return (
    <>
      <Identity data={data} handlers={handlers} />
      <ActionsToday data={data} handlers={handlers} />
      <Expedition data={data} handlers={handlers} />
    </>
  );
}
