// ONE MORE DAWN — 3D VILLAGE PROTOTYPE (Clash-of-Clans-style diorama).
// Standalone UI only: nothing here talks to the game server. Terrain and
// buildings are procedural voxels; the living things (villagers, horse, birds)
// are the official three.js example models (threejs.org/examples) bundled in
// ./assets. Deterministic layout (seeded RNG) — same village every load.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// ---------- seeded rng (mulberry32 — village never reshuffles) ----------
const makeRng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const rng = makeRng(20260707);

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

// ---------- renderer / scene / camera ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(C.sky);
renderer.setClearColor(C.sky, 1); // belt-and-braces: no black void past the water
scene.fog = new THREE.Fog(C.sky, 45, 130);

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.5, 220);
camera.position.set(15, 17, 19);

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
sun.shadow.camera.left = -20; sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20;
sun.shadow.camera.far = 70;
sun.shadow.bias = -0.0004;
scene.add(sun);

// ---------- materials (shared where safe) ----------
const lam = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });
const MAT = {
  timber: lam(C.timber), timberDark: lam(C.timberDark),
  stone: lam(C.stone), stoneDark: lam(C.stoneDark),
  trunk: lam(C.trunk), rock: lam(C.rock),
  crop: lam(C.cropGreen), cropDark: lam(C.cropDark),
};

// ---------- terrain: two-tone tile checkerboard on a cliff island ----------
const TILES = 24; // 24×24 grid, 1 unit tiles, centered
const HALF = TILES / 2;
{
  const tileGeo = new THREE.BoxGeometry(1, 0.14, 1);
  const grass = new THREE.InstancedMesh(tileGeo, lam(0xffffff), TILES * TILES);
  grass.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  let i = 0;
  const onPath = (x, z) =>
    (Math.abs(x) <= 1 && z >= 0) || // south road to the hall
    (Math.abs(z) <= 0.6 && x >= -6 && x <= 0); // west spur to the farm
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

  // water disc big enough that the horizon always dissolves into fog/sky
  const water = new THREE.Mesh(new THREE.CircleGeometry(300, 48), lam(C.water));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -2.6;
  scene.add(water);
}

// ---------- building kit (chunky voxel pieces) ----------
const interactables = []; // groups with userData {name, level, blurb}

const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};
const pyramid = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const g = new THREE.ConeGeometry(0.5, 1, 4);
  const m = new THREE.Mesh(g, mat);
  m.scale.set(w * 1.42, h, d * 1.42); // cone radius→square footprint
  m.rotation.y = Math.PI / 4;
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};
const cyl = (r, h, mat, x = 0, y = 0, z = 0, seg = 10) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

function register(group, x, z, meta, ringR) {
  group.position.set(x, 0, z);
  group.userData = meta;
  // gold selection ring (hidden until hover/select)
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

// town hall — the centerpiece
{
  const g = new THREE.Group();
  g.add(box(3.6, 0.5, 3.6, MAT.stoneDark, 0, 0.25, 0));
  g.add(box(3.0, 1.7, 3.0, MAT.timber, 0, 1.35, 0));
  g.add(box(3.2, 0.24, 3.2, MAT.timberDark, 0, 2.32, 0));
  g.add(pyramid(3.4, 1.7, 3.4, lam(C.roofGold), 0, 3.3, 0));
  g.add(box(0.9, 1.1, 0.12, MAT.timberDark, 0, 0.95, 1.51)); // door
  g.add(box(0.6, 0.5, 0.1, lam(0xffd97a), -1.0, 1.6, 1.51)); // lit windows
  g.add(box(0.6, 0.5, 0.1, lam(0xffd97a), 1.0, 1.6, 1.51));
  const pole = cyl(0.05, 1.6, MAT.timberDark, 0, 4.9, 0, 6);
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), lam(C.flag, { side: THREE.DoubleSide }));
  flag.position.set(0.48, 5.35, 0);
  g.add(flag);
  g.userData.flag = flag;
  register(g, 0, -1, { name: 'TOWN HALL', level: 4, blurb: 'The heart of the village. Every decision at dawn happens here.' }, 2.6);
}

// huts
const HUTS = [
  [-3.6, 2.6, C.roofRed, 'HUT', 'A survivor family sleeps here.'],
  [3.4, 1.8, C.roofBlue, 'HUT', 'Woodsmoke and quiet talk after dark.'],
  [4.6, -2.6, C.roofGreen, 'HUT', 'They keep a candle in the window.'],
  [-4.4, -2.2, C.roofSlate, 'HUT', 'The door is always open to neighbors.'],
  [2.2, 5.4, C.roofRed, 'HUT', 'Close to the gate — first to hear news.'],
];
for (const [hx, hz, roof, name, blurb] of HUTS) {
  const g = new THREE.Group();
  g.add(box(1.5, 1.0, 1.5, MAT.timber, 0, 0.5, 0));
  g.add(pyramid(1.8, 1.0, 1.8, lam(roof), 0, 1.5, 0));
  g.add(box(0.5, 0.65, 0.1, MAT.timberDark, 0, 0.42, 0.78));
  g.rotation.y = rng() * Math.PI * 2;
  register(g, hx, hz, { name, level: 1 + Math.floor(rng() * 3), blurb }, 1.4);
}

// farm — fenced crop rows (the horse's pasture sits beside it)
{
  const g = new THREE.Group();
  const W = 4.4, D = 3.2;
  g.add(box(W, 0.1, D, MAT.cropDark, 0, 0.06, 0));
  for (let r = 0; r < 4; r++) {
    g.add(box(W - 0.7, 0.22, 0.34, MAT.crop, 0, 0.2, -D / 2 + 0.65 + r * 0.72));
  }
  // fence
  const post = (x, z) => g.add(box(0.12, 0.55, 0.12, MAT.timberDark, x, 0.28, z));
  for (let x = -W / 2; x <= W / 2 + 0.01; x += 1.1) { post(x, -D / 2); post(x, D / 2); }
  for (let z = -D / 2; z <= D / 2 + 0.01; z += 1.06) { post(-W / 2, z); post(W / 2, z); }
  g.add(box(W, 0.07, 0.07, MAT.timber, 0, 0.45, -D / 2));
  g.add(box(W, 0.07, 0.07, MAT.timber, 0, 0.45, D / 2));
  g.add(box(0.07, 0.07, D, MAT.timber, -W / 2, 0.45, 0));
  g.add(box(0.07, 0.07, D, MAT.timber, W / 2, 0.45, 0));
  register(g, -7, 1.4, { name: 'FARM', level: 3, blurb: 'Grow Food happens here. The greenhouse rows feed the city.' }, 2.9);
}

// generator — a windmill; the spinning blades read from any distance
{
  const g = new THREE.Group();
  g.add(box(1.7, 0.4, 1.7, MAT.stoneDark, 0, 0.2, 0)); // base
  const towerMat = lam(0xb7ab9c);
  const t1 = box(1.4, 2.4, 1.4, towerMat, 0, 1.6, 0);
  t1.scale.set(1, 1, 1);
  g.add(t1);
  g.add(pyramid(1.7, 1.0, 1.7, lam(C.roofSlate), 0, 3.3, 0));
  g.add(box(0.5, 0.6, 0.1, MAT.timberDark, 0, 1.0, 0.71)); // door
  g.add(cyl(0.09, 0.7, MAT.timberDark, 0, 2.6, 0.9, 6)); // mast (leans out the front)
  const rotor = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const blade = box(0.34, 1.6, 0.06, lam(0xe7dcc4), 0, 1.0, 0);
    arm.add(blade);
    rotor.add(arm);
  }
  rotor.position.set(0, 2.6, 1.26);
  g.add(rotor);
  g.userData.rotor = rotor;
  register(g, 6.6, -5.2, { name: 'GENERATOR', level: 2, blurb: 'Repair Power keeps these blades — and the night lights — turning.' }, 1.9);
}

// clinic
{
  const g = new THREE.Group();
  g.add(box(2.2, 1.2, 1.8, lam(0xd9d2c5), 0, 0.6, 0));
  g.add(pyramid(2.5, 0.9, 2.1, lam(C.roofRed), 0, 1.65, 0));
  g.add(box(0.55, 0.16, 0.16, lam(C.roofRed), 0, 1.0, 0.92)); // red cross
  g.add(box(0.16, 0.55, 0.16, lam(C.roofRed), 0, 1.0, 0.92));
  register(g, -6.2, -4.6, { name: 'CLINIC', level: 2, blurb: 'Treat Sick — the medics hold the line against the fever.' }, 1.8);
}

// storage silo
{
  const g = new THREE.Group();
  g.add(cyl(0.95, 1.7, MAT.timber, 0, 0.85, 0, 12));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.9, 12), lam(C.roofSlate));
  roof.position.y = 2.15;
  roof.castShadow = true;
  g.add(roof);
  register(g, 6.4, 1.6, { name: 'STOREHOUSE', level: 3, blurb: 'Every loaf the expeditions bank ends up behind these walls.' }, 1.5);
}

// watchtowers on the corners + gate posts
const TOWERS = [[-9, -9], [9, -9], [-9, 9], [9, 9]];
for (const [tx, tz] of TOWERS) {
  const g = new THREE.Group();
  g.add(box(1.1, 2.6, 1.1, MAT.stone, 0, 1.3, 0));
  g.add(box(1.5, 0.35, 1.5, MAT.stoneDark, 0, 2.8, 0));
  g.add(pyramid(1.5, 0.9, 1.5, lam(C.roofSlate), 0, 3.4, 0));
  const lamp = box(0.26, 0.26, 0.26, new THREE.MeshBasicMaterial({ color: 0xffcf70 }), 0, 2.6, 0.62);
  g.add(lamp);
  register(g, tx, tz, { name: 'WATCHTOWER', level: 2, blurb: 'Guard Wall duty. The watch sees the raiders first.' }, 1.3);
}
{ // gate
  const g = new THREE.Group();
  g.add(box(0.8, 1.9, 0.8, MAT.stone, -1.6, 0.95, 0));
  g.add(box(0.8, 1.9, 0.8, MAT.stone, 1.6, 0.95, 0));
  g.add(box(4.0, 0.5, 0.7, MAT.stoneDark, 0, 2.1, 0));
  register(g, 0, 10.6, { name: 'SOUTH GATE', level: 1, blurb: 'The only way in. Refugee convoys knock here at dusk.' }, 2.2);
}

// perimeter walls — low stone runs between the corner towers (decor, no register)
{
  const wallGeo = new THREE.BoxGeometry(1.36, 1.0, 0.45); // shared: 46 segments
  const capGeo = new THREE.BoxGeometry(0.6, 0.2, 0.6);
  const seg = (x, z, rotY, cap) => {
    const m = new THREE.Mesh(wallGeo, MAT.stone);
    m.position.set(x, 0.5, z);
    m.rotation.y = rotY;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    if (cap) { // dark capstone every 4th segment breaks the monotony
      const c = new THREE.Mesh(capGeo, MAT.stoneDark);
      c.position.set(x, 1.1, z);
      c.castShadow = true;
      scene.add(c);
    }
  };
  for (let i = 0; i < 12; i++) {
    const s = -7.7 + i * 1.4; // ±7.7 leaves clearance at the tower bases
    const cap = i % 4 === 0;
    seg(s, -9, 0, cap); // north
    if (Math.abs(s) > 1.8) seg(s, 9, 0, cap); // south — gap where the road meets the gate
    seg(-9, s, Math.PI / 2, cap); // west
    seg(9, s, Math.PI / 2, cap); // east
  }
}

// barracks — guards drill here before the raid
{
  const g = new THREE.Group();
  g.add(box(2.8, 0.25, 2.0, MAT.stoneDark, 0, 0.12, 0));
  g.add(box(2.6, 1.3, 1.8, MAT.timber, 0, 0.85, 0));
  g.add(pyramid(2.9, 1.1, 2.1, lam(C.roofSlate), 0, 2.05, 0));
  g.add(box(0.6, 0.85, 0.1, MAT.timberDark, 0, 0.65, 0.91)); // door
  const pole = cyl(0.04, 1.7, MAT.timberDark, 1.5, 0.85, 1.05, 6);
  g.add(pole);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.62), lam(C.roofRed, { side: THREE.DoubleSide }));
  banner.position.set(1.74, 1.35, 1.05);
  g.add(banner);
  // practice dummies on the east side — keeps the west clear of the horse pasture
  for (const [dx, dz] of [[1.55, -0.5], [1.7, 0.35]]) {
    g.add(cyl(0.09, 0.7, MAT.trunk, dx, 0.35, dz, 6));
    g.add(box(0.28, 0.28, 0.28, MAT.timber, dx, 0.84, dz));
  }
  register(g, -3.2, 7.0, { name: 'BARRACKS', level: 2, blurb: 'Where guards drill for the raid. Prepare for Raid starts here.' }, 2.0);
}

// market stall — open stand with a striped awning
{
  const g = new THREE.Group();
  for (const [px, pz] of [[-0.75, -0.6], [0.75, -0.6], [-0.75, 0.6], [0.75, 0.6]]) {
    g.add(cyl(0.06, 1.25, MAT.timberDark, px, 0.62, pz, 6));
  }
  const awnRed = lam(C.roofRed);
  const awnCream = lam(0xe7dcc4);
  const awn = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    awn.add(box(0.4, 0.05, 1.5, i % 2 ? awnCream : awnRed, -0.6 + i * 0.4, 0, 0));
  }
  awn.position.set(0, 1.3, 0.1);
  awn.rotation.x = 0.14; // slight pitch toward the shopper
  g.add(awn);
  g.add(box(1.6, 0.55, 0.8, MAT.timber, 0, 0.28, 0.25)); // counter
  g.add(box(0.2, 0.2, 0.2, lam(C.roofGold), -0.45, 0.66, 0.2)); // goods
  g.add(box(0.18, 0.18, 0.18, lam(C.roofGreen), 0.1, 0.65, 0.35));
  g.add(box(0.16, 0.16, 0.16, lam(C.roofGold), 0.45, 0.64, 0.15));
  register(g, 2.0, -5.0, { name: 'MARKET', level: 1, blurb: 'Share Rations happens here — the ledger remembers generosity.' }, 1.6);
}

// well
{
  const g = new THREE.Group();
  g.add(cyl(0.55, 0.5, MAT.stone, 0, 0.25, 0, 12));
  g.add(cyl(0.42, 0.06, lam(C.water), 0, 0.48, 0, 12)); // water surface
  g.add(box(0.1, 1.0, 0.1, MAT.timberDark, -0.58, 0.75, 0));
  g.add(box(0.1, 1.0, 0.1, MAT.timberDark, 0.58, 0.75, 0));
  const bar = cyl(0.045, 1.16, MAT.timberDark, 0, 1.18, 0, 6);
  bar.rotation.z = Math.PI / 2;
  g.add(bar);
  g.add(pyramid(1.15, 0.55, 1.15, lam(C.roofSlate), 0, 1.55, 0));
  register(g, 1.9, 2.9, { name: 'WELL', level: 1, blurb: 'Clean water — the quiet reason the city is still alive.' }, 1.2);
}

// torches along the main road (decor, no register)
{
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffcf70 });
  const glowGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  for (const [tx, tz] of [[-1.4, 3.4], [1.4, 3.4], [-1.4, 6.8], [1.4, 6.8]]) {
    scene.add(cyl(0.07, 0.9, MAT.timberDark, tx, 0.45, tz, 6));
    const flame = new THREE.Mesh(glowGeo, glowMat);
    flame.position.set(tx, 0.98, tz);
    scene.add(flame);
  }
}

// flowers + bushes — seeded scatter that dodges buildings, paths, and routes
{
  // [x, z, radius] keep-out circles around every occupied plot
  const SPOTS = [
    [0, -1, 2.8], [-3.6, 2.6, 1.2], [3.4, 1.8, 1.2], [4.6, -2.6, 1.2],
    [-4.4, -2.2, 1.2], [2.2, 5.4, 1.2], [6.6, -5.2, 1.2], [-6.2, -4.6, 1.2],
    [6.4, 1.6, 1.2], [0, 10.6, 1.2], [-3.2, 7.0, 1.2], [2.0, -5.0, 1.2], [1.9, 2.9, 1.2],
  ];
  const inRect = (x, z, x0, x1, z0, z1) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  const clearSpot = (x, z) =>
    !SPOTS.some(([sx, sz, r]) => Math.hypot(x - sx, z - sz) < r) &&
    !inRect(x, z, -9.2, -4.8, -0.2, 3.0) && // farm plot
    !(Math.abs(x) <= 1.6 && z >= 0) && // south road
    !(Math.abs(z) <= 1.2 && x >= -6 && x <= 0) && // west spur
    !inRect(x, z, -1.4, 1.4, 1.0, 9.1) && // soldier route 1 (±0.6)
    !inRect(x, z, -6.0, -0.6, -2.2, 1.0) && // soldier route 2 (±0.6)
    !inRect(x, z, 1.8, 6.0, 0.2, 4.2) && // soldier route 3 (±0.6)
    !inRect(x, z, -8.2, -3.4, 4.2, 7.0); // horse pasture
  const pickSpot = () => {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 8.5; // sqrt: uniform over the disc, not clumped at center
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  const flowerGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  const flowerMats = [0xe86a6a, 0xe8c34a, 0xffffff].map((c) => new THREE.MeshBasicMaterial({ color: c }));
  for (let i = 0, placed = 0; i < 80 && placed < 14; i++) {
    const [x, z] = pickSpot();
    if (!clearSpot(x, z)) continue;
    const f = new THREE.Mesh(flowerGeo, flowerMats[Math.floor(rng() * 3)]);
    f.position.set(x, 0.06, z);
    scene.add(f);
    placed++;
  }
  const bushGeo = new THREE.IcosahedronGeometry(0.28, 0);
  const bushMat = lam(C.leaf, { flatShading: true });
  for (let i = 0, placed = 0; i < 60 && placed < 6; i++) {
    const [x, z] = pickSpot();
    if (!clearSpot(x, z)) continue;
    const b = new THREE.Mesh(bushGeo, bushMat);
    b.position.set(x, 0.2, z);
    b.rotation.y = rng() * Math.PI;
    b.castShadow = true;
    scene.add(b);
    placed++;
  }
}

// ---------- decorations (seeded scatter on the border) ----------
{
  const tree = (x, z, pine) => {
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
  // ring of trees just inside the cliff edge, skipping paths/buildings
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + rng() * 0.2;
    const r = 10.2 + rng() * 1.1;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.abs(x) < 2.4 && z > 8) continue; // keep the gate clear
    if (Math.max(Math.abs(x), Math.abs(z)) > HALF - 0.8) continue;
    if (TOWERS.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 2.1)) continue;
    tree(x, z, rng() > 0.45);
  }
  for (let i = 0; i < 8; i++) { // rocks
    const x = (rng() * 2 - 1) * 9.5;
    const z = (rng() * 2 - 1) * 9.5;
    if (Math.hypot(x, z) < 5.5 || (Math.abs(x) < 2 && z > 0)) continue;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rng() * 0.3, 0), lam(C.rock, { flatShading: true }));
    rock.position.set(x, 0.2, z);
    rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    rock.castShadow = true;
    scene.add(rock);
  }
}

// ---------- characters from the three.js example models ----------
const mixers = [];
const loadManager = new THREE.LoadingManager();
const loader = new GLTFLoader(loadManager);
const loaderBar = document.getElementById('loader-bar');
const loaderSt = document.getElementById('loader-st');
loadManager.onProgress = (_url, done, total) => {
  loaderBar.style.width = `${Math.round((done / total) * 100)}%`;
};
loadManager.onLoad = () => {
  document.getElementById('loader').classList.add('done');
};
loadManager.onError = (url) => {
  loaderSt.textContent = `couldn't load ${url.split('/').pop()} — continuing`;
};

/** Normalize a model so its LARGEST dimension equals `target`, enable shadows.
 *  (Largest, not height: a soaring bird is flat — normalizing flat models by
 *  their tiny y-extent explodes the wingspan to fill the screen.) */
function prep(root, target) {
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const s = target / Math.max(0.0001, size.x, size.y, size.z);
  // MULTIPLY, never set: Mixamo-style exports bake a cm→m scale (0.01) on the
  // root node; setScalar would clobber it and blow the model up ~100×.
  root.scale.multiplyScalar(s);
  root.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
  });
  return root;
}

/** Walk a loop of waypoints at `speed`, facing travel direction. */
function makeWalker(obj, points, speed, faceOffset = 0) {
  let seg = 0;
  let t = 0;
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  return (dt) => {
    const a = points[seg % points.length];
    const b = points[(seg + 1) % points.length];
    from.set(a[0], 0, a[1]);
    to.set(b[0], 0, b[1]);
    const dist = from.distanceTo(to);
    t += (dt * speed) / Math.max(0.001, dist);
    if (t >= 1) { t = 0; seg = (seg + 1) % points.length; return; }
    obj.position.lerpVectors(from, to, t);
    obj.rotation.y = Math.atan2(to.x - from.x, to.z - from.z) + faceOffset;
  };
}
const walkers = [];

// villagers — Soldier.glb (Idle / Walk clips), cloned per villager
loader.load('/village3d/assets/Soldier.glb', (gltf) => {
  const clips = gltf.animations;
  const clip = (re, fallback) => clips.find((c) => re.test(c.name)) ?? clips[fallback];
  const walkClip = clip(/walk/i, 3);
  const idleClip = clip(/idle/i, 0);

  const ROUTES = [
    { pts: [[0.8, 8.5], [0.8, 1.6], [-0.8, 1.6], [-0.8, 8.5]], speed: 1.5 },
    { pts: [[-1.2, 0.4], [-5.4, 0.4], [-5.4, -1.6], [-1.2, -1.6]], speed: 1.2 },
    { pts: [[2.4, 0.8], [5.4, 0.8], [5.4, 3.6], [2.4, 3.6]], speed: 1.35 },
  ];
  // Soldier.glb is authored human-scale (≈1.8 at scale 1); Box3 on its skinned
  // mesh reports bind-space cm units, so measured normalization (prep) is
  // unreliable here — use the known-good scale directly.
  const humanize = (root) => {
    root.scale.setScalar(0.92);
    root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
  };
  for (const route of ROUTES) {
    const v = SkeletonUtils.clone(gltf.scene);
    humanize(v);
    scene.add(v);
    const mixer = new THREE.AnimationMixer(v);
    mixer.clipAction(walkClip).play();
    mixers.push(mixer);
    // faceOffset 0: the Soldier model fronts +Z, matching the walker's heading
    // convention (QA measured the previous +π offset as exact moonwalking).
    walkers.push(makeWalker(v, route.pts, route.speed, 0));
  }
  // one guard idling at the gate
  const guard = SkeletonUtils.clone(gltf.scene);
  humanize(guard);
  guard.position.set(2.4, 0, 10.4);
  guard.rotation.y = -Math.PI / 2; // +Z front turned to face the road (west)
  scene.add(guard);
  const gm = new THREE.AnimationMixer(guard);
  gm.clipAction(idleClip).play();
  mixers.push(gm);
});

// the horse — grazing loop by the farm
loader.load('/village3d/assets/Horse.glb', (gltf) => {
  const horse = gltf.scene;
  prep(horse, 2.1); // largest dim = body length ⇒ ~1.5 tall
  scene.add(horse);
  const mixer = new THREE.AnimationMixer(horse);
  if (gltf.animations[0]) mixer.clipAction(gltf.animations[0]).play();
  mixers.push(mixer);
  // pasture loop stays west of the barracks footprint (x ≥ -4.5 is its wall);
  // faceOffset 0 assumes the ro.me horse also fronts +Z — verified visually.
  walkers.push(
    makeWalker(horse, [[-7.6, 4.6], [-4.9, 4.7], [-5.4, 6.4], [-7.2, 6.4]], 1.1, 0),
  );
});

// birds circling overhead
// tight orbits over the rooftops — never between the camera and the village
const BIRDS = [
  ['Flamingo.glb', 5.6, 6.4, 0.28, 0],
  ['Parrot.glb', 4.0, 5.6, 0.38, 2.2],
  ['Stork.glb', 7.2, 7.4, 0.22, 4.1],
];
for (const [file, radius, height, speed, phase] of BIRDS) {
  loader.load(`/village3d/assets/${file}`, (gltf) => {
    const bird = gltf.scene;
    prep(bird, 1.4); // largest dim = wingspan
    scene.add(bird);
    const mixer = new THREE.AnimationMixer(bird);
    if (gltf.animations[0]) mixer.clipAction(gltf.animations[0]).play();
    mixers.push(mixer);
    bird.userData.orbit = { radius, height, speed, phase };
  });
}

// ---------- hover / select ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const chip = document.getElementById('chip');
const chipNm = document.getElementById('chip-nm');
const chipLv = document.getElementById('chip-lv');
const chipBl = document.getElementById('chip-bl');
let hovered = null;
let selected = null;

function rootOf(obj) {
  let cur = obj;
  while (cur && !cur.userData?.name) cur = cur.parent;
  return cur ?? null;
}
function pick(clientX, clientY) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(interactables, true)[0];
  return hit ? rootOf(hit.object) : null;
}
function setRing(group, on) {
  if (group?.userData.ring) group.userData.ring.visible = on;
}
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const g = pick(e.clientX, e.clientY);
  if (g !== hovered) {
    if (hovered !== selected) setRing(hovered, false);
    hovered = g;
    if (hovered) setRing(hovered, true);
    renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab';
  }
});
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 8) return; // drag, not a tap
  const g = pick(e.clientX, e.clientY);
  if (selected && selected !== g) setRing(selected, false);
  selected = g;
  if (g) {
    setRing(g, true);
    chipNm.textContent = g.userData.name;
    chipLv.textContent = `LEVEL ${g.userData.level}`;
    chipBl.textContent = g.userData.blurb;
    chip.classList.add('on');
  } else {
    chip.classList.remove('on');
  }
});

// ---------- resize + main loop ----------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
const flagged = interactables.find((g) => g.userData.flag);
const genGroup = interactables.find((g) => g.userData.rotor);

const tick = () => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  controls.update();
  for (const m of mixers) m.update(dt);
  for (const w of walkers) w(dt);
  scene.traverse((o) => {
    const orbit = o.userData?.orbit;
    if (orbit) {
      const a = t * orbit.speed + orbit.phase;
      o.position.set(Math.cos(a) * orbit.radius, orbit.height + Math.sin(t * 1.7 + orbit.phase) * 0.4, Math.sin(a) * orbit.radius);
      o.rotation.y = -a; // tangent to the circle
    }
  });
  if (flagged) flagged.userData.flag.rotation.y = Math.sin(t * 2.4) * 0.35;
  if (genGroup) genGroup.userData.rotor.rotation.z = t * 2.2;
  renderer.render(scene, camera);
};
renderer.setAnimationLoop(tick);

// Debug handle (used by headless QA to pause the loop for stable screenshots).
window.__village = {
  pause: () => renderer.setAnimationLoop(null),
  resume: () => renderer.setAnimationLoop(tick),
  frame: () => tick(),
  camera,
  controls,
  scene,
  renderer,
};
