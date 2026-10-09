import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HEX_SIZE, TERRAIN, UNITS, COLORS, MAP_W, MAP_H, MAX_HP } from './config.js';
import { toWorld, forEachHex, hk } from './hex.js';

const TILE_GAP = 0.94;
let renderer, scene, camera, controls, raycaster;
let tileMeshes = [];
const tiles = new Map();
const unitNodes = new Map();
const cityNodes = new Map();
let highlightGroup;
let selectedMesh = null;
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

function mat(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
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

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f4f5);

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
  raycaster = new THREE.Raycaster();

  const hemi = new THREE.HemisphereLight(0xffffff, 0xd4d4d8, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(24, 34, 14);
  sun.castShadow = true;
  scene.add(sun);

  highlightGroup = new THREE.Group();
  scene.add(highlightGroup);

  const cx = 10, cz = 10;
  camera.position.set(cx - 2, 19, cz + 17);
  camera.lookAt(cx, 0, cz);

  controls = new OrbitControls(camera, canvas);
  controls.target.set(cx, 0, cz);
  controls.enableDamping = true;

  canvas.addEventListener('pointerdown', e => { pointerDownAt = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', e => {
    if (!pointerDownAt) return;
    const [px, py] = pointerDownAt;
    pointerDownAt = null;
    if (Math.hypot(e.clientX - px, e.clientY - py) > 7) return;
    const key = pick(e.clientX, e.clientY);
    if (onPick && key) onPick(key);
  });

  resize();
  window.addEventListener('resize', resize);

  function loop(now) {
    requestAnimationFrame(loop);
    stepTweens(now);
    stepEffects(now);
    controls.update();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(loop);
  return true;
}

function resize() {
  if (!renderer) return;
  const el = renderer.domElement.parentElement || document.body;
  const w = el.clientWidth || window.innerWidth;
  const h = el.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function pick(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(tileMeshes, false);
  if (!hits.length) return null;
  const h = hits[0].object.userData.hex;
  return hk(h.q, h.r);
}

function buildTiles(state) {
  for (let r = 0; r < MAP_H; r++) {
    for (let q = 0; q < MAP_W; q++) {
      const t = state.terrain[r * MAP_W + q];
      const def = TERRAIN[t] || TERRAIN.plains;
      const tileGeo = geo('hex_' + t, () => new THREE.CylinderGeometry(HEX_SIZE * TILE_GAP, HEX_SIZE * TILE_GAP, def.height, 6));
      const mesh = new THREE.Mesh(tileGeo, mat(def.color));
      const p = toWorld(q, r);
      mesh.position.set(p.x, def.height / 2, p.z);
      mesh.userData.hex = { q, r };
      scene.add(mesh);
      tileMeshes.push(mesh);
      tiles.set(hk(q, r), { mesh, top: def.height, terrain: t });
    }
  }
}

function hexTop(key) {
  const t = tiles.get(key);
  return t ? t.top : 0.5;
}

function unitBody(type, owner) {
  const g = new THREE.Group();
  const team = COLORS[owner] || 0x71717a;
  const teamMats = [];
  const add = (mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const teamMat = () => {
    const m = mat(team);
    teamMats.push(m);
    return m;
  };

  if (type === 'warrior') {
    add(new THREE.Mesh(geo('oct22', () => new THREE.OctahedronGeometry(0.22)), teamMat()), 0, 0.26, 0);
  } else if (type === 'rider') {
    add(new THREE.Mesh(geo('horse', () => new THREE.BoxGeometry(0.46, 0.19, 0.2)), mat(0x7a5230)), 0, 0.17, 0);
    add(new THREE.Mesh(geo('oct13', () => new THREE.OctahedronGeometry(0.13)), teamMat()), 0, 0.4, 0);
  } else if (type === 'archer') {
    add(new THREE.Mesh(geo('cone19', () => new THREE.ConeGeometry(0.19, 0.44, 6)), teamMat()), 0, 0.22, 0);
  } else if (type === 'defender') {
    add(new THREE.Mesh(geo('cylb', () => new THREE.CylinderGeometry(0.15, 0.19, 0.4, 6)), mat(0x7d838c)), 0, 0.2, 0);
    add(new THREE.Mesh(geo('shield', () => new THREE.BoxGeometry(0.09, 0.36, 0.3)), teamMat()), 0.17, 0.26, 0);
  } else if (type === 'swordsman') {
    add(new THREE.Mesh(geo('oct25', () => new THREE.OctahedronGeometry(0.25)), teamMat()), 0, 0.3, 0);
  } else if (type === 'catapult') {
    add(new THREE.Mesh(geo('catBase', () => new THREE.BoxGeometry(0.42, 0.13, 0.3)), mat(0x8b5a2b)), 0, 0.1, 0);
  } else if (type === 'mindbender') {
    add(new THREE.Mesh(geo('staff', () => new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6)), mat(0xd4d4d8)), 0.15, 0.3, 0);
    add(new THREE.Mesh(geo('robe', () => new THREE.ConeGeometry(0.22, 0.5, 6)), teamMat()), 0, 0.25, 0);
  } else {
    add(new THREE.Mesh(geo('default', () => new THREE.BoxGeometry(0.2, 0.2, 0.2)), teamMat()), 0, 0.2, 0);
  }

  g.userData.teamMats = teamMats;
  return g;
}

export function syncBoard(state) {
  if (!initialized) return Promise.resolve();
  if (!tiles.size) buildTiles(state);

  for (const c of state.cities) {
    const key = hk(c.q, c.r);
    if (!cityNodes.has(key)) {
      const g = new THREE.Mesh(geo('cityMesh', () => new THREE.CylinderGeometry(0.5, 0.55, 0.2, 6)), mat(c.owner ? COLORS[c.owner] : 0xa1a1aa));
      const p = toWorld(c.q, c.r);
      g.position.set(p.x, hexTop(key), p.z);
      scene.add(g);
      cityNodes.set(key, g);
    }
  }

  for (const u of state.units) {
    let node = unitNodes.get(u.id);
    if (!node) {
      const group = unitBody(u.type, u.owner);
      const p = toWorld(u.q, u.r);
      group.position.set(p.x, hexTop(hk(u.q, u.r)), p.z);
      scene.add(group);
      node = { group };
      unitNodes.set(u.id, node);
    } else {
      const p = toWorld(u.q, u.r);
      node.group.position.set(p.x, hexTop(hk(u.q, u.r)), p.z);
    }
  }
  return Promise.resolve();
}

function stepTweens(now) {
  tweens = tweens.filter(tw => {
    const raw = Math.min((now - tw.start) / tw.dur, 1);
    tw.update(raw);
    return raw < 1;
  });
}

function stepEffects(now) {
  effects = effects.filter(e => {
    const raw = Math.min((now - e.start) / e.dur, 1);
    e.update(raw);
    return raw < 1;
  });
}

export function playCombat() { return Promise.resolve(); }
export function setHighlights() {}
