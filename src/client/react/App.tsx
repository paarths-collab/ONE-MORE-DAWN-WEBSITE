import { useEffect, useState } from 'react';
import { api } from '../game/api';
import type { InitResponse } from '../../shared/types';

/**
 * React client root. Foundation step of the React UI rebuild — proves the
 * Devvit/Vite → React pipeline renders live `/api/init` data. Real screens
 * (Village hub, console, votes, mission) are built on top of this.
 */
export function App() {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: InitResponse }
  >({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    api
      .init()
      .then((data) => alive && setState({ kind: 'ready', data }))
      .catch((err: Error) => alive && setState({ kind: 'error', message: err.message }));
    return () => {
      alive = false;
    };
  }, []);

  if (state.kind === 'loading') {
    return <div className="pv-boot">Waking the village…</div>;
  }
  if (state.kind === 'error') {
    return <div className="pv-boot pv-boot--err">Could not reach the city.<br />{state.message}</div>;
  }

  const { city, player } = state.data;
  return (
    <div className="pv-boot">
      <div style={{ fontFamily: 'var(--pixel-font)', color: '#e8c34a', fontSize: 20 }}>
        THE LAST CITY — DAY {city.day}
      </div>
      <div style={{ color: '#8f8578', marginTop: 8 }}>
        cycle {city.cycle} · {player.username} the {player.role ?? 'undecided'}
      </div>
      <div style={{ color: '#e8e2d6', marginTop: 12 }}>
        food {city.food} · power {city.power} · medicine {city.medicine} · morale {city.morale} ·
        threat {city.threat}
      </div>
      <div style={{ color: '#4caf50', marginTop: 12, fontFamily: 'var(--pixel-font)' }}>
        React client live.
      </div>
    </div>
  );
}
