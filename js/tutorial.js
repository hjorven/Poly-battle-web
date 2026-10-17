// Tutorial: kurze Lektionen (Lern-Tabs) auf eigenen kleinen Übungskarten.
// Jeder Schritt zeigt auf das, worüber er spricht: ein Feld der Karte (`tile`)
// oder einen Knopf (`el`). Der Text erscheint erst, wenn das Ziel zu sehen ist
// (siehe tutorTick in main.js). Fehlt eine Voraussetzung (`need`), zeigt der
// Schritt stattdessen deren Text, z. B. „Tippe zuerst deinen Krieger an“.
//
// Schritt-Felder:
//   text  Text oder c => Text (c: { st, phone, touch, sel, pending, open, has, exists, cam })
//   el    CSS-Auswahl des Knopfs, auf den der Schritt zeigt (oder c => Auswahl)
//   tile  st => [q, r]: Feld, zu dem die Kamera fährt und das einen Ring bekommt
//   need  Liste von { when: c => true, wenn die Voraussetzung fehlt; text, el, tile }
//   done  (st, base, c) => true, sobald der Schritt geschafft ist
//   init  st => Werte für `base` beim Schrittbeginn
//   skip  c => true: Schritt auslassen (z. B. Knopf auf diesem Gerät nicht da)
//   next  Beschriftung des Weiter-Knopfs (mit `done` zum Überspringen)

import * as R from './rules.js';
import { DIRS, hk, hexDistance, inBounds } from './hex.js';
import { MAP_W, MAP_H } from './config.js';

const ME = 'player_1';

const home = st => st.cities.find(c => c.owner === ME && c.isCapital);
const unitById = (st, id) => st.units.find(u => u.id === id);
const isSel = (c, id) => !!(c.sel && c.sel.kind === 'unit' && c.sel.id === id);
const cityIsSel = (c, city) => !!(city && c.sel && c.sel.kind === 'city' && c.sel.q === city.q && c.sel.r === city.r);
const pendingOn = (c, kind, q, r) => !!(c.pending && c.pending.kind === kind && !c.pending.until && c.pending.key === hk(q, r));
const space = c => c.touch ? '' : ' (oder drücke die Leertaste)';

// Feste Plätze der Lektion: Hauptstadt und Felder in einer Richtung davon.
const spot = (st, key) => st.tutorial && st.tutorial.spots ? st.tutorial.spots[key] : null;
const tut = key => st => spot(st, key);
const tutUnit = key => st => { const id = spot(st, key); return id ? unitById(st, id) : null; };
const posOf = u => u ? [u.q, u.r] : null;

// Kamera-Übungen: Ausgangsstand merken, sobald die Kamera ruht, dann auf eine
// deutliche Änderung warten.
const camDone = test => (st, base, c) => {
  const s = c.cam;
  if (!s) return false;
  if (!base.cam) { if (!s.moving) base.cam = { x: s.x, z: s.z, dist: s.dist, az: s.az }; return false; }
  return !s.moving && test(s, base.cam);
};
const moved = (s, b) => Math.sqrt((s.x - b.x) ** 2 + (s.z - b.z) ** 2) > 2.5;
const zoomed = (s, b) => Math.abs(s.dist / b.dist - 1) > 0.2;
const turned = (s, b) => { const d = Math.abs(s.az - b.az) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d) > 0.35; };

// --- Aufbau der Übungskarte ------------------------------------------------------

// Richtung von der Hauptstadt, in der am meisten Platz bis zum Kartenrand ist.
function roomyDir(c) {
  let best = 0, bestRoom = -1;
  DIRS.forEach(([dq, dr], i) => {
    let k = 0;
    while (k < 6 && inBounds(c.q + dq * (k + 1), c.r + dr * (k + 1))) k++;
    // Mitte der Karte bevorzugen: dort ist am meisten Land.
    const q = c.q + dq * 3, r = c.r + dr * 3;
    const centre = -hexDistance(q, r, Math.floor(MAP_W / 2 - MAP_H / 4), Math.floor(MAP_H / 2));
    const room = k * 100 + centre;
    if (room > bestRoom) { bestRoom = room; best = i; }
  });
  return best;
}

// Feld frei räumen: Feld-Gelände, keine Rohstoffe, Ruinen, Gebäude, Einheiten.
function clearTile(st, q, r) {
  const k = hk(q, r);
  st.terrain[r * MAP_W + q] = 'field';
  delete st.resources[k];
  delete st.ruins[k];
  delete st.improvements[k];
  if (st.bridges) delete st.bridges[k];
  if (st.camps) delete st.camps[k];
  st.units = st.units.filter(u => u.q !== q || u.r !== r);
}

// Gemeinsamer Aufbau: Umgebung der Hauptstadt begehbar, keine Ablenkung
// (fremde Dörfer, Ruinen) in Sichtweite, Plätze A1–A3 in einer Richtung.
function baseSetup(st) {
  const c = home(st);
  const d = DIRS[roomyDir(c)];
  const side = DIRS[(roomyDir(c) + 1) % 6];
  const A = k => [c.q + d[0] * k, c.r + d[1] * k];
  const B1 = [c.q + side[0], c.r + side[1]];
  // Alles in Sichtweite außer der eigenen Hauptstadt aufräumen.
  st.cities = st.cities.filter(x => x === c || x.owner || hexDistance(x.q, x.r, c.q, c.r) > 5);
  for (const k of Object.keys(st.ruins)) { const [q, r] = k.split(',').map(Number); if (hexDistance(q, r, c.q, c.r) <= 5) delete st.ruins[k]; }
  for (const [q, r] of [A(1), A(2), A(3), B1]) clearTile(st, q, r);
  const warrior = st.units.find(u => u.owner === ME);
  return { c, A, B1, warrior };
}

function moveTo(u, [q, r]) {
  u.q = q; u.r = r;
}

let seq = 0;
function addUnit(st, owner, type, [q, r]) {
  const u = { id: `tut_${owner.replace('_', '')}_${seq++}`, owner, type, q, r, hp: R.maxHp(type), mp: R.maxMove(st, owner, type), hasMoved: false, acted: false };
  st.units.push(u);
  return u;
}

// Leben des Gegners in der Lektion „Kampf“.
const FOE_HP = 7;

// --- Lektionen -------------------------------------------------------------------

export const LESSONS = [
  {
    id: 'basics', title: 'Grundlagen', seed: 41001,
    blurb: 'Ziel des Spiels, Karte bewegen, Einheiten verstehen und ziehen.',
    learn: ['Wie man gewinnt', 'Karte verschieben, zoomen und drehen', 'Was die Zahlen einer Einheit bedeuten', 'Eine Einheit ziehen und den Zug beenden'],
    prepare: st => {
      const { warrior } = baseSetup(st);
      return { warrior: warrior.id };
    },
    steps: [
      { text: 'Ziel: Nimm den Gegnern alle Städte ab. Wer als Letzter Städte hat, gewinnt. Hier ist deine Hauptstadt.',
        tile: st => posOf(home(st)), next: 'Weiter' },
      { text: c => c.touch ? 'Wische mit einem Finger über die Karte, um sie zu verschieben.' : 'Ziehe mit gedrückter linker Maustaste, um die Karte zu verschieben (oder Pfeiltasten).',
        done: camDone(moved), next: 'Überspringen' },
      { text: c => c.touch ? 'Zoome mit zwei Fingern: auseinander oder zusammen.' : 'Zoome mit dem Mausrad (oder + und −).',
        done: camDone(zoomed), next: 'Überspringen' },
      { text: c => c.touch
          ? `Drehe die Karte: zwei Finger gemeinsam seitlich ziehen${c.has('[data-cam="rotL"]') ? ' oder die runden Pfeile antippen' : ''}.`
          : 'Drehe die Karte mit gedrückter rechter Maustaste (oder Q und E).',
        el: c => c.touch && c.has('[data-cam="rotL"]') ? '[data-cam="rotL"], [data-cam="rotR"]' : null,
        done: camDone(turned), next: 'Überspringen' },
      { text: c => c.touch ? 'Gut! „N“ holt die Ansicht jederzeit zurück.' : 'Gut! „N“ (Knopf oder Taste) holt die Ansicht jederzeit zurück.',
        el: '[data-cam="reset"]', skip: c => !c.has('[data-cam="reset"]'), next: 'Weiter' },
      { text: c => `Tippe deinen Krieger an${space(c)}.`,
        tile: st => posOf(tutUnit('warrior')(st)),
        done: (st, b, c) => isSel(c, spot(st, 'warrior')) },
      { text: 'Herz: Leben. Schwert: Angriff. Schild: Verteidigung. Stiefel: Schritte, die er noch hat.',
        el: '#anchor-tag .at-stats',
        need: [{ when: c => !isSel(c, spot(c.st, 'warrior')), text: 'Tippe deinen Krieger an.', tile: st => posOf(tutUnit('warrior')(st)) }],
        next: 'Weiter' },
      { text: 'Hell markiert: Dorthin kann er ziehen. Tippe ein Feld an.',
        need: [{ when: c => !isSel(c, spot(c.st, 'warrior')), text: 'Tippe deinen Krieger an.', tile: st => posOf(tutUnit('warrior')(st)) }],
        done: (st, b, c) => (c.pending && c.pending.kind === 'move' && !c.pending.until) || tutUnit('warrior')(st).hasMoved },
      { text: 'Nochmal tippen, dann zieht er los.',
        need: [
          { when: c => !isSel(c, spot(c.st, 'warrior')), text: 'Tippe deinen Krieger an.', tile: st => posOf(tutUnit('warrior')(st)) },
          { when: c => !(c.pending && c.pending.kind === 'move' && !c.pending.until), text: 'Tippe ein hell markiertes Feld an.' }
        ],
        done: st => tutUnit('warrior')(st).hasMoved },
      { text: 'Im Nebel liegt Unbekanntes. Wo du hinziehst, wird es klar.',
        tile: st => posOf(tutUnit('warrior')(st)), next: 'Weiter' },
      { text: 'Tippe auf „Zug beenden“. Dann sind die Gegner dran.',
        el: '#endTurnBtn',
        done: (st, base) => st.round > base.round },
      { text: 'Runde 2. So geht jede Runde: ziehen, Städte nutzen, Zug beenden.',
        el: '#round-label', next: 'Fertig' }
    ]
  },
  {
    id: 'cities', title: 'Städte', seed: 41002,
    blurb: 'Sterne, Dörfer einnehmen, Einheiten ausbilden, Städte wachsen lassen.',
    learn: ['Wofür Sterne da sind', 'Ein Dorf einnehmen', 'Was Stufe und Einkommen einer Stadt bedeuten', 'Einheiten ausbilden und die Stadt wachsen lassen'],
    prepare: st => {
      const { c, A, warrior } = baseSetup(st);
      moveTo(warrior, A(2));
      st.cities.push({ q: A(3)[0], r: A(3)[1], owner: null, pop: 1, trained: false, isCapital: false });
      st.stars[ME] = 10;
      return { warrior: warrior.id, village: A(3) };
    },
    steps: [
      { text: c => c.has('.tr-inc') ? 'Oben links: deine Sterne und was nächste Runde dazukommt. Damit bezahlst du alles.' : 'Oben links: deine Sterne. Damit bezahlst du alles.',
        el: '#treasury', next: 'Weiter' },
      { text: 'Das graue Haus ist ein freies Dorf. Tippe es zweimal an, dann zieht dein Krieger hinein und es gehört dir.',
        tile: tut('village'),
        need: [{ when: c => !isSel(c, spot(c.st, 'warrior')), text: 'Tippe deinen Krieger neben dem Dorf an.', tile: st => posOf(tutUnit('warrior')(st)) }],
        done: st => { const [q, r] = spot(st, 'village'); const v = R.cityAt(st, q, r); return !!(v && v.owner === ME); } },
      { text: 'Geschafft, das ist jetzt deine Stadt. Tippe deine Hauptstadt an.',
        tile: st => posOf(home(st)),
        done: (st, b, c) => cityIsSel(c, home(st)) },
      { text: 'Stufe: Größe der Stadt. „+ pro Runde“: Sterne, die sie dir bringt.',
        el: '#anchor-tag .at-lvl, #anchor-tag .at-inc',
        need: [{ when: c => !cityIsSel(c, home(c.st)), text: 'Tippe deine Hauptstadt an.', tile: st => posOf(home(st)) }],
        next: 'Weiter' },
      { text: 'Tippe auf „Krieger“, um einen auszubilden. Der Preis steht darauf.',
        el: '[data-train="warrior"]',
        need: [{ when: c => !cityIsSel(c, home(c.st)), text: 'Tippe deine Hauptstadt an.', tile: st => posOf(home(st)) }],
        done: st => home(st).trained },
      { text: 'Neue Einheiten dürfen sofort ziehen. Jede Stadt bildet eine pro Runde aus.',
        tile: st => posOf(home(st)), next: 'Weiter' },
      { text: '„Bevölkerung +1“: mehr Sterne pro Runde und eine Belohnung. Tippe darauf.',
        el: '[data-buypop]',
        need: [{ when: c => !cityIsSel(c, home(c.st)), text: c => R.unitAt(c.st, home(c.st).q, home(c.st).r) ? 'Tippe die Hauptstadt so oft an, bis unten das Stadtmenü kommt.' : 'Tippe deine Hauptstadt an.', tile: st => posOf(home(st)) }],
        init: st => ({ pop: home(st).pop }),
        done: (st, base) => home(st).pop > base.pop },
      { text: c => `Neue Stufe! Tippe auf den grünen Knopf „Stufe ${R.pendingLevel(home(c.st)) || ''}“ und such dir eine Belohnung aus.`,
        el: '[data-reward-open]',
        skip: c => !R.pendingLevel(home(c.st)),
        need: [{ when: c => !cityIsSel(c, home(c.st)), text: 'Tippe deine Hauptstadt an.', tile: st => posOf(home(st)) }],
        done: st => !R.pendingLevel(home(st)) },
      { text: 'Tippe auf „Zug beenden“. Zu Beginn deiner nächsten Runde gibt es Sterne.',
        el: '#endTurnBtn',
        done: (st, base) => st.round > base.round },
      { text: 'Neue Sterne sind da, siehe oben links. Weiter mit „Forschung und Bauen“.',
        el: '#treasury', next: 'Fertig' }
    ]
  },
  {
    id: 'build', title: 'Forschung und Bauen', seed: 41003,
    blurb: 'Technologien erforschen und Gebäude in der Stadt bauen.',
    learn: ['Die Forschung öffnen', 'Landwirtschaft erforschen', 'Eine Farm im Stadtgebiet bauen'],
    prepare: st => {
      const { A, warrior } = baseSetup(st);
      moveTo(warrior, A(2));
      st.stars[ME] = 20;
      return { warrior: warrior.id };
    },
    steps: [
      { text: 'Forschung schaltet neue Einheiten und Gebäude frei. Tippe auf „Forschung“.',
        el: '#techBtn',
        done: (st, b, c) => c.open === 'tech-overlay' },
      { text: 'Tippe auf „Landwirtschaft“.',
        el: '.tech-hex[data-tech="farming"]',
        need: [{ when: c => c.open !== 'tech-overlay', text: 'Tippe auf „Forschung“.', el: '#techBtn' }],
        done: (st, b, c) => st.techs[ME].includes('farming') || (c.open === 'tech-overlay' && c.has('.tech-hex.selected[data-tech="farming"]')) },
      { text: 'Hier stehen Nutzen und Preis. Tippe auf „Erforschen“.',
        el: '.td-buy',
        need: [
          { when: c => c.open !== 'tech-overlay' && !c.st.techs[ME].includes('farming'), text: 'Tippe auf „Forschung“.', el: '#techBtn' },
          { when: c => !c.has('.tech-hex.selected[data-tech="farming"]') && !c.st.techs[ME].includes('farming'), text: 'Tippe auf „Landwirtschaft“.', el: '.tech-hex[data-tech="farming"]' }
        ],
        done: st => st.techs[ME].includes('farming') },
      { text: 'Erforscht! Schließe die Forschung.',
        el: '#techClose',
        done: (st, b, c) => c.open !== 'tech-overlay' },
      { text: 'Tippe deine Hauptstadt an.',
        tile: st => posOf(home(st)),
        done: (st, b, c) => cityIsSel(c, home(st)) || c.open === 'build-overlay' },
      { text: 'Tippe auf „Ausbauen“.',
        el: '[data-build-open]',
        need: [{ when: c => !cityIsSel(c, home(c.st)), text: 'Tippe deine Hauptstadt an.', tile: st => posOf(home(st)) }],
        done: (st, b, c) => c.open === 'build-overlay' },
      { text: 'Orange Felder kannst du bebauen, das weiße ist gewählt. Tippe auf „Farm“.',
        el: '.bopt[data-opt]:not([disabled])',
        need: [
          { when: c => c.open !== 'build-overlay', text: 'Tippe deine Hauptstadt an und dann „Ausbauen“.', tile: st => posOf(home(st)) },
          { when: c => !c.exists('.bopt[data-opt]:not([disabled])'), text: 'Tippe ein orange umrandetes Feld an.', el: '.b3-tag.can, .bhex.can' }
        ],
        init: st => ({ imps: Object.keys(st.improvements).length }),
        done: (st, base) => Object.keys(st.improvements).length > base.imps },
      { text: 'Die Farm steht. Gebäude bringen Sterne und lassen die Stadt wachsen.',
        next: 'Fertig' }
    ]
  },
  {
    id: 'combat', title: 'Kampf', seed: 41004,
    blurb: 'Angriffsvorschau, angreifen und bedrohte Städte verteidigen.',
    learn: ['Mit Vorschau angreifen', 'Den roten Ring um bedrohte Städte verstehen', 'Die Stadt mit einem Verteidiger schützen'],
    prepare: st => {
      const { A, warrior } = baseSetup(st);
      moveTo(warrior, A(1));
      const foe = addUnit(st, 'player_2', 'warrior', A(2));
      // Schon angeschlagen: So trifft der eigene Angriff sichtbar härter als
      // der Gegenschlag, und der Krieger überlebt den Gegenzug.
      foe.hp = FOE_HP;
      st.stars[ME] = 6;
      return { warrior: warrior.id, foe: foe.id };
    },
    steps: [
      { text: 'Ein Gegner, nur zwei Felder vor deiner Hauptstadt!',
        tile: st => posOf(tutUnit('foe')(st)), next: 'Weiter' },
      { text: 'Tippe deinen Krieger an. Rot markiert: Gegner, die er angreifen kann.',
        tile: st => posOf(tutUnit('warrior')(st)),
        done: (st, b, c) => isSel(c, spot(st, 'warrior')) },
      { text: 'Tippe den Gegner an. Die Vorschau zeigt den Schaden für beide.',
        tile: st => posOf(tutUnit('foe')(st)),
        need: [{ when: c => !isSel(c, spot(c.st, 'warrior')), text: 'Tippe deinen Krieger an.', tile: st => posOf(tutUnit('warrior')(st)) }],
        done: (st, b, c) => { const f = tutUnit('foe')(st); return !f || f.hp < FOE_HP || pendingOn(c, 'attack', f.q, f.r); } },
      { text: 'Nochmal tippen: Angriff!',
        tile: st => posOf(tutUnit('foe')(st)),
        need: [
          { when: c => !isSel(c, spot(c.st, 'warrior')), text: 'Tippe deinen Krieger an.', tile: st => posOf(tutUnit('warrior')(st)) },
          { when: c => { const f = tutUnit('foe')(c.st); return !!f && !pendingOn(c, 'attack', f.q, f.r); }, text: 'Tippe den Gegner an.', tile: st => posOf(tutUnit('foe')(st)) }
        ],
        done: st => { const f = tutUnit('foe')(st); return !f || f.hp < FOE_HP; } },
      { text: 'Treffer! Wer angreift, trifft meist härter, als er zurückbekommt.',
        tile: st => posOf(tutUnit('foe')(st) || tutUnit('warrior')(st)), next: 'Weiter' },
      { text: 'Stell einen Verteidiger in die Stadt: Tippe auf „Krieger“.',
        el: '[data-train="warrior"]',
        need: [{ when: c => !cityIsSel(c, home(c.st)), text: 'Tippe deine Hauptstadt an.', tile: st => posOf(home(st)) }],
        done: st => home(st).trained },
      { text: 'Tippe auf „Zug beenden“. Jetzt ist der Gegner dran.',
        el: '#endTurnBtn',
        done: (st, base) => st.round > base.round },
      { text: 'Merke: Ein roter Ring um deine Stadt heißt Gefahr. Stell dann einen Verteidiger hinein.',
        next: 'Fertig' }
    ]
  },
  {
    id: 'explore', title: 'Erkunden und Hilfen', seed: 41005,
    blurb: 'Ruinen erkunden und die Hilfen im Spiel kennenlernen.',
    learn: ['Eine Ruine erkunden', 'Zur nächsten Einheit springen', 'Übersicht und Tipp nutzen', 'Wo Anleitung und Spielhinweise stehen'],
    prepare: st => {
      const { A, B1, warrior } = baseSetup(st);
      moveTo(warrior, A(1));
      st.ruins[hk(...A(2))] = true;
      const second = addUnit(st, ME, 'warrior', B1);
      return { warrior: warrior.id, second: second.id, ruin: A(2) };
    },
    steps: [
      { text: 'Die Steinsäulen sind eine Ruine mit Belohnung. Tippe sie zweimal an, um hineinzuziehen.',
        tile: tut('ruin'),
        need: [{ when: c => !isSel(c, spot(c.st, 'warrior')), text: 'Tippe den Krieger neben der Ruine an.', tile: st => posOf(tutUnit('warrior')(st)) }],
        done: st => !st.ruins[hk(...spot(st, 'ruin'))] },
      { text: c => `Der Knopf mit dem gelben Punkt springt zur nächsten Einheit, die noch ziehen kann. Tippe ihn an${space(c)}.`,
        el: '#idleBtn',
        // Hat der zweite Krieger schon gezogen, gibt es nichts mehr anzuspringen.
        skip: c => { const u = tutUnit('second')(c.st); return !u || u.hasMoved || u.acted; },
        done: (st, b, c) => isSel(c, spot(st, 'second')) },
      { text: '„Übersicht“ zeigt alle Städte, Einheiten und Gegner. Tippe darauf.',
        el: '#overviewBtn',
        done: (st, b, c) => c.open === 'overview-overlay' },
      { text: 'Schließe die Übersicht wieder.',
        el: '#overviewClose',
        done: (st, b, c) => c.open !== 'overview-overlay' },
      { text: '„Tipp“ zeigt, was die KI jetzt tun würde. Probier es aus.',
        el: '#coachBtn',
        done: (st, b, c) => c.has('#coach') },
      { text: 'Alle Regeln stehen im „Menü“ unter „Anleitung“. Unter „Spielen“ schaltest du dort die Spielhinweise an oder aus. Viel Erfolg!',
        el: '#menuBtn', next: 'Fertig' }
    ]
  }
];

export function lessonById(id) {
  return LESSONS.find(l => l.id === id) || null;
}

// Übungskarte für eine Lektion vorbereiten (nach R.createGame).
export function prepareLesson(state, lesson) {
  seq = 0;
  const spots = lesson.prepare(state) || {};
  state.tutorial = { lesson: lesson.id, step: 0, base: { round: state.round }, spots };
  R.updateExplored(state, ME);
  return state;
}

// Erledigte Lektionen (nur in diesem Browser).
const DONE_KEY = 'pb_tutorial_v1';
export function doneLessons() {
  try { const v = JSON.parse(localStorage.getItem(DONE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
export function markDone(id) {
  try { const d = doneLessons(); if (!d.includes(id)) localStorage.setItem(DONE_KEY, JSON.stringify([...d, id])); } catch (e) { /* ignore */ }
}
