// Lokaler Spielstand (Solo gegen KI und Hotseat) im localStorage.
// Online-Partien liegen in Supabase und werden hier nicht gespeichert.

import {
  TERRAIN, UNITS, TECHS, TRIBES, IMPROVEMENTS, RESOURCES, CITY_REWARDS, PERSONAS,
  MAP_SIZES, MAP_TYPES, AI_LEVELS, MAX_POP, MONUMENTS, RETIRED_TECHS, own
} from './config.js';

const KEY = 'pb_save_v1';
const MODES = { bot: 'Gegen KI', hotseat: 'Hotseat' };

function storage(store) {
  if (store) return store;
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}

export function saveGame(mode, state, store) {
  const s = storage(store);
  if (!s || !MODES[mode] || !state) return false;
  if (state.winner) { clearSave(s); return false; }
  try {
    s.setItem(KEY, JSON.stringify({ v: 1, mode, savedAt: Date.now(), state }));
    return true;
  } catch (e) {
    return false;
  }
}

// Prüfung, damit ein beschädigter oder gebauter Stand nie geladen wird. Gilt
// auch für Online-Partien: dort kommt der Stand von einem Mitspieler, also
// werden Datentypen und alle IDs geprüft (Zahlen sind Zahlen, Einheiten,
// Gebäude, Technologien und Stämme gibt es wirklich, Spieler heißen player_N).
const PLAYER_ID = /^player_[1-9]$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isInt = v => Number.isInteger(v);
const isKey = v => typeof v === 'string' && /^-?\d{1,3},-?\d{1,3}$/.test(v);
const optional = (v, check) => v === undefined || v === null || check(v);
const dictOf = (v, check) => isObj(v) && Object.entries(v).every(([k, x]) => check(x, k));
const listOf = (v, check) => Array.isArray(v) && v.every(check);

export function validState(st) {
  try { return checkState(st); } catch (e) { return false; }
}

function checkState(st) {
  if (!isObj(st) || !Array.isArray(st.terrain)) return false;
  const W = st.mapW ?? 26, H = st.mapH ?? 18;
  if (!isInt(W) || !isInt(H) || W < 4 || H < 4 || W > 80 || H > 80 || st.terrain.length !== W * H) return false;
  if (!st.terrain.every(t => own(TERRAIN, t))) return false;
  if (!listOf(st.players, p => typeof p === 'string' && PLAYER_ID.test(p)) || st.players.length < 2 || st.players.length > 9) return false;
  if (new Set(st.players).size !== st.players.length) return false;
  const P = new Set(st.players);
  const isPlayer = p => typeof p === 'string' && P.has(p);
  const owner = p => p === null || p === undefined || isPlayer(p);
  if (!isPlayer(st.turn)) return false;
  if (!optional(st.winner, isPlayer)) return false;
  if (!optional(st.round, r => isInt(r) && r >= 1 && r < 100000)) return false;
  if (!optional(st.rev, r => isInt(r) && r >= 0)) return false;
  if (!optional(st.turnLimit, r => isInt(r) && r >= 1 && r < 100000)) return false;
  for (const k of ['mapSize', 'mapType', 'aiLevel']) if (!optional(st[k], v => typeof v === 'string')) return false;
  if (st.mapSize != null && !own(MAP_SIZES, st.mapSize)) return false;
  if (st.mapType != null && !own(MAP_TYPES, st.mapType)) return false;
  if (st.aiLevel != null && !own(AI_LEVELS, st.aiLevel)) return false;
  if (!optional(st.ai, a => listOf(a, isPlayer))) return false;
  // Sterne und Technologien: jeder Spieler hat eine Zahl und eine Liste bekannter Technologien.
  if (!isObj(st.stars) || !isObj(st.techs)) return false;
  if (!st.players.every(p => isNum(st.stars[p]) && listOf(st.techs[p], t => t === 'basic' || !!own(TECHS, t) || RETIRED_TECHS.includes(t)))) return false;
  if (!dictOf(st.stars, (v, k) => P.has(k) && isNum(v)) || !dictOf(st.techs, (v, k) => P.has(k))) return false;
  if (!optional(st.tribes, t => dictOf(t, (v, k) => P.has(k) && !!own(TRIBES, v)))) return false;
  if (!optional(st.persona, t => dictOf(t, (v, k) => P.has(k) && !!own(PERSONAS, v)))) return false;
  // Einheiten und Städte: auf der Karte, bekannte Art, Besitzer ist ein Spieler.
  const onMap = o => isObj(o) && isInt(o.q) && isInt(o.r) && o.q >= 0 && o.r >= 0 && o.q < W && o.r < H;
  const unitType = t => !!own(UNITS, t);
  const unitOk = u => onMap(u) && typeof u.id === 'string' && SAFE_ID.test(u.id) && unitType(u.type) && isPlayer(u.owner) &&
    isNum(u.hp) && optional(u.mp, isNum) && optional(u.kills, isInt) && optional(u.rid, isInt) &&
    optional(u.carry, unitType) && optional(u.cargo, c => isObj(c) && unitType(c.type) && isNum(c.hp ?? 0) && optional(c.carry, unitType)) &&
    optional(u.home, h => isObj(h) && isInt(h.q) && isInt(h.r));
  const cityOk = c => onMap(c) && owner(c.owner) && isInt(c.pop) && c.pop >= 0 && c.pop <= MAX_POP &&
    optional(c.rewards, r => dictOf(r, v => !!own(CITY_REWARDS, v))) && optional(c.pending, l => listOf(l, isInt));
  if (!listOf(st.units, unitOk) || !listOf(st.cities, cityOk)) return false;
  // Felder: Schlüssel „q,r“, Werte aus den bekannten Tabellen.
  const tiles = (v, check) => optional(v, d => dictOf(d, (x, k) => isKey(k) && check(x)));
  if (!tiles(st.improvements, v => !!own(IMPROVEMENTS, v))) return false;
  if (!tiles(st.resources, v => !!own(RESOURCES, v))) return false;
  if (!tiles(st.bridges, isInt) || !tiles(st.roads, v => v === true) || !tiles(st.ruins, v => typeof v !== 'object' || v === null)) return false;
  if (!tiles(st.camps, c => isObj(c) && unitType(c.type) && listOf(c.used, isPlayer))) return false;
  if (!tiles(st.lighthouses, l => listOf(l, isPlayer))) return false;
  if (!optional(st.explored, e => dictOf(e, (v, k) => P.has(k) && listOf(v, isKey)))) return false;
  if (!optional(st.eliminated, e => dictOf(e, (v, k) => P.has(k) && isObj(v) && isInt(v.round) && owner(v.by)))) return false;
  if (!optional(st.finalScores, f => dictOf(f, (v, k) => P.has(k) && isNum(v)))) return false;
  if (!optional(st.history, h => listOf(h, x => isObj(x) && isInt(x.round) && dictOf(x.scores, (v, k) => P.has(k) && isNum(v))))) return false;
  if (!optional(st.log, l => listOf(l, e => isObj(e) && typeof e.kind === 'string' && owner(e.victim) && owner(e.by) &&
    optional(e.unit, unitType) && optional(e.dmg, isNum) && optional(e.q, isInt) && optional(e.r, isInt) && optional(e.round, isInt)))) return false;
  // Zähler je Spieler (killsBy, capturesBy, peak …) sind Zahlen.
  for (const k of Object.keys(st)) {
    if ((/By$/.test(k) || k === 'peak') && !optional(st[k], d => dictOf(d, (v, p) => P.has(p) && isNum(v)))) return false;
  }
  for (const k of ['monumentsUnlocked', 'monumentsBuilt']) {
    if (!optional(st[k], d => dictOf(d, (v, p) => P.has(p) && listOf(v, m => !!own(MONUMENTS, m))))) return false;
  }
  if (!optional(st.cityMemory, d => dictOf(d, (m, p) => P.has(p) && dictOf(m, (c, k) => isKey(k) && isObj(c) && owner(c.owner) && isInt(c.pop))))) return false;
  if (!optional(st.peace, d => dictOf(d, isInt)) || !optional(st.warCooldown, d => dictOf(d, isInt))) return false;
  if (!optional(st.met, d => dictOf(d, (v, p) => P.has(p) && listOf(v, isPlayer)))) return false;
  if (!optional(st.missionStars, isInt)) return false;
  if (!optional(st.looks, d => dictOf(d, (l, p) => P.has(p) && dictOf(l, v => typeof v === 'string' && SAFE_ID.test(v))))) return false;
  if (!optional(st.admin, v => typeof v === 'boolean')) return false;
  for (const k of ['mission', 'weekly', 'daily', 'weeklyRule', 'endReason']) if (!optional(st[k], v => typeof v === 'string' && v.length <= 40)) return false;
  if (!optional(st.peaceOffers, l => listOf(l, o => isObj(o) && isPlayer(o.from) && isPlayer(o.to)))) return false;
  if (!optional(st.replay, l => listOf(l, f => isObj(f) && isInt(f.r) &&
    listOf(f.c, c => listOf(c, isInt)) && listOf(f.u, u => listOf(u, isInt)) &&
    optional(f.i, d => dictOf(d, (v, k) => isKey(k) && !!own(IMPROVEMENTS, v)))))) return false;
  return true;
}

export function loadGame(store) {
  const s = storage(store);
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !MODES[data.mode] || !validState(data.state)) return null;
    if (data.state.winner) return null;
    return data;
  } catch (e) {
    return null;
  }
}

export function saveInfo(store) {
  const data = loadGame(store);
  if (!data) return null;
  return { mode: data.mode, label: MODES[data.mode], round: data.state.round || 1 };
}

export function clearSave(store) {
  const s = storage(store);
  try { s && s.removeItem(KEY); } catch (e) { /* ignorieren */ }
}
