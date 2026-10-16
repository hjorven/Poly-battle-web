import * as R from './rules.js';
import { UNITS, IMPROVEMENTS, TECHS, BRIDGE, ROAD } from './config.js';
import { hexDistance, hk, forEachHex } from './hex.js';

const UNIT_VALUE_BASE = {
  warrior: 2, archer: 3, rider: 3, defender: 3, swordsman: 5,
  catapult: 5, mindbender: 4, knight: 6, giant: 7,
  boat: 3, ship: 5, battleship: 7, settler: 1, spy: 2
};
// Wert einer Einheit für die KI; fehlende Arten nach ihren Kosten (nie NaN).
const UNIT_VALUE = new Proxy(UNIT_VALUE_BASE, {
  get: (t, k) => t[k] ?? (UNITS[k] ? Math.max(1, Math.round(UNITS[k].cost * 0.7)) : 2)
});

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
  if (R.personaOf(state, attacker.owner) === 'conqueror') score += 3;
  return score;
}

// Kriegsziele: Städte aller Stämme ohne Frieden (auch neutrale).
function targetCities(state, player) {
  return state.cities.filter(c => R.hostile(state, player, c.owner) && !R.graceProtects(state, player, c.owner));
}

// Frieden brechen, wenn er die KI blockiert (keine anderen Ziele mehr) oder
// sie nach längerem Frieden klar überlegen ist.
function warStep(state, player) {
  const persona = R.personaOf(state, player);
  // Eroberer brechen Frieden früher, Händler nur, wenn sonst nichts geht.
  const ratio = persona === 'conqueror' ? 1.25 : persona === 'merchant' ? Infinity : 1.6;
  const wait = persona === 'conqueror' ? 4 : 8;
  for (const other of R.players(state)) {
    if (!R.atPeace(state, player, other)) continue;
    const since = state.peace[[player, other].sort().join('|')];
    const noTargets = !targetCities(state, player).length;
    const strong = R.score(state, player) >= ratio * R.score(state, other) && state.round - since >= wait;
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
    const guard = state.units.find(u => u.owner === player && u.type !== 'settler' && u.type !== 'spy' && !R.isAir(u.type) &&
      !u.carry && UNITS[u.type].atk > 0 && !R.cityAt(state, u.q, u.r) && R.reachableMap(state, u).has(k));
    if (guard) return { kind: 'move', unit: guard, q: city.q, r: city.r };
    for (const t of ['defender', 'swordsman', 'archer', 'warrior']) {
      if (R.canTrain(state, city, t, player).ok) return { kind: 'train', city, type: t };
    }
  }
  return null;
}

// Ein Spion pro KI ab Runde 3, solange noch Land unentdeckt ist.
// Ein Heißluftballon als Späher, sobald ein Ballonplatz steht.
function balloonTrainStep(state, player) {
  if (state.units.some(u => u.owner === player && u.type === 'balloon')) return null;
  if (state.stars[player] < R.unitCost(state, player, 'balloon') + 6) return null;
  for (const c of R.citiesFor(state, player)) {
    if (R.canTrain(state, c, 'balloon', player).ok) return { kind: 'train', city: c, type: 'balloon' };
  }
  return null;
}

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
    // Spione erobern keine Städte.
    const city = R.cityAt(state, q, r);
    if (city && city.owner !== spy.owner) continue;
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
  // Freigeschaltete Monumente sofort errichten – bevorzugt in kleinen Städten.
  const monuments = R.readyMonuments(state, player);
  if (monuments.length) {
    const cities = R.citiesFor(state, player).slice().sort((a, b) => a.pop - b.pop);
    for (const city of cities) {
      for (const [q, r] of R.cityTiles(state, city)) {
        if (R.canImprove(state, city, monuments[0], q, r).ok) return { kind: 'improve', city, type: monuments[0], q, r, score: 99 };
      }
    }
  }
  const stars = state.stars[player];
  // Ohne Hafen keine Schiffe: mit Segeln den ersten Hafen bevorzugen.
  const needsPort = state.techs[player].includes('sailing') &&
    !R.citiesFor(state, player).some(c => R.cityPorts(state, c).length);
  // Mit Ballonfahrt den ersten Ballonplatz vorziehen (sonst belegen Farmen alle Felder).
  const needsAirfield = state.techs[player].includes('ballooning') &&
    !R.citiesFor(state, player).some(c => R.cityAirfields(state, c).length);
  let best = null;
  for (const city of R.citiesFor(state, player)) {
    if (!needsPort && city.pop < 2 && state.cities.filter(c => c.owner === player).length < 3) continue;
    // Ein Hafen pro Stadt reicht – mehr bringt der KI nur leere Wasserfelder.
    const hasPort = R.cityPorts(state, city).length > 0;
    for (const [q, r] of R.cityTiles(state, city)) {
      if (R.improvementAt(state, q, r) || R.resourceAt(state, q, r)) continue;
      if (state.units.some(u => u.q === q && u.r === r)) continue;
      for (const type of Object.keys(IMPROVEMENTS)) {
        const def = IMPROVEMENTS[type];
        if (def.monument || (def.tech && !state.techs[player].includes(def.tech))) continue;
        // Ein Ballonplatz pro Stamm reicht.
        if (type === 'airfield' && state.cities.some(c => c.owner === player && R.cityAirfields(state, c).length)) continue;
        if (type === 'port' && hasPort) continue;
        if (type === 'watchtower' && (R.cityTiles(state, city).some(([tq, tr]) => R.improvementAt(state, tq, tr) === 'watchtower') ||
          !state.units.some(e => R.hostile(state, player, e.owner) && e.owner && hexDistance(e.q, e.r, city.q, city.r) <= 5))) continue;
        const cost = R.improvementCost(state, player, type);
        if (stars < cost + 2) continue;
        if (!R.canImprove(state, city, type, q, r).ok) continue;
        // Ertrag je Stern, inklusive Nachbarschaftsbonus (Mühle, Schmelzhütte, Markt).
        const gain = R.improvePreview(state, city, type, q, r).gain + (type === 'watchtower' ? 0.6 : 0);
        const score = gain / cost + (type === 'port' && needsPort ? 1 : 0) + (type === 'airfield' && needsAirfield ? 1 : 0);
        if (score <= 0) continue;
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

// Gedankenbeuger: neben möglichst viele verletzte eigene Einheiten (heilt sie zu
// Rundenbeginn) oder neben einen bekehrbaren Gegner; sonst bei der Armee bleiben.
function healerMove(state, mb) {
  const reach = R.reachableMap(state, mb);
  const friends = state.units.filter(u => u.owner === mb.owner && u !== mb && UNITS[u.type].atk > 0);
  const foes = state.units.filter(e => R.hostile(state, mb.owner, e.owner) && e.owner && !R.graceProtects(state, mb.owner, e.owner));
  let best = null;
  const here = [[mb.q, mb.r, 0], ...[...reach.keys()].map(k => [...k.split(',').map(Number), 1])];
  for (const [q, r] of here) {
    if ((q !== mb.q || r !== mb.r) && R.unitAt(state, q, r)) continue;
    let score = 0;
    for (const f of friends) {
      const d = hexDistance(q, r, f.q, f.r);
      if (d === 1) score += 1 + (R.hpCap(f) - f.hp) * 0.5;
    }
    for (const e of foes) {
      const d = hexDistance(q, r, e.q, e.r);
      if (d === 1) score += UNIT_VALUE[e.type] * 0.8 - (UNITS[e.type].atk > 0 ? 1.5 : 0);
      if (d === 0) score -= 99;
    }
    // Nicht allein vorpreschen: Nähe zur Armee zählt.
    const near = friends.length ? Math.min(...friends.map(f => hexDistance(q, r, f.q, f.r))) : 0;
    score -= Math.max(0, near - 1) * 1.2;
    if (!best || score > best.score) best = { unit: mb, q, r, score };
  }
  return best && (best.q !== mb.q || best.r !== mb.r) ? best : null;
}

// Händlerkarren: zur lohnendsten Stadt fahren (eigene, nicht die Heimat, oder
// fremde im Frieden) und dort handeln.
function cartMove(state, cart) {
  const home = cart.home;
  const cities = state.cities.filter(c => c.owner && !(home && c.q === home.q && c.r === home.r) &&
    (c.owner === cart.owner || R.atPeace(state, cart.owner, c.owner)));
  if (!cities.length) return null;
  const worth = c => (home ? hexDistance(home.q, home.r, c.q, c.r) : 3) * (c.owner === cart.owner ? 1 : 1.5) - hexDistance(cart.q, cart.r, c.q, c.r) * 0.6;
  const goal = cities.reduce((a, b) => (worth(b) > worth(a) ? b : a));
  const reach = R.reachableMap(state, cart);
  let best = null, bd = hexDistance(cart.q, cart.r, goal.q, goal.r);
  for (const [k] of reach) {
    const [q, r] = k.split(',').map(Number);
    if (R.unitAt(state, q, r)) continue;
    const d = hexDistance(q, r, goal.q, goal.r);
    if (d < bd) { bd = d; best = { unit: cart, q, r }; }
  }
  return best;
}

function bestMove(state, unit, player) {
  const reach = R.reachableMap(state, unit);
  if (!reach.size) return null;
  const enemyCities = targetCities(state, player);
  const enemyUnits = state.units.filter(u => R.hostile(state, player, u.owner) && !R.graceProtects(state, player, u.owner));
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
  const range = R.rangeOf(state, unit);
  let best = null;
  for (const [k, cost] of reach) {
    const [q, r] = k.split(',').map(Number);
    // Schonfrist: keine Stadt eines geschützten Menschen betreten.
    const city = R.cityAt(state, q, r);
    if (city && R.graceProtects(state, player, city.owner)) continue;
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

// Schiffe ohne Feind in der Nähe fahren zum nächsten noch nicht erreichten
// Leuchtturm.
function lighthouseMove(state, unit) {
  if (!UNITS[unit.type].abilities.includes('water') || unit.carry || unit.mp <= 0) return null;
  const open = R.lighthouseKeys(state).filter(k => !R.lighthouseFound(state, unit.owner, k))
    .map(k => k.split(',').map(Number));
  if (!open.length) return null;
  if (state.units.some(e => R.hostile(state, unit.owner, e.owner) && hexDistance(e.q, e.r, unit.q, unit.r) <= 3)) return null;
  const [lq, lr] = open.reduce((a, b) =>
    hexDistance(unit.q, unit.r, a[0], a[1]) <= hexDistance(unit.q, unit.r, b[0], b[1]) ? a : b);
  const cur = hexDistance(unit.q, unit.r, lq, lr);
  let best = null;
  for (const k of R.reachableMap(state, unit).keys()) {
    const [q, r] = k.split(',').map(Number);
    const d = hexDistance(q, r, lq, lr);
    if (d < cur && (!best || d < best.d)) best = { q, r, d };
  }
  return best ? { kind: 'move', unit, q: best.q, r: best.r } : null;
}

// Felder auf der Linie zwischen zwei Hexfeldern (Würfelkoordinaten runden).
function hexLine(q1, r1, q2, r2) {
  const n = hexDistance(q1, r1, q2, r2);
  const out = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const qf = q1 + (q2 - q1) * t + 1e-6, rf = r1 + (r2 - r1) * t + 1e-6, sf = -qf - rf;
    let q = Math.round(qf), r = Math.round(rf);
    const s = Math.round(sf);
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    out.push([q, r]);
  }
  return out;
}

// Eigene, nahe Städte mit Straßen verbinden – höchstens ein Stück pro Runde,
// nur im eigenen Gebiet (dort ohne Einheit möglich).
function roadStep(state, player) {
  if (!state.techs[player].includes(ROAD.tech) || state.stars[player] < ROAD.cost + 9) return null;
  if (state.aiRoadRound && state.aiRoadRound[player] === state.round) return null;
  const cities = R.citiesFor(state, player);
  const pairs = [];
  for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
      const d = hexDistance(cities[i].q, cities[i].r, cities[j].q, cities[j].r);
      if (d <= 6) pairs.push([d, cities[i], cities[j]]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [, a, b] of pairs) {
    for (const [q, r] of hexLine(a.q, a.r, b.q, b.r)) {
      if (R.canBuildRoad(state, player, q, r).ok) return { kind: 'road', q, r };
    }
  }
  return null;
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
      if (R.graceProtects(state, player, t.owner)) continue;
      const converts = UNITS[u.type].abilities.includes('convert');
      const res = converts ? null : R.battleResults(state, u, t);
      // Bekehren hat keinen Gegenschlag: nur wertlose Ziele auslassen.
      if (converts && UNIT_VALUE[t.type] < 2) continue;
      if (!converts && res.damage < t.hp && res.retaliation >= u.hp) continue;
      // Leichte KI greift nur an, wenn sie dabei mehr austeilt als einsteckt.
      if (!converts && easy && res.damage < t.hp && res.damage <= res.retaliation) continue;
      const s = attackScore(state, u, t);
      if (!bestAttack || s > bestAttack.score) bestAttack = { kind: 'attack', attacker: u, defender: t, score: s };
    }
  }
  if (bestAttack) return bestAttack;

  const defend = defendStep(state, player);
  if (defend) return defend;

  const settle = settleStep(state, player);
  if (settle) return settle;

  // Aufrüsten, wenn genug Sterne übrig sind (Einheit steht noch im eigenen Gebiet).
  for (const u of mine) {
    const up = R.upgradeOption(state, u);
    if (up && up.ok && state.stars[player] >= up.cost + 8) return { kind: 'upgrade', unit: u };
  }

  const spyTrain = spyTrainStep(state, player);
  if (spyTrain) return spyTrain;
  const balloonTrain = balloonTrainStep(state, player);
  if (balloonTrain) return balloonTrain;

  // Händler und Baumeister investieren jede zweite Runde zuerst in Gebäude.
  const persona = R.personaOf(state, player);
  if ((persona === 'builder' || persona === 'merchant') && state.round % 2 === 0) {
    const early = bestBuilding(state, player);
    if (early) return early;
  }
  for (const c of R.citiesFor(state, player)) {
    const unlocked = R.unlockedUnits(state, player);
    const stars = state.stars[player];
    const order = [
      'giant', 'paladin', 'knight', 'horsearcher', 'battleship', 'airship', 'ship', 'swordsman', 'catapult', 'crossbow', 'fireballoon',
      'boat', 'mindbender', 'archer', 'pikeman', 'defender', 'rider', 'warrior'
    ];
    // Gemischte Armee: keine Einheitenart über 35 % der Landtruppen.
    const army = mine.filter(u => !UNITS[u.type].abilities.includes('water') && UNITS[u.type].atk > 0);
    const share = t => army.length < 4 ? 0 : army.filter(u => u.type === t).length / army.length;
    // Rammbock, sobald eine feindliche Stadt nahe ist und noch keiner da ist.
    const enemyCityNear = state.cities.some(e => e.owner && R.hostile(state, player, e.owner) && hexDistance(e.q, e.r, c.q, c.r) <= 6 &&
      !R.graceProtects(state, player, e.owner));
    if (enemyCityNear && unlocked.includes('ram') && !mine.some(u => u.type === 'ram') && stars >= R.unitCost(state, player, 'ram') + 2 &&
      R.canTrain(state, c, 'ram', player).ok) return { kind: 'train', city: c, type: 'ram' };
    // Ab 6 Kämpfern ein Gedankenbeuger als Heiler und Bekehrer.
    if (army.length >= 6 && unlocked.includes('mindbender') && !mine.some(u => u.type === 'mindbender') &&
      stars >= R.unitCost(state, player, 'mindbender') + 2 && R.canTrain(state, c, 'mindbender', player).ok) {
      return { kind: 'train', city: c, type: 'mindbender' };
    }
    // Händlerkarren: einer zur Zeit, wenn es eine zweite Stadt gibt.
    if (unlocked.includes('cart') && !mine.some(u => u.type === 'cart') && R.citiesFor(state, player).length >= 2 &&
      stars >= R.unitCost(state, player, 'cart') + (persona === 'merchant' ? 2 : 8) && R.canTrain(state, c, 'cart', player).ok) {
      return { kind: 'train', city: c, type: 'cart' };
    }
    // Gegen nahe Reiterei Pikeniere aufstellen.
    const cavalry = state.units.some(e => R.hostile(state, player, e.owner) &&
      ['rider', 'knight', 'paladin'].includes(e.type) && hexDistance(e.q, e.r, c.q, c.r) <= 4);
    if (cavalry && unlocked.includes('pikeman') && R.unitCost(state, player, 'pikeman') <= stars &&
      R.canTrain(state, c, 'pikeman', player).ok) return { kind: 'train', city: c, type: 'pikeman' };
    // Bestes Wunschziel, das hier gerade möglich ist (Land- und Schiffsplatz getrennt).
    for (const t of order) {
      if (!unlocked.includes(t)) continue;
      if (share(t) > 0.35) continue;
      if (R.unitCost(state, player, t) > stars) continue;
      if (t === 'giant' && stars < 10) continue;
      if (R.canTrain(state, c, t, player).ok) return { kind: 'train', city: c, type: t };
      // Nur bis zum ersten bezahlbaren Landwunsch suchen: sonst spart die KI nie.
      if (!UNITS[t].abilities.includes('water')) break;
    }
    // Küstenstädte bauen auch Schiffe, solange die KI keine hat.
    const naval = ['battleship', 'ship', 'boat'].find(t => unlocked.includes(t) && R.unitCost(state, player, t) <= stars - 2);
    const fleet = state.units.filter(u => u.owner === player && UNITS[u.type].abilities.includes('water') && !u.carry).length;
    if (naval && fleet < (persona === 'seafarer' ? 3 : 1) &&
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
    if (u.type === 'spy' || u.type === 'balloon') {
      const mv = spyMove(state, u);
      if (mv) return mv;
      continue;
    }
    if (u.type === 'mindbender') {
      const mv = healerMove(state, u);
      if (mv) return { kind: 'move', unit: mv.unit, q: mv.q, r: mv.r };
      continue;
    }
    if (u.type === 'cart') {
      if (R.tradeOption(state, u)) return { kind: 'trade', unit: u };
      const mv = cartMove(state, u);
      if (mv) return { kind: 'move', unit: mv.unit, q: mv.q, r: mv.r };
      continue;
    }
    if (u.type === 'settler') {
      const mv = bestSettleMove(state, u);
      if (mv) return { kind: 'move', unit: mv.unit, q: mv.q, r: mv.r };
      continue;
    }
    const light = lighthouseMove(state, u);
    if (light) return light;
    const mv = bestMove(state, u, player);
    if (mv) return { kind: 'move', unit: mv.unit, q: mv.q, r: mv.r };
  }

  for (const c of R.citiesFor(state, player)) {
    const cost = R.popCost(c, state);
    if (c.pop < 5 && state.stars[player] >= cost + 3 && R.canBuyPop(state, c, player).ok) {
      return { kind: 'buyPop', city: c };
    }
  }

  const build = bestBuilding(state, player);
  if (build) return build;

  const techOrder = [
    'organization', 'hunting', 'archery', 'farming', 'riding', 'roads',
    'climbing', 'mining', 'shields', 'forestry', 'mathematics', 'meditation',
    'philosophy', 'smithery', 'construction', 'freespirit', 'chivalry', 'crossbows', 'pikes',
    'trade', 'mills', 'smelting', 'markets', 'spiritualism', 'fishing', 'sailing', 'ramming', 'navigation', 'aquatism',
    'scholarship', 'horseshoes', 'engineering', 'ballooning', 'cartography', 'fishfarming', 'diplomacy',
    'banking', 'steel', 'planning', 'medicine', 'tournaments', 'printing', 'seapower', 'harbors', 'espionage',
    'paladins', 'airships', 'plate', 'rotation', 'guilds', 'marksmen', 'monastic', 'castles', 'naval', 'shipyards'
  ];
  if (R.citiesFor(state, player).some(c => R.coastal(state, c))) {
    techOrder.splice(techOrder.indexOf('roads') + 1, 0, ...techOrder.splice(techOrder.indexOf('fishing'), 2));
  }
  // Persönlichkeit: Lieblingstechniken nach vorn.
  const favs = { conqueror: ['archery', 'riding', 'smithery', 'chivalry', 'crossbows'], merchant: ['roads', 'trade', 'markets', 'farming'],
    seafarer: ['fishing', 'sailing', 'navigation', 'ramming'], builder: ['farming', 'construction', 'mills', 'mining', 'meditation'] }[persona] || [];
  for (const t of favs.slice().reverse()) {
    const i = techOrder.indexOf(t);
    if (i > 0) techOrder.unshift(...techOrder.splice(i, 1));
  }
  for (const t of techOrder) {
    if (easy && TECHS[t].tier > 2) continue;
    if (R.canResearch(state, t, player).ok && state.stars[player] >= R.techCost(state, t, player) + 5) {
      return { kind: 'research', tech: t };
    }
  }

  const road = roadStep(state, player);
  if (road) return road;

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
    case 'upgrade': return R.upgradeUnit(state, step.unit, player);
    case 'trade': return R.trade(state, step.unit, player);
    case 'road': {
      const res = R.buildRoad(state, player, step.q, step.r);
      if (res.ok) { if (!state.aiRoadRound) state.aiRoadRound = {}; state.aiRoadRound[player] = state.round; }
      return res;
    }
    case 'bridge': {
      const res = R.buildBridge(state, step.unit, step.dir, player);
      if (res.ok) { if (!state.aiBridgeRound) state.aiBridgeRound = {}; state.aiBridgeRound[player] = state.round; }
      return res;
    }
    default: throw new Error('unknown step ' + step.kind);
  }
}
