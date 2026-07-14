// "Reconnect the City" — the playable board for the daily tile-rotation puzzle.
// A SELF-CONTAINED React component: it owns its rotations / moves / timer, runs
// the shared PURE engine (src/shared/puzzle.ts) every render to know what's
// powered, and calls back once when the district comes online. No IO, no props
// beyond the level + two callbacks — the integrator mounts it in an overlay.
//
// Look: a warm dusk grid of clean SVG conduits that rotate with a springy 150ms
// snap. Energized conduits and the generator glow cyan; buildings are dark until
// power reaches them, then their windows warm to gold. Solve it and the network
// lights building-by-building under a "THE DISTRICT IS CONNECTED" banner.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  evaluate,
  rotateTile,
  rotateEdges,
  starRating,
  initialRotations,
  solutionRotations,
  tileCells,
  POWER_COST,
  BUILDING_LABEL,
  TILE_EDGES,
  type PuzzleLevel,
  type PuzzleCell,
  type TileKind,
  type BuildingKind,
} from '../shared/puzzle';
import { playSound } from './sound';
import './puzzle.css';

// The puzzle SFX cues (puzzle_rotate / puzzle_connect / puzzle_win) are supplied
// by the sound lane and may not yet be in SfxName's union while lanes land in
// parallel. Route through a string-typed shim so this file compiles either way;
// playSound already no-ops safely on any unknown/missing cue.
const emitSound = playSound as unknown as (name: string) => void;
const cue = (name: 'puzzle_rotate' | 'puzzle_connect' | 'puzzle_win'): void => {
  try {
    emitSound(name);
  } catch {
    /* audio must never crash the board */
  }
};

// Emoji glyphs for each building kind — reads at a glance next to the label.
const BUILDING_ICON: Record<BuildingKind, string> = {
  clinic: '🏥',
  shelter: '⛺',
  water_pump: '🚰',
  farm: '🌾',
  storehouse: '📦',
  watchtower: '🗼',
  council_hall: '🏛️',
  house: '🏠',
};

// [openEdgeBit, endX, endY] at rotation 0; the whole tile is spun via CSS so we
// only ever draw the unrotated shape. N=1, E=2, S=4, W=8.
const CONDUIT_ENDS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 50, 5],
  [2, 95, 50],
  [4, 50, 95],
  [8, 5, 50],
];

/** A clean SVG conduit segment set for a tile kind, drawn at rotation 0. */
function Conduit({ kind }: { kind: TileKind }) {
  const edges = TILE_EDGES[kind];
  const active = CONDUIT_ENDS.filter(([bit]) => (edges & bit) !== 0);
  return (
    <svg className="pz-svg" viewBox="0 0 100 100" aria-hidden="true">
      {active.map(([bit, x, y]) => (
        <line key={`b${bit}`} className="base" x1={50} y1={50} x2={x} y2={y} />
      ))}
      {active.map(([bit, x, y]) => (
        <line key={`c${bit}`} className="core" x1={50} y1={50} x2={x} y2={y} />
      ))}
      {kind === 'dead_end' && <circle className="term" cx={50} cy={9} r={7} />}
      <circle className="hub" cx={50} cy={50} r={10} />
    </svg>
  );
}

const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

export function PuzzleGame(props: {
  level: PuzzleLevel;
  onSolved: (score: { stars: 0 | 1 | 2 | 3; moves: number; timeMs: number; rotations: number[] }) => void;
  onExit: () => void;
}) {
  const { level, onExit } = props;

  // Keep the latest onSolved without re-triggering the win effect each render.
  const onSolvedRef = useRef(props.onSolved);
  onSolvedRef.current = props.onSolved;

  const tiles = useMemo(() => tileCells(level), [level]);
  const tileIndexByKey = useMemo(() => {
    const m = new Map<string, number>();
    tiles.forEach((t, i) => m.set(`${t.x},${t.y}`, i));
    return m;
  }, [tiles]);
  const buildingOrder = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const c of level.cells) if (c.t === 'building') m.set(`${c.x},${c.y}`, n++);
    return m;
  }, [level]);

  const [rotations, setRotations] = useState<number[]>(() => initialRotations(level));
  const [spin, setSpin] = useState<number[]>(() => initialRotations(level)); // monotonic turn count for continuous CSS rotation
  const [moves, setMoves] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [won, setWon] = useState(false);
  const [shakeIdx, setShakeIdx] = useState<number | null>(null);

  const startRef = useRef(performance.now());
  const firedRef = useRef(false); // guarantees onSolved fires exactly once
  const timeFrozenRef = useRef(0);
  const shakeTimer = useRef<number | null>(null);

  const ev = useMemo(() => evaluate(level, rotations), [level, rotations]);
  const stars = starRating(level, ev, moves);

  // Power meter: only shown when a source has finite capacity. Approximate the
  // fed load as the total cost of every powered building vs total finite capacity.
  const finiteSources = level.cells.filter(
    (c): c is Extract<PuzzleCell, { t: 'source' }> => c.t === 'source' && c.capacity >= 0,
  );
  const hasFinite = finiteSources.length > 0;
  const capTotal = finiteSources.reduce((s, c) => s + c.capacity, 0);
  const load = level.cells.reduce(
    (s, c) => (c.t === 'building' && (ev.poweredBuildings[`${c.x},${c.y}`] ?? false) ? s + POWER_COST[c.kind] : s),
    0,
  );
  const restored = ev.requiredPowered + ev.optionalPowered;

  // Re-initialise everything when the parent swaps in a different level.
  const levelIdRef = useRef(level.id);
  useEffect(() => {
    if (levelIdRef.current === level.id) return;
    levelIdRef.current = level.id;
    setRotations(initialRotations(level));
    setSpin(initialRotations(level));
    setMoves(0);
    setElapsed(0);
    setWon(false);
    setShakeIdx(null);
    startRef.current = performance.now();
    firedRef.current = false;
    timeFrozenRef.current = 0;
  }, [level]);

  // Running timer (ms); frozen once solved so the HUD holds the finish time.
  useEffect(() => {
    if (won) return;
    const id = window.setInterval(() => setElapsed(performance.now() - startRef.current), 250);
    return () => window.clearInterval(id);
  }, [won]);

  // Win payoff — fires exactly once the first time the board is solved.
  useEffect(() => {
    if (!ev.solved || firedRef.current) return;
    firedRef.current = true;
    const timeMs = Math.max(0, Math.round(performance.now() - startRef.current));
    timeFrozenRef.current = timeMs;
    setWon(true);
    cue('puzzle_win');
    onSolvedRef.current({ stars: starRating(level, ev, moves), moves, timeMs, rotations });
  }, [ev, moves, level]);

  // A cheery blip whenever a building transitions dark -> lit (declared AFTER the
  // win effect so the final solving move plays the triumphant chime, not this).
  const prevLitRef = useRef<Record<string, boolean>>({});
  const litInitedRef = useRef(false);
  useEffect(() => {
    const cur = ev.poweredBuildings;
    if (!litInitedRef.current) {
      litInitedRef.current = true;
      prevLitRef.current = { ...cur };
      return;
    }
    let newlyLit = false;
    for (const k of Object.keys(cur)) {
      if ((cur[k] ?? false) && !(prevLitRef.current[k] ?? false)) {
        newlyLit = true;
        break;
      }
    }
    prevLitRef.current = { ...cur };
    if (newlyLit && !firedRef.current) cue('puzzle_connect');
  }, [ev]);

  useEffect(() => () => {
    if (shakeTimer.current) window.clearTimeout(shakeTimer.current);
  }, []);

  const applyStep = (i: number): void => {
    const tile = tiles[i];
    if (!tile) return;
    const step = tile.sw ? 2 : 1;
    setRotations((prev) => rotateTile(level, prev, i));
    setSpin((prev) => {
      const next = prev.slice();
      next[i] = (next[i] ?? 0) + step;
      return next;
    });
    setMoves((m) => m + 1);
    cue('puzzle_rotate');
  };

  const onTile = (i: number): void => {
    if (won) return;
    const tile = tiles[i];
    if (!tile) return;
    if (tile.locked) {
      setShakeIdx(i);
      if (shakeTimer.current) window.clearTimeout(shakeTimer.current);
      shakeTimer.current = window.setTimeout(() => setShakeIdx(null), 420);
      return;
    }
    applyStep(i);
  };

  const onReset = (): void => {
    if (won) return;
    setRotations(initialRotations(level));
    setSpin(initialRotations(level));
    setMoves(0);
    setElapsed(0);
    startRef.current = performance.now();
  };

  // Nudge one not-yet-solved tile a single step toward its solution rotation.
  const onHint = (): void => {
    if (won) return;
    const sol = solutionRotations(level);
    const idx = tiles.findIndex((t, i) => {
      if (t.locked) return false;
      const cur = rotations[i] ?? 0;
      const target = sol[i] ?? 0;
      return rotateEdges(TILE_EDGES[t.kind], cur) !== rotateEdges(TILE_EDGES[t.kind], target);
    });
    if (idx < 0) return;
    applyStep(idx);
  };

  const renderCell = (cell: PuzzleCell) => {
    const cellStyle = { gridColumn: `${cell.x + 1}`, gridRow: `${cell.y + 1}` };
    const k = `${cell.t}:${cell.x}:${cell.y}`;

    if (cell.t === 'tile') {
      const i = tileIndexByKey.get(`${cell.x},${cell.y}`);
      if (i === undefined) return null;
      const powered = ev.poweredTiles[i] ?? false;
      const deg = (spin[i] ?? 0) * 90;
      const locked = cell.locked ?? false;
      const cls = `pz-tile${powered ? ' on' : ''}${locked ? ' locked' : ''}${shakeIdx === i ? ' shake' : ''}`;
      return (
        <button
          key={k}
          type="button"
          className={cls}
          style={cellStyle}
          onClick={() => onTile(i)}
          aria-label={`Conduit tile${locked ? ', locked' : ''}${powered ? ', powered' : ''}`}
        >
          <div className="pz-spin" style={{ transform: `rotate(${deg}deg)` }}>
            <Conduit kind={cell.kind} />
          </div>
          {locked && (
            <span className="pz-badge pz-lock" aria-hidden="true">
              🔒
            </span>
          )}
          {cell.sw && (
            <span className="pz-badge pz-sw" aria-hidden="true">
              ⇄
            </span>
          )}
        </button>
      );
    }

    if (cell.t === 'source') {
      const finite = cell.capacity >= 0;
      return (
        <div key={k} className="pz-cell pz-source" style={cellStyle}>
          <div className="orb" aria-label={`Generator${finite ? `, capacity ${cell.capacity}` : ''}`}>
            <span aria-hidden="true">⚡</span>
            {finite && <span className="cap">{cell.capacity}</span>}
          </div>
        </div>
      );
    }

    if (cell.t === 'building') {
      const key = `${cell.x},${cell.y}`;
      const on = ev.poweredBuildings[key] ?? false;
      const order = buildingOrder.get(key) ?? 0;
      const cls = `pz-cell pz-building ${cell.required ? 'req' : 'opt'}${on ? ' on' : ''}`;
      return (
        <div key={k} className={cls} style={cellStyle}>
          <div className="pz-bcard" title={BUILDING_LABEL[cell.kind]} style={won ? { animationDelay: `${order * 90}ms` } : undefined}>
            <span className="pz-bico" aria-hidden="true">
              {BUILDING_ICON[cell.kind]}
            </span>
            <span className="pz-blabel">{BUILDING_LABEL[cell.kind]}</span>
          </div>
        </div>
      );
    }

    // blocked — a ruined tile the network must route around.
    return (
      <div key={k} className="pz-cell pz-ruin" style={cellStyle}>
        <svg className="pz-ruinsvg" viewBox="0 0 100 100" aria-label="Ruins">
          <path className="rf" d="M12 84 L26 52 L40 70 L52 42 L64 66 L78 48 L88 84 Z" />
          <line className="rc" x1={34} y1={78} x2={40} y2={64} />
          <line className="rc" x1={58} y1={80} x2={64} y2={66} />
        </svg>
      </div>
    );
  };

  const displayMs = won ? timeFrozenRef.current : elapsed;
  const meterPct = capTotal > 0 ? Math.min(100, (load / capTotal) * 100) : 0;

  const gridStyle = {
    gridTemplateColumns: `repeat(${level.width}, 1fr)`,
    gridTemplateRows: `repeat(${level.height}, 1fr)`,
    aspectRatio: `${level.width} / ${level.height}`,
  };

  return (
    <div className="pz-root">
      <div className="pz-hud">
        <div className="pz-hud-top">
          <div>
            <div className="pz-name">{level.name}</div>
            <div className="pz-chapter">CHAPTER {level.chapter} · RECONNECT</div>
          </div>
          <div className="pz-stars" aria-label={`${stars} of 3 stars`}>
            {[0, 1, 2].map((n) => (
              <span key={n} className={n < stars ? 'pz-star on' : 'pz-star'} aria-hidden="true">
                ★
              </span>
            ))}
          </div>
        </div>

        <div className="pz-stats">
          <div className={moves > level.moveTarget ? 'pz-stat warn' : 'pz-stat'}>
            <span className="k">MOVES</span>
            <span className="v">
              {moves}
              <em> / {level.moveTarget}</em>
            </span>
          </div>
          <div className="pz-stat">
            <span className="k">TIME</span>
            <span className="v">{fmtTime(displayMs)}</span>
          </div>
          <div className="pz-stat">
            <span className="k">DISTRICTS</span>
            <span className="v">
              {ev.requiredPowered}
              <em> / {ev.requiredTotal}</em>
            </span>
          </div>
        </div>

        {hasFinite && (
          <div className={ev.overloaded ? 'pz-meter over' : 'pz-meter'}>
            <div className="lab">
              <span>POWER LOAD</span>
              <span>
                <b>{load}</b> / {capTotal}
                {ev.overloaded ? ' · OVERLOAD' : ''}
              </span>
            </div>
            <div className="pz-meter-track">
              <div className="pz-meter-fill" style={{ width: `${meterPct}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="pz-board">
        <div className={won ? 'pz-grid won' : 'pz-grid'} style={gridStyle}>
          {level.cells.map(renderCell)}
        </div>
        {won && (
          <div className="pz-banner">
            <div className="bt">
              THE DISTRICT
              <br />
              IS CONNECTED
            </div>
            <div className="bs">
              {restored} building{restored === 1 ? '' : 's'} restored · {moves} move{moves === 1 ? '' : 's'}
            </div>
            <div className="bstars" aria-hidden="true">
              {[0, 1, 2].map((n) => (
                <span key={n} className={n < stars ? 'on' : ''} style={{ animationDelay: `${n * 150 + 220}ms` }}>
                  ★
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="pz-controls">
        <button type="button" className="pz-btn" onClick={onReset} disabled={won} aria-label="Reset board">
          RESET
        </button>
        <button type="button" className="pz-btn hint" onClick={onHint} disabled={won} aria-label="Hint: rotate a tile toward its solution">
          HINT
        </button>
        <button type="button" className="pz-btn exit" onClick={onExit} aria-label="Exit puzzle">
          EXIT
        </button>
      </div>
    </div>
  );
}
