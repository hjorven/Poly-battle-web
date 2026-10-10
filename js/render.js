import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HEX_SIZE, TERRAIN, UNITS, COLORS, MAP_W, MAP_H, MAX_HP } from './config.js';
import { toWorld, fromWorld, forEachHex, hk } from './hex.js';

const TILE_GAP = 0.94;
const DIESE_DUR = 260;

let renderer, scene, camera, controls, raycaster;
let tileMeshes = [];
const tiles = new Map();
const unitNodes = new Map();
const cityNodes = new Map();
let highlightGroup;
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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fc9ea);
  scene.fog = new THREE.Fog(0x8fc9ea, 55, 110);

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
  raycaster = new THREE.Raycaster();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x6e8f5c, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dd, 1.2);
  sun.position.set(24, 34, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 100;
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

  const bounds = mapBounds();
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  camera.position.set(cx - 2, 19, cz + 17);
  camera.lookAt(cx, 0, cz);

  controls = new OrbitControls(camera, canvas);
  controls.target.set(cx, 0, cz);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 7;
  controls.maxDistance = 46;
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
  return hk(h.q, h.r);
}

function buildTiles(state) {
  const tileGeoCache = new Map();
  const trunkGeo = geo('tree_trunk', () => new THREE.CylinderGeometry(0.04, 0.05, 0.22, 5));
  const foliageGeo = geo('tree_foliage', () => new THREE.ConeGeometry(0.2, 0.46, 5));
  const trunkMat = mat(0x5c4033);
  const foliageMat = mat(0x2e7d32);
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
      const mesh = new THREE.Mesh(tileGeoCache.get(t), mat(def.color));
      const p = toWorld(q, r);
      mesh.position.set(p.x, def.height / 2, p.z);
      mesh.receiveShadow = true;
      mesh.castShadow = t === 'mountain';
      mesh.userData.hex = { q, r };
      scene.add(mesh);
      tileMeshes.push(mesh);
      tiles.set(hk(q, r), { mesh, top: def.height, terrain: t });

      if (t === 'forest') {
        const spots = [
          { x: -0.22, z: -0.12 },
          { x: 0.22, z: -0.08 },
          { x: 0.0, z: 0.22 }
        ];
        const n = 1 + ((q * 7 + r * 13) % 2);
        for (let i = 0; i < n + 1 && i < spots.length; i++) {
          const off = spots[(i + ((q + r) % 3)) % spots.length];
          const trunk = new THREE.Mesh(trunkGeo, trunkMat);
          trunk.position.set(off.x, def.height + 0.11, off.z);
          trunk.castShadow = true;
          mesh.add(trunk);
          const foliage = new THREE.Mesh(foliageGeo, foliageMat);
          foliage.position.set(off.x, def.height + 0.4, off.z);
          foliage.castShadow = true;
          mesh.add(foliage);
        }
      } else if (t === 'mountain') {
        const peak = new THREE.Mesh(peakGeo, peakMat);
        peak.position.y = def.height + 0.41;
        peak.rotation.y = 0.4;
        peak.castShadow = true;
        mesh.add(peak);
        const snow = new THREE.Mesh(snowGeo, snowMat);
        snow.position.y = def.height + 0.68;
        snow.castShadow = true;
        mesh.add(snow);
      }
    }
  }
}

function hexTop(key) {
  const t = tiles.get(key);
  return t ? t.top : 0.5;
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

function unitBody(type, owner) {
  const g = new THREE.Group();
  const team = COLORS[owner];
  const teamMats = [];
  const add = (mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
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
  } else if (type === 'mind_bender') {
    add(new THREE.Mesh(geo('robe', () => new THREE.ConeGeometry(0.2, 0.5, 6)), teamMat()), 0, 0.25, 0);
    add(new THREE.Mesh(geo('ico11', () => new THREE.IcosahedronGeometry(0.1, 0)), mat(0xe8c39a)), 0, 0.52, 0);
    add(new THREE.Mesh(geo('orb', () => new THREE.IcosahedronGeometry(0.07, 0)), mat(0xe0b84d)), 0.2, 0.42, 0);
  }

  g.userData.teamMats = teamMats;
  return g;
}

function buildCity(city) {
  const g = new THREE.Group();
  const color = city.owner ? COLORS[city.owner] : 0xb9bdc6;
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
  return g;
}

function placeCityNode(state, city) {
  const key = hk(city.q, city.r);
  const existing = cityNodes.get(key);
  if (existing && existing.owner === city.owner && existing.pop === city.pop) return;
  if (existing) {
    scene.remove(existing.group);
    cityNodes.delete(key);
  }
  const group = buildCity(city);
  const p = toWorld(city.q, city.r);
  group.position.set(p.x, hexTop(key), p.z);
  scene.add(group);
  cityNodes.set(key, { group, owner: city.owner, pop: city.pop });
}

function placeUnitNode(state, unit) {
  const group = unitBody(unit.type, unit.owner);
  const p = toWorld(unit.q, unit.r);
  const key = hk(unit.q, unit.r);
  group.position.set(p.x, hexTop(key), p.z);
  const sprite = makeHpSprite();
  drawHp(sprite, unit.hp);
  sprite.position.y = 0.95;
  group.add(sprite);
  scene.add(group);
  const node = { group, sprite, hp: unit.hp, acted: unit.acted, dying: false };
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

export function syncBoard(state) {
  if (!initialized) return Promise.resolve();
  if (!tiles.size) buildTiles(state);
  for (const c of state.cities) placeCityNode(state, c);

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
    if (node.acted !== u.acted) {
      node.acted = u.acted;
      const f = u.acted ? 0.55 : 1;
      for (const m of node.group.userData.teamMats) {
        m.color.setHex(COLORS[u.owner]).multiplyScalar(f);
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
  city: { color: 0xffe14d, opacity: 0.34 }
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

export function setHighlights({ selected = null, move = null, attack = null, city = null } = {}) {
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
}

export function cameraTo(q, r, close = false) {
  if (!initialized) return;
  const p = toWorld(q, r);
  const fromT = controls.target.clone();
  const toT = new THREE.Vector3(p.x, 0, p.z);
  const fromP = camera.position.clone();
  const off = close ? new THREE.Vector3(0, 11, 10) : new THREE.Vector3(-2, 19, 17);
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
