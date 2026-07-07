// ONE MORE DAWN — 3D village scene (React port of village3d/main.js).
// Framework-agnostic: createVillageScene(container, hooks) builds the diorama
// and reports UI events (loading progress, building selection) through
// callbacks; the React layer owns all visible HUD. Deterministic seeded
// layout; characters are the official three.js example models in /assets.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export type BuildingMeta = { name: string; level: number; blurb: string };

export type VillageHooks = {
  onProgress: (pct: number) => void;
  onLoad: () => void;
  onSelect: (meta: BuildingMeta | null) => void;
};

export type VillageHandle = {
  dispose: () => void;
  pause: () => void;
  resume: () => void;
  frame: () => void;
};

// ---------- seeded rng (mulberry32 — village never reshuffles) ----------
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

// ---------- palette (CoC brightness, One More Dawn warmth) ----------
const C = {
  sky: 0x9ac8e8,
  grassA: 0x7ab648, grassB: 0x6da53f,
  path: 0xd9c79b, pathB: 0xcdb98c,
  cliff: 0x8a5a33, cliffDark: 0x6e4527,
  water: 0x2e6b8a,
  timber: 0x9a6b3f, timberDark: 0x7d5430,
  stone: 0x9a938a, stoneDark: 0x7c756c,
  roofGold: 0xe8c34a, roofRed: 0xc85040, roofBlue: 0x6c8be0, roofGreen: 0x57c06a, roofSlate: 0x6f6357,
  cropGreen: 0x8fd05c, cropDark: 0x5b8c3a,
  leaf: 0x4c8f3a, leafDark: 0x3e7830, trunk: 0x6e4527,
  rock: 0x8f8578,
  flag: 0xe8c34a,
};

export function createVillageScene(container: HTMLElement, hooks: VillageHooks): VillageHandle {
  const rng = makeRng(20260707);
  let disposed = false;

  // ---------- renderer / scene / camera ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.sky);
  renderer.setClearColor(C.sky, 1);
  scene.fog = new THREE.Fog(C.sky, 45, 130);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 220);
  camera.position.set(15, 17, 19);

  const size = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  size();
  const ro = new ResizeObserver(size);
  ro.observe(container);
  window.addEventListener('resize', size);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0.5);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 11;
  controls.maxDistance = 40;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 1.12;
  controls.screenSpacePanning = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.addEventListener('change', () => {
    // keep the camera on the island — CoC never lets you pan into the void
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -9, 9);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -9, 9);
    controls.target.y = 0;
  });

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0xfff2d8, 0x4a6b35, 0.95));
  const sun = new THREE.DirectionalLight(0xfff0c2, 2.4);
  sun.position.set(18, 26, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -20;
  sun.shadow.camera.right = 20;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // ---------- materials ----------
  const lam = (color: number, opts: Record<string, unknown> = {}) =>
    new THREE.MeshLambertMaterial({ color, ...opts });
  const MAT = {
    timber: lam(C.timber), timberDark: lam(C.timberDark),
    stone: lam(C.stone), stoneDark: lam(C.stoneDark),
    trunk: lam(C.trunk), rock: lam(C.rock),
    crop: lam(C.cropGreen), cropDark: lam(C.cropDark),
  };

  // ---------- terrain ----------
  const TILES = 24;
  const HALF = TILES / 2;
  {
    const tileGeo = new THREE.BoxGeometry(1, 0.14, 1);
    const grass = new THREE.InstancedMesh(tileGeo, lam(0xffffff), TILES * TILES);
    grass.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    let i = 0;
    const onPath = (x: number, z: number) =>
      (Math.abs(x) <= 1 && z >= 0) || (Math.abs(z) <= 0.6 && x >= -6 && x <= 0);
    for (let gx = 0; gx < TILES; gx++) {
      for (let gz = 0; gz < TILES; gz++) {
        const x = gx - HALF + 0.5;
        const z = gz - HALF + 0.5;
        m4.setPosition(x, -0.07, z);
        grass.setMatrixAt(i, m4);
        if (onPath(x, z)) col.setHex((gx + gz) % 2 ? C.path : C.pathB);
        else col.setHex((gx + gz) % 2 ? C.grassA : C.grassB);
        grass.setColorAt(i, col);
        i++;
      }
    }
    scene.add(grass);

    const cliff = new THREE.Mesh(new THREE.BoxGeometry(TILES, 2.2, TILES), lam(C.cliff));
    cliff.position.y = -1.24;
    scene.add(cliff);
    const cliffFoot = new THREE.Mesh(new THREE.BoxGeometry(TILES + 1.4, 0.9, TILES + 1.4), lam(C.cliffDark));
    cliffFoot.position.y = -2.4;
    scene.add(cliffFoot);

    const water = new THREE.Mesh(new THREE.CircleGeometry(300, 48), lam(C.water));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -2.6;
    scene.add(water);
  }

  // ---------- building kit ----------
  const interactables: THREE.Group[] = [];

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

  function register(group: THREE.Group, x: number, z: number, meta: BuildingMeta, ringR: number) {
    group.position.set(x, 0, z);
    group.userData = { ...meta };
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ringR, ringR + 0.16, 28),
      new THREE.MeshBasicMaterial({ color: C.roofGold, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.visible = false;
    group.add(ring);
    group.userData.ring = ring;
    scene.add(group);
    interactables.push(group);
    return group;
  }

  // town hall
  let flag: THREE.Mesh | null = null;
  {
    const g = new THREE.Group();
    g.add(box(3.6, 0.5, 3.6, MAT.stoneDark, 0, 0.25, 0));
    g.add(box(3.0, 1.7, 3.0, MAT.timber, 0, 1.35, 0));
    g.add(box(3.2, 0.24, 3.2, MAT.timberDark, 0, 2.32, 0));
    g.add(pyramid(3.4, 1.7, 3.4, lam(C.roofGold), 0, 3.3, 0));
    g.add(box(0.9, 1.1, 0.12, MAT.timberDark, 0, 0.95, 1.51));
    g.add(box(0.6, 0.5, 0.1, lam(0xffd97a), -1.0, 1.6, 1.51));
    g.add(box(0.6, 0.5, 0.1, lam(0xffd97a), 1.0, 1.6, 1.51));
    g.add(cyl(0.05, 1.6, MAT.timberDark, 0, 4.9, 0, 6));
    flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), lam(C.flag, { side: THREE.DoubleSide }));
    flag.position.set(0.48, 5.35, 0);
    g.add(flag);
    register(g, 0, -1, { name: 'TOWN HALL', level: 4, blurb: 'The heart of the village. Every decision at dawn happens here.' }, 2.6);
  }

  // huts
  const HUTS: [number, number, number, string][] = [
    [-3.6, 2.6, C.roofRed, 'A survivor family sleeps here.'],
    [3.4, 1.8, C.roofBlue, 'Woodsmoke and quiet talk after dark.'],
    [4.6, -2.6, C.roofGreen, 'They keep a candle in the window.'],
    [-4.4, -2.2, C.roofSlate, 'The door is always open to neighbors.'],
    [2.2, 5.4, C.roofRed, 'Close to the gate — first to hear news.'],
  ];
  for (const [hx, hz, roof, blurb] of HUTS) {
    const g = new THREE.Group();
    g.add(box(1.5, 1.0, 1.5, MAT.timber, 0, 0.5, 0));
    g.add(pyramid(1.8, 1.0, 1.8, lam(roof), 0, 1.5, 0));
    g.add(box(0.5, 0.65, 0.1, MAT.timberDark, 0, 0.42, 0.78));
    g.rotation.y = rng() * Math.PI * 2;
    register(g, hx, hz, { name: 'HUT', level: 1 + Math.floor(rng() * 3), blurb }, 1.4);
  }

  // farm
  {
    const g = new THREE.Group();
    const W = 4.4, D = 3.2;
    g.add(box(W, 0.1, D, MAT.cropDark, 0, 0.06, 0));
    for (let r = 0; r < 4; r++) g.add(box(W - 0.7, 0.22, 0.34, MAT.crop, 0, 0.2, -D / 2 + 0.65 + r * 0.72));
    const post = (x: number, z: number) => g.add(box(0.12, 0.55, 0.12, MAT.timberDark, x, 0.28, z));
    for (let x = -W / 2; x <= W / 2 + 0.01; x += 1.1) { post(x, -D / 2); post(x, D / 2); }
    for (let z = -D / 2; z <= D / 2 + 0.01; z += 1.06) { post(-W / 2, z); post(W / 2, z); }
    g.add(box(W, 0.07, 0.07, MAT.timber, 0, 0.45, -D / 2));
    g.add(box(W, 0.07, 0.07, MAT.timber, 0, 0.45, D / 2));
    g.add(box(0.07, 0.07, D, MAT.timber, -W / 2, 0.45, 0));
    g.add(box(0.07, 0.07, D, MAT.timber, W / 2, 0.45, 0));
    register(g, -7, 1.4, { name: 'FARM', level: 3, blurb: 'Grow Food happens here. The greenhouse rows feed the city.' }, 2.9);
  }

  // windmill generator
  let rotor: THREE.Group | null = null;
  {
    const g = new THREE.Group();
    g.add(box(1.7, 0.4, 1.7, MAT.stoneDark, 0, 0.2, 0));
    g.add(box(1.4, 2.4, 1.4, lam(0xb7ab9c), 0, 1.6, 0));
    g.add(pyramid(1.7, 1.0, 1.7, lam(C.roofSlate), 0, 3.3, 0));
    g.add(box(0.5, 0.6, 0.1, MAT.timberDark, 0, 1.0, 0.71));
    g.add(cyl(0.09, 0.7, MAT.timberDark, 0, 2.6, 0.9, 6));
    rotor = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i / 4) * Math.PI * 2 + Math.PI / 4;
      arm.add(box(0.34, 1.6, 0.06, lam(0xe7dcc4), 0, 1.0, 0));
      rotor.add(arm);
    }
    rotor.position.set(0, 2.6, 1.26);
    g.add(rotor);
    register(g, 6.6, -5.2, { name: 'GENERATOR', level: 2, blurb: 'Repair Power keeps these blades — and the night lights — turning.' }, 1.9);
  }

  // clinic
  {
    const g = new THREE.Group();
    g.add(box(2.2, 1.2, 1.8, lam(0xd9d2c5), 0, 0.6, 0));
    g.add(pyramid(2.5, 0.9, 2.1, lam(C.roofRed), 0, 1.65, 0));
    g.add(box(0.55, 0.16, 0.16, lam(C.roofRed), 0, 1.0, 0.92));
    g.add(box(0.16, 0.55, 0.16, lam(C.roofRed), 0, 1.0, 0.92));
    register(g, -6.2, -4.6, { name: 'CLINIC', level: 2, blurb: 'Treat Sick — the medics hold the line against the fever.' }, 1.8);
  }

  // storehouse
  {
    const g = new THREE.Group();
    g.add(cyl(0.95, 1.7, MAT.timber, 0, 0.85, 0, 12));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.9, 12), lam(C.roofSlate));
    roof.position.y = 2.15;
    roof.castShadow = true;
    g.add(roof);
    register(g, 6.4, 1.6, { name: 'STOREHOUSE', level: 3, blurb: 'Every loaf the expeditions bank ends up behind these walls.' }, 1.5);
  }

  // watchtowers + gate
  const TOWERS: [number, number][] = [[-9, -9], [9, -9], [-9, 9], [9, 9]];
  for (const [tx, tz] of TOWERS) {
    const g = new THREE.Group();
    g.add(box(1.1, 2.6, 1.1, MAT.stone, 0, 1.3, 0));
    g.add(box(1.5, 0.35, 1.5, MAT.stoneDark, 0, 2.8, 0));
    g.add(pyramid(1.5, 0.9, 1.5, lam(C.roofSlate), 0, 3.4, 0));
    g.add(box(0.26, 0.26, 0.26, new THREE.MeshBasicMaterial({ color: 0xffcf70 }), 0, 2.6, 0.62));
    register(g, tx, tz, { name: 'WATCHTOWER', level: 2, blurb: 'Guard Wall duty. The watch sees the raiders first.' }, 1.3);
  }
  {
    const g = new THREE.Group();
    g.add(box(0.8, 1.9, 0.8, MAT.stone, -1.6, 0.95, 0));
    g.add(box(0.8, 1.9, 0.8, MAT.stone, 1.6, 0.95, 0));
    g.add(box(4.0, 0.5, 0.7, MAT.stoneDark, 0, 2.1, 0));
    register(g, 0, 10.6, { name: 'SOUTH GATE', level: 1, blurb: 'The only way in. Refugee convoys knock here at dusk.' }, 2.2);
  }

  // perimeter walls (46 segments, south gate gap)
  {
    const segGeo = new THREE.BoxGeometry(1.36, 1.0, 0.45);
    const capGeo = new THREE.BoxGeometry(1.36, 1.22, 0.6);
    let n = 0;
    const wallSeg = (x: number, z: number, rotY: number) => {
      const cap = n % 4 === 3;
      const m = new THREE.Mesh(cap ? capGeo : segGeo, cap ? MAT.stoneDark : MAT.stone);
      m.position.set(x, cap ? 0.61 : 0.5, z);
      m.rotation.y = rotY;
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
      n++;
    };
    for (let i = 0; i < 12; i++) {
      const c = -7.7 + i * 1.4;
      wallSeg(c, -9, 0); // north
      if (Math.abs(c) >= 1.8) wallSeg(c, 9, 0); // south, gate gap
      wallSeg(-9, c, Math.PI / 2); // west
      wallSeg(9, c, Math.PI / 2); // east
    }
  }

  // barracks
  {
    const g = new THREE.Group();
    g.add(box(3.0, 0.3, 2.2, MAT.stoneDark, 0, 0.15, 0));
    g.add(box(2.6, 1.3, 1.8, MAT.timber, 0, 0.95, 0));
    g.add(pyramid(3.0, 1.0, 2.2, lam(C.roofSlate), 0, 2.1, 0));
    g.add(box(0.6, 0.8, 0.1, MAT.timberDark, 0, 0.7, 0.92));
    g.add(cyl(0.05, 1.2, MAT.timberDark, -1.1, 2.5, 0.6, 6));
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), lam(C.roofRed, { side: THREE.DoubleSide }));
    banner.position.set(-0.85, 2.6, 0.6);
    g.add(banner);
    for (const dx of [1.7, 2.2]) {
      g.add(cyl(0.08, 0.7, MAT.trunk, dx, 0.35, -0.4, 6));
      g.add(box(0.3, 0.3, 0.3, MAT.timber, dx, 0.85, -0.4));
    }
    register(g, -3.2, 7.0, { name: 'BARRACKS', level: 2, blurb: 'Where guards drill for the raid. Prepare for Raid starts here.' }, 2.0);
  }

  // market stall
  {
    const g = new THREE.Group();
    for (const [px, pz] of [[-0.8, -0.6], [0.8, -0.6], [-0.8, 0.6], [0.8, 0.6]] as const) {
      g.add(cyl(0.07, 1.2, MAT.timberDark, px, 0.6, pz, 6));
    }
    for (let i = 0; i < 4; i++) {
      const strip = box(0.5, 0.06, 1.6, lam(i % 2 ? 0xe7dcc4 : C.roofRed), -0.75 + i * 0.5, 1.28, 0);
      strip.rotation.z = 0.14;
      g.add(strip);
    }
    g.add(box(1.7, 0.5, 1.0, MAT.timber, 0, 0.55, 0));
    g.add(box(0.28, 0.28, 0.28, lam(C.roofGold), -0.3, 0.94, 0.1));
    g.add(box(0.24, 0.24, 0.24, lam(C.roofGreen), 0.25, 0.92, -0.15));
    g.add(box(0.22, 0.22, 0.22, lam(C.roofGold), 0.4, 0.91, 0.25));
    register(g, 2.0, -5.0, { name: 'MARKET', level: 1, blurb: 'Share Rations happens here — the ledger remembers generosity.' }, 1.6);
  }

  // well
  {
    const g = new THREE.Group();
    g.add(cyl(0.55, 0.5, MAT.stone, 0, 0.25, 0, 12));
    const waterDisc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12), lam(C.water));
    waterDisc.rotation.x = -Math.PI / 2;
    waterDisc.position.y = 0.51;
    g.add(waterDisc);
    g.add(cyl(0.06, 1.0, MAT.timberDark, -0.45, 0.75, 0, 6));
    g.add(cyl(0.06, 1.0, MAT.timberDark, 0.45, 0.75, 0, 6));
    const bar = cyl(0.05, 1.0, MAT.timber, 0, 1.2, 0, 6);
    bar.rotation.z = Math.PI / 2;
    g.add(bar);
    g.add(pyramid(1.3, 0.5, 1.0, lam(C.roofSlate), 0, 1.55, 0));
    register(g, 1.9, 2.9, { name: 'WELL', level: 1, blurb: 'Clean water — the quiet reason the city is still alive.' }, 1.2);
  }

  // torches
  for (const [tx, tz] of [[-1.4, 3.4], [1.4, 3.4], [-1.4, 6.8], [1.4, 6.8]] as const) {
    scene.add(cyl(0.07, 0.9, MAT.timberDark, tx, 0.45, tz, 6));
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshBasicMaterial({ color: 0xffcf70 }));
    glow.position.set(tx, 0.98, tz);
    scene.add(glow);
  }

  // decorations: trees, rocks, flowers, bushes (seeded scatter, keep-outs)
  {
    const clearSpot = (x: number, z: number): boolean => {
      const spots: [number, number, number][] = [
        [0, -1, 2.8], [-3.6, 2.6, 1.2], [3.4, 1.8, 1.2], [4.6, -2.6, 1.2], [-4.4, -2.2, 1.2],
        [2.2, 5.4, 1.2], [6.6, -5.2, 1.2], [-6.2, -4.6, 1.2], [6.4, 1.6, 1.2], [0, 10.6, 1.2],
        [-3.2, 7.0, 1.2], [2.0, -5.0, 1.2], [1.9, 2.9, 1.2],
      ];
      for (const [sx, sz, sr] of spots) if (Math.hypot(x - sx, z - sz) < sr) return false;
      if (x >= -9.2 && x <= -4.8 && z >= -0.2 && z <= 3.0) return false; // farm
      if (Math.abs(x) <= 1.6 && z >= 0) return false; // south path
      if (Math.abs(z) <= 1.2 && x >= -6 && x <= 0) return false; // west path
      if (Math.abs(x) <= 1.4 && z >= 1.0 && z <= 9.1) return false; // route 1
      if (x >= -6.0 && x <= -0.6 && z >= -2.2 && z <= 1.0) return false; // route 2
      if (x >= 1.8 && x <= 6.0 && z >= 0.2 && z <= 4.2) return false; // route 3
      if (x >= -8.2 && x <= -3.4 && z >= 4.2 && z <= 7.0) return false; // pasture
      return true;
    };
    const tree = (x: number, z: number, pine: boolean) => {
      const g = new THREE.Group();
      const s = 0.8 + rng() * 0.5;
      g.add(cyl(0.12 * s, 0.5 * s, MAT.trunk, 0, 0.25 * s, 0, 6));
      if (pine) {
        const m1 = new THREE.Mesh(new THREE.ConeGeometry(0.62 * s, 1.0 * s, 7), lam(C.leafDark));
        m1.position.y = 0.9 * s; m1.castShadow = true; g.add(m1);
        const m2 = new THREE.Mesh(new THREE.ConeGeometry(0.45 * s, 0.8 * s, 7), lam(C.leaf));
        m2.position.y = 1.45 * s; m2.castShadow = true; g.add(m2);
      } else {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62 * s, 1), lam(C.leaf, { flatShading: true }));
        m.position.y = 0.95 * s; m.castShadow = true; g.add(m);
      }
      g.position.set(x, 0, z);
      scene.add(g);
    };
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + rng() * 0.2;
      const r = 10.2 + rng() * 1.1;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.abs(x) < 2.4 && z > 8) continue;
      if (Math.max(Math.abs(x), Math.abs(z)) > HALF - 0.8) continue;
      if (TOWERS.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 2.1)) continue;
      tree(x, z, rng() > 0.45);
    }
    for (let i = 0; i < 8; i++) {
      const x = (rng() * 2 - 1) * 9.5;
      const z = (rng() * 2 - 1) * 9.5;
      if (Math.hypot(x, z) < 5.5 || (Math.abs(x) < 2 && z > 0)) continue;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rng() * 0.3, 0), lam(C.rock, { flatShading: true }));
      rock.position.set(x, 0.2, z);
      rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      rock.castShadow = true;
      scene.add(rock);
    }
    const flowerGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const flowerMats = [lam(0xe86a6a), lam(0xe8c34a), lam(0xffffff)];
    let placed = 0;
    for (let tries = 0; tries < 80 && placed < 14; tries++) {
      const r = Math.sqrt(rng()) * 8.5;
      const a = rng() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!clearSpot(x, z)) continue;
      const f = new THREE.Mesh(flowerGeo, flowerMats[Math.floor(rng() * 3)]!);
      f.position.set(x, 0.08, z);
      scene.add(f);
      placed++;
    }
    let bushes = 0;
    for (let tries = 0; tries < 60 && bushes < 6; tries++) {
      const r = Math.sqrt(rng()) * 8.5;
      const a = rng() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!clearSpot(x, z)) continue;
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), lam(C.leaf, { flatShading: true }));
      b.position.set(x, 0.2, z);
      b.castShadow = true;
      scene.add(b);
      bushes++;
    }
  }

  // ---------- characters ----------
  const mixers: THREE.AnimationMixer[] = [];
  const walkers: ((dt: number) => void)[] = [];
  const orbiters: { obj: THREE.Object3D; radius: number; height: number; speed: number; phase: number }[] = [];

  const loadManager = new THREE.LoadingManager();
  const loader = new GLTFLoader(loadManager);
  loadManager.onProgress = (_url, done, total) => hooks.onProgress(Math.round((done / total) * 100));
  loadManager.onLoad = () => hooks.onLoad();
  loadManager.onError = () => hooks.onProgress(100);

  /** Normalize by the LARGEST dimension (flat birds explode if scaled by height). */
  function prep(root: THREE.Object3D, target: number) {
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    root.scale.multiplyScalar(target / Math.max(0.0001, size.x, size.y, size.z));
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    return root;
  }

  function makeWalker(obj: THREE.Object3D, points: [number, number][], speed: number, faceOffset = 0) {
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
      obj.rotation.y = Math.atan2(to.x - from.x, to.z - from.z) + faceOffset;
    };
  }

  loader.load('/assets/Soldier.glb', (gltf) => {
    if (disposed) return;
    const clips = gltf.animations;
    const clip = (re: RegExp, fallback: number) => clips.find((c) => re.test(c.name)) ?? clips[fallback]!;
    const walkClip = clip(/walk/i, 3);
    const idleClip = clip(/idle/i, 0);
    // Soldier.glb is authored human-scale; Box3 on its skinned mesh reports
    // bind-space cm, so measured normalization is unreliable — known-good scale.
    const humanize = (root: THREE.Object3D) => {
      root.scale.setScalar(0.92);
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
      });
    };
    const ROUTES: { pts: [number, number][]; speed: number }[] = [
      { pts: [[0.8, 8.5], [0.8, 1.6], [-0.8, 1.6], [-0.8, 8.5]], speed: 1.5 },
      { pts: [[-1.2, 0.4], [-5.4, 0.4], [-5.4, -1.6], [-1.2, -1.6]], speed: 1.2 },
      { pts: [[2.4, 0.8], [5.4, 0.8], [5.4, 3.6], [2.4, 3.6]], speed: 1.35 },
    ];
    for (const route of ROUTES) {
      const v = SkeletonUtils.clone(gltf.scene);
      humanize(v);
      scene.add(v);
      const mixer = new THREE.AnimationMixer(v);
      mixer.clipAction(walkClip).play();
      mixers.push(mixer);
      walkers.push(makeWalker(v, route.pts, route.speed, 0)); // model fronts +Z
    }
    const guard = SkeletonUtils.clone(gltf.scene);
    humanize(guard);
    guard.position.set(2.4, 0, 10.4);
    guard.rotation.y = -Math.PI / 2; // face the road (west)
    scene.add(guard);
    const gm = new THREE.AnimationMixer(guard);
    gm.clipAction(idleClip).play();
    mixers.push(gm);
  });

  loader.load('/assets/Horse.glb', (gltf) => {
    if (disposed) return;
    const horse = gltf.scene;
    prep(horse, 2.1); // largest dim = body length ⇒ ~1.5 tall
    scene.add(horse);
    const mixer = new THREE.AnimationMixer(horse);
    if (gltf.animations[0]) mixer.clipAction(gltf.animations[0]).play();
    mixers.push(mixer);
    walkers.push(makeWalker(horse, [[-7.6, 4.6], [-4.9, 4.7], [-5.4, 6.4], [-7.2, 6.4]], 1.1, 0));
  });

  const BIRDS: [string, number, number, number, number][] = [
    ['Flamingo.glb', 5.6, 6.4, 0.28, 0],
    ['Parrot.glb', 4.0, 5.6, 0.38, 2.2],
    ['Stork.glb', 7.2, 7.4, 0.22, 4.1],
  ];
  for (const [file, radius, height, speed, phase] of BIRDS) {
    loader.load(`/assets/${file}`, (gltf) => {
      if (disposed) return;
      const bird = gltf.scene;
      prep(bird, 1.4); // largest dim = wingspan
      scene.add(bird);
      const mixer = new THREE.AnimationMixer(bird);
      if (gltf.animations[0]) mixer.clipAction(gltf.animations[0]).play();
      mixers.push(mixer);
      orbiters.push({ obj: bird, radius, height, speed, phase });
    });
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
  const setRing = (group: THREE.Group | null, on: boolean) => {
    const ring = group?.userData.ring as THREE.Mesh | undefined;
    if (ring) ring.visible = on;
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const g = pick(e.clientX, e.clientY);
    if (g !== hovered) {
      if (hovered !== selected) setRing(hovered, false);
      hovered = g;
      if (hovered) setRing(hovered, true);
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
    if (selected && selected !== g) setRing(selected, false);
    selected = g;
    if (g) {
      setRing(g, true);
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
  const tick = () => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    controls.update();
    for (const m of mixers) m.update(dt);
    for (const w of walkers) w(dt);
    for (const o of orbiters) {
      const a = t * o.speed + o.phase;
      o.obj.position.set(Math.cos(a) * o.radius, o.height + Math.sin(t * 1.7 + o.phase) * 0.4, Math.sin(a) * o.radius);
      o.obj.rotation.y = -a;
    }
    if (flag) flag.rotation.y = Math.sin(t * 2.4) * 0.35;
    if (rotor) rotor.rotation.z = t * 2.2;
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(tick);

  const handle: VillageHandle = {
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
    },
  };

  // QA hook (headless screenshot tooling drives frame() manually — rAF never
  // fires in a hidden tab).
  (window as unknown as Record<string, unknown>).__village = { ...handle, camera, controls, scene, renderer };

  return handle;
}
