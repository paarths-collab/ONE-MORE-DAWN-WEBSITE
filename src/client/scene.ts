// ONE MORE DAWN — 3D town scene v3 ("the guild map").
// A connected mainland settlement: seeded winding dirt roads, ~240 rustic
// houses, 12 labeled districts, a palisade, dense frontier forest, and shared
// land districts that open outward as the subreddit funds them.
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

/** Equipped cosmetic item ids by slot (ids come from shared/shop.ts SHOP_CATALOG). */
export type HouseCosmetics = {
  roof?: string | undefined;
  banner?: string | undefined;
  light?: string | undefined;
  yard?: string | undefined;
};

/** Snapshot the React HUD reads (via getMapData) to draw its live minimap. */
export type MapData = {
  radius: number;                                              // max developed-city radius (scale hint)
  outline: [number, number][];                                 // developed-city boundary polygon, world XZ
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
   * Dress the current player's house (the one setHouses marks as yours) with
   * equipped shop cosmetics. The equipped map is stored and re-applied after
   * every setHouses remap, so cosmetics survive refreshes. Passing null clears.
   * Unknown item ids are ignored. Never throws.
   */
  setHouseCosmetics: (equipped: HouseCosmetics | null) => void;
  /**
   * Update the protective energy dome: a translucent hemisphere over the whole
   * city, split into 6 arc panels. `segments` are the 6 panel shields (0..100):
   * ~100 = a bright, near-clear shimmer; mid = dimmer; low = hairline cracks;
   * 0 = a dark shattered gap. Panels ease smoothly toward the new values. Builds
   * the dome lazily, so it is safe to call before the scene finishes; idempotent
   * and never throws. Extra entries beyond 6 are ignored.
   */
  setDome: (segments: number[]) => void;
  /**
   * Play the stylized dome raid cinematic (6-14s, pooled + self-terminating).
   * Shifts the sky red-orange, then drops each fireball straight down from high
   * above onto its target dome `segment`, staggered. A `blocked` fireball strikes
   * the panel with an energy ripple + spark and stops (the panel flares, then
   * dims); an unblocked one pierces the panel (a white flash + momentary gap) and
   * continues down to a house from `hitHouseIndices` (round-robin), landing with
   * the existing flash, ember burst, dust ring, lingering plume and scene shake.
   * 'breach'/'fallen' break a wall segment and leave lingering smoke; 'fallen'
   * hazes the whole town. Never throws.
   */
  playRaidCinematic: (opts: { outcome: 'held' | 'breach' | 'fallen'; fireballs: { power: number; segment: number; blocked: boolean }[]; hitHouseIndices: number[] }) => void;
  /**
   * Heal one dome panel back to full over ~1s with a rising shimmer that clears
   * its cracks. Self-terminating from the tick. Out-of-range segments are
   * ignored. Never throws.
   */
  repairDomeSegment: (segment: number) => void;
  /**
   * Render raid aftermath on specific houses: 'damaged' = scorch + darkened roof
   * + a smoke wisp; 'destroyed' = burnt broken foundation + rubble + lingering
   * smoke. Owner labels are preserved. Idempotent (clear + re-apply) and stored,
   * so it re-applies automatically whenever setHouses remaps the houses. Passing
   * [] clears all damage. Never throws.
   */
  setHouseDamage: (states: { index: number; status: 'destroyed' | 'damaged' }[]) => void;
  /**
   * Grow a ruined house back over ~1.5s (frame, then roof, then the full house)
   * and clear that house's damage overlay at the end. Never throws.
   */
  rebuildHouse: (index: number) => void;
  /**
   * Reveal community-funded land expansions: 'outer_fields' | 'river_ward' |
   * 'high_keep' (the shared LAND_EXPANSIONS ids, in funding order). Each id
   * develops a visible frontier district on the same continuous mainland.
   * Locked districts remain wilderness; unlocked districts add roads, homes,
   * fields, and civic structures. Unknown ids are ignored. Idempotent.
   */
  setLandParcels: (unlocked: string[]) => void;
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
  /** Snapshot of the world (developed outline, districts, house centers) for the minimap. */
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
  let cameraMinX = -52;
  let cameraMinZ = -52;
  controls.addEventListener('change', () => {
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, cameraMinX, 52);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, cameraMinZ, 52);
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
  // siege cinematic mood (playRaidCinematic): siegeMood eases 0->1 while a raid
  // plays out and biases the sky/fog/hemi/sun toward a red-orange dawn assault,
  // then restores the clean preset with zero residue. Shake + heavy-flag live
  // here so lerpEnv/tick can read them; the fireball + impact pools are built
  // lazily lower down (ensureSiege). No per-frame allocations.
  let siegeActive = false;
  let siegeMood = 0;
  let siegeHeavy = false;
  const siegeSkyCol = new THREE.Color(0x2a0f0a);
  const siegeEmberCol = new THREE.Color(0xff7a3a);
  const siegeShake = new THREE.Vector3();
  let siegeShakeApplied = false;
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

    // siege cinematic: darken + redden sky/fog/hemi/sun while a raid plays out.
    // Eased like raidTint so toggling it off lerps back to the clean preset.
    siegeMood += ((siegeActive ? 1 : 0) - siegeMood) * k;
    if (siegeMood > 0.002) {
      const sb = scene.background as THREE.Color;
      sb.lerp(siegeSkyCol, siegeMood * 0.5);
      fog.color.copy(sb);
      hemi.color.lerp(siegeEmberCol, siegeMood * 0.32);
      hemi.intensity = env.hemiInt * (1 - siegeMood * 0.28);
      sun.color.lerp(siegeEmberCol, siegeMood * 0.4);
      sun.intensity = env.sunInt * (1 - siegeMood * 0.35);
    }
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

  // ---------- historic city core + connected frontier ----------
  const PHI1 = rng() * Math.PI * 2;
  const PHI2 = rng() * Math.PI * 2;
  const plateauR = (theta: number) =>
    58 + 8 * Math.sin(3 * theta + PHI1) + 5 * Math.sin(7 * theta + PHI2);
  const insidePlateau = (x: number, z: number, margin = 0) =>
    Math.hypot(x, z) < plateauR(Math.atan2(z, x)) - margin;
  type ParcelDef = { id: string; d0: number; d1: number; top: number; half: number };
  const PARCEL_ANGLE = Math.PI; // visible western frontier, clear of the right-side HUD
  const PARCEL_DEFS: ParcelDef[] = [
    { id: 'outer_fields', d0: 0, d1: 11, top: 0.02, half: 0.46 },
    { id: 'river_ward', d0: 11, d1: 20, top: 0.02, half: 0.38 },
    { id: 'high_keep', d0: 20, d1: 30, top: 0.02, half: 0.3 },
  ];
  const unlockedLandIds = new Set<string>();
  const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const developedRadius = (angle: number) => {
    let radius = plateauR(angle);
    for (const parcel of PARCEL_DEFS) {
      if (unlockedLandIds.has(parcel.id) && angDist(angle, PARCEL_ANGLE) <= parcel.half) {
        radius = Math.max(radius, plateauR(angle) + parcel.d1);
      }
    }
    return radius;
  };

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
  const SIZE = 140; // dense city-core tile grid; the broad mainland continues beyond it
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

    // The city is part of a broad mainland. The old dark abyss + vertical skirt
    // made every unlock read as another floating shelf; this low field keeps the
    // core, frontier, expansion districts, and distant settlements connected.
    const mainland = new THREE.Mesh(new THREE.CircleGeometry(360, 72), lam(0x496c32));
    mainland.name = 'continuous-mainland';
    mainland.rotation.x = -Math.PI / 2;
    mainland.position.y = -0.17;
    mainland.receiveShadow = true;
    scene.add(mainland);
  }

  // ---------- frontier ridge ----------
  // Rock centers + original matrices escape the block so a funded district can
  // open a pass through the ridge without rebuilding the whole formation.
  let mountainInst: THREE.InstancedMesh | null = null;
  const mountainRockSpots: [number, number][] = [];
  const mountainRockMatrices: THREE.Matrix4[] = [];
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
      mountainRockMatrices.push(m4.clone());
      col.setHex(rk.c);
      inst.setColorAt(i, col);
      mountainRockSpots.push([rk.x, rk.z]);
    });
    scene.add(inst);
    mountainInst = inst;
  }

  // ---------- distant neighbor cities on the shared horizon ----------
  // Five rival settlement slots on low rises across the mainland. Demo fills all
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
      // A shallow rise embedded in the same mainland, not a detached mesa.
      const topR = 10 + rng() * 3;
      const rise = new THREE.Mesh(new THREE.CylinderGeometry(topR, topR * 1.18, 0.4, 12), lam(C.dirtB, { flatShading: true }));
      rise.position.y = -0.19;
      g.add(rise);
      const top = new THREE.Mesh(new THREE.CircleGeometry(topR - 0.4, 9), lam(C.grassB));
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.02;
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
    // Sample the developed boundary. Funded frontier districts extend the
    // outline, so the minimap visibly grows with the shared city.
    const outline: [number, number][] = [];
    let radius = 0;
    const N = 64;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = developedRadius(a);
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
    // shared with the siege cinematic: the alarm glow beyond the south gate
    // reads as the besieging force, so raidTint and siegeMood both drive it.
    raidLight.visible = raidTint > 0.002 || siegeMood > 0.002;
    if (raidLight.visible) {
      const drive = Math.max(raidTint, siegeMood);
      raidLight.intensity = drive * (50 + Math.sin(t * 1.7) * 12 + Math.sin(t * 4.3) * 5) + siegeMood * 30;
      glowMat.color.multiplyScalar(1 + 0.15 * Math.sin(t * 7) * drive);
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
    // crimson banner wave: cheap pivot swing, the plane is hinged at its pole
    if (cosmeticBanner) {
      cosmeticBanner.rotation.y = 0.35 + Math.sin(t * 2.7) * 0.3;
      cosmeticBanner.rotation.z = Math.sin(t * 4.3) * 0.05;
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
    // advance the siege cinematic (fireballs, impacts, plumes, rebuilds, aftermath
    // smoke) and apply this frame's camera shake AFTER controls.update() so the
    // orbit state never drifts; the offset is removed again right after render.
    advanceSiege(dt, t);
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    if (siegeShakeApplied) {
      camera.position.sub(siegeShake);
      siegeShakeApplied = false;
    }
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

  // ---------- house cosmetics (setHouseCosmetics) ----------
  // Shop cosmetics dress the CURRENT PLAYER's house only. The equipped map is
  // stored and re-applied at the end of every setHouses call, because a refresh
  // remaps house indices and would otherwise strand the kit on a stranger's
  // roof. Everything lives in one child group per apply, cleared + rebuilt like
  // the houseDecor pattern (idempotent). Item ids mirror shared/shop.ts
  // SHOP_CATALOG; string literals on purpose, scene.ts imports nothing from
  // ../shared and keeps it that way.
  let equippedCosmetics: HouseCosmetics | null = null;
  let playerHouseGroup: THREE.Group | null = null;
  let cosmeticsGroup: THREE.Group | null = null;
  let cosmeticBanner: THREE.Mesh | null = null; // waved in tick, no per-frame allocs
  // light budget: the single PointLight this feature may add (no shadows, short
  // range), created once and re-parented across applies
  let lanternLight: THREE.PointLight | null = null;
  // shared cosmetic materials, created once; per-apply disposal covers geometry only
  const cosmeticRoofMat = lam(0x3a424f); // dark slate, colder than roofSlateDark
  const cosmeticGoldMat = lam(C.roofGold);
  const cosmeticBannerMat = lam(0x8a1f1f, { side: THREE.DoubleSide });
  const cosmeticLeafMat = lam(C.leaf);
  // roof material swap bookkeeping so clearing restores the original
  let swappedRoof: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] } | null = null;
  // the roof is the only ConeGeometry among a house group's direct children
  const roofMeshOf = (g: THREE.Group): THREE.Mesh | null => {
    for (const child of g.children) {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry.type === 'ConeGeometry') return mesh;
    }
    return null;
  };
  const clearHouseCosmetics = () => {
    if (swappedRoof) {
      swappedRoof.mesh.material = swappedRoof.original;
      swappedRoof = null;
    }
    cosmeticBanner = null;
    if (cosmeticsGroup) {
      cosmeticsGroup.removeFromParent(); // lanternLight detaches too, object is reused
      cosmeticsGroup.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry?.dispose?.();
      });
      cosmeticsGroup = null;
    }
  };
  function applyHouseCosmetics() {
    clearHouseCosmetics();
    const g = playerHouseGroup;
    const eq = equippedCosmetics;
    if (!g || !eq) return;
    const kit = new THREE.Group();
    if (eq.light === 'hearth_lantern') {
      // lantern post beside the door (house doors face local +z)
      kit.add(cyl(0.045, 0.72, MAT.timberDark, 0.62, 0.36, 1.02, 6));
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.2), glowMat);
      head.position.set(0.62, 0.84, 1.02); // glowMat: warm at night, dull at day
      kit.add(head);
      kit.add(box(0.28, 0.06, 0.28, MAT.timberDark, 0.62, 0.99, 1.02));
      if (!lanternLight) lanternLight = new THREE.PointLight(0xffc46a, 5, 7, 2);
      lanternLight.position.set(0.62, 1.05, 1.3);
      kit.add(lanternLight);
    }
    if (eq.banner === 'crimson_banner') {
      kit.add(cyl(0.04, 2.1, MAT.timberDark, -0.95, 1.05, 0.55, 6));
      const flagGeo = new THREE.PlaneGeometry(0.62, 0.42);
      flagGeo.translate(0.31, 0, 0); // hinge on the pole so the tick swing pivots there
      const flag = new THREE.Mesh(flagGeo, cosmeticBannerMat);
      flag.position.set(-0.95, 1.84, 0.55);
      cosmeticBanner = flag;
      kit.add(flag);
    }
    if (eq.yard === 'garden_plot') {
      // planter box + soil + green tufts + a tiny two-rail fence beside the footprint
      kit.add(box(1.15, 0.2, 0.8, MAT.timberDark, 1.75, 0.1, 0.35));
      kit.add(box(1.0, 0.16, 0.66, MAT.cropDark, 1.75, 0.16, 0.35));
      for (const [tx, tz] of [[1.45, 0.22], [1.78, 0.52], [2.06, 0.24]] as const) {
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.34, 5), cosmeticLeafMat);
        tuft.position.set(tx, 0.4, tz);
        kit.add(tuft);
      }
      for (const px of [1.2, 1.75, 2.3]) kit.add(cyl(0.035, 0.44, MAT.timber, px, 0.22, -0.2, 5));
      kit.add(box(1.2, 0.05, 0.06, MAT.timber, 1.75, 0.34, -0.2));
      kit.add(box(1.2, 0.05, 0.06, MAT.timber, 1.75, 0.18, -0.2));
    }
    if (eq.roof === 'slate_roof' || eq.roof === 'dawn_gold_trim') {
      const roof = roofMeshOf(g);
      if (roof) {
        swappedRoof = { mesh: roof, original: roof.material };
        roof.material = cosmeticRoofMat;
        if (eq.roof === 'dawn_gold_trim') {
          // gold ridge cap: a thin bar through the pyramid apex, sized off the
          // live roof mesh because house dimensions are seeded per house
          const apexY = roof.position.y + roof.scale.y * 0.5;
          kit.add(box(Math.max(0.7, roof.scale.x * 0.4), 0.09, 0.15, cosmeticGoldMat, 0, apexY - 0.02, 0));
          kit.add(box(0.18, 0.2, 0.18, cosmeticGoldMat, 0, apexY + 0.08, 0));
        }
      }
    }
    if (kit.children.length > 0) {
      g.add(kit); // child of the house: survives tier rescale and facing rotation
      cosmeticsGroup = kit;
    }
  }
  function setHouseCosmetics(equipped: HouseCosmetics | null) {
    try {
      equippedCosmetics =
        equipped && typeof equipped === 'object'
          ? { roof: equipped.roof, banner: equipped.banner, light: equipped.light, yard: equipped.yard }
          : null;
      applyHouseCosmetics();
    } catch {
      /* cosmetic overlay, never throw into the caller */
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
      playerHouseGroup = null;
      if (!summary || total === 0) {
        applyHouseCosmetics(); // no known player house: clears any equipped kit
        return;
      }
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
        if (yours && yours.index === 0) playerHouseGroup = founder;
      }
      // your house (if not the founder)
      if (yours && yours.index > 0 && yours.index < total) {
        const g = houses[yours.index]!;
        g.scale.setScalar(scaleFor(yours.tier));
        ringHouse(g);
        labelHouse(g, `u/${currentUsername}`, 2.7);
        playerHouseGroup = g;
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
      // equipped cosmetics follow the remapped player house across refreshes
      applyHouseCosmetics();
      // raid damage re-applies after every remap: a refresh rebuilds the house
      // list, so stored damage states must re-render their ruins onto it.
      applyHouseDamage();
    } catch {
      /* cosmetic overlay — never throw into the caller */
    }
  }

  // ---------- community land expansions (setLandParcels) ----------
  // The land is already present as wilderness on the same mainland. Funding a
  // project replaces scrub with a developed district and opens the route north.
  // Built once (lazily); subsequent updates only toggle groups and ridge rocks.
  const parcelBandAt = (x: number, z: number): ParcelDef | null => {
    const a = Math.atan2(z, x);
    const off = angDist(a, PARCEL_ANGLE);
    if (off > PARCEL_DEFS[0]!.half) return null;
    const d = Math.hypot(x, z) - plateauR(a);
    for (const p of PARCEL_DEFS) {
      if (d >= p.d0 && d < p.d1 && off <= p.half) return p;
    }
    return null;
  };
  const rockCoveredBy = (x: number, z: number, p: ParcelDef) => {
    const a = Math.atan2(z, x);
    if (angDist(a, PARCEL_ANGLE) > p.half + 0.08) return false;
    const d = Math.hypot(x, z) - plateauR(a);
    return d >= p.d0 - 2.5 && d < p.d1 + 2.5;
  };
  type LandParcelVisual = { def: ParcelDef; developed: THREE.Group; frontier: THREE.Group };
  let landParcels: LandParcelVisual[] | null = null;
  function ensureLandParcels() {
    if (landParcels) return landParcels;
    const prng = makeRng(20260713); // own stream: the seeded town layout must stay byte-identical
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    const frontierLeafMat = lam(C.leafDark);
    // Contour-following anchor: tangential offset tx at depth dd past the old
    // city core. The terrain beneath it is the always-visible mainland.
    const spot = (tx: number, dd: number): [number, number] => {
      const a = PARCEL_ANGLE + tx / 70;
      const r = plateauR(a) + dd;
      return [Math.cos(a) * r, Math.sin(a) * r];
    };
    // tiny hut from the same box + pyramid kit as the town's filler houses
    const hutAt = (x: number, z: number, baseY: number, ry: number) => {
      const hut = new THREE.Group();
      const w = 1.5 + prng() * 0.4;
      const hh = 1.0 + prng() * 0.25;
      const hd = w * 0.85;
      hut.add(box(w, hh, hd, prng() > 0.4 ? MAT.timber : MAT.plaster, 0, hh / 2, 0));
      hut.add(pyramid(w * 1.15, 0.75 + prng() * 0.3, hd * 1.15, ROOFS[Math.floor(prng() * ROOFS.length)]!, 0, hh + 0.35, 0));
      hut.add(glowCube(0.18, w * 0.28, hh * 0.6, hd / 2 + 0.03));
      hut.position.set(x, baseY, z);
      hut.rotation.y = ry;
      return hut;
    };
    const built: LandParcelVisual[] = [];
    for (const def of PARCEL_DEFS) {
      const developed = new THREE.Group();
      developed.name = `land-${def.id}`;
      const frontier = new THREE.Group();
      frontier.name = `frontier-${def.id}`;
      const tiles: [number, number][] = [];
      for (let ix = -104; ix <= 104; ix++) {
        for (let iz = -104; iz <= 104; iz++) {
          if (parcelBandAt(ix, iz) === def) tiles.push([ix, iz]);
        }
      }
      if (tiles.length > 0) {
        const ground = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.12, 1), lam(0xffffff), tiles.length);
        ground.name = `${def.id}-developed-ground`;
        ground.receiveShadow = true;
        tiles.forEach(([x, z], i) => {
          m4.identity();
          m4.setPosition(x, def.top - 0.06, z);
          ground.setMatrixAt(i, m4);
          const a = Math.atan2(z, x);
          const d = Math.hypot(x, z) - plateauR(a);
          const check = (Math.abs(x) + Math.abs(z)) % 2;
          const water = def.id === 'river_ward' && d >= 14.5 && d < 16;
          const path = !water && angDist(a, PARCEL_ANGLE) < 0.025;
          col.setHex(
            water ? (check ? 0x4a7d99 : 0x406f8c)
            : path ? (check ? C.dirt : C.dirtB)
            : check ? C.grassA : C.grassB,
          );
          ground.setColorAt(i, col);
        });
        developed.add(ground);
      }
      if (def.id === 'outer_fields') {
        // farmland belt: two crop patches + a low post-and-rail fence
        for (const [tx, dd, fw] of [[-4.5, 5.0, 4.6], [4.2, 4.4, 5.0]] as const) {
          const [fx, fz] = spot(tx, dd);
          developed.add(box(fw, 0.12, 3.2, MAT.cropDark, fx, 0.1, fz));
          for (let row = 0; row < 4; row++) {
            developed.add(box(fw - 0.6, 0.2, 0.4, MAT.crop, fx, 0.22, fz - 1.05 + row * 0.7));
          }
        }
        let prev: [number, number] | null = null;
        for (let tx = -6; tx <= 6; tx += 2) {
          const [px, pz] = spot(tx, 1.6);
          developed.add(cyl(0.06, 0.66, MAT.timberDark, px, 0.33, pz, 5));
          if (prev) {
            const rail = box(Math.hypot(px - prev[0], pz - prev[1]), 0.06, 0.08, MAT.timber, (px + prev[0]) / 2, 0.52, (pz + prev[1]) / 2);
            rail.rotation.y = Math.atan2(-(pz - prev[1]), px - prev[0]);
            developed.add(rail);
          }
          prev = [px, pz];
        }
      } else if (def.id === 'river_ward') {
        // riverside ward: huts along the channel + a plank bridge on the path
        for (const [tx, dd, ry] of [[-4.5, 12.8, Math.PI], [4.2, 18.0, 0], [6.0, 12.5, Math.PI]] as const) {
          const [hx, hz] = spot(tx, dd);
          developed.add(hutAt(hx, hz, def.top, ry));
        }
        const [bx, bz] = spot(0, 15.2);
        const bridge = new THREE.Group();
        bridge.add(box(1.6, 0.1, 2.8, MAT.timber, 0, def.top + 0.14, 0));
        bridge.add(box(0.08, 0.3, 2.8, MAT.timberDark, -0.72, def.top + 0.32, 0));
        bridge.add(box(0.08, 0.3, 2.8, MAT.timberDark, 0.72, def.top + 0.32, 0));
        bridge.position.set(bx, 0, bz);
        bridge.rotation.y = Math.PI / 2 - PARCEL_ANGLE;
        developed.add(bridge);
      } else {
        // The keep sits on a low connected hill whose base meets the mainland.
        const [kx, kz] = spot(0, 25.0);
        const hill = new THREE.Mesh(new THREE.CylinderGeometry(6, 9.5, 1.2, 14), lam(C.grassB, { flatShading: true }));
        hill.position.set(kx, 0.42, kz);
        hill.receiveShadow = true;
        developed.add(hill);
        const keep = new THREE.Group();
        keep.add(box(3.0, 0.5, 3.0, MAT.stoneDark, 0, 0.25, 0));
        keep.add(box(2.2, 2.2, 2.2, MAT.stone, 0, 1.6, 0));
        keep.add(box(2.6, 0.35, 2.6, MAT.stoneDark, 0, 2.85, 0));
        keep.add(box(1.6, 1.3, 1.6, MAT.stone, 0, 3.65, 0));
        keep.add(pyramid(2.0, 1.1, 2.0, MAT.roofSlateDark, 0, 4.85, 0));
        keep.add(glowCube(0.34, 0, 1.9, 1.12));
        keep.position.set(kx, 1.02, kz);
        developed.add(keep);
        for (const [tx, dd, s] of [[-3.4, 22.5, 1.1], [3.2, 28.0, 1.4]] as const) {
          const [rx, rz] = spot(tx, dd);
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), lam(C.rockA, { flatShading: true }));
          rock.scale.set(s, s * 1.2, s);
          rock.position.set(rx, s * 0.5, rz);
          rock.castShadow = true;
          developed.add(rock);
        }
      }

      // Undeveloped land remains visible. Sparse rocks and pines identify the
      // next frontier without making it look owned or detached from the city.
      for (let i = 0; i < 9; i++) {
        const tx = (prng() - 0.5) * def.half * 110;
        const dd = def.d0 + 1.2 + prng() * Math.max(1, def.d1 - def.d0 - 2.4);
        const [wx, wz] = spot(tx, dd);
        if (i % 3 === 0) {
          const tree = new THREE.Group();
          tree.add(cyl(0.12, 1.4, MAT.timberDark, 0, 0.7, 0, 6));
          const crown = new THREE.Mesh(new THREE.ConeGeometry(0.85, 2.2, 7), frontierLeafMat);
          crown.position.y = 2.0;
          crown.castShadow = true;
          tree.add(crown);
          tree.position.set(wx, 0, wz);
          frontier.add(tree);
        } else {
          const size = 0.45 + prng() * 0.75;
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), lam(i % 2 ? C.rockA : C.rockB, { flatShading: true }));
          rock.scale.set(size, size * (0.8 + prng() * 0.5), size);
          rock.position.set(wx, size * 0.45, wz);
          rock.rotation.y = prng() * Math.PI;
          rock.castShadow = true;
          frontier.add(rock);
        }
      }
      developed.visible = false;
      frontier.visible = true;
      scene.add(frontier, developed);
      built.push({ def, developed, frontier });
    }
    landParcels = built;
    return built;
  }
  function setLandParcels(unlocked: string[]) {
    try {
      const ids = new Set(Array.isArray(unlocked) ? unlocked : []);
      const parcels = ensureLandParcels();
      unlockedLandIds.clear();
      for (const parcel of parcels) {
        const open = ids.has(parcel.def.id);
        parcel.developed.visible = open;
        parcel.frontier.visible = !open;
        if (open) unlockedLandIds.add(parcel.def.id);
      }
      cameraMinX = ids.has('high_keep') ? -94 : ids.has('river_ward') ? -84 : ids.has('outer_fields') ? -74 : -52;
      cameraMinZ = -52;
      controls.target.x = THREE.MathUtils.clamp(controls.target.x, cameraMinX, 52);
      controls.target.z = THREE.MathUtils.clamp(controls.target.z, cameraMinZ, 52);

      // Open a pass through the frontier ridge for each developed district.
      if (mountainInst) {
        const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let i = 0; i < mountainRockSpots.length; i++) {
          const [rx, rz] = mountainRockSpots[i]!;
          const original = mountainRockMatrices[i];
          if (!original) continue;
          const hide = parcels.some((parcel) => parcel.developed.visible && rockCoveredBy(rx, rz, parcel.def));
          mountainInst.setMatrixAt(i, hide ? hidden : original);
        }
        mountainInst.instanceMatrix.needsUpdate = true;
      }
    } catch {
      /* cosmetic overlay, never throw into the caller */
    }
  }

  // ---------- raid cinematic + house damage (playRaidCinematic / setHouseDamage / rebuildHouse) ----------
  // Phone budget: all projectiles, impacts and smoke are POOLED and reused across
  // fireballs and across raids; the tick advances them from arrays so there are no
  // per-frame allocations. At most two transient extra lights (the impact flashes)
  // and no shadow casters or postprocessing. Everything is added to the scene graph
  // so dispose()'s traverse-sweep frees geometry + attached materials for free.
  const MAX_FIREBALLS = 6; // 2-3 held, 5-6 breach/fallen
  const MAX_IMPACTS = 8;
  const MAX_PLUMES = 10;
  type Fireball = {
    core: THREE.Mesh; trail: THREE.Mesh; puff: THREE.Mesh;
    from: THREE.Vector3; to: THREE.Vector3; peak: number;
    startAt: number; dur: number; t: number;
    state: 0 | 1 | 2; // 0 idle, 1 pending (waiting for startAt), 2 flying
    houseIndex: number; // >=0 when this fireball ultimately strikes a specific house
    segment: number;    // dome panel this fireball falls onto (0..DOME_SEG-1)
    blocked: boolean;   // true = stops on the shield; false = pierces through to a house
    pierced: boolean;   // (non-blocked) the dome-pierce event has already fired
    houseHit: THREE.Vector3; // second-leg target once it punches through the panel
  };
  type Impact = {
    flash: THREE.Mesh; flashMat: THREE.MeshBasicMaterial;
    ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial;
    embers: THREE.Points; emberMat: THREE.PointsMaterial;
    emberPos: Float32Array; emberVel: Float32Array; emberAttr: THREE.BufferAttribute;
    t: number; dur: number; active: boolean;
  };
  type Plume = {
    points: THREE.Points; mat: THREE.PointsMaterial;
    pos: Float32Array; base: Float32Array; attr: THREE.BufferAttribute;
    t: number; dur: number; active: boolean;
  };
  const fireballs: Fireball[] = [];
  const impacts: Impact[] = [];
  const plumes: Plume[] = [];
  const impactLights: THREE.PointLight[] = [];
  let impactLightIdx = 0;
  let hazeMesh: THREE.Mesh | null = null;
  let hazeMat: THREE.MeshBasicMaterial | null = null;
  let hazeTarget = 0;
  let siegeBeaconMesh: THREE.Mesh | null = null;
  let siegeReady = false;
  let siegeElapsed = 0;
  let siegeDuration = 0;
  let shakeMag = 0;
  // scratch vectors/quaternion reused every frame (no per-frame allocations)
  const _sv1 = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _dir2 = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _fwd = new THREE.Vector3(0, 0, 1); // ring default normal (orients dome ripples)
  const _q = new THREE.Quaternion();

  function ensureSiege() {
    if (siegeReady) return;
    // shared projectile kit (one geometry + material per role, reused by all arcs)
    const coreGeo = new THREE.SphereGeometry(0.55, 12, 10);
    const trailGeo = new THREE.ConeGeometry(0.4, 2.4, 8);
    const puffGeo = new THREE.SphereGeometry(0.55, 8, 8);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, fog: false });
    const trailMat = new THREE.MeshBasicMaterial({ color: 0xff5a1e, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const puffMat = new THREE.MeshBasicMaterial({ color: 0x4a423c, transparent: true, opacity: 0.3, depthWrite: false, fog: false });
    for (let i = 0; i < MAX_FIREBALLS; i++) {
      const core = new THREE.Mesh(coreGeo, coreMat);
      const trail = new THREE.Mesh(trailGeo, trailMat);
      const puff = new THREE.Mesh(puffGeo, puffMat);
      core.renderOrder = 3;
      trail.renderOrder = 2;
      core.visible = trail.visible = puff.visible = false;
      scene.add(core, trail, puff);
      fireballs.push({ core, trail, puff, from: new THREE.Vector3(), to: new THREE.Vector3(), peak: 6, startAt: 0, dur: 1.2, t: 0, state: 0, houseIndex: -1, segment: 0, blocked: false, pierced: false, houseHit: new THREE.Vector3() });
    }
    // impact kit: flash (additive), ground dust ring, ember burst (8 points)
    const flashGeo = new THREE.SphereGeometry(1, 12, 10);
    const ringGeo = new THREE.RingGeometry(0.5, 0.9, 20);
    for (let i = 0; i < MAX_IMPACTS; i++) {
      const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const flash = new THREE.Mesh(flashGeo, flashMat);
      flash.renderOrder = 4;
      flash.visible = false;
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xd8a060, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      const em = 8;
      const emberPos = new Float32Array(em * 3);
      const emberVel = new Float32Array(em * 3);
      const eg = new THREE.BufferGeometry();
      const emberAttr = new THREE.BufferAttribute(emberPos, 3);
      eg.setAttribute('position', emberAttr);
      const emberMat = new THREE.PointsMaterial({ color: 0xffa040, size: 0.5, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const embers = new THREE.Points(eg, emberMat);
      embers.visible = false;
      scene.add(flash, ring, embers);
      impacts.push({ flash, flashMat, ring, ringMat, embers, emberMat, emberPos, emberVel, emberAttr, t: 0, dur: 0.5, active: false });
    }
    // lingering smoke plumes (~3s), 7 motes each
    for (let i = 0; i < MAX_PLUMES; i++) {
      const pm = 7;
      const pos = new Float32Array(pm * 3);
      const base = new Float32Array(pm);
      const pg = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(pos, 3);
      pg.setAttribute('position', attr);
      const mat = new THREE.PointsMaterial({ color: 0x6a6259, size: 0.9, transparent: true, opacity: 0, depthWrite: false });
      const points = new THREE.Points(pg, mat);
      points.visible = false;
      scene.add(points);
      plumes.push({ points, mat, pos, base, attr, t: 0, dur: 3.2, active: false });
    }
    // the two transient impact flash lights (no shadows, short range)
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 16, 2);
      scene.add(l);
      impactLights.push(l);
    }
    // smoke haze plane for a 'fallen' town (fades in over the assault, lingers)
    hazeMat = new THREE.MeshBasicMaterial({ color: 0x53483f, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
    hazeMesh = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), hazeMat);
    hazeMesh.rotation.x = -Math.PI / 2;
    hazeMesh.position.y = 17;
    hazeMesh.visible = false;
    scene.add(hazeMesh);
    // watchtower beacon flare: an additive pulse at the south gate tower (a mesh,
    // so it costs nothing against the two-light budget)
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff4a24, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    siegeBeaconMesh = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), beaconMat);
    {
      const a = GATE_ANGLES[0]! + 0.09;
      const r = plateauR(GATE_ANGLES[0]!) - 2.6;
      siegeBeaconMesh.position.set(Math.cos(a) * r, 4.2, Math.sin(a) * r);
    }
    siegeBeaconMesh.visible = false;
    scene.add(siegeBeaconMesh);
    siegeReady = true;
  }

  // ---------- protective energy dome (setDome / repairDomeSegment) ----------
  // A translucent hemisphere arching over the whole plateau, split into DOME_SEG
  // azimuthal arc panels. Each panel's look is driven by a 0..100 shield: full = a
  // bright near-clear shimmer; mid = dimmer; low = hairline cracks; 0 = a dark
  // shattered gap. Built once (lazily) and pooled — the tick eases each panel's
  // opacity/colour toward its shield and decays the transient block/pierce flares,
  // so there are no per-frame allocations and no extra lights (additive meshes
  // only). Falling fireballs (below) strike or pierce these panels. Radius arches
  // clear of the palisade (plateauR ~45..71) and above every roof.
  const DOME_SEG = 6;
  const DOME_R = 74;
  const DOME_CY = 0.5;              // equator sits just above the ground plane
  const DOME_STRIKE_THETA = 0.86;  // polar angle (from the top) of a panel's hit point
  const domeCenter = new THREE.Vector3(0, DOME_CY, 0);
  const DOME_HI = new THREE.Color(0x8fd8ff);   // full-charge shield tint (icy energy)
  const DOME_LO = new THREE.Color(0x33100c);   // drained tint (dark ember -> additive gap)
  const DOME_WHITE = new THREE.Color(0xffffff);
  type DomePanel = {
    mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial;
    cracks: THREE.LineSegments; crackMat: THREE.LineBasicMaterial;
    hue: THREE.Color; // scratch colour reused each frame (no per-frame alloc)
  };
  type DomeFx = {
    flash: THREE.Mesh; flashMat: THREE.MeshBasicMaterial;
    ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial;
    sparks: THREE.Points; sparkMat: THREE.PointsMaterial;
    sparkPos: Float32Array; sparkVel: Float32Array; sparkAttr: THREE.BufferAttribute;
    t: number; dur: number; active: boolean;
  };
  const MAX_DOMEFX = 4;
  const domePanels: DomePanel[] = [];
  const domeFx: DomeFx[] = [];
  const domeShield = new Float32Array(DOME_SEG); // target shield 0..100 per panel
  const domeDisp = new Float32Array(DOME_SEG);   // eased displayed shield (smooth setDome/repair)
  const domeFlare = new Float32Array(DOME_SEG);  // transient bright flash 0..1 (tick decays)
  const domeGap = new Float32Array(DOME_SEG);    // transient pierce gap 0..1 (tick decays)
  const domeRepairT = new Float32Array(DOME_SEG); // repair shimmer clock (>=0 active), -1 idle
  domeShield.fill(100); // intact until the first setDome
  domeDisp.fill(100);
  domeRepairT.fill(-1);
  let domeReady = false;

  // world-space point on the dome surface at the centre of a panel (segment)
  function domeHitPoint(segment: number, out: THREE.Vector3) {
    const az = (segment + 0.5) * ((Math.PI * 2) / DOME_SEG);
    const st = Math.sin(DOME_STRIKE_THETA);
    out.set(
      domeCenter.x + DOME_R * st * Math.cos(az),
      domeCenter.y + DOME_R * Math.cos(DOME_STRIKE_THETA),
      domeCenter.z + DOME_R * st * Math.sin(az),
    );
    return out;
  }

  function ensureDome() {
    if (domeReady) return;
    const step = (Math.PI * 2) / DOME_SEG;
    const seam = 0.03; // small phi gap so the 6 panels read as separate panels
    const pv = new THREE.Vector3();
    for (let i = 0; i < DOME_SEG; i++) {
      const phiStart = i * step + seam * 0.5;
      const phiLen = step - seam;
      const geo = new THREE.SphereGeometry(DOME_R, 8, 14, phiStart, phiLen, 0, Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: DOME_HI.clone(), transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide, fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(domeCenter);
      mesh.renderOrder = 1;
      scene.add(mesh);
      // deterministic hairline cracks across the panel (seeded off the panel index)
      const crackRng = makeRng(90210 + i * 613);
      const cracksN = 3;
      const hops = 4; // segments per crack
      const cpos = new Float32Array(cracksN * hops * 2 * 3);
      let w = 0;
      const onSphere = (az: number, th: number, v: THREE.Vector3) => {
        const s2 = Math.sin(th);
        v.set(
          domeCenter.x + (DOME_R + 0.15) * s2 * Math.cos(az),
          domeCenter.y + (DOME_R + 0.15) * Math.cos(th),
          domeCenter.z + (DOME_R + 0.15) * s2 * Math.sin(az),
        );
      };
      for (let c = 0; c < cracksN; c++) {
        let a = phiStart + phiLen * (0.2 + crackRng() * 0.6);
        let th = 0.28 + crackRng() * 0.9;
        onSphere(a, th, pv);
        let px = pv.x, py = pv.y, pz = pv.z;
        for (let h = 0; h < hops; h++) {
          a += (crackRng() - 0.5) * phiLen * 0.5;
          th = Math.max(0.08, Math.min(Math.PI / 2 - 0.04, th + (crackRng() - 0.5) * 0.5));
          onSphere(a, th, pv);
          cpos[w++] = px; cpos[w++] = py; cpos[w++] = pz;
          cpos[w++] = pv.x; cpos[w++] = pv.y; cpos[w++] = pv.z;
          px = pv.x; py = pv.y; pz = pv.z;
        }
      }
      const cgeo = new THREE.BufferGeometry();
      cgeo.setAttribute('position', new THREE.BufferAttribute(cpos, 3));
      const crackMat = new THREE.LineBasicMaterial({
        color: 0xaad8ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const cracks = new THREE.LineSegments(cgeo, crackMat);
      cracks.renderOrder = 2;
      cracks.visible = false;
      scene.add(cracks);
      domePanels.push({ mesh, mat, cracks, crackMat, hue: new THREE.Color() });
    }
    // faint structural ribs along the 6 panel seams + the base ring (constant glow)
    const ribPts: number[] = [];
    for (let i = 0; i < DOME_SEG; i++) {
      const az = i * step;
      let px = 0, py = 0, pz = 0, has = false;
      const N = 10;
      for (let k = 0; k <= N; k++) {
        const th = (k / N) * (Math.PI / 2);
        const s2 = Math.sin(th);
        pv.set(domeCenter.x + DOME_R * s2 * Math.cos(az), domeCenter.y + DOME_R * Math.cos(th), domeCenter.z + DOME_R * s2 * Math.sin(az));
        if (has) ribPts.push(px, py, pz, pv.x, pv.y, pv.z);
        px = pv.x; py = pv.y; pz = pv.z; has = true;
      }
    }
    {
      const N = 60;
      let px = 0, py = 0, pz = 0, has = false;
      for (let k = 0; k <= N; k++) {
        const az = (k / N) * Math.PI * 2;
        pv.set(domeCenter.x + DOME_R * Math.cos(az), domeCenter.y + 0.2, domeCenter.z + DOME_R * Math.sin(az));
        if (has) ribPts.push(px, py, pz, pv.x, pv.y, pv.z);
        px = pv.x; py = pv.y; pz = pv.z; has = true;
      }
    }
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ribPts), 3));
    const ribMat = new THREE.LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const ribs = new THREE.LineSegments(rgeo, ribMat);
    ribs.renderOrder = 1;
    scene.add(ribs);
    // shared hit / ripple / spark pool for blocks + pierces (mesh-based, no lights)
    const fxFlashGeo = new THREE.SphereGeometry(1, 10, 8);
    const fxRingGeo = new THREE.RingGeometry(0.4, 0.85, 20);
    for (let i = 0; i < MAX_DOMEFX; i++) {
      const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const flash = new THREE.Mesh(fxFlashGeo, flashMat);
      flash.renderOrder = 5; flash.visible = false;
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const ring = new THREE.Mesh(fxRingGeo, ringMat);
      ring.renderOrder = 5; ring.visible = false;
      const sn = 8;
      const sparkPos = new Float32Array(sn * 3);
      const sparkVel = new Float32Array(sn * 3);
      const sgeo = new THREE.BufferGeometry();
      const sparkAttr = new THREE.BufferAttribute(sparkPos, 3);
      sgeo.setAttribute('position', sparkAttr);
      const sparkMat = new THREE.PointsMaterial({ color: 0xcfeeff, size: 0.5, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const sparks = new THREE.Points(sgeo, sparkMat);
      sparks.visible = false;
      scene.add(flash, ring, sparks);
      domeFx.push({ flash, flashMat, ring, ringMat, sparks, sparkMat, sparkPos, sparkVel, sparkAttr, t: 0, dur: 0.55, active: false });
    }
    domeReady = true;
  }

  // ripple + spark burst on the shield at a strike point (normal points outward)
  function triggerDomeFx(px: number, py: number, pz: number, nx: number, ny: number, nz: number, flashHex: number, ringHex: number, sparkHex: number) {
    let fx = domeFx.find((f) => !f.active);
    if (!fx) fx = domeFx[0]!;
    fx.active = true;
    fx.t = 0;
    fx.dur = 0.55;
    fx.flashMat.color.setHex(flashHex);
    fx.flash.position.set(px, py, pz);
    fx.flash.scale.setScalar(0.6);
    fx.flash.visible = true;
    fx.flashMat.opacity = 1;
    fx.ringMat.color.setHex(ringHex);
    _dir.set(nx, ny, nz).normalize();
    _q.setFromUnitVectors(_fwd, _dir);
    fx.ring.position.set(px, py, pz);
    fx.ring.quaternion.copy(_q);
    fx.ring.scale.setScalar(1);
    fx.ring.visible = true;
    fx.ringMat.opacity = 0.9;
    // two tangents to the normal, so sparks spray across the panel surface
    _dir2.set(0, 1, 0);
    if (Math.abs(_dir.y) > 0.9) _dir2.set(1, 0, 0);
    _sv1.crossVectors(_dir, _dir2).normalize();
    _dir2.crossVectors(_dir, _sv1).normalize();
    fx.sparkMat.color.setHex(sparkHex);
    const sn = fx.sparkPos.length / 3;
    for (let k = 0; k < sn; k++) {
      fx.sparkPos[k * 3] = px;
      fx.sparkPos[k * 3 + 1] = py;
      fx.sparkPos[k * 3 + 2] = pz;
      const ang = (k / sn) * Math.PI * 2; // deterministic fan (no Math.random)
      const rad = 2 + (k % 3);
      const outw = 1.5 + (k % 2);
      fx.sparkVel[k * 3] = (_sv1.x * Math.cos(ang) + _dir2.x * Math.sin(ang)) * rad + _dir.x * outw;
      fx.sparkVel[k * 3 + 1] = (_sv1.y * Math.cos(ang) + _dir2.y * Math.sin(ang)) * rad + _dir.y * outw + 1.2;
      fx.sparkVel[k * 3 + 2] = (_sv1.z * Math.cos(ang) + _dir2.z * Math.sin(ang)) * rad + _dir.z * outw;
    }
    fx.sparks.visible = true;
    fx.sparkMat.opacity = 1;
    fx.sparkAttr.needsUpdate = true;
  }

  // a fireball hits the shield: flare the panel + ripple; pierce also flashes white
  // and opens a momentary gap (the tick eases it shut again)
  function triggerDomeStrike(segment: number, point: THREE.Vector3, pierce: boolean) {
    const seg = ((segment % DOME_SEG) + DOME_SEG) % DOME_SEG;
    domeFlare[seg] = 1;
    const nx = point.x - domeCenter.x;
    const ny = point.y - domeCenter.y;
    const nz = point.z - domeCenter.z;
    if (pierce) {
      domeGap[seg] = 1;
      triggerDomeFx(point.x, point.y, point.z, nx, ny, nz, 0xffffff, 0xffffff, 0xffffff);
    } else {
      triggerDomeFx(point.x, point.y, point.z, nx, ny, nz, 0xbfe6ff, 0x9fd0ff, 0xcfeeff);
    }
  }

  function setDome(segments: number[]) {
    try {
      ensureDome();
      if (!Array.isArray(segments)) return;
      for (let i = 0; i < DOME_SEG; i++) {
        const raw = segments[i];
        if (raw == null || !Number.isFinite(raw)) continue;
        domeShield[i] = Math.max(0, Math.min(100, raw));
      }
    } catch {
      /* dome overlay, never throw into the caller */
    }
  }

  function repairDomeSegment(segment: number) {
    try {
      ensureDome();
      const seg = Math.round(segment);
      if (!Number.isFinite(seg) || seg < 0 || seg >= DOME_SEG) return;
      domeShield[seg] = 100;      // eased up by the tick over ~1s
      domeRepairT[seg] = 0;       // rising-shimmer envelope (self-terminates in advanceDome)
    } catch {
      /* never throw into the caller */
    }
  }

  function advanceDome(dt: number, t: number) {
    if (!domeReady) return;
    const ek = 1 - Math.exp(-dt * 3.2);
    for (let i = 0; i < DOME_SEG; i++) {
      const panel = domePanels[i]!;
      const disp = domeDisp[i]! + (domeShield[i]! - domeDisp[i]!) * ek; // ease toward setDome / repair
      domeDisp[i] = disp;
      let flare = domeFlare[i]!;
      flare = flare > 0.001 ? flare * Math.exp(-dt * 3.4) : 0;
      domeFlare[i] = flare;
      let gap = domeGap[i]!;
      gap = gap > 0.001 ? gap * Math.exp(-dt * 5.0) : 0;
      domeGap[i] = gap;
      let shimmer = 0; // rising repair shimmer, ~1s, self-terminating
      const rt = domeRepairT[i]!;
      if (rt >= 0) {
        const rp = rt + dt;
        if (rp >= 1) domeRepairT[i] = -1;
        else { domeRepairT[i] = rp; shimmer = Math.sin(rp * Math.PI); }
      }
      const q = Math.max(0, Math.min(1, disp / 100));
      // colour: drained -> dark ember, full -> icy energy; flares/repair push white
      panel.hue.copy(DOME_LO).lerp(DOME_HI, q);
      const white = Math.min(1, flare + shimmer * 0.7);
      panel.hue.lerp(DOME_WHITE, white);
      panel.mat.color.copy(panel.hue);
      // opacity: subtle base that breathes, brighter with charge, dips during a gap
      const breathe = 0.85 + 0.15 * Math.sin(t * 1.4 + i * 1.7);
      let op = (0.05 + 0.13 * q) * breathe + flare * 0.5 + shimmer * 0.35;
      op *= 1 - gap * 0.92; // a pierced panel briefly opens then re-forms
      panel.mat.opacity = Math.max(0, Math.min(0.85, op));
      // cracks: hairlines appear below ~50% shield, fade out under a repair shimmer
      const crackA = Math.max(0, Math.min(1, (0.5 - q) / 0.5)) * (1 - shimmer);
      panel.crackMat.opacity = crackA * 0.85;
      panel.cracks.visible = crackA > 0.02;
    }
    // dome hit / ripple / spark bursts: flash grows + fades, ring expands, sparks arc
    for (const fx of domeFx) {
      if (!fx.active) continue;
      fx.t += dt;
      const p = Math.min(1, fx.t / fx.dur);
      fx.flash.scale.setScalar(0.6 + p * 2.2);
      fx.flashMat.opacity = Math.max(0, 1 - p);
      fx.ring.scale.setScalar(1 + p * 3.2);
      fx.ringMat.opacity = 0.9 * (1 - p);
      const sn = fx.sparkPos.length / 3;
      for (let k = 0; k < sn; k++) {
        const vy = fx.sparkVel[k * 3 + 1]!;
        fx.sparkPos[k * 3] = fx.sparkPos[k * 3]! + fx.sparkVel[k * 3]! * dt;
        fx.sparkPos[k * 3 + 1] = fx.sparkPos[k * 3 + 1]! + vy * dt;
        fx.sparkPos[k * 3 + 2] = fx.sparkPos[k * 3 + 2]! + fx.sparkVel[k * 3 + 2]! * dt;
        fx.sparkVel[k * 3 + 1] = vy - 7 * dt;
      }
      fx.sparkAttr.needsUpdate = true;
      fx.sparkMat.opacity = Math.max(0, 1 - p);
      if (p >= 1) {
        fx.active = false;
        fx.flash.visible = false;
        fx.ring.visible = false;
        fx.sparks.visible = false;
      }
    }
  }

  // ---------- wall breach (revealed on breach/fallen, hidden on held) ----------
  // A pre-made broken segment + scorch decal at the south gate reads as a
  // collapsed wall without touching the instanced palisade (degrade-safe).
  let wallBreakGroup: THREE.Group | null = null;
  let wallScorch: THREE.Mesh | null = null;
  function ensureWallBreak() {
    if (wallBreakGroup) return;
    const a = GATE_ANGLES[0]!;
    const r = plateauR(a) - 2.6;
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    const inX = -Math.cos(a);
    const inZ = -Math.sin(a); // unit vector toward the city centre
    const tanX = -Math.sin(a);
    const tanZ = Math.cos(a); // along the wall line
    const g = new THREE.Group();
    // toppled logs on the ground across the gap
    for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * 1.0;
      const px = bx + tanX * off + inX * 0.6;
      const pz = bz + tanZ * off + inZ * 0.6;
      const log = cyl(0.28, 2.4, MAT.timberDark, px, 0.3, pz, 6);
      log.rotation.z = Math.PI / 2 - 0.2 + Math.random() * 0.4;
      log.rotation.y = Math.atan2(tanZ, tanX) + (Math.random() - 0.5) * 0.5;
      g.add(log);
    }
    // two leaning stub posts flanking the breach
    for (const off of [-1.7, 1.7]) {
      const post = cyl(0.3, 1.6, MAT.timberDark, bx + tanX * off, 0.7, bz + tanZ * off, 6);
      post.rotation.x = (Math.random() - 0.5) * 0.5;
      post.rotation.z = (Math.random() - 0.5) * 0.6;
      g.add(post);
    }
    // rubble scattered inside the gap
    for (let i = 0; i < 5; i++) {
      const off = (Math.random() - 0.5) * 3.2;
      const dd = Math.random() * 1.4;
      const px = bx + tanX * off + inX * dd;
      const pz = bz + tanZ * off + inZ * dd;
      const s = 0.5 + Math.random() * 0.5;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), lam(Math.random() > 0.5 ? C.rockA : C.rockB, { flatShading: true }));
      rock.scale.set(s, s * 0.8, s);
      rock.position.set(px, s * 0.4, pz);
      g.add(rock);
    }
    g.visible = false;
    scene.add(g);
    wallBreakGroup = g;
    const sMat = new THREE.MeshBasicMaterial({ color: 0x1a1512, transparent: true, opacity: 0.6, depthWrite: false, fog: false });
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20), sMat);
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.set(bx + inX * 1.2, 0.05, bz + inZ * 1.2);
    scorch.visible = false;
    scene.add(scorch);
    wallScorch = scorch;
  }
  function setWallBreach(on: boolean) {
    ensureWallBreak();
    if (wallBreakGroup) wallBreakGroup.visible = on;
    if (wallScorch) wallScorch.visible = on;
  }

  // ---------- persistent aftermath smoke (setHouseDamage wisps) ----------
  // One Points cloud, rebuilt (not per-frame) when the damage set changes, then
  // risen + wrapped in the tick like the chimney smoke. World-space positions.
  const DMG_SMOKE_MAX = 200;
  const damageSmokePos = new Float32Array(DMG_SMOKE_MAX * 3);
  const damageSmokeBase = new Float32Array(DMG_SMOKE_MAX);
  let damageSmokeCount = 0;
  const damageSmokeGeo = new THREE.BufferGeometry();
  const damageSmokeAttr = new THREE.BufferAttribute(damageSmokePos, 3);
  damageSmokeGeo.setAttribute('position', damageSmokeAttr);
  damageSmokeGeo.setDrawRange(0, 0);
  const damageSmokeMat = new THREE.PointsMaterial({ color: 0x6b6157, size: 0.8, transparent: true, opacity: 0.42, depthWrite: false });
  const damageSmoke = new THREE.Points(damageSmokeGeo, damageSmokeMat);
  damageSmoke.visible = false;
  scene.add(damageSmoke);

  // ---------- house damage overlay (setHouseDamage) ----------
  // Stored so setHouses can re-apply it after a remap (see the applyHouseDamage
  // call there). Shared materials, per-house geometry disposed on clear.
  const charMat = lam(0x2a221e); // burnt timber / broken foundation
  const rubbleMatA = lam(0x3a332c, { flatShading: true });
  const rubbleMatB = lam(0x2c261f, { flatShading: true });
  const damageRoofDarkMat = lam(0x241d18); // scorched roof on a damaged house
  const scorchMat = new THREE.MeshBasicMaterial({ color: 0x140f0c, transparent: true, opacity: 0.55, depthWrite: false, fog: false });
  const houseDamageStates: { index: number; status: 'destroyed' | 'damaged' }[] = [];
  const damageObjects: THREE.Object3D[] = []; // per-house overlay groups
  const damageHidden: THREE.Object3D[] = []; // structure hidden on 'destroyed'
  const damageRoofSwaps: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] }[] = [];
  function clearHouseDamageOverlay() {
    for (const s of damageRoofSwaps) s.mesh.material = s.original;
    damageRoofSwaps.length = 0;
    for (const o of damageHidden) o.visible = true;
    damageHidden.length = 0;
    for (const o of damageObjects) {
      o.parent?.remove(o);
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        m.geometry?.dispose?.(); // materials are shared, only geometry is per-house
      });
    }
    damageObjects.length = 0;
  }
  function applyHouseDamage() {
    clearHouseDamageOverlay();
    const anchors: { x: number; z: number; by: number }[] = [];
    if (houseDamageStates.length > 0) {
      const { houses } = ensureGrowOrder();
      for (const st of houseDamageStates) {
        const g = houses[st.index];
        if (!g) continue;
        const overlay = new THREE.Group();
        if (st.status === 'destroyed') {
          // hide the standing structure (meshes + cosmetics group), keep the
          // owner label (a CSS2DObject, neither Mesh nor Group) above the ruin
          for (const c of g.children) {
            if ((c as THREE.Mesh).isMesh || (c as THREE.Group).isGroup) {
              c.visible = false;
              damageHidden.push(c);
            }
          }
          overlay.add(box(1.9, 0.4, 1.6, charMat, 0, 0.2, 0));
          overlay.add(box(0.4, 0.85, 0.4, charMat, -0.7, 0.42, 0.5));
          overlay.add(box(0.35, 0.6, 0.35, charMat, 0.75, 0.3, -0.4));
          for (let i = 0; i < 4; i++) {
            const rs = 0.34 + Math.random() * 0.4;
            const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), i % 2 ? rubbleMatA : rubbleMatB);
            rock.scale.set(rs, rs * 0.7, rs);
            rock.position.set((Math.random() - 0.5) * 1.8, rs * 0.35, (Math.random() - 0.5) * 1.5);
            overlay.add(rock);
          }
          const scorch = new THREE.Mesh(new THREE.CircleGeometry(1.8, 18), scorchMat);
          scorch.rotation.x = -Math.PI / 2;
          scorch.position.y = 0.04;
          overlay.add(scorch);
          for (let k = 0; k < 5; k++) anchors.push({ x: g.position.x, z: g.position.z, by: 0.8 });
        } else {
          // damaged: darken the roof, scorch the ground, char a wall corner
          const roof = roofMeshOf(g);
          if (roof) {
            damageRoofSwaps.push({ mesh: roof, original: roof.material });
            roof.material = damageRoofDarkMat;
          }
          overlay.add(box(0.7, 0.5, 0.7, charMat, 0.4, 0.25, -0.3));
          const scorch = new THREE.Mesh(new THREE.CircleGeometry(1.3, 16), scorchMat);
          scorch.rotation.x = -Math.PI / 2;
          scorch.position.set(0.2, 0.04, 0.6);
          overlay.add(scorch);
          for (let k = 0; k < 3; k++) anchors.push({ x: g.position.x, z: g.position.z, by: 2.2 });
        }
        g.add(overlay);
        damageObjects.push(overlay);
      }
    }
    // rebuild the aftermath smoke cloud from the new anchor set
    const n = Math.min(DMG_SMOKE_MAX, anchors.length);
    for (let i = 0; i < n; i++) {
      const a = anchors[i]!;
      damageSmokePos[i * 3] = a.x + (Math.random() - 0.5) * 0.9;
      damageSmokePos[i * 3 + 1] = a.by + Math.random() * 2.4;
      damageSmokePos[i * 3 + 2] = a.z + (Math.random() - 0.5) * 0.9;
      damageSmokeBase[i] = a.by;
    }
    damageSmokeCount = n;
    damageSmokeGeo.setDrawRange(0, n);
    damageSmokeAttr.needsUpdate = true;
    damageSmoke.visible = n > 0;
  }
  function setHouseDamage(states: { index: number; status: 'destroyed' | 'damaged' }[]) {
    try {
      houseDamageStates.length = 0;
      if (Array.isArray(states)) {
        for (const s of states) {
          if (!s) continue;
          const status = s.status === 'destroyed' ? 'destroyed' : s.status === 'damaged' ? 'damaged' : null;
          if (status === null) continue;
          const index = Math.round(s.index);
          if (!Number.isFinite(index) || index < 0) continue;
          houseDamageStates.push({ index, status });
        }
      }
      applyHouseDamage();
    } catch {
      /* aftermath overlay, never throw into the caller */
    }
  }

  // ---------- house rebuild grow-back (rebuildHouse) ----------
  // Ruins -> frame -> roof -> house over ~1.5s, reusing the group-scale convention
  // the rest of the scene uses. Advanced from the tick, self-terminating.
  type Rebuild = { g: THREE.Group; roof: THREE.Mesh | null; t: number; dur: number; targetScale: number };
  const rebuilds: Rebuild[] = [];
  function rebuildHouse(index: number) {
    try {
      const { houses } = ensureGrowOrder();
      const idx = Math.round(index);
      const g = houses[idx];
      if (!g) return;
      // drop this house's damage state, then re-render the rest so its ruin is
      // cleared and its structure restored before the grow-back plays
      const before = houseDamageStates.length;
      for (let i = houseDamageStates.length - 1; i >= 0; i--) {
        if (houseDamageStates[i]!.index === idx) houseDamageStates.splice(i, 1);
      }
      if (before !== houseDamageStates.length) applyHouseDamage();
      const targetScale = g.scale.x || 1;
      const roof = roofMeshOf(g);
      g.scale.setScalar(Math.max(0.02, targetScale * 0.05));
      if (roof) roof.visible = false; // reveal the roof partway through the grow
      rebuilds.push({ g, roof, t: 0, dur: 1.5, targetScale });
    } catch {
      /* never throw into the caller */
    }
  }
  function advanceRebuilds(dt: number) {
    for (let i = rebuilds.length - 1; i >= 0; i--) {
      const rb = rebuilds[i]!;
      rb.t += dt;
      const p = Math.min(1, rb.t / rb.dur);
      if (rb.roof) rb.roof.visible = p > 0.45; // frame first, roof second
      let s: number;
      if (p < 0.85) s = rb.targetScale * (0.05 + 0.95 * (p / 0.85));
      else s = rb.targetScale * (1 + Math.sin(((p - 0.85) / 0.15) * Math.PI) * 0.12); // settle pop
      rb.g.scale.setScalar(s);
      if (p >= 1) {
        rb.g.scale.setScalar(rb.targetScale);
        if (rb.roof) rb.roof.visible = true;
        rebuilds.splice(i, 1);
      }
    }
  }

  // ---------- cinematic driver ----------
  function triggerImpact(x: number, y: number, z: number) {
    let im = impacts.find((s) => !s.active);
    if (!im) im = impacts[0]!; // all busy: recycle the first slot
    im.active = true;
    im.t = 0;
    im.dur = 0.5;
    im.flash.position.set(x, y, z);
    im.flash.scale.setScalar(0.5);
    im.flash.visible = true;
    im.flashMat.opacity = 1;
    im.ring.position.set(x, 0.06, z);
    im.ring.scale.setScalar(1);
    im.ring.visible = true;
    im.ringMat.opacity = 0.6;
    const n = im.emberPos.length / 3;
    for (let k = 0; k < n; k++) {
      im.emberPos[k * 3] = x;
      im.emberPos[k * 3 + 1] = y;
      im.emberPos[k * 3 + 2] = z;
      const ea = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      im.emberVel[k * 3] = Math.cos(ea) * sp;
      im.emberVel[k * 3 + 1] = 3 + Math.random() * 5;
      im.emberVel[k * 3 + 2] = Math.sin(ea) * sp;
    }
    im.embers.visible = true;
    im.emberMat.opacity = 1;
    im.emberAttr.needsUpdate = true;
    const l = impactLights[impactLightIdx % impactLights.length]!;
    impactLightIdx++;
    l.position.set(x, y + 1.4, z);
    l.intensity = siegeHeavy ? 60 : 40;
  }
  function triggerPlume(x: number, y: number, z: number) {
    let pl = plumes.find((s) => !s.active);
    if (!pl) pl = plumes[0]!;
    pl.active = true;
    pl.t = 0;
    pl.dur = 3.0 + Math.random() * 0.6;
    const by = Math.max(0.4, y);
    const n = pl.pos.length / 3;
    for (let k = 0; k < n; k++) {
      pl.pos[k * 3] = x + (Math.random() - 0.5) * 1.2;
      pl.pos[k * 3 + 1] = by + Math.random() * 1.6;
      pl.pos[k * 3 + 2] = z + (Math.random() - 0.5) * 1.2;
      pl.base[k] = by;
    }
    pl.points.visible = true;
    pl.mat.opacity = 0.5;
    pl.attr.needsUpdate = true;
  }
  function onFireballLand(fb: Fireball) {
    triggerImpact(fb.to.x, fb.to.y, fb.to.z);
    triggerPlume(fb.to.x, fb.to.y + 0.4, fb.to.z);
    if (fb.houseIndex >= 0) triggerPlume(fb.to.x, fb.to.y + 1.4, fb.to.z); // struck house catches fire
    shakeMag = Math.max(shakeMag, siegeHeavy ? 0.5 : 0.22);
  }
  function playRaidCinematic(opts: { outcome: 'held' | 'breach' | 'fallen'; fireballs: { power: number; segment: number; blocked: boolean }[]; hitHouseIndices: number[] }) {
    try {
      ensureSiege();
      ensureDome();
      const outcome = opts && (opts.outcome === 'breach' || opts.outcome === 'fallen') ? opts.outcome : 'held';
      siegeHeavy = outcome !== 'held';
      const list = opts && Array.isArray(opts.fireballs) ? opts.fireballs : [];
      const hitIdx = opts && Array.isArray(opts.hitHouseIndices) ? opts.hitHouseIndices : [];
      const { houses } = ensureGrowOrder();

      // wall segment breaks on breach/fallen; a 'fallen' town also hazes over
      setWallBreach(siegeHeavy);
      hazeTarget = outcome === 'fallen' ? 0.16 : 0;

      // fireballs now FALL straight down onto their dome panel; pierced ones then
      // plunge on to a house from hitHouseIndices (round-robin over the list).
      const count = Math.max(0, Math.min(MAX_FIREBALLS, list.length));
      const warmup = 0.55;
      const stagger = 0.36;
      let houseCursor = 0;
      for (let i = 0; i < count; i++) {
        const spec = list[i]!;
        const fb = fireballs[i]!;
        const segment = spec && Number.isFinite(spec.segment) ? ((Math.round(spec.segment) % DOME_SEG) + DOME_SEG) % DOME_SEG : i % DOME_SEG;
        const blocked = !!(spec && spec.blocked);
        fb.segment = segment;
        fb.blocked = blocked;
        fb.pierced = false;
        // first leg: from high above the dome, straight down onto the panel point
        domeHitPoint(segment, fb.to);
        fb.from.set(fb.to.x, 96 + (i % 3) * 6, fb.to.z); // staggered entry heights, above the dome
        // second leg (pierced only): the next resolvable house, else straight down
        fb.houseIndex = -1;
        fb.houseHit.set(fb.to.x, 0.6, fb.to.z);
        if (!blocked && hitIdx.length > 0) {
          for (let s = 0; s < hitIdx.length; s++) {
            const idx = Math.round(hitIdx[(houseCursor + s) % hitIdx.length]!);
            const g = houses[idx];
            if (g) {
              fb.houseIndex = idx;
              fb.houseHit.set(g.position.x, 0.8, g.position.z);
              houseCursor = (houseCursor + s + 1) % hitIdx.length;
              break;
            }
          }
        }
        fb.peak = 0; // steep vertical fall, no arc bow
        fb.dur = 0.9 + (i % 4) * 0.06; // deterministic per-index variety
        fb.startAt = warmup + i * stagger;
        fb.t = 0;
        fb.state = 1;
        fb.core.visible = fb.trail.visible = fb.puff.visible = false;
      }
      for (let i = count; i < fireballs.length; i++) {
        const fb = fireballs[i]!;
        fb.state = 0;
        fb.core.visible = fb.trail.visible = fb.puff.visible = false;
      }
      siegeActive = true;
      siegeElapsed = 0;
      const lastStart = warmup + (Math.max(1, count) - 1) * stagger;
      const linger = siegeHeavy ? 3.6 : 2.4;
      siegeDuration = Math.max(6, Math.min(14, lastStart + 1.8 + linger + (outcome === 'fallen' ? 3 : 0)));
    } catch {
      /* cinematic is cosmetic, never throw into the caller */
    }
  }
  function advanceSiege(dt: number, t: number) {
    // rebuilds + aftermath smoke run regardless of a cinematic being active
    if (rebuilds.length > 0) advanceRebuilds(dt);
    if (damageSmokeCount > 0) {
      for (let i = 0; i < damageSmokeCount; i++) {
        let y = damageSmokePos[i * 3 + 1]! + dt * 0.5;
        const by = damageSmokeBase[i]!;
        if (y > by + 2.6) y -= 2.6;
        damageSmokePos[i * 3 + 1] = y;
      }
      damageSmokeAttr.needsUpdate = true;
    }
    // the dome breathes + heals independent of a cinematic, so advance it first
    advanceDome(dt, t);
    if (!siegeReady) return;

    if (siegeActive) siegeElapsed += dt;
    let anyFlying = false;
    for (const fb of fireballs) {
      if (fb.state === 1) {
        if (siegeElapsed >= fb.startAt) {
          fb.state = 2;
          fb.t = 0;
        } else {
          anyFlying = true;
          continue;
        }
      }
      if (fb.state === 2) {
        fb.t += dt;
        const p = Math.min(1, fb.t / fb.dur);
        _sv1.lerpVectors(fb.from, fb.to, p);
        fb.core.position.copy(_sv1);
        fb.core.scale.setScalar(1 + 0.2 * Math.sin(t * 40 + fb.startAt * 10)); // flicker
        fb.core.visible = true;
        // steep plunge: the trail points back up the full 3D travel direction
        _dir.subVectors(fb.to, fb.from).normalize();
        _dir2.copy(_dir).multiplyScalar(-1);
        _q.setFromUnitVectors(_up, _dir2);
        fb.trail.position.copy(_sv1);
        fb.trail.quaternion.copy(_q);
        fb.trail.visible = true;
        fb.puff.position.set(_sv1.x - _dir.x * 1.2, _sv1.y - _dir.y * 1.2, _sv1.z - _dir.z * 1.2);
        fb.puff.visible = true;
        if (p >= 1) {
          if (fb.blocked) {
            // stopped dead on the shield: panel ripple + spark, no house damage
            fb.state = 0;
            fb.core.visible = fb.trail.visible = fb.puff.visible = false;
            triggerDomeStrike(fb.segment, fb.to, false);
          } else if (!fb.pierced) {
            // punches through: white flash + a momentary gap, then keep falling
            fb.pierced = true;
            triggerDomeStrike(fb.segment, fb.to, true);
            fb.from.copy(fb.to);       // continue from the dome hit down to the house
            fb.to.copy(fb.houseHit);
            fb.t = 0;
            fb.dur = 0.5;              // quick second-leg plunge onto the house
            anyFlying = true;
          } else {
            // reached the house: existing impact / ember / dust / plume + shake
            fb.state = 0;
            fb.core.visible = fb.trail.visible = fb.puff.visible = false;
            onFireballLand(fb);
          }
        } else {
          anyFlying = true;
        }
      }
    }
    // impacts: flash grows + fades, dust ring expands, embers arc under gravity
    for (const im of impacts) {
      if (!im.active) continue;
      im.t += dt;
      const p = Math.min(1, im.t / im.dur);
      im.flash.scale.setScalar(0.5 + p * 2.4);
      im.flashMat.opacity = Math.max(0, 1 - p);
      im.ring.scale.setScalar(1 + p * 3.4);
      im.ringMat.opacity = 0.6 * (1 - p);
      const n = im.emberPos.length / 3;
      for (let k = 0; k < n; k++) {
        const vy = im.emberVel[k * 3 + 1]!;
        im.emberPos[k * 3] = im.emberPos[k * 3]! + im.emberVel[k * 3]! * dt;
        im.emberPos[k * 3 + 1] = im.emberPos[k * 3 + 1]! + vy * dt;
        im.emberPos[k * 3 + 2] = im.emberPos[k * 3 + 2]! + im.emberVel[k * 3 + 2]! * dt;
        im.emberVel[k * 3 + 1] = vy - 9 * dt;
      }
      im.emberAttr.needsUpdate = true;
      im.emberMat.opacity = Math.max(0, 1 - p);
      if (p >= 1) {
        im.active = false;
        im.flash.visible = false;
        im.ring.visible = false;
        im.embers.visible = false;
      }
    }
    // lingering plumes rise + fade
    for (const pl of plumes) {
      if (!pl.active) continue;
      pl.t += dt;
      const p = Math.min(1, pl.t / pl.dur);
      const n = pl.pos.length / 3;
      for (let k = 0; k < n; k++) {
        pl.pos[k * 3 + 1] = pl.pos[k * 3 + 1]! + dt * (0.8 + (0.4 * k) / n);
      }
      pl.attr.needsUpdate = true;
      pl.mat.opacity = 0.5 * (1 - p);
      if (p >= 1) {
        pl.active = false;
        pl.points.visible = false;
      }
    }
    // impact flash lights decay to black
    for (const l of impactLights) {
      if (l.intensity > 0.5) l.intensity *= Math.exp(-dt * 3.2);
      else l.intensity = 0;
    }
    // smoke haze eases toward its target; it clears once the cinematic ends
    if (hazeMesh && hazeMat) {
      if (!siegeActive) hazeTarget = 0;
      const o = hazeMat.opacity + (hazeTarget - hazeMat.opacity) * (1 - Math.exp(-dt * 0.8));
      hazeMat.opacity = o;
      hazeMesh.visible = o > 0.004;
    }
    // watchtower beacon flare pulses with the siege mood
    if (siegeBeaconMesh) {
      (siegeBeaconMesh.material as THREE.MeshBasicMaterial).opacity = siegeMood * (0.4 + 0.35 * Math.sin(t * 9));
      siegeBeaconMesh.visible = siegeMood > 0.01;
      siegeBeaconMesh.scale.setScalar(1 + siegeMood * 0.3 + 0.15 * Math.sin(t * 9));
    }
    // camera shake: decaying random nudge, applied here and removed after render
    if (shakeMag > 0.001) {
      shakeMag *= Math.exp(-dt * 6);
      siegeShake.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5).multiplyScalar(shakeMag);
      camera.position.add(siegeShake);
      siegeShakeApplied = true;
    }
    // the cinematic self-terminates once the timeline elapses and nothing flies
    if (siegeActive && siegeElapsed >= siegeDuration && !anyFlying) siegeActive = false;
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
    setHouseCosmetics,
    setDome,
    playRaidCinematic,
    repairDomeSegment,
    setHouseDamage,
    rebuildHouse,
    setLandParcels,
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
      // shared cosmetic materials may be detached right now; the sweep below
      // only reaches what is in the graph (double dispose is harmless)
      lanternLight?.dispose();
      cosmeticRoofMat.dispose();
      cosmeticGoldMat.dispose();
      cosmeticBannerMat.dispose();
      cosmeticLeafMat.dispose();
      // shared raid-damage materials may be detached from the graph right now,
      // so the sweep below would miss them (double dispose is harmless)
      charMat.dispose();
      rubbleMatA.dispose();
      rubbleMatB.dispose();
      damageRoofDarkMat.dispose();
      scorchMat.dispose();
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
