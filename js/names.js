// Spielernamen prüfen. Dieselbe Prüfung läuft auf dem Server
// (public.pb_check_name in supabase/migrations); hier nur, damit man beim
// Tippen sofort sieht, ob ein Name geht. Beide Wortlisten müssen gleich
// bleiben (test/logic.test.js vergleicht sie).

// Nicht erlaubt: Beleidigungen, Rassismus, NS-Bezüge, Sexuelles und Namen,
// die nach Spielleitung aussehen. Teilwörter genügen („fick“ trifft „Fickfrosch“).
export const BAD_WORDS = [
  'arsch', 'fick', 'fck', 'hure', 'nutte', 'fotze', 'wichser', 'wixer', 'schlampe', 'scheis', 'pimmel', 'titten',
  'spast', 'behindert', 'missgeburt', 'schwuchtel', 'vergewalt',
  'nigg', 'neger', 'kanak', 'kanack', 'zigeuner', 'judensau',
  'nazi', 'hitler', 'siegheil', 'endsieg', 'hakenkreuz', 'auschwitz', 'holocaust', 'gaskammer', 'kkk',
  'fuck', 'shit', 'bitch', 'cunt', 'whore', 'slut', 'faggot', 'retard', 'wanker', 'asshole',
  'penis', 'vagina', 'porn', 'pussy',
  'admin', 'moderator', 'support', 'entwickler', 'offiziell', 'official'
];

// Harmlose Wörter, die ein verbotenes enthalten (Marschall, Barsch, Shiitake).
export const OK_WORDS = ['marsch', 'barsch', 'harsch', 'shitake', 'scunthorpe'];

const ALLOWED = /^[A-Za-z0-9ÄÖÜäöüß _-]+$/;
const DIGITS = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', 'ä': 'a', 'ö': 'o', 'ü': 'u', 'ß': 's' };

// Name zum Vergleich vereinfachen: klein, ohne Trennzeichen, „ph“ als „f“,
// Ziffern als Buchstaben (die 1 einmal als i, einmal als l).
export function nameForms(name) {
  const base = String(name || '').toLowerCase().replace(/[\s_-]/g, '').replace(/ph/g, 'f');
  const forms = [];
  for (const one of ['i', 'l']) {
    let k = '';
    for (const ch of base) k += ch === '1' ? one : (DIGITS[ch] || ch);
    for (const ok of OK_WORDS) k = k.split(ok).join('|');
    // Doppelte Buchstaben zusammengezogen (fiiick → fick).
    let plain = k.replace(/(.)\1+/g, '$1');
    for (const ok of OK_WORDS) plain = plain.split(ok).join('|');
    forms.push(k, plain);
  }
  return forms;
}

// Fehlermeldung oder null.
export function checkName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (n.length < 3 || n.length > 16) return 'Der Name muss 3 bis 16 Zeichen lang sein';
  if (!ALLOWED.test(n)) return 'Erlaubt sind Buchstaben, Ziffern, Leerzeichen, _ und -';
  if (n.replace(/[\s_-]/g, '').includes('1488')) return 'Dieser Name ist nicht erlaubt';
  const forms = nameForms(n);
  if (BAD_WORDS.some(w => forms.some(f => f.includes(w)))) return 'Dieser Name ist nicht erlaubt';
  return null;
}
