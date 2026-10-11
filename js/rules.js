import {
  MAP_W, MAP_H, MAX_POP, START_STARS, BASE_CITY_POP,
  TERRAIN, UNITS, TECHS, UNIT_ORDER, COLORS, VISION, ACCELERATOR,
  DEF_BONUS, researchCost, TRIBES, TRIBE_POOL, tribeColor, hasAbility,
  RESOURCES, IMPROVEMENTS
} from './config.js';
import { hk, inBounds, neighbors, hexDistance, forEachHex } from './hex.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const idx = (q, r) => r * MAP_W + q;
export const maxHp = type => UNITS[type].hp;

export function players(state) {
  return state.players && state.players.length ? state.players : ['player_1', 'player_2'];
}

export function tribeOf(state, player) {
  return state.tribes && TRIBES[state.tribes[player]] ? TRIBES[state.tribes[player]] : null;
}

export function tribeName(state, player) {
  const t = tribeOf(state, player);
  return t ? t.name : null;
}

export function playerColor(state, player) {
  const id = state.tribes && state.tribes[player];
  if (id) return tribeColor(id);
  return COLORS[player] ?? COLORS.neutral;
}

export function alive(state, player) {
  return state.cities.some(c => c.owner === player);
}

export function terrainAt(state, q, r) {
  return state.terrain[idx(q, r)];
}

export function unitAt(state, q, r) {
  return state.units.find(u => u.q === q && u.r === r) || null;
}

export function cityAt(state, q, r) {
  return state.cities.find(c => c.q === q && c.r === r) || null;
}

export function findUnit(state, id) {
  return state.units.find(u => u.id === id) || null;
}

export function cityOwner(state, q, r) {
  const c = cityAt(state, q, r);
  return c ? c.owner : undefined;
}

export function citiesFor(state, player) {
  return state.cities.filter(c => c.owner === player);
}

export function coastal(state, city) {
  return neighbors(city.q, city.r).some(([nq, nr]) => {
    const t = terrainAt(state, nq, nr);
    return t === 'water' || t === 'ocean';
  });
}

export function resourceAt(state, q, r) {
  return (state.resources && state.resources[hk(q, r)]) || null;
}

export function improvementAt(state, q, r) {
  return (state.improvements && state.improvements[hk(q, r)]) || null;
}

export function territory(city) {
  return neighbors(city.q, city.r);
}

// Einkommen einer Stadt: Bevölkerung + gesammelte Ressourcen + Gebäude
// im umliegenden Stadtterritorium.
export function cityIncome(state, city) {
  let s = city.pop;
  for (const [nq, nr] of territory(city)) {
    if (resourceAt(state, nq, nr)) s += 1;
    else {
      const imp = improvementAt(state, nq, nr);
      if (imp && IMPROVEMENTS[imp]) s += IMPROVEMENTS[imp].pop;
    }
  }
  return s;
}

export function incomeFor(state, player) {
  let s = 0;
  let cities = 0;
  for (const c of state.cities) if (c.owner === player) { s += cityIncome(state, c); cities += 1; }
  const techs = state.techs[player] || [];
  if (techs.includes('construction')) s += cities;
  if (techs.includes('trade')) s += cities;
  return s;
}

export function maxMove(state, owner, type) {
  const base = UNITS[type].move;
  return state.techs[owner] && state.techs[owner].includes('roads') ? base + 1 : base;
}

function hasTech(state, owner, tech) {
  return !!tech && !!state.techs[owner] && state.techs[owner].includes(tech);
}

export function canEnter(state, unit, tile) {
  const t = TERRAIN[tile];
  if (!t) return false;
  if (hasAbility(unit.type, 'water')) {
    return tile === 'water' || tile === 'ocean';
  }
  if (!t.walkable) return false;
  if (t.enterTech) return hasTech(state, unit.owner, t.enterTech);
  return true;
}

export function defenceBonus(state, defender) {
  const tile = terrainAt(state, defender.q, defender.r);
  const t = TERRAIN[tile];
  let b = t.def;
  if (t.tech && !hasTech(state, defender.owner, t.tech)) b = DEF_BONUS.none;
  const city = cityAt(state, defender.q, defender.r);
  if (city && city.owner === defender.owner && hasAbility(defender.type, 'fortify')) {
    b = Math.max(b, DEF_BONUS.standard);
  }
  return b;
}

// Echte Kampfformel (BattleHelpers / Community-Wiki).
// damage = Schaden am Verteidiger, retaliation = Schaden am Angreifer.
export function battleResults(state, attacker, defender) {
  const A = UNITS[attacker.type];
  const D = UNITS[defender.type];
  const af = A.atk * (attacker.hp / A.hp);
  const df = D.def * (defender.hp / D.hp) * defenceBonus(state, defender);
  const total = af + df;
  if (total <= 0) return { damage: 0, retaliation: 0 };
  const damage = Math.round((af / total) * A.atk * ACCELERATOR);
  const retaliation = Math.round((df / total) * D.def * ACCELERATOR);
  return { damage, retaliation };
}

export function visibleKeys(state, player) {
  const keys = new Set();
  const addArea = (q, r, rad) => {
    forEachHex((nq, nr) => {
      if (hexDistance(q, r, nq, nr) <= rad) keys.add(hk(nq, nr));
    });
  };
  for (const u of state.units) {
    if (u.owner !== player) continue;
    let radius = UNITS[u.type].sight ?? VISION.unit;
    if (terrainAt(state, u.q, u.r) === 'mountain') radius = Math.max(radius, 2);
    if (hasTech(state, player, 'sailing')) radius += 1;
    addArea(u.q, u.r, radius);
  }
  for (const c of state.cities) {
    if (c.owner === player) addArea(c.q, c.r, VISION.city);
  }
  return keys;
}

export function updateExplored(state, player) {
  if (!state.explored || !state.explored[player]) return false;
  const visible = visibleKeys(state, player);
  const known = new Set(state.explored[player]);
  let changed = false;
  for (const k of visible) {
    if (!known.has(k)) { known.add(k); state.explored[player].push(k); changed = true; }
  }
  return changed;
}

export function isExplored(state, player, q, r) {
  if (!player || !state.explored || !state.explored[player]) return true;
  return state.explored[player].includes(hk(q, r));
}

export function canAct(state, player) {
  return !state.winner && state.turn === player;
}

export function startTurn(state) {
  const p = state.turn;
  const spirit = hasTech(state, p, 'spiritualism') ? 1 : 0;

  for (const u of state.units) {
    if (u.owner !== p || !hasAbility(u.type, 'fortify')) continue;
    if (u.acted || u.hasMoved) continue;
    const cap = maxHp(u.type);
    if (u.hp >= cap) continue;
    const city = cityAt(state, u.q, u.r);
    const amt = (city && city.owner === p ? 4 : 2) + spirit;
    u.hp = Math.min(cap, u.hp + amt);
  }
  for (const u of state.units) {
    if (u.owner !== p || !hasAbility(u.type, 'heal') || u.acted || u.hasMoved) continue;
    for (const [nq, nr] of neighbors(u.q, u.r)) {
      const ally = unitAt(state, nq, nr);
      if (ally && ally.owner === p && ally !== u) {
        ally.hp = Math.min(maxHp(ally.type), ally.hp + 4 + spirit);
      }
    }
  }
  for (const u of state.units) {
    if (u.owner === p) {
      u.mp = maxMove(state, p, u.type);
      u.acted = false;
      u.hasMoved = false;
    }
  }
  for (const c of state.cities) {
    if (c.owner === p) c.trained = false;
  }
  state.stars[p] += incomeFor(state, p);
  updateExplored(state, p);
}

export function endTurn(state) {
  const list = players(state);
  const n = list.length;
  const i = list.indexOf(state.turn);
  let next = (i + 1) % n;
  if (next === 0) state.round += 1;
  state.turn = list[next];
  let guard = 0;
  while (!alive(state, state.turn) && guard < n * 2) {
    next = (next + 1) % n;
    if (next === 0) state.round += 1;
    state.turn = list[next];
    guard++;
  }
  startTurn(state);
}

export function canAttackNow(state, unit) {
  if (unit.acted) return false;
  if (unit.hasMoved && !hasAbility(unit.type, 'dash')) return false;
  return true;
}

export function reachableMap(state, unit) {
  const out = new Map();
  if (unit.mp <= 0) return out;
  if (unit.acted && !(hasAbility(unit.type, 'escape') || hasAbility(unit.type, 'persist'))) return out;
  const budget = unit.mp;
  const dist = new Map([[hk(unit.q, unit.r), 0]]);
  const queue = [[unit.q, unit.r, 0]];
  while (queue.length) {
    queue.sort((a, b) => a[2] - b[2]);
    const [q, r, cost] = queue.shift();
    if (cost > (dist.get(hk(q, r)) ?? Infinity)) continue;
    for (const [nq, nr] of neighbors(q, r)) {
      if (unitAt(state, nq, nr)) continue;
      const tile = terrainAt(state, nq, nr);
      if (!canEnter(state, unit, tile)) continue;
      const nc = cost + TERRAIN[tile].move;
      if (nc > budget) continue;
      const k = hk(nq, nr);
      if (nc < (dist.get(k) ?? Infinity)) {
        dist.set(k, nc);
        queue.push([nq, nr, nc]);
      }
    }
  }
  dist.delete(hk(unit.q, unit.r));
  for (const [k, v] of dist) out.set(k, v);
  return out;
}

export function attackTargets(state, unit) {
  if (!canAttackNow(state, unit)) return [];
  const range = UNITS[unit.type].range;
  return state.units.filter(u =>
    u.owner !== unit.owner &&
    hexDistance(unit.q, unit.r, u.q, u.r) <= range &&
    isExplored(state, unit.owner, u.q, u.r)
  );
}

function finishAction(attacker) {
  attacker.acted = true;
  if (!(hasAbility(attacker.type, 'escape') || hasAbility(attacker.type, 'persist'))) {
    attacker.mp = 0;
    attacker.hasMoved = true;
  }
}

export function attack(state, attacker, defender) {
  const events = [];
  const dist = hexDistance(attacker.q, attacker.r, defender.q, defender.r);

  if (hasAbility(attacker.type, 'convert')) {
    if (dist === 1) {
      defender.owner = attacker.owner;
      defender.acted = true;
      defender.mp = 0;
      defender.hasMoved = true;
      events.push({ kind: 'convert', unit: defender.id, to: attacker.owner });
      finishAction(attacker);
      updateExplored(state, attacker.owner);
    }
    return { events, killed: false };
  }

  const res = battleResults(state, attacker, defender);
  defender.hp -= res.damage;
  events.push({ kind: 'damage', from: attacker.id, to: defender.id, dmg: res.damage });

  let killed = false;
  if (defender.hp <= 0) {
    state.units = state.units.filter(u => u !== defender);
    killed = true;
    events.push({ kind: 'kill', unit: defender });
    if (UNITS[attacker.type].range === 1) {
      const tile = terrainAt(state, defender.q, defender.r);
      if (canEnter(state, attacker, tile) && !unitAt(state, defender.q, defender.r)) {
        attacker.q = defender.q;
        attacker.r = defender.r;
        const city = cityAt(state, attacker.q, attacker.r);
        if (city && city.owner !== attacker.owner) {
          const prev = city.owner;
          city.owner = attacker.owner;
          events.push({ kind: 'capture', city, from: prev, to: attacker.owner });
          checkWinner(state);
        }
      }
    }
  } else if (!hasAbility(defender.type, 'stiff') && UNITS[defender.type].range >= dist && res.retaliation > 0) {
    attacker.hp -= res.retaliation;
    events.push({ kind: 'retaliate', from: defender.id, to: attacker.id, dmg: res.retaliation });
    if (attacker.hp <= 0) {
      state.units = state.units.filter(u => u !== attacker);
      events.push({ kind: 'kill', unit: attacker });
    }
  }

  finishAction(attacker);
  updateExplored(state, attacker.owner);
  return { events, killed };
}

export function moveUnit(state, unit, q, r) {
  const reach = reachableMap(state, unit);
  const k = hk(q, r);
  if (!reach.has(k)) return { ok: false };
  unit.mp -= reach.get(k);
  unit.q = q;
  unit.r = r;
  unit.hasMoved = true;
  const events = [];
  const city = cityAt(state, q, r);
  if (city && city.owner !== unit.owner) {
    const prev = city.owner;
    city.owner = unit.owner;
    events.push({ kind: 'capture', city, from: prev, to: unit.owner });
    checkWinner(state);
  }
  updateExplored(state, unit.owner);
  return { ok: true, events };
}

export function checkWinner(state) {
  const list = players(state);
  const aliveList = list.filter(p => alive(state, p));
  if (aliveList.length === 1) state.winner = aliveList[0];
  const dead = new Set(list.filter(p => !alive(state, p)));
  if (dead.size) state.units = state.units.filter(u => !dead.has(u.owner));
}

export function unlockedUnits(state, player) {
  return UNIT_ORDER.filter(t => !UNITS[t].tech || state.techs[player].includes(UNITS[t].tech));
}

export function canTrain(state, city, type, player) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  if (city.owner !== player) return { ok: false, reason: 'Fremde Stadt' };
  if (city.trained) return { ok: false, reason: 'Bereits ausgebildet' };
  if (unitAt(state, city.q, city.r)) return { ok: false, reason: 'Stadt besetzt' };
  const u = UNITS[type];
  if (!u) return { ok: false, reason: 'Unbekannte Einheit' };
  if (u.tech && !state.techs[player].includes(u.tech)) return { ok: false, reason: 'Technologie fehlt' };
  if (hasAbility(type, 'water') && !coastal(state, city)) return { ok: false, reason: 'Küstenstadt nötig' };
  if (state.stars[player] < u.cost) return { ok: false, reason: 'Zu wenig Sterne' };
  return { ok: true };
}

let unitSeq = 0;
export function trainUnit(state, city, type, player) {
  const chk = canTrain(state, city, type, player);
  if (!chk.ok) return chk;
  state.stars[player] -= UNITS[type].cost;
  city.trained = true;
  state.units.push({
    id: `${player.replace('_', '')}_${Date.now().toString(36)}_${unitSeq++}`,
    owner: player, type, q: city.q, r: city.r,
    hp: maxHp(type), mp: maxMove(state, player, type), hasMoved: false, acted: false
  });
  updateExplored(state, player);
  return { ok: true };
}

export function popCost(city) {
  return city.pop + 2;
}

export function canBuyPop(state, city, player) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  if (city.owner !== player) return { ok: false, reason: 'Fremde Stadt' };
  if (city.pop >= MAX_POP) return { ok: false, reason: 'Maximale Bevölkerung' };
  if (unitAt(state, city.q, city.r)) return { ok: false, reason: 'Stadt besetzt' };
  if (state.stars[player] < popCost(city)) return { ok: false, reason: 'Zu wenig Sterne' };
  return { ok: true };
}

export function buyPop(state, city, player) {
  const chk = canBuyPop(state, city, player);
  if (!chk.ok) return chk;
  state.stars[player] -= popCost(city);
  city.pop += 1;
  return { ok: true };
}

// --- Gebäude (Improvements) ------------------------------------------------

export function canImprove(state, city, type, q, r) {
  const def = IMPROVEMENTS[type];
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  if (!def) return { ok: false, reason: 'Unbekanntes Gebäude' };
  const dq = q - city.q, dr = r - city.r;
  const adjacent = (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2 === 1;
  if (!adjacent) return { ok: false, reason: 'Nicht im Stadtgebiet' };
  if (!def.terrain.includes(terrainAt(state, q, r))) return { ok: false, reason: 'Falsches Gelände' };
  if (improvementAt(state, q, r)) return { ok: false, reason: 'Bereits bebaut' };
  if (resourceAt(state, q, r)) return { ok: false, reason: 'Ressource wird genutzt' };
  if (unitAt(state, q, r)) return { ok: false, reason: 'Einheit im Weg' };
  return { ok: true };
}

export function improve(state, city, type, q, r, player) {
  const chk = canImprove(state, city, type, q, r);
  if (!chk.ok) return chk;
  if (city.owner !== player) return { ok: false, reason: 'Fremde Stadt' };
  const def = IMPROVEMENTS[type];
  if (def.tech && !state.techs[player].includes(def.tech)) return { ok: false, reason: 'Technologie fehlt' };
  if (state.stars[player] < def.cost) return { ok: false, reason: 'Zu wenig Sterne' };
  state.stars[player] -= def.cost;
  if (!state.improvements) state.improvements = {};
  state.improvements[hk(q, r)] = type;
  return { ok: true };
}

export function attackPreview(state, attacker) {
  return attackTargets(state, attacker).map(target => {
    const { damage, retaliation } = battleResults(state, attacker, target);
    return { target, damage, retaliation };
  });
}

export function techCost(state, techId, player) {
  const t = TECHS[techId];
  const cities = citiesFor(state, player).length;
  const discount = state.techs[player].includes('philosophy');
  return researchCost(t.tier, cities, discount);
}

export function canResearch(state, techId, player) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  const t = TECHS[techId];
  if (!t) return { ok: false, reason: 'Unbekannte Technologie' };
  if (state.techs[player].includes(techId)) return { ok: false, reason: 'Bereits erforscht' };
  if (t.req && !state.techs[player].includes(t.req)) return { ok: false, reason: 'Voraussetzung fehlt' };
  if (state.stars[player] < techCost(state, techId, player)) return { ok: false, reason: 'Zu wenig Sterne' };
  return { ok: true };
}

export function research(state, techId, player) {
  const chk = canResearch(state, techId, player);
  if (!chk.ok) return chk;
  state.stars[player] -= techCost(state, techId, player);
  state.techs[player].push(techId);
  return { ok: true };
}

// --- Weltgenerierung -------------------------------------------------------

function makeNoise(rand) {
  const grid = new Map();
  const val = (x, y) => {
    const k = x + ',' + y;
    if (!grid.has(k)) grid.set(k, rand());
    return grid.get(k);
  };
  const smooth = t => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  return (x, y, scale) => {
    const fx = x / scale, fy = y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    return lerp(
      lerp(val(x0, y0), val(x0 + 1, y0), tx),
      lerp(val(x0, y0 + 1), val(x0 + 1, y0 + 1), tx),
      ty
    );
  };
}

function generateTerrain(rand) {
  const noise = makeNoise(rand);
  const moist = (q, r) => noise(q + 1000, r + 1000, 3.2);
  const t = new Array(MAP_W * MAP_H);
  for (let r = 0; r < MAP_H; r++) {
    for (let q = 0; q < MAP_W; q++) {
      const e = noise(q, r, 5) * 0.62 + noise(q, r, 2.6) * 0.38;
      const edge = Math.min(q, r, MAP_W - 1 - q, MAP_H - 1 - r);
      let tile;
      if (edge < 1) tile = 'ocean';
      else if (e < 0.33) tile = 'ocean';
      else if (e < 0.42) tile = 'water';
      else if (e > 0.80) tile = 'mountain';
      else if (moist(q, r) > 0.6) tile = 'forest';
      else tile = 'field';
      if ((r <= 0 || r >= MAP_H - 1) && tile !== 'ocean' && tile !== 'water') tile = 'ice';
      t[r * MAP_W + q] = tile;
    }
  }
  return t;
}

function floodReachable(state, sq, sr) {
  const seen = new Set([hk(sq, sr)]);
  const queue = [[sq, sr]];
  while (queue.length) {
    const [q, r] = queue.shift();
    for (const [nq, nr] of neighbors(q, r)) {
      const k = hk(nq, nr);
      if (seen.has(k)) continue;
      const tile = terrainAt(state, nq, nr);
      const def = TERRAIN[tile];
      if (!def.walkable || def.enterTech) continue;
      seen.add(k);
      queue.push([nq, nr]);
    }
  }
  return seen;
}

function carveLine(state, q1, r1, q2, r2, wide = true) {
  const steps = Math.max(hexDistance(q1, r1, q2, r2) * (wide ? 2 : 1), 2);
  const offs = wide ? [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, -1]] : [[0, 0]];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const q = Math.round(q1 + (q2 - q1) * t);
    const r = Math.round(r1 + (r2 - r1) * t);
    for (const [dq, dr] of offs) {
      const nq = q + dq, nr = r + dr;
      if (inBounds(nq, nr)) state.terrain[idx(nq, nr)] = 'field';
    }
  }
}

export function assignTribes(seed, count, chosenTribe = null) {
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const pool = TRIBE_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out = {};
  if (chosenTribe && TRIBES[chosenTribe]) {
    out['player_1'] = chosenTribe;
    const rest = pool.filter(t => t !== chosenTribe);
    for (let k = 1; k < count; k++) out['player_' + (k + 1)] = rest[(k - 1) % rest.length];
    return out;
  }
  for (let k = 0; k < count; k++) out['player_' + (k + 1)] = pool[k % pool.length];
  return out;
}

function generateResources(state, rand, centers) {
  const place = (q, r, type) => { state.resources[hk(q, r)] = type; };
  const typesFor = tile => Object.keys(RESOURCES).filter(k => RESOURCES[k].terrain.includes(tile));
  forEachHex((q, r) => {
    const tile = state.terrain[idx(q, r)];
    const opts = typesFor(tile);
    if (!opts.length) return;
    const chance = tile === 'water' ? 0.16 : tile === 'ocean' ? 0.05 : 0.09;
    if (rand() < chance) place(q, r, opts[Math.floor(rand() * opts.length)]);
  });
  for (const [sq, sr] of centers) {
    const tiles = neighbors(sq, sr).filter(([q, r]) =>
      !state.cities.some(c => c.q === q && c.r === r) && typesFor(state.terrain[idx(q, r)]).length
    );
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    let made = 0;
    for (const [q, r] of tiles) {
      if (made >= 2) break;
      place(q, r, typesFor(state.terrain[idx(q, r)])[0]);
      made++;
    }
  }
}

let startSeq = 0;
export function createGame(seed = Date.now(), playerCount = 4, chosenTribe = null) {
  const rand = mulberry32(seed);
  const count = Math.min(Math.max(playerCount, 2), 4);
  const tribes = assignTribes(seed, count, chosenTribe);
  const state = {
    terrain: generateTerrain(rand),
    cities: [], units: [], resources: {}, improvements: {},
    players: Array.from({ length: count }, (_, k) => 'player_' + (k + 1)),
    tribes,
    stars: {}, techs: {}, explored: {},
    turn: 'player_1', round: 1, winner: null
  };
  for (const p of state.players) {
    const tr = TRIBES[tribes[p]];
    state.stars[p] = START_STARS + (tr ? tr.bonusStars : 0);
    state.techs[p] = tr ? ['basic', ...tr.startTechs] : ['basic'];
    state.explored[p] = [];
  }

  const starts = count === 4
    ? [[1, MAP_H - 2], [MAP_W - 2, MAP_H - 2], [MAP_W - 2, 1], [1, 1]]
    : [[1, MAP_H - 2], [MAP_W - 2, 1]];
  const clearAround = (q, r, rad) => {
    forEachHex((nq, nr) => {
      if (hexDistance(q, r, nq, nr) <= rad) state.terrain[idx(nq, nr)] = 'field';
    });
  };
  for (const [q, r] of starts) clearAround(q, r, 2);
  if (count === 4) {
    for (let i = 0; i < starts.length; i++) {
      const a = starts[i], b = starts[(i + 1) % starts.length];
      carveLine(state, a[0], a[1], b[0], b[1], false);
    }
    carveLine(state, starts[0][0], starts[0][1], starts[2][0], starts[2][1], false);
    carveLine(state, starts[1][0], starts[1][1], starts[3][0], starts[3][1], false);
  } else {
    carveLine(state, starts[0][0], starts[0][1], starts[1][0], starts[1][1]);
  }

  const reachable = floodReachable(state, starts[0][0], starts[0][1]);

  const candidates = [];
  forEachHex((q, r) => {
    const k = hk(q, r);
    if (!reachable.has(k)) return;
    const def = TERRAIN[state.terrain[idx(q, r)]];
    if (!def.walkable || def.enterTech) return;
    candidates.push([q, r]);
  });
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const placeCity = (q, r, owner, pop) => {
    state.terrain[idx(q, r)] = 'field';
    state.cities.push({ q, r, owner, pop, trained: false });
  };

  const nearest = (tq, tr, minDistFrom, centers) => {
    let best = null, bd = Infinity;
    for (const [q, r] of candidates) {
      if (state.cities.some(c => c.q === q && c.r === r)) continue;
      const dFrom = Math.min(...centers.map(([cq, cr]) => hexDistance(q, r, cq, cr)));
      if (dFrom < minDistFrom) continue;
      const d = hexDistance(q, r, tq, tr);
      if (d < bd) { bd = d; best = [q, r]; }
    }
    return best;
  };

  const centerCities = [];
  for (let k = 0; k < count; k++) {
    const [sq, sr] = starts[k];
    const owner = 'player_' + (k + 1);
    const c = nearest(sq, sr, 3, starts) || candidates[k % candidates.length];
    placeCity(c[0], c[1], owner, BASE_CITY_POP);
    centerCities.push(c);
  }

  let placed = count;
  const maxCities = 4 + count * 2;
  for (const [q, r] of candidates) {
    if (placed >= maxCities) break;
    if (state.cities.some(c => c.q === q && c.r === r)) continue;
    if (state.cities.some(c => hexDistance(q, r, c.q, c.r) < 4)) continue;
    if (starts.some(([sq, sr]) => hexDistance(q, r, sq, sr) < 3)) continue;
    placeCity(q, r, null, 1);
    placed++;
  }

  const spawnUnit = (owner, type, q, r) => {
    state.units.push({
      id: `${owner.replace('_', '')}_start_${startSeq++}`,
      owner, type, q, r, hp: maxHp(type), mp: maxMove(state, owner, type),
      hasMoved: false, acted: false
    });
  };
  for (let k = 0; k < count; k++) {
    const owner = 'player_' + (k + 1);
    const city = state.cities.find(c => c.owner === owner);
    const tr = TRIBES[tribes[owner]];
    const units = tr ? tr.startUnits : ['warrior'];
    let first = true;
    for (const type of units) {
      let q = city.q, r = city.r;
      if (!first || unitAt(state, q, r)) {
        const opts = neighbors(city.q, city.r).filter(([nq, nr]) =>
          canEnter(state, { owner, type }, terrainAt(state, nq, nr)) && !unitAt(state, nq, nr) && !cityAt(state, nq, nr)
        );
        if (!opts.length) continue;
        [q, r] = opts[0];
      }
      spawnUnit(owner, type, q, r);
      first = false;
    }
  }

  generateResources(state, rand, centerCities);
  startTurn(state);
  return state;
}

export function stateSummary(state, player) {
  return {
    cities: citiesFor(state, player).length,
    units: state.units.filter(u => u.owner === player).length,
    stars: state.stars[player],
    techs: state.techs[player].length
  };
}
