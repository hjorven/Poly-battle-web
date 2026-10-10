import * as R from './rules.js';
import { UNITS, TECHS, UNIT_ORDER } from './config.js';
import { hexDistance, hk, inBounds } from './hex.js';

const UNIT_VALUE = { warrior: 2, archer: 3, rider: 3, defender: 3, swordsman: 5, catapult: 5 };

function attackScore(state, attacker, defender) {
  const dmg = R.combatDamage(attacker, defender, R.terrainAt(state, defender.q, defender.r));
  let score = dmg;
  if (dmg >= defender.hp) score += 20 + UNIT_VALUE[defender.type] * 2;
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
    const chk = R.canTrain(state, c, 'warrior', player);
    if (!chk.ok) continue;
    const stars = state.stars[player];
    const unlocked = R.unlockedUnits(state, player);
    let type = 'warrior';
    if (stars >= 10 && unlocked.includes('swordsman')) type = 'swordsman';
    else if (stars >= 8 && unlocked.includes('catapult') && !unlocked.includes('swordsman')) type = 'catapult';
    const train = R.canTrain(state, c, type, player);
    if (train.ok) return { kind: 'train', city: c, type };
  }

  for (const u of mine) {
    if (u.acted || u.mp <= 0) continue;
    const mv = bestMove(state, u, player);
    if (mv) return { kind: 'move', unit: mv.unit, q: mv.q, r: mv.r };
  }

  const playerCities = R.citiesFor(state, player);
  for (const c of playerCities) {
    const cost = R.popCost(c);
    if (c.pop < 5 && state.stars[player] >= cost + 3 && R.canBuyPop(state, c, player).ok) {
      return { kind: 'buyPop', city: c };
    }
  }

  const techOrder = ['jagd', 'ackerbau', 'reitkunst', 'bergbau', 'handwerk', 'mathematik'];
  for (const t of techOrder) {
    if (R.canResearch(state, t, player).ok && state.stars[player] >= TECHS[t].cost + 5) {
      return { kind: 'research', tech: t };
    }
  }

  return null;
}
