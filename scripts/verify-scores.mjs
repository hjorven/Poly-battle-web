// Prüft eingereichte Ergebnisse der Tages- und Wochen-Herausforderung: spielt
// jede Partie aus ihrem Zugprotokoll mit denselben Regeln nach und trägt nur
// die nachgerechnete Punktzahl in die Bestenliste ein.
// Läuft per GitHub Actions (.github/workflows/verify-scores.yml), braucht den
// service_role-Schlüssel von Supabase:
//   SUPABASE_SERVICE_ROLE_KEY=… node scripts/verify-scores.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { replayChallenge } from '../js/actionlog.js';

const URL_ = process.env.SUPABASE_URL || 'https://dzcikosdbkersscdmppz.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rpc(fn, args) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Ältere Spielstände: Eine Partie wurde mit dem Code gespielt, der beim
// Spielen geladen war. Nach einer Regel- oder KI-Änderung passt das Protokoll
// nicht mehr zum neuesten Stand. Dann werden die Fassungen von js/ aus dem
// Zeitraum der Herausforderung probiert (neueste zuerst); es zählt die erste,
// die genau die eingereichte Punktzahl ergibt. Fassungen von vor der
// Herausforderung kommen nicht in Frage, so helfen alte, längst behobene
// Fehler nicht. Braucht die ganze Git-Geschichte (fetch-depth: 0).
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function periodStart(kind, period) {
  if (kind === 'daily') return new Date(period + 'T00:00:00Z');
  const [, y, w] = /^(\d{4})-W(\d{2})$/.exec(period) || [];
  if (!y) return null;
  const jan4 = new Date(Date.UTC(+y, 0, 4));
  return new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 864e5 + (+w - 1) * 7 * 864e5);
}

const current = (() => { try { return git('rev-parse', 'HEAD:js'); } catch (e) { return null; } })();
const START = Date.now();
const loaded = new Map();
const tmp = mkdtempSync(join(tmpdir(), 'pb-replay-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

// Fassungen von js/ (als Baum-Kennung), die in diesem Zeitraum online waren.
function olderVersions(kind, period) {
  const start = periodStart(kind, period);
  if (!start || !current) return [];
  // Etwas Vorlauf: Tagesherausforderungen gelten je nach Zeitzone früher.
  const since = new Date(start.getTime() - 864e5).toISOString();
  try {
    const shas = [
      ...git('log', '--first-parent', '--format=%H', '--since=' + since, 'HEAD', '--', 'js').split('\n'),
      git('log', '-1', '--first-parent', '--format=%H', '--until=' + since, 'HEAD', '--', 'js')
    ].filter(Boolean);
    const trees = [...new Set(shas.map(sha => git('rev-parse', sha + ':js')))];
    return trees.filter(t => t !== current).slice(0, 15);
  } catch (e) {
    return [];
  }
}

async function replayWith(tree, c) {
  if (!loaded.has(tree)) {
    const dir = join(tmp, tree);
    execFileSync('sh', ['-c', `mkdir -p "${dir}/js" && git archive ${tree} | tar -x -C "${dir}/js"`]);
    loaded.set(tree, await import(pathToFileURL(join(dir, 'js', 'actionlog.js')).href));
  }
  return loaded.get(tree).replayChallenge(c.kind, c.period, c.actions);
}

export async function replay(c) {
  let re;
  try { re = replayChallenge(c.kind, c.period, c.actions); } catch (e) { re = { error: 'Nachspielen fehlgeschlagen: ' + e.message }; }
  if (!re.error && re.score === c.score) return re;
  // Höchstens 8 Minuten für ältere Fassungen, der Lauf darf 15 dauern.
  if (Date.now() - START > 8 * 60e3) return re;
  for (const tree of olderVersions(c.kind, c.period)) {
    let old;
    try { old = await replayWith(tree, c); } catch (e) { continue; }
    if (!old.error && old.score === c.score) return { ...old, note: 'mit älterem Spielstand ' + tree.slice(0, 7) };
  }
  return re;
}

async function main() {
  if (!KEY) {
    console.log('SUPABASE_SERVICE_ROLE_KEY fehlt: nichts geprüft.');
    return;
  }
  let checked = 0, accepted = 0;
  for (let batch = 0; batch < 10; batch++) {
    const claims = await rpc('pb_pending_claims', { p_limit: 20 });
    if (!claims.length) break;
    for (const c of claims) {
      const re = await replay(c);
      const ok = !re.error && Number.isFinite(re.score);
      const reason = re.error || (!Number.isFinite(re.score) ? 'Punktzahl ist keine Zahl' : null) || (re.score !== c.score ? `eingereicht ${c.score}, nachgerechnet ${re.score}` : null) || re.note || null;
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
}

// Als Skript aufgerufen (nicht nur importiert, z. B. von Tests): prüfen.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
