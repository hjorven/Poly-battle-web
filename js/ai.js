import * as R from './rules.js';
import { UNITS, IMPROVEMENTS, TECHS, BRIDGE } from './config.js';
import { hexDistance, hk, forEachHex } from './hex.js';

const UNIT_VALUE = {
  warrior: 2, archer: 3, rider: 3, defender: 3, swordsman: 5,
  catapult: 5, mindbender: 4, knight: 6, giant: 7,
  boat: 3, ship: 5, battleship: 7, settler: 1, spy: 2
};

function attackScore(state, attacker, defender) {
  if (UNITS[attacker.type].abilities.includes('convert')) {
    return 30 + UNIT_VALUE[defender.type] * 3;
  }
  const { damage } = R.battleResults(state, attacker, defender);
  let score = damage;
  if (damage >= defender.hp) score += 20 + UNIT_VALUE[defender.type] * 2;
  score += UNIT_VALUE[defender.type];
  score += Math.max(0, 12 - defender.hp) * 0.6;
  if (attacker.hp <= 2) score -= 6;
  return score;
}

// Kriegsziele: Städte aller Stämme ohne Frieden (auch neutrale).
function targetCities(state, player) {
  return state.cities.filter(c => R.hostile(state, player, c.owner));
}

// Frieden brechen, wenn er die KI blockiert (keine anderen Ziele mehr) oder
// sie nach längerem Frieden klar überlegen ist.
function warStep(state, player) {
  for (const other of R.players(state)) {
    if (!R.atPeace(state, player, other)) continue;
    const since = state.peace[[player, other].sort().join('|')];
    const noTargets = !targetCities(state, player).length;
    const strong = R.score(state, player) >= 1.6 * R.score(state, other) && state.round - since >= 8;
    if (noTargets || strong) return { kind: 'war', target: other };
  }
  return null;
}

// Bedrohte Stadt: feindliche Kampfeinheit höchstens 2 Felder entfernt.
function threatTo(state, player, city) {
  return state.units.some(e => R.hostile(state, player, e.owner) && R.canEverAttack(e.type) &&
    hexDistance(e.q, e.r, city.q, city.r) <= 2);
}

// Leere, bedrohte Städte besetzen oder dort einen Verteidiger ausbilden.
function defendStep(state, player) {
  for (const city of R.citiesFor(state, player)) {
    if (R.unitAt(state, city.q, city.r) || !threatTo(state, player, city)) continue;
    const k = hk(city.q, city.r);
    const guard = state.units.find(u => u.owner === player && u.type !== 'settler' && u.type !== 'spy' &&
      !u.carry && UNITS[u.type].atk > 0 && !R.cityAt(state, u.q, u.r) && R.reachableMap(state, u).has(k));
    if (guard) return { kind: 'move', unit: guard, q: city.q, r: city.r };
    for (const t of ['defender', 'swordsman', 'archer', 'warrior']) {
      if (R.canTrain(state, city, t, player).ok) return { kind: 'train', city, type: t };
    }
  }
  return null;
}

// Ein Spion pro KI ab Runde 3, solange noch Land unentdeckt ist.
function spyTrainStep(state, player) {
  if (state.round < 3 || state.units.some(u => u.owner === player && u.type === 'spy')) return null;
  const explored = (state.explored && state.explored[player]) || [];
  if (explored.length > state.terrain.length * 0.8) return null;
  if (state.stars[player] < R.unitCost(state, player, 'spy') + 4) return null;
  for (const c of R.citiesFor(state, player)) {
    if (R.canTrain(state, c, 'spy', player).ok) return { kind: 'train', city: c, type: 'spy' };
  }
  return null;
}

// Spion zieht dorthin, wo er am meisten Unentdecktes aufdeckt.
function spyMove(state, spy) {
  const reach = R.reachableMap(state, spy);
  if (!reach.size) return null;
  const known = new Set((state.explored && state.explored[spy.owner]) || []);
  const unknown = [];
  forEachHex((q, r) => { if (!known.has(hk(q, r))) unknown.push([q, r]); });
  if (!unknown.length) return null;
  let best = null;
  for (const [k] of reach) {
    const [q, r] = k.split(',').map(Number);
    const sight = R.unitSight(state, { ...spy, q, r });
    const reveal = unknown.filter(([uq, ur]) => hexDistance(q, r, uq, ur) <= sight).length;
    const near = Math.min(...unknown.map(([uq, ur]) => hexDistance(q, r, uq, ur)));
    const sc = reveal * 3 - near - (R.threatened(state, { ...spy, q, r }) ? 8 : 0);
    if (!best || sc > best.sc) best = { q, r, sc };
  }
  return best ? { kind: 'move', unit: spy, q: best.q, r: best.r } : null;
}

// Brücke bauen, wenn sie eine Landeinheit dem Ziel deutlich näher bringt.
function bridgeStep(state, player) {
  if (!state.techs[player].includes(BRIDGE.tech)) return null;
  if (state.aiBridgeRound && state.aiBridgeRound[player] === state.round) return null;
  const cities = targetCities(state, player);
  if (!cities.length) return null;
  for (const u of state.units) {
    if (u.owner !== player || u.acted || u.type === 'settler' || u.type === 'spy') continue;
    const target = cities.reduce((a, b) => hexDistance(u.q, u.r, a.q, a.r) <= hexDistance(u.q, u.r, b.q, b.r) ? a : b);
    const now = hexDistance(u.q, u.r, target.q, target.r);
    for (const o of R.bridgeOptions(state, u)) {
      if (state.stars[player] < o.cost + 3) continue;
      const [eq, er] = o.tiles[o.tiles.length - 1];
      if (hexDistance(eq, er, target.q, target.r) <= now - 2) return { kind: 'bridge', unit: u, dir: o.dir };
    }
  }
  return null;
}

function bestBuilding(state, player) {
  const stars = state.stars[player];
  // Ohne Hafen keine Schiffe: mit Segeln den ersten Hafen bevorzugen.
  const needsPort = state.techs[player].includes('sailing') &&
    !R.citiesFor(state, player).some(c => R.cityPorts(state, c).length);
  let best = null;
  for (const city of R.citiesFor(state, player)) {
    if (!needsPort && city.pop < 2 && state.cities.filter(c => c.owner === player).length < 3) continue;
    for (const [q, r] of R.cityTiles(state, city)) {
      if (R.improvementAt(state, q, r) || R.resourceAt(state, q, r)) continue;
      if (state.units.some(u => u.q === q && u.r === r)) continue;
      for (const type of Object.keys(IMPROVEMENTS)) {
        const def = IMPROVEMENTS[type];
        if (def.tech && !state.techs[player].includes(def.tech)) continue;
        if (stars < def.cost + 2) continue;
        if (!R.canImprove(state, city, type, q, r).ok) continue;
        const score = def.pop / def.cost + (type === 'port' && needsPort ? 1 : 0);
        if (!best || score > best.score) best = { kind: 'improve', city, type, q, r, score };
      }
    }
  }
  return best;
}

function settleStep(state, player) {
  if (!state.settlerAt) state.settlerAt = {};
  const sitters = state.units.filter(u => u.owner === player && u.type === 'settler' && !u.acted);
  for (const s of sitters) {
    if (R.canFound(state, s, player).ok) {
      state.settlerAt[player] = state.round;
      return { kind: 'settle', unit: s };
    }
  }
  const cities = R.citiesFor(state, player);
  const count = cities.length;
  if (count >= 5) return null;
  if (state.round - (state.settlerAt[player] || 0) < 3) return null;
  const cap = cities.find(c => c.isCapital);
  if (!cap || cap.trained) return null;
  if (state.units.some(u => u.q === cap.q && u.r === cap.r)) return null;
  if (state.stars[player] < UNITS.settler.cost + 3) return null;
  if (!R.canTrain(state, cap, 'settler', player).ok) return null;
  return { kind: 'train', city: cap, type: 'settler' };
}

function bestSettleMove(state, s) {
  const reach = R.reachableMap(state, s);
  let best = null, bd = -1;
  for (const [k] of reach) {
    const [q, r] = k.split(',').map(Number);
    if (!R.canFound(state, { ...s, q, r }, s.owner).ok) continue;
    const d = Math.min(99, ...state.cities.map(c => hexDistance(q, r, c.q, c.r)));
    if (d > bd) { bd = d; best = { unit: s, q, r }; }
  }
  return best;
}

function bestMove(state, unit, player) {
  const reach = R.reachableMap(state, unit);
  if (!reach.size) return null;
  const enemyCities = targetCities(state, player);
  const enemyUnits = state.units.filter(u => R.hostile(state, player, u.owner));
  let target = null;
  if (enemyCities.length) {
    target = enemyCities.reduce((a, b) =>
      hexDistance(unit.q, unit.r, a.q, a.r) <= hexDistance(unit.q, unit.r, b.q, b.r) ? a : b);
  } else if (enemyUnits.length) {
    target = enemyUnits.reduce((a, b) =>
      hexDistance(unit.q, unit.r, a.q, a.r) <= hexDistance(unit.q, unit.r, b.q, b.r) ? a : b);
  }
  if (!target) return null;

  const currentD = hexDistance(unit.q, unit.r, target.q, target.r);
  const range = UNITS[unit.type].range;
  let best = null;
  for (const [k, cost] of reach) {
    const [q, r] = k.split(',').map(Number);
    const d = hexDistance(q, r, target.q, target.r);
    const canHit = d <= range;
    let score = -d * 10;
    if (canHit) score += 60;
    score -= cost * 0.5;
    score += (unit.mp - cost) * 0.2;
    if (!best || score > best.score) best = { q, r, score, d, cost };
  }
  if (!best) return null;
  if (best.d >= currentD && !(best.d <= range && currentD > range)) return null;
  return { unit, q: best.q, r: best.r };
}

// Belohnung für eine aufgestiegene Stadt wählen.
function rewardStep(state, player) {
  for (const city of R.citiesFor(state, player)) {
    const opts = R.rewardOptions(city);
    if (!opts.length) continue;
    let pick = opts[0];
    if (opts.includes('wall')) {
      const threat = state.units.some(u => u.owner !== player && hexDistance(u.q, u.r, city.q, city.r) <= 3);
      pick = threat ? 'wall' : 'resources';
    } else if (opts.includes('borders')) pick = 'borders';
    else if (opts.includes('giant')) pick = 'giant';
    else if (opts.includes('workshop')) pick = 'workshop';
    return { kind: 'reward', city, choice: pick };
  }
  return null;
}

// Erreichbare Ruine (nicht für Siedler und Schiffe).
function ruinStep(state, unit) {
  if (!state.ruins || unit.type === 'settler' || UNITS[unit.type].abilities.includes('water')) return null;
  // Nur rechnen, wenn überhaupt eine Ruine in Bewegungsweite liegt.
  const near = Object.keys(state.ruins).some(k => {
    const [q, r] = k.split(',').map(Number);
    return hexDistance(unit.q, unit.r, q, r) <= unit.mp;
  });
  if (!near) return null;
  const reach = R.reachableMap(state, unit);
  for (const [k] of reach) {
    if (state.ruins[k]) {
      const [q, r] = k.split(',').map(Number);
      return { kind: 'move', unit, q, r };
    }
  }
  return null;
}

export function botStep(state, player) {
  if (state.winner || state.turn !== player) return null;
  const mine = state.units.filter(u => u.owner === player);
  const easy = state.aiLevel === 'easy' && R.isBot(state, player);

  const reward = rewardStep(state, player);
  if (reward) return reward;

  const war = warStep(state, player);
  if (war) return war;

  let bestAttack = null;
  for (const u of mine) {
    if (u.acted) continue;
    for (const t of R.attackTargets(state, u)) {
      const res = R.battleResults(state, u, t);
      if (res.damage < t.hp && res.retaliation >= u.hp) continue;
      // Leichte KI greift nur an, wenn sie dabei mehr austeilt als einsteckt.
      if (easy && res.damage < t.hp && res.damage <= res.retaliation) continue;
      const s = attackScore(state, u, t);
      if (!bestAttack || s > bestAttack.score) bestAttack = { kind: 'attack', attacker: u, defender: t, score: s };
    }
  }
  if (bestAttack) return bestAttack;

  const defend = defendStep(state, player);
  if (defend) return defend;

  const settle = settleStep(state, player);
  if (settle) return settle;

  const spyTrain = spyTrainStep(state, player);
  if (spyTrain) return spyTrain;

  for (const c of R.citiesFor(state, player)) {
    const unlocked = R.unlockedUnits(state, player);
    const stars = state.stars[player];
    const order = [
      'giant', 'knight', 'battleship', 'ship', 'swordsman', 'catapult',
      'boat', 'mindbender', 'archer', 'defender', 'rider', 'warrior'
    ];
    let type = null;
    for (const t of order) {
      if (!unlocked.includes(t)) continue;
      if (R.unitCost(state, player, t) > stars) continue;
      if (t === 'giant' && stars < 10) continue;
      type = t;
      break;
    }
    if (type && R.canTrain(state, c, type, player).ok) return { kind: 'train', city: c, type };
    // Küstenstädte bauen auch Schiffe, solange die KI keine hat.
    const naval = ['battleship', 'ship', 'boat'].find(t => unlocked.includes(t) && R.unitCost(state, player, t) <= stars - 2);
    if (naval && !state.units.some(u => u.owner === player && UNITS[u.type].abilities.includes('water') && !u.carry) &&
      R.canTrain(state, c, naval, player).ok) return { kind: 'train', city: c, type: naval };
  }

  for (const u of mine) {
    if (u.mp <= 0) continue;
    const r = ruinStep(state, u);
    if (r) return r;
  }

  const bridge = bridgeStep(state, player);
  if (bridge) return bridge;

  for (const u of mine) {
    if (u.acted && u.mp <= 0) continue;
    if (u.type === 'spy') {
      const mv = spyMove(state, u);
      if (mv) return mv;
      continue;
    }
    if (u.type === 'settler') {
      const mv = bestSettleMove(state, u);
      if (mv) return { kind: 'move', unit: mv.unit, q: mv.q, r: mv.r };
      continue;
    }
    const mv = bestMove(state, u, player);
    if (mv) return { kind: 'move', unit: mv.unit, q: mv.q, r: mv.r };
  }

  for (const c of R.citiesFor(state, player)) {
    const cost = R.popCost(c);
    if (c.pop < 5 && state.stars[player] >= cost + 3 && R.canBuyPop(state, c, player).ok) {
      return { kind: 'buyPop', city: c };
    }
  }

  const build = bestBuilding(state, player);
  if (build) return build;

  const techOrder = [
    'organization', 'hunting', 'archery', 'farming', 'riding', 'roads',
    'climbing', 'mining', 'shields', 'forestry', 'mathematics', 'meditation',
    'philosophy', 'smithery', 'construction', 'freespirit', 'chivalry',
    'trade', 'spiritualism', 'fishing', 'sailing', 'ramming', 'navigation', 'aquatism', 'diplomacy'
  ];
  if (R.citiesFor(state, player).some(c => R.coastal(state, c))) {
    techOrder.splice(techOrder.indexOf('roads') + 1, 0, ...techOrder.splice(techOrder.indexOf('fishing'), 2));
  }
  for (const t of techOrder) {
    if (easy && TECHS[t].tier > 2) continue;
    if (R.canResearch(state, t, player).ok && state.stars[player] >= R.techCost(state, t, player) + 5) {
      return { kind: 'research', tech: t };
    }
  }

  return null;
}

// Einen KI-Schritt nur auf die Regeln anwenden (ohne Darstellung) – für
// Tests und Simulationen.
export function applyStep(state, step, player) {
  switch (step.kind) {
    case 'attack': return R.attack(state, step.attacker, step.defender);
    case 'move': return R.moveUnit(state, step.unit, step.q, step.r);
    case 'train': return R.trainUnit(state, step.city, step.type, player);
    case 'buyPop': return R.buyPop(state, step.city, player);
    case 'improve': return R.improve(state, step.city, step.type, step.q, step.r, player);
    case 'settle': return R.foundCity(state, step.unit, player);
    case 'research': return R.research(state, step.tech, player);
    case 'reward': return R.chooseReward(state, step.city, step.choice, player);
    case 'war': return R.declareWar(state, player, step.target);
    case 'bridge': {
      const res = R.buildBridge(state, step.unit, step.dir, player);
      if (res.ok) { if (!state.aiBridgeRound) state.aiBridgeRound = {}; state.aiBridgeRound[player] = state.round; }
      return res;
    }
    default: throw new Error('unknown step ' + step.kind);
  }
}
