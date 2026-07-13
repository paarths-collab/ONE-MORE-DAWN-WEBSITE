// ONE MORE DAWN — 3D town scene v3 ("the guild map").
// A ~140-tile organic plateau ringed by mountains: seeded winding dirt roads,
// ~240 rustic houses placed along them, 12 labeled districts (floating banner
// labels via CSS2DRenderer), a palisade wall with gates, dense pine forest.
// Same live API as v2: setTimeOfDay / setVillagers / setCompanion; the whole
// environment lerps between night/dawn/day/dusk presets.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export type BuildingMeta = { name: string; level: number; blurb: string };
export type TimeOfDay = 'night' | 'dawn' | 'day' | 'dusk';
export type CompanionKind = 'horse' | 'flamingo' | 'parrot' | 'stork';
export type PoiInfo = { name: string; icon: string; level: number; blurb: string };
// One-redditor-one-house summary (structurally matches shared HouseSummary).
export type SceneHouses = {
  total: number;
  currentUsername?: string;
  founder: { username: string } | null;
  yours: { index: number; tier: number; isFounder: boolean } | null;
  named: { username: string; index: number; tier: number }[];
};

/** One rival settlement on the horizon (status set matches the 2D world map). */
export type DistantCityStatus = 'thriving' | 'holding' | 'strained' | 'under_raid' | 'fallen';
export type DistantCity = { name: string; status: DistantCityStatus };

/** Snapshot the React HUD reads (via getMapData) to draw its live minimap. */
export type MapData = {
  radius: number;                                              // max plateau radius (scale hint)
  outline: [number, number][];                                 // plateau boundary polygon, world XZ
  districts: { name: string; icon: string; x: number; z: number }[];
  houses: [number, number][];                                  // snapshot copy of house centers
};

export type VillageHooks = {
  onProgress: (pct: number) => void;
  onLoad: () => void;
  onSelect: (meta: BuildingMeta | null) => void;
  /** Fired once after build with the full labeled-district directory. */
  onPois?: (pois: PoiInfo[]) => void;
  /** Ambient villager chatter (username + line) — mirror it into the HUD feed. */
  onChat?: (who: string, text: string) => void;
  /** Fired after build-mode places a hut at snapped tile (x, z). */
  onBuilt?: (x: number, z: number) => void;
  /** Fired when a villager is tapped (their u/name) — or null on an empty tap. */
  onVillager?: (name: string | null) => void;
};

export type VillageHandle = {
  setTimeOfDay: (t: TimeOfDay) => void;
  setVillagers: (n: number) => void;
  setCompanion: (kind: CompanionKind, on: boolean) => void;
  /** Fly the camera to a labeled district and select it. */
  focusOn: (name: string) => void;
  /** Toggle raid-watch ambience: red glow beyond the south gate + tinted sky. */
  setRaidWatch: (on: boolean) => void;
  /** Toggle the visible raiding party: 5 dark-tinted soldiers pacing at the main gate. */
  setRaiders: (on: boolean) => void;
  /** One-shot vigil light-pillar pulse at the RELIGION district (retriggerable). */
  pulseMarked: () => void;
  /** Speech-bubble a line (5s) over a random villager — or the gate guard if none walk. */
  say: (text: string) => void;
  /** Speech-bubble a line (5s) over a specific named villager (falls back like `say`). */
  sayTo: (name: string, text: string) => void;
  /** Make a named villager stop, face the camera, and wave for ~2.6s. */
  waveAt: (name: string) => void;
  /** Toggle hut-placement mode: ghost hut follows the pointer; tap a valid tile to build. */
  setBuildMode: (on: boolean) => void;
  /**
   * "Build from zero" city-progression cue. `unlocked` is a subset (in canonical
   * order) of ['shelter','farm','clinic','watchtower','storehouse','wall','council_hall'].
   * Empty = a fresh Camp: the palisade wall is HIDDEN and a central hearth is lit.
   * As ids appear, matching landmarks reveal. Idempotent + defensive: it only
   * toggles `.visible` on landmarks created once, and never throws.
   */
  setBuildStage: (unlocked: string[]) => void;
  setHouses: (houses: SceneHouses | null) => void;
  /**
   * Relabel the distant neighbor settlements on the horizon with real
   * world-map cities (rank order, your own city excluded). Slots past the end
   * of the list keep their fictional default neighbor. Idempotent.
   */
  setDistantCities: (cities: DistantCity[]) => void;
  /**
   * Build a house for a named owner at a random free spot (roadside preferred)
   * and float a temporary owner tag over it. Returns the tile + compass quarter,
   * or null if no valid spot was found.
   */
  buyHouse: (owner: string) => { x: number; z: number; quarter: string } | null;
  /** One-shot golden ring flash + scale pop on a labeled district. */
  flashDistrict: (name: string) => void;
  /** Snapshot of the world (plateau outline, districts, house centers) for the minimap. */
  getMapData: () => MapData;
  /** Camera ground position + look target + fov (degrees) for a minimap viewport indicator. */
  getView: () => { cx: number; cz: number; tx: number; tz: number; fov: number };
  /** Fly the camera to look at an arbitrary ground point (minimap tap on empty land). */
  focusPoint: (x: number, z: number) => void;
  dispose: () => void;
  pause: () => void;
  resume: () => void;
  frame: () => void;
};

export const MAX_VILLAGERS = 8;

// persistent villager identities, assigned by spawn index (pool size == MAX_VILLAGERS)
const VILLAGER_NAMES = ['u/ashen_fox', 'u/quiet_marrow', 'u/saltcedar', 'u/brackenwren', 'u/palewick', 'u/mx_ember', 'u/dawn_keeper', 'u/gate_runner'];

// ---------- seeded rng ----------
const makeRng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// ---------- palette (muted, painterly — the reference is far less candy than CoC) ----------
const C = {
  grassA: 0x5f8a3c, grassB: 0x557d36,
  dirt: 0x9c7a4e, dirtB: 0x8f6f46,
  cliff: 0x6b5a48, rockA: 0x6b6258, rockB: 0x57504a, abyss: 0x171310,
  timber: 0x8a5f3a, timberDark: 0x6e4b2e, plaster: 0xc9b592,
  stone: 0x8f887e, stoneDark: 0x6f6a61,
  roofSlate: 0x5a6b8c, roofSlateDark: 0x4a5876, roofBrown: 0x7a5636, roofGold: 0xe8c34a, roofRed: 0x9c4a38,
  leaf: 0x3f6e2e, leafDark: 0x2f5423, trunk: 0x5c4327,
  crop: 0x8fb04f, cropDark: 0x4f7030,
};

// ---------- time-of-day presets (distances tuned for the ~140-unit world) ----------
type EnvPreset = {
  bg: number; fogNear: number; fogFar: number;
  hemiSky: number; hemiGround: number; hemiInt: number;
  sunColor: number; sunInt: number; sunPos: [number, number, number];
  stars: number; windowCol: number;
  discCol: number; discScale: number;
  campfire: number;
};
const PRESETS: Record<TimeOfDay, EnvPreset> = {
  night: {
    bg: 0x202a42, fogNear: 138, fogFar: 525,
    hemiSky: 0x526789, hemiGround: 0x171d28, hemiInt: 0.78,
    sunColor: 0x9fb6e8, sunInt: 0.62, sunPos: [-40, 85, -30],
    stars: 1, windowCol: 0xffc46a, discCol: 0xdfe8ff, discScale: 3.4, campfire: 30,
  },
  dawn: {
    bg: 0xe89a66, fogNear: 119, fogFar: 475,
    hemiSky: 0xffc9a0, hemiGround: 0x3a4034, hemiInt: 0.82,
    sunColor: 0xffb37a, sunInt: 1.7, sunPos: [95, 20, 40],
    stars: 0.3, windowCol: 0xffcf78, discCol: 0xffd9a8, discScale: 7, campfire: 14,
  },
  day: {
    bg: 0x9ac8e8, fogNear: 175, fogFar: 600,
    hemiSky: 0xfff2d8, hemiGround: 0x4a6b35, hemiInt: 0.95,
    sunColor: 0xfff0c2, sunInt: 2.4, sunPos: [60, 95, 40],
    stars: 0, windowCol: 0x5a4a34, discCol: 0xfff6d8, discScale: 3, campfire: 0,
  },
  dusk: {
    bg: 0xc2694a, fogNear: 125, fogFar: 500,
    hemiSky: 0xe8a06a, hemiGround: 0x2c2118, hemiInt: 0.72,
    sunColor: 0xff9a5a, sunInt: 1.2, sunPos: [-85, 22, 45],
    stars: 0.2, windowCol: 0xffc46a, discCol: 0xffb37a, discScale: 6.4, campfire: 22,
  },
};

export function createVillageScene(container: HTMLElement, hooks: VillageHooks): VillageHandle {
  const rng = makeRng(20260707);
  let disposed = false;

  // ---------- renderer / scene / camera / label layer ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'poi-layer';
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.inset = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  labelRenderer.domElement.style.overflow = 'hidden';
  // NOTE: .canvas-mount is position:fixed (full viewport) — that already anchors
  // this absolute layer; never override its position inline.
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PRESETS.dawn.bg);
  scene.fog = new THREE.Fog(PRESETS.dawn.bg, PRESETS.dawn.fogNear, PRESETS.dawn.fogFar);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 1000);
  camera.position.set(5, 70, 94);

  // landscape-phone framing: on wide-and-short containers (judges review at
  // ~844x390) the default rest pose leaves the town a small diorama, so dolly
  // the camera ~18% closer and drop it a touch to let the city fill the frame
  // (the wall and the south construction site stay in view). Applied only when
  // the aspect category flips, so user orbiting is never fought per-resize.
  let wideFramed = false;
  let controlsRef: OrbitControls | null = null; // size() first runs before controls exist
  const frameTarget = new THREE.Vector3(0, 0, 2);
  const frameOffset = new THREE.Vector3();
  const applyFraming = (w: number, h: number) => {
    const wide = w / h > 1.9 || h < 450;
    if (wide === wideFramed) return;
    wideFramed = wide;
    const tgt = controlsRef ? controlsRef.target : frameTarget;
    frameOffset.copy(camera.position).sub(tgt);
    frameOffset.multiplyScalar(wide ? 0.82 : 1 / 0.82);
    frameOffset.y *= wide ? 0.9 : 1 / 0.9;
    camera.position.copy(tgt).add(frameOffset);
  };

  const size = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applyFraming(w, h);
  };
  size();
  const ro = new ResizeObserver(size);
  ro.observe(container);
  window.addEventListener('resize', size);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 2);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 20;
  controls.maxDistance = 165;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.12;
  controls.screenSpacePanning = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.addEventListener('change', () => {
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -52, 52);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -52, 52);
    controls.target.y = 0;
  });
  controlsRef = controls; // later applyFraming calls dolly about the live target

  // ---------- lights + sky machinery ----------
  const hemi = new THREE.HemisphereLight(PRESETS.dawn.hemiSky, PRESETS.dawn.hemiGround, PRESETS.dawn.hemiInt);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PRESETS.dawn.sunColor, PRESETS.dawn.sunInt);
  sun.position.set(...PRESETS.dawn.sunPos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  sun.shadow.camera.far = 380;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const discMat = new THREE.MeshBasicMaterial({ color: PRESETS.dawn.discCol, fog: false });
  const disc = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), discMat);
  const discHalo = new THREE.Mesh(
    new THREE.SphereGeometry(3.6, 16, 12),
    new THREE.MeshBasicMaterial({ color: PRESETS.dawn.discCol, transparent: true, opacity: 0.28, fog: false }),
  );
  scene.add(disc, discHalo);

  const starMat = new THREE.PointsMaterial({ color: 0xf4ead8, size: 1.1, transparent: true, opacity: PRESETS.dawn.stars, depthWrite: false, fog: false });
  {
    const n = 460;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rng() * 2 - 1;
      const t = rng() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = 320 + rng() * 160;
      pos[i * 3] = s * Math.cos(t) * r;
      pos[i * 3 + 1] = Math.abs(u) * r * 0.9 + 24;
      pos[i * 3 + 2] = s * Math.sin(t) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, starMat));
  }

  const glowMat = new THREE.MeshBasicMaterial({ color: PRESETS.dawn.windowCol });
  const fireLight = new THREE.PointLight(0xff9a4a, PRESETS.dawn.campfire, 34);
  scene.add(fireLight); // positioned at the FEASTS pit below

  const env = {
    bg: new THREE.Color(PRESETS.dawn.bg),
    hemiSky: new THREE.Color(PRESETS.dawn.hemiSky),
    hemiGround: new THREE.Color(PRESETS.dawn.hemiGround),
    sunColor: new THREE.Color(PRESETS.dawn.sunColor),
    windowCol: new THREE.Color(PRESETS.dawn.windowCol),
    discCol: new THREE.Color(PRESETS.dawn.discCol),
    sunPos: new THREE.Vector3(...PRESETS.dawn.sunPos),
    hemiInt: PRESETS.dawn.hemiInt,
    sunInt: PRESETS.dawn.sunInt,
    fogNear: PRESETS.dawn.fogNear,
    fogFar: PRESETS.dawn.fogFar,
    stars: PRESETS.dawn.stars,
    discScale: PRESETS.dawn.discScale,
    campfire: PRESETS.dawn.campfire,
  };
  let target: EnvPreset = PRESETS.dawn;
  const tCol = new THREE.Color();
  const tVec = new THREE.Vector3();
  // raid-watch ambience: raidTint eases 0→1 inside lerpEnv and biases the sky
  // (and drives the gate light + window flicker in tick). No per-frame allocs.
  let raidOn = false;
  let raidTint = 0;
  const raidSkyCol = new THREE.Color(0x662a20);
  function lerpEnv(dt: number) {
    const k = 1 - Math.exp(-dt * 1.6);
    env.bg.lerp(tCol.setHex(target.bg), k);
    env.hemiSky.lerp(tCol.setHex(target.hemiSky), k);
    env.hemiGround.lerp(tCol.setHex(target.hemiGround), k);
    env.sunColor.lerp(tCol.setHex(target.sunColor), k);
    env.windowCol.lerp(tCol.setHex(target.windowCol), k);
    env.discCol.lerp(tCol.setHex(target.discCol), k);
    env.sunPos.lerp(tVec.set(...target.sunPos), k);
    env.hemiInt += (target.hemiInt - env.hemiInt) * k;
    env.sunInt += (target.sunInt - env.sunInt) * k;
    env.fogNear += (target.fogNear - env.fogNear) * k;
    env.fogFar += (target.fogFar - env.fogFar) * k;
    env.stars += (target.stars - env.stars) * k;
    env.discScale += (target.discScale - env.discScale) * k;
    env.campfire += (target.campfire - env.campfire) * k;
    raidTint += ((raidOn ? 1 : 0) - raidTint) * k;

    // raid tint biases the *outputs* (env stays the clean preset blend, so
    // toggling raid off lerps back with zero residue)
    (scene.background as THREE.Color).copy(env.bg).lerp(raidSkyCol, raidTint * 0.35);
    const fog = scene.fog as THREE.Fog;
    fog.color.copy(scene.background as THREE.Color);
    fog.near = env.fogNear;
    fog.far = env.fogFar;
    hemi.color.copy(env.hemiSky).lerp(raidSkyCol, raidTint * 0.35);
    hemi.groundColor.copy(env.hemiGround);
    hemi.intensity = env.hemiInt;
    sun.color.copy(env.sunColor);
    sun.intensity = env.sunInt;
    sun.position.copy(env.sunPos);
    glowMat.color.copy(env.windowCol);
    discMat.color.copy(env.discCol);
    (discHalo.material as THREE.MeshBasicMaterial).color.copy(env.discCol).lerp(raidSkyCol, raidTint * 0.5);
    starMat.opacity = env.stars;
    tVec.copy(env.sunPos).normalize().multiplyScalar(380);
    tVec.y = Math.max(tVec.y, 14);
    disc.position.copy(tVec);
    discHalo.position.copy(tVec);
    disc.scale.setScalar(env.discScale);
    discHalo.scale.setScalar(env.discScale);
  }

  // ---------- materials / kit ----------
  const lam = (color: number, opts: Record<string, unknown> = {}) => new THREE.MeshLambertMaterial({ color, ...opts });
  const MAT = {
    timber: lam(C.timber), timberDark: lam(C.timberDark), plaster: lam(C.plaster),
    stone: lam(C.stone), stoneDark: lam(C.stoneDark),
    trunk: lam(C.trunk),
    crop: lam(C.crop), cropDark: lam(C.cropDark),
    roofSlate: lam(C.roofSlate), roofSlateDark: lam(C.roofSlateDark), roofBrown: lam(C.roofBrown),
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const pyramid = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 4), mat);
    m.scale.set(w * 1.42, h, d * 1.42);
    m.rotation.y = Math.PI / 4;
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  };
  const cyl = (r: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 10) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const glowCube = (s: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), glowMat);
    m.position.set(x, y, z);
    return m;
  };

  // ---------- plateau shape (organic radius, ~135 tiles across) ----------
  const PHI1 = rng() * Math.PI * 2;
  const PHI2 = rng() * Math.PI * 2;
  const plateauR = (theta: number) =>
    58 + 8 * Math.sin(3 * theta + PHI1) + 5 * Math.sin(7 * theta + PHI2);
  const insidePlateau = (x: number, z: number, margin = 0) =>
    Math.hypot(x, z) < plateauR(Math.atan2(z, x)) - margin;

  // ---------- road network (polylines → rasterized dirt tiles) ----------
  const GATE_ANGLES = [Math.PI / 2, -Math.PI / 6, Math.PI + 0.5]; // S, NE, W
  const gates: [number, number][] = GATE_ANGLES.map((a) => {
    const r = plateauR(a) - 5.5;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });

  /** Wiggly polyline between two points (midpoint jitter, 2 passes). */
  function windingPath(ax: number, az: number, bx: number, bz: number): [number, number][] {
    let pts: [number, number][] = [[ax, az], [bx, bz]];
    for (let pass = 0; pass < 2; pass++) {
      const next: [number, number][] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, z1] = pts[i]!;
        const [x2, z2] = pts[i + 1]!;
        next.push([x1, z1]);
        const mx = (x1 + x2) / 2;
        const mz = (z1 + z2) / 2;
        const len = Math.hypot(x2 - x1, z2 - z1);
        const nx = -(z2 - z1) / Math.max(0.001, len);
        const nz = (x2 - x1) / Math.max(0.001, len);
        const off = (rng() - 0.5) * len * 0.4;
        next.push([mx + nx * off, mz + nz * off]);
      }
      next.push(pts[pts.length - 1]!);
      pts = next;
    }
    return pts;
  }

  const roads: [number, number][][] = [];
  for (const [gx, gz] of gates) roads.push(windingPath(0, 0, gx, gz)); // plaza → gates
  {
    // ring road at ~r24, one wiggly loop
    const ring: [number, number][] = [];
    const N = 26;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = 24 + Math.sin(a * 3 + PHI1) * 3 + (rng() - 0.5) * 2;
      ring.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    roads.push(ring);
    // spokes: ring → plaza at 4 angles
    for (const a of [0.3, 2.1, 3.6, 5.2]) {
      const r = 24 + Math.sin(a * 3 + PHI1) * 3;
      roads.push(windingPath(Math.cos(a) * r, Math.sin(a) * r, Math.cos(a) * 7, Math.sin(a) * 7));
    }
    // outer ring at ~33 (more streets = more houses, like the reference)
    const ring2: [number, number][] = [];
    const N2 = 30;
    for (let i = 0; i <= N2; i++) {
      const a = (i / N2) * Math.PI * 2;
      const r = 33 + Math.sin(a * 4 + PHI2) * 2.5 + (rng() - 0.5) * 1.5;
      ring2.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    roads.push(ring2);
    // connectors: outer ring → inner ring at 3 angles
    for (const a of [1.3, 3.0, 4.6]) {
      const r1 = 24 + Math.sin(a * 3 + PHI1) * 3;
      const r2 = 33 + Math.sin(a * 4 + PHI2) * 2.5;
      roads.push(windingPath(Math.cos(a) * r2, Math.sin(a) * r2, Math.cos(a) * r1, Math.sin(a) * r1));
    }
    // third ring (~r43 avg) hugging the new outer band — tracks the plateau edge
    // so it always stays well inside the palisade wobble
    const ring3: [number, number][] = [];
    const N3 = 36;
    for (let i = 0; i <= N3; i++) {
      const a = (i / N3) * Math.PI * 2;
      const r = plateauR(a) - 13 + (rng() - 0.5) * 1.5;
      ring3.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    roads.push(ring3);
    // connectors: third ring → outer ring at 3 angles
    for (const a of [0.6, 2.5, 4.1]) {
      const r2 = 33 + Math.sin(a * 4 + PHI2) * 2.5;
      const r3 = plateauR(a) - 13;
      roads.push(windingPath(Math.cos(a) * r3, Math.sin(a) * r3, Math.cos(a) * r2, Math.sin(a) * r2));
    }
  }

  const roadTiles = new Set<string>();
  const key = (ix: number, iz: number) => `${ix},${iz}`;
  function rasterizeRoad(pts: [number, number][], width: number) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i]!;
      const [x2, z2] = pts[i + 1]!;
      const len = Math.hypot(x2 - x1, z2 - z1);
      const steps = Math.ceil(len / 0.5);
      for (let s = 0; s <= steps; s++) {
        const x = x1 + ((x2 - x1) * s) / steps;
        const z = z1 + ((z2 - z1) * s) / steps;
        for (let dx = -width; dx <= width; dx++) {
          for (let dz = -width; dz <= width; dz++) {
            if (Math.hypot(dx, dz) <= width + 0.3) roadTiles.add(key(Math.round(x + dx), Math.round(z + dz)));
          }
        }
      }
    }
  }
  for (const r of roads) rasterizeRoad(r, 1);
  // plaza
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) if (Math.hypot(dx, dz) <= 4.4) roadTiles.add(key(dx, dz));

  // ---------- terrain tiles ----------
  const SIZE = 140; // bounding grid — plateau carves an organic ~100..135-tile shape out of it
  {
    const positions: [number, number, boolean][] = [];
    for (let ix = -SIZE / 2; ix <= SIZE / 2; ix++) {
      for (let iz = -SIZE / 2; iz <= SIZE / 2; iz++) {
        if (!insidePlateau(ix, iz)) continue;
        positions.push([ix, iz, roadTiles.has(key(ix, iz))]);
      }
    }
    const tileGeo = new THREE.BoxGeometry(1, 0.16, 1);
    const ground = new THREE.InstancedMesh(tileGeo, lam(0xffffff), positions.length);
    ground.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    positions.forEach(([x, z, road], i) => {
      m4.setPosition(x, -0.08, z);
      ground.setMatrixAt(i, m4);
      const check = (Math.abs(x) + Math.abs(z)) % 2;
      col.setHex(road ? (check ? C.dirt : C.dirtB) : check ? C.grassA : C.grassB);
      ground.setColorAt(i, col);
    });
    scene.add(ground);

    // dark abyss floor + cliff skirt under the plateau edge
    const abyss = new THREE.Mesh(new THREE.CircleGeometry(600, 48), lam(C.abyss));
    abyss.rotation.x = -Math.PI / 2;
    abyss.position.y = -7;
    scene.add(abyss);
    const skirtGeo = new THREE.BoxGeometry(1, 7, 1);
    const skirtPos: [number, number][] = [];
    for (let ix = -SIZE / 2; ix <= SIZE / 2; ix++) {
      for (let iz = -SIZE / 2; iz <= SIZE / 2; iz++) {
        if (!insidePlateau(ix, iz)) continue;
        if (!insidePlateau(ix + 1, iz) || !insidePlateau(ix - 1, iz) || !insidePlateau(ix, iz + 1) || !insidePlateau(ix, iz - 1)) {
          skirtPos.push([ix, iz]);
        }
      }
    }
    const skirt = new THREE.InstancedMesh(skirtGeo, lam(C.cliff), skirtPos.length);
    skirtPos.forEach(([x, z], i) => {
      m4.setPosition(x, -3.55, z);
      skirt.setMatrixAt(i, m4);
    });
    scene.add(skirt);
  }

  // ---------- mountain ring ----------
  {
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rocks: { x: number; z: number; s: number; h: number; c: number }[] = [];
    for (let i = 0; i < 190; i++) {
      const a = (i / 190) * Math.PI * 2 + rng() * 0.06;
      const base = plateauR(a);
      const r = base + 2.5 + rng() * 10;
      const s = 4 + rng() * 7;
      rocks.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, s, h: s * (0.8 + rng() * 0.9), c: rng() > 0.5 ? C.rockA : C.rockB });
    }
    const inst = new THREE.InstancedMesh(rockGeo, lam(0xffffff, { flatShading: true }), rocks.length);
    inst.castShadow = true;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const col = new THREE.Color();
    rocks.forEach((rk, i) => {
      e.set(rng() * 0.4, rng() * Math.PI, rng() * 0.4);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(rk.x, rk.h * 0.25 - 2, rk.z), q, new THREE.Vector3(rk.s, rk.h, rk.s));
      inst.setMatrixAt(i, m4);
      col.setHex(rk.c);
      inst.setColorAt(i, col);
    });
    scene.add(inst);
  }

  // ---------- distant neighbor cities (the world beyond the abyss) ----------
  // Five rival settlement slots on mesas past the mountain ring. Demo fills all
  // five; live mode hides every slot that has no real /api/world city.
  const DC_STATUS_COL: Record<DistantCityStatus, number> = {
    thriving: 0x7fd6a2, holding: 0xffcf70, strained: 0xff8a3d, under_raid: 0xff5b4d, fallen: 0x6b7089,
  };
  const DC_DEFAULTS: DistantCity[] = [
    { name: 'r/ironhollow', status: 'thriving' },
    { name: 'r/ashfall', status: 'under_raid' },
    { name: 'r/deepwater', status: 'fallen' },
    { name: 'r/saltmere', status: 'holding' },
    { name: 'r/thornwick', status: 'strained' },
  ];
  const distantSlots: { group: THREE.Group; nameEl: Text; dotEl: HTMLElement; el: HTMLElement; flagMat: THREE.MeshBasicMaterial }[] = [];
  {
    const roofMats = [MAT.roofSlate, MAT.roofSlateDark, MAT.roofBrown];
    const angles = [0.45, 1.7, 2.75, 3.95, 5.25];
    angles.forEach((a0) => {
      const a = a0 + (rng() - 0.5) * 0.2;
      const dist = 150 + rng() * 35;
      const g = new THREE.Group();
      g.position.set(Math.cos(a) * dist, 0, Math.sin(a) * dist);
      // mesa rising from the abyss floor, grass on top
      const topR = 10 + rng() * 3;
      const mesa = new THREE.Mesh(new THREE.CylinderGeometry(topR, topR * 1.4, 7, 9), lam(C.cliff, { flatShading: true }));
      mesa.position.y = -3.5;
      g.add(mesa);
      const top = new THREE.Mesh(new THREE.CircleGeometry(topR - 0.4, 9), lam(C.grassB));
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.04;
      g.add(top);
      // central hall + hut cluster (chunky, so it reads as a town from 150+ units)
      g.add(box(3.6, 2.6, 3.0, MAT.plaster, 0, 1.3, 0));
      g.add(pyramid(3.6, 2.2, 3.0, lam(C.roofRed), 0, 3.7, 0));
      for (let h = 0; h < 8; h++) {
        const ha = rng() * Math.PI * 2;
        const hr = 3.4 + rng() * (topR - 5.5);
        const hx = Math.cos(ha) * hr;
        const hz = Math.sin(ha) * hr;
        const hw = 1.5 + rng() * 0.8;
        const hh = 1.1 + rng() * 0.4;
        g.add(box(hw, hh, hw * 0.85, rng() > 0.4 ? MAT.timber : MAT.plaster, hx, hh / 2, hz));
        g.add(pyramid(hw, 1.1, hw * 0.85, roofMats[Math.floor(rng() * roofMats.length)]!, hx, hh + 0.5, hz));
      }
      for (let t = 0; t < 5; t++) {
        const ta = rng() * Math.PI * 2;
        const tr = topR - 2 - rng() * 2;
        const tx = Math.cos(ta) * tr;
        const tz = Math.sin(ta) * tr;
        g.add(cyl(0.22, 1.2, MAT.trunk, tx, 0.6, tz, 6));
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.6, 7), lam(rng() > 0.5 ? C.leaf : C.leafDark));
        leaf.position.set(tx, 3.0, tz);
        g.add(leaf);
      }
      // status flag on a tall pole by the hall
      const flagMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      g.add(cyl(0.12, 6.5, MAT.stoneDark, 2.6, 3.25, 1.4, 6));
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), flagMat);
      flag.position.set(3.7, 6.0, 1.4);
      g.add(flag);
      // floating name banner (the declutter CSS hides it with the other labels)
      const el = document.createElement('div');
      el.className = 'dc-label';
      const dotEl = document.createElement('span');
      dotEl.className = 'dot';
      const nameEl = document.createTextNode('');
      el.append(dotEl, nameEl);
      const tag = new CSS2DObject(el);
      tag.position.set(0, 9.5, 0);
      g.add(tag);
      scene.add(g);
      distantSlots.push({ group: g, nameEl, dotEl, el, flagMat });
    });
  }
  const applyDistantCities = (cities: DistantCity[], demoDefaults = false) => {
    distantSlots.forEach((slot, i) => {
      const c = cities[i] ?? (demoDefaults ? DC_DEFAULTS[i] : null);
      slot.group.visible = c !== null;
      if (!c) return;
      const col = DC_STATUS_COL[c.status] ?? DC_STATUS_COL.holding;
      slot.nameEl.textContent = c.name;
      slot.dotEl.style.background = `#${col.toString(16).padStart(6, '0')}`;
      slot.el.classList.toggle('fallen', c.status === 'fallen');
      slot.flagMat.color.setHex(col);
    });
  };
  applyDistantCities([], true); // authored demo horizon until live state arrives

  // ---------- occupancy for buildings ----------
  const occupied = new Set<string>();
  const occupy = (x: number, z: number, r: number) => {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) occupied.add(key(Math.round(x + dx), Math.round(z + dz)));
  };
  const isFree = (x: number, z: number, r: number) => {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const k = key(Math.round(x + dx), Math.round(z + dz));
        if (occupied.has(k) || roadTiles.has(k)) return false;
      }
    }
    return true;
  };

  // ---------- interactables + labels ----------
  const interactables: THREE.Group[] = [];
  const poiList: PoiInfo[] = [];
  const poiMap = new Map<string, THREE.Group>();
  function register(group: THREE.Group, x: number, z: number, meta: BuildingMeta, ringR: number, label?: { icon: string; y: number }) {
    group.position.set(x, 0, z);
    group.userData = { ...meta };
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ringR, ringR + 0.2, 28),
      new THREE.MeshBasicMaterial({ color: C.roofGold, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.visible = false;
    group.add(ring);
    group.userData.ring = ring;
    if (label) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'poi-label';
      el.innerHTML = `<span class="ic">${label.icon}</span>${meta.name}`;
      el.addEventListener('click', () => {
        setSelected(group);
        hooks.onSelect({ name: meta.name, level: meta.level, blurb: meta.blurb });
      });
      const obj = new CSS2DObject(el);
      obj.position.set(0, label.y, 0);
      group.add(obj);
      poiList.push({ name: meta.name, icon: label.icon, level: meta.level, blurb: meta.blurb });
      poiMap.set(meta.name, group);
    }
    scene.add(group);
    interactables.push(group);
    occupy(x, z, Math.ceil(ringR));
    return group;
  }

  // ---------- rustic house kit (the town filler) ----------
  // chimney-smoke anchors: the first ~10 houses that win a coin flip volunteer
  const smokeSpots: [number, number][] = [];
  // every house center (filler loop + buyHouse + build-mode tap) so getMapData
  // can hand the React HUD a live minimap snapshot — see the three house() sites
  const houseCenters: [number, number][] = [];
  // every pre-placed filler house group, so the build-from-zero grow-in
  // (setBuildStage) can reveal them from the camp outward as the town is built.
  const houseGroups: THREE.Group[] = [];
  const ROOFS = [MAT.roofSlate, MAT.roofSlateDark, MAT.roofBrown];
  function house(x: number, z: number, facing: number, big = false) {
    if (smokeSpots.length < 10 && rng() > 0.5) smokeSpots.push([x, z]);
    const g = new THREE.Group();
    const w = (big ? 2.2 : 1.6) + rng() * 0.5;
    const d = (big ? 1.8 : 1.4) + rng() * 0.4;
    const h = (big ? 1.4 : 1.0) + rng() * 0.3;
    const roof = ROOFS[Math.floor(rng() * ROOFS.length)]!;
    g.add(box(w, h, d, rng() > 0.35 ? MAT.timber : MAT.plaster, 0, h / 2, 0));
    g.add(pyramid(w * 1.15, 0.8 + rng() * 0.4, d * 1.15, roof, 0, h + 0.4, 0));
    g.add(box(0.4, 0.55, 0.08, MAT.timberDark, 0, 0.3, d / 2 + 0.02));
    g.add(glowCube(0.22, w * 0.28, h * 0.6, d / 2 + 0.03));
    g.position.set(x, 0, z);
    g.rotation.y = facing;
    scene.add(g);
    occupy(x, z, 2);
    return g;
  }

  // ---------- POI districts (the labeled buildings from the reference) ----------
  const ringSpot = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];

  // ASSEMBLY — grand hall on the plaza
  {
    const g = new THREE.Group();
    g.add(box(5.4, 0.7, 5.4, MAT.stoneDark, 0, 0.35, 0));
    g.add(box(4.4, 2.6, 4.4, MAT.timber, 0, 2.0, 0));
    g.add(box(4.7, 0.35, 4.7, MAT.timberDark, 0, 3.45, 0));
    g.add(pyramid(5.0, 2.6, 5.0, lam(C.roofGold), 0, 4.9, 0));
    g.add(box(1.2, 1.6, 0.15, MAT.timberDark, 0, 1.4, 2.28));
    g.add(glowCube(0.8, -1.5, 2.3, 2.26));
    g.add(glowCube(0.8, 1.5, 2.3, 2.26));
    g.add(cyl(0.07, 2.4, MAT.timberDark, 0, 7.3, 0, 6));
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.7), lam(C.roofGold, { side: THREE.DoubleSide }));
    flag.position.set(0.7, 7.9, 0);
    g.add(flag);
    g.userData.flag = flag;
    register(g, 0, -0.5, { name: 'ASSEMBLY', level: 5, blurb: 'The council votes here at dawn. Every voice, one city.' }, 3.6, { icon: '🏛️', y: 8.6 });
  }
  // TRADE — market square east
  {
    const [x, z] = ringSpot(0.3, 30);
    const g = new THREE.Group();
    for (const [sx, sz, ry] of [[-2, 0, 0.3], [0.4, -1.6, -0.4], [2.2, 0.6, 0.9]] as const) {
      const stall = new THREE.Group();
      for (const [px, pz] of [[-0.7, -0.5], [0.7, -0.5], [-0.7, 0.5], [0.7, 0.5]] as const) stall.add(cyl(0.06, 1.1, MAT.timberDark, px, 0.55, pz, 6));
      for (let i = 0; i < 3; i++) {
        const strip = box(0.5, 0.05, 1.4, lam(i % 2 ? 0xe7dcc4 : C.roofRed), -0.5 + i * 0.5, 1.16, 0);
        strip.rotation.z = 0.12;
        stall.add(strip);
      }
      stall.add(box(1.4, 0.45, 0.9, MAT.timber, 0, 0.5, 0));
      stall.position.set(sx, 0, sz);
      stall.rotation.y = ry;
      g.add(stall);
    }
    g.add(box(0.6, 0.5, 0.6, MAT.timberDark, 3.2, 0.25, -1.4));
    g.add(box(0.5, 0.4, 0.5, MAT.timber, 3.6, 0.2, -0.6));
    register(g, x, z, { name: 'TRADE', level: 3, blurb: 'Share Rations happens here. The ledger remembers generosity.' }, 4.0, { icon: '⚖️', y: 3.4 });
  }
  // RELIGION — chapel north
  {
    const [x, z] = ringSpot(-1.85, 31);
    const g = new THREE.Group();
    g.add(box(2.6, 1.8, 4.0, MAT.plaster, 0, 0.9, 0));
    g.add(pyramid(3.0, 1.4, 4.4, MAT.roofSlateDark, 0, 2.5, 0));
    g.add(box(1.4, 3.2, 1.4, MAT.plaster, 0, 1.6, 2.4));
    g.add(pyramid(1.7, 1.6, 1.7, MAT.roofSlateDark, 0, 4.0, 2.4));
    g.add(glowCube(0.5, 0, 2.6, 3.12));
    g.add(box(0.1, 0.9, 0.1, lam(C.roofGold), 0, 5.2, 2.4));
    g.add(box(0.5, 0.1, 0.1, lam(C.roofGold), 0, 5.0, 2.4));
    register(g, x, z, { name: 'RELIGION', level: 2, blurb: 'Vigils for the Marked are held here. The candles never gutter.' }, 3.4, { icon: '🕯️', y: 6.2 });
  }
  // TROOPS — barracks + yard NE
  {
    const [x, z] = ringSpot(-0.75, 33);
    const g = new THREE.Group();
    g.add(box(4.0, 1.8, 2.4, MAT.timber, 0, 0.9, 0));
    g.add(pyramid(4.4, 1.3, 2.8, MAT.roofSlateDark, 0, 2.4, 0));
    g.add(cyl(0.06, 2.0, MAT.timberDark, -1.7, 3.2, 0.9, 6));
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0), lam(C.roofRed, { side: THREE.DoubleSide }));
    banner.position.set(-1.4, 3.3, 0.9);
    g.add(banner);
    for (const [dx, dz] of [[2.8, 0.6], [3.4, -0.5], [2.6, -1.3]] as const) {
      g.add(cyl(0.07, 0.8, MAT.trunk, dx, 0.4, dz, 6));
      g.add(box(0.32, 0.32, 0.32, MAT.timber, dx, 0.95, dz));
    }
    register(g, x, z, { name: 'TROOPS', level: 3, blurb: 'Guard Wall duty musters here before every raid.' }, 4.0, { icon: '⚔️', y: 4.2 });
  }
  // STORAGE — warehouses SE
  {
    const [x, z] = ringSpot(1.05, 31);
    const g = new THREE.Group();
    g.add(box(4.4, 1.6, 2.0, MAT.timber, -0.5, 0.8, -0.9));
    g.add(pyramid(4.8, 1.1, 2.4, MAT.roofBrown, -0.5, 2.1, -0.9));
    g.add(box(3.4, 1.4, 1.8, MAT.timber, 0.7, 0.7, 1.6));
    g.add(pyramid(3.8, 1.0, 2.2, MAT.roofBrown, 0.7, 1.85, 1.6));
    for (const [bx, bz] of [[2.4, -0.4], [2.9, 0.3], [2.2, 0.8]] as const) g.add(cyl(0.3, 0.6, MAT.timberDark, bx, 0.3, bz, 8));
    register(g, x, z, { name: 'STORAGE', level: 3, blurb: 'Every loaf the city saves sleeps behind these doors.' }, 4.0, { icon: '📦', y: 3.6 });
  }
  // PRODUCTION — mill + fields west
  let rotor: THREE.Group | null = null;
  {
    const [x, z] = ringSpot(3.3, 33);
    const g = new THREE.Group();
    g.add(box(2.0, 0.5, 2.0, MAT.stoneDark, 0, 0.25, 0));
    g.add(box(1.7, 3.0, 1.7, MAT.plaster, 0, 2.0, 0));
    g.add(pyramid(2.1, 1.3, 2.1, MAT.roofSlateDark, 0, 4.1, 0));
    g.add(cyl(0.1, 0.9, MAT.timberDark, 0, 3.2, 1.1, 6));
    rotor = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i / 4) * Math.PI * 2 + Math.PI / 4;
      arm.add(box(0.4, 2.0, 0.07, lam(0xe7dcc4), 0, 1.25, 0));
      rotor.add(arm);
    }
    rotor.position.set(0, 3.2, 1.55);
    g.add(rotor);
    // fields beside the mill
    for (const [fx, fz] of [[-3.6, -1.2], [-3.6, 2.2]] as const) {
      g.add(box(3.4, 0.12, 2.6, MAT.cropDark, fx, 0.06, fz));
      for (let r = 0; r < 3; r++) g.add(box(2.8, 0.2, 0.4, MAT.crop, fx, 0.18, fz - 0.8 + r * 0.8));
    }
    register(g, x, z, { name: 'PRODUCTION', level: 4, blurb: 'Grow Food and Repair Power both start here, before first light.' }, 4.6, { icon: '🌾', y: 5.4 });
  }
  // FEASTS — long tables + fire pit NW
  {
    const [x, z] = ringSpot(-2.6, 29);
    const g = new THREE.Group();
    for (const [tx, tz, ry] of [[-1.6, 0, 0.2], [1.6, 0.4, -0.15]] as const) {
      const tbl = new THREE.Group();
      tbl.add(box(2.6, 0.12, 0.8, MAT.timber, 0, 0.55, 0));
      tbl.add(box(0.12, 0.55, 0.7, MAT.timberDark, -1.1, 0.28, 0));
      tbl.add(box(0.12, 0.55, 0.7, MAT.timberDark, 1.1, 0.28, 0));
      tbl.add(box(2.4, 0.08, 0.3, MAT.timberDark, 0, 0.32, 0.65));
      tbl.add(box(2.4, 0.08, 0.3, MAT.timberDark, 0, 0.32, -0.65));
      tbl.position.set(tx, 0, tz);
      tbl.rotation.y = ry;
      g.add(tbl);
    }
    g.add(cyl(0.6, 0.14, MAT.stoneDark, 0, 0.07, -1.8, 10));
    g.add(glowCube(0.34, 0, 0.4, -1.8));
    g.add(glowCube(0.22, 0.16, 0.62, -1.7));
    fireLight.position.set(x, 1.1, z - 1.8);
    register(g, x, z, { name: 'FEASTS', level: 2, blurb: 'When the Marked is saved, the whole city eats together.' }, 3.6, { icon: '🍖', y: 3.0 });
  }
  // COMMAND STAFF — small stone keep, inner north
  {
    const [x, z] = ringSpot(-1.2, 16);
    const g = new THREE.Group();
    g.add(box(2.6, 2.4, 2.6, MAT.stone, 0, 1.2, 0));
    g.add(box(3.0, 0.4, 3.0, MAT.stoneDark, 0, 2.6, 0));
    g.add(box(2.0, 1.6, 2.0, MAT.stone, 0, 3.6, 0));
    g.add(pyramid(2.4, 1.2, 2.4, MAT.roofSlateDark, 0, 5.0, 0));
    g.add(glowCube(0.4, 0, 1.7, 1.32));
    register(g, x, z, { name: 'COMMAND STAFF', level: 3, blurb: 'The overseers read the forecast here. Tomorrow, if nobody acts…' }, 2.8, { icon: '🎖️', y: 6.0 });
  }
  // DIPLOMACY — fine house, inner SE
  {
    const [x, z] = ringSpot(0.9, 16);
    const g = new THREE.Group();
    g.add(box(2.8, 1.6, 2.2, MAT.plaster, 0, 0.8, 0));
    g.add(box(3.0, 0.25, 2.4, MAT.timberDark, 0, 1.72, 0));
    g.add(pyramid(3.2, 1.2, 2.6, MAT.roofSlate, 0, 2.4, 0));
    g.add(box(1.6, 0.1, 0.8, MAT.timber, 0, 0.05, 1.5));
    g.add(cyl(0.06, 0.9, MAT.timberDark, -0.6, 0.45, 1.8, 6));
    g.add(cyl(0.06, 0.9, MAT.timberDark, 0.6, 0.45, 1.8, 6));
    g.add(box(1.6, 0.1, 0.9, MAT.roofSlate, 0, 0.95, 1.55));
    g.add(glowCube(0.4, -0.8, 1.0, 1.12));
    register(g, x, z, { name: 'DIPLOMACY', level: 2, blurb: 'Envoys from other subreddit cities are received here.' }, 2.8, { icon: '🕊️', y: 3.4 });
  }
  // NEWS — notice board, inner west
  {
    const [x, z] = ringSpot(2.6, 15);
    const g = new THREE.Group();
    g.add(cyl(0.09, 1.8, MAT.timberDark, -0.9, 0.9, 0, 6));
    g.add(cyl(0.09, 1.8, MAT.timberDark, 0.9, 0.9, 0, 6));
    g.add(box(2.2, 1.1, 0.12, MAT.timber, 0, 1.25, 0));
    g.add(box(0.5, 0.4, 0.02, lam(0xe7dcc4), -0.5, 1.3, 0.08));
    g.add(box(0.5, 0.55, 0.02, lam(0xe7dcc4), 0.35, 1.2, 0.08));
    g.add(pyramid(2.6, 0.5, 0.6, MAT.roofBrown, 0, 1.95, 0));
    register(g, x, z, { name: 'NEWS', level: 1, blurb: 'The drama feed, nailed to a board. Fresh headlines at dawn.' }, 2.0, { icon: '📜', y: 2.8 });
  }
  // LAWS — columned court, inner east
  {
    const [x, z] = ringSpot(-0.2, 17);
    const g = new THREE.Group();
    g.add(box(3.2, 0.4, 2.4, MAT.stoneDark, 0, 0.2, 0));
    g.add(box(2.8, 1.6, 2.0, MAT.stone, 0, 1.2, 0));
    for (const px of [-1.2, -0.4, 0.4, 1.2]) g.add(cyl(0.12, 1.6, MAT.plaster, px, 1.2, 1.15, 8));
    g.add(pyramid(3.6, 1.0, 2.8, MAT.roofSlateDark, 0, 2.5, 0));
    register(g, x, z, { name: 'LAWS', level: 2, blurb: 'The leading faction writes tomorrow’s law on this floor.' }, 2.8, { icon: '📖', y: 3.6 });
  }
  // TRIBUTE — tollhouse at the south gate
  {
    const [gx, gz] = gates[0]!;
    const g = new THREE.Group();
    g.add(box(1.8, 1.4, 1.8, MAT.stone, 0, 0.7, 0));
    g.add(pyramid(2.2, 1.0, 2.2, MAT.roofBrown, 0, 1.9, 0));
    g.add(box(0.7, 0.5, 0.5, MAT.timberDark, 1.3, 0.25, 0.4));
    g.add(box(0.5, 0.14, 0.4, lam(C.roofGold), 1.3, 0.57, 0.4));
    register(g, gx - 2.6, gz - 1.5, { name: 'TRIBUTE', level: 1, blurb: 'Every cart through the gate leaves a little for the city.' }, 2.2, { icon: '💰', y: 2.8 });
  }
  // STATISTICS — survey tower, inner NE
  {
    const [x, z] = ringSpot(-0.5, 24);
    const g = new THREE.Group();
    g.add(box(1.6, 4.2, 1.6, MAT.timber, 0, 2.1, 0));
    g.add(box(2.2, 0.3, 2.2, MAT.timberDark, 0, 4.35, 0));
    g.add(box(1.9, 1.0, 1.9, MAT.plaster, 0, 5.0, 0));
    g.add(pyramid(2.3, 1.1, 2.3, MAT.roofSlateDark, 0, 6.05, 0));
    g.add(glowCube(0.4, 0, 5.1, 0.98));
    register(g, x, z, { name: 'STATISTICS', level: 2, blurb: 'Dawns survived, pledges counted, the chronicle keeps score.' }, 2.4, { icon: '📊', y: 7.0 });
  }

  // actionable-contrast lights: small warm pools over the plaza hall and the
  // market so the two headline interactive districts pop at dawn/dusk without
  // washing out the night mood (short range, no shadows, phone-budget cheap).
  {
    const hall = poiMap.get('ASSEMBLY');
    if (hall) {
      const l = new THREE.PointLight(0xffc46a, 9, 15, 2);
      l.position.set(hall.position.x, 4.5, hall.position.z + 2);
      scene.add(l);
    }
    const market = poiMap.get('TRADE');
    if (market) {
      const l = new THREE.PointLight(0xffc46a, 7, 12, 2);
      l.position.set(market.position.x, 3, market.position.z);
      scene.add(l);
    }
  }

  // ---------- filler houses along the roads (~240) ----------
  {
    let placed = 0;
    const candidates: [number, number, number][] = [];
    for (const road of roads) {
      for (let i = 0; i < road.length - 1; i++) {
        const [x1, z1] = road[i]!;
        const [x2, z2] = road[i + 1]!;
        const len = Math.hypot(x2 - x1, z2 - z1);
        const steps = Math.max(1, Math.floor(len / 1.8));
        for (let s = 0; s < steps; s++) {
          const t = (s + 0.5) / steps;
          const x = x1 + (x2 - x1) * t;
          const z = z1 + (z2 - z1) * t;
          const nx = -(z2 - z1) / len;
          const nz = (x2 - x1) / len;
          for (const side of [1, -1]) {
            const off = 3.0 + rng() * 1.3; // clear of the 1-tile road half-width + check radius
            const hx = x + nx * off * side;
            const hz = z + nz * off * side;
            const facing = Math.atan2(x - hx, z - hz); // door toward the road
            candidates.push([hx, hz, facing]);
          }
        }
      }
    }
    // interior in-fill blocks (the reference town is dense between roads too)
    for (let i = 0; i < 300; i++) {
      const a = rng() * Math.PI * 2;
      const r = 8 + Math.sqrt(rng()) * 42;
      candidates.push([Math.cos(a) * r, Math.sin(a) * r, rng() * Math.PI * 2]);
    }
    // shuffle-ish deterministic order
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
    }
    for (const [hx, hz, facing] of candidates) {
      if (placed >= 240) break;
      if (!insidePlateau(hx, hz, 7)) continue;
      // r=1 (3×3 tiles) fits the ~2-unit house footprint without swallowing the
      // roadside strip; occupy() below still reserves 5×5 so houses keep gaps.
      if (!isFree(hx, hz, 1)) continue;
      houseGroups.push(house(hx, hz, facing, rng() > 0.8));
      houseCenters.push([hx, hz]);
      placed++;
    }
  }

  // ---------- palisade wall (instanced log posts along the plateau, inset) ----------
  // Collected so the build-from-zero cue (setBuildStage) can hide the ring for a
  // fresh Camp and raise it when 'wall' unlocks. Default state stays visible.
  const wallParts: THREE.Object3D[] = [];
  {
    const posts: [number, number][] = [];
    const N = 700;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = plateauR(a) - 2.6;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // gate gaps
      if (GATE_ANGLES.some((ga) => {
        const d = Math.atan2(Math.sin(a - ga), Math.cos(a - ga));
        return Math.abs(d) < 0.055;
      })) continue;
      posts.push([x, z]);
    }
    const postGeo = new THREE.CylinderGeometry(0.28, 0.34, 3.1, 6);
    const inst = new THREE.InstancedMesh(postGeo, lam(C.timberDark), posts.length);
    inst.castShadow = true;
    const m4 = new THREE.Matrix4();
    posts.forEach(([x, z], i) => {
      m4.makeScale(1, 0.88 + ((i * 37) % 10) / 34, 1);
      m4.setPosition(x, 1.45, z);
      inst.setMatrixAt(i, m4);
    });
    scene.add(inst);
    wallParts.push(inst);
    // gate towers
    for (const ga of GATE_ANGLES) {
      const r = plateauR(ga) - 2.6;
      for (const side of [-0.09, 0.09]) {
        const a = ga + side;
        const g = new THREE.Group();
        g.add(box(1.4, 3.4, 1.4, MAT.timberDark, 0, 1.7, 0));
        g.add(pyramid(1.8, 1.0, 1.8, MAT.roofBrown, 0, 3.9, 0));
        g.add(glowCube(0.3, 0, 3.0, 0.74));
        g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        scene.add(g);
        wallParts.push(g);
      }
    }
  }

  // ---------- forest (instanced pines: between wall and cliffs + sprinkled inside) ----------
  {
    const spots: [number, number, number][] = [];
    for (let i = 0; i < 1100; i++) {
      const a = rng() * Math.PI * 2;
      const edge = plateauR(a);
      const r = edge - 2.2 + rng() * 1.6; // just outside the palisade
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!insidePlateau(x, z, 0.5)) continue;
      if (GATE_ANGLES.some((ga) => Math.abs(Math.atan2(Math.sin(a - ga), Math.cos(a - ga))) < 0.09)) continue;
      spots.push([x, z, 0.8 + rng() * 0.9]);
      if (spots.length >= 380) break;
    }
    for (let i = 0; i < 900 && spots.length < 560; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 50;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!isFree(x, z, 1) || !insidePlateau(x, z, 6)) continue;
      spots.push([x, z, 0.7 + rng() * 0.8]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.7, 5);
    const canopyGeo = new THREE.ConeGeometry(0.75, 2.0, 7);
    const trunks = new THREE.InstancedMesh(trunkGeo, MAT.trunk, spots.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, lam(0xffffff, { flatShading: true }), spots.length);
    canopies.castShadow = true;
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    spots.forEach(([x, z, s], i) => {
      m4.makeScale(s, s, s);
      m4.setPosition(x, 0.35 * s, z);
      trunks.setMatrixAt(i, m4);
      m4.makeScale(s, s, s);
      m4.setPosition(x, (0.7 + 1.0) * s, z);
      canopies.setMatrixAt(i, m4);
      col.setHex(rng() > 0.5 ? C.leaf : C.leafDark);
      canopies.setColorAt(i, col);
    });
    scene.add(trunks, canopies);
  }

  // ---------- ambient / game-event visuals (raid light, vigil pillar, smoke) ----------
  // raid watch: something red gathers beyond the wall, outside the south gate
  const raidLight = new THREE.PointLight(0xff3a26, 0, 60);
  {
    const ga = GATE_ANGLES[0]!;
    const rr = plateauR(ga) + 8;
    raidLight.position.set(Math.cos(ga) * rr, 3, Math.sin(ga) * rr);
  }
  raidLight.visible = false;
  scene.add(raidLight);

  // vigil pillar at RELIGION — one-shot warm-gold column, opacity 0.85→0 over ~2.5s
  const markedPulseMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false });
  const markedPulse = new THREE.Mesh(new THREE.BoxGeometry(0.6, 14, 0.6), markedPulseMat);
  {
    const rel = poiMap.get('RELIGION');
    if (rel) markedPulse.position.set(rel.position.x, 7, rel.position.z);
  }
  markedPulse.visible = false;
  scene.add(markedPulse);
  let markedPulseT = -1; // <0 = idle; otherwise seconds elapsed (runs 0..2.5)

  // objective beacon: warm-gold "build here" marker parked on the next locked
  // build stage (driven by setBuildStage, hidden until it speaks and once the
  // town is fully raised). Soft additive ground disc + ring + slim light shaft,
  // opacity pulsed ~0.25..0.6 in tick; a short-range point light warms the site
  // so the objective reads at night without any postprocessing.
  const beaconDiscMat = new THREE.MeshBasicMaterial({
    color: 0xe8c34a, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const beaconShaftMat = new THREE.MeshBasicMaterial({
    color: 0xe8c34a, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  const beacon = new THREE.Group();
  const beaconDisc = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), beaconDiscMat);
  beaconDisc.rotation.x = -Math.PI / 2;
  beaconDisc.position.y = 0.07;
  const beaconRing = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.15, 28), beaconDiscMat);
  beaconRing.rotation.x = -Math.PI / 2;
  beaconRing.position.y = 0.08;
  const beaconShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.55, 9, 10, 1, true), beaconShaftMat);
  beaconShaft.position.y = 4.5;
  const beaconLight = new THREE.PointLight(0xffd27a, 8, 14, 2);
  beaconLight.position.y = 2.2;
  const beaconEl = document.createElement('div');
  beaconEl.className = 'h-owner'; // 'on' toggled by setBuildStage with the beacon
  beaconEl.textContent = '⚒ build here';
  const beaconTag = new CSS2DObject(beaconEl);
  beaconTag.position.set(0, 5.6, 0);
  beacon.add(beaconDisc, beaconRing, beaconShaft, beaconLight, beaconTag);
  beacon.visible = false;
  scene.add(beacon);

  // chimney smoke: one Points cloud, 8 motes per anchored house, rising + wrapping
  const smokePos = new Float32Array(smokeSpots.length * 8 * 3);
  smokeSpots.forEach(([sx, sz], i) => {
    for (let j = 0; j < 8; j++) {
      const o = (i * 8 + j) * 3;
      smokePos[o] = sx + (rng() - 0.5) * 0.7;
      smokePos[o + 1] = 2.2 + rng() * 2.3;
      smokePos[o + 2] = sz + (rng() - 0.5) * 0.7;
    }
  });
  const smokeGeo = new THREE.BufferGeometry();
  const smokeAttr = new THREE.BufferAttribute(smokePos, 3);
  smokeGeo.setAttribute('position', smokeAttr);
  const smoke = new THREE.Points(
    smokeGeo,
    new THREE.PointsMaterial({ color: 0x9a9a92, size: 0.5, transparent: true, opacity: 0.4, depthWrite: false }),
  );
  scene.add(smoke);

  // ---------- characters ----------
  type Actor = {
    obj: THREE.Object3D;
    mixer: THREE.AnimationMixer;
    walker?: (dt: number) => void;
    name?: string;
    // wave greeting: seconds remaining + the actions we crossfade between + tap target
    waveT?: number;
    walkAction?: THREE.AnimationAction;
    idleAction?: THREE.AnimationAction;
    hitProxy?: THREE.Mesh;
    // lazy speech-bubble kit (created on first showBubble)
    bubbleEl?: HTMLDivElement;
    bubbleObj?: CSS2DObject;
    bubbleTimer?: number | undefined;
    // lazy name tag (created on first wave), styled by .v-name / .v-name.on
    nameEl?: HTMLDivElement;
    nameObj?: CSS2DObject;
    nameTimer?: number | undefined;
  };
  const actors = new Set<Actor>();
  const orbiters = new Map<CompanionKind, { actor: Actor; radius: number; height: number; speed: number; phase: number }>();

  const loadManager = new THREE.LoadingManager();
  const loader = new GLTFLoader(loadManager);
  loadManager.onProgress = (_url, done, total) => hooks.onProgress(Math.round((done / total) * 100));
  loadManager.onLoad = () => hooks.onLoad();
  loadManager.onError = () => hooks.onProgress(100);
  const gltfCache = new Map<string, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>>();
  const loadGlb = (file: string) => {
    if (!gltfCache.has(file)) {
      gltfCache.set(file, new Promise((res, rej) => loader.load(`assets/${file}`, (g) => res(g as never), undefined, rej)));
    }
    return gltfCache.get(file)!;
  };

  function prep(root: THREE.Object3D, targetSize: number) {
    const s = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    root.scale.multiplyScalar(targetSize / Math.max(0.0001, s.x, s.y, s.z));
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    return root;
  }
  const humanize = (root: THREE.Object3D) => {
    root.scale.setScalar(0.92); // Soldier.glb is human-scale (skinned Box3 lies)
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
  };
  function makeWalker(obj: THREE.Object3D, points: [number, number][], speed: number) {
    let seg = 0;
    let t = 0;
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    return (dt: number) => {
      const a = points[seg % points.length]!;
      const b = points[(seg + 1) % points.length]!;
      from.set(a[0], 0, a[1]);
      to.set(b[0], 0, b[1]);
      const dist = from.distanceTo(to);
      t += (dt * speed) / Math.max(0.001, dist);
      if (t >= 1) { t = 0; seg = (seg + 1) % points.length; return; }
      obj.position.lerpVectors(from, to, t);
      obj.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    };
  }

  // villager routes: real road polylines (gate roads walked out-and-back, ring arcs)
  const ROUTES: { pts: [number, number][]; speed: number }[] = [];
  for (const road of roads.slice(0, 3)) {
    const there = road.slice(0, Math.max(2, road.length - 2)); // stop short of the gate
    const back = [...there].reverse().slice(1, -1);
    ROUTES.push({ pts: [...there, ...back] as [number, number][], speed: 1.35 + rng() * 0.3 });
  }
  {
    const ring = roads[3]!;
    const third = Math.floor(ring.length / 3);
    for (let i = 0; i < 3; i++) {
      const arc = ring.slice(i * third, (i + 1) * third + 1);
      const back = [...arc].reverse().slice(1, -1);
      ROUTES.push({ pts: [...arc, ...back] as [number, number][], speed: 1.15 + rng() * 0.3 });
    }
  }
  ROUTES.push({ pts: [[3, 3], [3, -3], [-3, -3], [-3, 3]], speed: 1.2 }); // plaza stroll
  ROUTES.push({ pts: roads[4]!.concat([...roads[4]!].reverse().slice(1, -1)) as [number, number][], speed: 1.25 });

  const villagers: Actor[] = [];
  let guard: Actor | null = null;
  let wantedVillagers = 4;

  // invisible tap targets: skinned-mesh raycasts are unreliable, so each villager
  // carries a fat hidden cylinder instead (Mesh.raycast ignores material.visible —
  // same trick as the build-mode groundPlane below)
  const hitGeo = new THREE.CylinderGeometry(0.7, 0.7, 2.2, 6);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const villagerHits = new Map<THREE.Object3D, Actor>();
  const villagerProxies: THREE.Mesh[] = [];

  async function syncVillagers() {
    const gltf = await loadGlb('Soldier.glb');
    if (disposed) return;
    const clips = gltf.animations;
    const clip = (re: RegExp, fb: number) => clips.find((c) => re.test(c.name)) ?? clips[fb]!;
    if (wantedVillagers > 0 && !guard) {
      const [gx, gz] = gates[0]!;
      const g = SkeletonUtils.clone(gltf.scene);
      humanize(g);
      g.position.set(gx + 1.6, 0, gz - 0.6);
      g.rotation.y = Math.atan2(-gx, -gz);
      scene.add(g);
      const mixer = new THREE.AnimationMixer(g);
      mixer.clipAction(clip(/idle/i, 0)).play();
      guard = { obj: g, mixer };
      actors.add(guard);
    }
    if (wantedVillagers === 0 && guard) {
      scene.remove(guard.obj);
      actors.delete(guard);
      guard = null;
    }
    while (villagers.length < wantedVillagers) {
      const idx = villagers.length;
      const v = SkeletonUtils.clone(gltf.scene);
      humanize(v);
      scene.add(v);
      const mixer = new THREE.AnimationMixer(v);
      const walkAction = mixer.clipAction(clip(/walk/i, 3));
      const idleAction = mixer.clipAction(clip(/idle/i, 0));
      walkAction.play();
      const proxy = new THREE.Mesh(hitGeo, hitMat);
      proxy.position.set(0, 1.1, 0);
      v.add(proxy);
      const route = ROUTES[idx % ROUTES.length]!;
      const actor: Actor = {
        obj: v,
        mixer,
        walker: makeWalker(v, route.pts, route.speed),
        name: VILLAGER_NAMES[idx % VILLAGER_NAMES.length]!,
        walkAction,
        idleAction,
        hitProxy: proxy,
      };
      villagerHits.set(proxy, actor);
      villagerProxies.push(proxy);
      villagers.push(actor);
      actors.add(actor);
    }
    while (villagers.length > wantedVillagers) {
      const actor = villagers.pop()!;
      if (actor.hitProxy) {
        villagerHits.delete(actor.hitProxy);
        villagerProxies.splice(villagerProxies.indexOf(actor.hitProxy), 1);
      }
      scene.remove(actor.obj);
      actors.delete(actor);
    }
  }

  const COMPANIONS: Record<CompanionKind, { file: string; size: number; orbit?: [number, number, number, number] }> = {
    horse: { file: 'Horse.glb', size: 2.1 },
    flamingo: { file: 'Flamingo.glb', size: 1.5, orbit: [25, 13, 0.2, 0] },
    parrot: { file: 'Parrot.glb', size: 1.5, orbit: [18, 11, 0.27, 2.2] },
    stork: { file: 'Stork.glb', size: 1.5, orbit: [34, 15, 0.16, 4.1] },
  };
  const companions = new Map<CompanionKind, Actor>();
  async function setCompanionImpl(kind: CompanionKind, on: boolean) {
    if (!on) {
      const actor = companions.get(kind);
      if (actor) {
        scene.remove(actor.obj);
        actors.delete(actor);
        companions.delete(kind);
        orbiters.delete(kind);
      }
      return;
    }
    if (companions.has(kind)) return;
    const def = COMPANIONS[kind];
    const gltf = await loadGlb(def.file);
    if (disposed || companions.has(kind)) return;
    const obj = SkeletonUtils.clone(gltf.scene);
    prep(obj, def.size);
    scene.add(obj);
    const mixer = new THREE.AnimationMixer(obj);
    if (gltf.animations[0]) mixer.clipAction(gltf.animations[0]).play();
    const actor: Actor = { obj, mixer };
    if (kind === 'horse') {
      // paddock by the PRODUCTION fields (west ring)
      const [px, pz] = ringSpot(3.3, 33);
      actor.walker = makeWalker(obj, [[px - 1, pz - 5.4], [px + 3.6, pz - 5.0], [px + 4.2, pz - 7.4], [px - 0.4, pz - 7.6]], 1.1);
    } else if (def.orbit) {
      orbiters.set(kind, { actor, radius: def.orbit[0], height: def.orbit[1], speed: def.orbit[2], phase: def.orbit[3] });
    }
    companions.set(kind, actor);
    actors.add(actor);
  }

  // ---------- raiders (visible war party menacing the main gate) ----------
  // Same async toggle shape as setCompanionImpl. Positions use plain Math.random
  // on purpose — runtime activity, not layout — so the seeded town stays intact.
  let raidersOn = false;
  const raiderActors: Actor[] = [];
  const raiderMats: THREE.Material[] = [];
  const raiderTorches: THREE.PointLight[] = [];
  const raiderTintCol = new THREE.Color(0x8a1f12);
  function clearRaiders() {
    for (const a of raiderActors) {
      scene.remove(a.obj);
      actors.delete(a);
    }
    raiderActors.length = 0;
    for (const m of raiderMats) m.dispose();
    raiderMats.length = 0;
    for (const l of raiderTorches) scene.remove(l);
    raiderTorches.length = 0;
  }
  async function setRaidersImpl(on: boolean) {
    raidersOn = on;
    if (!on) {
      clearRaiders();
      return;
    }
    if (raiderActors.length > 0) return;
    const gltf = await loadGlb('Soldier.glb');
    if (disposed || !raidersOn || raiderActors.length > 0) return;
    const walkClip = gltf.animations.find((c) => /walk/i.test(c.name)) ?? gltf.animations[3]!;
    const [gx, gz] = gates[0]!;
    const out = new THREE.Vector3(gx, 0, gz).normalize(); // gate → wilderness
    for (let i = 0; i < 5; i++) {
      const r = SkeletonUtils.clone(gltf.scene);
      humanize(r);
      // dark blood-red silhouettes: clone + darken every mesh material
      r.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        mat.color.multiplyScalar(0.35);
        mat.color.lerp(raiderTintCol, 0.45);
        mesh.material = mat;
        raiderMats.push(mat);
      });
      const dist = 6 + Math.random() * 8; // 6..14 beyond the gate
      const jitter = (Math.random() - 0.5) * 6; // ±3 lateral
      const px = gx + out.x * dist - out.z * jitter;
      const pz = gz + out.z * dist + out.x * jitter;
      r.position.set(px, 0, pz);
      scene.add(r);
      const mixer = new THREE.AnimationMixer(r);
      mixer.clipAction(walkClip).play();
      const actor: Actor = {
        obj: r,
        mixer,
        // menacing pace: scatter spot ↔ ~4 units toward the gate (makeWalker loops)
        walker: makeWalker(r, [[px, pz], [px - out.x * 4, pz - out.z * 4]], 0.9 + Math.random() * 0.4),
      };
      raiderActors.push(actor);
      actors.add(actor); // mixers/walkers tick with everyone else
    }
    // two torches among the party (flickered in tick while raiders are out)
    for (const idx of [1, 3] as const) {
      const at = raiderActors[idx]!.obj.position;
      const torch = new THREE.PointLight(0xff6a2a, 30, 18, 2);
      torch.position.set(at.x, 2, at.z);
      scene.add(torch);
      raiderTorches.push(torch);
    }
  }

  void syncVillagers();
  void setCompanionImpl('horse', true);
  void setCompanionImpl('flamingo', true);
  void setCompanionImpl('parrot', true);
  void setCompanionImpl('stork', true);

  // ---------- villager speech bubbles + ambient chatter ----------
  function showBubble(actor: Actor, text: string, seconds: number) {
    if (!actor.bubbleEl) {
      const el = document.createElement('div');
      el.className = 'v-bubble';
      const obj = new CSS2DObject(el);
      obj.position.set(0, 2.2, 0); // above the model root
      actor.obj.add(obj);
      actor.bubbleEl = el;
      actor.bubbleObj = obj;
    }
    actor.bubbleEl.textContent = text;
    actor.bubbleEl.classList.add('on');
    if (actor.bubbleTimer !== undefined) window.clearTimeout(actor.bubbleTimer);
    actor.bubbleTimer = window.setTimeout(() => {
      actor.bubbleEl?.classList.remove('on');
      actor.bubbleTimer = undefined;
    }, seconds * 1000);
  }

  const CHATTER = [
    'hii 👋',
    'gm city 🌅',
    "who's on wall duty tonight?",
    'the greenhouse smells like rain',
    'heard raiders were sighted east',
    'we need more food before dawn',
    'u/overseer says hold the line',
    'did anyone check on Mira?',
    'one more dawn, friends',
    'trade rumors from r/ironhollow…',
  ];
  let chatIdx = 0;
  const chatTimer = window.setInterval(() => {
    if (villagers.length === 0) return;
    const v = villagers[Math.floor(rng() * villagers.length)]!;
    const text = CHATTER[chatIdx % CHATTER.length]!;
    chatIdx++;
    showBubble(v, text, 4);
    hooks.onChat?.(v.name!, text); // the speaker's own name — villagers are always named
  }, 9000);

  function say(text: string) {
    const speaker = villagers.length > 0 ? villagers[Math.floor(rng() * villagers.length)]! : guard;
    if (!speaker) return;
    showBubble(speaker, text, 5); // no onChat echo — the HUD adds its own row
  }

  function sayTo(name: string, text: string) {
    const speaker = villagers.find((a) => a.name === name)
      ?? (villagers.length > 0 ? villagers[Math.floor(rng() * villagers.length)]! : guard);
    if (!speaker) return;
    showBubble(speaker, text, 5);
  }

  // name tag: second CSS2D element above the bubble, shown while greeting (~4s).
  // CSS2DRenderer owns these elements' inline transform — visibility is class-only.
  function showNameTag(actor: Actor) {
    if (!actor.name) return;
    if (!actor.nameEl) {
      const el = document.createElement('div');
      el.className = 'v-name';
      el.textContent = actor.name;
      const obj = new CSS2DObject(el);
      obj.position.set(0, 2.75, 0); // above the bubble
      actor.obj.add(obj);
      actor.nameEl = el;
      actor.nameObj = obj;
    }
    actor.nameEl.classList.add('on');
    if (actor.nameTimer !== undefined) window.clearTimeout(actor.nameTimer);
    actor.nameTimer = window.setTimeout(() => {
      actor.nameEl?.classList.remove('on');
      actor.nameTimer = undefined;
    }, 4000);
  }

  // wave greeting: Soldier.glb has no wave clip (Idle/Run/TPose/Walk), so fake it —
  // crossfade walk→idle, then tick() faces the camera + hops/sways until waveT runs out
  function startWave(actor: Actor) {
    if (!actor.waveT) {
      actor.walkAction?.fadeOut(0.2);
      actor.idleAction?.reset().fadeIn(0.2).play();
    }
    actor.waveT = 2.6;
    showBubble(actor, '👋', 2.5);
    showNameTag(actor);
  }

  function waveAt(name: string) {
    const v = villagers.find((a) => a.name === name);
    if (v) startWave(v);
  }

  // publish the district directory to the React dashboard
  hooks.onPois?.(poiList);

  // ---------- camera fly-to (dashboard navigation) ----------
  let fly: { tgt: THREE.Vector3; pos: THREE.Vector3 } | null = null;
  function focusOn(name: string) {
    const group = poiMap.get(name);
    if (!group) return;
    const tgt = new THREE.Vector3(group.position.x, 1.2, group.position.z);
    // keep the current viewing azimuth; come in at a readable close distance
    const dir = camera.position.clone().sub(controls.target);
    dir.y = 0;
    if (dir.lengthSq() < 1) dir.set(0.4, 0, 1);
    dir.normalize();
    const pos = tgt.clone().addScaledVector(dir, 24);
    pos.y = 17;
    fly = { tgt, pos };
    setSelected(group);
    const { name: n, level, blurb } = group.userData as BuildingMeta;
    hooks.onSelect({ name: n, level, blurb });
  }
  // like focusOn but at a bare ground point (minimap tap on empty land): same
  // azimuth-preserving fly, no selection/onSelect since there's no building here
  function focusPoint(x: number, z: number) {
    const tgt = new THREE.Vector3(x, 1.2, z);
    const dir = camera.position.clone().sub(controls.target);
    dir.y = 0;
    if (dir.lengthSq() < 1) dir.set(0.4, 0, 1);
    dir.normalize();
    const pos = tgt.clone().addScaledVector(dir, 24);
    pos.y = 17;
    fly = { tgt, pos };
  }

  // ---------- minimap data + camera read-out (React HUD draws the minimap) ----------
  function getMapData(): MapData {
    // sample the plateau boundary at 64 even angles; radius = the sweep max
    const outline: [number, number][] = [];
    let radius = 0;
    const N = 64;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = plateauR(a);
      if (r > radius) radius = r;
      outline.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    // Only VISIBLE districts/houses appear on the map — a fresh Camp's minimap
    // must be as bare as its town (grow-in drives group.visible, see
    // setBuildStage/setHouses).
    const districts: { name: string; icon: string; x: number; z: number }[] = [];
    for (const [name, group] of poiMap) {
      if (!group.visible) continue;
      const icon = (group.userData.icon as string | undefined)
        ?? poiList.find((p) => p.name === name)?.icon
        ?? '📍';
      districts.push({ name, icon, x: group.position.x, z: group.position.z });
    }
    const houses = houseGroups
      .filter((g) => g.visible)
      .map((g) => [g.position.x, g.position.z] as [number, number]);
    return { radius, outline, districts, houses };
  }
  function getView() {
    return { cx: camera.position.x, cz: camera.position.z, tx: controls.target.x, tz: controls.target.z, fov: camera.fov };
  }

  // ---------- district flash (ring blast + y-pop, driven per-frame in tick) ----------
  const flashes: { ring: THREE.Mesh; mat: THREE.MeshBasicMaterial; group: THREE.Group; t: number }[] = [];
  function flashDistrict(name: string) {
    const group = poiMap.get(name);
    if (!group) return;
    const ring = group.userData.ring as THREE.Mesh | undefined;
    if (!ring) return;
    const existing = flashes.find((f) => f.ring === ring);
    if (existing) {
      existing.t = 0; // retrigger in place
      return;
    }
    flashes.push({ ring, mat: ring.material as THREE.MeshBasicMaterial, group, t: 0 });
  }

  // ---------- hover / select ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered: THREE.Group | null = null;
  let selected: THREE.Group | null = null;
  const rootOf = (obj: THREE.Object3D | null): THREE.Group | null => {
    let cur: THREE.Object3D | null = obj;
    while (cur && !(cur.userData as BuildingMeta).name) cur = cur.parent;
    return (cur as THREE.Group) ?? null;
  };
  const pick = (clientX: number, clientY: number): THREE.Group | null => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(interactables, true)[0];
    return hit ? rootOf(hit.object) : null;
  };
  /** Pointer → villager via the invisible hit proxies (null if none under it). */
  const pickVillager = (clientX: number, clientY: number): Actor | null => {
    if (villagerProxies.length === 0) return null;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(villagerProxies, false)[0];
    return hit ? (villagerHits.get(hit.object) ?? null) : null;
  };
  // tap-to-reveal owner tags: houses whose owner is known (named contributors,
  // fed by setHouses below) get a ~4s name reveal on tap instead of a permanent
  // label. One reusable CSS2D pill moves onto whichever house was tapped;
  // visibility is class-only ('on'), same rules as the villager name tags.
  const houseOwners = new Map<THREE.Group, string>();
  const ownedHouseGroups: THREE.Group[] = [];
  const houseTagEl = document.createElement('div');
  houseTagEl.className = 'h-owner';
  const houseTag = new CSS2DObject(houseTagEl);
  houseTag.position.set(0, 2.7, 0);
  let houseTagTimer: number | undefined;
  const houseOf = (obj: THREE.Object3D | null): THREE.Group | null => {
    let cur: THREE.Object3D | null = obj;
    while (cur && !houseOwners.has(cur as THREE.Group)) cur = cur.parent;
    return (cur as THREE.Group) ?? null;
  };
  /** Pointer → owned house group (null if the tap missed every named house). */
  const pickHouse = (clientX: number, clientY: number): THREE.Group | null => {
    if (ownedHouseGroups.length === 0) return null;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(ownedHouseGroups, true)[0];
    return hit ? houseOf(hit.object) : null;
  };
  function showHouseTag(g: THREE.Group) {
    const name = houseOwners.get(g);
    if (!name) return;
    houseTagEl.textContent = name;
    houseTag.removeFromParent();
    g.add(houseTag);
    houseTagEl.classList.add('on');
    if (houseTagTimer !== undefined) window.clearTimeout(houseTagTimer);
    houseTagTimer = window.setTimeout(() => {
      houseTagEl.classList.remove('on');
      houseTagTimer = undefined;
    }, 4000);
  }
  const setRingVis = (group: THREE.Group | null, on: boolean) => {
    const ring = group?.userData.ring as THREE.Mesh | undefined;
    if (ring) ring.visible = on;
  };
  function setSelected(g: THREE.Group | null) {
    if (selected && selected !== g) setRingVis(selected, false);
    selected = g;
    if (g) setRingVis(g, true);
  }

  // ---------- build mode (ghost hut placement) ----------
  // invisible ground catcher: raycast target for pointer→tile mapping
  // (Mesh.raycast ignores material.visible, so this stays hit-testable)
  const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({ visible: false }));
  groundPlane.rotation.x = -Math.PI / 2;
  groundPlane.position.y = 0;
  scene.add(groundPlane);
  const ghostMat = new THREE.MeshBasicMaterial({ color: C.roofGold, transparent: true, opacity: 0.35, depthWrite: false });
  const ghost = new THREE.Group();
  {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 1.6), ghostMat);
    body.position.y = 0.5;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 4), ghostMat);
    roof.scale.set(1.6 * 1.42, 0.8, 1.6 * 1.42);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 1.4;
    ghost.add(body, roof);
  }
  ghost.visible = false;
  scene.add(ghost);
  let buildMode = false;
  // Single-tile check on purpose: the town is packed (houses occupy 5×5 blocks,
  // roads 3 tiles wide), so a 3×3 free requirement rejects nearly everything.
  // One clear tile reads fine — dense is the aesthetic.
  const buildValid = (x: number, z: number) => insidePlateau(x, z, 4) && isFree(x, z, 0);
  /** Pointer → snapped ground tile via the invisible plane (null if off-world). */
  const groundTileAt = (clientX: number, clientY: number): [number, number] | null => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(groundPlane, false)[0];
    return hit ? [Math.round(hit.point.x), Math.round(hit.point.z)] : null;
  };
  function setBuildMode(on: boolean) {
    buildMode = on;
    renderer.domElement.style.cursor = on ? 'crosshair' : 'grab';
    if (!on) ghost.visible = false;
  }

  // ---------- house ownership (runtime purchases) ----------
  // Plain Math.random on purpose: this is live activity, not layout — consuming
  // the seeded rng here would still be harmless post-build, but sampling must
  // not depend on it so the deterministic town stays byte-identical in tests.
  const ownerTimers = new Set<number>();
  const nearRoad = (x: number, z: number, d: number) => {
    for (let dx = -d; dx <= d; dx++) {
      for (let dz = -d; dz <= d; dz++) {
        if (roadTiles.has(key(x + dx, z + dz))) return true;
      }
    }
    return false;
  };
  function buyHouse(owner: string): { x: number; z: number; quarter: string } | null {
    // sample tiles inside the plateau: prefer a spot within ~2 tiles of a road,
    // fall back to any valid tile seen along the way
    let roadside: [number, number] | null = null;
    let anywhere: [number, number] | null = null;
    for (let i = 0; i < 80 && !roadside; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 60;
      const x = Math.round(Math.cos(a) * r);
      const z = Math.round(Math.sin(a) * r);
      if (!buildValid(x, z)) continue;
      if (nearRoad(x, z, 2)) roadside = [x, z];
      else if (!anywhere) anywhere = [x, z];
    }
    const spot = roadside ?? anywhere;
    if (!spot) return null;
    const [x, z] = spot;
    house(x, z, Math.random() * Math.PI * 2); // adds to scene + occupies
    houseCenters.push([x, z]);

    // temporary owner tag above the new roof — visibility is class-only
    // (CSS2DRenderer overwrites the element's inline transform every frame)
    const el = document.createElement('div');
    el.className = 'h-owner';
    el.textContent = owner;
    const tag = new CSS2DObject(el);
    tag.position.set(x, 2.6, z);
    scene.add(tag);
    // timeout, not rAF: rAF never fires in hidden tabs, which would leave the
    // label permanently transparent there — 30ms is late enough for the transition
    const revealTimer = window.setTimeout(() => {
      ownerTimers.delete(revealTimer);
      el.classList.add('on');
    }, 30);
    ownerTimers.add(revealTimer);
    const timer = window.setTimeout(() => {
      ownerTimers.delete(timer);
      scene.remove(tag);
      el.remove();
    }, 7000);
    ownerTimers.add(timer);

    const quarter = Math.abs(x) > Math.abs(z) ? (x < 0 ? 'west' : 'east') : (z < 0 ? 'north' : 'south');
    return { x, z, quarter };
  }

  const onMove = (e: PointerEvent) => {
    if (buildMode) {
      // ghost hut follows the pointer; hover rings are suppressed while placing
      const tile = groundTileAt(e.clientX, e.clientY);
      if (tile) {
        ghost.visible = true;
        ghost.position.set(tile[0], 0, tile[1]);
        ghostMat.color.setHex(buildValid(tile[0], tile[1]) ? C.roofGold : 0xc85040);
      } else {
        ghost.visible = false;
      }
      return;
    }
    if (e.pointerType !== 'mouse') return;
    const g = pick(e.clientX, e.clientY);
    if (g !== hovered) {
      if (hovered !== selected) setRingVis(hovered, false);
      hovered = g;
      if (hovered) setRingVis(hovered, true);
      renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab';
    }
    // villagers hover too (no ring — just the pointer cursor over a hit proxy)
    if (!hovered) renderer.domElement.style.cursor = pickVillager(e.clientX, e.clientY) ? 'pointer' : 'grab';
  };
  let downAt: [number, number] | null = null;
  const onDown = (e: PointerEvent) => {
    fly = null; // grabbing the camera cancels any dashboard fly-to
    downAt = [e.clientX, e.clientY];
  };
  const onUp = (e: PointerEvent) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 8) return;
    if (buildMode) {
      // build owns taps: place if valid, stay in build mode (HUD exits it)
      const tile = groundTileAt(e.clientX, e.clientY);
      if (tile && buildValid(tile[0], tile[1])) {
        house(tile[0], tile[1], rng() * Math.PI * 2); // adds to scene + occupies
        houseCenters.push([tile[0], tile[1]]);
        hooks.onBuilt?.(tile[0], tile[1]);
        ghost.visible = false;
      }
      return;
    }
    // villagers take tap priority over buildings: greet + notify the HUD
    const tapped = pickVillager(e.clientX, e.clientY);
    if (tapped) {
      startWave(tapped);
      hooks.onVillager?.(tapped.name ?? null);
      return;
    }
    const g = pick(e.clientX, e.clientY);
    setSelected(g);
    if (g) {
      const { name, level, blurb } = g.userData as BuildingMeta;
      hooks.onSelect({ name, level, blurb });
    } else {
      // named contributor house? reveal its owner tag for a few seconds
      // (the HUD still sees an empty tap, so App behavior is unchanged)
      const h = pickHouse(e.clientX, e.clientY);
      if (h) showHouseTag(h);
      hooks.onSelect(null);
      hooks.onVillager?.(null);
    }
  };
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);

  // ---------- main loop ----------
  const clock = new THREE.Clock();
  const flagged = interactables.find((g) => g.userData.flag);
  const tick = () => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    if (fly) {
      const k = 1 - Math.exp(-dt * (introMaxRestore !== null ? 1.6 : 3.2));
      controls.target.lerp(fly.tgt, k);
      camera.position.lerp(fly.pos, k);
      if (camera.position.distanceTo(fly.pos) < 0.4) {
        fly = null;
        // intro flyover done — restore the normal zoom clamp
        if (introMaxRestore !== null) {
          controls.maxDistance = introMaxRestore;
          introMaxRestore = null;
        }
      }
    }
    controls.update();
    lerpEnv(dt);
    for (const a of actors) {
      a.mixer.update(dt);
      // wave greeting: pause the walk, face the camera, hop + sway until waveT runs out
      if (a.waveT !== undefined && a.waveT > 0) {
        a.waveT -= dt;
        if (a.waveT <= 0) {
          a.waveT = 0;
          a.obj.position.y = 0;
          a.obj.rotation.z = 0;
          a.idleAction?.fadeOut(0.2);
          a.walkAction?.reset().fadeIn(0.2).play();
        } else {
          const w = 2.6 - a.waveT; // elapsed wave time
          a.obj.rotation.y = Math.atan2(camera.position.x - a.obj.position.x, camera.position.z - a.obj.position.z);
          a.obj.position.y = Math.abs(Math.sin(w * 7)) * 0.14;
          a.obj.rotation.z = Math.sin(w * 10) * 0.08;
          continue; // walker must not run this frame
        }
      }
      a.walker?.(dt);
    }
    for (const [, o] of orbiters) {
      const a = t * o.speed + o.phase;
      o.actor.obj.position.set(Math.cos(a) * o.radius, o.height + Math.sin(t * 1.7 + o.phase) * 0.6, Math.sin(a) * o.radius);
      o.actor.obj.rotation.y = -a;
    }
    if (flagged) (flagged.userData.flag as THREE.Mesh).rotation.y = Math.sin(t * 2.4) * 0.35;
    if (rotor) rotor.rotation.z = t * 1.6;
    fireLight.intensity = Math.max(0, env.campfire + Math.sin(t * 9.3) * env.campfire * 0.25 + Math.sin(t * 23.7) * env.campfire * 0.12);
    // raid ambience: slow ominous pulse beyond the gate + window-glow flicker
    // (glowMat.color was freshly copied from env.windowCol in lerpEnv above,
    // so the multiply never accumulates frame-over-frame)
    raidLight.visible = raidTint > 0.002;
    if (raidLight.visible) {
      raidLight.intensity = raidTint * (50 + Math.sin(t * 1.7) * 12 + Math.sin(t * 4.3) * 5);
      glowMat.color.multiplyScalar(1 + 0.15 * Math.sin(t * 7) * raidTint);
    } else {
      raidLight.intensity = 0;
    }
    // raider torches: fast firelight flicker while the war party is out
    if (raidersOn && raiderTorches.length > 0) {
      const torchInt = 30 + Math.sin(t * 11) * 8 + Math.sin(t * 23) * 4;
      for (const torch of raiderTorches) torch.intensity = torchInt;
    }
    // objective beacon: slow warm pulse (disc 0.25..0.6) + ring breathe
    if (beacon.visible) {
      const bp = 0.5 + 0.5 * Math.sin(t * 2.2);
      beaconDiscMat.opacity = 0.25 + 0.35 * bp;
      beaconShaftMat.opacity = 0.1 + 0.14 * bp;
      beaconRing.scale.setScalar(1 + bp * 0.12);
      beaconLight.intensity = 5 + bp * 5;
    }
    // vigil pillar: one-shot fade + gentle vertical stretch
    if (markedPulseT >= 0) {
      markedPulseT += dt;
      const p = markedPulseT / 2.5;
      if (p >= 1) {
        markedPulseT = -1;
        markedPulse.visible = false;
      } else {
        markedPulse.visible = true;
        markedPulseMat.opacity = 0.85 * (1 - p);
        markedPulse.scale.set(1, 1 + p * 0.35, 1);
      }
    }
    // district flashes: ring 1→1.6 / opacity .9→0 + group y-pop over 1.2s
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i]!;
      f.t += dt;
      const p = f.t / 1.2;
      if (p >= 1) {
        f.ring.scale.setScalar(1);
        f.mat.opacity = 0.9;
        f.ring.visible = selected === f.group; // restore selection ring state
        f.group.scale.y = 1;
        flashes.splice(i, 1);
      } else {
        f.ring.visible = true;
        f.ring.scale.setScalar(1 + p * 0.6);
        f.mat.opacity = 0.9 * (1 - p);
        f.group.scale.y = 1 + Math.sin(p * Math.PI) * 0.06;
      }
    }
    // chimney smoke: motes rise and wrap 2.2..5.2
    for (let i = 1; i < smokePos.length; i += 3) {
      const y = smokePos[i]! + dt * 0.5;
      smokePos[i] = y > 5.2 ? y - 3.0 : y;
    }
    smokeAttr.needsUpdate = true;
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };
  // Intro flyover: start high and far, glide down onto the town (slower fly
  // damping while introMaxRestore is set). Skipped for reduced-motion users.
  let introMaxRestore: number | null = null;
  try {
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      const restPos = camera.position.clone();
      const restTgt = controls.target.clone();
      introMaxRestore = controls.maxDistance;
      controls.maxDistance = 500; // let the intro start outside the normal clamp
      camera.position.set(restPos.x + 70, restPos.y * 2.4, restPos.z * 2.2);
      fly = { tgt: restTgt, pos: restPos };
    }
  } catch {
    /* cosmetic only — never block the scene */
  }
  renderer.setAnimationLoop(tick);

  // ---------- build-from-zero progression cue (setBuildStage) ----------
  // A tiny, additive overlay on top of the finished town: hide the palisade for a
  // fresh "Camp" and reveal a handful of persistent landmarks as buildings unlock.
  // Every landmark mesh is created ONCE (lazily, on the first call) and only its
  // `.visible` is toggled afterwards, so repeated / growing calls are idempotent
  // and never leak. Geometry + materials live in the scene graph, so dispose()'s
  // existing traverse-sweep frees them — no extra bookkeeping needed. Until the
  // first call the scene keeps its full-town look (safe QA / screenshot fallback).
  let buildLandmarks: { camp: THREE.Group; farm: THREE.Group; tower: THREE.Group; shelter: THREE.Group } | null = null;
  function ensureBuildLandmarks() {
    if (buildLandmarks) return buildLandmarks;
    // basic (unlit) ember material so the hearth reads as "lit" at any hour
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xff8a3a, fog: false });

    // central hearth — the one thing a brand-new Camp always has
    const camp = new THREE.Group();
    camp.add(cyl(0.9, 0.16, MAT.stoneDark, 0, 0.08, 0, 12));
    const ember1 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), emberMat);
    ember1.position.set(0, 0.34, 0);
    const ember2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), emberMat);
    ember2.position.set(0.16, 0.54, 0.1);
    camp.add(ember1, ember2);
    const log1 = cyl(0.09, 1.2, MAT.timberDark, 0, 0.24, 0, 6); log1.rotation.z = 0.9;
    const log2 = cyl(0.09, 1.2, MAT.timberDark, 0, 0.24, 0, 6); log2.rotation.x = 0.9;
    camp.add(log1, log2);
    const campFire = new THREE.PointLight(0xff9a4a, 16, 24); // child → group.visible gates it
    campFire.position.set(0, 1.2, 0);
    camp.add(campFire);
    // a few tents ring the hearth so a fresh Camp reads as a camp, not a bare fire
    for (const [tx, tz, ry] of [[-2.6, -0.4, 0.3], [2.7, -0.9, -0.5], [-1.9, 2.3, 1.1], [2.1, 2.5, -0.8]] as const) {
      const tent = new THREE.Group();
      tent.add(pyramid(1.5, 1.25, 1.5, MAT.plaster, 0, 0.62, 0));
      tent.add(box(0.34, 0.5, 0.06, MAT.timberDark, 0, 0.25, 0.76));
      tent.position.set(tx, 0, tz);
      tent.rotation.y = ry;
      camp.add(tent);
    }
    camp.position.set(0, 0, 9);
    camp.visible = false;
    scene.add(camp);

    // small farm patch near the centre (tilled base + crop rows)
    const farm = new THREE.Group();
    farm.add(box(5.0, 0.12, 4.0, MAT.cropDark, 0, 0.06, 0));
    for (let r = 0; r < 4; r++) farm.add(box(4.4, 0.2, 0.4, MAT.crop, 0, 0.18, -1.35 + r * 0.9));
    farm.position.set(-11, 0, 6);
    farm.visible = false;
    scene.add(farm);

    // simple watchtower just inside the south gate (thin box + small roof cone)
    const tower = new THREE.Group();
    tower.add(box(1.3, 4.4, 1.3, MAT.timber, 0, 2.2, 0));
    tower.add(box(1.7, 0.3, 1.7, MAT.timberDark, 0, 4.4, 0));
    tower.add(pyramid(1.9, 1.2, 1.9, MAT.roofBrown, 0, 5.15, 0));
    tower.add(glowCube(0.3, 0, 3.4, 0.68));
    {
      const [g0x, g0z] = gates[0]!; // south gate (+z); step inward toward centre
      tower.position.set(g0x, 0, g0z - 5);
    }
    tower.visible = false;
    scene.add(tower);

    // highlighted starter shelter beside the hearth (gold roof marks it "first")
    const shelter = new THREE.Group();
    shelter.add(box(2.0, 1.1, 1.6, MAT.plaster, 0, 0.55, 0));
    shelter.add(pyramid(2.3, 0.9, 1.9, lam(C.roofGold), 0, 1.45, 0));
    shelter.add(box(0.4, 0.6, 0.08, MAT.timberDark, 0, 0.3, 0.82));
    shelter.position.set(3, 0, 10);
    shelter.rotation.y = -0.5;
    shelter.visible = false;
    scene.add(shelter);

    buildLandmarks = { camp, farm, tower, shelter };
    return buildLandmarks;
  }
  // Grow-in order: pre-placed houses and the labeled districts, each sorted by
  // distance from the camp hearth (0,0,9) so the town fills outward from the
  // camp as buildings are raised. Built lazily on the first setBuildStage call.
  let growOrder: { houses: THREE.Group[]; districts: THREE.Group[] } | null = null;
  function ensureGrowOrder() {
    if (growOrder) return growOrder;
    const d2 = (g: THREE.Object3D) => (g.position.x - 0) ** 2 + (g.position.z - 9) ** 2;
    const houses = [...houseGroups].sort((a, b) => d2(a) - d2(b));
    const districts = [...poiMap.values()].sort((a, b) => d2(a) - d2(b));
    growOrder = { houses, districts };
    return growOrder;
  }
  // canonical stage order (mirrors the server's build progression) so the
  // objective beacon can park itself on the FIRST still-locked site.
  const BUILD_ORDER = ['shelter', 'farm', 'clinic', 'watchtower', 'storehouse', 'wall', 'council_hall'];
  function beaconSiteFor(id: string): [number, number] {
    const [g0x, g0z] = gates[0]!;
    switch (id) {
      case 'shelter': return [3, 10]; // the starter shelter's spot
      case 'farm': return [-11, 6];
      case 'watchtower': return [g0x, g0z - 5];
      case 'wall': return [g0x, g0z - 2]; // just inside the south gate
      case 'storehouse': {
        const p = poiMap.get('STORAGE');
        return p ? [p.position.x, p.position.z] : [0, 9];
      }
      case 'council_hall': {
        const p = poiMap.get('ASSEMBLY');
        return p ? [p.position.x, p.position.z] : [0, 9];
      }
      default: return [-5, 12]; // clinic + any future id: beside the camp hearth
    }
  }
  function setBuildStage(unlocked: string[]) {
    try {
      const set = Array.isArray(unlocked) ? unlocked : [];
      const has = (id: string) => set.includes(id);
      const L = ensureBuildLandmarks();
      // the hearth + tents are present the moment the build system drives the scene
      L.camp.visible = true;
      L.farm.visible = has('farm');
      L.tower.visible = has('watchtower');
      L.shelter.visible = has('shelter');
      // headline cue: the wall is down for a fresh Camp, and goes up on 'wall'.
      // clinic / storehouse / council_hall are intentional no-ops for V1.
      const wallUp = has('wall');
      for (const part of wallParts) part.visible = wallUp;

      // Districts (civic amenities) reveal with the shared build stage. Houses
      // are driven separately, by contributor count — see setHouses().
      const { districts } = ensureGrowOrder();
      const frac = Math.min(1, set.length / 7);
      const nDist = Math.round(districts.length * frac);
      districts.forEach((g, i) => (g.visible = i < nDist));

      // objective beacon: glow on the first locked stage; fully built = hidden
      const next = BUILD_ORDER.find((id) => !has(id)) ?? null;
      beacon.visible = next !== null;
      beaconEl.classList.toggle('on', next !== null);
      if (next !== null) {
        const [bx, bz] = beaconSiteFor(next);
        beacon.position.set(bx, 0, bz);
      }
    } catch {
      /* purely cosmetic overlay — never throw into the caller */
    }
  }

  // ---------- one-redditor-one-house overlay (setHouses) ----------
  // Houses reveal by CONTRIBUTOR COUNT (not build stage): index 0 is the founding
  // house, your house is highlighted, and notable houses scale by tier
  // scales the notable houses. Idempotent — decor is cleared + re-applied each call.
  const houseDecor: THREE.Object3D[] = [];
  const TIER_SCALE = [1, 1, 1.16, 1.32, 1.5]; // by tier 0..4
  const clearHouseDecor = () => {
    for (const o of houseDecor) {
      o.parent?.remove(o);
      o.traverse((c) => {
        const mesh = c as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
        else mat?.dispose?.();
      });
      (o as unknown as CSS2DObject).element?.remove();
    }
    houseDecor.length = 0;
  };
  const labelHouse = (g: THREE.Group, text: string, y: number) => {
    const el = document.createElement('div');
    el.className = 'h-owner on';
    el.textContent = text;
    const tag = new CSS2DObject(el);
    tag.position.set(0, y, 0);
    g.add(tag);
    houseDecor.push(tag);
  };
  const ringHouse = (g: THREE.Group) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.7, 2.0, 24),
      new THREE.MeshBasicMaterial({ color: C.roofGold, transparent: true, opacity: 0.85, side: THREE.DoubleSide, fog: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    g.add(ring);
    houseDecor.push(ring);
  };
  function setHouses(summary: SceneHouses | null) {
    try {
      const { houses } = ensureGrowOrder();
      const total = Math.max(0, Math.min(houses.length, Math.round(summary?.total ?? 0)));
      houses.forEach((g, i) => {
        g.visible = i < total;
        g.scale.setScalar(1);
      });
      clearHouseDecor();
      houseOwners.clear();
      ownedHouseGroups.length = 0;
      if (!summary || total === 0) return;
      const scaleFor = (t: number) => TIER_SCALE[Math.max(0, Math.min(4, Math.round(t)))] ?? 1;
      const yours = summary.yours;
      const currentUsername = summary.currentUsername || 'you';
      // founding house — nearest the camp centre (index 0)
      const founder = houses[0];
      if (founder) {
        founder.scale.setScalar(1.5);
        ringHouse(founder);
        const label = yours && yours.index === 0 ? `🏛 u/${currentUsername} (founder)` : `🏛 u/${summary.founder?.username ?? 'founder'}`;
        labelHouse(founder, label, 3.0);
      }
      // your house (if not the founder)
      if (yours && yours.index > 0 && yours.index < total) {
        const g = houses[yours.index]!;
        g.scale.setScalar(scaleFor(yours.tier));
        ringHouse(g);
        labelHouse(g, `u/${currentUsername}`, 2.7);
      }
      // Named contributors scale by tier. Founder and current player remain the
      // only persistent labels so the city stays readable at the default zoom;
      // named houses reveal their owner on tap instead (see pickHouse/onUp).
      for (const n of summary.named ?? []) {
        if (n.index <= 0 || n.index >= total) continue;
        if (yours && n.index === yours.index) continue; // already labelled as yours
        const g = houses[n.index]!;
        g.scale.setScalar(scaleFor(n.tier));
        houseOwners.set(g, `u/${n.username}`);
        ownedHouseGroups.push(g);
      }
    } catch {
      /* cosmetic overlay — never throw into the caller */
    }
  }

  const handle: VillageHandle = {
    setTimeOfDay: (tod) => {
      target = PRESETS[tod];
    },
    setVillagers: (n) => {
      wantedVillagers = Math.max(0, Math.min(MAX_VILLAGERS, Math.round(n)));
      void syncVillagers();
    },
    setCompanion: (kind, on) => {
      void setCompanionImpl(kind, on);
    },
    focusOn,
    setRaidWatch: (on) => {
      raidOn = on;
    },
    setRaiders: (on) => {
      void setRaidersImpl(on);
    },
    pulseMarked: () => {
      markedPulseT = 0; // restart the vigil pulse (retriggerable)
    },
    say,
    sayTo,
    waveAt,
    setBuildMode,
    setBuildStage,
    setHouses,
    setDistantCities: (cities) => {
      try {
        applyDistantCities(Array.isArray(cities) ? cities : []);
      } catch {
        /* cosmetic overlay — never throw into the caller */
      }
    },
    buyHouse,
    flashDistrict,
    getMapData,
    getView,
    focusPoint,
    pause: () => renderer.setAnimationLoop(null),
    resume: () => renderer.setAnimationLoop(tick),
    frame: () => tick(),
    dispose: () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      window.clearInterval(chatTimer);
      clearRaiders(); // drops cloned raider materials before the scene sweep
      for (const t of ownerTimers) window.clearTimeout(t);
      ownerTimers.clear();
      for (const a of actors) {
        if (a.bubbleTimer !== undefined) window.clearTimeout(a.bubbleTimer);
        if (a.nameTimer !== undefined) window.clearTimeout(a.nameTimer);
      }
      if (houseTagTimer !== undefined) window.clearTimeout(houseTagTimer);
      ro.disconnect();
      window.removeEventListener('resize', size);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
    },
  };

  (window as unknown as Record<string, unknown>).__village = { ...handle, camera, controls, scene, renderer };
  return handle;
}
