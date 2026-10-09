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

  const hemi = new THREE.HemisphereLight(0xffffff, 0xd4d4d8, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(24, 34, 14);
  sun.castShadow = true;
  scene.add(sun);

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

  function loop() {
    requestAnimationFrame(loop);
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

// --- 3D DEKORATIONEN FÜR GELÄNDE ---

function addForestTrees(parent, topY) {
  const trunkGeo = geo('tree_trunk', () => new THREE.CylinderGeometry(0.04, 0.05, 0.22, 5));
  const foliageGeo = geo('tree_foliage', () => new THREE.ConeGeometry(0.22, 0.5, 5));
  const trunkMat = mat(0x5c4033);
  const foliageMat = mat(0x2e7d32);

  const offsets = [
    { x: -0.22, z: -0.12 },
    { x: 0.22, z: -0.08 },
    { x: 0, z: 0.22 }
  ];

  offsets.forEach(off => {
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(off.x, topY + 0.11, off.z);
    parent.add(trunk);

    const foliage = new THREE.Mesh(foliageGeo, foliageMat);
    foliage.position.set(off.x, topY + 0.4, off.z);
    parent.add(foliage);
  });
}

function addMountainPeaks(parent, topY) {
  const peakGeo = geo('mountain_peak', () => new THREE.ConeGeometry(0.55, 0.85, 6));
  const snowGeo = geo('mountain_snow', () => new THREE.ConeGeometry(0.28, 0.35, 6));
  const peakMat = mat(0x6b7280);
  const snowMat = mat(0xf9fafb);

  const peak = new THREE.Mesh(peakGeo, peakMat);
  peak.position.set(0, topY + 0.42, 0);
  parent.add(peak);

  const snow = new THREE.Mesh(snowGeo, snowMat);
  snow.position.set(0, topY + 0.68, 0);
  parent.add(snow);
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

      if (t === 'forest') addForestTrees(mesh, def.height / 2);
      else if (t === 'mountain') addMountainPeaks(mesh, def.height / 2);

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

// --- 3D GEBÄUDE FÜR STÄDTE ---

function buildCityModel(owner) {
  const g = new THREE.Group();
  const teamColor = COLORS[owner] || COLORS.neutral;
  const wallMat = mat(0xe5e7eb);
  const roofMat = mat(teamColor);
  const baseMat = mat(0x9ca3af);

  // Fundament
  const base = new THREE.Mesh(geo('cityBase', () => new THREE.CylinderGeometry(0.55, 0.6, 0.12, 6)), baseMat);
  base.position.y = 0.06;
  g.add(base);

  // Hauptturm
  const tower = new THREE.Mesh(geo('cityTower', () => new THREE.BoxGeometry(0.32, 0.45, 0.32)), wallMat);
  tower.position.set(0, 0.32, 0);
  g.add(tower);

  const roof = new THREE.Mesh(geo('cityRoof', () => new THREE.ConeGeometry(0.28, 0.32, 4)), roofMat);
  roof.position.set(0, 0.7, 0);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);

  // Kleine Nebenhäuser
  const houseGeo = geo('house', () => new THREE.BoxGeometry(0.18, 0.2, 0.18));
  const houseRoofGeo = geo('houseRoof', () => new THREE.ConeGeometry(0.15, 0.18, 4));

  const housePositions = [
    { x: -0.25, z: 0.15 },
    { x: 0.25, z: 0.15 },
    { x: 0, z: -0.28 }
  ];

  housePositions.forEach(pos => {
    const h = new THREE.Mesh(houseGeo, wallMat);
    h.position.set(pos.x, 0.2, pos.z);
    g.add(h);

    const hr = new THREE.Mesh(houseRoofGeo, roofMat);
    hr.position.set(pos.x, 0.38, pos.z);
    hr.rotation.y = Math.PI / 4;
    g.add(hr);
  });

  return g;
}

// --- 3D FIGUR-MODELLE FÜR EINHEITEN ---

function unitBody(type, owner) {
  const g = new THREE.Group();
  const team = COLORS[owner] || 0x71717a;
  const teamMat = mat(team);
  const skinMat = mat(0xffdbac);
  const woodMat = mat(0x8b5a2b);
  const metalMat = mat(0xd1d5db);

  const add = (mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };

  // Basiskörper (Torso + Kopf) für Infanterie
  const addHumanoid = (yOffset = 0) => {
    const body = new THREE.Mesh(geo('u_body', () => new THREE.CylinderGeometry(0.12, 0.1, 0.28, 6)), teamMat);
    const head = new THREE.Mesh(geo('u_head', () => new THREE.SphereGeometry(0.09, 8, 8)), skinMat);
    add(body, 0, yOffset + 0.2, 0);
    add(head, 0, yOffset + 0.38, 0);
  };

  if (type === 'warrior') {
    addHumanoid();
    // Schwert & Schild
    add(new THREE.Mesh(geo('u_sword', () => new THREE.BoxGeometry(0.04, 0.3, 0.04)), metalMat), 0.16, 0.26, 0.05);
    add(new THREE.Mesh(geo('u_shield', () => new THREE.BoxGeometry(0.05, 0.22, 0.18)), teamMat), -0.16, 0.24, 0);

  } else if (type === 'rider') {
    // Pferd
    add(new THREE.Mesh(geo('u_horse_body', () => new THREE.BoxGeometry(0.24, 0.2, 0.48)), woodMat), 0, 0.2, 0);
    add(new THREE.Mesh(geo('u_horse_head', () => new THREE.BoxGeometry(0.12, 0.18, 0.22)), woodMat), 0, 0.35, 0.2);
    // Reiter
    addHumanoid(0.18);
    // Lanze
    add(new THREE.Mesh(geo('u_spear', () => new THREE.CylinderGeometry(0.02, 0.02, 0.55, 5)), woodMat), 0.18, 0.45, 0.1);

  } else if (type === 'archer') {
    addHumanoid();
    // Bogen
    add(new THREE.Mesh(geo('u_bow', () => new THREE.TorusGeometry(0.12, 0.02, 4, 8, Math.PI)), woodMat), 0.15, 0.28, 0);

  } else if (type === 'defender') {
    addHumanoid();
    // Großer Schild & Helm
    add(new THREE.Mesh(geo('u_big_shield', () => new THREE.BoxGeometry(0.06, 0.35, 0.28)), metalMat), 0, 0.24, 0.18);
    add(new THREE.Mesh(geo('u_helmet', () => new THREE.ConeGeometry(0.11, 0.12, 6)), metalMat), 0, 0.46, 0);

  } else if (type === 'swordsman') {
    addHumanoid();
    // Rüstung & großes Schwert
    add(new THREE.Mesh(geo('u_armor', () => new THREE.CylinderGeometry(0.13, 0.12, 0.2, 6)), metalMat), 0, 0.2, 0);
    add(new THREE.Mesh(geo('u_big_sword', () => new THREE.BoxGeometry(0.05, 0.42, 0.06)), metalMat), 0.18, 0.32, 0);

  } else if (type === 'catapult') {
    // Katapult-Gestell
    add(new THREE.Mesh(geo('u_cat_frame', () => new THREE.BoxGeometry(0.38, 0.12, 0.48)), woodMat), 0, 0.12, 0);
    // Räder
    const wheelGeo = geo('u_wheel', () => new THREE.CylinderGeometry(0.08, 0.08, 0.04, 8));
    const w1 = add(new THREE.Mesh(wheelGeo, metalMat), -0.2, 0.08, 0.18);
    const w2 = add(new THREE.Mesh(wheelGeo, metalMat), 0.2, 0.08, 0.18);
    w1.rotation.z = Math.PI / 2;
    w2.rotation.z = Math.PI / 2;
    // Wurfarm
    const arm = add(new THREE.Mesh(geo('u_cat_arm', () => new THREE.BoxGeometry(0.06, 0.38, 0.06)), woodMat), 0, 0.28, -0.05);
    arm.rotation.x = -Math.PI / 6;

  } else if (type === 'mindbender') {
    // Robe
    add(new THREE.Mesh(geo('u_robe', () => new THREE.ConeGeometry(0.18, 0.4, 6)), teamMat), 0, 0.2, 0);
    add(new THREE.Mesh(geo('u_head', () => new THREE.SphereGeometry(0.09, 8, 8)), skinMat), 0, 0.42, 0);
    // Zauberstab mit leuchtendem Kristall
    add(new THREE.Mesh(geo('u_staff', () => new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6)), woodMat), 0.15, 0.32, 0.1);
    add(new THREE.Mesh(geo('u_orb', () => new THREE.OctahedronGeometry(0.06)), mat(0x60a5fa)), 0.15, 0.64, 0.1);

  } else {
    addHumanoid();
  }

  return g;
}

export function syncBoard(state) {
  if (!initialized) return Promise.resolve();
  if (!tiles.size) buildTiles(state);

  // Städte aktualisieren
  for (const c of state.cities) {
    const key = hk(c.q, c.r);
    let node = cityNodes.get(key);
    if (!node) {
      node = buildCityModel(c.owner);
      const p = toWorld(c.q, c.r);
      node.position.set(p.x, hexTop(key), p.z);
      scene.add(node);
      cityNodes.set(key, node);
    }
  }

  // Einheiten aktualisieren
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

export function playCombat() { return Promise.resolve(); }
export function setHighlights() {}
