import { useCallback, useState } from 'react';
import { api } from '../../game/api';
import type {
  LootKind,
  MissionCompleteResponse,
  MissionStartResponse,
} from '../../../shared/types';
import type { MissionPlayResult } from '../../game/scenes/Mission';
import { MissionGame } from './MissionGame';

type Phase =
  | { kind: 'play' }
  | { kind: 'submitting' }
  | { kind: 'result'; res: MissionCompleteResponse; status: MissionPlayResult['status'] }
  | { kind: 'error'; message: string };

const LOOT_META: Record<LootKind, { icon: string; label: string }> = {
  food: { icon: '🌾', label: 'Food' },
  medicine: { icon: '💊', label: 'Medicine' },
  scrap: { icon: '⚙️', label: 'Scrap' },
};

const STATUS_META: Record<
  MissionPlayResult['status'],
  { icon: string; title: string; tone: string }
> = {
  escaped: { icon: '🏃', title: 'You made it out', tone: 'tone-good' },
  timeout: { icon: '💨', title: 'The air ran out', tone: 'tone-warn' },
  hazard: { icon: '☠️', title: 'A trap caught you', tone: 'tone-danger' },
};

/**
 * Hosts one expedition run: the Phaser mini-game, then the /mission/complete
 * request, then a native result screen (kept in the app's design language so the
 * mini-game feels part of One More Dawn, not a bolted-on canvas).
 */
export function MissionOverlay({
  start,
  threat,
  onClose,
}: {
  start: MissionStartResponse;
  threat: number;
  onClose: (completed: MissionCompleteResponse | null) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'play' });

  const handleDone = useCallback(
    (result: MissionPlayResult) => {
      setPhase({ kind: 'submitting' });
      api
        .missionComplete({ tokenId: start.tokenId, ...result })
        .then((res) => setPhase({ kind: 'result', res, status: result.status }))
        .catch((err: Error) => setPhase({ kind: 'error', message: err.message }));
    },
    [start.tokenId],
  );

  return (
    <div className="omd-mission-overlay" role="dialog" aria-label="Expedition">
      {phase.kind === 'play' && (
        <div className="omd-mission-stage">
          <MissionGame start={start} threat={threat} onDone={handleDone} />
        </div>
      )}

      {phase.kind === 'submitting' && (
        <div className="omd-mission-panel">
          <div className="omd-boot-sun" />
          <div className="omd-mission-panel-title">Heading home…</div>
          <div className="omd-note omd-note--center">Banking what you carried.</div>
        </div>
      )}

      {phase.kind === 'result' && (
        <MissionResult res={phase.res} status={phase.status} onClose={() => onClose(phase.res)} />
      )}

      {phase.kind === 'error' && (
        <div className="omd-mission-panel">
          <div className="omd-mission-panel-icon">⚠️</div>
          <div className="omd-mission-panel-title">The ruins swallowed the report</div>
          <div className="omd-note omd-note--center">{phase.message}</div>
          <button type="button" className="omd-btn omd-btn--ghost" onClick={() => onClose(null)}>
            Back to the city
          </button>
        </div>
      )}
    </div>
  );
}

function MissionResult({
  res,
  status,
  onClose,
}: {
  res: MissionCompleteResponse;
  status: MissionPlayResult['status'];
  onClose: () => void;
}) {
  const meta = STATUS_META[status];
  const loot = (Object.keys(LOOT_META) as LootKind[])
    .map((k) => ({ k, n: res.banked[k] ?? 0 }))
    .filter((x) => x.n > 0);
  const bankedAny = loot.length > 0;

  return (
    <div className="omd-mission-panel">
      <div className="omd-mission-panel-icon">{meta.icon}</div>
      <div className={`omd-mission-panel-title ${meta.tone}`}>{meta.title}</div>

      {bankedAny ? (
        <div className="omd-mission-loot">
          {loot.map(({ k, n }) => (
            <div key={k} className="omd-mission-loot-item">
              <span className="omd-mission-loot-icon" aria-hidden="true">
                {LOOT_META[k].icon}
              </span>
              <span className="omd-mission-loot-n omd-mono">+{n}</span>
              <span className="omd-mission-loot-label">{LOOT_META[k].label}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="omd-note omd-note--center">You came back empty-handed — but you came back.</div>
      )}

      {res.injured && (
        <div className="omd-mission-injury">🩹 You were injured — one less energy tomorrow.</div>
      )}

      <div className="omd-mission-contrib omd-mono">
        +{res.contributionGained} contribution to the city
      </div>
      {res.unlockedTitle !== null && (
        <div className="omd-mission-title-unlock">🎖️ Title unlocked — {res.unlockedTitle}</div>
      )}

      <button type="button" className="omd-btn omd-btn--primary" onClick={onClose}>
        Return to the city
      </button>
    </div>
  );
}
