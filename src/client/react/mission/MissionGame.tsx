import { useEffect, useRef } from 'react';
import * as Phaser from 'phaser';
import { Mission, type MissionPlayResult, type MissionSceneData } from '../../game/scenes/Mission';
import type { MissionStartResponse } from '../../../shared/types';

/**
 * Mounts the Phaser expedition mini-game inside the React app (RX5). The scene
 * is pure gameplay — it reports a raw result via onDone; the host owns the
 * network + result screen. The 720×700 game is scaled to fit the phone column
 * (Scale.FIT), so the same scene works from a 320px phone to desktop.
 */
export function MissionGame({
  start,
  threat,
  onDone,
}: {
  start: MissionStartResponse;
  threat: number;
  onDone: (result: MissionPlayResult) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Keep the latest onDone without re-booting the game when it changes.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let game: Phaser.Game | null = null;
    let fired = false;

    const data: MissionSceneData = {
      start,
      threat,
      onDone: (result) => {
        if (fired) return; // one result per run, even across StrictMode re-mounts
        fired = true;
        onDoneRef.current(result);
      },
    };

    // Boot ONLY once the host has a real size — Phaser's FIT scaler caches the
    // parent size at boot, so booting at 0×0 (a transient mount frame) would
    // leave a permanently 0-sized canvas. The observer also re-fits on later
    // size changes (desktop phone frame, orientation).
    const ensure = () => {
      if (host.clientWidth < 2 || host.clientHeight < 2) return;
      if (game) {
        game.scale.refresh();
        return;
      }
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host,
        width: 720,
        height: 700,
        backgroundColor: '#101219',
        banner: false,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [],
      });
      game.scene.add('Mission', Mission, true, data);
    };

    const ro = new ResizeObserver(ensure);
    ro.observe(host);
    ensure();

    return () => {
      ro.disconnect();
      game?.destroy(true);
    };
  }, [start, threat]);

  return <div ref={hostRef} className="omd-mission-host" aria-label="Expedition mini-game" />;
}
