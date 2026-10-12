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

export function loadGame(store) {
  const s = storage(store);
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !MODES[data.mode] || !data.state || !Array.isArray(data.state.terrain)) return null;
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
