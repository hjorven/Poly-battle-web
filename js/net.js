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

// Schon einmal online gewesen? Erst dann fragt das Menü nach den eigenen
// Partien. Wer nie online spielt, schickt beim Seitenaufruf nichts an den
// Server (siehe datenschutz.html). Ältere Browser haben nur eine Kennung und
// noch keine Markierung: dort entscheidet die erste Antwort von pb_my_matches.
const ONLINE_KEY = 'pb_online';

function existingToken() {
  try { return localStorage.getItem('pb_token') || null; } catch (e) { return null; }
}

function markOnline(v = '1') {
  try { localStorage.setItem(ONLINE_KEY, v); } catch (e) { /* ohne Browserspeicher */ }
}

export function playedOnline() {
  try {
    const f = localStorage.getItem(ONLINE_KEY);
    if (f) return f === '1';
    return !!existingToken();
  } catch (e) {
    return false;
  }
}

// Zeitgrenze für Serveranfragen: Hängt die Verbindung, kommt nach dieser Zeit
// „Keine Verbindung zum Server.“ statt endlosem Warten. Spielstände sind größer
// und werden auf dem Server geprüft, dafür gibt es etwas mehr Zeit.
export const RPC_TIMEOUT = 10000;
const SAVE_TIMEOUT = 20000;
const OFFLINE = 'Keine Verbindung zum Server.';

// sb.rpc mit Zeitgrenze. Bei Zeitüberschreitung wird die Anfrage abgebrochen
// und als Netzwerkfehler gemeldet ({ error: { message, timeout: true } }).
async function callRpc(sb, fn, args, ms = RPC_TIMEOUT) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => {
      try { ctrl && ctrl.abort(); } catch (e) { /* ignore */ }
      resolve({ data: null, error: { message: 'NetworkError: timeout', timeout: true } });
    }, ms);
  });
  try {
    let q = sb.rpc(fn, args);
    if (ctrl && q && typeof q.abortSignal === 'function') q = q.abortSignal(ctrl.signal);
    const res = await Promise.race([Promise.resolve(q).catch(e => ({ data: null, error: { message: 'NetworkError: ' + (e && e.message) } })), timeout]);
    // Abbruch durch die Zeitgrenze meldet supabase-js als AbortError.
    if (res && res.error && /abort/i.test(res.error.message || '')) return { data: null, error: { message: 'NetworkError: timeout', timeout: true } };
    return res;
  } finally {
    clearTimeout(timer);
  }
}

const isNetErr = error => !!error && /Failed to fetch|NetworkError|Load failed|network|abort/i.test(error.message || '');

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
  const { data, error } = await callRpc(sb, 'create_match', { p_state: state, p_token: getToken(), ...adminArg(adminKey) }, SAVE_TIMEOUT);
  if (isNetErr(error)) return { error: 'Spiel konnte nicht erstellt werden: ' + OFFLINE };
  if (!error && data) markOnline();
  if (error || !data) return { error: 'Spiel konnte nicht erstellt werden: ' + (error ? error.message : 'keine Antwort') };
  return { match: parseState(data) };
}

export async function joinMatch(gameId) {
  const sb = getClient();
  if (!sb) return { error: 'Multiplayer-Bibliothek nicht geladen.' };
  const { data, error } = await callRpc(sb, 'join_match', { p_id: gameId, p_token: getToken() });
  if (isNetErr(error)) return { error: OFFLINE };
  if (!error && data && data.role) markOnline();
  if (error || !data || !data.match) return { error: 'Spiel nicht gefunden. Prüfe den Link.' };
  return { match: parseState(data.match), role: data.role || null };
}

// Stand lesen, ohne einen Platz zu nehmen. Laufende Partien sieht nur, wer
// mitspielt (match.hidden für Zuschauer).
export async function fetchMatch(gameId) {
  const sb = getClient();
  if (!sb) return { error: 'Offline' };
  try {
    const { data, error } = await callRpc(sb, 'pb_get_match', { p_id: gameId, p_token: getToken() });
    if (isNetErr(error)) return { error: OFFLINE };
    if (error || !data || !data.match) return { error: 'Spiel nicht gefunden.' };
    return { match: parseState(data.match), role: data.role || null };
  } catch (e) {
    return { error: 'Keine Verbindung zum Server.' };
  }
}

// Die Datenbank klingelt nach jeder Änderung auf dem Kanal der Partie (nur
// „es gibt Neues“, kein Spielstand); dann wird der Stand geprüft abgeholt.
// Gehört wird auf dem privaten Kanal, auf dem nur die Datenbank senden darf;
// lehnt der Server ihn ab (ältere Datenbank), auf dem öffentlichen.
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
  const listen = priv => sb.channel('match-' + gameId, priv ? { config: { private: true } } : undefined)
    .on('broadcast', { event: 'moved' }, () => pull())
    .subscribe(status => {
      if (status === 'SUBSCRIBED') pull();
      else if (priv && status === 'CHANNEL_ERROR' && !channel.pbAlt) {
        // Gleiches Thema zweimal stört sich: den privaten Kanal erst schließen.
        sb.removeChannel(channel);
        channel.pbAlt = listen(false);
      }
    });
  const channel = listen(true);
  channel.pbPoll = setInterval(() => { if (!document.hidden) pull(); }, 45000);
  return channel;
}

export function unsubscribe(channel) {
  const sb = getClient();
  if (!channel) return;
  clearInterval(channel.pbPoll);
  if (sb) sb.removeChannel(channel);
  if (sb && channel.pbAlt) sb.removeChannel(channel.pbAlt);
}

export async function saveMatch(gameId, state, adminKey = null) {
  const sb = getClient();
  if (!sb) return { error: 'Offline' };
  try {
    const { error } = await callRpc(sb, 'save_match', { p_id: gameId, p_token: getToken(), p_state: state, ...adminArg(adminKey) }, SAVE_TIMEOUT);
    // supabase-js meldet eine abgebrochene Verbindung als Fehler, nicht als Ausnahme.
    if (isNetErr(error)) {
      return { error: 'Zug nicht gespeichert: keine Verbindung zum Server.' };
    }
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
// Nur wer schon online war (sonst kein Aufruf, keine neue Kennung).
export async function myMatches() {
  if (!playedOnline()) return { data: [] };
  const res = await rpc('pb_my_matches', { p_token: getToken() });
  // Ältere Browser ohne Markierung: einmal nachsehen und merken.
  try {
    if (!res.error && Array.isArray(res.data) && !localStorage.getItem(ONLINE_KEY)) markOnline(res.data.length ? '1' : '0');
  } catch (e) { /* ignore */ }
  return res;
}

// --- Profile und Bestenliste (siehe supabase/migrations/…profiles_leaderboard) ---

async function rpc(fn, args) {
  const sb = getClient();
  if (!sb) return { error: OFFLINE };
  try {
    const { data, error } = await callRpc(sb, fn, args);
    // Abgebrochene Verbindung meldet supabase-js als Fehlermeldung, nicht als Ausnahme.
    if (isNetErr(error)) return { error: OFFLINE };
    if (error) return { error: error.message || 'Serverfehler' };
    return { data };
  } catch (e) {
    return { error: 'Keine Verbindung zum Server.' };
  }
}

export const claimName = name => rpc('pb_claim_name', { p_token: getToken(), p_name: name });
export const myRemoteProfile = () => rpc('pb_my_profile', { p_token: getToken() });
export const saveRemoteProfile = (data, level) => rpc('pb_save_profile', { p_token: getToken(), p_data: data, p_level: level });
// Mit Zugprotokoll: der Server spielt die Partie nach, erst dann zählt sie.
export const submitScore = (kind, period, score, tribe, round, actions) =>
  rpc('pb_submit_score', { p_token: getToken(), p_kind: kind, p_period: period, p_score: score, p_tribe: tribe, p_round: round, p_actions: actions });
// Die Kennung nur mitschicken, wenn es schon eine gibt (markiert den eigenen
// Eintrag); Anschauen legt keine neue an.
export const leaderboard = (kind, period) => rpc('pb_leaderboard', { p_kind: kind, p_period: period, p_token: existingToken() });

// Profil-Code: die geheime Kennung dieses Browsers (zum Übertragen auf ein anderes Gerät).
export function profileCode() {
  return getToken();
}

// Was hängt auf dem Server an einem Code? { profile, matches } oder
// { error } bei fehlender Verbindung (dann weiß man es nicht).
async function codeData(code) {
  const [p, m] = await Promise.all([
    rpc('pb_my_profile', { p_token: code }),
    rpc('pb_my_matches', { p_token: code })
  ]);
  if (p.error || m.error) return { error: p.error || m.error };
  return { profile: p.data || null, matches: Array.isArray(m.data) ? m.data.length : 0 };
}

const PENDING_KEY = 'pb_token_pending';
const readPending = () => { try { return localStorage.getItem(PENDING_KEY); } catch (e) { return null; } };
const setPending = v => { try { if (v) localStorage.setItem(PENDING_KEY, v); else localStorage.removeItem(PENDING_KEY); } catch (e) { /* ohne Browserspeicher */ } };

// Neuen Code erzeugen: Die Datenbank tauscht die Kennung im Profil und auf
// allen Plätzen in Online-Partien aus, der alte Code gilt danach nirgends mehr.
// Der neue Code wird vorher gemerkt: Geht die Antwort verloren, findet der
// nächste Versuch Profil und Partien unter ihm wieder.
export async function renewProfileCode() {
  const pending = readPending();
  if (pending) {
    const was = await codeData(pending);
    if (was.error) return { error: was.error };
    if (was.profile || was.matches) {
      try { localStorage.setItem('pb_token', pending); } catch (e) { return { error: 'Neuer Code konnte im Browser nicht gespeichert werden: ' + pending }; }
      setPending(null);
      return { data: { profile: !!was.profile, matches: was.matches, recovered: true } };
    }
    setPending(null);
  }
  const old = getToken();
  const fresh = crypto.randomUUID();
  setPending(fresh);
  let res = await rpc('pb_rotate_token', { p_old: old, p_new: fresh });
  // Antwort verloren? Dann prüfen, ob der Tausch trotzdem geklappt hat
  // (Profil oder Partien unter dem neuen Code).
  if (res.error === OFFLINE) {
    const check = await codeData(fresh);
    if (check.error || !(check.profile || check.matches)) return res;
    res = { data: { profile: !!check.profile, matches: check.matches } };
  }
  // Noch nie online gewesen: Es gibt nichts umzustellen, nur den Code im Browser.
  if (res.error && /weder Profil noch Partien/.test(res.error)) res = { data: { profile: false, matches: 0 } };
  if (res.error) { setPending(null); return res; }
  try { localStorage.setItem('pb_token', fresh); } catch (e) { return { error: 'Neuer Code konnte im Browser nicht gespeichert werden: ' + fresh }; }
  setPending(null);
  return res;
}

// Code von einem anderen Gerät übernehmen. Erst beim Server nachsehen, ob es
// dazu ein Profil oder Partien gibt; nur dann ersetzt er den Code dieses
// Browsers (ein Tippfehler sperrte sonst aus Profil und Partien aus).
export async function adoptProfileCode(code) {
  const c = String(code || '').trim();
  if (c.length < 16 || c.length > 64 || !/^[A-Za-z0-9-]+$/.test(c)) return { error: 'Das ist kein gültiger Profil-Code.' };
  const found = await codeData(c);
  if (found.error) return { error: 'Keine Verbindung zum Server. Dein bisheriger Code bleibt.' };
  if (!found.profile && !found.matches) return { error: 'Zu diesem Code gibt es weder Profil noch Partien. Dein bisheriger Code bleibt.' };
  try { localStorage.setItem('pb_token', c); localStorage.setItem(ONLINE_KEY, '1'); } catch (e) { return { error: 'Der Code konnte im Browser nicht gespeichert werden.' }; }
  setPending(null);
  return { data: found };
}
