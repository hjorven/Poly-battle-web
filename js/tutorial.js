// Tutorial: kurze Lektionen (Lern-Tabs) auf eigenen kleinen Übungskarten.
// Jeder Schritt zeigt auf das, worüber er spricht: ein Feld der Karte (`tile`)
// oder einen Knopf (`el`). Der Text erscheint erst, wenn das Ziel zu sehen ist
// (siehe tutorTick in main.js). Fehlt eine Voraussetzung (`need`), zeigt der
// Schritt stattdessen deren Text, z. B. „Tippe zuerst deinen Krieger an“.
//
// Schritt-Felder:
//   text  Text oder c => Text (c: { st, phone, touch, sel, pending, open, has })
//   el    CSS-Auswahl des Knopfs, auf den der Schritt zeigt
//   tile  st => [q, r]: Feld, zu dem die Kamera fährt und das einen Ring bekommt
//   need  Liste von { when: c => true, wenn die Voraussetzung fehlt; text, el, tile }
//   done  (st, base, c) => true, sobald der Schritt geschafft ist
//   init  st => Werte für `base` beim Schrittbeginn
//   next  Beschriftung des Weiter-Knopfs (Schritte ohne Aufgabe)

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

// --- Lektionen -------------------------------------------------------------------

export const LESSONS = [
  {
    id: 'basics', title: 'Grundlagen', seed: 41001,
    blurb: 'Karte bewegen, Einheit wählen und ziehen, Zug beenden.',
    learn: ['Die Karte verschieben und zoomen', 'Eine Einheit wählen und mit Vorschau ziehen', 'Was der Nebel bedeutet', 'Den Zug beenden'],
    prepare: st => {
      const { warrior } = baseSetup(st);
      return { warrior: warrior.id };
    },
    steps: [
      { text: 'Willkommen! In der Mitte siehst du deine Hauptstadt. Von hier aus baust du dein Reich auf.',
        tile: st => posOf(home(st)), next: 'Weiter' },
      { text: c => c.touch
          ? 'Wische mit einem Finger über die Karte, um sie zu verschieben. Mit zwei Fingern zoomst und drehst du. Probier es aus.'
          : 'Ziehe mit der linken Maustaste, um die Karte zu verschieben. Das Mausrad zoomt, die rechte Maustaste dreht. Probier es aus.',
        next: 'Weiter' },
      { text: c => `In deiner Hauptstadt steht ein Krieger. Tippe ihn an${space(c)}.`,
        tile: st => posOf(tutUnit('warrior')(st)),
        done: (st, b, c) => isSel(c, spot(st, 'warrior')) },
      { text: 'Die hell markierten Felder zeigen, wohin der Krieger ziehen kann. Tippe eins davon an.',
        need: [{ when: c => !isSel(c, spot(c.st, 'warrior')), text: 'Tippe deinen Krieger an.', tile: st => posOf(tutUnit('warrior')(st)) }],
        done: (st, b, c) => (c.pending && c.pending.kind === 'move' && !c.pending.until) || tutUnit('warrior')(st).hasMoved },
      { text: 'Das Feld ist jetzt gelb. Tippe es noch einmal an, dann zieht der Krieger los. So ziehst du nie aus Versehen.',
        need: [
          { when: c => !isSel(c, spot(c.st, 'warrior')), text: 'Tippe deinen Krieger an.', tile: st => posOf(tutUnit('warrior')(st)) },
          { when: c => !(c.pending && c.pending.kind === 'move' && !c.pending.until), text: 'Tippe ein hell markiertes Feld an.' }
        ],
        done: st => tutUnit('warrior')(st).hasMoved },
      { text: 'Rund um deine Einheiten und Städte ist die Karte klar, weiter weg liegt Nebel. Wo du hinziehst, lichtet er sich und du entdeckst Neues.',
        tile: st => posOf(tutUnit('warrior')(st)), next: 'Weiter' },
      { text: 'Dein Krieger ist für diese Runde gezogen. Tippe oben auf „Zug beenden“. Danach sind die Gegner dran.',
        el: '#endTurnBtn',
        done: (st, base) => st.round > base.round },
      { text: 'Runde 2: Du bist wieder am Zug. So geht jede Runde: Einheiten ziehen, Städte nutzen, Zug beenden. Weiter geht es mit der Lektion „Städte“.',
        el: '#round-label', next: 'Fertig' }
    ]
  },
  {
    id: 'cities', title: 'Städte', seed: 41002,
    blurb: 'Sterne, Dörfer einnehmen, Einheiten ausbilden, Städte wachsen lassen.',
    learn: ['Wofür Sterne da sind', 'Ein Dorf einnehmen', 'In der Stadt eine Einheit ausbilden', 'Die Stadt wachsen lassen'],
    prepare: st => {
      const { c, A, warrior } = baseSetup(st);
      moveTo(warrior, A(2));
      st.cities.push({ q: A(3)[0], r: A(3)[1], owner: null, pop: 1, trained: false, isCapital: false });
      st.stars[ME] = 10;
      return { warrior: warrior.id, village: A(3) };
    },
    steps: [
      { text: c => c.has('.tr-inc')
          ? 'Oben links stehen deine Sterne, darunter, wie viele nächste Runde dazukommen. Mit Sternen bezahlst du Einheiten, Gebäude und Forschung.'
          : 'Oben links steht die Zahl deiner Sterne. Mit Sternen bezahlst du Einheiten, Gebäude und Forschung.',
        el: '#treasury', next: 'Weiter' },
      { text: 'Das graue Haus ist ein neutrales Dorf. Wer mit einer Einheit hineinzieht, bekommt es als neue Stadt.',
        tile: tut('village'), next: 'Weiter' },
      { text: 'Tippe das Dorf an, es wird gelb, und tippe es dann noch einmal an.',
        tile: tut('village'),
        need: [{ when: c => !isSel(c, spot(c.st, 'warrior')), text: 'Tippe deinen Krieger an, er steht neben dem Dorf.', tile: st => posOf(tutUnit('warrior')(st)) }],
        done: st => { const [q, r] = spot(st, 'village'); const v = R.cityAt(st, q, r); return !!(v && v.owner === ME); } },
      { text: 'Das Dorf gehört jetzt dir. Jede Stadt bringt dir in jeder Runde Sterne.',
        tile: tut('village'), next: 'Weiter' },
      { text: 'Tippe deine Hauptstadt an.',
        tile: st => posOf(home(st)),
        done: (st, b, c) => cityIsSel(c, home(st)) },
      { text: 'Unten ist jetzt das Stadtmenü. Tippe auf „Krieger“, um einen Krieger auszubilden. Die Kosten stehen auf dem Knopf.',
        el: '[data-train="warrior"]',
        need: [{ when: c => !cityIsSel(c, home(c.st)), text: 'Tippe deine Hauptstadt an.', tile: st => posOf(home(st)) }],
        done: st => home(st).trained },
      { text: 'Der neue Krieger steht in der Stadt und kann sofort ziehen. Jede Stadt kann eine Einheit pro Runde ausbilden.',
        tile: st => posOf(home(st)), next: 'Weiter' },
      { text: 'Mit „Bevölkerung +1“ wächst die Stadt und bringt mehr Sterne pro Runde. Tippe darauf.',
        el: '[data-buypop]',
        need: [{ when: c => !cityIsSel(c, home(c.st)), text: c => R.unitAt(c.st, home(c.st).q, home(c.st).r) ? 'Tippe deine Hauptstadt mehrmals an, bis unten das Stadtmenü erscheint (beim ersten Tippen wählst du den Krieger darin).' : 'Tippe deine Hauptstadt an.', tile: st => posOf(home(st)) }],
        init: st => ({ pop: home(st).pop }),
        done: (st, base) => home(st).pop > base.pop },
      { text: 'Tippe auf „Zug beenden“. Zu Beginn deiner nächsten Runde bekommst du die Sterne aller Städte.',
        el: '#endTurnBtn',
        done: (st, base) => st.round > base.round },
      { text: 'Neue Runde, neue Sterne: Oben links siehst du deinen neuen Stand. Als Nächstes lernst du Forschung und Bauen.',
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
      { text: 'Neue Einheiten und Gebäude schaltest du mit Forschung frei. Tippe oben auf „Forschung“.',
        el: '#techBtn',
        done: (st, b, c) => c.open === 'tech-overlay' },
      { text: 'Das ist der Forschungsbaum. Tippe auf „Landwirtschaft“.',
        el: '.tech-hex[data-tech="farming"]',
        need: [{ when: c => c.open !== 'tech-overlay', text: 'Tippe oben auf „Forschung“.', el: '#techBtn' }],
        done: (st, b, c) => st.techs[ME].includes('farming') || (c.open === 'tech-overlay' && c.has('.tech-hex.selected[data-tech="farming"]')) },
      { text: 'Hier steht, was Landwirtschaft freischaltet und was sie kostet. Tippe auf „Erforschen“.',
        el: '.td-buy',
        need: [
          { when: c => c.open !== 'tech-overlay' && !c.st.techs[ME].includes('farming'), text: 'Tippe oben auf „Forschung“.', el: '#techBtn' },
          { when: c => !c.has('.tech-hex.selected[data-tech="farming"]') && !c.st.techs[ME].includes('farming'), text: 'Tippe auf „Landwirtschaft“.', el: '.tech-hex[data-tech="farming"]' }
        ],
        done: st => st.techs[ME].includes('farming') },
      { text: 'Erforscht! Schließe die Forschung wieder.',
        el: '#techClose',
        done: (st, b, c) => c.open !== 'tech-overlay' },
      { text: 'Tippe deine Hauptstadt an.',
        tile: st => posOf(home(st)),
        done: (st, b, c) => cityIsSel(c, home(st)) || c.open === 'build-overlay' },
      { text: 'Tippe unten auf „Ausbauen“.',
        el: '[data-build-open]',
        need: [{ when: c => !cityIsSel(c, home(c.st)), text: 'Tippe deine Hauptstadt an.', tile: st => posOf(home(st)) }],
        done: (st, b, c) => c.open === 'build-overlay' },
      { text: 'Das ist dein Stadtgebiet. Orange umrandete Felder kannst du jetzt bebauen, das weiß umrandete ist gewählt. Tippe auf „Farm“. Auf dem Knopf steht, wie viele Sterne sie pro Runde mehr bringt.',
        el: '.bopt[data-opt]:not([disabled])',
        need: [
          { when: c => c.open !== 'build-overlay', text: 'Tippe deine Hauptstadt an und dann „Ausbauen“.', tile: st => posOf(home(st)) },
          { when: c => !c.has('.bopt[data-opt]:not([disabled])'), text: 'Tippe ein orange umrandetes Feld an.', el: '.b3-tag.can, .bhex.can' }
        ],
        init: st => ({ imps: Object.keys(st.improvements).length }),
        done: (st, base) => Object.keys(st.improvements).length > base.imps },
      { text: 'Die Farm steht. Gebäude bringen in jeder Runde Sterne und lassen die Stadt wachsen. Welche du bauen kannst, hängt von deiner Forschung ab.',
        next: 'Fertig' }
    ]
  },
  {
    id: 'combat', title: 'Kampf', seed: 41004,
    blurb: 'Angriffsvorschau, angreifen und bedrohte Städte verteidigen.',
    learn: ['Den roten Ring um bedrohte Städte erkennen', 'Mit Vorschau angreifen', 'Die Stadt mit einem Verteidiger schützen'],
    prepare: st => {
      const { A, warrior } = baseSetup(st);
      moveTo(warrior, A(1));
      const foe = addUnit(st, 'player_2', 'warrior', A(2));
      st.stars[ME] = 6;
      return { warrior: warrior.id, foe: foe.id };
    },
    steps: [
      { text: 'Hier steht ein feindlicher Krieger, nur zwei Felder vor deiner Hauptstadt. Der rote Ring um die Stadt zeigt: Er könnte sie im nächsten Zug angreifen.',
        tile: st => posOf(tutUnit('foe')(st)), next: 'Weiter' },
      { text: 'Tippe deinen Krieger an. Rot markiert sind die Gegner, die er angreifen kann.',
        tile: st => posOf(tutUnit('warrior')(st)),
        done: (st, b, c) => isSel(c, spot(st, 'warrior')) },
      { text: 'Tippe den Gegner an. Die Vorschau zeigt, wie viel Schaden du machst und wie stark er zurückschlägt.',
        tile: st => posOf(tutUnit('foe')(st)),
        need: [{ when: c => !isSel(c, spot(c.st, 'warrior')), text: 'Tippe deinen Krieger an.', tile: st => posOf(tutUnit('warrior')(st)) }],
        done: (st, b, c) => { const f = tutUnit('foe')(st); return !f || f.hp < 10 || pendingOn(c, 'attack', f.q, f.r); } },
      { text: 'Tippe den Gegner noch einmal an, um anzugreifen.',
        tile: st => posOf(tutUnit('foe')(st)),
        need: [
          { when: c => !isSel(c, spot(c.st, 'warrior')), text: 'Tippe deinen Krieger an.', tile: st => posOf(tutUnit('warrior')(st)) },
          { when: c => { const f = tutUnit('foe')(c.st); return !!f && !pendingOn(c, 'attack', f.q, f.r); }, text: 'Tippe den Gegner an.', tile: st => posOf(tutUnit('foe')(st)) }
        ],
        done: st => { const f = tutUnit('foe')(st); return !f || f.hp < 10; } },
      { text: 'Treffer! Der Gegner hat Leben verloren, dein Krieger durch den Gegenschlag vielleicht auch. Wer angreift, trifft meist härter, als er zurückbekommt.',
        tile: st => posOf(tutUnit('foe')(st) || tutUnit('warrior')(st)), next: 'Weiter' },
      { text: 'Schütze die Stadt: Tippe auf „Krieger“, um einen Verteidiger auszubilden. In der eigenen Stadt hält er mehr aus.',
        el: '[data-train="warrior"]',
        need: [{ when: c => !cityIsSel(c, home(c.st)), text: 'Tippe deine Hauptstadt an.', tile: st => posOf(home(st)) }],
        done: st => home(st).trained },
      { text: 'Tippe auf „Zug beenden“. Jetzt ist der Gegner dran und schlägt vielleicht zurück.',
        el: '#endTurnBtn',
        done: (st, base) => st.round > base.round },
      { text: 'Gut gemacht. Merke dir: Erst tippen zeigt die Vorschau, nochmal tippen greift an. Und sobald ein roter Ring um eine Stadt erscheint, stell einen Verteidiger hinein.',
        next: 'Fertig' }
    ]
  },
  {
    id: 'explore', title: 'Erkunden und Hilfen', seed: 41005,
    blurb: 'Ruinen erkunden und die Hilfen im Spiel kennenlernen.',
    learn: ['Eine Ruine erkunden', 'Mit dem Bereit-Knopf zur nächsten Einheit springen', 'Übersicht und Tipp nutzen', 'Wo die Anleitung steht'],
    prepare: st => {
      const { A, B1, warrior } = baseSetup(st);
      moveTo(warrior, A(1));
      st.ruins[hk(...A(2))] = true;
      const second = addUnit(st, ME, 'warrior', B1);
      return { warrior: warrior.id, second: second.id, ruin: A(2) };
    },
    steps: [
      { text: 'Die Steinsäulen sind eine Ruine. Wer hineinzieht, findet etwas: Sterne, eine Technologie, eine Einheit oder mehr.',
        tile: tut('ruin'), next: 'Weiter' },
      { text: 'Tippe die Ruine an und dann noch einmal, um hineinzuziehen.',
        tile: tut('ruin'),
        need: [{ when: c => !isSel(c, spot(c.st, 'warrior')), text: 'Tippe den Krieger neben der Ruine an.', tile: st => posOf(tutUnit('warrior')(st)) }],
        done: st => !st.ruins[hk(...spot(st, 'ruin'))] },
      { text: c => `Was du gefunden hast, stand in der Meldung. Der Knopf mit dem gelben Punkt oben zeigt, wie viele Einheiten noch handeln können. Tippe ihn an${space(c)}, um zur nächsten zu springen.`,
        el: '#idleBtn',
        done: (st, b, c) => isSel(c, spot(st, 'second')) },
      { text: 'Der Bildschirm springt zu dieser Einheit. So vergisst du keine. Unter „Übersicht“ siehst du alle Städte, Einheiten und Gegner. Tippe darauf.',
        el: '#overviewBtn',
        done: (st, b, c) => c.open === 'overview-overlay' },
      { text: 'Oben wechselst du zwischen Städten, Armee, Diplomatie und Monumenten. Schließe die Übersicht wieder.',
        el: '#overviewClose',
        done: (st, b, c) => c.open !== 'overview-overlay' },
      { text: 'Wenn du nicht weiterweißt: „Tipp“ zeigt, was die KI an deiner Stelle tun würde. Probier es aus.',
        el: '#coachBtn',
        done: (st, b, c) => c.has('#coach') },
      { text: 'Alle Regeln, zum Beispiel zu Brücken, Leuchttürmen und Monumenten, stehen im „Menü“ unter „Anleitung“. Damit hast du alle Lektionen. Viel Erfolg!',
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
