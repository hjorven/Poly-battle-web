const SUPABASE_URL = 'https://dzcikosdbkersscdmppz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6Y2lrb3NkYmtlcnNzY2RtcHB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNjgyODksImV4cCI6MjEwNjk0NDI4OX0.4WFDB18GkYrhyEpKXqJWRNivM2u2gcfMOYTind7UuQI';

let client = null;

function getClient() {
  if (client) return client;
  if (!window.supabase) return null;
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

// Geheime Spieler-Kennung dieses Browsers. Die Datenbank speichert nur
// ihren SHA-256-Hash; geschrieben wird ausschließlich über die Funktionen
// create_match / join_match / save_match (siehe supabase/migrations).
export function getToken() {
  try {
    let t = localStorage.getItem('pb_token');
    if (!t || t.length < 16) { t = crypto.randomUUID(); localStorage.setItem('pb_token', t); }
    return t;
  } catch (e) {
    return crypto.randomUUID();
  }
}

function parseState(match) {
  if (match && typeof match.game_state === 'string') match.game_state = JSON.parse(match.game_state);
  return match;
}

// Admin-Schlüssel nur mitschicken, wenn es eine Testpartie ist (sonst prüft
// der Server jeden Stand auf Plausibilität).
const adminArg = key => (key ? { p_admin_key: key } : {});

export async function createMatch(state, adminKey = null) {
  const sb = getClient();
  if (!sb) return { error: 'Multiplayer-Bibliothek nicht geladen.' };
  const { data, error } = await sb.rpc('create_match', { p_state: state, p_token: getToken(), ...adminArg(adminKey) });
  if (error || !data) return { error: 'Spiel konnte nicht erstellt werden: ' + (error ? error.message : 'keine Antwort') };
  return { match: parseState(data) };
}

export async function joinMatch(gameId) {
  const sb = getClient();
  if (!sb) return { error: 'Multiplayer-Bibliothek nicht geladen.' };
  const { data, error } = await sb.rpc('join_match', { p_id: gameId, p_token: getToken() });
  if (error || !data || !data.match) return { error: 'Spiel nicht gefunden. Prüfe den Link.' };
  return { match: parseState(data.match), role: data.role || null };
}

// Stand lesen, ohne einen Platz zu nehmen. Laufende Partien sieht nur, wer
// mitspielt (match.hidden für Zuschauer).
export async function fetchMatch(gameId) {
  const sb = getClient();
  if (!sb) return { error: 'Offline' };
  try {
    const { data, error } = await sb.rpc('pb_get_match', { p_id: gameId, p_token: getToken() });
    if (error || !data || !data.match) return { error: 'Spiel nicht gefunden.' };
    return { match: parseState(data.match), role: data.role || null };
  } catch (e) {
    return { error: 'Keine Verbindung zum Server.' };
  }
}

// Die Datenbank klingelt nach jeder Änderung auf dem Kanal der Partie (nur
// „es gibt Neues“, kein Spielstand); dann wird der Stand geprüft abgeholt.
// Nach einem Verbindungsabbruch und alle 45 Sekunden wird zur Sicherheit
// ebenfalls nachgefragt, damit kein Zug verloren geht.
export function subscribe(gameId, onUpdate) {
  const sb = getClient();
  if (!sb) return null;
  let busy = false;
  const pull = async () => {
    if (busy) return;
    busy = true;
    try {
      const { match, role } = await fetchMatch(gameId);
      if (match) onUpdate(match, role);
    } finally {
      busy = false;
    }
  };
  const channel = sb.channel('match-' + gameId)
    .on('broadcast', { event: 'moved' }, () => pull())
    .subscribe(status => { if (status === 'SUBSCRIBED') pull(); });
  channel.pbPoll = setInterval(() => { if (!document.hidden) pull(); }, 45000);
  return channel;
}

export function unsubscribe(channel) {
  const sb = getClient();
  if (!channel) return;
  clearInterval(channel.pbPoll);
  if (sb) sb.removeChannel(channel);
}

export async function saveMatch(gameId, state, adminKey = null) {
  const sb = getClient();
  if (!sb) return { error: 'Offline' };
  try {
    const { error } = await sb.rpc('save_match', { p_id: gameId, p_token: getToken(), p_state: state, ...adminArg(adminKey) });
    if (error) return { error: 'Zug nicht gespeichert: ' + error.message, rejected: true };
  } catch (e) {
    return { error: 'Zug nicht gespeichert: keine Verbindung zum Server.' };
  }
  return {};
}

// Stamm an die KI geben: eigener (Aufgeben), ein nie besetzter Platz oder ein
// Mitspieler, der seit 24 Stunden nicht gezogen hat.
export async function handToAi(gameId, role) {
  const res = await rpc('pb_hand_to_ai', { p_id: gameId, p_token: getToken(), p_role: role });
  if (res.error) return res;
  return { match: parseState(res.data.match), role: res.data.role || null };
}

// Eigene Online-Partien (über den Profil-Code auch auf anderen Geräten).
export const myMatches = () => rpc('pb_my_matches', { p_token: getToken() });

// --- Profile und Bestenliste (siehe supabase/migrations/…profiles_leaderboard) ---

async function rpc(fn, args) {
  const sb = getClient();
  if (!sb) return { error: 'Keine Verbindung zum Server.' };
  try {
    const { data, error } = await sb.rpc(fn, args);
    if (error) return { error: error.message || 'Serverfehler' };
    return { data };
  } catch (e) {
    return { error: 'Keine Verbindung zum Server.' };
  }
}

export const claimName = name => rpc('pb_claim_name', { p_token: getToken(), p_name: name });
export const myRemoteProfile = () => rpc('pb_my_profile', { p_token: getToken() });
export const saveRemoteProfile = (data, level) => rpc('pb_save_profile', { p_token: getToken(), p_data: data, p_level: level });
export const submitScore = (kind, period, score, tribe, round) =>
  rpc('pb_submit_score', { p_token: getToken(), p_kind: kind, p_period: period, p_score: score, p_tribe: tribe, p_round: round });
export const leaderboard = (kind, period) => rpc('pb_leaderboard', { p_kind: kind, p_period: period, p_token: getToken() });

// Profil-Code: die geheime Kennung dieses Browsers (zum Übertragen auf ein anderes Gerät).
export function profileCode() {
  return getToken();
}

export function useProfileCode(code) {
  const c = String(code || '').trim();
  if (c.length < 16 || c.length > 64 || !/^[A-Za-z0-9-]+$/.test(c)) return false;
  try { localStorage.setItem('pb_token', c); return true; } catch (e) { return false; }
}
