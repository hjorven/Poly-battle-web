const SUPABASE_URL = 'https://dzcikosdbkersscdmppz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6Y2lrb3NkYmtlcnNzY2RtcHB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNjgyODksImV4cCI6MjEwNjk0NDI4OX0.4WFDB18GkYrhyEpKXqJWRNivM2u2gcfMOYTind7UuQI';

let client = null;

function getClient() {
  if (client) return client;
  if (!window.supabase) return null;
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

export function getToken() {
  try {
    let t = localStorage.getItem('pb_token');
    if (!t) { t = crypto.randomUUID(); localStorage.setItem('pb_token', t); }
    return t;
  } catch (e) {
    return crypto.randomUUID();
  }
}

function parseState(match) {
  if (typeof match.game_state === 'string') match.game_state = JSON.parse(match.game_state);
  return match;
}

export async function createMatch(state) {
  const sb = getClient();
  if (!sb) return { error: 'Multiplayer-Bibliothek nicht geladen.' };
  const { data, error } = await sb
    .from('matches')
    .insert([{ game_state: state, current_turn: state.turn, player_1: getToken() }])
    .select()
    .single();
  if (error) return { error: 'Spiel konnte nicht erstellt werden: ' + error.message };
  return { match: parseState(data) };
}

export async function joinMatch(gameId) {
  const sb = getClient();
  if (!sb) return { error: 'Multiplayer-Bibliothek nicht geladen.' };
  const token = getToken();
  const { data, error } = await sb.from('matches').select('*').eq('id', gameId).single();
  if (error || !data) return { error: 'Spiel nicht gefunden. Prüfe den Link.' };

  let role = null;
  if (data.player_1 === token) role = 'player_1';
  else if (data.player_2 === token) role = 'player_2';
  else if (!data.player_2) {
    const { data: upd } = await sb
      .from('matches')
      .update({ player_2: token })
      .eq('id', gameId)
      .is('player_2', null)
      .select();
    if (upd && upd.length) { role = 'player_2'; data.player_2 = token; }
  }
  return { match: parseState(data), role };
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
  const { error } = await sb
    .from('matches')
    .update({ game_state: state, current_turn: state.turn, last_move_at: new Date().toISOString() })
    .eq('id', gameId);
  if (error) return { error: 'Synchronisation fehlgeschlagen.' };
  return {};
}
