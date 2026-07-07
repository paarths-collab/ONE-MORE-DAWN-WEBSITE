// ONE MORE DAWN — 3D town scene v3 ("the guild map").
// A ~110-tile organic plateau ringed by mountains: seeded winding dirt roads,
// ~80 rustic houses placed along them, 12 labeled districts (floating banner
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

export type VillageHooks = {
  onProgress: (pct: number) => void;
  onLoad: () => void;
  onSelect: (meta: BuildingMeta | null) => void;
};

export type VillageHandle = {
  setTimeOfDay: (t: TimeOfDay) => void;
  setVillagers: (n: number) => void;
  setCompanion: (kind: CompanionKind, on: boolean) => void;
  dispose: () => void;
  pause: () => void;
  resume: () => void;
  frame: () => void;
};

export const MAX_VILLAGERS = 8;

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

// ---------- time-of-day presets (distances tuned for the ~110-unit world) ----------
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
    bg: 0x141b2d, fogNear: 110, fogFar: 420,
    hemiSky: 0x2a3654, hemiGround: 0x0c1018, hemiInt: 0.55,
    sunColor: 0x8fa5d8, sunInt: 0.4, sunPos: [-40, 85, -30],
    stars: 1, windowCol: 0xffc46a, discCol: 0xdfe8ff, discScale: 3.4, campfire: 30,
  },
  dawn: {
    bg: 0xe89a66, fogNear: 95, fogFar: 380,
    hemiSky: 0xffc9a0, hemiGround: 0x3a4034, hemiInt: 0.75,
    sunColor: 0xffb37a, sunInt: 1.7, sunPos: [95, 20, 40],
    stars: 0.3, windowCol: 0xffcf78, discCol: 0xffd9a8, discScale: 7, campfire: 14,
  },
  day: {
    bg: 0x9ac8e8, fogNear: 140, fogFar: 480,
    hemiSky: 0xfff2d8, hemiGround: 0x4a6b35, hemiInt: 0.95,
    sunColor: 0xfff0c2, sunInt: 2.4, sunPos: [60, 95, 40],
    stars: 0, windowCol: 0x5a4a34, discCol: 0xfff6d8, discScale: 3, campfire: 0,
  },
  dusk: {
    bg: 0xc2694a, fogNear: 100, fogFar: 400,
    hemiSky: 0xe8a06a, hemiGround: 0x2c2118, hemiInt: 0.65,
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

  const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 900);
  camera.position.set(4, 66, 88);

  const size = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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
  controls.maxDistance = 130;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.12;
  controls.screenSpacePanning = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.addEventListener('change', () => {
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -42, 42);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -42, 42);
    controls.target.y = 0;
  });

  // ---------- lights + sky machinery ----------
  const hemi = new THREE.HemisphereLight(PRESETS.dawn.hemiSky, PRESETS.dawn.hemiGround, PRESETS.dawn.hemiInt);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PRESETS.dawn.sunColor, PRESETS.dawn.sunInt);
  sun.position.set(...PRESETS.dawn.sunPos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.camera.far = 320;
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

    (scene.background as THREE.Color).copy(env.bg);
    const fog = scene.fog as THREE.Fog;
    fog.color.copy(env.bg);
    fog.near = env.fogNear;
    fog.far = env.fogFar;
    hemi.color.copy(env.hemiSky);
    hemi.groundColor.copy(env.hemiGround);
    hemi.intensity = env.hemiInt;
    sun.color.copy(env.sunColor);
    sun.intensity = env.sunInt;
    sun.position.copy(env.sunPos);
    glowMat.color.copy(env.windowCol);
    discMat.color.copy(env.discCol);
    (discHalo.material as THREE.MeshBasicMaterial).color.copy(env.discCol);
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

  // ---------- plateau shape (organic radius, ~108 tiles across) ----------
  const PHI1 = rng() * Math.PI * 2;
  const PHI2 = rng() * Math.PI * 2;
  const plateauR = (theta: number) =>
    46 + 6.5 * Math.sin(3 * theta + PHI1) + 4 * Math.sin(7 * theta + PHI2);
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
  const SIZE = 112; // bounding grid — plateau carves an organic ~92..105-tile shape out of it
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
    for (let i = 0; i < 150; i++) {
      const a = (i / 150) * Math.PI * 2 + rng() * 0.06;
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
    }
    scene.add(group);
    interactables.push(group);
    occupy(x, z, Math.ceil(ringR));
    return group;
  }

  // ---------- rustic house kit (the town filler) ----------
  const ROOFS = [MAT.roofSlate, MAT.roofSlateDark, MAT.roofBrown];
  function house(x: number, z: number, facing: number, big = false) {
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
    const [x, z] = ringSpot(0.3, 24);
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
    const [x, z] = ringSpot(-1.85, 25);
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
    const [x, z] = ringSpot(-0.75, 26);
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
    const [x, z] = ringSpot(1.05, 25);
    const g = new THREE.Group();
    g.add(box(4.4, 1.6, 2.0, MAT.timber, -0.5, 0.8, -0.9));
    g.add(pyramid(4.8, 1.1, 2.4, MAT.roofBrown, -0.5, 2.1, -0.9));
    g.add(box(3.4, 1.4, 1.8, MAT.timber, 0.7, 0.7, 1.6));
    g.add(pyramid(3.8, 1.0, 2.2, MAT.roofBrown, 0.7, 1.85, 1.6));
    for (const [bx, bz] of [[2.4, -0.4], [2.9, 0.3], [2.2, 0.8]] as const) g.add(cyl(0.3, 0.6, MAT.timberDark, bx, 0.3, bz, 8));
    register(g, x, z, { name: 'STORAGE', level: 3, blurb: 'Every loaf the expeditions bank sleeps behind these doors.' }, 4.0, { icon: '📦', y: 3.6 });
  }
  // PRODUCTION — mill + fields west
  let rotor: THREE.Group | null = null;
  {
    const [x, z] = ringSpot(3.3, 26);
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
    const [x, z] = ringSpot(-2.6, 23);
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
    const [x, z] = ringSpot(-1.2, 13);
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
    const [x, z] = ringSpot(0.9, 13);
    const g = new THREE.Group();
    g.add(box(2.8, 1.6, 2.2, MAT.plaster, 0, 0.8, 0));
    g.add(box(3.0, 0.25, 2.4, MAT.timberDark, 0, 1.72, 0));
    g.add(pyramid(3.2, 1.2, 2.6, MAT.roofSlate, 0, 2.4, 0));
    g.add(box(1.6, 0.1, 0.8, MAT.timber, 0, 0.05, 1.5));
    g.add(cyl(0.06, 0.9, MAT.timberDark, -0.6, 0.45, 1.8, 6));
    g.add(cyl(0.06, 0.9, MAT.timberDark, 0.6, 0.45, 1.8, 6));
    g.add(box(1.6, 0.1, 0.9, MAT.roofSlate, 0, 0.95, 1.55));
    g.add(glowCube(0.4, -0.8, 1.0, 1.12));
    register(g, x, z, { name: 'DIPLOMACY', level: 2, blurb: 'Envoys from other subreddit-cities are received here.' }, 2.8, { icon: '🕊️', y: 3.4 });
  }
  // NEWS — notice board, inner west
  {
    const [x, z] = ringSpot(2.6, 12);
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
    const [x, z] = ringSpot(-0.2, 14);
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
    const [x, z] = ringSpot(-0.5, 19);
    const g = new THREE.Group();
    g.add(box(1.6, 4.2, 1.6, MAT.timber, 0, 2.1, 0));
    g.add(box(2.2, 0.3, 2.2, MAT.timberDark, 0, 4.35, 0));
    g.add(box(1.9, 1.0, 1.9, MAT.plaster, 0, 5.0, 0));
    g.add(pyramid(2.3, 1.1, 2.3, MAT.roofSlateDark, 0, 6.05, 0));
    g.add(glowCube(0.4, 0, 5.1, 0.98));
    register(g, x, z, { name: 'STATISTICS', level: 2, blurb: 'Dawns survived, pledges counted — the chronicle keeps score.' }, 2.4, { icon: '📊', y: 7.0 });
  }

  // ---------- filler houses along the roads (~80) ----------
  {
    let placed = 0;
    const candidates: [number, number, number][] = [];
    for (const road of roads) {
      for (let i = 0; i < road.length - 1; i++) {
        const [x1, z1] = road[i]!;
        const [x2, z2] = road[i + 1]!;
        const len = Math.hypot(x2 - x1, z2 - z1);
        const steps = Math.max(1, Math.floor(len / 2.4));
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
    for (let i = 0; i < 90; i++) {
      const a = rng() * Math.PI * 2;
      const r = 8 + Math.sqrt(rng()) * 26;
      candidates.push([Math.cos(a) * r, Math.sin(a) * r, rng() * Math.PI * 2]);
    }
    // shuffle-ish deterministic order
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
    }
    for (const [hx, hz, facing] of candidates) {
      if (placed >= 96) break;
      if (!insidePlateau(hx, hz, 8)) continue;
      // r=1 (3×3 tiles) fits the ~2-unit house footprint without swallowing the
      // roadside strip; occupy() below still reserves 5×5 so houses keep gaps.
      if (!isFree(hx, hz, 1)) continue;
      house(hx, hz, facing, rng() > 0.8);
      placed++;
    }
  }

  // ---------- palisade wall (instanced log posts along the plateau, inset) ----------
  {
    const posts: [number, number][] = [];
    const N = 560;
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
      }
    }
  }

  // ---------- forest (instanced pines: between wall and cliffs + sprinkled inside) ----------
  {
    const spots: [number, number, number][] = [];
    for (let i = 0; i < 900; i++) {
      const a = rng() * Math.PI * 2;
      const edge = plateauR(a);
      const r = edge - 2.2 + rng() * 1.6; // just outside the palisade
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!insidePlateau(x, z, 0.5)) continue;
      if (GATE_ANGLES.some((ga) => Math.abs(Math.atan2(Math.sin(a - ga), Math.cos(a - ga))) < 0.09)) continue;
      spots.push([x, z, 0.8 + rng() * 0.9]);
      if (spots.length >= 300) break;
    }
    for (let i = 0; i < 700 && spots.length < 440; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 40;
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

  // ---------- characters ----------
  type Actor = { obj: THREE.Object3D; mixer: THREE.AnimationMixer; walker?: (dt: number) => void };
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
      gltfCache.set(file, new Promise((res, rej) => loader.load(`/assets/${file}`, (g) => res(g as never), undefined, rej)));
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
      mixer.clipAction(clip(/walk/i, 3)).play();
      const route = ROUTES[idx % ROUTES.length]!;
      const actor: Actor = { obj: v, mixer, walker: makeWalker(v, route.pts, route.speed) };
      villagers.push(actor);
      actors.add(actor);
    }
    while (villagers.length > wantedVillagers) {
      const actor = villagers.pop()!;
      scene.remove(actor.obj);
      actors.delete(actor);
    }
  }

  const COMPANIONS: Record<CompanionKind, { file: string; size: number; orbit?: [number, number, number, number] }> = {
    horse: { file: 'Horse.glb', size: 2.1 },
    flamingo: { file: 'Flamingo.glb', size: 1.5, orbit: [20, 13, 0.2, 0] },
    parrot: { file: 'Parrot.glb', size: 1.5, orbit: [14, 11, 0.27, 2.2] },
    stork: { file: 'Stork.glb', size: 1.5, orbit: [27, 15, 0.16, 4.1] },
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
      const [px, pz] = ringSpot(3.3, 26);
      actor.walker = makeWalker(obj, [[px - 1, pz - 5.4], [px + 3.6, pz - 5.0], [px + 4.2, pz - 7.4], [px - 0.4, pz - 7.6]], 1.1);
    } else if (def.orbit) {
      orbiters.set(kind, { actor, radius: def.orbit[0], height: def.orbit[1], speed: def.orbit[2], phase: def.orbit[3] });
    }
    companions.set(kind, actor);
    actors.add(actor);
  }

  void syncVillagers();
  void setCompanionImpl('horse', true);
  void setCompanionImpl('flamingo', true);
  void setCompanionImpl('parrot', true);
  void setCompanionImpl('stork', true);

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
  const setRingVis = (group: THREE.Group | null, on: boolean) => {
    const ring = group?.userData.ring as THREE.Mesh | undefined;
    if (ring) ring.visible = on;
  };
  function setSelected(g: THREE.Group | null) {
    if (selected && selected !== g) setRingVis(selected, false);
    selected = g;
    if (g) setRingVis(g, true);
  }
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const g = pick(e.clientX, e.clientY);
    if (g !== hovered) {
      if (hovered !== selected) setRingVis(hovered, false);
      hovered = g;
      if (hovered) setRingVis(hovered, true);
      renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab';
    }
  };
  let downAt: [number, number] | null = null;
  const onDown = (e: PointerEvent) => { downAt = [e.clientX, e.clientY]; };
  const onUp = (e: PointerEvent) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 8) return;
    const g = pick(e.clientX, e.clientY);
    setSelected(g);
    if (g) {
      const { name, level, blurb } = g.userData as BuildingMeta;
      hooks.onSelect({ name, level, blurb });
    } else {
      hooks.onSelect(null);
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
    controls.update();
    lerpEnv(dt);
    for (const a of actors) {
      a.mixer.update(dt);
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
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };
  renderer.setAnimationLoop(tick);

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
    pause: () => renderer.setAnimationLoop(null),
    resume: () => renderer.setAnimationLoop(tick),
    frame: () => tick(),
    dispose: () => {
      disposed = true;
      renderer.setAnimationLoop(null);
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
