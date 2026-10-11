import * as R from './rules.js';
import { UNITS, IMPROVEMENTS } from './config.js';
import { hexDistance, hk } from './hex.js';

const UNIT_VALUE = {
  warrior: 2, archer: 3, rider: 3, defender: 3, swordsman: 5,
  catapult: 5, mindbender: 4, knight: 6, giant: 7,
  boat: 3, ship: 5, battleship: 7
};

function attackScore(state, attacker, defender) {
  if (UNITS[attacker.type].abilities.includes('convert')) {
    return 30 + UNIT_VALUE[defender.type] * 3;
  }
  const { damage } = R.battleResults(state, attacker, defender);
  let score = damage;
  if (damage >= defender.hp) score += 20 + UNIT_VALUE[defender.type] * 2;
  score += UNIT_VALUE[defender.type];
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
    for (const [q, r] of R.territory(city)) {
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

export function botStep(state, player) {
  if (state.winner || state.turn !== player) return null;
  const mine = state.units.filter(u => u.owner === player);

  let bestAttack = null;
  for (const u of mine) {
    if (u.acted) continue;
    for (const t of R.attackTargets(state, u)) {
      const s = attackScore(state, u, t);
      if (!bestAttack || s > bestAttack.score) bestAttack = { kind: 'attack', attacker: u, defender: t, score: s };
    }
  }
  if (bestAttack) return bestAttack;

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
    if (u.acted && u.mp <= 0) continue;
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
    if (R.canResearch(state, t, player).ok && state.stars[player] >= R.techCost(state, t, player) + 5) {
      return { kind: 'research', tech: t };
    }
  }

  return null;
}
