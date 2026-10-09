import {
  MAP_W, MAP_H, MAX_HP, MAX_POP, START_STARS, BASE_CITY_POP,
  TERRAIN, UNITS, TECHS, TRIBES
} from './config.js';
import { hk, inBounds, neighbors, hexDistance, forEachHex } from './hex.js';

const idx = (q, r) => r * MAP_W + q;
const other = p => (p === 'player_1' ? 'player_2' : 'player_1');

export function terrainAt(state, q, r) { return state.terrain[idx(q, r)]; }
export function unitAt(state, q, r) { return state.units.find(u => u.q === q && u.r === r) || null; }
export function cityAt(state, q, r) { return state.cities.find(c => c.q === q && c.r === r) || null; }
export function findUnit(state, id) { return state.units.find(u => u.id === id) || null; }

export function techCost(state, techId, player) {
  const t = TECHS[techId];
  if (!t) return 0;
  const cities = state.cities.filter(c => c.owner === player).length || 1;
  return t.baseCost + (cities - 1) * t.tier;
}

export function incomeFor(state, player) {
  let s = 0;
  for (const c of state.cities) {
    if (c.owner === player) {
      s += c.pop;
      if (c.workshop) s += 1;
    }
  }
  if (state.techs[player].includes('organisation')) {
    s += state.cities.filter(c => c.owner === player).length;
  }
  return s;
}

export function startTurn(state) {
  const p = state.turn;
  for (const u of state.units) {
    if (u.owner === p) {
      const def = UNITS[u.type];
      if (!u.acted && u.hp < (u.maxHp || MAX_HP)) {
        const inCity = state.cities.some(c => c.q === u.q && c.r === u.r && c.owner === p);
        u.hp = Math.min(u.maxHp || MAX_HP, u.hp + (inCity ? 4 : 2));
      }
      u.mp = def.move;
      u.acted = false;
      u.hasAttacked = false;
    }
  }
  for (const c of state.cities) {
    if (c.owner === p) c.trained = false;
  }
  state.stars[p] += incomeFor(state, p);
  updateFogOfWar(state, p);
}

export function endTurn(state) {
  state.turn = other(state.turn);
  if (state.turn === 'player_1') state.round += 1;
  startTurn(state);
}

export function updateFogOfWar(state, player) {
  if (!state.explored) state.explored = { player_1: new Set(), player_2: new Set() };
  const vis = state.explored[player];
  
  for (const c of state.cities) {
    if (c.owner === player) {
      forEachHex((nq, nr) => {
        if (hexDistance(c.q, c.r, nq, nr) <= 1) vis.add(hk(nq, nr));
      });
    }
  }

  for (const u of state.units) {
    if (u.owner === player) {
      const terr = terrainAt(state, u.q, u.r);
      const sight = terr === 'mountain' ? 2 : 1;
      forEachHex((nq, nr) => {
        if (hexDistance(u.q, u.r, nq, nr) <= sight) vis.add(hk(nq, nr));
      });
    }
  }
}

export function reachableMap(state, unit) {
  const out = new Map();
  if (unit.acted || unit.mp <= 0) return out;
  const budget = unit.mp;
  const dist = new Map([[hk(unit.q, unit.r), 0]]);
  const queue = [[unit.q, unit.r, 0]];
  
  while (queue.length) {
    queue.sort((a, b) => a[2] - b[2]);
    const [q, r, cost] = queue.shift();
    if (cost > (dist.get(hk(q, r)) ?? Infinity)) continue;
    for (const [nq, nr] of neighbors(q, r)) {
      if (unitAt(state, nq, nr)) continue;
      const t = TERRAIN[terrainAt(state, nq, nr)];
      if (!t.walkable) continue;
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
  if (unit.acted || unit.hasAttacked) return [];
  const range = UNITS[unit.type].range;
  return state.units.filter(u =>
    u.owner !== unit.owner &&
    hexDistance(unit.q, unit.r, u.q, u.r) <= range
  );
}

export function combatDamage(attacker, defender, defTerrain) {
  const aDef = UNITS[attacker.type];
  const dDef = UNITS[defender.type];
  const aMaxHp = attacker.maxHp || MAX_HP;
  const dMaxHp = defender.maxHp || MAX_HP;
  
  const terrBonus = TERRAIN[defTerrain].def;
  const attackForce = aDef.atk * (attacker.hp / aMaxHp);
  const defenseForce = dDef.def * (defender.hp / dMaxHp) * (1 + terrBonus * 0.5);
  const totalForce = attackForce + defenseForce;

  if (totalForce === 0) return 0;
  return Math.max(1, Math.round((attackForce / totalForce) * aDef.atk * 4.5));
}

export function attack(state, attacker, defender) {
  const events = [];
  const dist = hexDistance(attacker.q, attacker.r, defender.q, defender.r);
  const dmg = combatDamage(attacker, defender, terrainAt(state, defender.q, defender.r));
  
  defender.hp -= dmg;
  events.push({ kind: 'damage', from: attacker.id, to: defender.id, dmg });

  if (defender.hp <= 0) {
    state.units = state.units.filter(u => u !== defender);
    events.push({ kind: 'kill', unit: defender });
    
    attacker.kills = (attacker.kills || 0) + 1;
    if (attacker.kills >= 3 && !attacker.isVeteran) {
      attacker.isVeteran = true;
      attacker.maxHp = (attacker.maxHp || MAX_HP) + 5;
      attacker.hp = attacker.maxHp;
      events.push({ kind: 'veteran', unit: attacker });
    }
  } else if (dist === 1 && UNITS[defender.type].range === 1) {
    const dDef = UNITS[defender.type];
    const aDef = UNITS[attacker.type];
    const aMaxHp = attacker.maxHp || MAX_HP;
    const dMaxHp = defender.maxHp || MAX_HP;

    const attackForce = aDef.atk * (attacker.hp / aMaxHp);
    const defenseForce = dDef.def * (defender.hp / dMaxHp);
    const totalForce = attackForce + defenseForce;
    const backDmg = Math.max(1, Math.round((defenseForce / totalForce) * dDef.def * 4.5));
    
    attacker.hp -= backDmg;
    events.push({ kind: 'retaliate', from: defender.id, to: attacker.id, dmg: backDmg });
    
    if (attacker.hp <= 0) {
      state.units = state.units.filter(u => u !== attacker);
      events.push({ kind: 'kill', unit: attacker });
    }
  }

  attacker.hasAttacked = true;
  if (UNITS[attacker.type].skill === 'escape' && attacker.mp > 0 && attacker.hp > 0) {
    attacker.acted = false;
  } else {
    attacker.acted = true;
    attacker.mp = 0;
  }

  updateFogOfWar(state, attacker.owner);
  return { events };
}

export function moveUnit(state, unit, q, r) {
  const reach = reachableMap(state, unit);
  const k = hk(q, r);
  if (!reach.has(k)) return { ok: false };
  
  unit.mp -= reach.get(k);
  unit.q = q;
  unit.r = r;
  if (unit.hasAttacked || unit.mp <= 0) unit.acted = true;

  const events = [];
  const city = cityAt(state, q, r);
  if (city && city.owner !== unit.owner) {
    const prev = city.owner;
    city.owner = unit.owner;
    events.push({ kind: 'capture', city, from: prev, to: unit.owner });
    checkWinner(state);
  }
  updateFogOfWar(state, unit.owner);
  return { ok: true, events };
}

export function checkWinner(state) {
  const p1 = state.cities.some(c => c.owner === 'player_1');
  const p2 = state.cities.some(c => c.owner === 'player_2');
  if (!p1) state.winner = 'player_2';
  else if (!p2) state.winner = 'player_1';
}

export function canResearch(state, techId, player) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  const t = TECHS[techId];
  if (!t) return { ok: false, reason: 'Ungültige Technologie' };
  if (state.techs[player].includes(techId)) return { ok: false, reason: 'Bereits erforscht' };
  if (t.req && !state.techs[player].includes(t.req)) return { ok: false, reason: 'Voraussetzung fehlt' };
  const cost = techCost(state, techId, player);
  if (state.stars[player] < cost) return { ok: false, reason: 'Zu wenig Sterne' };
  return { ok: true };
}

export function research(state, techId, player) {
  const chk = canResearch(state, techId, player);
  if (!chk.ok) return chk;
  state.stars[player] -= techCost(state, techId, player);
  state.techs[player].push(techId);
  return { ok: true };
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
  const def = UNITS[type];
  state.stars[player] -= def.cost;
  city.trained = true;
  state.units.push({
    id: `${player}_${Date.now().toString(36)}_${unitSeq++}`,
    owner: player, type, q: city.q, r: city.r,
    hp: def.maxHp, maxHp: def.maxHp, mp: def.move, acted: false, kills: 0
  });
  updateFogOfWar(state, player);
  return { ok: true };
}

export function createGame(seed = Date.now(), tribeP1 = 'imperius', tribeP2 = 'bardur') {
  const rand = mulberry32(seed);
  
  const state = {
    terrain: generateTerrain(rand),
    cities: [], 
    units: [],
    tribes: { player_1: tribeP1, player_2: tribeP2 },
    stars: { player_1: START_STARS, player_2: START_STARS },
    techs: { 
      player_1: [TRIBES[tribeP1]?.tech || 'organisation'], 
      player_2: [TRIBES[tribeP2]?.tech || 'jagd'] 
    },
    turn: 'player_1', 
    round: 1, 
    winner: null,
    explored: { player_1: new Set(), player_2: new Set() }
  };

  const s1 = [1, MAP_H - 2];
  const s2 = [MAP_W - 2, 1];

  placeCity(state, s1[0], s1[1], 'player_1', BASE_CITY_POP + 1);
  placeCity(state, s2[0], s2[1], 'player_2', BASE_CITY_POP + 1);

  spawnWarrior(state, 'player_1', s1[0], s1[1]);
  spawnWarrior(state, 'player_2', s2[0], s2[1]);

  startTurn(state);
  return state;
}

function placeCity(state, q, r, owner, pop) {
  state.terrain[idx(q, r)] = 'plains';
  state.cities.push({ q, r, owner, pop, trained: false });
}

function spawnWarrior(state, owner, q, r) {
  state.units.push({
    id: `${owner}_start_${Date.now().toString(36)}`,
    owner, type: 'warrior', q, r, hp: MAX_HP, maxHp: MAX_HP, mp: UNITS.warrior.move, acted: false, kills: 0
  });
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateTerrain(rand) {
  const t = new Array(MAP_W * MAP_H);
  for (let i = 0; i < t.length; i++) {
    const r = rand();
    if (r < 0.12) t[i] = 'ocean';
    else if (r < 0.22) t[i] = 'water';
    else if (r < 0.40) t[i] = 'forest';
    else if (r < 0.52) t[i] = 'mountain';
    else t[i] = 'plains';
  }
  return t;
}
