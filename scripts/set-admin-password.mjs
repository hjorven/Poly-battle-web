// Neues Admin-Passwort setzen: schreibt nur den Prüfwert nach js/admin.js
// (kein Klartext im Code). Aufruf: npm run admin-passwort -- "dein Passwort"
// Danach committen und veröffentlichen; im Browser einmal neu freischalten.

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
