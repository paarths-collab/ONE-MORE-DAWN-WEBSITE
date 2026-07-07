import { useCallback, useEffect, useRef, useState } from 'react';
import { createVillageScene, type BuildingMeta, type VillageHandle } from './scene';

// ONE MORE DAWN — 3D village, React edition. The Three.js scene lives in
// scene.ts (framework-agnostic); this file is the entire visible UI: canvas
// mount + HUD as real React components driven by state, not DOM pokes.

function VillageCanvas({
  onProgress,
  onLoad,
  onSelect,
}: {
  onProgress: (pct: number) => void;
  onLoad: () => void;
  onSelect: (meta: BuildingMeta | null) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<VillageHandle | null>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return undefined;
    handleRef.current = createVillageScene(el, { onProgress, onLoad, onSelect });
    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
    };
    // mount once — the scene is self-contained and hooks are stable refs below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} className="canvas-mount" />;
}

function TopBar() {
  const RES: [string, string][] = [
    ['🍞', '342'],
    ['⚡', '78'],
    ['🩹', '12'],
    ['👥', '143'],
  ];
  return (
    <div className="hud topbar">
      <div className="title card-bit">
        <h1>THE LAST CITY</h1>
        <div className="sub">3D village prototype · React + three.js · not wired to the game</div>
      </div>
      <div className="res">
        {RES.map(([icon, value]) => (
          <span key={icon} className="pill card-bit">
            {icon} <b>{value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function DayPill() {
  return (
    <div className="hud day card-bit">
      <div className="dn">☀️ DAY 5</div>
      <div className="dt">dawn in 09:12</div>
    </div>
  );
}

function BuildingChip({ meta }: { meta: BuildingMeta | null }) {
  // Keep the last meta while fading out so the chip never flashes empty.
  const [shown, setShown] = useState<BuildingMeta | null>(meta);
  useEffect(() => {
    if (meta) setShown(meta);
  }, [meta]);
  return (
    <div className={meta ? 'hud chip card-bit on' : 'hud chip card-bit'}>
      <div className="nm">{shown?.name ?? ''}</div>
      <div className="lv">LEVEL {shown?.level ?? 1}</div>
      <div className="bl">{shown?.blurb ?? ''}</div>
      <button type="button" className="up" disabled>
        ⬆ UPGRADE — SOON
      </button>
    </div>
  );
}

function BuildDock() {
  const [toast, setToast] = useState(false);
  const timer = useRef<number | null>(null);
  const pop = useCallback(() => {
    setToast(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(false), 2200);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="hud dock">
      <div className="credits">villagers &amp; wildlife: three.js example models (threejs.org)</div>
      <div style={{ position: 'relative' }}>
        <div className={toast ? 'toast on' : 'toast'}>Building placement — coming soon</div>
        <button type="button" className="build" onClick={pop} aria-label="Build">
          🔨
        </button>
      </div>
      <span className="btag">BUILD</span>
    </div>
  );
}

function Loader({ pct, done }: { pct: number; done: boolean }) {
  return (
    <div className={done ? 'loader done' : 'loader'}>
      <div className="sun" />
      <h2>ONE MORE DAWN</h2>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="st">waking the village…</div>
    </div>
  );
}

export function App() {
  const [pct, setPct] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<BuildingMeta | null>(null);

  // Stable callbacks so the canvas effect can safely mount once.
  const onProgress = useCallback((p: number) => setPct(p), []);
  const onLoad = useCallback(() => setLoaded(true), []);
  const onSelect = useCallback((meta: BuildingMeta | null) => setSelected(meta), []);

  return (
    <>
      <VillageCanvas onProgress={onProgress} onLoad={onLoad} onSelect={onSelect} />
      <TopBar />
      <DayPill />
      <BuildingChip meta={selected} />
      <BuildDock />
      <div className="hud hint card-bit">drag to pan · scroll / pinch to zoom · click a building</div>
      <Loader pct={pct} done={loaded} />
    </>
  );
}
