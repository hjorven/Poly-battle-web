// Lokaler Spielstand (Solo gegen KI und Hotseat) im localStorage.
// Online-Partien liegen in Supabase und werden hier nicht gespeichert.

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

// Grobe Prüfung, damit ein beschädigter Stand nie geladen wird (Karte passt
// zur Größe, Listen sind Listen, jede Einheit und Stadt liegt auf der Karte).
export function validState(st) {
  if (!st || typeof st !== 'object' || !Array.isArray(st.terrain)) return false;
  const W = st.mapW || 26, H = st.mapH || 18;
  if (!Number.isInteger(W) || !Number.isInteger(H) || st.terrain.length !== W * H) return false;
  if (!Array.isArray(st.players) || st.players.length < 2 || !st.players.includes(st.turn)) return false;
  if (!Array.isArray(st.units) || !Array.isArray(st.cities)) return false;
  if (!st.stars || typeof st.stars !== 'object' || !st.techs || typeof st.techs !== 'object') return false;
  const onMap = o => o && Number.isInteger(o.q) && Number.isInteger(o.r) && o.q >= 0 && o.r >= 0 && o.q < W && o.r < H;
  return st.units.every(onMap) && st.cities.every(onMap) && st.players.every(p => Array.isArray(st.techs[p]));
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
