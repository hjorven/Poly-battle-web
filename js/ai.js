import * as R from './rules.js';
import { UNITS, IMPROVEMENTS, TECHS } from './config.js';
import { hexDistance, hk } from './hex.js';

const UNIT_VALUE = {
  warrior: 2, archer: 3, rider: 3, defender: 3, swordsman: 5,
  catapult: 5, mindbender: 4, knight: 6, giant: 7,
  boat: 3, ship: 5, battleship: 7, settler: 1
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

function targetCities(state, player) {
  return state.cities.filter(c => c.owner !== player);
}

function bestBuilding(state, player) {
  const stars = state.stars[player];
  let best = null;
  for (const city of R.citiesFor(state, player)) {
    if (city.pop < 2 && state.cities.filter(c => c.owner === player).length < 3) continue;
    for (const [q, r] of R.cityTiles(state, city)) {
      if (R.improvementAt(state, q, r) || R.resourceAt(state, q, r)) continue;
      if (state.units.some(u => u.q === q && u.r === r)) continue;
      for (const type of Object.keys(IMPROVEMENTS)) {
        const def = IMPROVEMENTS[type];
        if (def.tech && !state.techs[player].includes(def.tech)) continue;
        if (stars < def.cost + 2) continue;
        if (!R.canImprove(state, city, type, q, r).ok) continue;
        const score = def.pop / def.cost;
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
  const enemyUnits = state.units.filter(u => u.owner !== player);
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

  const settle = settleStep(state, player);
  if (settle) return settle;

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
      if (UNITS[t].cost > stars) continue;
      if (t === 'giant' && stars < 10) continue;
      type = t;
      break;
    }
    if (type && R.canTrain(state, c, type, player).ok) return { kind: 'train', city: c, type };
  }

  for (const u of mine) {
    if (u.mp <= 0) continue;
    const r = ruinStep(state, u);
    if (r) return r;
  }

  for (const u of mine) {
    if (u.acted && u.mp <= 0) continue;
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
    default: throw new Error('unknown step ' + step.kind);
  }
}
