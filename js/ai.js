import * as R from './rules.js';
import { UNITS, IMPROVEMENTS, TECHS, BRIDGE, ROAD, MAP_W, MAP_H, VISION } from './config.js';
import { hexDistance, hk, forEachHex, neighbors as hexNeighbors } from './hex.js';

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
// Fremde Stadt, deren Feld der Stamm schon entdeckt hat.
const knownCity = (state, player, c) => c.owner === player || R.isExplored(state, player, c.q, c.r);

// Besitzer einer Stadt, wie der Stamm ihn kennt: in Sicht der echte, sonst
// der aus dem Gedächtnis (cityMemory). So merkt die KI nicht, wenn eine Stadt
// im Nebel den Besitzer wechselt. Den Verlust einer eigenen Stadt erfährt sie
// dagegen sofort (wie der Mensch über die Meldung).
function seenOwner(state, player, c) {
  const vis = visibleOf.get(state);
  if (!vis || c.owner === player || vis.has(vkey(c.q, c.r))) return c.owner;
  const mem = state.cityMemory && state.cityMemory[player] && state.cityMemory[player][hk(c.q, c.r)];
  if (mem && mem.owner === player) return c.owner;
  // Alte Spielstände ohne Gedächtnis: wie cityView als neutral behandeln.
  return mem ? mem.owner : null;
}

// Daten, die innerhalb eines Planungsschritts gleich bleiben (planStep legt
// für jeden Schritt ein neues Objekt an, nichts überdauert einen Schritt).
let stepCtx = { state: null };
const stepData = state => (stepCtx.state === state ? stepCtx : (stepCtx = { state }));

function targetCities(state, player) {
  const ctx = stepData(state);
  const key = 'targets|' + player;
  if (!ctx[key]) ctx[key] = findTargetCities(state, player);
  return ctx[key];
}

function findTargetCities(state, player) {
  return state.cities.filter(c => {
    if (!knownCity(state, player, c)) return false;
    const owner = seenOwner(state, player, c);
    return R.hostile(state, player, owner) && !R.graceProtects(state, player, owner);
  });
}

// Erreichbare Felder ohne die Ziele, an denen diese Einheit in diesem Zug schon
// gescheitert ist (versteckte Einheit im Nebel, siehe applyStep).
const unitKey = u => (u.id || hk(u.q, u.r)) + '|';
function blockedList(state, player) {
  const b = state.aiBlocked;
  return b && b.round === state.round && b.player === player ? b.keys : null;
}
function reachOf(state, unit) {
  const m = R.reachableMap(state, unit);
  const keys = blockedList(state, unit.owner);
  if (keys && keys.length && m.size) {
    const pre = unitKey(unit);
    for (const k of keys) if (k.startsWith(pre)) m.delete(k.slice(pre.length));
  }
  return m;
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
      !u.carry && UNITS[u.type].atk > 0 && !R.cityAt(state, u.q, u.r) &&
      // Weiter als 2 Felder je Bewegung (Weg zu Weg) kommt keine Einheit.
      hexDistance(u.q, u.r, city.q, city.r) <= Math.round(2 * u.mp) && reachOf(state, u).has(k));
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

// Spion (oder Einheit ohne bekanntes Ziel) zieht dorthin, wo er am meisten
// Unentdecktes aufdeckt.
function spyMove(state, spy) {
  const reach = reachOf(state, spy);
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

// Kampfeinheit ohne bekanntes Ziel: Unentdecktes aufdecken und dabei von der
// eigenen Hauptstadt wegziehen, damit die Suche nicht im Kreis läuft.
function exploreMove(state, unit, player) {
  const reach = reachOf(state, unit);
  if (!reach.size) return null;
  const known = new Set((state.explored && state.explored[player]) || []);
  const unknown = [];
  forEachHex((q, r) => { if (!known.has(hk(q, r))) unknown.push([q, r]); });
  if (!unknown.length) return null;
  const cap = R.citiesFor(state, player).find(c => c.isCapital) || unit;
  const mid = [Math.round(MAP_W / 2 - MAP_H / 4), Math.round(MAP_H / 2)];
  const score = (q, r) => {
    const sight = R.unitSight(state, { ...unit, q, r });
    const reveal = unknown.filter(([uq, ur]) => hexDistance(q, r, uq, ur) <= sight).length;
    const near = Math.min(...unknown.map(([uq, ur]) => hexDistance(q, r, uq, ur)));
    // Weg von der eigenen Hauptstadt und zur Kartenmitte: Die Startplätze
    // liegen im Ring um die Mitte, dort trifft man am ehesten auf andere.
    return reveal * 3 - near + hexDistance(q, r, cap.q, cap.r) * 0.5 - hexDistance(q, r, mid[0], mid[1]) - (R.threatened(state, { ...unit, q, r }) ? 8 : 0);
  };
  let best = { q: unit.q, r: unit.r, sc: score(unit.q, unit.r) };
  for (const [k] of reach) {
    const [q, r] = k.split(',').map(Number);
    const city = R.cityAt(state, q, r);
    if (city && city.owner !== player) continue;
    const sc = score(q, r);
    if (sc > best.sc) best = { q, r, sc };
  }
  return best.q !== unit.q || best.r !== unit.r ? { unit, q: best.q, r: best.r } : null;
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
  return generalBuilding(state, player);
}

// Bewertete Bauplätze je Partie (Kartenfeld als Schlüssel, die Nebel-Kopie
// teilt es mit dem echten Stand) und Spieler. Der Schlüssel enthält alles, was
// die Liste beeinflusst; Sterne und Einheiten auf den Feldern werden erst
// danach geprüft. Ein Treffer liefert also genau dasselbe wie eine neue Rechnung
// (wichtig fürs Nachspielen der Protokolle).
const buildCache = new WeakMap();

function buildKey(state, player, own) {
  const parts = [player, state.winner ? 1 : 0, state.techs[player].join('.')];
  for (const c of state.cities) parts.push(c.q, c.r, c.owner, c.pop, c.isCapital ? 1 : 0, c.rewards ? Object.values(c.rewards).join('.') : '');
  for (const k in state.improvements || {}) parts.push(k, state.improvements[k]);
  parts.push('|', Object.keys(state.resources || {}).join(';'), '|', Object.keys(state.bridges || {}).join(';'), '|');
  // Wachturm nur bei Feinden in der Nähe.
  for (const c of own) parts.push(towerFoe(state, player, c) ? 1 : 0);
  return parts.join(',');
}

const towerFoe = (state, player, city) =>
  state.units.some(e => e.owner && R.hostile(state, player, e.owner) && hexDistance(e.q, e.r, city.q, city.r) <= 5);

function generalBuilding(state, player) {
  const own = R.citiesFor(state, player);
  const key = buildKey(state, player, own);
  let perGame = buildCache.get(state.terrain);
  if (!perGame) { perGame = new Map(); buildCache.set(state.terrain, perGame); }
  let hit = perGame.get(player);
  if (!hit || hit.key !== key) {
    hit = { key, list: buildCandidates(state, player, own) };
    perGame.set(player, hit);
  }
  // Bester bezahlbarer Platz, auf dem gerade keine Einheit steht.
  const stars = state.stars[player];
  for (const b of hit.list) {
    if (stars >= b.cost + 2 && !R.unitAt(state, b.q, b.r)) return { kind: b.kind, city: b.city, type: b.type, q: b.q, r: b.r, score: b.score };
  }
  return null;
}

// Alle sinnvollen Bauplätze, beste zuerst (bei Gleichstand der zuerst gefundene),
// mit Kosten: ob die Sterne reichen, prüft generalBuilding.
function buildCandidates(state, player, own) {
  // Ohne Einheiten prüfen: wer gerade auf einem Feld steht, entscheidet generalBuilding.
  const bare = { ...state, units: [] };
  // Stadtfelder, Häfen und Ballonplätze einmal pro Aufruf statt je Feld und Gebäude.
  const tiles = new Map(own.map(c => [c, R.cityTiles(state, c)]));
  const has = (c, imp) => tiles.get(c).some(([q, r]) => R.improvementAt(state, q, r) === imp);
  const anyAirfield = own.some(c => has(c, 'airfield'));
  // Ohne Hafen keine Schiffe: mit Segeln den ersten Hafen bevorzugen.
  const needsPort = state.techs[player].includes('sailing') && !own.some(c => has(c, 'port'));
  // Mit Ballonfahrt den ersten Ballonplatz vorziehen (sonst belegen Farmen alle Felder).
  const needsAirfield = state.techs[player].includes('ballooning') && !anyAirfield;
  const list = [];
  for (const city of own) {
    if (!needsPort && city.pop < 2 && own.length < 3) continue;
    // Ein Hafen pro Stadt reicht – mehr bringt der KI nur leere Wasserfelder.
    const hasPort = has(city, 'port');
    const noTower = has(city, 'watchtower') || !towerFoe(state, player, city);
    for (const [q, r] of tiles.get(city)) {
      if (R.improvementAt(state, q, r) || R.resourceAt(state, q, r)) continue;
      for (const type of Object.keys(IMPROVEMENTS)) {
        const def = IMPROVEMENTS[type];
        if (def.monument || (def.tech && !state.techs[player].includes(def.tech))) continue;
        // Ein Ballonplatz pro Stamm reicht.
        if (type === 'airfield' && anyAirfield) continue;
        if (type === 'port' && hasPort) continue;
        if (type === 'watchtower' && noTower) continue;
        const cost = R.improvementCost(state, player, type);
        if (!R.canImprove(bare, city, type, q, r).ok) continue;
        // Ertrag je Stern, inklusive Nachbarschaftsbonus (Mühle, Schmelzhütte, Markt).
        const gain = R.improvePreview(state, city, type, q, r).gain + (type === 'watchtower' ? 0.6 : 0);
        const score = gain / cost + (type === 'port' && needsPort ? 1 : 0) + (type === 'airfield' && needsAirfield ? 1 : 0);
        if (score <= 0) continue;
        list.push({ kind: 'improve', city, type, q, r, score, cost });
      }
    }
  }
  // Stabile Sortierung: wie bisher gewinnt bei gleicher Wertung der erste Fund.
  return list.sort((a, b) => b.score - a.score);
}

function settleStep(state, player) {
  const sitters = state.units.filter(u => u.owner === player && u.type === 'settler' && !u.acted);
  for (const s of sitters) {
    if (R.canFound(state, s, player).ok) return { kind: 'settle', unit: s };
  }
  const cities = R.citiesFor(state, player);
  if (cities.length >= 5) return null;
  if (state.round - ((state.settlerAt && state.settlerAt[player]) || 0) < 3) return null;
  // Immer nur ein Siedler unterwegs.
  if (state.units.some(u => u.owner === player && u.type === 'settler')) return null;
  const cap = cities.find(c => c.isCapital);
  if (!cap || cap.trained) return null;
  if (state.units.some(u => u.q === cap.q && u.r === cap.r)) return null;
  if (state.stars[player] < UNITS.settler.cost + 3) return null;
  if (!R.canTrain(state, cap, 'settler', player).ok) return null;
  // Nur ausbilden, wenn es von der Hauptstadt aus einen Gründungsplatz gibt.
  if (!settleGoal(state, { owner: player, type: 'settler', q: cap.q, r: cap.r, mp: 1 })) return null;
  return { kind: 'train', city: cap, type: 'settler' };
}

const isWater = t => t === 'water' || t === 'ocean';

// Felder, die ein Siedler (Bewegung 1) in einem Schritt betreten kann: kein
// Wasser (außer Brücke), keine fremde Stadt, nichts, was mehr als 1 kostet
// (Wald und Berg nur über eigene Wege).
function settlerCanStep(state, s, q, r) {
  const tile = R.terrainAt(state, q, r);
  if (isWater(tile) && !R.bridgeAt(state, q, r)) return false;
  if (!R.canEnter(state, s, tile, q, r)) return false;
  const c = R.cityAt(state, q, r);
  if (c && c.owner !== s.owner) return false;
  return R.moveCost(state, s, q, r) <= R.maxMove(state, s.owner, s.type);
}

// Bester Gründungsplatz für den Siedler s: Breitensuche über begehbare,
// entdeckte Felder (höchstens 8 Schritte). Bewertet werden die Umgebung
// (Land, Rohstoffe, nicht schon fremdes Gebiet), der Weg und die Nähe zu den
// eigenen Städten. Liefert { q, r, first } (first: erster Schritt) oder null.
function settleGoal(state, s) {
  const player = s.owner;
  const start = hk(s.q, s.r);
  const prev = new Map([[start, null]]);
  const dist = new Map([[start, 0]]);
  const queue = [[s.q, s.r]];
  const own = R.citiesFor(state, player);
  const foes = state.units.filter(e => R.hostile(state, player, e.owner) && R.canEverAttack(e.type));
  let best = null;
  for (let i = 0; i < queue.length; i++) {
    const [q, r] = queue[i];
    const k = hk(q, r);
    const d = dist.get(k);
    if (d > 0 && R.canFound(state, { ...s, q, r }, player).ok && !R.unitAt(state, q, r)) {
      let score = -d * 1.5;
      for (const [nq, nr] of hexNeighbors(q, r)) {
        const t = R.terrainAt(state, nq, nr);
        if (R.tileCity(state, nq, nr)) continue;
        score += R.resourceAt(state, nq, nr) ? 2 : t === 'field' || t === 'forest' || t === 'hills' ? 1 : isWater(t) ? 0.5 : 0.3;
      }
      const near = own.length ? Math.min(...own.map(c => hexDistance(q, r, c.q, c.r))) : 3;
      score -= Math.max(0, near - 4) * 2;
      if (state.cities.some(c => c.owner !== player && hexDistance(q, r, c.q, c.r) <= 3)) score -= 4;
      if (foes.some(e => hexDistance(q, r, e.q, e.r) <= 2)) score -= 6;
      if (!best || score > best.score) best = { q, r, k, score };
    }
    if (d >= 8) continue;
    for (const [nq, nr] of hexNeighbors(q, r)) {
      const nk = hk(nq, nr);
      if (dist.has(nk) || !R.isExplored(state, player, nq, nr) || !settlerCanStep(state, s, nq, nr)) continue;
      dist.set(nk, d + 1);
      prev.set(nk, k);
      queue.push([nq, nr]);
    }
  }
  if (!best) return null;
  let first = best.k;
  while (prev.get(first) && prev.get(first) !== start) first = prev.get(first);
  return { q: best.q, r: best.r, first };
}

// Siedler zum besten Gründungsplatz führen. Ohne Platz in Reichweite zieht er
// trotzdem aus einer Stadt heraus, damit dort wieder ausgebildet werden kann.
function bestSettleMove(state, s) {
  const reach = reachOf(state, s);
  if (!reach.size) return null;
  const goal = settleGoal(state, s);
  if (goal) {
    if (reach.has(goal.first)) {
      const [q, r] = goal.first.split(',').map(Number);
      return { unit: s, q, r };
    }
    // Erster Schritt besetzt: das erreichbare Feld, das dem Ziel am nächsten ist.
    let best = null, bd = hexDistance(s.q, s.r, goal.q, goal.r);
    if (R.cityAt(state, s.q, s.r)) bd = Infinity;
    for (const [k] of reach) {
      const [q, r] = k.split(',').map(Number);
      if (R.cityAt(state, q, r)) continue;
      const d = hexDistance(q, r, goal.q, goal.r);
      if (d < bd) { bd = d; best = { unit: s, q, r }; }
    }
    return best;
  }
  if (!R.cityAt(state, s.q, s.r)) return null;
  let best = null, bs = -Infinity;
  for (const [k] of reach) {
    const [q, r] = k.split(',').map(Number);
    if (R.cityAt(state, q, r)) continue;
    const sc = -(R.threatened(state, { ...s, q, r }) ? 10 : 0) - hexNeighbors(q, r).filter(([nq, nr]) => R.cityAt(state, nq, nr)).length;
    if (sc > bs) { bs = sc; best = { unit: s, q, r }; }
  }
  return best;
}

// Gedankenbeuger: neben möglichst viele verletzte eigene Einheiten (heilt sie zu
// Rundenbeginn) oder neben einen bekehrbaren Gegner; sonst bei der Armee bleiben.
function healerMove(state, mb) {
  const reach = reachOf(state, mb);
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
  const cities = state.cities.filter(c => {
    if (home && c.q === home.q && c.r === home.r) return false;
    if (!knownCity(state, cart.owner, c)) return false;
    const owner = seenOwner(state, cart.owner, c);
    return owner && (owner === cart.owner || R.atPeace(state, cart.owner, owner));
  });
  if (!cities.length) return null;
  const worth = c => (home ? hexDistance(home.q, home.r, c.q, c.r) : 3) * (c.owner === cart.owner ? 1 : 1.5) - hexDistance(cart.q, cart.r, c.q, c.r) * 0.6;
  const goal = cities.reduce((a, b) => (worth(b) > worth(a) ? b : a));
  const reach = reachOf(state, cart);
  let best = null, bd = hexDistance(cart.q, cart.r, goal.q, goal.r);
  for (const [k] of reach) {
    const [q, r] = k.split(',').map(Number);
    if (R.unitAt(state, q, r)) continue;
    const d = hexDistance(q, r, goal.q, goal.r);
    if (d < bd) { bd = d; best = { unit: cart, q, r }; }
  }
  return best;
}

// Einheiten ohne lohnenden Zug werden in jedem Schritt wieder geprüft. Ein
// "kein Zug" gilt weiter, solange sich nichts geändert hat, was Weg oder
// Wertung beeinflusst (Einheit, Ziel, Einheiten und Städte in Reichweite,
// Wege, Brücken, Gebäude wie Häfen, Frieden, Schonfrist) – der Merker ändert also nie das Ergebnis.
const noMoveCache = new WeakMap();
function noMoveMemo(state) {
  let memo = noMoveCache.get(state.terrain);
  if (!memo) { memo = new Map(); noMoveCache.set(state.terrain, memo); }
  return memo;
}

function moveSig(state, unit, player, target) {
  const rad = 2 * Math.max(0, unit.mp) + 3;
  const ctx = stepData(state);
  const base = 'sig|' + player;
  if (!ctx[base]) {
    ctx[base] = [state.round, state.techs[player].length,
      Object.keys(state.roads || {}).length, Object.keys(state.bridges || {}).length, Object.keys(state.improvements || {}).length,
      JSON.stringify(state.peace || null), JSON.stringify(state.provoked || null), (blockedList(state, player) || []).length].join(',');
  }
  const parts = [ctx[base], unit.q, unit.r, unit.mp, unit.hp, unit.acted ? 1 : 0, unit.hasMoved ? 1 : 0, unit.type, unit.carry || '',
    target.q, target.r];
  // Einheiten in Reichweite über ein grobes Raster (8×8-Felder) statt alle durchsuchen.
  if (!ctx.grid) {
    ctx.grid = new Map();
    for (const u of state.units) {
      const g = (u.q >> 3) + ':' + (u.r >> 3);
      if (!ctx.grid.has(g)) ctx.grid.set(g, []);
      ctx.grid.get(g).push(u);
    }
  }
  for (let gr = (unit.r - rad) >> 3; gr <= (unit.r + rad) >> 3; gr++) {
    for (let gq = (unit.q - rad) >> 3; gq <= (unit.q + rad) >> 3; gq++) {
      for (const u of ctx.grid.get(gq + ':' + gr) || []) if (hexDistance(u.q, u.r, unit.q, unit.r) <= rad) parts.push(u.q, u.r, u.owner);
    }
  }
  parts.push('|');
  // Belohnungen zählen mit: die Grenzerweiterung ändert, wo eigene Wege gelten.
  for (const c of state.cities) {
    if (hexDistance(c.q, c.r, unit.q, unit.r) <= rad + 2) parts.push(c.q, c.r, c.owner, c.rewards ? Object.values(c.rewards).join('.') : '');
  }
  return parts.join(',');
}

function bestMove(state, unit, player) {
  const enemyCities = targetCities(state, player);
  let target = null;
  if (enemyCities.length) {
    target = enemyCities.reduce((a, b) =>
      hexDistance(unit.q, unit.r, a.q, a.r) <= hexDistance(unit.q, unit.r, b.q, b.r) ? a : b);
  } else {
    const enemyUnits = state.units.filter(u => R.hostile(state, player, u.owner) && !R.graceProtects(state, player, u.owner));
    if (enemyUnits.length) target = enemyUnits.reduce((a, b) =>
      hexDistance(unit.q, unit.r, a.q, a.r) <= hexDistance(unit.q, unit.r, b.q, b.r) ? a : b);
  }
  let memo = null, sig = null;
  if (target && unit.id) {
    memo = noMoveMemo(state);
    sig = moveSig(state, unit, player, target);
    if (memo.get(unit.id) === sig) return null;
  }
  const reach = reachOf(state, unit);
  if (!reach.size) return null;
  // Noch kein Gegner bekannt: ins Unentdeckte ziehen, weg von der eigenen
  // Hauptstadt (dort liegen die Nachbarn).
  if (!target) return exploreMove(state, unit, player);
  const mv = aimMove(state, unit, player, target, reach);
  if (memo) { if (mv) memo.delete(unit.id); else memo.set(unit.id, sig); }
  return mv;
}

function aimMove(state, unit, player, target, reach) {
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
    // Waldläufer warten bevorzugt in Deckung (Wald, Hügel, Sumpf).
    if (unit.type === 'ranger') score += (COVER[R.terrainAt(state, q, r)] || 0) * (canHit ? 3 : 1);
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
  // Wie bei bestMove: "kein Zug" gilt weiter, solange sich nichts ändert.
  const memo = unit.id ? noMoveMemo(state) : null;
  const sig = memo && 'L' + moveSig(state, unit, unit.owner, { q: lq, r: lr });
  if (memo && memo.get('L' + unit.id) === sig) return null;
  let best = null;
  for (const k of reachOf(state, unit).keys()) {
    const [q, r] = k.split(',').map(Number);
    const d = hexDistance(q, r, lq, lr);
    if (d < cur && (!best || d < best.d)) best = { q, r, d };
  }
  if (memo) { if (best) memo.delete('L' + unit.id); else memo.set('L' + unit.id, sig); }
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
    // Riese nur, wenn danach noch genug Sterne übrig sind, sonst Park.
    else if (opts.includes('giant')) pick = state.stars[player] >= UNITS.giant.cost + 5 ? 'giant' : 'park';
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
  const reach = reachOf(state, unit);
  for (const [k] of reach) {
    if (state.ruins[k]) {
      const [q, r] = k.split(',').map(Number);
      return { kind: 'move', unit, q, r };
    }
  }
  return null;
}

// Söldnerlager: anwerben, wenn eine Einheit darauf steht, sonst ein
// erreichbares, noch ungenutztes Lager ansteuern (nur mit genug Sternen).
function campStep(state, unit) {
  if (!state.camps || unit.type === 'settler' || unit.type === 'cart') return null;
  const stars = state.stars[unit.owner];
  const here = R.hireOption(state, unit);
  if (here && here.ok && stars >= here.cost + 2) return { kind: 'hire', unit };
  if (unit.mp <= 0 || here) return null;
  const open = Object.entries(state.camps).filter(([k, c]) => {
    if (c.used.includes(unit.owner) || stars < R.mercCost(c.type) + 2) return false;
    const [q, r] = k.split(',').map(Number);
    return hexDistance(unit.q, unit.r, q, r) <= unit.mp;
  });
  if (!open.length) return null;
  const reach = reachOf(state, unit);
  for (const [k] of open) {
    if (!reach.has(k)) continue;
    const [q, r] = k.split(',').map(Number);
    return { kind: 'move', unit, q, r };
  }
  return null;
}

// Der Brander opfert sich: nur, wenn er dabei mehr zerstört, als er kostet.
function fireshipWorth(state, ship, target) {
  const res = R.battleResults(state, ship, target);
  let value = res.damage >= target.hp ? UNIT_VALUE[target.type] : 0;
  const splash = Math.max(1, Math.round(res.damage / 2));
  for (const e of state.units) {
    if (e === target || hexDistance(e.q, e.r, target.q, target.r) !== 1 || !R.hostile(state, ship.owner, e.owner)) continue;
    value += e.hp <= splash ? UNIT_VALUE[e.type] : 1;
  }
  return value >= UNIT_VALUE.fireship;
}

const wet = (state, q, r) => isWater(R.terrainAt(state, q, r));
const atCoast = (state, q, r) => wet(state, q, r) || hexNeighbors(q, r).some(([nq, nr]) => wet(state, nq, nr));

// Feindliche Schiffe oder Einheiten an der Küste höchstens 5 Felder von der Stadt.
function navalThreat(state, player, city) {
  return state.units.some(e => e.owner && R.hostile(state, player, e.owner) && !R.graceProtects(state, player, e.owner) &&
    hexDistance(e.q, e.r, city.q, city.r) <= 5 && atCoast(state, e.q, e.r));
}

// Brander: zum lohnendsten erreichbaren Feind an der Küste fahren (Wert des
// Ziels plus Nachbarn, die der Flächenschaden trifft, abzüglich Weg).
function fireshipMove(state, ship, player) {
  const foes = state.units.filter(e => e.owner && R.hostile(state, player, e.owner) && !R.graceProtects(state, player, e.owner) &&
    atCoast(state, e.q, e.r) && hexDistance(e.q, e.r, ship.q, ship.r) <= 10);
  if (!foes.length) return null;
  const worth = e => UNIT_VALUE[e.type] + foes.filter(o => o !== e && hexDistance(o.q, o.r, e.q, e.r) === 1).length * 2 -
    hexDistance(e.q, e.r, ship.q, ship.r) * 0.8;
  const target = foes.reduce((a, b) => (worth(b) > worth(a) ? b : a));
  const cur = hexDistance(ship.q, ship.r, target.q, target.r);
  if (cur <= 1) return null;
  let best = null;
  for (const [k, cost] of reachOf(state, ship)) {
    const [q, r] = k.split(',').map(Number);
    const d = hexDistance(q, r, target.q, target.r);
    if (d >= cur) continue;
    const sc = -d * 10 - cost * 0.5;
    if (!best || sc > best.sc) best = { q, r, sc };
  }
  return best;
}

// Bannerträger: neben möglichst viele eigene Kämpfer (besonders solche nahe am
// Feind), nicht ins Feuer; ohne Kämpfer in Reichweite zur nächsten Gruppe.
function bannerMove(state, b) {
  const player = b.owner;
  const fighters = state.units.filter(u => u.owner === player && u !== b && UNITS[u.type].atk > 0 &&
    !UNITS[u.type].abilities.includes('water') && !R.isAir(u.type) && !UNITS[u.type].abilities.includes('banner'));
  if (!fighters.length) return null;
  const foes = state.units.filter(e => e.owner && R.hostile(state, player, e.owner) && R.canEverAttack(e.type));
  const engaged = f => foes.some(e => hexDistance(e.q, e.r, f.q, f.r) <= 3);
  const weight = new Map(fighters.map(f => [f, engaged(f) ? 2 : 1]));
  const score = (q, r) => {
    let sc = 0;
    for (const f of fighters) if (hexDistance(q, r, f.q, f.r) === 1) sc += weight.get(f);
    if (R.threatened(state, { ...b, q, r })) sc -= 1.5;
    if (R.cityAt(state, q, r)) sc -= 0.5;
    return sc;
  };
  const reach = reachOf(state, b);
  let best = { q: b.q, r: b.r, sc: score(b.q, b.r) };
  for (const [k] of reach) {
    const [q, r] = k.split(',').map(Number);
    const sc = score(q, r);
    if (sc > best.sc) best = { q, r, sc };
  }
  if (best.sc > 0 || !reach.size) return best.q !== b.q || best.r !== b.r ? best : null;
  // Keiner in Reichweite: Richtung der nächsten Kämpfer (am liebsten der am Feind).
  const goal = fighters.reduce((a, c) => (hexDistance(b.q, b.r, c.q, c.r) - weight.get(c) * 2 < hexDistance(b.q, b.r, a.q, a.r) - weight.get(a) * 2 ? c : a));
  const cur = hexDistance(b.q, b.r, goal.q, goal.r);
  let mv = null, md = cur;
  for (const [k] of reach) {
    const [q, r] = k.split(',').map(Number);
    const d = hexDistance(q, r, goal.q, goal.r);
    if (d < md && !R.cityAt(state, q, r)) { md = d; mv = { q, r }; }
  }
  return mv;
}

// Waldläufer: Deckungsfeld neben dem Ziel, von dem aus er angreifen kann.
const COVER = { forest: 3, hills: 2, swamp: 1 };
function rangerCover(state, u, target) {
  if (u.hasMoved || u.mp <= 0 || COVER[R.terrainAt(state, u.q, u.r)]) return null;
  let best = null;
  for (const [k] of reachOf(state, u)) {
    const [q, r] = k.split(',').map(Number);
    const c = COVER[R.terrainAt(state, q, r)];
    if (!c || hexDistance(q, r, target.q, target.r) > R.rangeOf(state, u) || R.cityAt(state, q, r)) continue;
    if (!best || c > best.c) best = { q, r, c };
  }
  return best ? { kind: 'move', unit: u, q: best.q, r: best.r } : null;
}

// Sichtbare Felder wie R.isVisible (Sichtweite eigener Einheiten und Städte),
// einmal als Menge berechnet statt für jede fremde Einheit neu.
// Feldschlüssel als Zahl (schneller als der Text aus hk); +64 hält ihn eindeutig,
// auch wenn eine Sichtweite über den Kartenrand reicht.
const vkey = (q, r) => (q + 64) * 4096 + (r + 64);
function visibleSet(state, player) {
  const keys = new Set();
  const add = (q, r, rad) => {
    for (let dq = -rad; dq <= rad; dq++) {
      const lo = Math.max(-rad, -dq - rad), hi = Math.min(rad, -dq + rad);
      for (let dr = lo; dr <= hi; dr++) keys.add(vkey(q + dq, r + dr));
    }
  };
  // Sichtweite hängt nur von Art, Feld und Technik ab: je Kombination einmal rechnen.
  const sight = new Map();
  for (const u of state.units) {
    if (u.owner !== player) continue;
    const k = u.type + '|' + R.terrainAt(state, u.q, u.r);
    if (!sight.has(k)) sight.set(k, R.unitSight(state, u));
    add(u.q, u.r, sight.get(k));
  }
  for (const c of state.cities) if (c.owner === player) add(c.q, c.r, VISION.city);
  return keys;
}
// Nebel-Ausschnitt → Menge der dabei sichtbaren Felder (für seenOwner).
const visibleOf = new WeakMap();

// Was ein Stamm wissen kann: fremde Einheiten nur in Sichtweite, Ruinen und
// Söldnerlager nur auf entdeckten Feldern. Städte bleiben drin, weil die Regeln daraus die
// Stadtgebiete berechnen; als Ziel zählt eine Stadt aber erst, wenn ihr Feld
// entdeckt ist (knownCity), ihr Besitzer gilt wie zuletzt gesehen (seenOwner). Die KI
// plant auf diesem Ausschnitt und sieht so wie ein Mensch nicht durch den
// Nebel (auch der Tipp für Menschen verrät nichts Verborgenes).
export function knownState(state, player) {
  if (!state.explored || !state.explored[player] || state.noFog) return state;
  const vis = visibleSet(state, player);
  const known = {
    ...state,
    units: state.units.filter(u => u.owner === player || vis.has(vkey(u.q, u.r))),
    ruins: state.ruins && Object.fromEntries(Object.entries(state.ruins).filter(([k]) => {
      const [q, r] = k.split(',').map(Number);
      return R.isExplored(state, player, q, r);
    })),
    camps: state.camps && Object.fromEntries(Object.entries(state.camps).filter(([k]) => {
      const [q, r] = k.split(',').map(Number);
      return R.isExplored(state, player, q, r);
    }))
  };
  visibleOf.set(known, vis);
  return known;
}

export function botStep(state, player) {
  if (state.winner || state.turn !== player) return null;
  return planStep(knownState(state, player), player);
}

function planStep(state, player) {
  stepCtx = { state };
  const mine = state.units.filter(u => u.owner === player);
  const easy = state.aiLevel === 'easy' && R.isBot(state, player);

  const reward = rewardStep(state, player);
  if (reward) return reward;

  const war = warStep(state, player);
  if (war) return war;

  let bestAttack = null;
  for (const u of mine) {
    if (u.acted) continue;
    // Der Bannerträger stärkt die anderen und greift selbst nie an.
    if (UNITS[u.type].abilities.includes('banner')) continue;
    for (const t of R.attackTargets(state, u)) {
      if (R.graceProtects(state, player, t.owner)) continue;
      const converts = UNITS[u.type].abilities.includes('convert');
      if (UNITS[u.type].abilities.includes('fireship') && !fireshipWorth(state, u, t)) continue;
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
  if (bestAttack) {
    // Waldläufer: erst in Deckung (Wald, Hügel, Sumpf) neben dem Ziel ziehen,
    // dann angreifen (Sturm erlaubt Angriff nach dem Zug).
    const cover = bestAttack.attacker.type === 'ranger' ? rangerCover(state, bestAttack.attacker, bestAttack.defender) : null;
    if (cover) return cover;
    return bestAttack;
  }

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
  const targets = targetCities(state, player);
  const unlocked = R.unlockedUnits(state, player);
  const order = [
    'giant', 'paladin', 'knight', 'horsearcher', 'battleship', 'airship', 'ship', 'swordsman', 'catapult', 'crossbow',
    'boat', 'mindbender', 'ranger', 'archer', 'pikeman', 'defender', 'rider', 'warrior'
  ];
  // Gemischte Armee: keine Einheitenart über 35 % der Landtruppen.
  const army = mine.filter(u => !UNITS[u.type].abilities.includes('water') && UNITS[u.type].atk > 0);
  const share = t => army.length < 4 ? 0 : army.filter(u => u.type === t).length / army.length;
  for (const c of R.citiesFor(state, player)) {
    const stars = state.stars[player];
    // Schiffsplatz frei und Hafen da? Sonst scheitert canTrain für Schiffe ohnehin;
    // sind beide Bauplätze verbraucht, gibt es hier nichts mehr zu tun.
    const canShip = !c.trainedShip && R.cityPorts(state, c).length > 0;
    if (c.trained && !canShip) continue;
    const water = t => UNITS[t].abilities.includes('water');
    // Rammbock, sobald eine feindliche Stadt nahe ist und noch keiner da ist.
    const enemyCityNear = targets.some(e => seenOwner(state, player, e) && hexDistance(e.q, e.r, c.q, c.r) <= 6);
    if (enemyCityNear && unlocked.includes('ram') && !mine.some(u => u.type === 'ram') && stars >= R.unitCost(state, player, 'ram') + 2 &&
      R.canTrain(state, c, 'ram', player).ok) return { kind: 'train', city: c, type: 'ram' };
    // Ab 6 Kämpfern ein Gedankenbeuger als Heiler und Bekehrer.
    if (army.length >= 6 && unlocked.includes('mindbender') && !mine.some(u => u.type === 'mindbender') &&
      stars >= R.unitCost(state, player, 'mindbender') + 2 && R.canTrain(state, c, 'mindbender', player).ok) {
      return { kind: 'train', city: c, type: 'mindbender' };
    }
    // Ab 5 Kämpfern ein Bannerträger, der die Truppe stärkt.
    if (army.length >= 5 && unlocked.includes('bannerman') && !mine.some(u => u.type === 'bannerman') &&
      stars >= R.unitCost(state, player, 'bannerman') + 3 && R.canTrain(state, c, 'bannerman', player).ok) {
      return { kind: 'train', city: c, type: 'bannerman' };
    }
    // Händlerkarren: einer zur Zeit, wenn es eine zweite Stadt gibt.
    if (unlocked.includes('cart') && !mine.some(u => u.type === 'cart') && R.citiesFor(state, player).length >= 2 &&
      stars >= R.unitCost(state, player, 'cart') + (persona === 'merchant' ? 2 : 8) && R.canTrain(state, c, 'cart', player).ok) {
      return { kind: 'train', city: c, type: 'cart' };
    }
    // Brander gegen feindliche Schiffe oder Einheiten an der Küste nahe der Stadt.
    if (unlocked.includes('fireship') && !mine.some(u => u.type === 'fireship') && stars >= R.unitCost(state, player, 'fireship') + 2 &&
      navalThreat(state, player, c) && R.canTrain(state, c, 'fireship', player).ok) return { kind: 'train', city: c, type: 'fireship' };
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
      if (water(t) && !canShip) continue;
      if (R.canTrain(state, c, t, player).ok) return { kind: 'train', city: c, type: t };
      // Nur bis zum ersten bezahlbaren Landwunsch suchen: sonst spart die KI nie.
      if (!UNITS[t].abilities.includes('water')) break;
    }
    // Küstenstädte bauen auch Schiffe, solange die KI keine hat.
    const naval = ['battleship', 'ship', 'boat'].find(t => unlocked.includes(t) && R.unitCost(state, player, t) <= stars - 2);
    const fleet = state.units.filter(u => u.owner === player && UNITS[u.type].abilities.includes('water') && !u.carry).length;
    if (naval && canShip && fleet < (persona === 'seafarer' ? 3 : 1) &&
      R.canTrain(state, c, naval, player).ok) return { kind: 'train', city: c, type: naval };
  }

  for (const u of mine) {
    if (u.mp <= 0) continue;
    const r = ruinStep(state, u);
    if (r) return r;
  }
  for (const u of mine) {
    if (u.acted) continue;
    const c = campStep(state, u);
    if (c) return c;
  }

  const bridge = bridgeStep(state, player);
  if (bridge) return bridge;

  for (const u of mine) {
    if (u.acted && u.mp <= 0) continue;
    // Bannerträger ziehen zuletzt, wenn die Kämpfer schon stehen.
    if (UNITS[u.type].abilities.includes('banner')) continue;
    if (u.type === 'fireship') {
      const mv = fireshipMove(state, u, player);
      if (mv) return { kind: 'move', unit: u, q: mv.q, r: mv.r };
    }
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
  for (const u of mine) {
    if (u.mp <= 0 || !UNITS[u.type].abilities.includes('banner')) continue;
    const mv = bannerMove(state, u);
    if (mv) return { kind: 'move', unit: u, q: mv.q, r: mv.r };
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
    case 'move': {
      const res = R.moveUnit(state, step.unit, step.q, step.r);
      // Weg von einer im Nebel verborgenen Einheit versperrt: nur dieses Ziel
      // für den Rest des Zugs sperren (reachOf), die Einheit darf woandershin.
      // Nach drei Fehlversuchen bleibt sie für diese Runde stehen.
      if (!res.ok) {
        let keys = blockedList(state, player);
        if (!keys) { state.aiBlocked = { round: state.round, player, keys: [] }; keys = state.aiBlocked.keys; }
        const pre = unitKey(step.unit);
        keys.push(pre + hk(step.q, step.r));
        if (keys.filter(k => k.startsWith(pre)).length >= 3) step.unit.mp = 0;
      }
      return res;
    }
    case 'train': return R.trainUnit(state, step.city, step.type, player);
    case 'buyPop': return R.buyPop(state, step.city, player);
    case 'improve': return R.improve(state, step.city, step.type, step.q, step.r, player);
    case 'settle': {
      const res = R.foundCity(state, step.unit, player);
      // Auf dem echten Stand merken (nicht auf der Nebel-Kopie), sonst geht
      // die Wartezeit bis zum nächsten Siedler verloren.
      if (res.ok) { if (!state.settlerAt) state.settlerAt = {}; state.settlerAt[player] = state.round; }
      return res;
    }
    case 'research': return R.research(state, step.tech, player);
    case 'reward': return R.chooseReward(state, step.city, step.choice, player);
    case 'war': return R.declareWar(state, player, step.target);
    case 'upgrade': return R.upgradeUnit(state, step.unit, player);
    case 'trade': return R.trade(state, step.unit, player);
    case 'hire': return R.hireMercenary(state, step.unit, player);
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
