// Admin-/Kreativ-Werkzeuge (nur für den Entwickler, per Code freigeschaltet).
// Reine Spiellogik auf dem Spielstand – die Oberfläche steht in admin-panel.js.
// Jede Änderung markiert das Spiel (state.admin): keine Bestenliste.

import * as R from './rules.js';
import { UNITS, TECHS, IMPROVEMENTS, TERRAIN, RESOURCES, hasAbility } from './config.js';
import { hk, forEachHex, inBounds } from './hex.js';

// Passwort-Prüfung ohne Klartext im Quelltext:
//   Schlüssel  = SHA-256("pb-admin:" + Passwort)   – wird im Browser gemerkt
//   ADMIN_CHECK = SHA-256(Schlüssel)                – steht hier im Code
// Aus dem Prüfwert lässt sich der Schlüssel nicht zurückrechnen, die
// Freischaltung also nicht aus dem Quelltext abschreiben. Neues Passwort:
//   npm run admin-passwort -- "dein Passwort"
export const ADMIN_CHECK = '85baf7b05f06b522a71f0e99733e93de294e95fef24958eb7c9cc0394abc1ca1';

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const keyFor = password => sha256Hex('pb-admin:' + String(password || '').trim());

export async function checkKey(key, check = ADMIN_CHECK) {
  return typeof key === 'string' && /^[0-9a-f]{64}$/.test(key) && (await sha256Hex(key)) === check;
}

// Passwort prüfen; bei Erfolg den Schlüssel zum Merken zurückgeben, sonst null.
export async function checkCode(password, check = ADMIN_CHECK) {
  const key = await keyFor(password);
  return (await checkKey(key, check)) ? key : null;
}

export const markAdmin = st => { st.admin = true; };
const mark = markAdmin;
const isWet = t => t === 'water' || t === 'ocean';

// Passt eine Einheit dieses Typs auf das Feld? (ohne Technik-Vorgaben)
function fits(st, type, q, r, tile = R.terrainAt(st, q, r)) {
  if (!TERRAIN[tile]) return false;
  if (hasAbility(type, 'air')) return true;
  if (hasAbility(type, 'water')) return isWet(tile);
  return TERRAIN[tile].walkable || R.bridgeAt(st, q, r);
}
let seq = 0;

// --- Spiel ------------------------------------------------------------------------

export function setStars(st, p, n) {
  mark(st);
  st.stars[p] = Math.max(0, Math.min(99999, Math.floor(Number(n) || 0)));
}

export function grantTech(st, p, id) {
  mark(st);
  const ids = id === 'all' ? Object.keys(TECHS) : [id];
  for (const t of ids) {
    if (!TECHS[t] || st.techs[p].includes(t)) continue;
    // Voraussetzungen gleich mit erforschen.
    let chain = [], cur = t;
    while (cur && !st.techs[p].includes(cur)) { chain.unshift(cur); cur = TECHS[cur].req; }
    st.techs[p].push(...chain);
  }
}

export function refreshUnits(st, p) {
  mark(st);
  for (const u of st.units) if (u.owner === p) {
    u.acted = false; u.hasMoved = false; u.mp = R.maxMove(st, p, u.type);
  }
  for (const c of st.cities) if (c.owner === p) { c.trained = false; c.trainedShip = false; }
}

// Runden vorspulen: mit KI-Zügen (botStep/applyStep übergeben) oder ohne.
export function advanceRounds(st, n, ai = null) {
  mark(st);
  const target = st.round + Math.max(1, Math.min(50, n | 0));
  let guard = 0;
  while (!st.winner && st.round < target && guard++ < 2000) {
    const p = st.turn;
    if (ai && R.isBot(st, p)) {
      let k = 0;
      while (st.turn === p && !st.winner && k++ < 300) { const s = ai.botStep(st, p); if (!s) break; ai.applyStep(st, s, p); }
    }
    if (st.turn === p && !st.winner) R.endTurn(st);
  }
  // Danach wieder am Zug des ersten Menschen.
  guard = 0;
  while (!st.winner && R.isBot(st, st.turn) && guard++ < 10) R.endTurn(st);
}

export function winNow(st, p) {
  mark(st);
  for (const c of st.cities) if (c.owner && c.owner !== p) c.owner = p;
  R.checkWinner(st);
}

export function loseNow(st, p) {
  mark(st);
  const foe = st.players.find(x => x !== p && R.alive(st, x)) || null;
  for (const c of st.cities) if (c.owner === p) c.owner = foe;
  R.checkWinner(st);
}

// --- Einheiten ----------------------------------------------------------------------

export function spawnUnit(st, owner, type, q, r) {
  if (!UNITS[type] || !st.players.includes(owner)) return { ok: false, reason: 'Unbekannt' };
  if (!inBounds(q, r)) return { ok: false, reason: 'Außerhalb der Karte' };
  if (R.unitAt(st, q, r)) return { ok: false, reason: 'Feld besetzt' };
  if (!fits(st, type, q, r)) return { ok: false, reason: hasAbility(type, 'water') ? 'Schiffe nur auf Wasser' : 'Landeinheiten nur auf Land' };
  const c = R.cityAt(st, q, r);
  if (c && c.owner && c.owner !== owner) return { ok: false, reason: 'Fremde Stadt' };
  mark(st);
  const u = { id: 'admin_' + Date.now().toString(36) + '_' + seq++, owner, type, q, r, hp: R.maxHp(type), mp: R.maxMove(st, owner, type), hasMoved: false, acted: false };
  st.units.push(u);
  R.updateExplored(st, owner);
  return { ok: true, unit: u };
}

export function healUnit(st, u) { mark(st); u.hp = R.hpCap(u); }
export function hurtUnit(st, u) { mark(st); u.hp = Math.max(1, Math.ceil(u.hp / 2)); }
export function makeVeteran(st, u) { mark(st); u.vet = true; u.kills = Math.max(u.kills || 0, 3); u.hp = R.hpCap(u); }
export function killUnit(st, u) { mark(st); st.units = st.units.filter(x => x !== u); R.checkWinner(st); }
export function setUnitOwner(st, u, p) {
  const c = R.cityAt(st, u.q, u.r);
  if (!st.players.includes(p)) return { ok: false, reason: 'Unbekannter Spieler' };
  if (c && c.owner && c.owner !== p) return { ok: false, reason: 'Steht in fremder Stadt' };
  mark(st); u.owner = p; R.updateExplored(st, p);
  return { ok: true };
}

// --- Städte -------------------------------------------------------------------------

export function setCityPop(st, city, n) {
  mark(st);
  const want = Math.max(1, Math.min(5, n | 0));
  if (want > city.pop) R.growCity(st, city, want - city.pop); // löst Belohnungen aus
  else { city.pop = want; city.pending = (city.pending || []).filter(l => l <= want); }
}

export function setCityOwner(st, city, p) {
  if (p !== null && !st.players.includes(p)) return { ok: false, reason: 'Unbekannter Spieler' };
  mark(st);
  city.owner = p;
  R.checkWinner(st);
  return { ok: true };
}
export function toggleWall(st, city) {
  mark(st);
  city.rewards = { ...(city.rewards || {}) };
  if (city.rewards[3] === 'wall') delete city.rewards[3]; else city.rewards[3] = 'wall';
}

export function foundCity(st, q, r, owner) {
  const t = TERRAIN[R.terrainAt(st, q, r)];
  if (!t || !t.walkable) return { ok: false, reason: 'Nur auf Land' };
  if (R.cityAt(st, q, r)) return { ok: false, reason: 'Hier steht schon eine Stadt' };
  if (owner && !st.players.includes(owner)) return { ok: false, reason: 'Unbekannter Spieler' };
  mark(st);
  st.cities.push({ q, r, owner: owner || null, pop: 1, trained: false, isCapital: false });
  delete st.improvements[hk(q, r)];
  delete st.resources[hk(q, r)];
  return { ok: true };
}

// Gebäude ohne Kosten/Technik setzen ('none' entfernt). Gelände muss passen.
export function placeImprovement(st, q, r, type) {
  const k = hk(q, r);
  if (type === 'none') { mark(st); delete st.improvements[k]; return { ok: true }; }
  const def = IMPROVEMENTS[type];
  if (!def) return { ok: false, reason: 'Unbekannt' };
  if (!def.terrain.includes(R.terrainAt(st, q, r))) return { ok: false, reason: 'Falsches Gelände: ' + def.terrain.join('/') };
  if (R.cityAt(st, q, r)) return { ok: false, reason: 'Stadtfeld' };
  mark(st);
  delete st.resources[k];
  st.improvements[k] = type;
  return { ok: true };
}

export function toggleRoad(st, q, r) {
  const t = TERRAIN[R.terrainAt(st, q, r)];
  if (!t || !t.walkable) return { ok: false, reason: 'Nur auf Land' };
  mark(st);
  if (!st.roads) st.roads = {};
  if (st.roads[hk(q, r)]) delete st.roads[hk(q, r)]; else st.roads[hk(q, r)] = true;
  return { ok: true };
}

export function toggleBridge(st, q, r) {
  const tile = R.terrainAt(st, q, r);
  if (tile !== 'water') return { ok: false, reason: 'Nur auf Flachwasser' };
  mark(st);
  if (!st.bridges) st.bridges = {};
  const k = hk(q, r);
  if (st.bridges[k] != null) { delete st.bridges[k]; return { ok: true }; }
  // Achse: die Richtung mit Land auf beiden Seiten, sonst Ost-West.
  const land = (x, y) => { const d = TERRAIN[R.terrainAt(st, x, y)]; return d && d.walkable; };
  const dirs = [[1, 0], [1, -1], [0, -1]];
  const axis = dirs.findIndex(([dq, dr]) => land(q + dq, r + dr) || land(q - dq, r - dr));
  st.bridges[k] = Math.max(0, axis);
  return { ok: true };
}

// --- Karte --------------------------------------------------------------------------

export function paintTerrain(st, q, r, t) {
  if (!inBounds(q, r) || !TERRAIN[t]) return { ok: false, reason: 'Außerhalb der Karte' };
  const wet = isWet(t);
  if (R.cityAt(st, q, r) && wet) return { ok: false, reason: 'Stadt kann nicht ins Wasser' };
  const u = R.unitAt(st, q, r);
  if (u && !fitsAfter(st, u, q, r, t)) return { ok: false, reason: 'Einheit passt nicht aufs neue Gelände' };
  mark(st);
  st.terrain[r * st.mapW + q] = t;
  const k = hk(q, r);
  const imp = st.improvements[k];
  if (imp && !IMPROVEMENTS[imp].terrain.includes(t)) delete st.improvements[k];
  const res = st.resources[k];
  if (res && !RESOURCES[res].terrain.includes(t)) delete st.resources[k];
  if (!wet && st.bridges) delete st.bridges[k];
  if (wet && st.roads) delete st.roads[k];
  return { ok: true };
}

function fitsAfter(st, u, q, r, t) {
  if (hasAbility(u.type, 'air')) return true;
  if (hasAbility(u.type, 'water')) return isWet(t);
  return TERRAIN[t].walkable || (isWet(t) && t === 'water' && R.bridgeAt(st, q, r));
}

export function setResource(st, q, r, res) {
  const k = hk(q, r);
  if (res === 'none') { mark(st); delete st.resources[k]; return { ok: true }; }
  if (!RESOURCES[res] || !RESOURCES[res].terrain.includes(R.terrainAt(st, q, r))) return { ok: false, reason: 'Passt nicht zum Gelände' };
  mark(st);
  delete st.improvements[k];
  st.resources[k] = res;
  return { ok: true };
}

export function toggleRuin(st, q, r) {
  const t = TERRAIN[R.terrainAt(st, q, r)];
  if (!t || !t.walkable || R.cityAt(st, q, r)) return { ok: false, reason: 'Nur auf freiem Land' };
  mark(st);
  if (!st.ruins) st.ruins = {};
  if (st.ruins[hk(q, r)]) delete st.ruins[hk(q, r)]; else st.ruins[hk(q, r)] = true;
  return { ok: true };
}

export function revealAll(st, p) {
  mark(st);
  const all = [];
  forEachHex((q, r) => all.push(hk(q, r)));
  st.explored[p] = all;
}

// Nebel aus: alle sehen alles (wie die Wochenregel „Klare Sicht“). Wieder an:
// die Karte bleibt bekannt, fremde Einheiten verschwinden aber wieder im Nebel.
export function toggleFog(st) {
  mark(st);
  st.noFog = !st.noFog;
  if (st.noFog) for (const p of st.players) revealAll(st, p);
}

// --- Spielstand ---------------------------------------------------------------------

export function exportState(st) {
  return JSON.stringify(st);
}

// Spielstand aus JSON laden (Prüfung mit validState aus save.js).
export function importState(text, validState) {
  let st;
  try { st = JSON.parse(text); } catch { return { ok: false, reason: 'Kein gültiges JSON' }; }
  if (!validState(st)) return { ok: false, reason: 'Kein gültiger Spielstand' };
  if (st.online) return { ok: false, reason: 'Online-Partien lassen sich nicht laden' };
  st.admin = true;
  return { ok: true, state: st };
}

// --- Profil (lokal; wird erst beim nächsten Abgleich mit dem Server geteilt) -------

export function setProfileLevel(profile, level, xpFor) {
  profile.xp = xpFor(Math.max(1, Math.min(50, level | 0)));
}

export function unlockAchievements(profile, ids, today) {
  for (const id of ids) if (!profile.achievements[id]) profile.achievements[id] = today;
}

export function setCampaign(profile, missions, stars) {
  profile.campaign = stars > 0 ? Object.fromEntries(missions.map(m => [m.id, Math.min(3, stars)])) : {};
}

export function setDailyStreak(profile, n, today) {
  profile.daily = { ...profile.daily, streak: Math.max(0, n | 0), bestStreak: Math.max(profile.daily.bestStreak || 0, n | 0), last: n > 0 ? today : null };
}

// Kurzbeschreibung eines Feldes (Werkzeug „Feld ansehen“).
export function describeHex(st, q, r) {
  if (!inBounds(q, r)) return '';
  const k = hk(q, r);
  const parts = [`${q},${r}: ${TERRAIN[R.terrainAt(st, q, r)].name}`];
  if (st.resources[k]) parts.push('Rohstoff ' + RESOURCES[st.resources[k]].name);
  if (st.improvements[k]) parts.push('Gebäude ' + IMPROVEMENTS[st.improvements[k]].name);
  if (R.roadAt(st, q, r)) parts.push('Weg');
  if (R.bridgeAt(st, q, r)) parts.push('Brücke');
  if (st.ruins && st.ruins[k]) parts.push('Ruine');
  const c = R.cityAt(st, q, r);
  if (c) parts.push(`Stadt Stufe ${c.pop} (${c.owner || 'frei'})`);
  const u = R.unitAt(st, q, r);
  if (u) parts.push(`${UNITS[u.type].name} von ${u.owner}, ${u.hp}/${R.hpCap(u)} LP${u.vet ? ', Veteran' : ''}`);
  const owner = st.players.find(p => R.ownLand(st, p, q, r));
  if (owner) parts.push('Gebiet von ' + owner);
  return parts.join(' · ');
}
