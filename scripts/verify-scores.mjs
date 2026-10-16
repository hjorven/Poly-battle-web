// Prüft eingereichte Ergebnisse der Tages- und Wochen-Herausforderung: spielt
// jede Partie aus ihrem Zugprotokoll mit denselben Regeln nach und trägt nur
// die nachgerechnete Punktzahl in die Bestenliste ein.
// Läuft per GitHub Actions (.github/workflows/verify-scores.yml), braucht den
// service_role-Schlüssel von Supabase:
//   SUPABASE_SERVICE_ROLE_KEY=… node scripts/verify-scores.mjs

import { replayChallenge } from '../js/actionlog.js';

const URL_ = process.env.SUPABASE_URL || 'https://dzcikosdbkersscdmppz.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.log('SUPABASE_SERVICE_ROLE_KEY fehlt: nichts geprüft.');
  process.exit(0);
}

async function rpc(fn, args) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  return res.json();
}

let checked = 0, accepted = 0;
for (let batch = 0; batch < 10; batch++) {
  const claims = await rpc('pb_pending_claims', { p_limit: 20 });
  if (!claims.length) break;
  for (const c of claims) {
    let re;
    try { re = replayChallenge(c.kind, c.period, c.actions); } catch (e) { re = { error: 'Nachspielen fehlgeschlagen: ' + e.message }; }
    const ok = !re.error;
    const reason = re.error || (re.score !== c.score ? `eingereicht ${c.score}, nachgerechnet ${re.score}` : null);
    await rpc('pb_settle_claim', {
      p_id: c.id, p_ok: ok, p_score: ok ? re.score : null, p_round: ok ? re.round : null,
      p_tribe: ok ? re.tribe : null, p_reason: reason
    });
    checked++;
    if (ok) accepted++;
    console.log(`${c.kind} ${c.period} #${c.id}: ${ok ? 'gültig, ' + re.score + ' Punkte' : 'abgelehnt'}${reason ? ' (' + reason + ')' : ''}`);
  }
}
console.log(`${checked} geprüft, ${accepted} gültig.`);
