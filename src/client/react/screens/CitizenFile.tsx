import type { Villager } from '../../../shared/types';
import { Avatar } from './HomeScreen';

// CITIZEN FILE — the masked profile of a fellow survivor. Shown in the laptop
// rail and, on phone (where the rail is hidden), in a tap-opened sheet so the
// "send a wave" contribution is reachable on every device.
export function CitizenFile({
  cit,
  subName,
  onWave,
}: {
  cit: Villager;
  subName: string;
  onWave: () => void;
}) {
  return (
    <>
      <div className="pxl-fhead">
        <span className="av">
          <Avatar color={cit.color} avatar={cit.avatar} size={52} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="nm">{cit.maskedName}</div>
          <div className="rl">
            {cit.role ?? 'undecided'}
            {cit.faction ? ` · ${cit.faction}` : ''}
          </div>
        </div>
      </div>
      <div className="pxl-schip">
        <span className="dot" style={{ background: cit.online ? 'var(--green)' : 'var(--mut)' }} />
        {cit.online ? 'ACTIVE TODAY' : 'AWAY'}
      </div>
      <div className="pxl-frows">
        <div className="r">
          <span className="k">City</span>
          <span className="v">{subName}</span>
        </div>
        <div className="r">
          <span className="k">Role</span>
          <span className="v">{cit.role ?? '—'}</span>
        </div>
        <div className="r">
          <span className="k">Faction</span>
          <span className="v">{cit.faction ?? '—'}</span>
        </div>
        <div className="r">
          <span className="k">Since</span>
          <span className="v">{cit.since}</span>
        </div>
      </div>
      <button type="button" className="pxl-wave" onClick={onWave}>
        📣 SEND A WAVE
      </button>
      <div className="pxl-rnote">
        🔒 A wave greets them in the comments — presence only, no DMs, no real location.
      </div>
    </>
  );
}
