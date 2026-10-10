import {
  MAP_W, MAP_H, MAX_HP, MAX_POP, START_STARS, BASE_CITY_POP,
  TERRAIN, UNITS, TECHS, UNIT_ORDER, COLORS, VISION, researchCost,
  TRIBES, TRIBE_POOL
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

export function incomeFor(state, player) {
  let s = 0;
  let cities = 0;
  for (const c of state.cities) if (c.owner === player) { s += c.pop; cities += 1; }
  if (state.techs[player].includes('organisation')) s += cities;
  if (state.techs[player].includes('landwirtschaft')) s += cities;
  return s;
}

export function maxMove(state, owner, type) {
  const base = UNITS[type].move;
  return state.techs[owner] && state.techs[owner].includes('roesser') ? base + 1 : base;
}

export function citiesFor(state, player) {
  return state.cities.filter(c => c.owner === player);
}

export function visibleKeys(state, player) {
  const keys = new Set();
  const addArea = (q, r, rad) => {
    forEachHex((nq, nr) => {
      if (hexDistance(q, r, nq, nr) <= rad) keys.add(hk(nq, nr));
    });
  };
  for (const u of state.units) {
    if (u.owner === player) addArea(u.q, u.r, UNITS[u.type].sight ?? VISION.unit);
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
  for (const u of state.units) {
    if (u.owner === p) {
      u.mp = maxMove(state, p, u.type);
      u.acted = false;
    }
  }
  for (const u of state.units) {
    if (u.owner !== p || !UNITS[u.type].heal) continue;
    for (const [nq, nr] of neighbors(u.q, u.r)) {
      const ally = unitAt(state, nq, nr);
      if (ally && ally.owner === p && ally !== u) {
        ally.hp = Math.min(MAX_HP, ally.hp + UNITS[u.type].heal);
      }
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

export function reachableMap(state, unit) {
  const out = new Map();
  if (unit.acted || unit.mp <= 0) return out;
  const budget = unit.mp;
  const climb = !!(state.techs[unit.owner] && state.techs[unit.owner].includes('klettern'));
  const dist = new Map([[hk(unit.q, unit.r), 0]]);
  const queue = [[unit.q, unit.r, 0]];
  while (queue.length) {
    queue.sort((a, b) => a[2] - b[2]);
    const [q, r, cost] = queue.shift();
    if (cost > (dist.get(hk(q, r)) ?? Infinity)) continue;
    for (const [nq, nr] of neighbors(q, r)) {
      if (unitAt(state, nq, nr)) continue;
      const tile = terrainAt(state, nq, nr);
      const t = TERRAIN[tile];
      if (!t.walkable && !(climb && tile === 'mountain')) continue;
      const nc = cost + t.move;
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
  if (unit.acted) return [];
  const range = UNITS[unit.type].range;
  return state.units.filter(u =>
    u.owner !== unit.owner &&
    hexDistance(unit.q, unit.r, u.q, u.r) <= range &&
    isExplored(state, unit.owner, u.q, u.r)
  );
}

export function combatDamage(attacker, defender, defTerrain) {
  const a = UNITS[attacker.type];
  const d = UNITS[defender.type];
  const hpF = attacker.hp / MAX_HP;
  const terr = TERRAIN[defTerrain].def;
  const base = a.atk * 2 * hpF;
  const mit = 10 / (10 + d.def + terr);
  return Math.max(1, Math.floor(base * mit));
}

export function attack(state, attacker, defender) {
  const events = [];
  const dist = hexDistance(attacker.q, attacker.r, defender.q, defender.r);
  const dmg = combatDamage(attacker, defender, terrainAt(state, defender.q, defender.r));
  defender.hp -= dmg;
  events.push({ kind: 'damage', from: attacker.id, to: defender.id, dmg });
  let killed = false;
  if (defender.hp <= 0) {
    state.units = state.units.filter(u => u !== defender);
    killed = true;
    events.push({ kind: 'kill', unit: defender });
  } else if (dist === 1 && UNITS[defender.type].range === 1) {
    const back = Math.max(1, Math.round(0.5 * combatDamage(defender, attacker, terrainAt(state, attacker.q, attacker.r))));
    attacker.hp -= back;
    events.push({ kind: 'retaliate', from: defender.id, to: attacker.id, dmg: back });
    if (attacker.hp <= 0) {
      state.units = state.units.filter(u => u !== attacker);
      events.push({ kind: 'kill', unit: attacker });
    }
  }
  attacker.acted = true;
  attacker.mp = 0;
  return { events, killed };
}

export function moveUnit(state, unit, q, r) {
  const reach = reachableMap(state, unit);
  const k = hk(q, r);
  if (!reach.has(k)) return { ok: false };
  unit.mp -= reach.get(k);
  unit.q = q;
  unit.r = r;
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
  if (u.tech && !state.techs[player].includes(u.tech)) return { ok: false, reason: 'Technologie fehlt' };
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
    hp: MAX_HP, mp: maxMove(state, player, type), acted: false
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

export function techCost(state, techId, player) {
  const t = TECHS[techId];
  const cities = citiesFor(state, player).length;
  const discount = state.techs[player].includes('philosophie');
  return researchCost(t.tier, cities, discount);
}

export function canResearch(state, techId, player) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  const t = TECHS[techId];
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

function generateTerrain(rand) {
  const t = new Array(MAP_W * MAP_H);
  for (let i = 0; i < t.length; i++) {
    const roll = rand();
    if (roll < 0.20) t[i] = 'water';
    else if (roll < 0.45) t[i] = 'forest';
    else if (roll < 0.57) t[i] = 'mountain';
    else t[i] = 'plains';
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
      if (!TERRAIN[terrainAt(state, nq, nr)].walkable) continue;
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
      if (inBounds(nq, nr)) state.terrain[idx(nq, nr)] = 'plains';
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

export function createGame(seed = Date.now(), playerCount = 4, chosenTribe = null) {
  const rand = mulberry32(seed);
  const count = Math.min(Math.max(playerCount, 2), 4);
  const tribes = assignTribes(seed, count, chosenTribe);
  const state = {
    terrain: generateTerrain(rand),
    cities: [], units: [],
    players: Array.from({ length: count }, (_, k) => 'player_' + (k + 1)),
    tribes,
    stars: {}, techs: {}, explored: {},
    turn: 'player_1', round: 1, winner: null
  };
  for (const p of state.players) {
    state.stars[p] = START_STARS;
    state.techs[p] = tribes[p] ? TRIBES[tribes[p]].startTechs.slice() : [];
    state.explored[p] = [];
  }

  const starts = count === 4
    ? [[1, MAP_H - 2], [MAP_W - 2, MAP_H - 2], [MAP_W - 2, 1], [1, 1]]
    : [[1, MAP_H - 2], [MAP_W - 2, 1]];
  const clearAround = (q, r, rad) => {
    forEachHex((nq, nr) => {
      if (hexDistance(q, r, nq, nr) <= rad) state.terrain[idx(nq, nr)] = 'plains';
    });
  };
  for (const [q, r] of starts) clearAround(q, r, 2);
  if (count === 4) {
    for (let i = 0; i < starts.length; i++) {
      const a = starts[i], b = starts[(i + 1) % starts.length];
      carveLine(state, a[0], a[1], b[0], b[1], false);
    }
  } else {
    carveLine(state, starts[0][0], starts[0][1], starts[1][0], starts[1][1]);
  }

  const reachable = floodReachable(state, starts[0][0], starts[0][1]);

  const candidates = [];
  forEachHex((q, r) => {
    const k = hk(q, r);
    if (!reachable.has(k)) return;
    if (state.terrain[idx(q, r)] === 'water' || state.terrain[idx(q, r)] === 'mountain') return;
    candidates.push([q, r]);
  });
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const placeCity = (q, r, owner, pop) => {
    state.terrain[idx(q, r)] = 'plains';
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
    const c = nearest(sq, sr, 3, starts) || candidates[listIndex(candidates, k)];
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
    placeCity(q, r, null, 1 + Math.floor(rand() * 3));
    placed++;
  }

  const addUnit = (owner, type, q, r) => {
    state.units.push({
      id: `${owner.replace('_', '')}_start_${state.units.length}`,
      owner, type, q, r, hp: MAX_HP, mp: maxMove(state, owner, type), acted: false
    });
  };
  const spawnAround = (owner, city) => {
    addUnit(owner, 'warrior', city.q, city.r);
    const opts = neighbors(city.q, city.r).filter(([nq, nr]) =>
      TERRAIN[terrainAt(state, nq, nr)].walkable &&
      !unitAt(state, nq, nr) &&
      !cityAt(state, nq, nr)
    );
    if (opts.length) addUnit(owner, 'warrior', opts[0][0], opts[0][1]);
  };
  for (let k = 0; k < count; k++) {
    spawnAround('player_' + (k + 1), state.cities.find(c => c.owner === 'player_' + (k + 1)));
  }

  startTurn(state);
  return state;
}

function listIndex(candidates, k) {
  const used = candidates.length - 1 - k;
  return Math.max(used, 0);
}

export function stateSummary(state, player) {
  return {
    cities: citiesFor(state, player).length,
    units: state.units.filter(u => u.owner === player).length,
    stars: state.stars[player],
    techs: state.techs[player].length
  };
}
