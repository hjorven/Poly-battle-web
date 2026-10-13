import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HEX_SIZE, TERRAIN, COLORS, MAP_W, MAP_H } from './config.js';
import { playerColor, isVisible, visibleKeys, cityView } from './rules.js';
import { toWorld, forEachHex, hk, DIRS } from './hex.js';

let colorMap = {};
function ownerColor(owner) {
  return colorMap[owner] ?? COLORS[owner] ?? 0xffffff;
}

const TILE_GAP = 0.94;
const DIESE_DUR = 260;

let renderer, scene, camera, controls, raycaster;
let tileMeshes = [];
const tiles = new Map();
const unitNodes = new Map();
const cityNodes = new Map();
let highlightGroup;
let idleGroup;
let selectedMesh = null;
let selectedKey = null;
let tweens = [];
let effects = [];
let onPick = null;
let pointerDownAt = null;
let initialized = false;

const geoCache = new Map();
function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

// Unveränderliche Materialien werden geteilt (sonst entsteht pro Einheit,
// Stadt und Kachel ein neues Material, das nie freigegeben wird).
// Teamfarben werden pro Einheit verändert und nutzen deshalb freshMat().
const matCache = new Map();
function mat(color) {
  if (!matCache.has(color)) matCache.set(color, freshMat(color));
  return matCache.get(color);
}

function freshMat(color) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

const darkMats = new Map();
function darkMatFor(t) {
  if (!darkMats.has(t)) {
    darkMats.set(t, new THREE.MeshLambertMaterial({
      color: new THREE.Color(TERRAIN[t].color).multiplyScalar(0.45),
      flatShading: true
    }));
  }
  return darkMats.get(t);
}

export function initRender(canvas, opts = {}) {
  onPick = opts.onPick || null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (e) {
    return false;
  }
  initialized = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fc9ea);
  scene.fog = new THREE.Fog(0x8fc9ea, 60, 150);

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
  raycaster = new THREE.Raycaster();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x6e8f5c, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dd, 1.2);
  sun.position.set(28, 40, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -44;
  sun.shadow.camera.right = 44;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ color: 0x2f86c8 })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -0.3;
  scene.add(ocean);

  highlightGroup = new THREE.Group();
  scene.add(highlightGroup);
  idleGroup = new THREE.Group();
  scene.add(idleGroup);

  const bounds = mapBounds();
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  camera.position.set(cx - 2, 26, cz + 19);
  camera.lookAt(cx, 0, cz);

  controls = new OrbitControls(camera, canvas);
  controls.target.set(cx, 0, cz);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 7;
  controls.maxDistance = 90;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = 1.25;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE
  };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.screenSpacePanning = false;

  canvas.addEventListener('pointerdown', e => {
    pointerDownAt = [e.clientX, e.clientY];
  });
  canvas.addEventListener('pointerup', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!pointerDownAt) return;
    const [px, py] = pointerDownAt;
    pointerDownAt = null;
    if (Math.hypot(e.clientX - px, e.clientY - py) > 7) return;
    const key = pick(e.clientX, e.clientY);
    if (onPick && key) onPick(key);
  });

  resize();
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resize).observe(canvas.parentElement);
  }

  let last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    stepTweens(now);
    stepEffects(now);
    if (selectedMesh) {
      const s = 1 + Math.sin(now / 220) * 0.06;
      selectedMesh.scale.set(s, 1, s);
    }
    stepFog(now, dt);
    stepIdleMarkers(now);
    controls.update();
    clampTarget();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(loop);
  return true;
}

function mapBounds() {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  forEachHex((q, r) => {
    const p = toWorld(q, r);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  });
  return { minX, maxX, minZ, maxZ };
}

function clampTarget() {
  const b = mapBounds();
  controls.target.x = THREE.MathUtils.clamp(controls.target.x, b.minX - 5, b.maxX + 5);
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, b.minZ - 5, b.maxZ + 5);
}

function resize() {
  if (!renderer) return;
  const el = canvasEl();
  const w = el.clientWidth || window.innerWidth;
  const h = el.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function canvasEl() {
  return renderer.domElement;
}

function pick(clientX, clientY) {
  const rect = canvasEl().getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(tileMeshes, false);
  if (!hits.length) return null;
  const h = hits[0].object.userData.hex;
  const key = hk(h.q, h.r);
  // Auch Felder im Nebel sind antippbar: Einheiten dürfen dorthin ziehen,
  // wenn das Feld als Ziel markiert ist. Was dort steht, entscheidet main.js
  // (versteckte Gegner bleiben unsichtbar und nicht anwählbar).
  if (!tiles.get(key)) return null;
  return key;
}

function resourceNode(type) {
  const g = new THREE.Group();
  const rnd = mulberry(7);
  if (type === 'fruit') {
    const trunk = new THREE.Mesh(geo('frTrunk', () => new THREE.CylinderGeometry(0.025, 0.035, 0.22, 5)), mat(0x6b4a2b));
    trunk.position.y = 0.11;
    g.add(trunk);
    const crownGeo = () => new THREE.IcosahedronGeometry(0.16, 0);
    const crown = new THREE.Mesh(geo('frCrown', crownGeo), mat(0x3e9140));
    crown.position.y = 0.26;
    g.add(crown);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rnd() * 0.6;
      const apple = new THREE.Mesh(geo('frApple', () => new THREE.SphereGeometry(0.045, 6, 5)), mat(i % 2 ? 0xe0503a : 0xd2373c));
      apple.position.set(Math.cos(a) * 0.1, 0.26 + rnd() * 0.05, Math.sin(a) * 0.1);
      g.add(apple);
    }
  } else if (type === 'animals') {
    for (let i = 0; i < 2; i++) {
      const body = new THREE.Mesh(geo('anBody', () => new THREE.BoxGeometry(0.14, 0.1, 0.07)), mat(0x8a5a33));
      body.position.set(-0.06 + i * 0.14, 0.06 + rnd() * 0.02, (rnd() - 0.5) * 0.14);
      body.rotation.y = rnd() * Math.PI * 2;
      g.add(body);
      const head = new THREE.Mesh(geo('anHead', () => new THREE.IcosahedronGeometry(0.04, 0)), mat(0x9c6b3a));
      head.position.set(body.position.x + 0.09, body.position.y + 0.04, body.position.z + 0.02);
      g.add(head);
    }
  } else if (type === 'fish') {
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      const fish = new THREE.Mesh(geo('fiBody', () => new THREE.ConeGeometry(0.05, 0.17, 5)), mat(i === 1 ? 0xcfe9f5 : 0x9ccfe8));
      fish.rotation.z = Math.PI / 2;
      fish.rotation.y = a;
      fish.position.set(Math.cos(a) * 0.12, 0.05, Math.sin(a) * 0.12);
      fish.rotation.x = 0.4;
      g.add(fish);
    }
  } else if (type === 'minerals') {
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(geo('miCryst', () => new THREE.OctahedronGeometry(0.06 + rnd() * 0.04, 0)), mat(i % 2 ? 0xb7bdd1 : 0x8992ab));
      c.position.set((rnd() - 0.5) * 0.3, 0.05 + rnd() * 0.05, (rnd() - 0.5) * 0.3);
      c.scale.y = 1.6;
      c.castShadow = true;
      g.add(c);
    }
  }
  for (const m of g.children) m.castShadow = true;
  return g;
}

function ruinNode() {
  const g = new THREE.Group();
  const stone = mat(0xa8a29e);
  const dark = mat(0x78716c);
  const slab = new THREE.Mesh(geo('ruSlab', () => new THREE.BoxGeometry(0.42, 0.05, 0.32)), dark);
  slab.position.y = 0.025;
  g.add(slab);
  const heights = [0.34, 0.22, 0.12];
  [[-0.14, -0.08], [0.12, -0.1], [0.02, 0.1]].forEach(([x, z], i) => {
    const pil = new THREE.Mesh(geo('ruPillar' + i, () => new THREE.CylinderGeometry(0.045, 0.05, heights[i], 6)), stone);
    pil.position.set(x, 0.05 + heights[i] / 2, z);
    g.add(pil);
  });
  const lintel = new THREE.Mesh(geo('ruLintel', () => new THREE.BoxGeometry(0.34, 0.05, 0.08)), stone);
  lintel.position.set(-0.01, 0.41, -0.09);
  lintel.rotation.z = 0.12;
  g.add(lintel);
  for (const m of g.children) { m.castShadow = true; }
  return g;
}

function syncRuin(t, present) {
  if (!t || !!t.ruinNode === !!present) return;
  if (t.ruinNode) {
    t.mesh.remove(t.ruinNode);
    t.decor = t.decor.filter(d => d !== t.ruinNode);
    t.ruinNode = null;
    return;
  }
  const n = ruinNode();
  n.position.y = TERRAIN[t.terrain].height / 2 + 0.01;
  n.visible = t.seen;
  t.mesh.add(n);
  t.decor.push(n);
  t.ruinNode = n;
}

// --- Brücken ----------------------------------------------------------------

function bridgeNode(axis) {
  const g = new THREE.Group();
  const wood = mat(0x8a5a33), dark = mat(0x5c3d22);
  const deck = new THREE.Mesh(geo('brDeck', () => new THREE.BoxGeometry(1.78, 0.07, 0.44)), wood);
  deck.castShadow = true;
  deck.receiveShadow = true;
  g.add(deck);
  for (const z of [-0.2, 0.2]) {
    const rail = new THREE.Mesh(geo('brRail', () => new THREE.BoxGeometry(1.7, 0.04, 0.04)), dark);
    rail.position.set(0, 0.13, z);
    g.add(rail);
    for (const x of [-0.75, -0.25, 0.25, 0.75]) {
      const post = new THREE.Mesh(geo('brPost', () => new THREE.BoxGeometry(0.04, 0.13, 0.04)), dark);
      post.position.set(x, 0.07, z);
      g.add(post);
    }
  }
  for (const x of [-0.42, 0.42]) {
    const pier = new THREE.Mesh(geo('brPier', () => new THREE.CylinderGeometry(0.05, 0.06, 0.4, 6)), dark);
    pier.position.set(x, -0.2, 0);
    g.add(pier);
  }
  // Brücke entlang der Achse zwischen den beiden Ufern ausrichten.
  const [dq, dr] = DIRS[axis];
  const w = toWorld(dq, dr);
  g.rotation.y = -Math.atan2(w.z, w.x);
  return g;
}

function syncBridge(t, axis) {
  const want = axis == null ? null : axis;
  if (!t || (t.bridgeAxis ?? null) === want) return;
  if (t.bridgeNode) {
    t.mesh.remove(t.bridgeNode);
    t.decor = t.decor.filter(d => d !== t.bridgeNode);
    t.bridgeNode = null;
  }
  t.bridgeAxis = want;
  if (want == null) return;
  const n = bridgeNode(want);
  // Fahrbahn knapp über Ufer-Höhe (Land 0.5), relativ zur Kachelmitte.
  n.position.y = 0.53 - TERRAIN[t.terrain].height / 2;
  n.visible = t.seen;
  t.mesh.add(n);
  t.decor.push(n);
  t.bridgeNode = n;
}

// --- Nebel ------------------------------------------------------------------
// Unentdecktes Land liegt unter dichten, langsam treibenden Nebelschwaden;
// entdecktes, aber gerade unbeobachtetes Land unter leichtem Dunst.

let fogDense = null, fogHaze = null, fogTiles = [];
const fogDummy = new THREE.Object3D();
const FOG_LAYERS = 2;

function fogTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const blob = (x, y, r, a) => {
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${a})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 128, 128);
  };
  blob(64, 64, 62, 0.85);
  blob(44, 52, 36, 0.5);
  blob(84, 70, 34, 0.5);
  blob(60, 86, 28, 0.4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildFog() {
  for (const m of [fogDense, fogHaze]) {
    if (!m) continue;
    scene.remove(m);
    m.dispose();
  }
  const tex = geo('fogTex', fogTexture);
  const plane = geo('fogPlane', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const n = tiles.size;
  fogDense = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({
    map: tex, color: 0xeef2f5, transparent: true, opacity: 0.95, depthWrite: false, fog: false
  }), n * FOG_LAYERS);
  fogHaze = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({
    map: tex, color: 0xd5dee6, transparent: true, opacity: 0.42, depthWrite: false, fog: false
  }), n);
  fogDense.renderOrder = 12;
  fogHaze.renderOrder = 11;
  for (const m of [fogDense, fogHaze]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
  }
  fogTiles = [];
  let i = 0;
  for (const [key, t] of tiles) {
    const [q, r] = key.split(',').map(Number);
    const p = toWorld(q, r);
    const h = (q * 928371 + r * 123457) % 1000 / 1000;
    fogTiles.push({ t, x: p.x, z: p.z, dense: 1, haze: 0, phase: h * Math.PI * 2, rot: h * 6.28, i: i++ });
  }
}

function stepFog(now, dt) {
  if (!fogDense) return;
  const k = Math.min(1, dt * 3.5);
  const time = now / 1000;
  for (const f of fogTiles) {
    const wantDense = f.t.seen ? 0 : 1;
    const wantHaze = f.t.seen && !f.t.lit ? 1 : 0;
    f.dense += (wantDense - f.dense) * k;
    f.haze += (wantHaze - f.haze) * k;
    for (let l = 0; l < FOG_LAYERS; l++) {
      const ph = f.phase + l * 2.1;
      const sc = f.dense < 0.01 ? 0 : (2.5 + l * 0.5 + Math.sin(time * 0.3 + ph) * 0.15) * f.dense;
      fogDummy.position.set(
        f.x + Math.sin(time * 0.17 + ph) * 0.25,
        1.25 + l * 0.35 + Math.sin(time * 0.4 + ph) * 0.05,
        f.z + Math.cos(time * 0.13 + ph) * 0.25
      );
      fogDummy.rotation.set(0, f.rot + l + time * 0.03, 0);
      fogDummy.scale.set(sc || 1e-4, 1, sc || 1e-4);
      fogDummy.updateMatrix();
      fogDense.setMatrixAt(f.i * FOG_LAYERS + l, fogDummy.matrix);
    }
    const hs = f.haze < 0.01 ? 1e-4 : 2.3 * f.haze;
    fogDummy.position.set(f.x + Math.sin(time * 0.2 + f.phase) * 0.15, 1.02, f.z);
    fogDummy.rotation.set(0, f.rot, 0);
    fogDummy.scale.set(hs, 1, hs);
    fogDummy.updateMatrix();
    fogHaze.setMatrixAt(f.i, fogDummy.matrix);
  }
  fogDense.instanceMatrix.needsUpdate = true;
  fogHaze.instanceMatrix.needsUpdate = true;
}

// --- Markierungen für Einheiten, die noch handeln können --------------------

let idleMarkers = [];
export function setIdleMarkers(units) {
  if (!initialized) return;
  while (idleGroup.children.length) idleGroup.remove(idleGroup.children[0]);
  idleMarkers = [];
  const markGeo = geo('idleMark', () => new THREE.OctahedronGeometry(0.11, 0));
  const markMat = geo('idleMat', () => new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
  for (const u of units) {
    const m = new THREE.Mesh(markGeo, markMat);
    const p = toWorld(u.q, u.r);
    m.position.set(p.x, hexTop(hk(u.q, u.r)) + 1.3, p.z);
    m.scale.set(1, 1.6, 1);
    m.userData.base = m.position.y;
    m.userData.phase = (u.q * 7 + u.r * 3) % 10;
    idleGroup.add(m);
    idleMarkers.push(m);
  }
}

function stepIdleMarkers(now) {
  for (const m of idleMarkers) {
    m.position.y = m.userData.base + Math.sin(now / 260 + m.userData.phase) * 0.06;
    m.rotation.y = now / 600;
  }
}

function improvementNode(type) {
  const g = new THREE.Group();
  if (type === 'farm') {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        const bed = new THREE.Mesh(geo('fmBed', () => new THREE.BoxGeometry(0.065, 0.02, 0.14)), mat(0x7a5230));
        bed.position.set(-0.15 + i * 0.1, 0.01, -0.07 + j * 0.14);
        g.add(bed);
        const crop = new THREE.Mesh(geo('fmCrop', () => new THREE.ConeGeometry(0.022, 0.05, 4)), mat((i + j) % 2 ? 0x54a63a : 0x6fbf3f));
        crop.position.set(bed.position.x, 0.045, bed.position.z);
        g.add(crop);
      }
    }
  } else if (type === 'sawmill') {
    const base = new THREE.Mesh(geo('swBase', () => new THREE.BoxGeometry(0.3, 0.1, 0.22)), mat(0x6b4a2b));
    base.position.y = 0.05;
    g.add(base);
    const roof = new THREE.Mesh(geo('swRoof', () => new THREE.BoxGeometry(0.34, 0.05, 0.26)), mat(0x8a5a33));
    roof.position.y = 0.15;
    g.add(roof);
    const saw = new THREE.Mesh(geo('swBlade', () => new THREE.CylinderGeometry(0.08, 0.08, 0.02, 10)), mat(0xd9dee5));
    saw.rotation.z = Math.PI / 2;
    saw.position.set(0.2, 0.12, 0);
    g.add(saw);
  } else if (type === 'mine') {
    const stone = mat(0x6b7280);
    const gA = new THREE.Mesh(geo('mPillarL', () => new THREE.BoxGeometry(0.07, 0.2, 0.07)), stone);
    gA.position.set(-0.12, 0.1, 0);
    g.add(gA);
    const gB = new THREE.Mesh(geo('mPillarR', () => new THREE.BoxGeometry(0.07, 0.2, 0.07)), stone);
    gB.position.set(0.12, 0.1, 0);
    g.add(gB);
    const top = new THREE.Mesh(geo('mTop', () => new THREE.BoxGeometry(0.36, 0.05, 0.12)), stone);
    top.position.y = 0.215;
    g.add(top);
    const ore = new THREE.Mesh(geo('mOre', () => new THREE.OctahedronGeometry(0.06, 0)), mat(0xd9a13b));
    ore.position.set(0.12, 0.28, 0);
    g.add(ore);
    const dark = new THREE.Mesh(geo('mHole', () => new THREE.CylinderGeometry(0.09, 0.11, 0.05, 6)), mat(0x27272a));
    dark.position.set(0, 0.03, 0);
    g.add(dark);
  } else if (type === 'port') {
    const planks = new THREE.Mesh(geo('ptPlanks', () => new THREE.BoxGeometry(0.46, 0.07, 0.16)), mat(0x8a5a33));
    planks.position.y = 0.035;
    g.add(planks);
    const shed = new THREE.Mesh(geo('ptShed', () => new THREE.BoxGeometry(0.16, 0.14, 0.12)), mat(0x6b4a2b));
    shed.position.set(-0.14, 0.11, 0);
    g.add(shed);
    const roof = new THREE.Mesh(geo('ptRoof', () => new THREE.ConeGeometry(0.14, 0.08, 4)), mat(0x9c6b3a));
    roof.rotation.y = Math.PI / 4;
    roof.position.set(-0.14, 0.21, 0);
    g.add(roof);
  } else if (type === 'temple') {
    const base = new THREE.Mesh(geo('tpBase', () => new THREE.BoxGeometry(0.2, 0.16, 0.2)), mat(0xf1ece1));
    base.position.y = 0.08;
    g.add(base);
    const colGeo = () => new THREE.CylinderGeometry(0.012, 0.012, 0.14, 5);
    for (const [cx, cz] of [[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09]]) {
      const col = new THREE.Mesh(geo('tpCol', colGeo), mat(0xe6ddc8));
      col.position.set(cx, 0.08, cz);
      g.add(col);
    }
    const dome = new THREE.Mesh(geo('tpDome', () => new THREE.SphereGeometry(0.09, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2)), mat(0xe0b84d));
    dome.position.y = 0.24;
    g.add(dome);
    const tip = new THREE.Mesh(geo('tpTip', () => new THREE.ConeGeometry(0.02, 0.07, 5)), mat(0xc8a64a));
    tip.position.y = 0.32;
    g.add(tip);
  }
  for (const m of g.children) m.castShadow = true;
  return g;
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function buildTiles(state) {
  const tileGeoCache = new Map();
  const trunkGeo = geo('tree_trunk', () => new THREE.CylinderGeometry(0.04, 0.05, 0.22, 5));
  const foliageGeo = geo('tree_foliage', () => new THREE.ConeGeometry(0.2, 0.46, 5));
  const trunkMat = mat(0x5c4033);
  const foliageMat = mat(0x2e7d32);
  const foliageMat2 = mat(0x256b28);
  const peakGeo = geo('mountain_peak', () => new THREE.ConeGeometry(0.52, 0.82, 6));
  const snowGeo = geo('mountain_snow', () => new THREE.ConeGeometry(0.26, 0.32, 6));
  const peakMat = mat(0x6b7280);
  const snowMat = mat(0xf9fafb);

  for (let r = 0; r < MAP_H; r++) {
    for (let q = 0; q < MAP_W; q++) {
      const t = state.terrain[r * MAP_W + q];
      const def = TERRAIN[t];
      if (!tileGeoCache.has(t)) {
        tileGeoCache.set(t, new THREE.CylinderGeometry(
          HEX_SIZE * TILE_GAP, HEX_SIZE * TILE_GAP, def.height, 6
        ));
      }
      const baseMat = mat(def.color);
      const mesh = new THREE.Mesh(tileGeoCache.get(t), baseMat);
      const p = toWorld(q, r);
      mesh.position.set(p.x, def.height / 2, p.z);
      mesh.receiveShadow = true;
      mesh.castShadow = t === 'mountain';
      mesh.userData.hex = { q, r };
      scene.add(mesh);
      tileMeshes.push(mesh);
      const decor = [];
      tiles.set(hk(q, r), { mesh, baseMat, top: def.height, terrain: t, decor, seen: true, lit: true, imp: null, impNode: null, ruinNode: null, bridgeAxis: null, bridgeNode: null });

      if (t === 'forest') {
        let s = (q * 73856093) ^ (r * 19349663);
        const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
        const spots = [
          [-0.22, -0.12], [0.03, -0.2], [0.24, -0.02], [0.12, 0.22], [-0.2, 0.14]
        ];
        const n = 3 + ((q * 7 + r * 13) % 3);
        for (let i = 0; i < n; i++) {
          const sp = spots[i % spots.length];
          const jx = (rnd() - 0.5) * 0.08;
          const jz = (rnd() - 0.5) * 0.08;
          const sc = 0.85 + rnd() * 0.4;
          const trunk = new THREE.Mesh(trunkGeo, trunkMat);
          trunk.position.set(sp[0] + jx, def.height / 2 + 0.11, sp[1] + jz);
          trunk.scale.set(1, sc, 1);
          trunk.castShadow = true;
          mesh.add(trunk);
          decor.push(trunk);
          const foliage = new THREE.Mesh(foliageGeo, rnd() < 0.5 ? foliageMat : foliageMat2);
          foliage.position.set(sp[0] + jx, def.height / 2 + 0.45 * sc, sp[1] + jz);
          foliage.scale.set(sc, sc, sc);
          foliage.castShadow = true;
          mesh.add(foliage);
          decor.push(foliage);
        }
      } else if (t === 'mountain') {
        const peak = new THREE.Mesh(peakGeo, peakMat);
        peak.position.y = def.height / 2 + 0.41;
        peak.rotation.y = 0.4;
        peak.castShadow = true;
        mesh.add(peak);
        decor.push(peak);
        const snow = new THREE.Mesh(snowGeo, snowMat);
        snow.position.y = def.height / 2 + 0.68;
        snow.castShadow = true;
        mesh.add(snow);
        decor.push(snow);
      }
      const res = state.resources ? state.resources[hk(q, r)] : null;
      if (res) {
        const rn = resourceNode(res);
        rn.position.y = def.height / 2 + 0.02;
        mesh.add(rn);
        decor.push(rn);
      }
      syncImprovement(tiles.get(hk(q, r)), state.improvements ? state.improvements[hk(q, r)] : null);
    }
  }
}

// Gebäude auf einer Kachel an den Spielstand anpassen (auch für Gebäude,
// die erst während der Partie gebaut werden).
function syncImprovement(t, imp) {
  if (!t || (t.imp || null) === (imp || null)) return;
  if (t.impNode) {
    t.mesh.remove(t.impNode);
    t.decor = t.decor.filter(d => d !== t.impNode);
    t.impNode = null;
  }
  t.imp = imp || null;
  if (!imp) return;
  const inode = improvementNode(imp);
  inode.position.y = TERRAIN[t.terrain].height / 2 + 0.02;
  inode.visible = t.seen;
  t.mesh.add(inode);
  t.decor.push(inode);
  t.impNode = inode;
}

// Alles vom vorherigen Spiel entfernen, damit eine neue Karte (neues Spiel,
// geladener Spielstand, Online-Partie) korrekt aufgebaut wird.
function clearBoard() {
  for (const t of tiles.values()) {
    scene.remove(t.mesh);
  }
  tiles.clear();
  tileMeshes = [];
  for (const node of unitNodes.values()) {
    scene.remove(node.group);
    node.sprite.userData.texture?.dispose();
    node.sprite.material.dispose();
    for (const m of node.group.userData.teamMats) m.dispose();
  }
  unitNodes.clear();
  for (const node of cityNodes.values()) scene.remove(node.group);
  cityNodes.clear();
  // Laufende Animationen beenden, damit wartende Promises nicht hängen.
  const pending = tweens;
  tweens = [];
  for (const tw of pending) {
    try { tw.resolve?.(); } catch (e) { /* Knoten bereits entfernt */ }
  }
}

let boardSignature = null;
function terrainSignature(state) {
  return state.terrain.join('|');
}

function hexTop(key) {
  const t = tiles.get(key);
  return t ? t.top : 0.5;
}

function exploredSet(state, viewer) {
  if (!viewer || !state.explored || !state.explored[viewer]) return null;
  return new Set(state.explored[viewer]);
}

function makeHpSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false
  }));
  sprite.scale.set(0.6, 0.3, 1);
  sprite.renderOrder = 20;
  sprite.userData = { canvas, texture };
  return sprite;
}

function drawHp(sprite, hp) {
  const { canvas, texture } = sprite.userData;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 64);
  ctx.fillStyle = 'rgba(10,12,16,0.72)';
  roundRect(ctx, 24, 8, 80, 48, 14);
  ctx.fill();
  ctx.fillStyle = hp <= 3 ? '#ff7b7b' : '#ffffff';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(hp), 64, 33);
  texture.needsUpdate = true;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function unitBody(type, color) {
  const g = new THREE.Group();
  const team = color;
  const teamMats = [];
  const add = (mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  const teamMat = () => {
    const m = freshMat(team);
    teamMats.push(m);
    return m;
  };

  if (type === 'warrior') {
    add(new THREE.Mesh(geo('oct22', () => new THREE.OctahedronGeometry(0.22)), teamMat()), 0, 0.26, 0);
    add(new THREE.Mesh(geo('helm', () => new THREE.ConeGeometry(0.14, 0.17, 6)), mat(0xc3c8d0)), 0, 0.5, 0);
    const sword = add(new THREE.Mesh(geo('sword', () => new THREE.BoxGeometry(0.05, 0.36, 0.05)), mat(0xd9dee5)), 0.22, 0.32, 0);
    sword.rotation.z = -0.5;
  } else if (type === 'archer') {
    add(new THREE.Mesh(geo('cone19', () => new THREE.ConeGeometry(0.19, 0.44, 6)), teamMat()), 0, 0.22, 0);
    add(new THREE.Mesh(geo('ico11', () => new THREE.IcosahedronGeometry(0.11, 0)), mat(0xe8c39a)), 0, 0.5, 0);
    const bow = add(new THREE.Mesh(geo('bow', () => new THREE.TorusGeometry(0.17, 0.02, 5, 8, Math.PI)), mat(0x8b5a2b)), 0.2, 0.3, 0);
    bow.rotation.y = Math.PI / 2;
    bow.rotation.z = -Math.PI / 2;
  } else if (type === 'rider') {
    add(new THREE.Mesh(geo('horse', () => new THREE.BoxGeometry(0.46, 0.19, 0.2)), mat(0x7a5230)), 0, 0.17, 0);
    add(new THREE.Mesh(geo('oct13', () => new THREE.OctahedronGeometry(0.13)), teamMat()), 0, 0.4, 0);
    add(new THREE.Mesh(geo('ico9', () => new THREE.IcosahedronGeometry(0.09, 0)), mat(0xe8c39a)), 0, 0.58, 0);
  } else if (type === 'defender') {
    add(new THREE.Mesh(geo('cylb', () => new THREE.CylinderGeometry(0.15, 0.19, 0.4, 6)), mat(0x7d838c)), 0, 0.2, 0);
    add(new THREE.Mesh(geo('shield', () => new THREE.BoxGeometry(0.09, 0.36, 0.3)), teamMat()), 0.17, 0.26, 0);
    add(new THREE.Mesh(geo('ico11', () => new THREE.IcosahedronGeometry(0.1, 0)), mat(0xe8c39a)), -0.02, 0.48, 0);
  } else if (type === 'swordsman') {
    add(new THREE.Mesh(geo('oct25', () => new THREE.OctahedronGeometry(0.25)), teamMat()), 0, 0.3, 0);
    add(new THREE.Mesh(geo('helmS', () => new THREE.ConeGeometry(0.16, 0.2, 6)), mat(0xc3c8d0)), 0, 0.56, 0);
    const sw = add(new THREE.Mesh(geo('swordL', () => new THREE.BoxGeometry(0.06, 0.52, 0.06)), mat(0xe4e8ee)), 0.26, 0.4, 0);
    sw.rotation.z = -0.6;
  } else if (type === 'catapult') {
    add(new THREE.Mesh(geo('catBase', () => new THREE.BoxGeometry(0.42, 0.13, 0.3)), mat(0x8b5a2b)), 0, 0.1, 0);
    for (const sx of [-0.13, 0.13]) {
      for (const sz of [-0.17, 0.17]) {
        const w = new THREE.Mesh(geo('wheel', () => new THREE.CylinderGeometry(0.08, 0.08, 0.05, 8)), mat(0x4a4038));
        w.rotation.x = Math.PI / 2;
        add(w, sx, 0.08, sz);
      }
    }
    const arm = add(new THREE.Mesh(geo('catArm', () => new THREE.BoxGeometry(0.05, 0.4, 0.05)), mat(0x9c6b3a)), 0.08, 0.3, 0);
    arm.rotation.z = 0.85;
    add(new THREE.Mesh(geo('stone', () => new THREE.IcosahedronGeometry(0.08, 0)), mat(0x9b9b94)), 0.24, 0.46, 0);
    add(new THREE.Mesh(geo('flagBox', () => new THREE.BoxGeometry(0.1, 0.1, 0.1)), teamMat()), -0.2, 0.2, 0);
  } else if (type === 'mindbender') {
    add(new THREE.Mesh(geo('robe', () => new THREE.ConeGeometry(0.2, 0.5, 6)), teamMat()), 0, 0.25, 0);
    add(new THREE.Mesh(geo('ico11', () => new THREE.IcosahedronGeometry(0.1, 0)), mat(0xe8c39a)), 0, 0.52, 0);
    add(new THREE.Mesh(geo('orb', () => new THREE.IcosahedronGeometry(0.07, 0)), mat(0xe0b84d)), 0.2, 0.42, 0);
  } else if (type === 'knight') {
    add(new THREE.Mesh(geo('kHorse', () => new THREE.BoxGeometry(0.52, 0.22, 0.24)), mat(0x5b4636)), 0, 0.19, 0);
    add(new THREE.Mesh(geo('kBody', () => new THREE.CylinderGeometry(0.14, 0.17, 0.36, 6)), teamMat()), 0, 0.44, 0);
    add(new THREE.Mesh(geo('kHelm', () => new THREE.ConeGeometry(0.15, 0.22, 6)), mat(0xd9dee5)), 0, 0.7, 0);
    const kl = add(new THREE.Mesh(geo('kLance', () => new THREE.BoxGeometry(0.05, 0.7, 0.05)), mat(0xf0f3f7)), 0.3, 0.45, 0);
    kl.rotation.z = -0.9;
  } else if (type === 'giant') {
    add(new THREE.Mesh(geo('gBody', () => new THREE.CylinderGeometry(0.34, 0.42, 0.7, 7)), teamMat()), 0, 0.42, 0);
    add(new THREE.Mesh(geo('gHead', () => new THREE.IcosahedronGeometry(0.2, 0)), mat(0xe8c39a)), 0, 0.9, 0);
    add(new THREE.Mesh(geo('gArmL', () => new THREE.BoxGeometry(0.15, 0.6, 0.15)), teamMat()), -0.44, 0.45, 0);
    add(new THREE.Mesh(geo('gArmR', () => new THREE.BoxGeometry(0.15, 0.6, 0.15)), teamMat()), 0.44, 0.45, 0);
    add(new THREE.Mesh(geo('gClub', () => new THREE.CylinderGeometry(0.1, 0.14, 0.55, 6)), mat(0x6b4a2b)), 0.52, 0.85, 0);
  } else if (type === 'boat') {
    const hull = add(new THREE.Mesh(geo('bHull', () => boatHullGeo(0.34, 0.17)), mat(0x8a5a33)), 0, 0.14, 0);
    add(new THREE.Mesh(geo('bMast', () => new THREE.CylinderGeometry(0.02, 0.02, 0.4, 5)), mat(0x5b4126)), 0, 0.48, 0);
    const sail = add(new THREE.Mesh(geo('bSail', () => new THREE.BoxGeometry(0.02, 0.28, 0.24)), teamMat()), 0, 0.42, 0);
    sail.rotation.y = Math.PI / 2;
  } else if (type === 'ship') {
    const hull = add(new THREE.Mesh(geo('sHull', () => boatHullGeo(0.46, 0.22)), mat(0x6b4a2b)), 0, 0.17, 0);
    add(new THREE.Mesh(geo('sMast', () => new THREE.CylinderGeometry(0.025, 0.025, 0.52, 5)), mat(0x5b4126)), 0, 0.6, 0);
    const sail = add(new THREE.Mesh(geo('sSail', () => new THREE.BoxGeometry(0.02, 0.34, 0.3)), teamMat()), 0, 0.52, 0);
    sail.rotation.y = Math.PI / 2;
    const rail = add(new THREE.Mesh(geo('sRail', () => new THREE.CylinderGeometry(0.2, 0.22, 0.14, 6, 1, true, 0, Math.PI * 1.35)), mat(0x9c6b3a)), 0, 0.24, 0);
    rail.rotation.y = 0.9;
    add(new THREE.Mesh(geo('sDeck', () => new THREE.CylinderGeometry(0.2, 0.2, 0.03, 6)), mat(0x8a5a33)), 0, 0.31, 0);
  } else if (type === 'battleship') {
    add(new THREE.Mesh(geo('bsHull', () => boatHullGeo(0.6, 0.3)), mat(0x4a555e)), 0, 0.2, 0);
    add(new THREE.Mesh(geo('bsDeck', () => new THREE.BoxGeometry(0.58, 0.07, 0.2)), mat(0x5c6670)), 0, 0.33, 0);
    add(new THREE.Mesh(geo('bsTurret', () => new THREE.CylinderGeometry(0.09, 0.1, 0.1, 6)), mat(0x6b7580)), 0, 0.42, 0);
    for (const sx of [-0.06, 0.06]) {
      const cannon = add(new THREE.Mesh(geo('bsCannon', () => new THREE.CylinderGeometry(0.025, 0.025, 0.26, 6)), mat(0x333b42)), sx, 0.46, 0);
      cannon.rotation.x = Math.PI / 2;
    }
    add(new THREE.Mesh(geo('bsBridge', () => new THREE.BoxGeometry(0.16, 0.16, 0.14)), mat(0x5c6670)), 0.18, 0.44, 0);
    add(new THREE.Mesh(geo('bsPole', () => new THREE.CylinderGeometry(0.012, 0.012, 0.32, 5)), mat(0x333b42)), -0.24, 0.5, 0);
    add(new THREE.Mesh(geo('bsFlag', () => new THREE.BoxGeometry(0.12, 0.08, 0.02)), teamMat()), -0.19, 0.65, 0);
  } else if (type === 'settler') {
    // Siedler: Person mit Bündel auf dem Rücken und Wanderstab mit Fahne.
    add(new THREE.Mesh(geo('stBody', () => new THREE.CylinderGeometry(0.11, 0.17, 0.4, 6)), teamMat()), 0, 0.2, 0);
    add(new THREE.Mesh(geo('ico11', () => new THREE.IcosahedronGeometry(0.11, 0)), mat(0xe8c39a)), 0, 0.5, 0);
    add(new THREE.Mesh(geo('stHat', () => new THREE.CylinderGeometry(0.15, 0.15, 0.025, 8)), mat(0xc9a25a)), 0, 0.58, 0);
    add(new THREE.Mesh(geo('stHatTop', () => new THREE.CylinderGeometry(0.07, 0.08, 0.07, 8)), mat(0xc9a25a)), 0, 0.62, 0);
    add(new THREE.Mesh(geo('stPack', () => new THREE.BoxGeometry(0.16, 0.2, 0.12)), mat(0x8a5a33)), -0.15, 0.3, 0);
    add(new THREE.Mesh(geo('stRoll', () => new THREE.CylinderGeometry(0.045, 0.045, 0.2, 6)), mat(0xd8cfb8)), -0.15, 0.43, 0)
      .rotation.x = Math.PI / 2;
    add(new THREE.Mesh(geo('stStaff', () => new THREE.CylinderGeometry(0.015, 0.015, 0.62, 5)), mat(0x6b4a2b)), 0.18, 0.31, 0);
    add(new THREE.Mesh(geo('stFlag', () => new THREE.BoxGeometry(0.02, 0.09, 0.13)), teamMat()), 0.18, 0.56, 0.07);
  } else if (type === 'spy') {
    // Spion: Kapuzenmantel in Teamfarbe mit Fernrohr.
    add(new THREE.Mesh(geo('spCloak', () => new THREE.ConeGeometry(0.17, 0.46, 7)), teamMat()), 0, 0.23, 0);
    add(new THREE.Mesh(geo('ico9', () => new THREE.IcosahedronGeometry(0.09, 0)), mat(0xe8c39a)), 0, 0.5, 0);
    add(new THREE.Mesh(geo('spHood', () => new THREE.ConeGeometry(0.12, 0.2, 7)), mat(0x27272a)), 0, 0.6, -0.01);
    const glass = add(new THREE.Mesh(geo('spGlass', () => new THREE.CylinderGeometry(0.025, 0.035, 0.26, 6)), mat(0xc8a64a)), 0.12, 0.5, 0.06);
    glass.rotation.z = -1.2;
  } else {
    // Rückfallmodell, damit eine Einheit ohne eigenes Modell nie unsichtbar ist.
    add(new THREE.Mesh(geo('oct22', () => new THREE.OctahedronGeometry(0.22)), teamMat()), 0, 0.26, 0);
  }

  g.userData.teamMats = teamMats;
  return g;
}

function boatHullGeo(width, depth) {
  const h = depth / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-h, 0);
  shape.lineTo(-h * 0.4, h);
  shape.quadraticCurveTo(0, h * 1.2, h * 0.4, h);
  shape.lineTo(h, 0);
  shape.quadraticCurveTo(0, -h * 0.35, -h, 0);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width * 0.4,
    bevelEnabled: true,
    bevelThickness: width * 0.1,
    bevelSize: width * 0.07,
    bevelSegments: 2
  });
  g.rotateY(Math.PI / 2);
  g.center();
  return g;
}

// `city` ist eine Ansicht (siehe cityView): owner, pop, wall.
function buildCity(city, color) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    geo('cityBase', () => new THREE.CylinderGeometry(0.62, 0.66, 0.12, 6)),
    mat(color)
  );
  base.position.y = 0.06;
  base.receiveShadow = true;
  base.castShadow = true;
  g.add(base);

  const tower = new THREE.Mesh(geo('cityTower', () => new THREE.CylinderGeometry(0.17, 0.2, 0.42, 6)), mat(0xe8e4d8));
  tower.position.y = 0.33;
  tower.castShadow = true;
  g.add(tower);

  const roof = new THREE.Mesh(geo('cityRoof', () => new THREE.ConeGeometry(0.24, 0.2, 6)), mat(city.owner ? color : 0x8f939c));
  roof.position.y = 0.62;
  roof.castShadow = true;
  g.add(roof);

  const houseGeo = geo('house', () => new THREE.BoxGeometry(0.15, 0.13, 0.15));
  const houseMat = mat(0xdcd6c6);
  for (let i = 0; i < city.pop; i++) {
    const a = (i / Math.max(city.pop, 1)) * Math.PI * 2 + 0.6;
    const h = new THREE.Mesh(houseGeo, houseMat);
    h.position.set(Math.cos(a) * 0.4, 0.185, Math.sin(a) * 0.4);
    h.rotation.y = a;
    h.castShadow = true;
    g.add(h);
  }

  if (city.owner) {
    const pole = new THREE.Mesh(geo('pole', () => new THREE.CylinderGeometry(0.015, 0.015, 0.4, 5)), mat(0x555a63));
    pole.position.set(0.26, 0.72, 0);
    g.add(pole);
    const flag = new THREE.Mesh(geo('flag', () => new THREE.BoxGeometry(0.16, 0.1, 0.02)), mat(color));
    flag.position.set(0.35, 0.85, 0);
    g.add(flag);
  }
  // Stadtmauer (Belohnung): niedriger Steinring am Rand.
  if (city.wall) {
    const wallMat = mat(0x9ca3af);
    const segGeo = geo('wallSeg', () => new THREE.BoxGeometry(0.34, 0.14, 0.07));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const seg = new THREE.Mesh(segGeo, wallMat);
      seg.position.set(Math.cos(a) * 0.58, 0.19, Math.sin(a) * 0.58);
      seg.rotation.y = -a + Math.PI / 2;
      seg.castShadow = true;
      g.add(seg);
    }
  }
  return g;
}

function cityKey(city) {
  return `${city.owner}|${city.pop}|${city.wall ? 'w' : ''}`;
}

function placeCityNode(state, city) {
  const key = hk(city.q, city.r);
  const existing = cityNodes.get(key);
  if (existing && existing.sig === cityKey(city)) return;
  if (existing) {
    scene.remove(existing.group);
    cityNodes.delete(key);
  }
  const group = buildCity(city, city.owner ? ownerColor(city.owner) : 0xb9bdc6);
  const p = toWorld(city.q, city.r);
  group.position.set(p.x, hexTop(key), p.z);
  scene.add(group);
  cityNodes.set(key, { group, owner: city.owner, pop: city.pop, sig: cityKey(city) });
}

function placeUnitNode(state, unit) {
  const color = ownerColor(unit.owner);
  const group = unitBody(unit.type, color);
  const p = toWorld(unit.q, unit.r);
  const key = hk(unit.q, unit.r);
  group.position.set(p.x, hexTop(key), p.z);
  const sprite = makeHpSprite();
  drawHp(sprite, unit.hp);
  sprite.position.y = 0.95;
  group.add(sprite);
  scene.add(group);
  const node = { group, sprite, hp: unit.hp, acted: unit.acted, owner: unit.owner, dying: false, baseColor: color };
  unitNodes.set(unit.id, node);
  if (unit.acted) {
    for (const m of node.group.userData.teamMats) m.color.multiplyScalar(0.55);
  }
  group.scale.set(0.01, 0.01, 0.01);
  addTween({
    dur: 200,
    update: t => group.scale.setScalar(Math.max(t, 0.01)),
    ease: easeOutBack
  });
  return node;
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function easeOutBack(t) { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

function addTween(tw) {
  tw.start = performance.now();
  tw.t = 0;
  tweens.push(tw);
}

function stepTweens(now) {
  if (!tweens.length) return;
  const keep = [];
  for (const tw of tweens) {
    const raw = Math.min((now - tw.start) / tw.dur, 1);
    tw.t = tw.ease ? tw.ease(raw) : raw;
    tw.update(tw.t, raw);
    if (raw < 1) keep.push(tw);
    else if (tw.resolve) tw.resolve();
  }
  tweens = keep;
}

function stepEffects(now) {
  for (const node of unitNodes.values()) {
    const flashing = node.flashUntil && now < node.flashUntil;
    for (const m of node.group.userData.teamMats) m.emissive.setHex(flashing ? 0x802020 : 0x000000);
  }
  if (effects.length) {
    const keep = [];
    for (const e of effects) {
      const raw = Math.min((now - e.start) / e.dur, 1);
      e.update(raw);
      if (raw < 1) keep.push(e);
      else {
        if (e.sprite) {
          e.sprite.parent?.remove(e.sprite);
          e.sprite.material.map?.dispose();
          e.sprite.material.dispose();
        }
      }
    }
    effects = keep;
  }
}

export function syncBoard(state, viewer = null) {
  if (!initialized) return Promise.resolve();
  colorMap = {};
  for (const p of state.players || []) colorMap[p] = playerColor(state, p);
  const sig = terrainSignature(state);
  if (sig !== boardSignature) {
    clearBoard();
    buildTiles(state);
    buildFog();
    boardSignature = sig;
  }
  const explored = exploredSet(state, viewer);
  const visible = explored ? visibleKeys(state, viewer) : null;
  for (const [key, t] of tiles) {
    syncImprovement(t, state.improvements ? state.improvements[key] : null);
    syncRuin(t, state.ruins && state.ruins[key]);
    syncBridge(t, state.bridges ? state.bridges[key] : null);
    const seen = !explored || explored.has(key);
    t.seen = seen;
    t.lit = !visible || visible.has(key);
    t.mesh.material = seen ? t.baseMat : darkMatFor(t.terrain);
    if (t.decor) for (const d of t.decor) d.visible = seen;
  }
  // Städte so zeigen, wie der Betrachter sie kennt (live oder aus dem Gedächtnis).
  const cityViews = new Map();
  for (const c of state.cities) {
    const view = cityView(state, viewer, c);
    cityViews.set(hk(c.q, c.r), view);
    if (view) placeCityNode(state, view);
  }

  const alive = new Set();
  const promises = [];
  for (const u of state.units) {
    alive.add(u.id);
    let node = unitNodes.get(u.id);
    if (!node) {
      node = placeUnitNode(state, u);
      continue;
    }
    if (node.hp !== u.hp) {
      node.hp = u.hp;
      drawHp(node.sprite, u.hp);
    }
    // Bekehrte Einheiten (Gedankenbeuger) wechseln den Besitzer.
    if (node.owner !== u.owner) {
      node.owner = u.owner;
      node.baseColor = ownerColor(u.owner);
      node.acted = null;
    }
    if (node.acted !== u.acted) {
      node.acted = u.acted;
      const f = u.acted ? 0.55 : 1;
      for (const m of node.group.userData.teamMats) {
        m.color.setHex(node.baseColor).multiplyScalar(f);
      }
    }
    const target = new THREE.Vector3();
    const p = toWorld(u.q, u.r);
    target.set(p.x, hexTop(hk(u.q, u.r)), p.z);
    const pos = node.group.position;
    if (pos.distanceToSquared(target) > 0.0004 && !node.moving) {
      node.moving = true;
      const from = pos.clone();
      promises.push(new Promise(resolve => {
        addTween({
          dur: 320,
          ease: easeOut,
          update: t => {
            pos.lerpVectors(from, target, t);
            pos.y += Math.sin(Math.PI * Math.min(t, 1)) * 0.45 * (1 - t * 0.3);
          },
          resolve: () => { node.moving = false; resolve(); }
        });
      }));
    }
  }
  for (const u of state.units) {
    const node = unitNodes.get(u.id);
    if (!node) continue;
    // Fremde Einheiten nur zeigen, solange sie gerade in Sichtweite sind –
    // entdecktes, aber nicht beobachtetes Land verrät keine Truppen.
    const seen = !explored || u.owner === viewer || isVisible(state, viewer, u.q, u.r);
    node.group.visible = !!seen;
  }
  for (const c of state.cities) {
    const node = cityNodes.get(hk(c.q, c.r));
    if (!node) continue;
    node.group.visible = !!cityViews.get(hk(c.q, c.r));
  }
  for (const [id, node] of unitNodes) {
    if (alive.has(id) || node.dying) continue;
    node.dying = true;
    const g = node.group;
    addTween({
      dur: DIESE_DUR,
      update: t => g.scale.setScalar(Math.max(1 - t, 0.01)),
      resolve: () => {
        scene.remove(g);
        node.sprite.userData.texture.dispose();
        node.sprite.material.dispose();
        for (const m of g.userData.teamMats) m.dispose();
        unitNodes.delete(id);
      }
    });
  }
  return Promise.all(promises);
}

function floatText(worldPos, text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(8,10,14,0.85)';
  ctx.strokeText(text, 64, 32);
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(0.75, 0.375, 1);
  sprite.position.copy(worldPos).add(new THREE.Vector3(0, 0.9, 0));
  sprite.renderOrder = 30;
  scene.add(sprite);
  effects.push({
    sprite, start: performance.now(), dur: 950,
    update: t => {
      sprite.position.y = worldPos.y + 0.9 + t * 0.9;
      sprite.material.opacity = 1 - Math.max(0, t - 0.4) / 0.6;
    }
  });
}

function nodePos(id) {
  const n = unitNodes.get(id);
  return n ? n.group.position.clone() : new THREE.Vector3();
}

export function playCombat(events) {
  if (!initialized) return Promise.resolve();
  let flashCount = 0;
  for (const ev of events) {
    if (ev.kind === 'damage' || ev.kind === 'retaliate') {
      const node = unitNodes.get(ev.to);
      if (node) node.flashUntil = performance.now() + 280;
      floatText(nodePos(ev.to), '-' + ev.dmg, ev.kind === 'retaliate' ? '#ffd24d' : '#ff8080');
      flashCount++;
    }
  }
  return new Promise(resolve => setTimeout(resolve, flashCount ? 620 : 0));
}

const HL = {
  move: { color: 0xffffff, opacity: 0.34 },
  attack: { color: 0xff4d4d, opacity: 0.5 },
  city: { color: 0xffe14d, opacity: 0.34 },
  bridge: { color: 0x60a5fa, opacity: 0.45 }
};

const discGeo = () => geo('disc', () => new THREE.CylinderGeometry(0.8, 0.8, 0.07, 6));
const discMats = new Map();
function discMat(kind) {
  if (!discMats.has(kind)) {
    const { color, opacity } = HL[kind];
    discMats.set(kind, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false
    }));
  }
  return discMats.get(kind);
}

export function setHighlights({ selected = null, move = null, attack = null, city = null, bridge = null } = {}) {
  if (!initialized) return;
  while (highlightGroup.children.length) highlightGroup.remove(highlightGroup.children[0]);
  selectedMesh = null;
  selectedKey = selected;

  const addDisc = (q, r, kind, dy = 0.05) => {
    const t = tiles.get(hk(q, r));
    if (!t) return;
    const m = new THREE.Mesh(discGeo(), discMat(kind));
    const p = toWorld(q, r);
    m.position.set(p.x, t.top + dy, p.z);
    highlightGroup.add(m);
  };

  if (selected) {
    const [q, r] = selected.split(',').map(Number);
    addDisc(q, r, 'city', 0.045);
    selectedMesh = highlightGroup.children[highlightGroup.children.length - 1];
  }
  if (move) for (const k of move.keys()) { const [q, r] = k.split(',').map(Number); addDisc(q, r, 'move'); }
  if (attack) for (const u of attack) addDisc(u.q, u.r, 'attack');
  if (city) addDisc(city.q, city.r, 'city');
  if (bridge) for (const [q, r] of bridge) addDisc(q, r, 'bridge');
}

export function cameraTo(q, r, close = false) {
  if (!initialized) return;
  const p = toWorld(q, r);
  const fromT = controls.target.clone();
  const toT = new THREE.Vector3(p.x, 0, p.z);
  const fromP = camera.position.clone();
  const off = close ? new THREE.Vector3(0, 11, 10) : new THREE.Vector3(-2, 19, 17);
  // Hochformat (iPad/Handy hochkant): weiter weg, damit genug Breite sichtbar ist.
  if (camera.aspect < 1) off.multiplyScalar(1 + (1 - camera.aspect) * 0.9);
  const toP = toT.clone().add(off);
  addTween({
    dur: 450,
    ease: easeOut,
    update: t => {
      controls.target.lerpVectors(fromT, toT, t);
      camera.position.lerpVectors(fromP, toP, t);
    }
  });
}

export function worldOf(q, r) {
  const p = toWorld(q, r);
  return new THREE.Vector3(p.x, hexTop(hk(q, r)), p.z);
}

export function project(q, r) {
  if (!initialized) return null;
  const v = worldOf(q, r);
  v.y += 0.3;
  v.project(camera);
  const rect = canvasEl().getBoundingClientRect();
  return {
    x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-v.y * 0.5 + 0.5) * rect.height
  };
}
