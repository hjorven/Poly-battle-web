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

export async function createMatch(state) {
  const sb = getClient();
  if (!sb) return { error: 'Multiplayer-Bibliothek nicht geladen.' };
  const { data, error } = await sb.rpc('create_match', { p_state: state, p_token: getToken() });
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

export async function fetchMatch(gameId) {
  const sb = getClient();
  if (!sb) return { error: 'Offline' };
  const { data, error } = await sb.from('matches').select('id, game_state, current_turn, player_2').eq('id', gameId).single();
  if (error || !data) return { error: 'Spiel nicht gefunden.' };
  return { match: parseState(data) };
}

export function subscribe(gameId, onUpdate) {
  const sb = getClient();
  if (!sb) return null;
  return sb
    .channel('match-' + gameId)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${gameId}`
    }, payload => onUpdate(parseState(payload.new)))
    .subscribe();
}

export function unsubscribe(channel) {
  const sb = getClient();
  if (!sb || !channel) return;
  sb.removeChannel(channel);
}

export async function saveMatch(gameId, state) {
  const sb = getClient();
  if (!sb) return { error: 'Offline' };
  const { error } = await sb.rpc('save_match', { p_id: gameId, p_token: getToken(), p_state: state });
  if (error) return { error: 'Zug nicht gespeichert: ' + error.message, rejected: true };
  return {};
}
