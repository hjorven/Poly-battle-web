import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HEX_SIZE, TERRAIN, COLORS, MAP_W, MAP_H, MONUMENTS, hasAbility } from './config.js';
import { playerColor, isVisible, visibleKeys, cityView, lighthouseKeys, lighthouseFound, roadAt, onRoadNet, useMap } from './rules.js';
import { toWorld, forEachHex, hk, DIRS } from './hex.js';

let colorMap = {};
function ownerColor(owner) {
  return colorMap[owner] ?? COLORS[owner] ?? 0xffffff;
}

const TILE_GAP = 0.94;
const DIESE_DUR = 620;

let renderer, scene, camera, controls, raycaster;
let tileMeshes = [];
const tiles = new Map();
const unitNodes = new Map();
const cityNodes = new Map();
let highlightGroup;
let idleGroup;
let selectedMesh = null;
let targetMesh = null;
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

// Entdeckt, aber gerade außer Sicht: Gelände leicht abgedunkelt.
const dimMats = new Map();
function dimMatFor(t) {
  if (!dimMats.has(t)) {
    dimMats.set(t, new THREE.MeshLambertMaterial({
      color: new THREE.Color(TERRAIN[t].color).multiplyScalar(0.68),
      flatShading: true
    }));
  }
  return dimMats.get(t);
}


export function initRender(canvas, opts = {}) {
  onPick = opts.onPick || null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (e) {
    return false;
  }
  initialized = true;
  // Handys entziehen WebGL manchmal den Kontext (App-Wechsel, Speicherdruck).
  // Dann nicht weiterzeichnen und nach der Rückgabe alles neu aufbauen.
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); contextLost = true; });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    boardSignature = null;
    if (lastSync) syncBoard(lastSync.state, lastSync.viewer);
  });
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
  // Zwei Finger: zoomen und drehen (Drehgeste), ein Finger: verschieben.
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
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
    try { stepTweens(now); stepEffects(now); } catch (e) { reportOnce(e); }
    if (selectedMesh) {
      const s = 1 + Math.sin(now / 220) * 0.06;
      selectedMesh.scale.set(s, 1, s);
    }
    if (targetMesh) {
      const s = 0.82 + Math.sin(now / 140) * 0.1;
      targetMesh.scale.set(s, 1, s);
    }
    // Ein Fehler in Nebenschritten (Minikarte, Nebel, Effekte) darf das Zeichnen
    // des Spielfelds nie stoppen – sonst bleibt nur die Oberfläche auf Weiß.
    for (const step of [() => stepFog(now, dt), () => stepIdleMarkers(now), () => stepLighthouses(dt), () => stepMasts(dt), () => stepMinimap(now)]) {
      try { step(); } catch (e) { reportOnce(e); }
    }
    controls.update();
    clampTarget();
    if (!contextLost) renderer.render(scene, camera);
  }
  requestAnimationFrame(loop);
  return true;
}

// Ausdehnung der Karte in Weltkoordinaten; zwischengespeichert, weil die
// Kamera sie in jedem Frame braucht (neu berechnet bei neuer Kartengröße).
let boundsCache = null;
function mapBounds() {
  const key = MAP_W + 'x' + MAP_H;
  if (boundsCache && boundsCache.key === key) return boundsCache;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  forEachHex((q, r) => {
    const p = toWorld(q, r);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  });
  boundsCache = { key, minX, maxX, minZ, maxZ };
  return boundsCache;
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

// --- Leuchttürme ----------------------------------------------------------------
// Hoch genug, um aus dem Nebel zu ragen: Orientierung von Beginn an. Die Lampe
// leuchtet (mit kreisendem Lichtkegel), sobald der Betrachter den Turm erreicht hat.

const lightNodes = new Map();
const lampOn = new THREE.MeshBasicMaterial({ color: 0xffd34d });
const lampOff = new THREE.MeshLambertMaterial({ color: 0x9ca3af, flatShading: true });

function lighthouseNode() {
  const g = new THREE.Group();
  const rock = new THREE.Mesh(geo('lhRock', () => new THREE.CylinderGeometry(0.5, 0.62, 0.22, 7)), mat(0x8b8f94));
  rock.position.y = 0.11;
  g.add(rock);
  const white = mat(0xf5f5f4), red = mat(0xd9443b);
  const parts = [[0.27, 0.24, 0.3, white], [0.24, 0.215, 0.24, red], [0.215, 0.19, 0.24, white], [0.19, 0.17, 0.2, red]];
  let y = 0.22;
  parts.forEach(([rb, rt, h, m], i) => {
    const seg = new THREE.Mesh(geo('lhSeg' + i, () => new THREE.CylinderGeometry(rt, rb, h, 10)), m);
    seg.position.y = y + h / 2;
    y += h;
    g.add(seg);
  });
  const gallery = new THREE.Mesh(geo('lhGallery', () => new THREE.CylinderGeometry(0.25, 0.25, 0.05, 10)), mat(0x3f3f46));
  gallery.position.y = y + 0.025;
  g.add(gallery);
  const lamp = new THREE.Mesh(geo('lhLamp', () => new THREE.CylinderGeometry(0.13, 0.13, 0.17, 10)), lampOff);
  lamp.position.y = y + 0.135;
  g.add(lamp);
  const roof = new THREE.Mesh(geo('lhRoof', () => new THREE.ConeGeometry(0.19, 0.2, 10)), red);
  roof.position.y = y + 0.32;
  g.add(roof);
  for (const m of g.children) m.castShadow = true;
  // Lichtkegel: flacher, halbtransparenter Strahl, der sich dreht.
  const beamGeo = geo('lhBeam', () => new THREE.ConeGeometry(0.32, 2.4, 12, 1, true).rotateZ(Math.PI / 2).translate(1.2, 0, 0));
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
    color: 0xffe08a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false
  }));
  beam.position.y = lamp.position.y;
  beam.renderOrder = 14;
  beam.visible = false;
  g.add(beam);
  g.userData = { lamp, beam };
  return g;
}

function syncLighthouses(state, viewer) {
  const keys = new Set(lighthouseKeys(state));
  for (const [k, g] of lightNodes) {
    if (!keys.has(k)) { scene.remove(g); lightNodes.delete(k); }
  }
  for (const k of keys) {
    let g = lightNodes.get(k);
    if (!g) {
      const [q, r] = k.split(',').map(Number);
      const p = toWorld(q, r);
      g = lighthouseNode();
      g.position.set(p.x, TERRAIN.ocean.height, p.z);
      g.userData.beam.rotation.y = (q * 7 + r * 3) % 6;
      scene.add(g);
      lightNodes.set(k, g);
    }
    const lit = !viewer || lighthouseFound(state, viewer, k);
    g.userData.lamp.material = lit ? lampOn : lampOff;
    g.userData.beam.visible = lit;
  }
}

function stepLighthouses(dt) {
  for (const g of lightNodes.values()) if (g.userData.beam.visible) g.userData.beam.rotation.y += dt * 0.9;
}

// --- Straßen -------------------------------------------------------------------
// Je Straßenfeld ein Knoten: Mittelstück plus Arme zu benachbarten Straßen,
// Städten und Brücken. Neu gebaut, wenn sich die Nachbarschaft ändert.

const ROAD_COLOR = 0xb4875a;

function roadNode(arms) {
  const g = new THREE.Group();
  const m = mat(ROAD_COLOR);
  const hub = new THREE.Mesh(geo('rdHub', () => new THREE.CylinderGeometry(0.13, 0.13, 0.02, 8)), m);
  hub.position.y = 0.01;
  g.add(hub);
  const len = Math.sqrt(3) / 2 * HEX_SIZE;
  for (const d of arms) {
    const [dq, dr] = DIRS[d];
    const p = toWorld(dq, dr);
    const arm = new THREE.Mesh(geo('rdArm', () => new THREE.BoxGeometry(len, 0.02, 0.18).translate(len / 2, 0, 0)), m);
    arm.rotation.y = -Math.atan2(p.z, p.x);
    arm.position.y = 0.01;
    g.add(arm);
  }
  for (const c of g.children) c.receiveShadow = true;
  return g;
}

// Straßen durch Wald und Gebirge: Bäume auf dem Weg fällen (Größe 0, damit
// die Sichtbarkeitslogik unberührt bleibt), den Gipfel verkleinern und von der
// Straße weg verschieben – es entsteht ein Pass.
function roadThroughDecor(t, sig) {
  const arms = sig ? [...sig.slice(1)].map(Number) : [];
  const env = { road: !!sig, arms };
  let best = null;
  if (sig) {
    for (let k = 0; k < 6; k++) {
      const ang = Math.PI / 6 + k * Math.PI / 3, vx = Math.cos(ang), vz = Math.sin(ang);
      const gap = Math.min(Math.PI, ...arms.map(d => Math.acos(Math.max(-1, Math.min(1, vx * DIR_VEC[d][0] + vz * DIR_VEC[d][1])))));
      if (!best || gap > best.gap) best = { vx, vz, gap };
    }
  }
  // Bäume auf dem Weg rücken an den Rand zwischen die Straßenarme (der Wald
  // bleibt Wald); nur wenn dort kein Platz ist, verschwinden sie.
  const moved = new Map();
  if (sig) {
    const spots = [];
    for (let k = 0; k < 12; k++) {
      const ang = k * Math.PI / 6 + 0.26, vx = Math.cos(ang), vz = Math.sin(ang);
      for (const rad of [0.5, 0.36]) {
        const x = vx * rad, z = vz * rad;
        if (!onRoadPath(x, z, env, 0.26)) spots.push([x, z]);
      }
    }
    const taken = [];
    const keyOf = d => d.userData.tree.join(',');
    for (const d of t.decor) {
      if (!d.userData.tree || moved.has(keyOf(d))) continue;
      const [x, z] = d.userData.tree;
      if (!onRoadPath(x, z, env, 0.24)) { moved.set(keyOf(d), [x, z, 1]); taken.push([x, z]); continue; }
    }
    for (const d of t.decor) {
      if (!d.userData.tree || moved.has(keyOf(d))) continue;
      // Nächster freier Platz mit Abstand zu anderen Bäumen.
      const [x, z] = d.userData.tree;
      let best = null;
      for (const sp of spots) {
        if (taken.some(([a, b]) => Math.hypot(a - sp[0], b - sp[1]) < 0.2)) continue;
        const dist = Math.hypot(sp[0] - x, sp[1] - z);
        if (!best || dist < best.dist) best = { sp, dist };
      }
      if (best) { taken.push(best.sp); moved.set(keyOf(d), [best.sp[0], best.sp[1], 0.8]); }
      else moved.set(keyOf(d), null);
    }
  }
  for (const d of t.decor) {
    if (d.userData.tree) {
      const [x, z] = d.userData.tree;
      const s = d.userData.size || 1;
      const spot = sig ? moved.get(d.userData.tree.join(',')) : [x, z, 1];
      const blocked = !spot;
      const f = blocked ? 0 : spot[2];
      if (d.userData.baseY == null) d.userData.baseY = d.position.y;
      if (!blocked) {
        const top = TERRAIN.forest.height / 2;
        d.position.set(spot[0], top + (d.userData.baseY - top) * f, spot[1]);
      }
      d.scale.setScalar(blocked ? 0.0001 : 1);
      if (!blocked && d.userData.size) d.scale.setScalar(s * f);
      if (!blocked && !d.userData.size) d.scale.set(f, (d.userData.trunkScale || d.scale.y || 1) * f, f);
    } else if (d.userData.peak || d.userData.snow) {
      if (d.userData.base == null) d.userData.base = d.position.y;
      const sc = sig ? 0.6 : 1;
      d.scale.setScalar(sc);
      d.position.x = sig ? best.vx * 0.38 : 0;
      d.position.z = sig ? best.vz * 0.38 : 0;
      // Kleinerer Gipfel sitzt tiefer, sonst schwebt er.
      const top = TERRAIN.mountain.height / 2;
      d.position.y = top + (d.userData.base - top) * sc;
    }
  }
}

function syncRoad(state, key, t) {
  const [q, r] = key.split(',').map(Number);
  let sig = '';
  if (roadAt(state, q, r)) {
    sig = 'r';
    DIRS.forEach(([dq, dr], d) => { if (onRoadNet(state, q + dq, r + dr)) sig += d; });
  }
  if (t.roadSig === sig) return;
  roadThroughDecor(t, sig);
  if (t.roadNode) {
    t.mesh.remove(t.roadNode);
    t.decor = t.decor.filter(d => d !== t.roadNode);
    t.roadNode = null;
  }
  t.roadSig = sig;
  if (!sig) return;
  const n = roadNode([...sig.slice(1)].map(Number));
  n.position.y = TERRAIN[t.terrain].height / 2 + 0.005;
  n.visible = t.seen;
  t.mesh.add(n);
  t.decor.push(n);
  t.roadNode = n;
}

// --- Brücken ----------------------------------------------------------------

function bridgeNode(axis) {
  const g = new THREE.Group();
  const wood = mat(0x8a5a33), dark = mat(0x5c3d22);
  const part = g;
  const deck = new THREE.Mesh(geo('brDeck', () => new THREE.BoxGeometry(1.78, 0.07, 0.44)), wood);
  deck.castShadow = true;
  deck.receiveShadow = true;
  part.add(deck);
  for (const z of [-0.2, 0.2]) {
    const rail = new THREE.Mesh(geo('brRail', () => new THREE.BoxGeometry(1.7, 0.04, 0.04)), dark);
    rail.position.set(0, 0.13, z);
    part.add(rail);
    for (const x of [-0.75, -0.25, 0.25, 0.75]) {
      const post = new THREE.Mesh(geo('brPost', () => new THREE.BoxGeometry(0.04, 0.13, 0.04)), dark);
      post.position.set(x, 0.07, z);
      part.add(post);
    }
  }

  for (const x of [-0.42, 0.42]) {
    const pier = new THREE.Mesh(geo('brPier2', () => new THREE.CylinderGeometry(0.05, 0.06, 0.5, 6)), dark);
    pier.position.set(x, -0.25, 0);
    g.add(pier);
  }
  // Brücke entlang der Achse zwischen den beiden Ufern ausrichten.
  const [dq, dr] = DIRS[axis];
  const w = toWorld(dq, dr);
  g.rotation.y = -Math.atan2(w.z, w.x);
  return g;
}


// Schiffe unter Brücken: Masten umlegen (wie bei Flussschiffen üblich), Rumpf
// liegt etwas tiefer. Animiert in stepMasts.
function stepMasts(dt) {
  for (const node of unitNodes.values()) {
    const m = node.group.userData.masts;
    if (!m || !m.length) continue;
    const want = node.underBridge ? 1 : 0;
    node.mastFold = node.mastFold ?? 0;
    if (node.mastFold === want) continue;
    node.mastFold += Math.sign(want - node.mastFold) * Math.min(Math.abs(want - node.mastFold), dt * 2.5);
    const k = node.mastFold * node.mastFold * (3 - 2 * node.mastFold);
    for (const h of m) h.rotation.z = 1.45 * k;
  }
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
  const n = bridgeNode(axis);
  // Fahrbahn etwas über Ufer-Höhe (Land 0.5), damit Schiffe mit umgelegtem
  // Mast darunter durchpassen; relativ zur Kachelmitte.
  n.position.y = 0.6 - TERRAIN[t.terrain].height / 2;
  n.visible = t.seen;
  t.mesh.add(n);
  t.decor.push(n);
  t.bridgeNode = n;
}

// --- Nebel ------------------------------------------------------------------
// Eine durchgehende Nebelfläche über der ganzen Karte. Ihre Deckkraft kommt
// aus einer Textur, in die jedes unentdeckte Feld als weicher Kreis gemalt
// wird: innen gleichmäßig dicht, am Rand ein sanfter Übergang – keine
// Flecken, kein Muster. Die Fläche liegt knapp über den Feldern, damit der
// Rand auch beim Drehen/Neigen zu den Feldern passt (unentdeckte Berge
// werden dafür flach gezeichnet). Zielfelder werden freigelegt.

const FOG_Y = 0.62;          // Höhe der Nebelfläche (Land 0.5)
const FOG_COLOR = 0xdde4ea;
const FOG_PX = 10;           // Texturpixel pro Welteinheit
// Radius des weichen Kreises je Feld (Weltmaß). Der voll deckende Kern
// (FOG_CORE) reicht über die Feldecken (Abstand 1) hinaus, sonst schimmern
// dort die Fugen zwischen den Feldern durch.
const FOG_RADIUS = 1.45;
const FOG_CORE = 0.76;
let fog = null;
let fogClear = new Set();

function buildFog() {
  if (fog) {
    scene.remove(fog.mesh);
    fog.mesh.material.map.dispose();
    fog.mesh.material.dispose();
    fog.mesh.geometry.dispose();
  }
  const b = mapBounds();
  const pad = 3;
  const minX = b.minX - pad, minZ = b.minZ - pad;
  const w = b.maxX - b.minX + pad * 2, h = b.maxZ - b.minZ + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * FOG_PX);
  canvas.height = Math.ceil(h * FOG_PX);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, color: FOG_COLOR, transparent: true, depthWrite: false, fog: false })
  );
  mesh.position.set(minX + w / 2, FOG_Y, minZ + h / 2);
  mesh.renderOrder = 12;
  scene.add(mesh);
  const cells = [];
  for (const [key, t] of tiles) {
    const [q, r] = key.split(',').map(Number);
    const p = toWorld(q, r);
    cells.push({ key, t, px: (p.x - minX) * FOG_PX, pz: (p.z - minZ) * FOG_PX, level: 1 });
  }
  fog = { mesh, tex, canvas, ctx: canvas.getContext('2d'), cells, dirty: true };
}

function paintFog() {
  const { ctx, canvas, cells } = fog;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const rad = FOG_RADIUS * FOG_PX;
  for (const c of cells) {
    if (c.level <= 0.005) continue;
    const gr = ctx.createRadialGradient(c.px, c.pz, 0, c.px, c.pz, rad);
    gr.addColorStop(0, `rgba(255,255,255,${c.level})`);
    gr.addColorStop(FOG_CORE, `rgba(255,255,255,${c.level})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(c.px - rad, c.pz - rad, rad * 2, rad * 2);
  }
  fog.tex.needsUpdate = true;
}

function stepFog(now, dt) {
  if (!fog) return;
  const k = Math.min(1, dt * 6);
  let changed = fog.dirty;
  for (const c of fog.cells) {
    const want = !c.t.seen && !fogClear.has(c.key) ? 1 : 0;
    if (c.level === want) continue;
    c.level += (want - c.level) * k;
    if (Math.abs(c.level - want) < 0.02) c.level = want;
    changed = true;
  }
  if (changed) {
    fog.dirty = false;
    paintFog();
  }
}

// Unentdeckte Felder tragen selbst die Nebelfarbe (unbeleuchtet), liegen
// flach (Berge ragen sonst heraus) und stoßen lückenlos aneinander. Was an
// Kanten unter der Nebelfläche durchscheint, hat so dieselbe Farbe – keine
// Fugenlinien im Nebel.
const fogTileMat = new THREE.MeshBasicMaterial({ color: FOG_COLOR, fog: false });
// Freigelegtes Zugziel im Unentdeckten: mittleres Grau, damit die helle
// Markierung darauf gut sichtbar ist.
const fogTargetMat = new THREE.MeshBasicMaterial({ color: 0x8b97a3, fog: false });
let fogClearTiles = [];

function applyFogClear() {
  for (const t of fogClearTiles) if (!t.seen) t.mesh.material = fogTileMat;
  fogClearTiles = [];
  for (const k of fogClear) {
    const t = tiles.get(k);
    if (t && !t.seen) { t.mesh.material = fogTargetMat; fogClearTiles.push(t); }
  }
}
function flattenUnseen(t) {
  const h = TERRAIN[t.terrain].height;
  const y = t.seen || h <= 0.5 ? 1 : 0.5 / h;
  const xz = t.seen ? 1 : 1 / TILE_GAP;
  if (t.mesh.scale.y !== y || t.mesh.scale.x !== xz) {
    t.mesh.scale.set(xz, y, xz);
    t.mesh.position.y = (h * y) / 2;
  }
}

// --- Minikarte --------------------------------------------------------------

let mini = null;
export function initMinimap(canvas, onJump) {
  mini = { canvas, ctx: canvas.getContext('2d'), state: null, viewer: null, last: 0, onJump };
  const jump = e => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * canvas.width;
    const y = (e.clientY - rect.top) / rect.height * canvas.height;
    const { scale, ox, oz } = miniFrame();
    const key = fromWorldKey((x - ox) / scale, (y - oz) / scale);
    if (key && mini.onJump) mini.onJump(key);
  };
  canvas.addEventListener('pointerdown', e => { e.stopPropagation(); jump(e); });
}

function fromWorldKey(x, z) {
  // Nächste Kachel suchen (Karte ist klein, ein Durchlauf reicht).
  let best = null, bd = Infinity;
  forEachHex((q, r) => {
    const p = toWorld(q, r);
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bd) { bd = d; best = [q, r]; }
  });
  return best && bd < 4 ? best : null;
}

function miniFrame() {
  const b = mapBounds();
  const W = mini.canvas.width, H = mini.canvas.height, pad = 6;
  const scale = Math.min((W - pad * 2) / (b.maxX - b.minX + 2), (H - pad * 2) / (b.maxZ - b.minZ + 2));
  const ox = (W - (b.maxX - b.minX) * scale) / 2 - b.minX * scale;
  const oz = (H - (b.maxZ - b.minZ) * scale) / 2 - b.minZ * scale;
  return { scale, ox, oz };
}

const cssColor = c => '#' + c.toString(16).padStart(6, '0');

export function drawMinimap(state, viewer) {
  if (!mini || !state) return;
  mini.state = state;
  mini.viewer = viewer;
  paintMinimap();
}

function paintMinimap() {
  const { ctx, canvas, state, viewer } = mini;
  if (!state || !initialized) return;
  // Gehört der gemerkte Stand zu einer anderen Kartengröße (gerade neues Spiel), aussetzen.
  if (state.terrain.length !== MAP_W * MAP_H) return;
  const { scale, ox, oz } = miniFrame();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1e3a5f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const explored = viewer && state.explored && state.explored[viewer] ? new Set(state.explored[viewer]) : null;
  const visible = explored ? visibleKeys(state, viewer) : null;
  const rad = scale * 0.9;
  const dot = (q, r, size, color) => {
    const p = toWorld(q, r);
    ctx.fillStyle = color;
    ctx.fillRect(ox + p.x * scale - size / 2, oz + p.z * scale - size / 2, size, size);
  };
  forEachHex((q, r) => {
    const k = hk(q, r);
    const p = toWorld(q, r);
    if (explored && !explored.has(k)) ctx.fillStyle = '#374151';
    else ctx.fillStyle = cssColor(TERRAIN[state.terrain[r * MAP_W + q]].color);
    ctx.beginPath();
    ctx.arc(ox + p.x * scale, oz + p.z * scale, rad, 0, Math.PI * 2);
    ctx.fill();
    if (visible && explored.has(k) && !visible.has(k)) {
      ctx.fillStyle = 'rgba(15,23,42,0.35)';
      ctx.fill();
    }
    if (state.bridges && state.bridges[k] != null && (!explored || explored.has(k))) dot(q, r, rad, '#8a5a33');
  });
  for (const c of state.cities) {
    const v = cityView(state, viewer, c);
    if (!v) continue;
    dot(c.q, c.r, rad * 2.4, '#111827');
    dot(c.q, c.r, rad * 1.7, v.owner ? cssColor(ownerColor(v.owner)) : '#d4d4d8');
  }
  for (const u of state.units) {
    if (explored && u.owner !== viewer && !isVisible(state, viewer, u.q, u.r)) continue;
    dot(u.q, u.r, rad * 1.3, !viewer ? cssColor(ownerColor(u.owner)) : u.owner === viewer ? '#ffffff' : '#ef4444');
  }
  // Kameraausschnitt als Rahmen um das Blickziel.
  const t = controls.target;
  const span = camera.position.distanceTo(t) * 0.55;
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox + (t.x - span * camera.aspect * 0.6) * scale, oz + (t.z - span * 0.45) * scale,
    span * camera.aspect * 1.2 * scale, span * 0.9 * scale);
}

// Der Kamerarahmen folgt dem Schwenken – etwa viermal pro Sekunde.
function stepMinimap(now) {
  if (!mini || !mini.state || now - mini.last < 250) return;
  mini.last = now;
  paintMinimap();
}

// --- Markierungen für Einheiten, die noch handeln können --------------------

let idleMarkers = [];
export function setIdleMarkers(units) {
  if (!initialized) return;
  for (const m of idleMarkers) idleGroup.remove(m);
  idleMarkers = [];
  const markGeo = geo('idleMark', () => new THREE.OctahedronGeometry(0.11, 0));
  const markMat = geo('idleMat', () => new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
  for (const u of units) {
    const m = new THREE.Mesh(markGeo, markMat);
    const p = toWorld(u.q, u.r);
    m.position.set(p.x, unitTop(hk(u.q, u.r), u.type) + 1.3, p.z);
    m.scale.set(1, 1.6, 1);
    m.userData.base = m.position.y;
    m.userData.phase = (u.q * 7 + u.r * 3) % 10;
    idleGroup.add(m);
    idleMarkers.push(m);
  }
}

// Rote, pulsierende Ringe um bedrohte eigene Städte.
let threatRings = [];
export function setThreatMarkers(cities) {
  if (!initialized) return;
  for (const m of threatRings) idleGroup.remove(m);
  threatRings = [];
  const ringGeo = geo('threatRing', () => new THREE.RingGeometry(0.72, 0.86, 6).rotateX(-Math.PI / 2).rotateY(Math.PI / 6));
  for (const c of cities) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xef4444, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide
    }));
    const p = toWorld(c.q, c.r);
    m.position.set(p.x, hexTop(hk(c.q, c.r)) + 0.03, p.z);
    m.renderOrder = 13;
    idleGroup.add(m);
    threatRings.push(m);
  }
}

function stepIdleMarkers(now) {
  for (const m of threatRings) {
    m.material.opacity = 0.45 + Math.sin(now / 280) * 0.35;
    const s = 1 + Math.sin(now / 280) * 0.04;
    m.scale.set(s, 1, s);
  }
  for (const m of idleMarkers) {
    m.position.y = m.userData.base + Math.sin(now / 260 + m.userData.phase) * 0.06;
    m.rotation.y = now / 600;
  }
}

// --- Gebäude-Umgebung -------------------------------------------------------------

const HEX_R = HEX_SIZE * TILE_GAP;            // Eckradius eines Feldes
const HEX_A = HEX_R * Math.sqrt(3) / 2;       // Abstand Mitte–Kante
const DIR_VEC = DIRS.map(([dq, dr]) => { const p = toWorld(dq, dr); const l = Math.hypot(p.x, p.z); return [p.x / l, p.z / l]; });

// Straßenarme und (für den Hafen) Richtungen mit begehbarem Land.
function tileEnv(state, key, imp) {
  const [q, r] = key.split(',').map(Number);
  const arms = [];
  if (roadAt(state, q, r)) DIRS.forEach(([dq, dr], d) => { if (onRoadNet(state, q + dq, r + dr)) arms.push(d); });
  const env = {
    arms, road: roadAt(state, q, r),
    terrain: state.terrain[r * MAP_W + q],
    occupied: state.units.some(u => u.q === q && u.r === r)
  };
  if (imp === 'port') {
    env.land = [];
    DIRS.forEach(([dq, dr], d) => {
      const nq = q + dq, nr = r + dr;
      if (nq < 0 || nr < 0 || nq >= MAP_W || nr >= MAP_H) return;
      if (TERRAIN[state.terrain[nr * MAP_W + nq]].walkable) env.land.push(d);
    });
  }
  return env;
}

function insideHex(x, z, a = HEX_A) {
  const ax = Math.abs(x), az = Math.abs(z);
  return ax <= a && ax * 0.5 + az * (Math.sqrt(3) / 2) <= a;
}

// Liegt der Punkt auf einer Straße (Arm oder Mittelstück)?
function onRoadPath(x, z, env, width = 0.13) {
  if (!env.road) return false;
  if (Math.hypot(x, z) < 0.17) return true;
  for (const d of env.arms || []) {
    const [ux, uz] = DIR_VEC[d];
    const along = x * ux + z * uz, across = Math.abs(x * uz - z * ux);
    if (along > -0.05 && across < width) return true;
  }
  return false;
}

// Platz für ein Gebäude: Mitte, oder bei Straßen die Ecke mit dem größten
// Abstand zu allen Straßenarmen.
function buildingSpot(env) {
  // Mitte nur, wenn dort nichts anderes steht: Straße, Einheit, Bäume, Berggipfel.
  const crowded = env.road || env.occupied || env.terrain === 'forest' || env.terrain === 'mountain';
  if (!crowded) return [0, 0, 1];
  let best = null;
  for (let k = 0; k < 6; k++) {
    const ang = Math.PI / 6 + k * Math.PI / 3;
    const vx = Math.cos(ang), vz = Math.sin(ang);
    const gap = Math.min(Math.PI, ...(env.arms || []).map(d => Math.acos(Math.max(-1, Math.min(1, vx * DIR_VEC[d][0] + vz * DIR_VEC[d][1])))));
    // Auf Bergen außerhalb des Gipfels (Radius 0,52), sonst etwas näher zur Mitte.
    const rad = env.terrain === 'mountain' ? 0.64 : 0.42;
    if (!best || gap > best.gap) best = { x: vx * rad, z: vz * rad, gap };
  }
  return [best.x, best.z, env.terrain === 'mountain' ? 0.75 : 0.85];
}

// Acker über das ganze Feld: Furchen (Erde) mit Pflanzen, Feldweg wo die
// Straße durchläuft. Instanziert, damit viele Felder billig bleiben.
function farmNode(env) {
  const g = new THREE.Group();
  const soil = [], crops = [];
  const margin = HEX_A - 0.05;
  for (let z = -0.78; z <= 0.78; z += 0.105) {
    let start = null;
    const flush = xEnd => {
      if (start != null && xEnd - start > 0.06) soil.push([start, xEnd, z]);
      start = null;
    };
    for (let x = -0.9; x <= 0.9; x += 0.02) {
      const ok = insideHex(x, z, margin) && !onRoadPath(x, z, env);
      if (ok && start == null) start = x;
      if (!ok) flush(x);
    }
    flush(0.9);
  }
  const soilMat = mat(0x7a5230);
  const soilGeo = geo('fmRow', () => new THREE.BoxGeometry(1, 0.025, 0.06));
  const rows = new THREE.InstancedMesh(soilGeo, soilMat, soil.length);
  const m4 = new THREE.Matrix4();
  soil.forEach(([x0, x1, z], i) => {
    m4.compose(new THREE.Vector3((x0 + x1) / 2, 0.0125, z), new THREE.Quaternion(), new THREE.Vector3(x1 - x0, 1, 1));
    rows.setMatrixAt(i, m4);
    for (let x = x0 + 0.03; x < x1 - 0.02; x += 0.07) crops.push([x, z]);
  });
  rows.receiveShadow = true;
  g.add(rows);
  const cropGeo = geo('fmCrop', () => new THREE.ConeGeometry(0.024, 0.06, 4));
  const plants = new THREE.InstancedMesh(cropGeo, mat(0x6fbf3f), crops.length);
  const tint = new THREE.Color();
  crops.forEach(([x, z], i) => {
    m4.makeTranslation(x, 0.055, z);
    plants.setMatrixAt(i, m4);
    plants.setColorAt(i, tint.setHex((Math.round(x * 50) + Math.round(z * 30)) % 3 ? 0x6fbf3f : 0x54a63a));
  });
  plants.castShadow = true;
  g.add(plants);
  return g;
}

// Hafen: Kaimauern bis auf Landhöhe an den Landseiten, niedrige Molen zum
// Wasser, eine Einfahrt zur offenen See – in der Mitte das Hafenbecken, in
// dem die Schiffe liegen. Stege überbrücken die Fuge zum Land.
function portNode(env) {
  const g = new THREE.Group();
  const land = new Set(env.land || []);
  const quayH = Math.max(0.12, TERRAIN.field.height - env.base);
  const stone = mat(0xa8a29e), wood = mat(0x8a5a33);
  // Einfahrt: die Wasserseite gegenüber dem Land (Mittel der Landrichtungen).
  let mx = 0, mz = 0;
  for (const d of land) { mx += DIR_VEC[d][0]; mz += DIR_VEC[d][1]; }
  let open = -1, bestDot = Infinity;
  for (let d = 0; d < 6; d++) {
    if (land.has(d)) continue;
    const dot = DIR_VEC[d][0] * mx + DIR_VEC[d][1] * mz;
    if (dot < bestDot) { bestDot = dot; open = d; }
  }
  const edgeLen = HEX_R * 0.98;
  for (let d = 0; d < 6; d++) {
    if (d === open) continue;
    const [ux, uz] = DIR_VEC[d];
    const isLand = land.has(d);
    const h = isLand ? quayH : 0.1;
    const depth = isLand ? 0.2 : 0.09;
    const wall = new THREE.Mesh(geo(`ptWall${isLand}|${h.toFixed(3)}`, () => new THREE.BoxGeometry(edgeLen, h, depth)), stone);
    const dist = HEX_A - depth / 2 + (isLand ? 0.04 : 0);
    wall.position.set(ux * dist, h / 2, uz * dist);
    wall.rotation.y = -Math.atan2(uz, ux) + Math.PI / 2;
    wall.castShadow = true; wall.receiveShadow = true;
    g.add(wall);
    if (isLand) {
      // Steg vom Kai ins Becken.
      const pier = new THREE.Mesh(geo('ptPier', () => new THREE.BoxGeometry(0.34, 0.03, 0.1)), wood);
      const pd = HEX_A - 0.32;
      pier.position.set(ux * pd, Math.min(h, 0.14), uz * pd);
      pier.rotation.y = -Math.atan2(uz, ux);
      g.add(pier);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(geo('ptPost', () => new THREE.CylinderGeometry(0.015, 0.015, 0.2, 5)), wood);
        post.position.set(ux * (pd - 0.14) - uz * side * 0.05, 0.06, uz * (pd - 0.14) + ux * side * 0.05);
        g.add(post);
      }
    }
  }
  // Lagerhaus und Kran auf der ersten Landseite (sonst auf einer Mole).
  const home = land.size ? [...land][0] : (open + 3) % 6;
  const [hx, hz] = DIR_VEC[home];
  const top = land.size ? quayH : 0.1;
  const shed = new THREE.Mesh(geo('ptShed', () => new THREE.BoxGeometry(0.2, 0.13, 0.13)), mat(0x6b4a2b));
  const sd = HEX_A - 0.1;
  shed.position.set(hx * sd + hz * 0.2, top + 0.065, hz * sd - hx * 0.2);
  shed.rotation.y = -Math.atan2(hz, hx) + Math.PI / 2;
  shed.castShadow = true;
  g.add(shed);
  const roof = new THREE.Mesh(geo('ptRoof2', () => new THREE.ConeGeometry(0.15, 0.08, 4)), mat(0x9c6b3a));
  roof.position.set(shed.position.x, top + 0.17, shed.position.z);
  roof.rotation.y = Math.PI / 4 + shed.rotation.y;
  g.add(roof);
  const mast = new THREE.Mesh(geo('ptCrane', () => new THREE.BoxGeometry(0.03, 0.34, 0.03)), wood);
  mast.position.set(hx * sd - hz * 0.22, top + 0.17, hz * sd + hx * 0.22);
  g.add(mast);
  const arm = new THREE.Mesh(geo('ptArm', () => new THREE.BoxGeometry(0.26, 0.025, 0.025).translate(-0.1, 0, 0)), wood);
  arm.position.set(mast.position.x, top + 0.33, mast.position.z);
  arm.rotation.y = -Math.atan2(hz, hx);
  g.add(arm);
  return g;
}

// Größe im Verhältnis zu Städten, Einheiten und Monumenten angleichen.
const BUILDING_SCALE = { temple: 1.5, market: 1.6, forge: 1.35, sawmill: 1.3, mine: 1.3, mill: 1.2, monastery: 1.35 };

function improvementNode(type, env = {}) {
  if (type === 'farm') return farmNode(env);
  if (type === 'port') return portNode(env);
  const g = buildingNode(type);
  // Gebäude weichen Straßen, Einheiten, Bäumen und Gipfeln aus.
  const [x, z, sc] = buildingSpot(env);
  g.position.set(x, 0, z);
  g.scale.setScalar(sc * (BUILDING_SCALE[type] || 1));
  const wrap = new THREE.Group();
  wrap.add(g);
  return wrap;
}

function buildingNode(type) {
  const g = new THREE.Group();
  if (type === 'airfield') {
    // Ballonplatz: runde Startfläche aus Steinplatten, Ankermast mit Windfahne, Hütte.
    const pad = new THREE.Mesh(geo('afPad', () => new THREE.CylinderGeometry(0.34, 0.36, 0.03, 16)), mat(0xc8c2b4));
    pad.position.y = 0.015;
    pad.receiveShadow = true;
    g.add(pad);
    const ring = new THREE.Mesh(geo('afRing', () => new THREE.TorusGeometry(0.27, 0.015, 4, 24)), mat(0x8a8f98));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.035;
    g.add(ring);
    const pole = new THREE.Mesh(geo('afPole', () => new THREE.CylinderGeometry(0.018, 0.024, 0.5, 6)), mat(0x6b4a2b));
    pole.position.set(0.3, 0.25, -0.12);
    g.add(pole);
    const flag = new THREE.Mesh(geo('afFlag', () => new THREE.ConeGeometry(0.04, 0.16, 4)), mat(0xf59e0b));
    flag.rotation.z = -Math.PI / 2;
    flag.position.set(0.38, 0.46, -0.12);
    g.add(flag);
    const hut = new THREE.Mesh(geo('afHut', () => new THREE.BoxGeometry(0.14, 0.1, 0.12)), mat(0x8a5a33));
    hut.position.set(-0.3, 0.05, 0.14);
    g.add(hut);
    const roof = new THREE.Mesh(geo('afRoof', () => new THREE.ConeGeometry(0.11, 0.07, 4)), mat(0x9c6b3a));
    roof.rotation.y = Math.PI / 4;
    roof.position.set(-0.3, 0.135, 0.14);
    g.add(roof);
  } else if (type === 'mill') {
    // Windmühle: gemauerter Turm, Kegeldach, vier Flügel.
    const tower = new THREE.Mesh(geo('mlTower', () => new THREE.CylinderGeometry(0.1, 0.14, 0.34, 8)), mat(0xe7e2d6));
    tower.position.y = 0.17;
    g.add(tower);
    const roof = new THREE.Mesh(geo('mlRoof', () => new THREE.ConeGeometry(0.13, 0.12, 8)), mat(0x9c6b3a));
    roof.position.y = 0.4;
    g.add(roof);
    const hub = new THREE.Group();
    hub.position.set(0, 0.32, 0.13);
    hub.rotation.z = 0.4;
    g.add(hub);
    for (let k = 0; k < 4; k++) {
      const arm = new THREE.Mesh(geo('mlSail', () => new THREE.BoxGeometry(0.05, 0.26, 0.01).translate(0, 0.14, 0)), mat(0xf5f0e6));
      arm.rotation.z = k * Math.PI / 2;
      hub.add(arm);
    }
    const door = new THREE.Mesh(geo('mlDoor', () => new THREE.BoxGeometry(0.05, 0.08, 0.01)), mat(WOOD_DARK));
    door.position.set(0, 0.04, 0.135);
    g.add(door);
  } else if (type === 'forge') {
    // Schmelzhütte: Steinofen mit glühender Öffnung, Schornstein, Amboss.
    const base = new THREE.Mesh(geo('fgBase', () => new THREE.BoxGeometry(0.28, 0.14, 0.22)), mat(0x78716c));
    base.position.y = 0.07;
    g.add(base);
    const roof = new THREE.Mesh(geo('fgRoof', () => new THREE.BoxGeometry(0.3, 0.04, 0.24)), mat(0x57534e));
    roof.position.y = 0.16;
    g.add(roof);
    const chim = new THREE.Mesh(geo('fgChim', () => new THREE.CylinderGeometry(0.035, 0.045, 0.24, 6)), mat(0x57534e));
    chim.position.set(-0.08, 0.28, -0.05);
    g.add(chim);
    const glow = new THREE.Mesh(geo('fgGlow', () => new THREE.BoxGeometry(0.08, 0.06, 0.01)), new THREE.MeshBasicMaterial({ color: 0xff8a1f }));
    glow.position.set(0.04, 0.06, 0.111);
    g.add(glow);
    const anvil = new THREE.Mesh(geo('fgAnvil', () => new THREE.BoxGeometry(0.08, 0.05, 0.04)), mat(0x3f3f46));
    anvil.position.set(0.12, 0.025, 0.16);
    g.add(anvil);
  } else if (type === 'market') {
    // Markt: drei Stände mit gestreiften Planen und Kisten.
    const cols = [0xdc2626, 0xf59e0b, 0x2563eb];
    [[-0.14, -0.06], [0.12, -0.1], [0, 0.12]].forEach(([x, z], i) => {
      const table = new THREE.Mesh(geo('mkTable', () => new THREE.BoxGeometry(0.14, 0.05, 0.09)), mat(WOOD));
      table.position.set(x, 0.08, z);
      g.add(table);
      for (const dx of [-0.06, 0.06]) {
        const post = new THREE.Mesh(geo('mkPost', () => new THREE.BoxGeometry(0.012, 0.18, 0.012)), mat(WOOD_DARK));
        post.position.set(x + dx, 0.09, z - 0.04);
        g.add(post);
      }
      const awning = new THREE.Mesh(geo('mkAwn', () => new THREE.BoxGeometry(0.16, 0.012, 0.12)), mat(cols[i]));
      awning.position.set(x, 0.185, z);
      awning.rotation.x = 0.25;
      g.add(awning);
      const goods = new THREE.Mesh(geo('mkGood', () => new THREE.BoxGeometry(0.04, 0.03, 0.04)), mat(i === 1 ? 0x65a30d : 0xd97706));
      goods.position.set(x - 0.03, 0.12, z);
      g.add(goods);
    });
  } else if (type === 'fort') {
    // Burg: Steinmauer mit Zinnen, vier Ecktürme, Bergfried.
    const stone = mat(0xa8a29e), dark = mat(0x78716c);
    for (const [x, z, w, d] of [[0, -0.2, 0.44, 0.06], [0, 0.2, 0.44, 0.06], [-0.2, 0, 0.06, 0.44], [0.2, 0, 0.06, 0.44]]) {
      const wall = new THREE.Mesh(geo(`ftWall${w}`, () => new THREE.BoxGeometry(w, 0.14, d)), stone);
      wall.position.set(x, 0.07, z);
      g.add(wall);
    }
    for (const x of [-0.2, 0.2]) for (const z of [-0.2, 0.2]) {
      const tw = new THREE.Mesh(geo('ftTower', () => new THREE.CylinderGeometry(0.06, 0.07, 0.22, 8)), stone);
      tw.position.set(x, 0.11, z);
      g.add(tw);
      const cap = new THREE.Mesh(geo('ftCap', () => new THREE.ConeGeometry(0.075, 0.08, 8)), dark);
      cap.position.set(x, 0.26, z);
      g.add(cap);
    }
    const keep = new THREE.Mesh(geo('ftKeep', () => new THREE.BoxGeometry(0.14, 0.26, 0.14)), stone);
    keep.position.y = 0.13;
    g.add(keep);
    const gate = new THREE.Mesh(geo('ftGate', () => new THREE.BoxGeometry(0.08, 0.09, 0.01)), mat(WOOD_DARK));
    gate.position.set(0, 0.045, 0.231);
    g.add(gate);
  } else if (type === 'monastery') {
    // Kloster: Kirchenschiff, Glockenturm, Kreuzgangmauer.
    const nave = new THREE.Mesh(geo('moNave', () => new THREE.BoxGeometry(0.3, 0.14, 0.14)), mat(0xf1ece1));
    nave.position.set(0, 0.07, -0.04);
    g.add(nave);
    const roof = new THREE.Mesh(geo('moRoof', () => new THREE.CylinderGeometry(0.0, 0.1, 0.3, 4, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 4)), mat(0x9c4a3a));
    roof.position.set(0, 0.17, -0.04);
    roof.scale.set(1, 0.7, 1);
    g.add(roof);
    const bell = new THREE.Mesh(geo('moBell', () => new THREE.BoxGeometry(0.08, 0.3, 0.08)), mat(0xe7e2d6));
    bell.position.set(0.17, 0.15, -0.04);
    g.add(bell);
    const spire = new THREE.Mesh(geo('moSpire', () => new THREE.ConeGeometry(0.06, 0.12, 4)), mat(0x9c4a3a));
    spire.rotation.y = Math.PI / 4;
    spire.position.set(0.17, 0.36, -0.04);
    g.add(spire);
    const wall = new THREE.Mesh(geo('moWall', () => new THREE.BoxGeometry(0.32, 0.06, 0.02)), mat(0xd6cfc0));
    wall.position.set(0, 0.03, 0.14);
    g.add(wall);
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
    // Stolleneingang mit Holzrahmen, Schienen und einer Lore voll Erz – hebt sich vom grauen Fels ab.
    const timber = mat(WOOD), dark = mat(0x1c1917);
    const hole = new THREE.Mesh(geo('mHole2', () => new THREE.BoxGeometry(0.16, 0.16, 0.04)), dark);
    hole.position.set(0, 0.08, -0.06);
    g.add(hole);
    for (const x of [-0.1, 0.1]) {
      const post = new THREE.Mesh(geo('mPost', () => new THREE.BoxGeometry(0.04, 0.2, 0.04)), timber);
      post.position.set(x, 0.1, -0.04);
      g.add(post);
    }
    const beam = new THREE.Mesh(geo('mBeam', () => new THREE.BoxGeometry(0.26, 0.045, 0.05)), timber);
    beam.position.set(0, 0.215, -0.04);
    g.add(beam);
    for (const x of [-0.04, 0.04]) {
      const rail = new THREE.Mesh(geo('mRail', () => new THREE.BoxGeometry(0.015, 0.012, 0.24)), mat(0x52525b));
      rail.position.set(x, 0.006, 0.08);
      g.add(rail);
    }
    const cart = new THREE.Mesh(geo('mCart', () => new THREE.BoxGeometry(0.12, 0.07, 0.09)), mat(WOOD_DARK));
    cart.position.set(0, 0.05, 0.12);
    g.add(cart);
    for (const [x, z] of [[-0.03, 0.11], [0.03, 0.13], [0, 0.12]]) {
      const ore = new THREE.Mesh(geo('mOre2', () => new THREE.OctahedronGeometry(0.035, 0)), mat(0xd9a13b));
      ore.position.set(x, 0.1, z);
      g.add(ore);
    }
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
  } else if (MONUMENTS[type]) {
    // Monument: gestufter Sockel, Säule und ein Wahrzeichen in eigener Farbe.
    const stone = mat(0xe7e2d6), accent = mat(MONUMENTS[type].color);
    const s1 = new THREE.Mesh(geo('mnStep1', () => new THREE.CylinderGeometry(0.3, 0.33, 0.06, 6)), stone);
    s1.position.y = 0.03;
    const s2 = new THREE.Mesh(geo('mnStep2', () => new THREE.CylinderGeometry(0.22, 0.25, 0.06, 6)), stone);
    s2.position.y = 0.09;
    const col = new THREE.Mesh(geo('mnCol', () => new THREE.CylinderGeometry(0.07, 0.09, 0.42, 6)), stone);
    col.position.y = 0.33;
    const cap = new THREE.Mesh(geo('mnCap', () => new THREE.BoxGeometry(0.2, 0.04, 0.2)), accent);
    cap.position.y = 0.56;
    g.add(s1, s2, col, cap);
    const emblems = {
      m_wisdom: () => new THREE.SphereGeometry(0.09, 10, 8),
      m_valor: () => new THREE.ConeGeometry(0.07, 0.24, 4),
      m_eye: () => new THREE.TorusGeometry(0.08, 0.03, 6, 14),
      m_treasury: () => new THREE.BoxGeometry(0.15, 0.11, 0.11),
      m_park: () => new THREE.IcosahedronGeometry(0.11, 0),
      m_palace: () => new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)
    };
    const em = new THREE.Mesh(geo('mnEm' + type, emblems[type]), accent);
    em.position.y = type === 'm_palace' ? 0.58 : 0.67;
    g.add(em);
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
          trunk.userData.trunkScale = sc;
          trunk.castShadow = true;
          trunk.userData.tree = [trunk.position.x, trunk.position.z];
          mesh.add(trunk);
          decor.push(trunk);
          const foliage = new THREE.Mesh(foliageGeo, rnd() < 0.5 ? foliageMat : foliageMat2);
          foliage.position.set(sp[0] + jx, def.height / 2 + 0.45 * sc, sp[1] + jz);
          foliage.scale.set(sc, sc, sc);
          foliage.castShadow = true;
          foliage.userData.tree = [foliage.position.x, foliage.position.z];
          foliage.userData.size = sc;
          mesh.add(foliage);
          decor.push(foliage);
        }
      } else if (t === 'mountain') {
        const peak = new THREE.Mesh(peakGeo, peakMat);
        peak.position.y = def.height / 2 + 0.41;
        peak.rotation.y = 0.4;
        peak.castShadow = true;
        peak.userData.peak = true;
        mesh.add(peak);
        decor.push(peak);
        const snow = new THREE.Mesh(snowGeo, snowMat);
        snow.position.y = def.height / 2 + 0.68;
        snow.castShadow = true;
        snow.userData.snow = true;
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
      const imp = state.improvements ? state.improvements[hk(q, r)] : null;
      syncImprovement(tiles.get(hk(q, r)), imp, imp ? tileEnv(state, hk(q, r), imp) : {});
    }
  }
}

// Gebäude auf einer Kachel an den Spielstand anpassen (auch für Gebäude,
// die erst während der Partie gebaut werden).
// Gebäude passen sich der Umgebung an: Felder und Gebäude lassen Straßen frei,
// der Hafen baut Kaimauern und Stege zum angrenzenden Land.
function syncImprovement(t, imp, env = {}) {
  if (!t) return;
  const sig = imp ? `${imp}|${env.terrain || ''}|${(env.arms || []).join('')}|${imp === 'port' ? (env.land || []).join('') : ''}|${env.occupied ? 'u' : ''}` : '';
  if ((t.impSig || '') === sig) return;
  if (t.impNode) {
    t.mesh.remove(t.impNode);
    t.decor = t.decor.filter(d => d !== t.impNode);
    t.impNode = null;
  }
  t.imp = imp || null;
  t.impSig = sig;
  if (!imp) return;
  const inode = improvementNode(imp, { ...env, base: TERRAIN[t.terrain].height });
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
  for (const g of lightNodes.values()) scene.remove(g);
  lightNodes.clear();
  // Laufende Animationen beenden, damit wartende Promises nicht hängen.
  const pending = tweens;
  tweens = [];
  for (const tw of pending) {
    try { tw.resolve?.(); } catch (e) { /* Knoten bereits entfernt */ }
  }
}

let boardSignature = null;
// Karte beim nächsten syncBoard komplett neu aufbauen (z. B. nach Admin-Änderungen
// an Rohstoffen, die die Signatur nicht erfasst).
export function invalidateBoard() {
  boardSignature = null;
}

function terrainSignature(state) {
  return MAP_W + 'x' + MAP_H + ':' + state.terrain.join('|');
}

function hexTop(key) {
  const t = tiles.get(key);
  return t ? t.top : 0.5;
}

// Standhöhe einer Einheit: Landeinheiten (und Luft) stehen auf dem Brückendeck,
// Schiffe fahren darunter durch.
const BRIDGE_DECK = 0.635;
function unitTop(key, type) {
  const t = tiles.get(key);
  if (t && t.bridgeNode && !hasAbility(type, 'water')) return Math.max(t.top, BRIDGE_DECK);
  if (t && t.bridgeNode) return hexTop(key) - 0.07;
  return hexTop(key);
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

// Lebensanzeige als Plakette in Teamfarbe. Die Schrift wird je nach
// Helligkeit schwarz oder weiß, ein dunkler Rand hebt sie auch auf grünem
// Gelände ab. Gold = Veteran, Rot = kaum noch Leben.
function luminance(c) {
  const r = (c >> 16 & 255) / 255, g = (c >> 8 & 255) / 255, b = (c & 255) / 255;
  const lin = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function drawHp(sprite, hp, vet = false, color = 0x18181b) {
  const { canvas, texture } = sprite.userData;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 64);
  const x = vet ? 10 : 22, w = vet ? 108 : 84;
  roundRect(ctx, x, 8, w, 48, 14);
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = hp <= 3 ? '#dc2626' : vet ? '#facc15' : 'rgba(9,9,11,0.9)';
  ctx.stroke();
  const light = luminance(color) > 0.35;
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = light ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)';
  const text = String(hp);
  const tx = vet ? 76 : 64;
  ctx.strokeText(text, tx, 33);
  ctx.fillStyle = light ? '#09090b' : '#ffffff';
  ctx.fillText(text, tx, 33);
  // Veteranen: gezeichneter Stern statt Schriftzeichen.
  if (vet) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? 6.5 : 15;
      ctx.lineTo(36 + Math.cos(a) * rad, 32 + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fillStyle = '#facc15';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(9,9,11,0.8)';
    ctx.stroke();
    ctx.fill();
  }
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

// --- Einheitenmodelle ------------------------------------------------------------
// Alle Modelle blicken in +x-Richtung (für das Drehen in Lauf-/Angriffsrichtung).
// Waffen, Schilde und Segel hängen an Händen bzw. Masten, nichts schwebt frei.

const SKIN = 0xe8c39a, DARK = 0x3f3f46, WOOD = 0x8a5a33, WOOD_DARK = 0x5c3d22, STEEL = 0xd9dee5, IRON = 0x7d838c;
const box = (w, h, d) => geo(`box${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, seg = 6) => geo(`cyl${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const cone = (r, h, seg = 6) => geo(`cone${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg));
const ico = r => geo(`ico${r}`, () => new THREE.IcosahedronGeometry(r, 0));

// Wer mitfährt: eingeschiffte Landeinheit im Boot oder Fracht im Lastenballon.
function passengerOf(u) {
  return u.carry || (u.cargo && u.cargo.type) || null;
}

const PLUME = { red: 0xdc2626, white: 0xf5f5f4, gold: 0xeab308 };

function unitBody(type, color, passenger = null, plume = null) {
  const g = new THREE.Group();
  const teamMats = [];
  const teamMat = () => {
    const m = freshMat(color);
    teamMats.push(m);
    return m;
  };
  const put = (parent, geometry, material, x, y, z) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // Figur mit Beinen, Rumpf, Kopf und zwei Armen. Gibt die Hand-Gruppen
  // zurück: Was dort angehängt wird, steht aufrecht und sitzt in der Hand.
  const person = ({ y0 = 0, scale = 1, legs = true, robe = false, armR = 0.7, armL = 0.7, torso = null } = {}) => {
    const p = new THREE.Group();
    p.position.y = y0;
    p.scale.setScalar(scale);
    g.add(p);
    if (legs && !robe) {
      for (const z of [-0.05, 0.05]) put(p, box(0.07, 0.17, 0.07), mat(DARK), 0, 0.085, z);
    }
    if (robe) put(p, cone(0.17, 0.42, 7), torso || teamMat(), 0, 0.21, 0);
    else put(p, cyl(0.1, 0.12, 0.24), torso || teamMat(), 0, 0.29, 0);
    put(p, ico(0.085), mat(SKIN), 0, 0.49, 0);
    // Helmbusch (Kosmetik) über dem Kopf.
    if (plume && PLUME[plume]) put(p, cone(0.035, 0.14, 4), mat(PLUME[plume]), -0.02, 0.7, 0).rotation.z = 0.35;
    const hand = (side, swing) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0, 0.38, 0.15 * side);
      shoulder.rotation.z = swing;
      p.add(shoulder);
      put(shoulder, box(0.055, 0.2, 0.055), teamMat(), 0, -0.1, 0);
      const h = new THREE.Group();
      h.position.set(0, -0.2, 0);
      h.rotation.z = -swing; // Hand-Raum wieder aufrecht
      shoulder.add(h);
      return h;
    };
    return { p, right: hand(1, armR), left: hand(-1, armL), headY: 0.49 };
  };
  const helmet = (pp, c = 0xc3c8d0, h = 0.14) => put(pp.p, cone(0.1, h, 6), mat(c), 0, pp.headY + 0.08, 0);
  const sword = (hand, len = 0.32) => {
    const blade = put(hand, box(len, 0.035, 0.03), mat(STEEL), len / 2 + 0.02, 0, 0);
    put(hand, box(0.025, 0.03, 0.1), mat(WOOD_DARK), 0.01, 0, 0);
    hand.rotation.z += 0.6; // Klinge schräg nach oben
    return blade;
  };
  const spear = (hand, len = 0.6) => {
    put(hand, box(0.025, len, 0.025), mat(WOOD), 0, len * 0.3, 0);
    put(hand, cone(0.035, 0.09, 4), mat(STEEL), 0, len * 0.8 + 0.04, 0);
  };
  const horse = c => {
    put(g, box(0.44, 0.17, 0.17), mat(c), 0, 0.3, 0);
    for (const x of [-0.16, 0.16]) for (const z of [-0.06, 0.06]) put(g, box(0.05, 0.23, 0.05), mat(c), x, 0.115, z);
    const neck = put(g, box(0.09, 0.2, 0.09), mat(c), 0.2, 0.43, 0);
    neck.rotation.z = -0.5;
    put(g, box(0.17, 0.08, 0.08), mat(c), 0.3, 0.52, 0);
    put(g, box(0.1, 0.04, 0.04), mat(DARK), -0.25, 0.34, 0).rotation.z = 0.6;
  };
  // Kleine Mitfahrer-Figur (Rumpf in Teamfarbe, Kopf, Helm) auf Deck oder im Korb.
  const rider = (y, x) => {
    put(g, box(0.07, 0.11, 0.08), teamMat(), x, y + 0.055, 0);
    put(g, ico(0.035), mat(SKIN), x, y + 0.14, 0);
    put(g, cone(0.04, 0.05, 6), mat(0x9ca3af), x, y + 0.18, 0);
  };
  const hull = (len, wid, h, c) => {
    put(g, box(len, h, wid), mat(c), 0, h / 2 + 0.02, 0);
    const bow = put(g, cone(wid / 2, wid * 0.8, 4), mat(c), len / 2 + wid * 0.35, h / 2 + 0.02, 0);
    bow.rotation.z = -Math.PI / 2;
    bow.rotation.x = Math.PI / 4;
    bow.scale.set(1, 1, h / wid * 1.4);
    return h + 0.02;
  };
  // Masten stehen auf einem Gelenk am Fuß: unter Brücken werden sie umgelegt.
  const masts = [];
  const mast = (x, base, h, sailW, sailH) => {
    const hinge = new THREE.Group();
    hinge.position.set(x, base, 0);
    g.add(hinge);
    put(hinge, cyl(0.018, 0.022, h, 5), mat(WOOD_DARK), 0, h / 2, 0);
    put(hinge, box(0.02, sailH, sailW), teamMat(), 0.025, h - sailH / 2 - 0.04, 0);
    masts.push(hinge);
    return hinge;
  };

  if (type === 'warrior') {
    const pp = person();
    helmet(pp);
    sword(pp.right, 0.26);
    put(pp.left, cyl(0.1, 0.1, 0.025, 8), mat(WOOD), 0.03, 0.02, 0).rotation.z = Math.PI / 2;
  } else if (type === 'archer') {
    const pp = person({ armL: 1.2 });
    put(pp.p, cone(0.1, 0.13, 6), mat(0x4d7c3a), 0, pp.headY + 0.07, 0);
    // Bogen senkrecht in der linken Hand, Wölbung nach vorn.
    // Nach der Drehung liegt der Griff (Bogenmitte) bei +r: um -r versetzen,
    // damit er genau in der Hand sitzt; die Sehne verbindet die Enden.
    const r = 0.17;
    const bow = put(pp.left, geo('bowArc', () => new THREE.TorusGeometry(r, 0.015, 4, 10, Math.PI)), mat(WOOD), -r + 0.03, 0, 0);
    bow.rotation.z = -Math.PI / 2;
    put(pp.left, box(0.006, r * 2, 0.006), mat(0xeeeeee), -r + 0.03, 0, 0);
    // Köcher auf dem Rücken.
    put(pp.p, cyl(0.04, 0.035, 0.22, 6), mat(WOOD_DARK), -0.12, 0.33, 0.04).rotation.z = 0.3;
  } else if (type === 'rider') {
    horse(0x7a5230);
    const pp = person({ y0: 0.27, legs: false });
    spear(pp.right, 0.55);
  } else if (type === 'defender') {
    const pp = person({ armL: 1.0 });
    helmet(pp, 0x9ca3af, 0.12);
    put(pp.left, box(0.04, 0.32, 0.26), teamMat(), 0.04, 0.04, 0.05);
    spear(pp.right, 0.62);
  } else if (type === 'swordsman') {
    const pp = person({ scale: 1.15, torso: mat(IRON) });
    helmet(pp, 0xc3c8d0, 0.16);
    for (const z of [-0.12, 0.12]) put(pp.p, box(0.12, 0.05, 0.08), teamMat(), 0, 0.4, z);
    put(pp.p, box(0.13, 0.12, 0.18), teamMat(), 0.02, 0.26, 0); // Wappenrock
    sword(pp.right, 0.4);
  } else if (type === 'pikeman') {
    const pp = person({ armR: 0.2 });
    put(pp.p, cyl(0.13, 0.13, 0.02, 8), mat(0x9ca3af), 0, pp.headY + 0.06, 0); // Eisenhut mit Krempe
    put(pp.p, cone(0.08, 0.08, 8), mat(0x9ca3af), 0, pp.headY + 0.1, 0);
    put(pp.p, box(0.13, 0.16, 0.19), teamMat(), 0.01, 0.27, 0); // Wappenrock
    // Lange Pike, schräg nach vorn gesenkt.
    put(pp.right, box(0.025, 1.0, 0.025), mat(WOOD), 0, 0.3, 0);
    put(pp.right, cone(0.03, 0.12, 4), mat(STEEL), 0, 0.85, 0);
    pp.right.rotation.z -= 0.55;
  } else if (type === 'crossbow') {
    const pp = person({ armL: 1.4, armR: 1.4 });
    put(pp.p, cone(0.11, 0.1, 6), mat(0x6b4a2b), 0, pp.headY + 0.06, 0); // Kappe
    put(pp.p, box(0.13, 0.15, 0.19), teamMat(), 0.01, 0.27, 0);
    // Armbrust waagerecht vor dem Körper: Schaft und quer liegender Bogen.
    const xb = new THREE.Group();
    xb.position.set(0.17, 0.36, 0);
    g.add(xb);
    put(xb, box(0.26, 0.04, 0.04), mat(WOOD_DARK), 0, 0, 0);
    put(xb, box(0.03, 0.03, 0.24), mat(STEEL), 0.11, 0, 0);
    put(xb, box(0.005, 0.005, 0.22), mat(0xeeeeee), 0.02, 0.01, 0);
    put(pp.p, cyl(0.035, 0.03, 0.18, 6), mat(WOOD_DARK), -0.11, 0.3, 0.06).rotation.z = 0.25; // Bolzenköcher
  } else if (type === 'paladin') {
    horse(0xd6d3d1);
    // Pferdedecke in Teamfarbe, bis fast zum Boden.
    put(g, box(0.36, 0.14, 0.21), teamMat(), 0, 0.26, 0);
    const pp = person({ y0: 0.29, legs: false, torso: mat(STEEL) });
    helmet(pp, STEEL, 0.19);
    put(pp.p, cone(0.03, 0.1, 4), teamMat(), 0, pp.headY + 0.22, 0); // Helmbusch
    put(pp.right, box(0.68, 0.035, 0.035), mat(0xf0f3f7), 0.22, 0, 0);
    put(pp.right, cone(0.04, 0.11, 4), mat(STEEL), 0.6, 0, 0).rotation.z = -Math.PI / 2;
    put(pp.left, box(0.03, 0.22, 0.17), mat(0xf5f5f4), 0.03, 0, 0); // Schild mit Kreuz
    put(pp.left, box(0.035, 0.16, 0.035), teamMat(), 0.035, 0, 0);
    put(pp.left, box(0.035, 0.035, 0.12), teamMat(), 0.035, 0.03, 0);
  } else if (type === 'catapult') {
    put(g, box(0.46, 0.08, 0.3), mat(WOOD), 0, 0.13, 0);
    put(g, box(0.4, 0.02, 0.22), teamMat(), 0, 0.18, 0);
    for (const x of [-0.15, 0.15]) for (const z of [-0.17, 0.17]) {
      put(g, cyl(0.08, 0.08, 0.04, 8), mat(0x4a4038), x, 0.08, z).rotation.x = Math.PI / 2;
    }
    for (const z of [-0.09, 0.09]) put(g, box(0.05, 0.2, 0.04), mat(WOOD_DARK), 0, 0.27, z);
    // Wurfarm mit Schale und Stein – gespannt nach hinten geneigt.
    const arm = new THREE.Group();
    arm.position.set(0, 0.33, 0);
    arm.rotation.z = 0.7;
    g.add(arm);
    put(arm, box(0.04, 0.42, 0.04), mat(WOOD_DARK), 0, 0.17, 0);
    put(arm, box(0.1, 0.03, 0.1), mat(WOOD_DARK), 0, 0.38, 0);
    put(arm, ico(0.06), mat(0x9b9b94), 0, 0.44, 0);
    put(g, box(0.02, 0.3, 0.02), mat(WOOD_DARK), -0.2, 0.32, -0.12);
    put(g, box(0.1, 0.07, 0.015), teamMat(), -0.15, 0.43, -0.12);
  } else if (type === 'mindbender') {
    const pp = person({ robe: true, armR: 0.3 });
    put(pp.p, cone(0.1, 0.16, 6), teamMat(), 0, pp.headY + 0.08, 0);
    put(pp.right, box(0.025, 0.55, 0.025), mat(WOOD), 0, 0.12, 0);
    put(pp.right, ico(0.06), mat(0xe0b84d), 0, 0.42, 0);
  } else if (type === 'knight') {
    horse(0x5b4636);
    put(g, box(0.3, 0.05, 0.2), teamMat(), 0, 0.4, 0); // Satteldecke
    const pp = person({ y0: 0.29, legs: false, torso: mat(IRON) });
    helmet(pp, STEEL, 0.17);
    // Lanze waagerecht nach vorn.
    put(pp.right, box(0.62, 0.03, 0.03), mat(0xf0f3f7), 0.2, 0, 0);
    put(pp.right, cone(0.035, 0.1, 4), mat(STEEL), 0.55, 0, 0).rotation.z = -Math.PI / 2;
    put(pp.left, box(0.03, 0.18, 0.14), teamMat(), 0.03, 0, 0);
  } else if (type === 'giant') {
    const pp = person({ scale: 2.0, armR: 1.1 });
    // Keule nach vorn-oben, Griff in der Hand.
    const club = put(pp.right, cyl(0.045, 0.022, 0.3, 6), mat(0x6b4a2b), 0.1, 0.1, 0);
    club.rotation.z = -0.8;
  } else if (type === 'boat') {
    const top = hull(0.42, 0.2, 0.1, WOOD);
    mast(0, top, 0.42, 0.22, 0.26);
    if (passenger) rider(top, -0.12);
  } else if (type === 'ship') {
    const top = hull(0.56, 0.26, 0.13, 0x6b4a2b);
    put(g, box(0.14, 0.1, 0.2), mat(WOOD), -0.2, top + 0.05, 0);
    mast(0.05, top, 0.55, 0.26, 0.32);
    mast(-0.12, top, 0.42, 0.2, 0.22);
  } else if (type === 'battleship') {
    const top = hull(0.66, 0.26, 0.14, 0x4a555e);
    put(g, box(0.5, 0.06, 0.2), mat(0x5c6670), -0.02, top + 0.03, 0);
    put(g, cyl(0.09, 0.1, 0.1, 6), mat(0x6b7580), 0.12, top + 0.11, 0);
    for (const z of [-0.04, 0.04]) {
      put(g, cyl(0.022, 0.022, 0.26, 6), mat(0x333b42), 0.27, top + 0.13, z).rotation.z = -Math.PI / 2;
    }
    put(g, box(0.16, 0.16, 0.14), mat(0x5c6670), -0.16, top + 0.14, 0);
    const pole = new THREE.Group();
    pole.position.set(-0.16, top + 0.22, 0);
    g.add(pole);
    put(pole, cyl(0.012, 0.012, 0.3, 5), mat(0x333b42), 0, 0.15, 0);
    put(pole, box(0.12, 0.08, 0.02), teamMat(), 0.06, 0.25, 0);
    masts.push(pole);
  } else if (type === 'spy') {
    const pp = person({ torso: mat(0x27272a), armR: 2.2 });
    put(pp.p, cone(0.12, 0.2, 7), mat(0x27272a), 0, pp.headY + 0.06, -0.01);
    put(pp.p, box(0.2, 0.06, 0.2), teamMat(), 0, 0.36, 0); // Schal in Teamfarbe
    // Fernrohr vor dem Auge, von der rechten Hand gehalten.
    put(pp.p, cyl(0.022, 0.03, 0.2, 6), mat(0xc8a64a), 0.15, pp.headY + 0.01, 0.06).rotation.z = -Math.PI / 2;
  } else if (type === 'settler') {
    const pp = person();
    put(pp.p, cyl(0.15, 0.15, 0.025, 8), mat(0xc9a25a), 0, pp.headY + 0.07, 0);
    put(pp.p, cyl(0.07, 0.08, 0.07, 8), mat(0xc9a25a), 0, pp.headY + 0.11, 0);
    put(pp.p, box(0.12, 0.2, 0.16), mat(WOOD), -0.15, 0.31, 0);
    put(pp.p, cyl(0.045, 0.045, 0.2, 6), mat(0xd8cfb8), -0.15, 0.44, 0).rotation.x = Math.PI / 2;
    put(pp.right, box(0.02, 0.6, 0.02), mat(WOOD_DARK), 0, 0.12, 0);
    put(pp.right, box(0.12, 0.08, 0.015), teamMat(), 0.07, 0.38, 0);
  } else if (hasAbility(type, 'air')) {
    airBody(type, g, put, teamMat);
    if (passenger) rider(AIR_Y + 0.1, 0);
  } else {
    // Rückfallmodell, damit eine Einheit ohne eigenes Modell nie unsichtbar ist.
    person();
  }

  g.userData.teamMats = teamMats;
  g.userData.masts = masts;
  return g;
}

// --- Stadtmodelle -------------------------------------------------------------
// `city` ist eine Ansicht (siehe cityView): owner, pop, wall, park, workshop,
// isCapital. Jede Stufe (Bevölkerung 1–5) hat eigene Gebäude; Dächer und
// Fahnen tragen die Teamfarbe.

function buildCity(city, color, look = null) {
  const g = new THREE.Group();
  const team = city.owner ? mat(color) : mat(0x8f939c);
  const stone = mat(0xd6d3cb), stoneDark = mat(0x9ca3af), plaster = mat(0xe8e2d2);
  const wood = mat(WOOD), woodDark = mat(WOOD_DARK), gold = mat(0xeab308);
  const put = (geometry, material, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const ring = (n, rad, offset = 0) => Array.from({ length: n }, (_, i) => {
    const a = offset + (i / n) * Math.PI * 2;
    return [Math.cos(a) * rad, Math.sin(a) * rad, -a];
  });

  // Sockel: Stadtplatz in Teamfarbe mit hellem Pflaster.
  put(cyl(0.62, 0.66, 0.1, 6), city.owner ? mat(color) : mat(0xb9bdc6), 0, 0.05, 0);
  put(cyl(0.5, 0.52, 0.02, 6), mat(0xcfc8b6), 0, 0.11, 0);
  const Y = 0.12;

  const hut = (x, z, ry) => {
    put(box(0.14, 0.1, 0.14), wood, x, Y + 0.05, z, ry);
    put(cone(0.13, 0.12, 4), mat(0xb08d57), x, Y + 0.16, z, ry + Math.PI / 4);
  };
  const house = (x, z, ry, tall = false) => {
    const h = tall ? 0.24 : 0.14;
    put(box(0.16, h, 0.15), plaster, x, Y + h / 2, z, ry);
    put(cone(0.14, 0.11, 4), team, x, Y + h + 0.055, z, ry + Math.PI / 4);
    if (tall) put(box(0.165, 0.02, 0.155), woodDark, x, Y + h / 2, z, ry); // Fachwerk-Balken
  };
  const tower = (x, z, h, r = 0.1) => {
    put(cyl(r, r * 1.15, h, 8), stone, x, Y + h / 2, z);
    put(cone(r * 1.35, h * 0.4, 8), team, x, Y + h + h * 0.2, z);
    return Y + h + h * 0.4;
  };
  const flag = (x, z, top, big = false) => {
    if (!city.owner) return;
    put(cyl(0.012, 0.012, 0.3, 5), mat(0x52525b), x, top + 0.15, z);
    const w = big ? 0.2 : 0.15, h = big ? 0.12 : 0.09;
    const style = look ? look.banner : 'standard';
    if (style === 'pennant') {
      // Wimpel: spitzes Dreieck.
      const pen = put(cone(h / 2, w * 1.2, 3), team, x + w * 0.6, top + 0.24, z);
      pen.rotation.z = -Math.PI / 2;
      pen.scale.z = 0.15;
    } else if (style === 'swallow') {
      // Schwalbenschwanz: zwei Zipfel.
      put(box(w * 0.6, h, 0.015), team, x + w * 0.3, top + 0.24, z);
      for (const dy of [-h * 0.28, h * 0.28]) put(box(w * 0.45, h * 0.4, 0.015), team, x + w * 0.8, top + 0.24 + dy, z);
    } else {
      if (style === 'gold') put(box(w + 0.03, h + 0.03, 0.01), gold, x + w / 2, top + 0.24, z);
      put(box(w, h, 0.015), team, x + w / 2, top + 0.24, z);
    }
  };
  const crown = top => {
    put(cyl(0.07, 0.07, 0.04, 8), gold, 0, top + 0.03, 0);
    for (const [x, z] of ring(5, 0.06)) put(cone(0.02, 0.06, 4), gold, x, top + 0.08, z);
  };

  const lvl = Math.max(1, Math.min(5, city.pop || 1));
  let top = Y;
  if (lvl === 1) {
    // Kleine Siedlung: zwei Hütten und ein Lagerfeuer.
    hut(-0.18, -0.12, 0.3);
    hut(0.2, 0.08, -0.5);
    put(cone(0.05, 0.1, 5), mat(0xf97316), -0.02, Y + 0.05, 0.22);
    for (const ry of [0, 1.1, 2.2]) put(box(0.12, 0.025, 0.025), woodDark, -0.02, Y + 0.015, 0.22, ry);
    top = Y + 0.22;
    flag(0.2, 0.08, top - 0.02);
  } else if (lvl === 2) {
    // Dorf: Häuser um einen hölzernen Wachturm.
    for (const [x, z, ry] of ring(3, 0.36, 0.5)) house(x, z, ry);
    for (const [x, z] of ring(4, 0.07, Math.PI / 4)) put(box(0.025, 0.36, 0.025), woodDark, x, Y + 0.18, z);
    put(box(0.2, 0.03, 0.2), wood, 0, Y + 0.36, 0);
    put(cone(0.16, 0.12, 4), team, 0, Y + 0.44, 0, Math.PI / 4);
    top = Y + 0.5;
    flag(0, 0, top);
  } else if (lvl === 3) {
    // Kleinstadt: Steinturm, Häuser und ein Marktstand.
    for (const [x, z, ry] of ring(4, 0.37, 0.3)) house(x, z, ry);
    top = tower(0, 0, 0.42, 0.11);
    put(box(0.16, 0.06, 0.1), wood, 0.05, Y + 0.06, 0.26);
    put(box(0.2, 0.02, 0.14), team, 0.05, Y + 0.2, 0.26);
    for (const x of [-0.04, 0.14]) put(box(0.015, 0.14, 0.015), woodDark, x, Y + 0.12, 0.31);
    flag(0, 0, top);
  } else if (lvl === 4) {
    // Stadt: Halle in der Mitte, zweistöckige Häuser, ein Turm.
    put(box(0.32, 0.2, 0.22), plaster, -0.02, Y + 0.1, 0);
    put(cone(0.24, 0.14, 4), team, -0.02, Y + 0.27, 0, Math.PI / 4);
    put(box(0.08, 0.12, 0.01), woodDark, 0.14, Y + 0.06, 0, Math.PI / 2);
    house(-0.34, 0.22, 0.4, true);
    house(0.3, 0.26, -0.3, true);
    house(-0.3, -0.26, 0.9);
    house(0.06, -0.38, 0.1);
    top = tower(0.34, -0.18, 0.5, 0.09);
    flag(0.34, -0.18, top);
  } else {
    // Metropole: Burgfried mit Zinnen, Ecktürme, viele Häuser.
    put(box(0.3, 0.38, 0.3), stone, 0, Y + 0.19, 0);
    for (const [x, z] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) {
      put(box(0.07, 0.07, 0.07), stoneDark, x, Y + 0.415, z);
    }
    put(box(0.02, 0.16, 0.1), team, 0.16, Y + 0.22, 0); // Banner an der Front
    top = Y + 0.45;
    for (const [x, z] of [[-0.36, -0.2], [0.36, 0.2]]) tower(x, z, 0.52, 0.085);
    for (const [x, z, ry] of ring(4, 0.42, Math.PI / 4)) house(x * 0.95, z * 0.95, ry, true);
    flag(0, 0, top, true);
  }
  if (city.isCapital && city.owner) crown(top + (lvl === 1 ? 0.0 : 0.02));

  // Stadtschmuck (Kosmetik) vorn am Stadtplatz der Hauptstadt.
  const decor = city.isCapital && look ? look.decor : 'none';
  if (decor === 'fountain') {
    put(cyl(0.09, 0.1, 0.05, 10), stone, 0, Y + 0.025, 0.46);
    put(cyl(0.075, 0.075, 0.01, 10), mat(0x60a5fa), 0, Y + 0.05, 0.46);
    put(cyl(0.015, 0.02, 0.1, 6), stone, 0, Y + 0.08, 0.46);
  } else if (decor === 'statue') {
    put(box(0.08, 0.08, 0.08), stone, 0, Y + 0.04, 0.46);
    put(cyl(0.025, 0.03, 0.1, 6), gold, 0, Y + 0.13, 0.46);
    put(ico(0.03), gold, 0, Y + 0.2, 0.46);
  } else if (decor === 'garden') {
    for (const [x, z] of [[-0.12, 0.46], [0.12, 0.46], [0, 0.5]]) {
      put(ico(0.05), mat(0x3e9140), x, Y + 0.05, z);
      put(ico(0.02), mat(0xf472b6), x + 0.02, Y + 0.09, z);
    }
  }

  // Belohnungen sichtbar machen.
  if (city.park) {
    for (const [x, z] of [[-0.45, 0.05], [-0.4, 0.2]]) {
      put(cyl(0.015, 0.02, 0.08, 5), woodDark, x, Y + 0.04, z);
      put(ico(0.07), mat(0x3e9140), x, Y + 0.12, z);
    }
  }
  if (city.workshop) {
    put(box(0.14, 0.12, 0.12), stoneDark, 0.42, Y + 0.06, -0.02);
    put(box(0.04, 0.16, 0.04), mat(0x52525b), 0.46, Y + 0.16, 0.02);
    put(ico(0.035), mat(0xd4d4d8), 0.47, Y + 0.28, 0.03);
  }
  // Stadtmauer (Belohnung): Steinring mit Zinnen am Rand.
  if (city.wall) {
    for (const [x, z, ry] of ring(6, 0.58, Math.PI / 6)) {
      put(box(0.34, 0.14, 0.07), stoneDark, x, Y + 0.07, z, ry + Math.PI / 2);
      put(box(0.06, 0.05, 0.08), stoneDark, x, Y + 0.165, z, ry + Math.PI / 2);
    }
  }
  return g;
}

function cityKey(city, look = null) {
  return [city.owner, city.pop, city.wall, city.park, city.workshop, city.isCapital, look ? look.banner + look.decor : ''].join('|');
}

// Aussehen (Kosmetik) des Besitzers aus dem Spielstand.
function lookFor(state, owner) {
  return (owner && state.looks && state.looks[owner]) || null;
}

function placeCityNode(state, city) {
  const key = hk(city.q, city.r);
  const existing = cityNodes.get(key);
  const look = lookFor(state, city.owner);
  if (existing && existing.sig === cityKey(city, look)) return;
  // Wachstum oder Besitzerwechsel: neue Stadt kurz „aufploppen“ lassen.
  const changed = existing && (existing.pop !== city.pop || existing.owner !== city.owner);
  if (existing) {
    scene.remove(existing.group);
    cityNodes.delete(key);
  }
  const group = buildCity(city, city.owner ? ownerColor(city.owner) : 0xb9bdc6, look);
  const p = toWorld(city.q, city.r);
  group.position.set(p.x, hexTop(key), p.z);
  scene.add(group);
  if (changed) {
    group.scale.setScalar(0.7);
    addTween({ dur: 520, ease: easeOutBack, update: t => group.scale.setScalar(0.7 + 0.3 * t) });
  }
  cityNodes.set(key, { group, owner: city.owner, pop: city.pop, sig: cityKey(city, look) });
}

// Luft-Einheiten: schweben über dem Feld, Schatten am Boden. Weidenkorb oder
// Holzgondel an Seilen, Hülle in Stammesfarbe (Brandballon dunkel mit Band).
const AIR_Y = 0.62;
function airBody(type, g, put, teamMat) {
  const shadow = new THREE.Mesh(geo('airShadow', () => new THREE.CircleGeometry(0.26, 16).rotateX(-Math.PI / 2)),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  shadow.position.y = 0.015;
  shadow.castShadow = false;
  g.add(shadow);
  const wicker = mat(0xa0743f), rope = mat(0x5c4a32);
  const ropes = (x0, z0, y0, x1, z1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const r = put(g, box(0.008, len, 0.008), rope, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    r.lookAt(new THREE.Vector3(x1, y1, z1).add(g.position));
    r.rotateX(Math.PI / 2);
  };
  if (type === 'airship') {
    // Längliche Hülle aus vernähten Häuten, Rippen, Leitwerk, Gondel mit Armbrüsten.
    const env = put(g, geo('asEnv', () => new THREE.SphereGeometry(0.25, 14, 10)), teamMat(), 0, AIR_Y + 0.55, 0);
    env.scale.set(2.2, 0.9, 0.9);
    for (const x of [-0.3, -0.1, 0.1, 0.3]) {
      const rib = put(g, geo('asRib', () => new THREE.TorusGeometry(0.21, 0.012, 4, 14)), mat(0x6b4a2b), x, AIR_Y + 0.55, 0);
      rib.rotation.y = Math.PI / 2;
      rib.scale.setScalar(1 - Math.abs(x) * 0.9);
    }
    put(g, box(0.14, 0.14, 0.02), mat(0x6b4a2b), -0.56, AIR_Y + 0.6, 0);
    put(g, box(0.14, 0.02, 0.16), mat(0x6b4a2b), -0.54, AIR_Y + 0.55, 0);
    put(g, box(0.44, 0.08, 0.14), mat(WOOD), 0, AIR_Y + 0.12, 0);
    put(g, box(0.44, 0.03, 0.16), mat(WOOD_DARK), 0, AIR_Y + 0.17, 0);
    for (const z of [-0.09, 0.09]) {
      put(g, box(0.16, 0.025, 0.025), mat(WOOD_DARK), 0.16, AIR_Y + 0.19, z);
      put(g, box(0.02, 0.025, 0.12), mat(STEEL), 0.22, AIR_Y + 0.19, z);
    }
    for (const x of [-0.18, 0.18]) for (const z of [-0.06, 0.06]) ropes(x, z, AIR_Y + 0.17, x * 1.2, z * 2, AIR_Y + 0.4);
    return;
  }
  const big = type === 'cargoballoon';
  const fire = type === 'fireballoon';
  const R = big ? 0.3 : 0.26;
  const envMat = fire ? mat(0x3f3f46) : teamMat();
  const env = put(g, geo('blEnv' + R, () => new THREE.SphereGeometry(R, 14, 12)), envMat, 0, AIR_Y + 0.5, 0);
  env.scale.set(1, 1.15, 1);
  // Unterer Hals der Hülle.
  put(g, cone(R * 0.55, 0.16, 10), envMat, 0, AIR_Y + 0.5 - R * 1.1, 0).rotation.x = Math.PI;
  if (fire) {
    const band = put(g, geo('blBand', () => new THREE.TorusGeometry(0.265, 0.03, 6, 18)), teamMat(), 0, AIR_Y + 0.5, 0);
    band.rotation.x = Math.PI / 2;
  } else {
    // Nähte (Bahnen) als dunkle Ringe.
    for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
      const seam = put(g, geo('blSeam' + R, () => new THREE.TorusGeometry(R * 1.01, 0.006, 3, 20)), mat(0x27272a), 0, AIR_Y + 0.5, 0);
      seam.rotation.y = a;
      seam.scale.y = 1.15;
    }
  }
  const bw = big ? 0.2 : 0.15;
  put(g, box(bw, 0.11, bw), wicker, 0, AIR_Y + 0.06, 0);
  for (const x of [-bw / 2, bw / 2]) for (const z of [-bw / 2, bw / 2]) ropes(x, z, AIR_Y + 0.11, x * 1.6, z * 1.6, AIR_Y + 0.5 - R * 0.8);
  // Brennerflamme.
  const flame = put(g, cone(0.035, 0.09, 6), new THREE.MeshBasicMaterial({ color: 0xffa53d }), 0, AIR_Y + 0.27, 0);
  flame.castShadow = false;
  if (big) put(g, box(0.12, 0.08, 0.1), mat(WOOD_DARK), 0, AIR_Y + 0.15, 0); // Frachtkiste
  if (fire) {
    for (const [x, z] of [[0.1, 0.06], [-0.1, -0.06], [0.06, -0.1]]) {
      put(g, ico(0.035), mat(0xb45309), x, AIR_Y - 0.02, z);
      ropes(x, z, AIR_Y + 0.01, x * 0.7, z * 0.7, AIR_Y + 0.06);
    }
  }
}

function placeUnitNode(state, unit) {
  const color = ownerColor(unit.owner);
  const look = lookFor(state, unit.owner);
  const group = unitBody(unit.type, color, passengerOf(unit), look && look.plume);
  const p = toWorld(unit.q, unit.r);
  const key = hk(unit.q, unit.r);
  group.position.set(p.x, unitTop(key, unit.type), p.z);
  const sprite = makeHpSprite();
  drawHp(sprite, unit.hp, !!unit.vet, color);
  sprite.position.y = hasAbility(unit.type, 'air') ? 1.6 : 0.95;
  group.add(sprite);
  group.rotation.y = DEFAULT_FACING;
  scene.add(group);
  const bt = tiles.get(key);
  const node = { plume: look && look.plume, underBridge: !!(bt && bt.bridgeNode && hasAbility(unit.type, 'water')), group, sprite, hp: unit.hp, vet: !!unit.vet, type: unit.type, passenger: passengerOf(unit), acted: unit.acted, owner: unit.owner, dying: false, baseColor: color };
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

// Modelle blicken in +x. Startblick schräg zur Kamera hin.
const DEFAULT_FACING = -Math.PI / 3;
const facingTo = (dx, dz) => Math.atan2(-dz, dx);

// Einheit (über eine kurze Drehung auf kürzestem Weg) in Richtung dx/dz drehen.
function turnNode(node, dx, dz, dur = 140) {
  if (Math.abs(dx) + Math.abs(dz) < 1e-4) return;
  const g = node.group;
  const from = g.rotation.y;
  let to = facingTo(dx, dz);
  while (to - from > Math.PI) to -= Math.PI * 2;
  while (to - from < -Math.PI) to += Math.PI * 2;
  addTween({ dur, ease: easeOut, update: t => { g.rotation.y = from + (to - from) * t; } });
}

function removeUnitNode(id, node) {
  scene.remove(node.group);
  node.sprite.userData.texture?.dispose();
  node.sprite.material.dispose();
  for (const m of node.group.userData.teamMats) m.dispose();
  unitNodes.delete(id);
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

// Weg für die nächste Bewegung einer Einheit (von der Spielsteuerung gesetzt).
const movePaths = new Map();
export function setMovePath(unitId, path) {
  if (path && path.length) movePaths.set(unitId, path);
}
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
    // Der Bildzeitstempel kann knapp vor dem Start liegen: nie negativ.
    const raw = Math.max(0, Math.min((now - tw.start) / tw.dur, 1));
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

let contextLost = false;
let lastSync = null;
const reported = new Set();
function reportOnce(e) {
  const k = String(e && e.message);
  if (reported.has(k)) return;
  reported.add(k);
  console.warn('Darstellung:', e);
}

export function syncBoard(state, viewer = null) {
  if (!initialized) return Promise.resolve();
  lastSync = { state, viewer };
  // Kartengröße immer passend zum Stand (z. B. direkt nach einem neuen Spiel).
  if (state.terrain && state.mapW && state.mapH && (state.mapW !== MAP_W || state.mapH !== MAP_H)) useMap(state);
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
    const imp = state.improvements ? state.improvements[key] : null;
    syncImprovement(t, imp, imp ? tileEnv(state, key, imp) : {});
    syncRuin(t, state.ruins && state.ruins[key]);
    syncBridge(t, state.bridges ? state.bridges[key] : null);
    syncRoad(state, key, t);
    const seen = !explored || explored.has(key);
    t.seen = seen;
    t.lit = !visible || visible.has(key);
    t.mesh.material = !seen ? (fogClear.has(key) ? fogTargetMat : fogTileMat) : t.lit ? t.baseMat : dimMatFor(t.terrain);
    flattenUnseen(t);
    if (t.decor) for (const d of t.decor) d.visible = seen;
  }
  syncLighthouses(state, viewer);
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
    // Ein-/Ausschiffen wechselt den Typ: Modell neu aufbauen.
    const lk = lookFor(state, u.owner);
    if (node && (node.type !== u.type || node.passenger !== passengerOf(u) || node.plume !== (lk && lk.plume))) {
      removeUnitNode(u.id, node);
      node = null;
    }
    if (!node) {
      node = placeUnitNode(state, u);
      continue;
    }
    // Bekehrte Einheiten (Gedankenbeuger) wechseln den Besitzer.
    if (node.owner !== u.owner) {
      node.owner = u.owner;
      node.baseColor = ownerColor(u.owner);
      node.acted = null;
      node.hp = null;
    }
    if (node.hp !== u.hp || node.vet !== !!u.vet) {
      node.hp = u.hp;
      node.vet = !!u.vet;
      drawHp(node.sprite, u.hp, node.vet, node.baseColor);
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
    target.set(p.x, unitTop(hk(u.q, u.r), u.type), p.z);
    const bt = tiles.get(hk(u.q, u.r));
    node.underBridge = !!(bt && bt.bridgeNode && hasAbility(u.type, 'water'));
    const pos = node.group.position;
    if (pos.distanceToSquared(target) > 0.0004 && !node.moving) {
      node.moving = true;
      const from = pos.clone();
      // Mit bekanntem Weg Feld für Feld laufen, sonst direkt springen.
      const path = movePaths.get(u.id);
      movePaths.delete(u.id);
      const pts = [from];
      if (path && path.length > 1) {
        for (const [q, r] of path.slice(0, -1)) {
          const w = toWorld(q, r);
          pts.push(new THREE.Vector3(w.x, unitTop(hk(q, r), u.type), w.z));
        }
      }
      pts.push(target);
      const n = pts.length - 1;
      const air = hasAbility(u.type, 'air'), water = hasAbility(u.type, 'water');
      let seg = -1;
      promises.push(new Promise(resolve => {
        addTween({
          dur: n > 1 ? 190 * n : 320,
          ease: n > 1 ? (t => t) : easeOut,
          update: t => {
            const f = Math.max(0, Math.min(t, 1)) * n;
            const i = Math.max(0, Math.min(Math.floor(f), n - 1));
            const k = n > 1 ? easeInOut(f - i) : f - i;
            if (i !== seg) { seg = i; turnNode(node, pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z, 110); }
            pos.lerpVectors(pts[i], pts[i + 1], k);
            // Landeinheiten hüpfen je Schritt, Schiffe schaukeln, Ballone gleiten.
            const hop = air ? 0.04 : water ? 0.03 : (n > 1 ? 0.12 : 0.45 * (1 - t * 0.3));
            pos.y += Math.sin(Math.PI * k) * hop;
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
    const y0 = g.position.y;
    addTween({
      dur: DIESE_DUR,
      // Erst umkippen, dann versinken.
      update: t => {
        const tip = Math.min(1, t / 0.55);
        g.rotation.x = 1.45 * tip * tip;
        if (t > 0.55) {
          const k = (t - 0.55) / 0.45;
          g.scale.setScalar(Math.max(1 - k, 0.01));
          g.position.y = y0 - 0.25 * k;
        }
      },
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

// Kleines Feuerwerk über einem Feld (Eroberung, Wachstum, Monument).
export function celebrate(q, r, color = 0xfacc15, big = false) {
  if (!initialized) return;
  const p = worldOf(q, r);
  const group = new THREE.Group();
  group.position.copy(p).add(new THREE.Vector3(0, 0.6, 0));
  const n = big ? 34 : 18;
  const colors = [color, 0xffffff, 0xfde68a];
  const parts = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo('confetti', () => new THREE.BoxGeometry(0.07, 0.07, 0.07)),
      new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true }));
    const a = Math.random() * Math.PI * 2, up = 1.6 + Math.random() * (big ? 2.2 : 1.2), out = 0.6 + Math.random() * (big ? 1.4 : 0.8);
    m.userData.v = new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out);
    group.add(m);
    parts.push(m);
  }
  scene.add(group);
  effects.push({
    start: performance.now(), dur: big ? 1400 : 1000,
    update: t => {
      for (const m of parts) {
        m.position.set(m.userData.v.x * t, m.userData.v.y * t - 2.2 * t * t, m.userData.v.z * t);
        m.rotation.x = m.rotation.y = t * 9;
        m.material.opacity = 1 - Math.max(0, t - 0.5) * 2;
      }
      if (t >= 1) { scene.remove(group); for (const m of parts) m.material.dispose(); }
    }
  });
}

export function floatAt(q, r, text, color = '#facc15') {
  if (!initialized) return;
  floatText(worldOf(q, r), text, color);
}

function nodePos(id) {
  const n = unitNodes.get(id);
  return n ? n.group.position.clone() : new THREE.Vector3();
}

// Geschoss je Angreifer: Pfeil, Bolzen, Stein, Brandtopf.
const RANGED = new Set(['archer', 'crossbow', 'catapult', 'ship', 'battleship', 'airship', 'fireballoon']);
function projectileMesh(type) {
  const g = new THREE.Group();
  if (type === 'catapult') {
    g.add(new THREE.Mesh(geo('pjStone', () => new THREE.IcosahedronGeometry(0.07, 0)), mat(0x9b9b94)));
  } else if (type === 'fireballoon') {
    g.add(new THREE.Mesh(geo('pjPot', () => new THREE.IcosahedronGeometry(0.06, 0)), mat(0xb45309)));
    const fire = new THREE.Mesh(geo('pjFire', () => new THREE.ConeGeometry(0.04, 0.1, 5)), new THREE.MeshBasicMaterial({ color: 0xff8a1f }));
    fire.position.y = 0.07;
    g.add(fire);
  } else {
    const shaft = new THREE.Mesh(geo('pjShaft', () => new THREE.BoxGeometry(0.3, 0.015, 0.015)), mat(0x5c3d22));
    g.add(shaft);
    const tip = new THREE.Mesh(geo('pjTip', () => new THREE.ConeGeometry(0.022, 0.06, 4)), mat(0xd9dee5));
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = 0.17;
    g.add(tip);
  }
  return g;
}

// Ein Schlag von `from` auf `to`: Geschoss oder Ausfallschritt, danach Treffer.
function strike(fromId, toId, dmg, color) {
  const a = unitNodes.get(fromId), d = unitNodes.get(toId);
  const impact = () => {
    if (d) {
      d.flashUntil = performance.now() + 280;
      // Rückstoß vom Angreifer weg und zurück.
      if (a && !d.moving) {
        const dp = d.group.position, base = dp.clone();
        const away = new THREE.Vector3(dp.x - a.group.position.x, 0, dp.z - a.group.position.z).normalize().multiplyScalar(0.14);
        addTween({ dur: 220, update: t => { if (!d.moving && !d.dying) dp.copy(base).addScaledVector(away, Math.sin(Math.PI * t)); } });
      }
    }
    floatText(nodePos(toId), '-' + dmg, color);
  };
  if (!a || !d) { impact(); return 0; }
  const ap = a.group.position, dp = d.group.position;
  turnNode(a, dp.x - ap.x, dp.z - ap.z);
  const dist = Math.hypot(dp.x - ap.x, dp.z - ap.z);
  if (RANGED.has(a.type) && (dist > 1.9 || a.type === 'fireballoon' || a.type === 'airship')) {
    const pj = projectileMesh(a.type);
    const from = ap.clone().add(new THREE.Vector3(0, hasAbility(a.type, 'air') ? 0.75 : 0.4, 0));
    const to = dp.clone().add(new THREE.Vector3(0, 0.3, 0));
    const peak = a.type === 'fireballoon' ? 0 : 0.5 + dist * 0.18;
    scene.add(pj);
    const dur = 300 + dist * 40;
    addTween({
      dur,
      update: t => {
        pj.position.lerpVectors(from, to, t);
        pj.position.y += Math.sin(Math.PI * t) * peak;
        // Spitze zeigt in Flugrichtung (Ableitung der Bahn).
        const vy = (to.y - from.y) + Math.cos(Math.PI * t) * Math.PI * peak;
        pj.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x);
        pj.rotation.z = Math.atan2(vy, dist);
      },
      resolve: () => { scene.remove(pj); impact(); }
    });
    return dur;
  }
  // Nahkampf: kurzer Ausfallschritt zum Ziel und zurück.
  const base = ap.clone();
  const dir = new THREE.Vector3(dp.x - ap.x, 0, dp.z - ap.z).normalize().multiplyScalar(0.28);
  addTween({ dur: 260, update: t => { if (!a.moving) ap.copy(base).addScaledVector(dir, Math.sin(Math.PI * t)); } });
  setTimeout(impact, 130);
  return 140;
}

export function playCombat(events) {
  if (!initialized) return Promise.resolve();
  const hit = events.find(ev => ev.kind === 'damage');
  const back = events.find(ev => ev.kind === 'retaliate');
  if (!hit && !back) return Promise.resolve();
  const d = hit ? unitNodes.get(hit.to) : null;
  const a = hit ? unitNodes.get(hit.from) : null;
  if (a && d) turnNode(d, a.group.position.x - d.group.position.x, a.group.position.z - d.group.position.z);
  const t1 = hit ? strike(hit.from, hit.to, hit.dmg, '#ff8080') : 0;
  let total = t1 + 420;
  if (back) {
    const delay = t1 + 260;
    setTimeout(() => strike(back.from, back.to, back.dmg, '#ffd24d'), delay);
    total = delay + 520;
  }
  return new Promise(resolve => setTimeout(resolve, total));
}

const HL = {
  move: { color: 0xffffff, opacity: 0.34 },
  attack: { color: 0xff4d4d, opacity: 0.5 },
  city: { color: 0xffe14d, opacity: 0.34 },
  bridge: { color: 0x60a5fa, opacity: 0.45 },
  target: { color: 0xfacc15, opacity: 0.7 }
};

const discGeo = () => geo('disc', () => new THREE.CylinderGeometry(0.8, 0.8, 0.07, 6));
const discMats = new Map();
function discMat(kind) {
  if (!discMats.has(kind)) {
    const { color, opacity } = HL[kind];
    discMats.set(kind, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, fog: false
    }));
  }
  return discMats.get(kind);
}

export function setHighlights({ selected = null, move = null, attack = null, city = null, bridge = null, target = null } = {}) {
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
    m.renderOrder = 13; // nach dem Nebel zeichnen – Zielfelder bleiben sichtbar
    highlightGroup.add(m);
    if (kind !== 'city') clear.add(hk(q, r));
  };
  const clear = new Set();

  if (selected) {
    const [q, r] = selected.split(',').map(Number);
    addDisc(q, r, 'city', 0.045);
    selectedMesh = highlightGroup.children[highlightGroup.children.length - 1];
  }
  if (move) for (const k of move.keys()) { const [q, r] = k.split(',').map(Number); addDisc(q, r, 'move'); }
  if (attack) for (const u of attack) addDisc(u.q, u.r, 'attack');
  if (city) addDisc(city.q, city.r, 'city');
  if (bridge) for (const [q, r] of bridge) addDisc(q, r, 'bridge');
  targetMesh = null;
  if (target) {
    const [q, r] = target.split(',').map(Number);
    addDisc(q, r, 'target', 0.07);
    targetMesh = highlightGroup.children[highlightGroup.children.length - 1];
  }
  fogClear = clear;
  applyFogClear();
}

// Zum Feld schwenken. Drehung und Neigung bleiben erhalten; `close` zoomt
// näher heran.
export function cameraTo(q, r, close = false) {
  if (!initialized) return;
  const p = toWorld(q, r);
  const fromT = controls.target.clone();
  const toT = new THREE.Vector3(p.x, 0, p.z);
  const fromP = camera.position.clone();
  const off = fromP.clone().sub(fromT);
  let dist = close ? 14 : 26;
  // Hochformat (iPad/Handy hochkant): weiter weg, damit genug Breite sichtbar ist.
  if (camera.aspect < 1) dist *= 1 + (1 - camera.aspect) * 0.9;
  off.setLength(dist);
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

// Kamera um das Blickziel drehen (Winkel in Bogenmaß) bzw. neigen.
function orbit(dTheta, dPhi, dur = 260) {
  const t = controls.target.clone();
  const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(t));
  const from = { theta: sph.theta, phi: sph.phi };
  const to = {
    theta: sph.theta + dTheta,
    phi: THREE.MathUtils.clamp(sph.phi + dPhi, controls.minPolarAngle, controls.maxPolarAngle)
  };
  addTween({
    dur, ease: easeOut,
    update: k => {
      const s2 = new THREE.Spherical(sph.radius, from.phi + (to.phi - from.phi) * k, from.theta + (to.theta - from.theta) * k);
      camera.position.copy(t).add(new THREE.Vector3().setFromSpherical(s2));
      camera.lookAt(t);
    }
  });
}

// Kamera in Blickrichtung verschieben (Pfeiltasten): dx nach rechts, dz nach vorn.
export function panCamera(dx, dz) {
  if (!initialized) return;
  const fwd = controls.target.clone().sub(camera.position).setY(0).normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const step = right.multiplyScalar(dx * 3).add(fwd.multiplyScalar(dz * 3));
  const fromT = controls.target.clone(), fromP = camera.position.clone();
  addTween({
    dur: 180, ease: easeOut,
    update: k => {
      controls.target.copy(fromT).addScaledVector(step, k);
      camera.position.copy(fromP).addScaledVector(step, k);
    }
  });
}

// Näher heran (factor < 1) oder weiter weg (factor > 1), in den Zoomgrenzen.
export function zoomCamera(factor) {
  if (!initialized) return;
  const off = camera.position.clone().sub(controls.target);
  const len = THREE.MathUtils.clamp(off.length() * factor, controls.minDistance || 4, controls.maxDistance || 80);
  const from = camera.position.clone(), to = controls.target.clone().add(off.setLength(len));
  addTween({ dur: 180, ease: easeOut, update: k => camera.position.lerpVectors(from, to, k) });
}

export function rotateCamera(steps) { if (initialized) orbit(steps * Math.PI / 4, 0); }
export function tiltCamera(steps) { if (initialized) orbit(0, steps * 0.18); }

// Zurück zur Standardansicht (Norden oben, mittlere Neigung).
export function resetCamera() {
  if (!initialized) return;
  const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const want = new THREE.Spherical().setFromVector3(new THREE.Vector3(-2, 19, 17));
  let dTheta = want.theta - sph.theta;
  while (dTheta > Math.PI) dTheta -= Math.PI * 2;
  while (dTheta < -Math.PI) dTheta += Math.PI * 2;
  orbit(dTheta, want.phi - sph.phi, 380);
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

// Foto der ganzen Welt von schräg oben (ohne Nebel, ohne Markierungen) für das
// Ergebnisbild. Gibt eine 2D-Canvas zurück oder null ohne WebGL.
export function snapshotMap(state, w = 1720, h = 1000) {
  if (!initialized) return null;
  syncBoard(state, null);
  // Nebel sofort (nicht animiert) entfernen.
  if (fog) { for (const c of fog.cells) c.level = c.t.seen ? 0 : 1; paintFog(); }
  const b = mapBounds();
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const tilt = 1.15; // ~66° über dem Horizont: steil, damit die Karte das Bild füllt
  cam.position.set(cx, Math.sin(tilt) * 120, cz + Math.cos(tilt) * 120);
  cam.lookAt(cx, 0, cz);
  cam.updateMatrixWorld();
  // Kartenecken (mit etwas Höhe für Berge und Städte) in Kamerakoordinaten.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const x of [b.minX - 1, b.maxX + 1]) for (const z of [b.minZ - 1, b.maxZ + 1]) for (const y of [0, 1.2]) {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
  }
  // Auf das Bildformat erweitern.
  let fw = x1 - x0, fh = y1 - y0;
  if (fw / fh < w / h) { const d = fh * w / h - fw; x0 -= d / 2; x1 += d / 2; } else { const d = fw * h / w - fh; y0 -= d / 2; y1 += d / 2; }
  Object.assign(cam, { left: x0, right: x1, top: y1, bottom: y0 });
  cam.updateProjectionMatrix();

  const hidden = [highlightGroup, idleGroup];
  for (const node of unitNodes.values()) hidden.push(node.sprite);
  const was = hidden.map(o => o.visible);
  hidden.forEach(o => { o.visible = false; });
  const oldFog = scene.fog, oldRatio = renderer.getPixelRatio();
  const oldSize = renderer.getSize(new THREE.Vector2());
  scene.fog = null;
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.render(scene, cam);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  // Gleich nach dem Rendern kopieren, solange der Zeichenpuffer noch gilt.
  out.getContext('2d').drawImage(renderer.domElement, 0, 0, w, h);
  scene.fog = oldFog;
  renderer.setPixelRatio(oldRatio);
  renderer.setSize(oldSize.x, oldSize.y, false);
  hidden.forEach((o, i) => { o.visible = was[i]; });
  renderer.render(scene, camera);
  return out;
}

// Nur für Tests/Entwicklung: Kamera direkt setzen (Konsole: __pb.cam(...)).
export function debugCamera(x = 15, y = 3.2, z = 17.5, tx = 15, tz = 12) {
  if (!initialized) return;
  controls.target.set(tx, 0.5, tz);
  camera.position.set(x, y, z);
  controls.update();
}


