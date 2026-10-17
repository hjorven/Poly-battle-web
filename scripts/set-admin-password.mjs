// Neues Admin-Passwort setzen: schreibt nur den Prüfwert nach js/admin.js
// und als neue Migration nach supabase/migrations (kein Klartext im Code),
// damit auch eine frisch aufgesetzte Datenbank den neuen Prüfwert hat.
// Aufruf: npm run admin-passwort -- "dein Passwort"
// Danach committen und veröffentlichen, die ausgegebene SQL-Anweisung auf
// Supabase ausführen und im Browser einmal neu freischalten.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const pw = (process.argv.slice(2).join(' ') || '').trim();
if (pw.length < 8) {
  console.error('Bitte ein Passwort mit mindestens 8 Zeichen angeben: npm run admin-passwort -- "dein Passwort"');
  process.exit(1);
}
const sha = t => createHash('sha256').update(t).digest('hex');
const check = sha(sha('pb-admin:' + pw));
const file = new URL('../js/admin.js', import.meta.url);
const src = readFileSync(file, 'utf8');
const next = src.replace(/export const ADMIN_CHECK = '[0-9a-f]{64}';/, `export const ADMIN_CHECK = '${check}';`);
if (next === src) { console.error('ADMIN_CHECK in js/admin.js nicht gefunden.'); process.exit(1); }
writeFileSync(file, next);
console.log('Admin-Passwort gesetzt (nur der Prüfwert steht in js/admin.js).');
// Der Server prüft Online-Testpartien mit demselben Prüfwert.
const sql = `create or replace function public.pb_admin_check() returns text language sql immutable set search_path = '' as $$ select '${check}'::text $$;`;
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const migration = new URL(`../supabase/migrations/${stamp}_admin_passwort.sql`, import.meta.url);
writeFileSync(migration, `-- Neuer Prüfwert für das Admin-Passwort (scripts/set-admin-password.mjs).\n${sql}\nrevoke all on function public.pb_admin_check() from public, anon, authenticated;\n`);
console.log(`Migration geschrieben: supabase/migrations/${stamp}_admin_passwort.sql`);
console.log('\nAuf Supabase (SQL Editor) ausführen, damit Online-Testpartien weiter gehen:\n');
console.log(sql);
