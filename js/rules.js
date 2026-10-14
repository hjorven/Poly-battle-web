import {
  MAP_W, MAP_H, MAX_POP, START_STARS, BASE_CITY_POP,
  TERRAIN, UNITS, TECHS, UNIT_ORDER, COLORS, VISION, ACCELERATOR,
  DEF_BONUS, researchCost, TRIBES, TRIBE_POOL, tribeColor, hasAbility,
  RESOURCES, IMPROVEMENTS, CITY_REWARDS, REWARD_CHOICES, RUIN_REWARDS, RUIN_STARS,
  AI_LEVELS, SCORE, BRIDGE, DISBAND_REFUND, setMapSize, MAP_SIZES, MAP_TYPES,
  PERK_DISCOUNT, VETERAN_KILLS, VETERAN_HP, LIGHTHOUSE, TECH_BONUS, MONUMENTS, MONUMENT_POP, ROAD, BOUNTY, UPGRADES
} from './config.js';
import { hk, inBounds, neighbors, hexDistance, forEachHex, DIRS } from './hex.js';

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
export const maxHp = type => UNITS[type].hp;

// Lebens-Obergrenze einer konkreten Einheit: eingeschiffte Einheiten behalten
// die ihres Landtyps, Veteranen haben mehr.
export function hpCap(u) {
  return UNITS[u.carry || u.type].hp + (u.vet ? VETERAN_HP : 0);
}

// Die Kartengröße der Partie aktivieren (beim Erstellen, Laden, Beitreten).
export function useMap(state) {
  const size = MAP_SIZES[state.mapSize] || MAP_SIZES.normal;
  setMapSize(state.mapW || size.w, state.mapH || size.h);
}

// --- Stammes-Fähigkeiten ------------------------------------------------------

export function perkOf(state, player) {
  const t = tribeOf(state, player);
  return t && t.perk ? t.perk.id : null;
}

// Summe eines Stufe-4-Bonus über alle erforschten Technologien, z. B.
// techBonus(state, p, 'move', 'rider').
export function techBonus(state, player, kind, type = null) {
  let sum = 0;
  for (const t of (state.techs && state.techs[player]) || []) {
    const b = TECH_BONUS[t] && TECH_BONUS[t][kind];
    if (b == null) continue;
    sum += type == null ? b : (b[type] || 0);
  }
  return sum;
}

export function unitCost(state, player, type) {
  let cost = UNITS[type].cost;
  const perk = perkOf(state, player);
  if (perk && PERK_DISCOUNT[perk] === type) cost -= 1;
  cost -= techBonus(state, player, 'unitDiscount', type);
  return Math.max(1, cost);
}

export function defenseOf(state, unit) {
  return UNITS[unit.type].def + (unit.owner ? techBonus(state, unit.owner, 'def', unit.type) : 0);
}

export function improvementCost(state, player, type) {
  const def = IMPROVEMENTS[type];
  if (!def || def.monument) return def ? def.cost : 0;
  return Math.max(1, def.cost - (player ? techBonus(state, player, 'buildDiscount') : 0));
}

export function attackOf(state, unit) {
  return UNITS[unit.type].atk + (unit.owner ? techBonus(state, unit.owner, 'atk', unit.type) : 0);
}

// --- Diplomatie ---------------------------------------------------------------
// Frieden zwischen zwei Stämmen: kein Angriff, kein Betreten der Städte des
// anderen, keine Kontrollzone. Frieden braucht die Technologie Diplomatie.

const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

export function atPeace(state, a, b) {
  if (!a || !b || a === b || !state.peace) return false;
  for (const _ in state.peace) return state.peace[pairKey(a, b)] != null;
  return false;
}

// Feind = anderer Besitzer, mit dem kein Frieden herrscht (neutral zählt mit).
export function hostile(state, a, b) {
  return a !== b && !atPeace(state, a, b);
}

export function hasMet(state, a, b) {
  return !!(state.met && state.met[a] && state.met[a].includes(b));
}

function meet(state, a, b) {
  if (!a || !b || a === b) return;
  if (!state.met) state.met = {};
  for (const [x, y] of [[a, b], [b, a]]) {
    const list = state.met[x] || (state.met[x] = []);
    if (!list.includes(y)) list.push(y);
  }
}

export function pendingOffer(state, from, to) {
  return (state.peaceOffers || []).find(o => o.from === from && o.to === to) || null;
}

export function canOfferPeace(state, from, to) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  if (from === to || !players(state).includes(to)) return { ok: false, reason: 'Unbekannter Stamm' };
  if (!alive(state, to)) return { ok: false, reason: 'Stamm ist besiegt' };
  if (!hasTech(state, from, 'diplomacy')) return { ok: false, reason: 'Technologie fehlt: Diplomatie' };
  if (!hasMet(state, from, to)) return { ok: false, reason: 'Noch nicht begegnet' };
  if (atPeace(state, from, to)) return { ok: false, reason: 'Bereits Frieden' };
  const cool = state.warCooldown && state.warCooldown[pairKey(from, to)];
  if (cool && state.round < cool) return { ok: false, reason: `Erst ab Runde ${cool} wieder möglich` };
  if (pendingOffer(state, from, to)) return { ok: false, reason: 'Angebot läuft bereits' };
  return { ok: true };
}

// KI nimmt Frieden an, wenn der Anbieter nicht deutlich schwächer ist und sie
// nicht kurz vor dem Sieg über ihn steht.
export function aiAcceptsPeace(state, ai, from) {
  const mine = score(state, ai), theirs = score(state, from);
  return mine <= theirs * 1.25;
}

function makePeace(state, a, b) {
  if (!state.peace) state.peace = {};
  state.peace[pairKey(a, b)] = state.round;
  state.peaceOffers = (state.peaceOffers || []).filter(o => !((o.from === a && o.to === b) || (o.from === b && o.to === a)));
}

export function offerPeace(state, from, to) {
  const chk = canOfferPeace(state, from, to);
  if (!chk.ok) return chk;
  if (isBot(state, to)) {
    if (aiAcceptsPeace(state, to, from)) { makePeace(state, from, to); return { ok: true, accepted: true }; }
    if (!state.warCooldown) state.warCooldown = {};
    state.warCooldown[pairKey(from, to)] = state.round + 3;
    return { ok: true, accepted: false };
  }
  if (!state.peaceOffers) state.peaceOffers = [];
  state.peaceOffers.push({ from, to, round: state.round });
  return { ok: true, pending: true };
}

export function respondPeace(state, to, from, accept) {
  if (!pendingOffer(state, from, to)) return { ok: false, reason: 'Kein Angebot' };
  if (accept) makePeace(state, from, to);
  else {
    state.peaceOffers = state.peaceOffers.filter(o => !(o.from === from && o.to === to));
    if (!state.warCooldown) state.warCooldown = {};
    state.warCooldown[pairKey(from, to)] = state.round + 3;
  }
  return { ok: true };
}

export function declareWar(state, a, b) {
  if (!atPeace(state, a, b)) return { ok: false, reason: 'Kein Frieden' };
  delete state.peace[pairKey(a, b)];
  logEvent(state, { kind: 'war', victim: b });
  if (!state.warCooldown) state.warCooldown = {};
  state.warCooldown[pairKey(a, b)] = state.round + 3;
  return { ok: true };
}

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

export function playerColor(state, player) {
  const id = state.tribes && state.tribes[player];
  if (id) return tribeColor(id);
  return COLORS[player] ?? COLORS.neutral;
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

export function citiesFor(state, player) {
  return state.cities.filter(c => c.owner === player);
}

export function coastal(state, city) {
  return neighbors(city.q, city.r).some(([nq, nr]) => {
    const t = terrainAt(state, nq, nr);
    return t === 'water' || t === 'ocean';
  });
}

export function resourceAt(state, q, r) {
  return (state.resources && state.resources[hk(q, r)]) || null;
}

export function improvementAt(state, q, r) {
  return (state.improvements && state.improvements[hk(q, r)]) || null;
}

export function hasReward(city, id) {
  return !!city.rewards && Object.values(city.rewards).includes(id);
}

export function territoryRadius(city) {
  return hasReward(city, 'borders') ? 2 : 1;
}

export function territory(city) {
  const rad = territoryRadius(city);
  if (rad === 1) return neighbors(city.q, city.r);
  const out = [];
  forEachHex((q, r) => {
    const d = hexDistance(city.q, city.r, q, r);
    if (d >= 1 && d <= rad) out.push([q, r]);
  });
  return out;
}

function inTerritory(city, q, r) {
  const d = hexDistance(city.q, city.r, q, r);
  return d >= 1 && d <= territoryRadius(city);
}

// Stadt, zu der ein Feld gehört. Überlappen sich Gebiete (Grenzerweiterung),
// gewinnt die nähere Stadt, bei Gleichstand die ältere – so zählt jedes Feld
// nur für eine Stadt. Stadtfelder selbst gehören zu keinem Gebiet.
export function tileCity(state, q, r) {
  if (cityAt(state, q, r)) return null;
  let best = null, bd = Infinity;
  for (const c of state.cities) {
    if (!inTerritory(c, q, r)) continue;
    const d = hexDistance(c.q, c.r, q, r);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// Felder, die tatsächlich zu dieser Stadt gehören (Einkommen, Gebäude, Anzeige).
export function cityTiles(state, city) {
  return territory(city).filter(([q, r]) => tileCity(state, q, r) === city);
}

// Einkommen einer Stadt: Bevölkerung + gesammelte Ressourcen + Gebäude
// im umliegenden Stadtterritorium.
// Ertrag eines Gebäudes: fester Wert plus Nachbarschaftsbonus (Windmühle je
// Farm, Schmelzhütte je Mine, Markt je Gebäude) – nur eigene Nachbarfelder.
export function improvementIncome(state, owner, type, q, r) {
  const def = IMPROVEMENTS[type];
  if (!def) return 0;
  let s = def.pop;
  if (def.adjacent) {
    let n = 0;
    for (const [nq, nr] of neighbors(q, r)) {
      const imp = improvementAt(state, nq, nr);
      if (!imp || !ownLand(state, owner, nq, nr)) continue;
      const each = def.adjacent[imp] ?? (def.adjacent['*'] && imp !== type && !IMPROVEMENTS[imp].monument ? def.adjacent['*'] : 0);
      n += each;
    }
    s += def.max ? Math.min(def.max, n) : n;
  }
  if (type === 'farm' && owner) s += techBonus(state, owner, 'farmBonus');
  return s;
}

export function cityIncome(state, city) {
  let s = city.pop;
  for (const [nq, nr] of cityTiles(state, city)) {
    const res = resourceAt(state, nq, nr);
    if (res) s += 1 + (res === 'fish' && city.owner ? techBonus(state, city.owner, 'fishBonus') : 0);
    else {
      const imp = improvementAt(state, nq, nr);
      if (imp && IMPROVEMENTS[imp]) s += improvementIncome(state, city.owner, imp, nq, nr);
    }
  }
  if (hasReward(city, 'workshop')) s += 1;
  if (hasReward(city, 'park')) s += 1;
  const perk = city.owner ? perkOf(state, city.owner) : null;
  if (perk === 'harvest') {
    s += cityTiles(state, city).filter(([q, r]) => improvementAt(state, q, r) === 'farm').length;
  }
  if (perk === 'splendor' && city.isCapital) s += 2;
  if (perk === 'legion' && city.isCapital) s += 1;
  return s;
}

export function incomeFor(state, player) {
  let s = 0;
  let cities = 0;
  for (const c of state.cities) if (c.owner === player) { s += cityIncome(state, c); cities += 1; }
  const techs = state.techs[player] || [];
  if (techs.includes('construction')) s += cities;
  if (techs.includes('trade')) s += cities;
  if (techs.includes('banking')) s += cities;
  if (techs.includes('scholarship')) s += citiesFor(state, player).filter(c => c.pop >= 3).length;
  if (techs.includes('harbors')) s += citiesFor(state, player).reduce((a, c) => a + cityPorts(state, c).length, 0);
  if (perkOf(state, player) === 'traders') s += Math.floor(cities / 2);
  if (isBot(state, player)) {
    const lvl = AI_LEVELS[state.aiLevel] || AI_LEVELS.normal;
    s = Math.floor(s * lvl.incomeFactor) + (cities ? lvl.incomeBonus : 0);
  }
  return s;
}

export function isBot(state, player) {
  return !!state.ai && state.ai.includes(player);
}

export function maxMove(state, owner, type) {
  let base = UNITS[type].move + techBonus(state, owner, 'move', type);
  if (hasAbility(type, 'water') && perkOf(state, owner) === 'seafarer') base += 1;
  return base;
}

export function ownLand(state, owner, q, r) {
  const c = cityAt(state, q, r) || tileCity(state, q, r);
  return !!c && c.owner === owner;
}

function hasTech(state, owner, tech) {
  return !!tech && !!state.techs[owner] && state.techs[owner].includes(tech);
}

// q/r sind optional: Nur mit Koordinaten werden Brücken berücksichtigt.
export function isAir(type) {
  return hasAbility(type, 'air');
}

export function canEnter(state, unit, tile, q, r) {
  const t = TERRAIN[tile];
  if (!t) return false;
  // Luft-Einheiten fliegen überall hin, nur nicht in fremde Städte.
  if (isAir(unit.type)) {
    const c = q != null ? cityAt(state, q, r) : null;
    return !c || c.owner === unit.owner;
  }
  if (hasAbility(unit.type, 'water')) {
    if (tile === 'water' || tile === 'ocean') return true;
    // Eingeschiffte Landeinheiten dürfen wieder an Land gehen.
    return !!unit.carry && canEnter(state, { ...unit, type: unit.carry, carry: null }, tile, q, r);
  }
  if (q != null && bridgeAt(state, q, r)) return true;
  // Einschiffen: Landeinheiten betreten Wasser über einen eigenen Hafen.
  if (q != null && isWet(tile) && ownPort(state, unit.owner, q, r)) return true;
  if (!t.walkable) return false;
  if (tile === 'mountain' && hasAbility(unit.type, 'scout')) return true;
  if (t.enterTech) return hasTech(state, unit.owner, t.enterTech);
  return true;
}

// Bewegungskosten eines Feldes. Schiffe fahren auf Wasser mit 1 pro Feld
// (sonst käme ein Boot mit Bewegung 2 nur ein Feld weit), Brücken kosten
// für Landeinheiten wie ebenes Land 1.
export function moveCost(state, unit, q, r) {
  const tile = terrainAt(state, q, r);
  if (isAir(unit.type)) return 1;
  if (hasAbility(unit.type, 'water') && isWet(tile)) return 1;
  if (bridgeAt(state, q, r)) return 1;
  // Wege: im eigenen Gebiet kostet jedes Landfeld nur 1 Bewegung.
  if (hasTech(state, unit.owner, 'roads') && ownLand(state, unit.owner, q, r)) return 1;
  const perk = perkOf(state, unit.owner);
  if (tile === 'forest' && perk === 'woodland') return 1;
  if (tile === 'mountain' && perk === 'mountaineer') return 1;
  return TERRAIN[tile].move;
}

export function ownPort(state, owner, q, r) {
  if (improvementAt(state, q, r) !== 'port') return false;
  const c = tileCity(state, q, r);
  return !!c && c.owner === owner;
}

// Wechselt die Einheit mit diesem Schritt zwischen Land und Wasser?
// (Für Schiffe ist ein Brückenfeld Wasser, für Landeinheiten Land.)
export function switchesDomain(state, unit, q, r) {
  if (isAir(unit.type)) return false;
  const wet = isWet(terrainAt(state, q, r));
  if (hasAbility(unit.type, 'water')) return !wet;
  return wet && !bridgeAt(state, q, r);
}

export function bridgeAt(state, q, r) {
  return !!(state.bridges && state.bridges[hk(q, r)] != null);
}

export function roadAt(state, q, r) {
  return !!(state.roads && state.roads[hk(q, r)]);
}

// Teil des Straßennetzes: Straße, Stadt oder Brücke.
export function onRoadNet(state, q, r) {
  return roadAt(state, q, r) || !!cityAt(state, q, r) || bridgeAt(state, q, r);
}

// Straße auf (q, r) möglich? `byUnit`: Bau durch eine Einheit vor Ort statt
// über das Stadtmenü (dann auch außerhalb des eigenen Gebiets erlaubt).
export function canBuildRoad(state, player, q, r, byUnit = false) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  if (!hasTech(state, player, ROAD.tech)) return { ok: false, reason: `Technologie fehlt: ${TECHS[ROAD.tech].name}` };
  if (!inBounds(q, r)) return { ok: false, reason: 'Außerhalb der Karte' };
  const t = TERRAIN[terrainAt(state, q, r)];
  if (!t.walkable) return { ok: false, reason: 'Nur auf Land' };
  if (roadAt(state, q, r)) return { ok: false, reason: 'Hier ist schon eine Straße' };
  if (cityAt(state, q, r)) return { ok: false, reason: 'Städte sind schon angebunden' };
  const owner = tileCity(state, q, r);
  if (owner && owner.owner && owner.owner !== player) return { ok: false, reason: 'Fremdes Gebiet' };
  if (!byUnit && !(owner && owner.owner === player)) return { ok: false, reason: 'Nicht im eigenen Gebiet' };
  if (state.stars[player] < ROAD.cost) return { ok: false, reason: 'Zu wenig Sterne' };
  return { ok: true };
}

export function buildRoad(state, player, q, r, unit = null) {
  if (unit) {
    if (unit.owner !== player || unit.q !== q || unit.r !== r) return { ok: false, reason: 'Einheit steht nicht hier' };
    if (unit.carry || hasAbility(unit.type, 'water')) return { ok: false, reason: 'Nur Landeinheiten' };
    if (unit.mp <= 0 && unit.hasMoved) return { ok: false, reason: 'Keine Bewegung mehr' };
  }
  const chk = canBuildRoad(state, player, q, r, !!unit);
  if (!chk.ok) return chk;
  if (!state.roads) state.roads = {};
  state.roads[hk(q, r)] = true;
  state.stars[player] -= ROAD.cost;
  if (unit) { unit.mp = 0; unit.hasMoved = true; }
  return { ok: true };
}

export function defenceBonus(state, defender) {
  if (isAir(defender.type)) return DEF_BONUS.none;
  const tile = terrainAt(state, defender.q, defender.r);
  const t = TERRAIN[tile];
  let b = t.def;
  if (t.tech && !hasTech(state, defender.owner, t.tech)) b = DEF_BONUS.none;
  if (improvementAt(state, defender.q, defender.r) === 'fort') b = Math.max(b, DEF_BONUS.fort);
  const city = cityAt(state, defender.q, defender.r);
  if (city && city.owner === defender.owner && hasAbility(defender.type, 'fortify')) {
    b = Math.max(b, hasReward(city, 'wall') ? DEF_BONUS.wall : DEF_BONUS.standard);
  }
  return b;
}

// Echte Kampfformel (BattleHelpers / Community-Wiki).
// damage = Schaden am Verteidiger, retaliation = Schaden am Angreifer.
export function battleResults(state, attacker, defender) {
  const atk = attackOf(state, attacker);
  const dv = defenseOf(state, defender);
  const af = atk * (attacker.hp / hpCap(attacker));
  const df = dv * (defender.hp / hpCap(defender)) * defenceBonus(state, defender);
  const total = af + df;
  if (total <= 0) return { damage: 0, retaliation: 0 };
  let damage = Math.round((af / total) * atk * ACCELERATOR);
  let retaliation = Math.round((df / total) * dv * ACCELERATOR);
  // Pikeniere gegen Reiterei: anderthalbfacher Schaden in beide Richtungen.
  const mounted = u => u.type === 'rider' || u.type === 'knight' || u.type === 'paladin';
  if (hasAbility(attacker.type, 'pikes') && mounted(defender)) damage = Math.round(damage * 1.5);
  if (hasAbility(defender.type, 'pikes') && mounted(attacker)) retaliation = Math.round(retaliation * 1.5);
  const ranged = u => UNITS[u.type].range >= 2;
  // Fernkämpfer gegen Luft: Zerbrechliches fällt sofort, große Hüllen leiden doppelt.
  if (isAir(defender.type) && ranged(attacker)) {
    if (hasAbility(defender.type, 'fragile')) damage = defender.hp;
    else if (hasAbility(defender.type, 'flak')) damage *= 2;
  }
  if (isAir(attacker.type)) {
    // Nahkämpfer können nicht nach oben zurückschlagen.
    if (!ranged(defender)) retaliation = 0;
    else if (retaliation > 0 && hasAbility(attacker.type, 'fragile')) retaliation = attacker.hp;
    else if (hasAbility(attacker.type, 'flak')) retaliation *= 2;
  }
  return { damage, retaliation };
}

// Sichtweite einer Einheit: Berge geben mindestens 2, Späher dort +1,
// Segeln +1 für alle.
export function unitSight(state, u) {
  let radius = UNITS[u.type].sight ?? VISION.unit;
  if (terrainAt(state, u.q, u.r) === 'mountain') {
    radius = Math.max(radius, 2);
    if (hasAbility(u.type, 'scout')) radius += 1;
  }
  if (hasTech(state, u.owner, 'sailing')) radius += 1;
  if ((u.type === 'rider' || u.type === 'knight') && perkOf(state, u.owner) === 'lookouts') radius += 1;
  radius += techBonus(state, u.owner, 'sight', u.type) + techBonus(state, u.owner, 'sightAll');
  return radius;
}

export function visibleKeys(state, player) {
  const keys = new Set();
  const addArea = (q, r, rad) => {
    forEachHex((nq, nr) => {
      if (hexDistance(q, r, nq, nr) <= rad) keys.add(hk(nq, nr));
    });
  };
  for (const u of state.units) {
    if (u.owner !== player) continue;
    addArea(u.q, u.r, unitSight(state, u));
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
  rememberCities(state, player, visible);
  for (const u of state.units) if (u.owner !== player && visible.has(hk(u.q, u.r))) meet(state, player, u.owner);
  for (const c of state.cities) if (c.owner && c.owner !== player && visible.has(hk(c.q, c.r))) meet(state, player, c.owner);
  return changed;
}

// --- Gedächtnis im Nebel ------------------------------------------------------
// Jeder Spieler merkt sich Städte so, wie er sie zuletzt gesehen hat. Was
// danach außerhalb seiner Sicht passiert (Eroberung, Wachstum, Mauer), sieht
// er erst, wenn wieder eine Einheit oder Stadt hinschaut.

function citySnapshot(c) {
  return {
    owner: c.owner, pop: c.pop, wall: hasReward(c, 'wall'), isCapital: !!c.isCapital,
    park: hasReward(c, 'park'), workshop: hasReward(c, 'workshop')
  };
}

function rememberCities(state, player, keys) {
  if (!state.cityMemory) state.cityMemory = {};
  const mem = state.cityMemory[player] || (state.cityMemory[player] = {});
  for (const c of state.cities) {
    const k = hk(c.q, c.r);
    if (keys.has(k)) mem[k] = citySnapshot(c);
  }
}

// Wie `viewer` die Stadt gerade sieht: live (eigene oder sichtbare Stadt),
// als Erinnerung (entdeckt, aber außer Sicht) oder gar nicht (null).
export function cityView(state, viewer, city) {
  const live = { ...citySnapshot(city), q: city.q, r: city.r, live: true };
  if (!viewer || !state.explored || !state.explored[viewer]) return live;
  if (city.owner === viewer || isVisible(state, viewer, city.q, city.r)) return live;
  if (!isExplored(state, viewer, city.q, city.r)) return null;
  const mem = state.cityMemory && state.cityMemory[viewer] && state.cityMemory[viewer][hk(city.q, city.r)];
  // Alte Spielstände ohne Gedächtnis: neutral anzeigen statt live zu verraten.
  const snap = mem || { owner: null, pop: 1, wall: false, isCapital: false };
  return { ...snap, q: city.q, r: city.r, live: false };
}

// Set-Cache pro explored-Array: vermeidet Array.includes (O(n)) bei
// jedem Aufruf. Wird neu gebaut, sobald das Array wächst oder ersetzt wird.
const exploredCache = new WeakMap();
function exploredSetOf(arr) {
  let entry = exploredCache.get(arr);
  if (!entry || entry.len !== arr.length) {
    entry = { len: arr.length, set: new Set(arr) };
    exploredCache.set(arr, entry);
  }
  return entry.set;
}

export function isExplored(state, player, q, r) {
  if (!player || !state.explored || !state.explored[player]) return true;
  return exploredSetOf(state.explored[player]).has(hk(q, r));
}

// Aktuell sichtbar (nicht nur einmal entdeckt): innerhalb der Sichtweite
// einer eigenen Einheit oder Stadt.
export function isVisible(state, player, q, r) {
  if (!player || !state.explored || !state.explored[player]) return true;
  for (const u of state.units) {
    if (u.owner !== player) continue;
    if (hexDistance(u.q, u.r, q, r) <= unitSight(state, u)) return true;
  }
  for (const c of state.cities) {
    if (c.owner === player && hexDistance(c.q, c.r, q, r) <= VISION.city) return true;
  }
  return false;
}

// Spieler, der keine Städte mehr hat (z. B. Mensch im KI-Modus besiegt).
export function isEliminated(state, player) {
  return players(state).includes(player) && !alive(state, player);
}

export function canAct(state, player) {
  return !state.winner && state.turn === player;
}

// Steht eine feindliche Einheit so nah, dass sie diese Einheit angreifen könnte?
export function threatened(state, u) {
  return state.units.some(e =>
    hostile(state, e.owner, u.owner) && canEverAttack(e.type) &&
    hexDistance(e.q, e.r, u.q, u.r) <= UNITS[e.type].range
  );
}

// Eigene Städte, die eine sichtbare feindliche Kampfeinheit im nächsten Zug
// erreichen und angreifen könnte (Bewegung + Reichweite, ohne Gelände).
export function threatenedCities(state, player) {
  const foes = state.units.filter(e => hostile(state, player, e.owner) && canEverAttack(e.type) &&
    isVisible(state, player, e.q, e.r));
  if (!foes.length) return [];
  return citiesFor(state, player).filter(c => foes.some(e =>
    hexDistance(e.q, e.r, c.q, c.r) <= maxMove(state, e.owner, e.type) + UNITS[e.type].range));
}

// Heilt zu Rundenbeginn: Verschanzer, die nichts getan haben (wie bisher),
// und jede Einheit, die nicht angegriffen hat und außer Reichweite aller
// Gegner steht – auch wenn sie sich bewegt hat.
export function canRegenerate(state, u) {
  if (u.hp >= hpCap(u) || u.acted) return false;
  if (isAir(u.type) && !ownLand(state, u.owner, u.q, u.r)) return false;
  if (hasAbility(u.type, 'fortify') && !u.hasMoved) return true;
  return !threatened(state, u);
}

export function startTurn(state) {
  const p = state.turn;
  const spirit = (hasTech(state, p, 'spiritualism') ? 1 : 0) + techBonus(state, p, 'heal');

  for (const u of state.units) {
    if (u.owner !== p || !canRegenerate(state, u)) continue;
    const cap = hpCap(u);
    if (u.hp >= cap) continue;
    const city = cityAt(state, u.q, u.r);
    const home = city || tileCity(state, u.q, u.r);
    const cloister = home && home.owner === p && cityTiles(state, home).some(([q, r]) => improvementAt(state, q, r) === 'monastery') ? 2 : 0;
    const amt = (city && city.owner === p ? 4 : 2) + spirit + cloister;
    u.hp = Math.min(cap, u.hp + amt);
  }
  for (const u of state.units) {
    if (u.owner !== p || !hasAbility(u.type, 'heal') || u.acted || u.hasMoved) continue;
    for (const [nq, nr] of neighbors(u.q, u.r)) {
      const ally = unitAt(state, nq, nr);
      if (ally && ally.owner === p && ally !== u) {
        ally.hp = Math.min(hpCap(ally), ally.hp + 4 + spirit);
      }
    }
  }
  for (const u of state.units) {
    if (u.owner === p) {
      u.mp = maxMove(state, p, u.type);
      u.acted = false;
      u.hasMoved = false;
    }
  }
  for (const c of state.cities) {
    if (c.owner === p) { c.trained = false; c.trainedShip = false; }
  }
  state.stars[p] += incomeFor(state, p);
  checkMonuments(state, p);
  if (!state.peak) state.peak = {};
  const owned = citiesFor(state, p).length;
  state.peak[p] = Math.max(state.peak[p] || 0, owned);
  // Für den Erfolg „Comeback“: von 3+ Städten auf eine geschrumpft.
  if (owned === 1 && state.peak[p] >= 3) {
    if (!state.comeback) state.comeback = {};
    state.comeback[p] = true;
  }
  updateExplored(state, p);
}

export function endTurn(state) {
  if (state.winner) return;
  const list = players(state);
  const n = list.length;
  const i = list.indexOf(state.turn);
  const startRound = state.round;
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
  if (state.round !== startRound) {
    if (state.turnLimit && state.round > state.turnLimit) {
      finishByScore(state);
      return;
    }
    recordHistory(state);
  }
  startTurn(state);
}

export function canAttackNow(state, unit) {
  if (unit.acted) return false;
  if (unit.hasMoved && !hasAbility(unit.type, 'dash')) return false;
  return true;
}

// Belegte Felder einmal einsammeln statt für jedes Nachbarfeld alle
// Einheiten zu durchsuchen (reachableMap/inZoc sind die KI-Hotspots).
function occupancy(state) {
  const occ = new Map();
  for (const u of state.units) occ.set(hk(u.q, u.r), u);
  return occ;
}

export function reachableMap(state, unit) {
  const out = new Map();
  if (unit.mp <= 0) return out;
  if (unit.acted && !(hasAbility(unit.type, 'escape') || hasAbility(unit.type, 'persist'))) return out;
  // Intern in halben Schritten rechnen (Straße zu Straße = 1 halber Schritt).
  const budget = Math.round(unit.mp * 2);
  const land = !hasAbility(unit.type, 'water') && !isAir(unit.type);
  const flying = isAir(unit.type);
  const occ = occupancy(state);
  const zocCache = new Map();
  const zoc = (q, r) => {
    const k = hk(q, r);
    if (!zocCache.has(k)) zocCache.set(k, inZoc(state, unit, q, r, occ));
    return zocCache.get(k);
  };
  const dist = new Map([[hk(unit.q, unit.r), 0]]);
  // Kosten sind kleine ganze Zahlen: Eimer je Kostenstufe statt Sortieren.
  const buckets = [[[unit.q, unit.r]]];
  for (let cost = 0; cost < buckets.length; cost++) {
    for (const [q, r] of buckets[cost] || []) {
      if (cost > (dist.get(hk(q, r)) ?? Infinity)) continue;
      for (const [nq, nr] of neighbors(q, r)) {
        const k = hk(nq, nr);
        if (occ.has(k)) continue;
        const tile = terrainAt(state, nq, nr);
        if (!canEnter(state, unit, tile, nq, nr)) continue;
        const c = cityAt(state, nq, nr);
        if (c && atPeace(state, unit.owner, c.owner)) continue;
        const switching = switchesDomain(state, unit, nq, nr);
        // Ein- und Ausschiffen verbraucht die restliche Bewegung.
        const road = land && onRoadNet(state, q, r) && onRoadNet(state, nq, nr);
        const step = road ? 1 : moveCost(state, unit, nq, nr) * 2;
        const nc = switching ? Math.max(cost + 2, budget) : cost + step;
        if (nc > budget) continue;
        if (nc < (dist.get(k) ?? Infinity)) {
          dist.set(k, nc);
          // Kontrollzone: Neben einem Feind endet der Zug; auch nach dem
          // Wechsel zwischen Land und Wasser geht es nicht weiter.
          if (!switching && (flying || !zoc(nq, nr))) (buckets[nc] || (buckets[nc] = [])).push([nq, nr]);
        }
      }
    }
  }
  dist.delete(hk(unit.q, unit.r));
  for (const [k, v] of dist) out.set(k, v / 2);
  return out;
}

// Kontrollzone: Ein Feld neben einer feindlichen Einheit beendet die Bewegung.
export function inZoc(state, unit, q, r, occ = null) {
  return neighbors(q, r).some(([nq, nr]) => {
    const e = occ ? occ.get(hk(nq, nr)) : unitAt(state, nq, nr);
    return e && e !== unit && hostile(state, unit.owner, e.owner);
  });
}

// Einheiten ohne Angriffswert (Siedler) greifen nie an – außer sie können
// bekehren (Gedankenbeuger).
export function canEverAttack(type) {
  return UNITS[type].atk > 0 || hasAbility(type, 'convert');
}

export function attackTargets(state, unit) {
  if (!canEverAttack(unit.type)) return [];
  if (!canAttackNow(state, unit)) return [];
  const range = UNITS[unit.type].range;
  return state.units.filter(u =>
    hostile(state, unit.owner, u.owner) &&
    // Luft-Einheiten erreichen nur Fernkämpfer (Reichweite ab 2).
    !(isAir(u.type) && range < 2) &&
    hexDistance(unit.q, unit.r, u.q, u.r) <= range &&
    isVisible(state, unit.owner, u.q, u.r)
  );
}

function finishAction(attacker) {
  attacker.acted = true;
  if (!(hasAbility(attacker.type, 'escape') || hasAbility(attacker.type, 'persist'))) {
    attacker.mp = 0;
    attacker.hasMoved = true;
  }
}

// --- Schonfrist -------------------------------------------------------------
// In den ersten Runden greift die KI Menschen nicht an – bis ein Mensch diese
// KI selbst angreift oder ihr eine Stadt nimmt.

export function graceUntil(state) {
  return (AI_LEVELS[state.aiLevel] || AI_LEVELS.normal).grace || 0;
}

export function graceProtects(state, ai, target) {
  if (!target || !isBot(state, ai) || isBot(state, target)) return false;
  if (state.provoked && state.provoked[ai]) return false;
  return state.round <= graceUntil(state);
}

// Ein Mensch greift eine KI an: deren Schonfrist endet (Ereignis nur beim ersten Mal).
function provoke(state, human, ai) {
  if (!ai || !isBot(state, ai) || isBot(state, human)) return null;
  if (state.round > graceUntil(state) || (state.provoked && state.provoked[ai])) return null;
  if (!state.provoked) state.provoked = {};
  state.provoked[ai] = true;
  return { kind: 'provoke', player: ai };
}

// --- Ereignisprotokoll (für den Rückblick zu Beginn des eigenen Zuges) -------

export function logEvent(state, entry) {
  if (!state.log) state.log = [];
  state.logSeq = (state.logSeq || 0) + 1;
  state.log.push({ seq: state.logSeq, round: state.round, by: state.turn, ...entry });
  if (state.log.length > 80) state.log.shift();
}

// Was anderen seit dem letzten Abruf mit `player` passiert ist; markiert als gelesen.
export function takeNews(state, player) {
  if (!state.logSeen) state.logSeen = {};
  const seen = state.logSeen[player] || 0;
  state.logSeen[player] = state.logSeq || 0;
  return (state.log || []).filter(e => e.seq > seen && e.victim === player && e.by !== player);
}

export function attack(state, attacker, defender) {
  const events = [];
  // Regelprüfung auch hier, damit KI, Online-Gegner oder Konsole keine
  // ungültigen Angriffe ausführen können.
  if (!attackTargets(state, attacker).includes(defender)) return { events, killed: false, ok: false };
  const dist = hexDistance(attacker.q, attacker.r, defender.q, defender.r);

  if (hasAbility(attacker.type, 'convert')) {
    if (dist === 1) {
      const prevOwner = defender.owner;
      defender.owner = attacker.owner;
      defender.acted = true;
      defender.mp = 0;
      defender.hasMoved = true;
      events.push({ kind: 'convert', unit: defender.id, to: attacker.owner });
      logEvent(state, { kind: 'converted', victim: prevOwner, unit: defender.type, q: defender.q, r: defender.r });
      finishAction(attacker);
      updateExplored(state, attacker.owner);
    }
    return { events, killed: false };
  }

  meet(state, attacker.owner, defender.owner);
  const prov = provoke(state, attacker.owner, defender.owner);
  if (prov) events.push(prov);
  const res = battleResults(state, attacker, defender);
  defender.hp -= res.damage;
  events.push({ kind: 'damage', from: attacker.id, to: defender.id, dmg: res.damage });

  let killed = false;
  if (defender.hp <= 0) {
    state.units = state.units.filter(u => u !== defender);
    killed = true;
    events.push({ kind: 'kill', unit: defender });
    logEvent(state, { kind: 'unitLost', victim: defender.owner, unit: defender.type, q: defender.q, r: defender.r });
    if (!state.killsBy) state.killsBy = {};
    state.killsBy[attacker.owner] = (state.killsBy[attacker.owner] || 0) + 1;
    state.stars[attacker.owner] += BOUNTY;
    events.push({ kind: 'bounty', player: attacker.owner, stars: BOUNTY });
    const promo = addKill(attacker);
    if (promo) events.push(promo);
    if (UNITS[attacker.type].range === 1 && !isAir(attacker.type) && !switchesDomain(state, attacker, defender.q, defender.r)) {
      const tile = terrainAt(state, defender.q, defender.r);
      if (canEnter(state, attacker, tile, defender.q, defender.r) && !unitAt(state, defender.q, defender.r)) {
        attacker.q = defender.q;
        attacker.r = defender.r;
        const city = cityAt(state, attacker.q, attacker.r);
        if (city && city.owner !== attacker.owner) {
          const prev = city.owner;
          city.owner = attacker.owner;
          events.push({ kind: 'capture', city, from: prev, to: attacker.owner });
          logEvent(state, { kind: 'cityLost', victim: prev, q: city.q, r: city.r });
          checkWinner(state);
        }
        const ruin = claimRuin(state, attacker);
        if (ruin) events.push(ruin);
      }
    }
  } else {
    logEvent(state, { kind: 'hit', victim: defender.owner, unit: defender.type, dmg: res.damage, q: defender.q, r: defender.r });
  }
  if (!killed && !hasAbility(defender.type, 'stiff') && UNITS[defender.type].range >= dist && res.retaliation > 0) {
    attacker.hp -= res.retaliation;
    events.push({ kind: 'retaliate', from: defender.id, to: attacker.id, dmg: res.retaliation });
    if (attacker.hp <= 0) {
      state.units = state.units.filter(u => u !== attacker);
      events.push({ kind: 'kill', unit: attacker });
      const promo = addKill(defender);
      if (promo) events.push(promo);
    }
  }

  finishAction(attacker);
  updateExplored(state, attacker.owner);
  return { events, killed };
}

// Sieg zählen; beim dritten Sieg wird die Einheit zum Veteranen befördert.
function addKill(u) {
  u.kills = (u.kills || 0) + 1;
  if (u.vet || u.kills < VETERAN_KILLS || UNITS[u.carry || u.type].reward) return null;
  u.vet = true;
  u.hp = hpCap(u);
  return { kind: 'promote', unit: u.id, type: u.carry || u.type };
}

export function moveUnit(state, unit, q, r) {
  const reach = reachableMap(state, unit);
  const k = hk(q, r);
  if (!reach.has(k)) return { ok: false };
  const switching = switchesDomain(state, unit, q, r);
  unit.mp -= reach.get(k);
  unit.q = q;
  unit.r = r;
  unit.hasMoved = true;
  const events = [];
  if (switching) {
    if (unit.carry) {
      unit.type = unit.carry;
      delete unit.carry;
      events.push({ kind: 'disembark', unit: unit.id });
    } else {
      unit.carry = unit.type;
      unit.type = 'boat';
      events.push({ kind: 'embark', unit: unit.id });
    }
    unit.mp = 0;
  }
  const city = cityAt(state, q, r);
  if (city && city.owner !== unit.owner && !isAir(unit.type)) {
    const prev = city.owner;
    city.owner = unit.owner;
    events.push({ kind: 'capture', city, from: prev, to: unit.owner });
    const prov = provoke(state, unit.owner, prev);
    if (prov) events.push(prov);
    logEvent(state, { kind: 'cityLost', victim: prev, q: city.q, r: city.r });
    checkWinner(state);
  }
  const ruin = claimRuin(state, unit);
  if (ruin) events.push(ruin);
  const light = claimLighthouse(state, unit);
  if (light) events.push(light);
  updateExplored(state, unit.owner);
  return { ok: true, events };
}

export function checkWinner(state) {
  const list = players(state);
  const aliveList = list.filter(p => alive(state, p));
  if (aliveList.length === 1 && !state.winner) {
    state.winner = aliveList[0];
    state.endReason = 'conquest';
    recordHistory(state, true);
  }
  const dead = new Set(list.filter(p => !alive(state, p)));
  if (dead.size) state.units = state.units.filter(u => !dead.has(u.owner));
  // Wann und von wem ein Stamm besiegt wurde (für Leiste und Meldung).
  if (!state.eliminated) state.eliminated = {};
  for (const p of dead) {
    if (!state.eliminated[p]) state.eliminated[p] = { round: state.round, by: state.turn !== p ? state.turn : null };
  }
}

export function unlockedUnits(state, player) {
  return UNIT_ORDER.filter(t => !UNITS[t].reward && (!UNITS[t].tech || state.techs[player].includes(UNITS[t].tech)));
}

// Häfen im eigenen Stadtgebiet; Schiffe entstehen auf einem freien davon.
export function cityPorts(state, city) {
  return cityTiles(state, city).filter(([q, r]) => improvementAt(state, q, r) === 'port');
}

export function cityAirfields(state, city) {
  return cityTiles(state, city).filter(([q, r]) => improvementAt(state, q, r) === 'airfield');
}

export function spawnSpot(state, city, type) {
  if (isAir(type)) return cityAirfields(state, city).find(([q, r]) => !unitAt(state, q, r)) || null;
  if (!hasAbility(type, 'water')) return unitAt(state, city.q, city.r) ? null : [city.q, city.r];
  return cityPorts(state, city).find(([q, r]) => !unitAt(state, q, r)) || null;
}

export function canTrain(state, city, type, player) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  if (city.owner !== player) return { ok: false, reason: 'Fremde Stadt' };
  const u = UNITS[type];
  if (!u) return { ok: false, reason: 'Unbekannte Einheit' };
  // Zwei Bauplätze: eine Landeinheit und – mit Hafen – zusätzlich ein Schiff pro Runde.
  if (hasAbility(type, 'water') ? city.trainedShip : city.trained) {
    return { ok: false, reason: hasAbility(type, 'water') ? 'Schon ein Schiff gebaut' : 'Bereits ausgebildet' };
  }
  if (u.reward) return { ok: false, reason: 'Nur als Stadtbelohnung' };
  if (u.capital && !city.isCapital) return { ok: false, reason: 'Nur in der Hauptstadt' };
  if (u.tech && !state.techs[player].includes(u.tech)) return { ok: false, reason: 'Technologie fehlt' };
  // Schiffe laufen im Hafen vom Stapel, Landeinheiten in der Stadt.
  if (hasAbility(type, 'water')) {
    if (!cityPorts(state, city).length) return { ok: false, reason: 'Hafen nötig' };
    if (!spawnSpot(state, city, type)) return { ok: false, reason: 'Hafen besetzt' };
  } else if (isAir(type)) {
    if (!cityAirfields(state, city).length) return { ok: false, reason: 'Ballonplatz nötig' };
    if (!spawnSpot(state, city, type)) return { ok: false, reason: 'Ballonplatz besetzt' };
  } else if (unitAt(state, city.q, city.r)) return { ok: false, reason: 'Stadt besetzt' };
  if (state.stars[player] < unitCost(state, player, type)) return { ok: false, reason: 'Zu wenig Sterne' };
  return { ok: true };
}

let unitSeq = 0;
export function trainUnit(state, city, type, player) {
  const chk = canTrain(state, city, type, player);
  if (!chk.ok) return chk;
  const [sq, sr] = spawnSpot(state, city, type);
  state.stars[player] -= unitCost(state, player, type);
  if (hasAbility(type, 'water')) city.trainedShip = true;
  else city.trained = true;
  state.units.push({
    id: `${player.replace('_', '')}_${Date.now().toString(36)}_${unitSeq++}`,
    owner: player, type, q: sq, r: sr,
    hp: maxHp(type), mp: maxMove(state, player, type), hasMoved: false, acted: false
  });
  updateExplored(state, player);
  return { ok: true };
}

export function popCost(city, state = null) {
  const discount = state && city.owner ? techBonus(state, city.owner, 'popDiscount') : 0;
  return Math.max(1, city.pop + 2 - discount);
}

export function canBuyPop(state, city, player) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  if (city.owner !== player) return { ok: false, reason: 'Fremde Stadt' };
  if (city.pop >= MAX_POP) return { ok: false, reason: 'Maximale Bevölkerung' };
  // Nur eine feindliche Einheit (Belagerung) blockiert das Wachstum –
  // die eigene Garnison darf in der Stadt stehen bleiben.
  const occupant = unitAt(state, city.q, city.r);
  if (occupant && occupant.owner !== player) return { ok: false, reason: 'Stadt belagert' };
  if (state.stars[player] < popCost(city, state)) return { ok: false, reason: 'Zu wenig Sterne' };
  return { ok: true };
}

export function buyPop(state, city, player) {
  const chk = canBuyPop(state, city, player);
  if (!chk.ok) return chk;
  state.stars[player] -= popCost(city, state);
  growCity(state, city, 1);
  return { ok: true };
}

// --- Gebäude (Improvements) ------------------------------------------------

export function canImprove(state, city, type, q, r) {
  const def = IMPROVEMENTS[type];
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  if (!def) return { ok: false, reason: 'Unbekanntes Gebäude' };
  if (!inTerritory(city, q, r)) return { ok: false, reason: 'Nicht im Stadtgebiet' };
  if (cityAt(state, q, r)) return { ok: false, reason: 'Stadtfeld' };
  if (tileCity(state, q, r) !== city) return { ok: false, reason: 'Gehört zu einer anderen Stadt' };
  if (!def.terrain.includes(terrainAt(state, q, r))) return { ok: false, reason: 'Falsches Gelände' };
  if (improvementAt(state, q, r)) return { ok: false, reason: 'Bereits bebaut' };
  if (resourceAt(state, q, r)) return { ok: false, reason: 'Ressource wird genutzt' };
  if (bridgeAt(state, q, r)) return { ok: false, reason: 'Brücke im Weg' };
  if (unitAt(state, q, r)) return { ok: false, reason: 'Einheit im Weg' };
  if (def.monument && city.owner && !monumentReady(state, city.owner, type)) {
    return { ok: false, reason: `Erfolg fehlt: ${MONUMENTS[type].goal}` };
  }
  return { ok: true };
}

export function improve(state, city, type, q, r, player) {
  const chk = canImprove(state, city, type, q, r);
  if (!chk.ok) return chk;
  if (city.owner !== player) return { ok: false, reason: 'Fremde Stadt' };
  const def = IMPROVEMENTS[type];
  if (def.monument) {
    if (!state.improvements) state.improvements = {};
    state.improvements[hk(q, r)] = type;
    state.monumentsBuilt[player].push(type);
    growCity(state, city, MONUMENT_POP);
    return { ok: true };
  }
  if (def.tech && !state.techs[player].includes(def.tech)) return { ok: false, reason: 'Technologie fehlt' };
  const cost = improvementCost(state, player, type);
  if (state.stars[player] < cost) return { ok: false, reason: 'Zu wenig Sterne' };
  state.stars[player] -= cost;
  if (!state.improvements) state.improvements = {};
  state.improvements[hk(q, r)] = type;
  return { ok: true };
}

export function attackPreview(state, attacker) {
  return attackTargets(state, attacker).map(target => {
    const { damage, retaliation } = battleResults(state, attacker, target);
    return { target, damage, retaliation };
  });
}

// --- Brücken ----------------------------------------------------------------

// Achse einer Brücke (0–2): verbindet die Nachbarn in Richtung DIRS[a] und
// DIRS[a + 3].
function bridgeable(state, q, r) {
  return terrainAt(state, q, r) === 'water' && !bridgeAt(state, q, r) &&
    !unitAt(state, q, r) && !cityAt(state, q, r) && !improvementAt(state, q, r);
}

function landAt(state, q, r) {
  if (!inBounds(q, r)) return false;
  const t = TERRAIN[terrainAt(state, q, r)];
  return t.walkable || bridgeAt(state, q, r);
}

// Mögliche Brücken für eine Landeinheit: in jeder Richtung 1 oder 2 Felder
// Flachwasser, dahinter wieder Land.
export function bridgeOptions(state, unit) {
  if (!unit || hasAbility(unit.type, 'water') || UNITS[unit.type].reward) return [];
  const out = [];
  DIRS.forEach(([dq, dr], dir) => {
    const tiles = [];
    for (let i = 1; i <= BRIDGE.maxLen; i++) {
      const q = unit.q + dq * i, r = unit.r + dr * i;
      if (!inBounds(q, r) || !bridgeable(state, q, r)) break;
      tiles.push([q, r]);
      const eq = q + dq, er = r + dr;
      if (landAt(state, eq, er) && terrainAt(state, eq, er) !== 'water' && terrainAt(state, eq, er) !== 'ocean') {
        out.push({ dir, tiles: tiles.slice(), cost: tiles.length * BRIDGE.costPerTile });
        break;
      }
    }
  });
  return out;
}

export function canBuildBridge(state, unit, dir, player) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  if (!unit || unit.owner !== player) return { ok: false, reason: 'Nicht deine Einheit' };
  if (unit.acted) return { ok: false, reason: 'Einheit hat schon gehandelt' };
  if (!hasTech(state, player, BRIDGE.tech)) return { ok: false, reason: `Technologie fehlt: ${TECHS[BRIDGE.tech].name}` };
  const opt = bridgeOptions(state, unit).find(o => o.dir === dir);
  if (!opt) return { ok: false, reason: 'Hier ist keine Brücke möglich' };
  if (state.stars[player] < opt.cost) return { ok: false, reason: 'Zu wenig Sterne' };
  return { ok: true, option: opt };
}

export function buildBridge(state, unit, dir, player) {
  const chk = canBuildBridge(state, unit, dir, player);
  if (!chk.ok) return chk;
  if (!state.bridges) state.bridges = {};
  state.stars[player] -= chk.option.cost;
  for (const [q, r] of chk.option.tiles) state.bridges[hk(q, r)] = dir % 3;
  unit.acted = true;
  unit.mp = 0;
  unit.hasMoved = true;
  return { ok: true, tiles: chk.option.tiles };
}

// Brücken, die ein Schiff einreißen kann: auf dem eigenen oder einem
// Nachbarfeld, solange niemand anderes darauf steht.
export function destroyableBridges(state, unit) {
  if (!unit || !hasAbility(unit.type, 'water') || unit.acted) return [];
  return [[unit.q, unit.r], ...neighbors(unit.q, unit.r)].filter(([q, r]) => {
    if (!bridgeAt(state, q, r)) return false;
    const other = unitAt(state, q, r);
    return !other || other === unit;
  });
}

export function destroyBridge(state, unit, q, r, player) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  if (!unit || unit.owner !== player) return { ok: false, reason: 'Nicht deine Einheit' };
  if (!destroyableBridges(state, unit).some(([bq, br]) => bq === q && br === r)) {
    return { ok: false, reason: 'Keine Brücke in Reichweite' };
  }
  delete state.bridges[hk(q, r)];
  unit.acted = true;
  unit.mp = 0;
  unit.hasMoved = true;
  return { ok: true };
}

// --- Auflösen ---------------------------------------------------------------

export function disbandRefund(unit) {
  return Math.floor(UNITS[unit.carry || unit.type].cost * DISBAND_REFUND);
}

export function disbandUnit(state, unit, player) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  if (!unit || unit.owner !== player) return { ok: false, reason: 'Nicht deine Einheit' };
  if (state.turn !== player) return { ok: false, reason: 'Nicht dein Zug' };
  const refund = disbandRefund(unit);
  state.units = state.units.filter(u => u !== unit);
  state.stars[player] += refund;
  return { ok: true, refund };
}

// --- Bereite Einheiten (Tipps) ---------------------------------------------

// Was eine Einheit in diesem Zug noch sinnvoll tun kann (leer = nichts).
// --- Lastenballon ----------------------------------------------------------------
// Nimmt eine benachbarte eigene Landeinheit auf (sie verschwindet von der Karte)
// und setzt sie später auf ein freies Nachbarfeld ab. Fällt der Ballon, ist
// auch die Fracht verloren.

const isLandType = t => !hasAbility(t, 'water') && !isAir(t);

export function loadOptions(state, balloon) {
  if (!hasAbility(balloon.type, 'cargo') || balloon.cargo || balloon.acted) return [];
  return state.units.filter(u => u.owner === balloon.owner && u !== balloon && isLandType(u.type) &&
    !u.acted && hexDistance(u.q, u.r, balloon.q, balloon.r) === 1);
}

export function loadCargo(state, balloon, unit) {
  if (!loadOptions(state, balloon).includes(unit)) return { ok: false, reason: 'Kann diese Einheit nicht aufnehmen' };
  state.units = state.units.filter(u => u !== unit);
  balloon.cargo = { ...unit };
  return { ok: true };
}

export function unloadOptions(state, balloon) {
  if (!balloon.cargo || balloon.acted) return [];
  const cargo = { ...balloon.cargo, owner: balloon.owner };
  return neighbors(balloon.q, balloon.r).filter(([q, r]) => {
    if (unitAt(state, q, r)) return false;
    const c = cityAt(state, q, r);
    if (c && c.owner !== balloon.owner) return false;
    return canEnter(state, cargo, terrainAt(state, q, r), q, r) && !isWet(terrainAt(state, q, r));
  });
}

export function unloadCargo(state, balloon, q, r) {
  if (!unloadOptions(state, balloon).some(([a, b]) => a === q && b === r)) return { ok: false, reason: 'Hier kann nicht abgesetzt werden' };
  const u = { ...balloon.cargo, q, r, mp: 0, acted: true, hasMoved: true };
  delete balloon.cargo;
  state.units.push(u);
  balloon.acted = true;
  balloon.mp = 0;
  const events = [];
  const ruin = claimRuin(state, u);
  if (ruin) events.push(ruin);
  updateExplored(state, u.owner);
  return { ok: true, unit: u, events };
}

// --- Aufrüsten -------------------------------------------------------------------
// Im eigenen Gebiet, vor dem Handeln: gegen den Preisunterschied zur nächsten
// Stufe. Verletzungen bleiben anteilig, Veteranen bleiben Veteranen.

export function upgradeOption(state, unit) {
  const to = UPGRADES[unit.type];
  if (!to || unit.carry || unit.cargo) return null;
  const cost = Math.max(1, unitCost(state, unit.owner, to) - unitCost(state, unit.owner, unit.type));
  let reason = null;
  if (!hasTech(state, unit.owner, UNITS[to].tech)) reason = `Technologie fehlt: ${TECHS[UNITS[to].tech].name}`;
  else if (unit.acted || unit.hasMoved) reason = 'Nur zu Beginn des Zuges (vor dem Ziehen)';
  else if (!ownLand(state, unit.owner, unit.q, unit.r)) reason = 'Nur im eigenen Gebiet';
  else if (state.stars[unit.owner] < cost) reason = 'Zu wenig Sterne';
  return { to, cost, ok: !reason, reason };
}

export function upgradeUnit(state, unit, player) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  if (!unit || unit.owner !== player) return { ok: false, reason: 'Nicht deine Einheit' };
  const opt = upgradeOption(state, unit);
  if (!opt) return { ok: false, reason: 'Keine höhere Stufe' };
  if (!opt.ok) return { ok: false, reason: opt.reason };
  const frac = unit.hp / hpCap(unit);
  state.stars[player] -= opt.cost;
  unit.type = opt.to;
  unit.hp = Math.max(1, Math.round(frac * hpCap(unit)));
  unit.mp = 0;
  unit.acted = true;
  unit.hasMoved = true;
  return { ok: true, to: opt.to, cost: opt.cost };
}

export function unitOptions(state, unit) {
  if (unit.acted && unit.mp <= 0) return [];
  const out = [];
  if (attackTargets(state, unit).length) out.push(hasAbility(unit.type, 'convert') ? 'bekehren' : 'angreifen');
  if (unit.mp > 0 && reachableMap(state, unit).size) out.push('ziehen');
  if (!unit.acted && unit.type === 'settler' && canFound(state, unit, unit.owner).ok) out.push('Stadt gründen');
  if (loadOptions(state, unit).length) out.push('aufnehmen');
  if (unloadOptions(state, unit).length) out.push('absetzen');
  return out;
}

export function idleUnits(state, player) {
  return state.units.filter(u => u.owner === player && unitOptions(state, u).length);
}

// --- Siedeln (Stadtgründung) ------------------------------------------------

export function canFound(state, unit, player) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  if (!unit || unit.owner !== player) return { ok: false, reason: 'Nicht deine Einheit' };
  if (unit.type !== 'settler') return { ok: false, reason: 'Kein Siedler' };
  if (terrainAt(state, unit.q, unit.r) !== 'field') return { ok: false, reason: 'Nur auf Feldgründen' };
  if (resourceAt(state, unit.q, unit.r)) return { ok: false, reason: 'Ressourcenfeld' };
  if (improvementAt(state, unit.q, unit.r)) return { ok: false, reason: 'Bebautes Feld' };
  if (cityAt(state, unit.q, unit.r)) return { ok: false, reason: 'Stadt vorhanden' };
  const tooClose = state.cities.some(c => hexDistance(unit.q, unit.r, c.q, c.r) < 2);
  if (tooClose) return { ok: false, reason: 'Zu nah an einer Stadt' };
  return { ok: true };
}

export function foundCity(state, unit, player) {
  const chk = canFound(state, unit, player);
  if (!chk.ok) return chk;
  state.cities.push({ q: unit.q, r: unit.r, owner: player, pop: BASE_CITY_POP, trained: false, isCapital: false });
  state.units = state.units.filter(u => u !== unit);
  updateExplored(state, player);
  return { ok: true };
}

export function techCost(state, techId, player) {
  const t = TECHS[techId];
  const cities = citiesFor(state, player).length;
  const discount = state.techs[player].includes('philosophy');
  let cost = researchCost(t.tier, cities, discount, state.techs[player].filter(x => x !== 'basic').length);
  if (state.techs[player].includes('printing')) cost = Math.ceil(cost * 0.85);
  return perkOf(state, player) === 'wisdom' ? Math.max(1, cost - 1) : cost;
}

export function canResearch(state, techId, player) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  const t = TECHS[techId];
  if (!t) return { ok: false, reason: 'Unbekannte Technologie' };
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

// --- Weltgenerierung -------------------------------------------------------

function makeNoise(rand) {
  const grid = new Map();
  const val = (x, y) => {
    const k = x + ',' + y;
    if (!grid.has(k)) grid.set(k, rand());
    return grid.get(k);
  };
  const smooth = t => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  return (x, y, scale) => {
    const fx = x / scale, fy = y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    return lerp(
      lerp(val(x0, y0), val(x0 + 1, y0), tx),
      lerp(val(x0, y0 + 1), val(x0 + 1, y0 + 1), tx),
      ty
    );
  };
}

function generateTerrain(rand, mapType = 'continents') {
  const noise = makeNoise(rand);
  const moist = (q, r) => noise(q + 1000, r + 1000, 3.2);
  const t = new Array(MAP_W * MAP_H);
  for (let r = 0; r < MAP_H; r++) {
    for (let q = 0; q < MAP_W; q++) {
      let e = noise(q, r, 5) * 0.62 + noise(q, r, 2.6) * 0.38;
      if (mapType === 'pangaea') {
        // Ein großer Kontinent: zur Mitte hin höher, am Rand Meer.
        const dx = (q - (MAP_W - 1) / 2) / (MAP_W / 2), dy = (r - (MAP_H - 1) / 2) / (MAP_H / 2);
        e = e * 0.55 + (1 - Math.min(1, Math.hypot(dx, dy))) * 0.55;
      } else if (mapType === 'archipelago') {
        // Viele kleine Inseln: feineres Rauschen, mehr Wasser.
        e = noise(q, r, 2.2) * 0.7 + noise(q, r, 1.4) * 0.3 - 0.06;
      }
      const edge = Math.min(q, r, MAP_W - 1 - q, MAP_H - 1 - r);
      let tile;
      if (edge < 1) tile = 'ocean';
      else if (e < 0.33) tile = 'ocean';
      else if (e < 0.42) tile = 'water';
      else if (e > 0.80) tile = 'mountain';
      else if (moist(q, r) > 0.6) tile = 'forest';
      else tile = 'field';
      // Polarreihen direkt neben dem Ozeanrand vereisen.
      if ((r <= 1 || r >= MAP_H - 2) && tile !== 'ocean' && tile !== 'water') tile = 'ice';
      t[r * MAP_W + q] = tile;
    }
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
      const tile = terrainAt(state, nq, nr);
      const def = TERRAIN[tile];
      if (!bridgeAt(state, nq, nr) && (!def.walkable || def.enterTech)) continue;
      seen.add(k);
      queue.push([nq, nr]);
    }
  }
  return seen;
}

const isWet = t => t === 'water' || t === 'ocean';

// Achse (0–2), auf der beide gegenüberliegenden Nachbarn begehbares Land
// sind – dort ergibt eine Brücke Sinn. -1, wenn es keine gibt.
function crossingAxis(state, q, r) {
  for (let a = 0; a < 3; a++) {
    const [d1q, d1r] = DIRS[a], [d2q, d2r] = DIRS[a + 3];
    const ok = [[q + d1q, r + d1r], [q + d2q, r + d2r]].every(([nq, nr]) => {
      if (!inBounds(nq, nr)) return false;
      const t = TERRAIN[terrainAt(state, nq, nr)];
      return t.walkable && !t.enterTech;
    });
    if (ok) return a;
  }
  return -1;
}

// Alle Gewässer zu einem zusammenhängenden Netz verbinden: Jeder See bekommt
// einen Kanal (kürzester Weg über Land) zum Meer. Startgebiete bleiben frei.
// Gibt die Kanalfelder zurück.
function connectWater(state, starts) {
  const n = MAP_W * MAP_H;
  const comp = new Int32Array(n).fill(-1);
  const comps = [];
  forEachHex((q, r) => {
    if (!isWet(terrainAt(state, q, r)) || comp[idx(q, r)] >= 0) return;
    const id = comps.length, cells = [[q, r]];
    comp[idx(q, r)] = id;
    for (let i = 0; i < cells.length; i++) {
      for (const [nq, nr] of neighbors(cells[i][0], cells[i][1])) {
        if (comp[idx(nq, nr)] < 0 && isWet(terrainAt(state, nq, nr))) {
          comp[idx(nq, nr)] = id;
          cells.push([nq, nr]);
        }
      }
    }
    comps.push(cells);
  });
  if (comps.length < 2) return [];
  // Das größte Gewässer (der Ozeanring) ist das Hauptnetz.
  let main = 0;
  comps.forEach((c, i) => { if (c.length > comps[main].length) main = i; });
  const inMain = new Uint8Array(n);
  for (const [q, r] of comps[main]) inMain[idx(q, r)] = 1;
  const nearStart = (q, r) => starts.some(([sq, sr]) => hexDistance(q, r, sq, sr) <= 2);
  const channel = [];
  for (let id = 0; id < comps.length; id++) {
    if (id === main) continue;
    // Mehrquellen-Breitensuche vom See aus bis zum Hauptnetz.
    const prev = new Map();
    const queue = [];
    for (const [q, r] of comps[id]) { prev.set(idx(q, r), -1); queue.push([q, r]); }
    let hit = null;
    for (let i = 0; i < queue.length && !hit; i++) {
      const [q, r] = queue[i];
      for (const [nq, nr] of neighbors(q, r)) {
        const k = idx(nq, nr);
        if (prev.has(k)) continue;
        if (inMain[k]) { prev.set(k, idx(q, r)); hit = k; break; }
        if (nearStart(nq, nr) || cityAt(state, nq, nr)) continue;
        prev.set(k, idx(q, r));
        queue.push([nq, nr]);
      }
    }
    if (hit == null) continue;
    // Zurückverfolgen bis zum See (Seefelder haben Vorgänger -1).
    for (let k = prev.get(hit); k !== -1; k = prev.get(k)) {
      if (!isWet(state.terrain[k])) {
        state.terrain[k] = 'water';
        channel.push([k % MAP_W, Math.floor(k / MAP_W)]);
      }
    }
    for (const [q, r] of comps[id]) inMain[idx(q, r)] = 1;
    for (const [q, r] of channel) inMain[idx(q, r)] = 1;
  }
  return channel;
}

// Brücken über Kanäle, wo sie für den Landweg nötig sind, plus ein paar
// natürliche Brücken an 1 Feld breiten Engstellen.
function placeBridges(state, rand, channel, sq, sr) {
  state.bridges = {};
  const candidates = channel
    .map(([q, r]) => ({ q, r, a: crossingAxis(state, q, r) }))
    .filter(c => c.a >= 0);
  for (const c of candidates) state.bridges[hk(c.q, c.r)] = c.a;
  // Erreichbares Land (ohne Brückenfelder selbst) darf nicht schrumpfen.
  const landReach = () => {
    let n = 0;
    for (const k of floodReachable(state, sq, sr)) if (!state.bridges[k] && state.bridges[k] !== 0) n++;
    return n;
  };
  const want = landReach();
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (const c of candidates) {
    const k = hk(c.q, c.r);
    delete state.bridges[k];
    if (landReach() < want) state.bridges[k] = c.a;
  }
  forEachHex((q, r) => {
    if (terrainAt(state, q, r) !== 'water' || bridgeAt(state, q, r)) return;
    const a = crossingAxis(state, q, r);
    if (a < 0 || rand() > 0.3) return;
    if (neighbors(q, r).some(([nq, nr]) => bridgeAt(state, nq, nr))) return;
    state.bridges[hk(q, r)] = a;
  });
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
      if (inBounds(nq, nr)) state.terrain[idx(nq, nr)] = 'field';
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

function generateResources(state, rand, centers) {
  const place = (q, r, type) => { state.resources[hk(q, r)] = type; };
  const typesFor = tile => Object.keys(RESOURCES).filter(k => RESOURCES[k].terrain.includes(tile));
  forEachHex((q, r) => {
    const tile = state.terrain[idx(q, r)];
    const opts = typesFor(tile);
    if (!opts.length) return;
    const chance = tile === 'water' ? 0.16 : tile === 'ocean' ? 0.05 : 0.09;
    if (rand() < chance) place(q, r, opts[Math.floor(rand() * opts.length)]);
  });
  for (const [sq, sr] of centers) {
    const tiles = neighbors(sq, sr).filter(([q, r]) =>
      !state.cities.some(c => c.q === q && c.r === r) && typesFor(state.terrain[idx(q, r)]).length
    );
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    let made = 0;
    for (const [q, r] of tiles) {
      if (made >= 2) break;
      place(q, r, typesFor(state.terrain[idx(q, r)])[0]);
      made++;
    }
  }
}

let startSeq = 0;
export function createGame(seed = Date.now(), playerCount = 4, opts = null) {
  const o = opts && typeof opts === 'object' ? opts : { tribe: opts };
  const tribe = o.tribe;
  const starStart = o.stars != null ? o.stars : START_STARS;
  const rand = mulberry32(seed);
  const count = Math.min(Math.max(playerCount, 2), 5);
  const tribes = assignTribes(seed, count, tribe);
  const mapSize = MAP_SIZES[o.mapSize] ? o.mapSize : 'normal';
  const mapType = MAP_TYPES[o.mapType] ? o.mapType : 'continents';
  setMapSize(MAP_SIZES[mapSize].w, MAP_SIZES[mapSize].h);
  const state = {
    mapSize, mapType, mapW: MAP_W, mapH: MAP_H,
    terrain: generateTerrain(rand, mapType),
    cities: [], units: [], resources: {}, improvements: {}, bridges: {}, cityMemory: {},
    peace: {}, peaceOffers: [], warCooldown: {}, met: {},
    players: Array.from({ length: count }, (_, k) => 'player_' + (k + 1)),
    tribes,
    stars: {}, techs: {}, explored: {},
    turn: 'player_1', round: 1, winner: null,
    turnLimit: o.turnLimit || null,
    aiLevel: AI_LEVELS[o.aiLevel] ? o.aiLevel : 'normal',
    ai: Array.isArray(o.ai) ? o.ai.slice() : [],
    ruins: {}, ruinsBy: {}, history: [],
    rngSeed: (seed ^ 0x5bd1e995) >>> 0
  };
  for (const p of state.players) {
    const tr = TRIBES[tribes[p]];
    const lvl = state.ai.includes(p) ? AI_LEVELS[state.aiLevel] : null;
    state.stars[p] = starStart + (tr ? tr.bonusStars : 0) + (lvl ? lvl.startBonus : 0);
    state.techs[p] = tr ? ['basic', ...tr.startTechs] : ['basic'];
    state.explored[p] = [];
  }

  // Starts mit Abstand zum Rand, damit rund um die Hauptstadt Platz ist.
  const corner = [[3, 3], [MAP_W - 4, 3], [MAP_W - 4, MAP_H - 4], [3, MAP_H - 4]];
  const starts = count === 2 ? [corner[3], corner[1]]
    : count === 3 ? [corner[0], corner[1], corner[3]]
    : count === 4 ? corner
    : [corner[0], corner[1], corner[2], corner[3], [Math.floor(MAP_W / 2), Math.floor(MAP_H / 2)]];
  const clearAround = (q, r, rad) => {
    forEachHex((nq, nr) => {
      if (hexDistance(q, r, nq, nr) <= rad) state.terrain[idx(nq, nr)] = 'field';
    });
  };
  for (const [q, r] of starts) clearAround(q, r, 2);
  for (let i = 0; i < starts.length; i++) {
    const a = starts[i], b = starts[(i + 1) % starts.length];
    carveLine(state, a[0], a[1], b[0], b[1]);
  }
  carveLine(state, starts[0][0], starts[0][1], starts[2 % starts.length][0], starts[2 % starts.length][1]);

  const channel = connectWater(state, starts);
  placeBridges(state, rand, channel, starts[0][0], starts[0][1]);

  const reachable = floodReachable(state, starts[0][0], starts[0][1]);

  const candidates = [];
  forEachHex((q, r) => {
    const k = hk(q, r);
    if (!reachable.has(k)) return;
    const def = TERRAIN[state.terrain[idx(q, r)]];
    if (!def.walkable || def.enterTech || bridgeAt(state, q, r)) return;
    candidates.push([q, r]);
  });
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const placeCity = (q, r, owner, pop, isCapital = false) => {
    state.terrain[idx(q, r)] = 'field';
    state.cities.push({ q, r, owner, pop, trained: false, isCapital });
  };

  const centerCities = [];
  for (let k = 0; k < count; k++) {
    const [sq, sr] = starts[k];
    const owner = 'player_' + (k + 1);
    // Die Hauptstadt steht genau im freigeräumten Startgebiet.
    const c = [sq, sr];
    placeCity(c[0], c[1], owner, BASE_CITY_POP, true);
    centerCities.push(c);
  }

  let placed = count;
  // Neutrale Städte mit der Kartenfläche skalieren (Normal: 26×18).
  const maxCities = Math.max(count + 2, Math.round((4 + count * 2) * (MAP_W * MAP_H) / 468));
  for (const [q, r] of candidates) {
    if (placed >= maxCities) break;
    if (state.cities.some(c => c.q === q && c.r === r)) continue;
    if (state.cities.some(c => hexDistance(q, r, c.q, c.r) < 4)) continue;
    if (starts.some(([sq, sr]) => hexDistance(q, r, sq, sr) < 3)) continue;
    placeCity(q, r, null, 1);
    placed++;
  }

  const spawnUnit = (owner, type, q, r) => {
    state.units.push({
      id: `${owner.replace('_', '')}_start_${startSeq++}`,
      owner, type, q, r, hp: maxHp(type), mp: maxMove(state, owner, type),
      hasMoved: false, acted: false
    });
  };
  for (let k = 0; k < count; k++) {
    const owner = 'player_' + (k + 1);
    const city = state.cities.find(c => c.owner === owner);
    const tr = TRIBES[tribes[owner]];
    const units = tr ? tr.startUnits : ['warrior'];
    let first = true;
    for (const type of units) {
      let q = city.q, r = city.r;
      if (!first || unitAt(state, q, r)) {
        const opts = neighbors(city.q, city.r).filter(([nq, nr]) =>
          canEnter(state, { owner, type }, terrainAt(state, nq, nr), nq, nr) && !unitAt(state, nq, nr) && !cityAt(state, nq, nr)
        );
        if (!opts.length) continue;
        [q, r] = opts[0];
      }
      spawnUnit(owner, type, q, r);
      first = false;
    }
  }

  generateResources(state, rand, centerCities);
  generateRuins(state, rand);
  placeLighthouses(state);
  startTurn(state);
  recordHistory(state);
  return state;
}

export function stateSummary(state, player) {
  return {
    cities: citiesFor(state, player).length,
    units: state.units.filter(u => u.owner === player).length,
    stars: state.stars[player],
    techs: state.techs[player].length
  };
}

// --- Stadtstufen & Belohnungen ----------------------------------------------

// Bevölkerung erhöhen; jede neu erreichte Stufe (2–5) wartet auf eine
// Belohnungswahl des Besitzers.
export function growCity(state, city, amount = 1) {
  for (let i = 0; i < amount && city.pop < MAX_POP; i++) {
    city.pop += 1;
    if (REWARD_CHOICES[city.pop]) {
      if (!city.rewards) city.rewards = {};
      if (!city.pending) city.pending = [];
      if (!city.rewards[city.pop] && !city.pending.includes(city.pop)) city.pending.push(city.pop);
    }
  }
}

export function pendingLevel(city) {
  return city.pending && city.pending.length ? city.pending[0] : null;
}

export function rewardOptions(city) {
  const lvl = pendingLevel(city);
  return lvl ? REWARD_CHOICES[lvl] : [];
}

export function canChooseReward(state, city, id, player) {
  if (state.winner) return { ok: false, reason: 'Spiel vorbei' };
  if (!city || city.owner !== player) return { ok: false, reason: 'Fremde Stadt' };
  const lvl = pendingLevel(city);
  if (!lvl) return { ok: false, reason: 'Keine Belohnung offen' };
  if (!REWARD_CHOICES[lvl].includes(id)) return { ok: false, reason: 'Nicht wählbar' };
  return { ok: true };
}

function freeLandNear(state, q, r, type, owner) {
  const spots = [[q, r], ...neighbors(q, r)];
  for (const [nq, nr] of spots) {
    if (unitAt(state, nq, nr)) continue;
    if (!canEnter(state, { type, owner }, terrainAt(state, nq, nr), nq, nr)) continue;
    if (cityAt(state, nq, nr) && cityAt(state, nq, nr).owner !== owner) continue;
    return [nq, nr];
  }
  return null;
}

let rewardSeq = 0;
function spawnUnitAt(state, owner, type, q, r) {
  const u = {
    id: `${owner.replace('_', '')}_r${Date.now().toString(36)}_${rewardSeq++}`,
    owner, type, q, r, hp: maxHp(type), mp: 0, hasMoved: true, acted: true
  };
  state.units.push(u);
  return u;
}

function revealAround(state, player, q, r, rad) {
  if (!state.explored || !state.explored[player]) return;
  const known = new Set(state.explored[player]);
  const area = new Set();
  forEachHex((nq, nr) => {
    const k = hk(nq, nr);
    if (hexDistance(q, r, nq, nr) > rad) return;
    area.add(k);
    if (!known.has(k)) { known.add(k); state.explored[player].push(k); }
  });
  rememberCities(state, player, area);
}

export function chooseReward(state, city, id, player) {
  const chk = canChooseReward(state, city, id, player);
  if (!chk.ok) return chk;
  const lvl = city.pending.shift();
  city.rewards[lvl] = id;
  const events = [{ kind: 'reward', city, reward: id, level: lvl }];
  if (id === 'resources') state.stars[player] += 5;
  else if (id === 'explorer') revealAround(state, player, city.q, city.r, 4);
  else if (id === 'growth') growCity(state, city, 1);
  else if (id === 'giant') {
    const spot = freeLandNear(state, city.q, city.r, 'giant', player);
    if (spot) spawnUnitAt(state, player, 'giant', spot[0], spot[1]);
    else { state.stars[player] += UNITS.giant.cost; events.push({ kind: 'note', text: 'Kein Platz – stattdessen 10 Sterne' }); }
    updateExplored(state, player);
  }
  return { ok: true, events };
}

// --- Zufall (reproduzierbar, im Spielstand gespeichert) ---------------------

function nextRandom(state) {
  state.rngSeed = ((state.rngSeed ?? 1) + 0x6D2B79F5) >>> 0;
  return mulberry32(state.rngSeed)();
}

// --- Ruinen -----------------------------------------------------------------

export function ruinAt(state, q, r) {
  return !!(state.ruins && state.ruins[hk(q, r)]);
}

function pickRuinReward(state) {
  const total = Object.values(RUIN_REWARDS).reduce((a, b) => a + b.weight, 0);
  let x = nextRandom(state) * total;
  for (const [id, def] of Object.entries(RUIN_REWARDS)) {
    x -= def.weight;
    if (x < 0) return id;
  }
  return 'stars';
}

export function claimRuin(state, unit, forced = null) {
  const k = hk(unit.q, unit.r);
  if (!state.ruins || !state.ruins[k]) return null;
  delete state.ruins[k];
  const p = unit.owner;
  if (!state.ruinsBy) state.ruinsBy = {};
  state.ruinsBy[p] = (state.ruinsBy[p] || 0) + 1;
  let reward = forced || pickRuinReward(state);
  let text = '';
  if (reward === 'tech') {
    const open = Object.keys(TECHS)
      .filter(t => !state.techs[p].includes(t) && (!TECHS[t].req || state.techs[p].includes(TECHS[t].req)))
      .sort((a, b) => TECHS[a].tier - TECHS[b].tier);
    if (open.length) {
      const t = open[Math.floor(nextRandom(state) * Math.min(open.length, 4))];
      state.techs[p].push(t);
      text = `Technologie: ${TECHS[t].name}`;
    } else reward = 'stars';
  }
  if (reward === 'unit') {
    const spot = freeLandNear(state, unit.q, unit.r, 'swordsman', p);
    if (spot) { spawnUnitAt(state, p, 'swordsman', spot[0], spot[1]); text = 'Ein Schwertkämpfer schließt sich an'; }
    else reward = 'stars';
  }
  if (reward === 'pop') {
    const own = citiesFor(state, p).filter(c => c.pop < MAX_POP)
      .sort((a, b) => hexDistance(unit.q, unit.r, a.q, a.r) - hexDistance(unit.q, unit.r, b.q, b.r));
    if (own.length) { growCity(state, own[0], 1); text = '+1 Bevölkerung in der nächsten Stadt'; }
    else reward = 'stars';
  }
  if (reward === 'reveal') {
    revealAround(state, p, unit.q, unit.r, 5);
    text = 'Die Umgebung wird aufgedeckt';
  }
  if (reward === 'stars') {
    state.stars[p] += RUIN_STARS;
    text = `+${RUIN_STARS} Sterne`;
  }
  return { kind: 'ruin', reward, text, player: p, q: unit.q, r: unit.r };
}

function generateRuins(state, rand) {
  state.ruins = {};
  const want = Math.round((MAP_W * MAP_H) / 60);
  const spots = [];
  forEachHex((q, r) => {
    const tile = state.terrain[idx(q, r)];
    if (tile !== 'field' && tile !== 'forest') return;
    if (state.resources[hk(q, r)]) return;
    if (state.cities.some(c => hexDistance(q, r, c.q, c.r) < 3)) return;
    spots.push([q, r]);
  });
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  for (const [q, r] of spots) {
    if (Object.keys(state.ruins).length >= want) break;
    if (Object.keys(state.ruins).some(k => { const [a, b] = k.split(',').map(Number); return hexDistance(q, r, a, b) < 3; })) continue;
    state.ruins[hk(q, r)] = true;
  }
}

// --- Monumente ------------------------------------------------------------------

function monumentAchieved(state, player, type) {
  const mine = citiesFor(state, player);
  switch (type) {
    case 'm_wisdom': return (state.techs[player] || []).filter(t => t !== 'basic').length >= 20;
    case 'm_valor': return ((state.killsBy && state.killsBy[player]) || 0) >= 10;
    case 'm_eye': return lighthouseKeys(state).length > 0 && lighthouseCount(state, player) === lighthouseKeys(state).length;
    case 'm_treasury': return (state.stars[player] || 0) >= 100;
    case 'm_park': return mine.filter(c => c.pop >= MAX_POP).length >= 3;
    case 'm_palace': return mine.length >= 8;
    default: return false;
  }
}

// Neu erreichte Erfolge dauerhaft freischalten; gibt die neuen Monumente zurück.
export function checkMonuments(state, player) {
  if (!state.monumentsUnlocked) state.monumentsUnlocked = {};
  if (!state.monumentsBuilt) state.monumentsBuilt = {};
  const have = state.monumentsUnlocked[player] || (state.monumentsUnlocked[player] = []);
  if (!state.monumentsBuilt[player]) state.monumentsBuilt[player] = [];
  const fresh = Object.keys(MONUMENTS).filter(t => !have.includes(t) && monumentAchieved(state, player, t));
  have.push(...fresh);
  return fresh;
}

// Freigeschaltet und noch nicht errichtet.
export function monumentReady(state, player, type) {
  return !!(state.monumentsUnlocked && (state.monumentsUnlocked[player] || []).includes(type) &&
    !((state.monumentsBuilt && state.monumentsBuilt[player]) || []).includes(type));
}

export function readyMonuments(state, player) {
  return Object.keys(MONUMENTS).filter(t => monumentReady(state, player, t));
}

// --- Leuchttürme ---------------------------------------------------------------

function placeLighthouses(state) {
  state.lighthouses = {};
  for (const [q, r] of [[0, 0], [MAP_W - 1, 0], [MAP_W - 1, MAP_H - 1], [0, MAP_H - 1]]) {
    state.terrain[idx(q, r)] = 'ocean';
    state.lighthouses[hk(q, r)] = [];
  }
}

export function lighthouseKeys(state) {
  return Object.keys(state.lighthouses || {});
}

export function lighthouseFound(state, player, key) {
  return !!(state.lighthouses && state.lighthouses[key] && state.lighthouses[key].includes(player));
}

export function lighthouseCount(state, player) {
  return lighthouseKeys(state).filter(k => lighthouseFound(state, player, k)).length;
}

// Erreicht: Einheit steht auf dem Turm oder daneben. Jeder Stamm einmal je Turm.
export function claimLighthouse(state, unit) {
  const p = unit.owner;
  for (const key of lighthouseKeys(state)) {
    if (lighthouseFound(state, p, key)) continue;
    const [q, r] = key.split(',').map(Number);
    if (hexDistance(q, r, unit.q, unit.r) > 1) continue;
    state.lighthouses[key].push(p);
    state.stars[p] += LIGHTHOUSE.stars;
    revealAround(state, p, q, r, LIGHTHOUSE.reveal);
    let text = `Leuchtturm erreicht: +${LIGHTHOUSE.stars} Sterne`;
    const found = lighthouseCount(state, p);
    if (found === lighthouseKeys(state).length) {
      state.stars[p] += LIGHTHOUSE.allBonus;
      text = `Alle Leuchttürme gefunden: +${LIGHTHOUSE.stars + LIGHTHOUSE.allBonus} Sterne`;
    } else text += ` (${found}/${lighthouseKeys(state).length})`;
    return { kind: 'lighthouse', text, player: p, q, r };
  }
  return null;
}

// --- Punkte, Verlauf, Spielende ---------------------------------------------

export function score(state, player) {
  let s = 0;
  const mine = citiesFor(state, player);
  const imps = new Set();
  for (const c of mine) {
    s += SCORE.city + SCORE.pop * c.pop + SCORE.reward * Object.keys(c.rewards || {}).length;
    for (const [q, r] of cityTiles(state, c)) if (improvementAt(state, q, r)) imps.add(hk(q, r));
  }
  s += SCORE.improvement * imps.size;
  s += SCORE.tech * Math.max(0, (state.techs[player] || []).filter(t => t !== 'basic').length);
  for (const u of state.units) if (u.owner === player) s += SCORE.unitCost * UNITS[u.carry || u.type].cost;
  s += SCORE.explored * ((state.explored && state.explored[player]) ? state.explored[player].length : 0);
  s += SCORE.ruin * ((state.ruinsBy && state.ruinsBy[player]) || 0);
  s += SCORE.lighthouse * lighthouseCount(state, player);
  s += SCORE.monument * ((state.monumentsBuilt && state.monumentsBuilt[player]) || []).length;
  return s;
}

export function scoreBreakdown(state, player) {
  return {
    score: score(state, player),
    cities: citiesFor(state, player).length,
    pop: citiesFor(state, player).reduce((a, c) => a + c.pop, 0),
    units: state.units.filter(u => u.owner === player).length,
    techs: (state.techs[player] || []).filter(t => t !== 'basic').length,
    explored: (state.explored && state.explored[player]) ? state.explored[player].length : 0,
    ruins: (state.ruinsBy && state.ruinsBy[player]) || 0,
    lighthouses: lighthouseCount(state, player)
  };
}

export function recordHistory(state, final = false) {
  if (!state.history) state.history = [];
  const entry = { round: state.round, scores: {} };
  for (const p of players(state)) entry.scores[p] = score(state, p);
  const last = state.history[state.history.length - 1];
  if (last && last.round === entry.round) state.history[state.history.length - 1] = entry;
  else state.history.push(entry);
  if (final) state.finalScores = entry.scores;
}

export function finishByScore(state) {
  state.round = state.turnLimit;
  recordHistory(state, true);
  const ranked = players(state).filter(p => alive(state, p))
    .sort((a, b) => state.finalScores[b] - state.finalScores[a]);
  state.winner = ranked[0] || null;
  state.endReason = 'score';
}

export function ranking(state) {
  const sc = state.finalScores || Object.fromEntries(players(state).map(p => [p, score(state, p)]));
  return players(state).slice().sort((a, b) => sc[b] - sc[a]).map(p => ({ player: p, score: sc[p] }));
}
