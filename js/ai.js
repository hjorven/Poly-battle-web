import * as R from './rules.js';
import { UNITS } from './config.js';
import { hexDistance, hk } from './hex.js';

const UNIT_VALUE = {
  warrior: 2, archer: 3, rider: 3, defender: 3, swordsman: 5,
  catapult: 5, mindbender: 4, knight: 6, giant: 7
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
    const order = ['giant', 'knight', 'swordsman', 'catapult', 'mindbender', 'archer', 'defender', 'rider', 'warrior'];
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
