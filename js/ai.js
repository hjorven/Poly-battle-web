import * as R from './rules.js';
import { UNITS, TECHS } from './config.js';
import { hexDistance } from './hex.js';

export function botStep(state, player) {
  if (state.winner || state.turn !== player) return null;
  const mine = state.units.filter(u => u.owner === player);

  // 1. Priorität: Städte einnehmen/besetzen
  for (const u of mine) {
    if (u.acted) continue;
    const reach = R.reachableMap(state, u);
    for (const [k] of reach) {
      const [q, r] = k.split(',').map(Number);
      const c = R.cityAt(state, q, r);
      if (c && c.owner !== player) {
        return { kind: 'move', unit: u, q, r };
      }
    }
  }

  // 2. Priorität: Vorteilhafte Angriffe ausführen
  let bestAttack = null;
  for (const u of mine) {
    if (u.acted || u.hasAttacked) continue;
    for (const t of R.attackTargets(state, u)) {
      const dmg = R.combatDamage(u, t, R.terrainAt(state, t.q, t.r));
      let score = dmg;
      if (dmg >= t.hp) score += 30; // Kill-Bonus
      if (u.hp <= 3 && dmg < t.hp) score -= 10; // Eigenes Risiko meiden
      if (!bestAttack || score > bestAttack.score) {
        bestAttack = { kind: 'attack', attacker: u, defender: t, score };
      }
    }
  }
  if (bestAttack && bestAttack.score > 0) return bestAttack;

  // 3. Priorität: Einheiten ausbilden
  for (const c of R.citiesFor(state, player)) {
    const stars = state.stars[player];
    const unlocked = R.UNIT_ORDER.filter(t => !UNITS[t].tech || state.techs[player].includes(UNITS[t].tech));
    
    // Beste bezahlbare Einheit wählen
    let choice = 'warrior';
    if (stars >= 8 && unlocked.includes('catapult')) choice = 'catapult';
    else if (stars >= 5 && unlocked.includes('swordsman')) choice = 'swordsman';
    else if (stars >= 3 && unlocked.includes('rider')) choice = 'rider';

    if (R.canTrain(state, c, choice, player).ok) {
      return { kind: 'train', city: c, type: choice };
    }
  }

  // 4. Priorität: Bewegung in Richtung der nächsten feindlichen Stadt
  const enemyCities = state.cities.filter(c => c.owner !== player);
  if (enemyCities.length) {
    for (const u of mine) {
      if (u.acted || u.mp <= 0) continue;
      const target = enemyCities.reduce((a, b) => 
        hexDistance(u.q, u.r, a.q, a.r) < hexDistance(u.q, u.r, b.q, b.r) ? a : b
      );
      const reach = R.reachableMap(state, u);
      let bestMove = null;
      let minD = hexDistance(u.q, u.r, target.q, target.r);

      for (const [k] of reach) {
        const [q, r] = k.split(',').map(Number);
        const d = hexDistance(q, r, target.q, target.r);
        if (d < minD) { minD = d; bestMove = { q, r }; }
      }
      if (bestMove) return { kind: 'move', unit: u, q: bestMove.q, r: bestMove.r };
    }
  }

  // 5. Priorität: Forschung
  const techOrder = ['jagd', 'ackerbau', 'reitkunst', 'bergbau', 'handwerk', 'mathematik'];
  for (const t of techOrder) {
    if (R.canResearch(state, t, player).ok) {
      return { kind: 'research', tech: t };
    }
  }

  return null;
}
