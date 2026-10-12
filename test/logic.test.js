import assert from 'node:assert';
import * as R from '../js/rules.js';
import {
  UNITS, TERRAIN, MAP_W, MAP_H, START_STARS, MAX_POP, TRIBES,
  RESOURCES, IMPROVEMENTS
} from '../js/config.js';
import { hk, hexDistance, neighbors, inBounds } from '../js/hex.js';
import { botStep } from '../js/ai.js';
import { saveGame, loadGame, saveInfo, clearSave } from '../js/save.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL  ' + name + '\n      ' + e.message);
  }
}

function flood(state, sq, sr) {
  const seen = new Set([hk(sq, sr)]);
  const queue = [[sq, sr]];
  while (queue.length) {
    const [q, r] = queue.shift();
    for (const [nq, nr] of neighbors(q, r)) {
      const k = hk(nq, nr);
      if (seen.has(k)) continue;
      const def = TERRAIN[R.terrainAt(state, nq, nr)];
      if (!def.walkable || def.enterTech) continue;
      seen.add(k);
      queue.push([nq, nr]);
    }
  }
  return seen;
}

function assertInvariants(state) {
  const seen = new Set();
  for (const u of state.units) {
    assert.ok(inBounds(u.q, u.r), 'unit out of bounds');
    const tile = R.terrainAt(state, u.q, u.r);
    assert.ok(TERRAIN[tile].walkable, 'unit on unwalkable tile');
    const k = hk(u.q, u.r);
    assert.ok(!seen.has(k), 'two units on same tile: ' + k);
    seen.add(k);
    assert.ok(u.hp >= 1 && u.hp <= UNITS[u.type].hp, 'hp out of range');
    assert.ok(UNITS[u.type], 'unknown unit type');
    assert.ok(state.stars[u.owner] >= 0, 'negative stars');
  }
  for (const c of state.cities) {
    assert.ok(inBounds(c.q, c.r), 'city out of bounds');
    assert.ok(TERRAIN[R.terrainAt(state, c.q, c.r)].walkable, 'city unwalkable');
    assert.ok(c.pop >= 1 && c.pop <= MAX_POP, 'city pop out of range');
    const ownerOk = c.owner === null || (state.players || []).includes(c.owner);
    assert.ok(ownerOk, 'bad owner: ' + c.owner);
  }
}

function makeState() {
  return {
    terrain: Array(MAP_W * MAP_H).fill('field'),
    cities: [], units: [], resources: {}, improvements: {},
    players: ['player_1', 'player_2', 'player_3', 'player_4'],
    stars: { player_1: 20, player_2: 20, player_3: 20, player_4: 20 },
    techs: {
      player_1: ['basic'], player_2: ['basic'],
      player_3: ['basic'], player_4: ['basic']
    },
    turn: 'player_1', round: 1, winner: null
  };
}

function unit(id, owner, type, q, r, extra = {}) {
  return {
    id, owner, type, q, r,
    hp: UNITS[type].hp, mp: UNITS[type].move,
    hasMoved: false, acted: false, ...extra
  };
}

console.log('\n-- Erzeugung --');

test('createGame: Grundinvarianten über mehrere Seeds', () => {
  for (let i = 0; i < 12; i++) {
    const st = R.createGame(1000 + i);
    assertInvariants(st);
    assert.strictEqual(st.terrain.length, MAP_W * MAP_H);
    assert.strictEqual(st.players.length, 4, '4 Spieler');
    assert.ok(st.cities.length >= st.players.length + 3, 'min Städte, got ' + st.cities.length);
    const tribes = new Set(Object.values(st.tribes));
    assert.strictEqual(tribes.size, 4, '4 unterschiedliche Stämme');
    for (const owner of st.players) {
      assert.strictEqual(st.cities.filter(c => c.owner === owner).length, 1, owner + ' Stadt');
      const tribe = TRIBES[st.tribes[owner]];
      assert.ok(tribe, owner + ' unbekannter Stamm');
      assert.strictEqual(st.units.filter(u => u.owner === owner).length, tribe.startUnits.length, owner + ' Starteinheiten');
      const expected = START_STARS + tribe.bonusStars + (owner === 'player_1' ? R.incomeFor(st, owner) : 0);
      assert.strictEqual(st.stars[owner], expected, owner + ' Startsterne');
      assert.ok(st.techs[owner].includes('basic'), owner + ' basic');
      for (const tech of tribe.startTechs) assert.ok(st.techs[owner].includes(tech), owner + ' Start-Tech');
    }
    assert.strictEqual(st.turn, 'player_1');
    assert.strictEqual(st.winner, null);
  }
});

test('createGame: Spielerwahl setzt eigenen Stamm, KI bekommt die übrigen', () => {
  for (let i = 0; i < 6; i++) {
    const st = R.createGame(700 + i, 4, 'vengir');
    assert.strictEqual(st.tribes.player_1, 'vengir');
    for (const p of ['player_2', 'player_3', 'player_4']) {
      assert.notStrictEqual(st.tribes[p], 'vengir', p + ' hat nicht den Spielerstamm');
    }
    assert.strictEqual(new Set(Object.values(st.tribes)).size, 4, 'alle Stämme verschieden');
  }
});

test('createGame: alle Städte und Starteinheiten erreichbar', () => {
  for (let i = 0; i < 6; i++) {
    const st = R.createGame(500 + i);
    const c1 = st.cities.find(c => c.owner === 'player_1');
    const reach = flood(st, c1.q, c1.r);
    for (const c of st.cities) assert.ok(reach.has(hk(c.q, c.r)), 'city unreachable');
    for (const u of st.units) {
      const adjacent = neighbors(u.q, u.r).some(([nq, nr]) => reach.has(hk(nq, nr)));
      assert.ok(reach.has(hk(u.q, u.r)) || adjacent, 'unit unreachable');
    }
  }
});

test('hex: Nachbarfelder haben Distanz 1', () => {
  for (const [nq, nr] of neighbors(5, 5)) {
    assert.strictEqual(hexDistance(5, 5, nq, nr), 1);
  }
});

console.log('\n-- Bewegung --');

test('reachableMap: Krieger bewegt sich 1 Feld, Blockaden sperren', () => {
  const st = makeState();
  st.terrain[6 * MAP_W + 5] = 'mountain';
  st.terrain[6 * MAP_W + 7] = 'water';
  const u = unit('x', 'player_1', 'warrior', 6, 6);
  st.units = [u];
  const reach = R.reachableMap(st, u);
  assert.ok(reach.has('6,7'), 'benachbart erreichbar');
  assert.ok(!reach.has('6,8'), '2 Felder entfernt');
  assert.ok(!reach.has('5,6'), 'Berg ohne Klettern gesperrt');
  assert.ok(!reach.has('7,6'), 'Wasser gesperrt');
  u.mp = 0;
  assert.strictEqual(R.reachableMap(st, u).size, 0, 'keine Bewegung');
});

test('reachableMap: Einheiten blockieren Durchgang', () => {
  const st = makeState();
  const u = unit('a', 'player_1', 'rider', 6, 5);
  const blocker = unit('b', 'player_2', 'warrior', 6, 6);
  st.units = [u, blocker];
  const reach = R.reachableMap(st, u);
  assert.ok(!reach.has('6,6'), 'enemy hex not enterable');
});

test('Bewegung: Wald kostet 2 Bewegung', () => {
  const st = makeState();
  st.terrain[7 * MAP_W + 6] = 'forest';
  const u = unit('a', 'player_1', 'rider', 6, 6);
  st.units = [u];
  const res = R.moveUnit(st, u, 6, 7);
  assert.ok(res.ok);
  assert.deepStrictEqual([u.q, u.r], [6, 7]);
  assert.strictEqual(u.mp, 0, 'Wald kostet beide Bewegungspunkte');
  assert.ok(u.hasMoved, 'hasMoved gesetzt');
});

test('Klettern erlaubt das Betreten von Bergen', () => {
  const st = makeState();
  st.terrain[5 * MAP_W + 5] = 'mountain';
  const u = unit('a', 'player_1', 'rider', 6, 5);
  st.units = [u];
  assert.ok(!R.reachableMap(st, u).has('5,5'), 'ohne Klettern gesperrt');
  st.techs.player_1.push('climbing');
  assert.ok(R.reachableMap(st, u).has('5,5'), 'mit Klettern erreichbar');
});

test('Wege geben +1 Bewegung', () => {
  const st = makeState();
  st.techs.player_1.push('riding', 'roads');
  assert.strictEqual(R.maxMove(st, 'player_1', 'rider'), UNITS.rider.move + 1);
  assert.strictEqual(R.maxMove(st, 'player_2', 'rider'), UNITS.rider.move);
});

test('Sturm: nur mit Dash darf nach dem Ziehen angegriffen werden', () => {
  const st = makeState();
  const w = unit('w', 'player_1', 'warrior', 5, 5, { hasMoved: true });
  const def = unit('d', 'player_1', 'defender', 4, 5, { hasMoved: true });
  assert.ok(R.canAttackNow(st, w), 'Krieger hat Sturm');
  assert.ok(!R.canAttackNow(st, def), 'Verteidiger ohne Sturm');
});

console.log('\n-- Kampf (echte Formel) --');

test('Krieger vs Krieger: 5 Schaden, 5 Vergeltung', () => {
  const st = makeState();
  const a = unit('a', 'player_1', 'warrior', 5, 5);
  const d = unit('b', 'player_2', 'warrior', 5, 6);
  st.units = [a, d];
  const res = R.battleResults(st, a, d);
  assert.strictEqual(res.damage, 5);
  assert.strictEqual(res.retaliation, 5);
  const out = R.attack(st, a, d);
  assert.strictEqual(d.hp, 5);
  assert.strictEqual(a.hp, 5);
  assert.ok(a.acted && a.mp === 0, 'Angreifer verbraucht');
  assertInvariants(st);
});

test('Krieger vs Bogenschütze: 6 Schaden, 2 Vergeltung', () => {
  const st = makeState();
  const a = unit('a', 'player_1', 'warrior', 5, 5);
  const d = unit('b', 'player_2', 'archer', 5, 6);
  st.units = [a, d];
  const res = R.battleResults(st, a, d);
  assert.strictEqual(res.damage, 6);
  assert.strictEqual(res.retaliation, 2);
});

test('Krieger vs Verteidiger: Verteidigung erhöht Vergeltung, senkt Schaden', () => {
  const st = makeState();
  const a = unit('a', 'player_1', 'warrior', 5, 5);
  const d = unit('b', 'player_2', 'defender', 5, 6);
  st.units = [a, d];
  const res = R.battleResults(st, a, d);
  assert.strictEqual(res.damage, 4, '2/5 * 2 * 4.5 = 3.6 -> 4');
  assert.strictEqual(res.retaliation, 8, '3/5 * 3 * 4.5 = 8.1 -> 8');
});

test('Ritter hat Angriff 3.5 (echte Werte sind nicht ganzzahlig)', () => {
  const st = makeState();
  const a = unit('a', 'player_1', 'knight', 5, 5);
  const d = unit('b', 'player_2', 'warrior', 5, 6);
  st.units = [a, d];
  const res = R.battleResults(st, a, d);
  assert.ok(res.damage >= 10, 'Ritter tötet einen Krieger, war ' + res.damage);
});

test('Wald-Bonus erst mit Bogenschießen', () => {
  const st = makeState();
  st.terrain[6 * MAP_W + 7] = 'forest';
  const a = unit('a', 'player_1', 'warrior', 7, 5);
  const d = unit('d', 'player_2', 'warrior', 7, 6);
  st.units = [a, d];
  const without = R.battleResults(st, a, d).damage;
  st.techs.player_2.push('archery');
  const withTech = R.battleResults(st, a, d).damage;
  assert.ok(withTech < without, `mit Tech weniger Schaden (${withTech} < ${without})`);
  assert.strictEqual(R.defenceBonus(st, d), 1.5);
});

test('Stadt-Bonus nur für Einheiten mit Verschanzen', () => {
  const st = makeState();
  st.cities = [{ q: 5, r: 6, owner: 'player_2', pop: 1, trained: false }];
  const fort = unit('f', 'player_2', 'warrior', 5, 6);
  const giant = unit('g', 'player_2', 'giant', 5, 6);
  assert.strictEqual(R.defenceBonus(st, fort), 1.5, 'Krieger verschanzt');
  assert.strictEqual(R.defenceBonus(st, giant), 1, 'Riese ohne Verschanzen');
});

test('Katapult (Starr): keine Vergeltung beim Angriff auf ihn', () => {
  const st = makeState();
  const a = unit('a', 'player_1', 'warrior', 5, 5);
  const d = unit('b', 'player_2', 'catapult', 5, 6);
  st.units = [a, d];
  const res = R.attack(st, a, d);
  assert.ok(!res.events.some(e => e.kind === 'retaliate'), 'kein Zurückschlagen');
  assert.strictEqual(a.hp, UNITS.warrior.hp, 'Angreifer unverletzt');
});

test('Bogenschütze: Reichweite 2, keine Vergeltung', () => {
  const st = makeState();
  const a = unit('a', 'player_1', 'archer', 5, 5);
  const d = unit('b', 'player_2', 'warrior', 5, 7);
  st.units = [a, d];
  assert.strictEqual(R.attackTargets(st, a).length, 1, 'Reichweite 2');
  st.units.push(unit('c', 'player_2', 'warrior', 5, 8));
  assert.strictEqual(R.attackTargets(st, a).length, 1, 'Distanz 3 außer Reichweite');
  const res = R.attack(st, a, d);
  assert.ok(!res.events.some(e => e.kind === 'retaliate'), 'keine Vergeltung auf Distanz 2');
  assert.strictEqual(a.hp, UNITS.archer.hp);
});

test('Nahkampf-Tötung rückt die Einheit auf das Feld vor', () => {
  const st = makeState();
  const a = unit('a', 'player_1', 'swordsman', 5, 5);
  const d = unit('b', 'player_2', 'archer', 5, 6, { hp: 1 });
  st.units = [a, d];
  const res = R.attack(st, a, d);
  assert.ok(res.killed);
  assert.deepStrictEqual([a.q, a.r], [5, 6], 'Angreifer rückt vor');
  assert.strictEqual(st.units.length, 1);
});

test('Tötung erobert dabei eine feindliche Stadt', () => {
  const st = makeState();
  st.cities = [
    { q: 5, r: 6, owner: 'player_2', pop: 1, trained: false },
    { q: 3, r: 3, owner: 'player_2', pop: 1, trained: false },
    { q: 1, r: 1, owner: 'player_1', pop: 1, trained: false }
  ];
  const a = unit('a', 'player_1', 'swordsman', 5, 5);
  const d = unit('b', 'player_2', 'warrior', 5, 6, { hp: 1 });
  st.units = [a, d];
  const res = R.attack(st, a, d);
  assert.ok(res.events.some(e => e.kind === 'capture'), 'Stadt erobert');
  assert.strictEqual(R.cityAt(st, 5, 6).owner, 'player_1');
});

test('Gedankenbeuger bekehrt statt zu töten', () => {
  const st = makeState();
  const a = unit('a', 'player_1', 'mindbender', 5, 5);
  const d = unit('b', 'player_2', 'warrior', 5, 6);
  st.units = [a, d];
  const res = R.attack(st, a, d);
  assert.ok(res.events.some(e => e.kind === 'convert'));
  assert.strictEqual(d.owner, 'player_1');
  assert.strictEqual(d.hp, UNITS.warrior.hp, 'kein Schaden');
});

test('Gedankenbeuger heilt benachbarte Verbündete um 4', () => {
  const st = makeState();
  const healer = unit('h', 'player_1', 'mindbender', 5, 5);
  const hurt = unit('x', 'player_1', 'swordsman', 5, 6, { hp: 4 });
  st.units = [healer, hurt];
  st.turn = 'player_1';
  R.startTurn(st);
  assert.strictEqual(hurt.hp, 8, 'Heilung +4');
});

test('Rückzug: Reiter kann nach dem Angriff noch ziehen', () => {
  const st = makeState();
  const rider = unit('r', 'player_1', 'rider', 6, 6, { mp: 1, hasMoved: true });
  const d = unit('d', 'player_2', 'warrior', 5, 6);
  st.units = [rider, d];
  R.attack(st, rider, d);
  assert.ok(rider.acted, 'hat gehandelt');
  assert.ok(rider.mp > 0, 'behält Bewegungspunkte');
  assert.ok(R.reachableMap(st, rider).size > 0, 'kann weiterziehen');
});

console.log('\n-- Städte & Ökonomie --');

test('Erobern neutraler Stadt und Sieg bei letzter feindlicher Stadt', () => {
  const st = makeState();
  st.cities = [
    { q: 3, r: 3, owner: 'player_1', pop: 2, trained: false },
    { q: 8, r: 8, owner: 'player_2', pop: 1, trained: false },
    { q: 6, r: 6, owner: null, pop: 1, trained: false }
  ];
  const u = unit('u', 'player_1', 'warrior', 6, 5);
  st.units = [u];
  const res = R.moveUnit(st, u, 6, 6);
  assert.ok(res.ok);
  assert.ok(res.events.some(e => e.kind === 'capture'));
  assert.strictEqual(R.cityAt(st, 6, 6).owner, 'player_1');
  assert.strictEqual(st.winner, null, 'feindliche Stadt bleibt');

  const u2 = unit('u2', 'player_1', 'warrior', 8, 7);
  st.units.push(u2);
  const res2 = R.moveUnit(st, u2, 8, 8);
  assert.ok(res2.ok);
  assert.strictEqual(st.winner, 'player_1');
});

test('Ausbilden: Kosten, Tech-Gate, Belegung, Doppel-Ausbildung', () => {
  const st = makeState();
  const city = { q: 3, r: 3, owner: 'player_1', pop: 2, trained: false };
  st.cities = [city];
  st.stars.player_1 = 20;

  let res = R.trainUnit(st, city, 'warrior', 'player_1');
  assert.ok(res.ok, 'Krieger trainierbar');
  assert.strictEqual(st.stars.player_1, 18);
  assert.strictEqual(st.units[0].hp, UNITS.warrior.hp);

  res = R.trainUnit(st, city, 'warrior', 'player_1');
  assert.ok(!res.ok, 'bereits ausgebildet');

  city.trained = false;
  st.units = [];
  res = R.trainUnit(st, city, 'archer', 'player_1');
  assert.ok(!res.ok, 'Tech fehlt');

  st.techs.player_1.push('hunting', 'archery');
  res = R.trainUnit(st, city, 'archer', 'player_1');
  assert.ok(res.ok, 'nach Forschung ok');
  assert.strictEqual(st.stars.player_1, 18 - UNITS.archer.cost);
});

test('Bevölkerung: Kosten steigen, Maximum greift', () => {
  const st = makeState();
  const city = { q: 3, r: 3, owner: 'player_1', pop: 2, trained: false };
  st.cities = [city];
  st.stars.player_1 = 100;
  assert.strictEqual(R.popCost(city), 4);
  assert.ok(R.buyPop(st, city, 'player_1').ok);
  assert.strictEqual(city.pop, 3);
  assert.strictEqual(R.popCost(city), 5);
  while (city.pop < MAX_POP) assert.ok(R.buyPop(st, city, 'player_1').ok);
  const last = R.buyPop(st, city, 'player_1');
  assert.ok(!last.ok, 'max pop erreicht');
  assert.strictEqual(last.reason, 'Maximale Bevölkerung');
});

test('Einkommen = Bevölkerung (+ Handel/Baukunst)', () => {
  const st = makeState();
  st.cities = [
    { q: 3, r: 3, owner: 'player_1', pop: 2, trained: false },
    { q: 5, r: 5, owner: 'player_1', pop: 3, trained: false }
  ];
  assert.strictEqual(R.incomeFor(st, 'player_1'), 5);
  st.techs.player_1.push('construction', 'trade');
  assert.strictEqual(R.incomeFor(st, 'player_1'), 9, 'je +1 pro Stadt');
});

test('Forschung: Voraussetzungen, Kostenskalierung, Philosophie-Rabatt', () => {
  const st = makeState();
  st.cities = [{ q: 3, r: 3, owner: 'player_1', pop: 2, trained: false }];
  st.stars.player_1 = 100;

  assert.ok(!R.research(st, 'shields', 'player_1').ok, 'Voraussetzung Organisation fehlt');
  assert.strictEqual(R.techCost(st, 'organization', 'player_1'), 2, 'Tier1 * (1 + 1 Stadt)');
  assert.ok(R.research(st, 'organization', 'player_1').ok);
  assert.ok(!R.research(st, 'organization', 'player_1').ok, 'nicht doppelt');
  assert.ok(R.research(st, 'shields', 'player_1').ok, 'Voraussetzung erfüllt');

  st.cities.push({ q: 5, r: 5, owner: 'player_1', pop: 1, trained: false });
  assert.strictEqual(R.techCost(st, 'hunting', 'player_1'), 3, 'Tier1 * (1 + 2 Städte)');

  const before = R.techCost(st, 'philosophy', 'player_1');
  st.techs.player_1.push('philosophy');
  const after = R.techCost(st, 'philosophy', 'player_1');
  assert.strictEqual(after, Math.ceil(before * 0.8));
});

test('Zug beenden: Rotation, Einkommen, Rundenzähler, Verschanzen-Heilung', () => {
  const st = R.createGame(4242);
  const p1u = st.units.filter(u => u.owner === 'player_1');
  for (const u of p1u) { u.hp = 1; u.acted = false; u.hasMoved = false; }
  const starsBefore = st.stars.player_2;
  const roundBefore = st.round;

  R.endTurn(st);
  assert.strictEqual(st.turn, 'player_2');
  assert.strictEqual(st.round, roundBefore);
  assert.ok(st.stars.player_2 > starsBefore, 'Einkommen zu Rundenbeginn');

  R.endTurn(st);
  assert.strictEqual(st.turn, 'player_3');
  R.endTurn(st);
  assert.strictEqual(st.turn, 'player_4');
  R.endTurn(st);
  assert.strictEqual(st.turn, 'player_1');
  assert.strictEqual(st.round, roundBefore + 1, 'Runde +1 nach voller Runde');
  for (const u of st.units.filter(u => u.owner === 'player_1')) {
    if (UNITS[u.type].abilities.includes('fortify')) assert.ok(u.hp > 1, 'Verschanzen heilt');
    assert.ok(!u.acted, 'P1-Einheiten zurückgesetzt');
  }
});

test('endTurn überspringt ausgeschiedene Spieler', () => {
  const st = R.createGame(999);
  for (const p of ['player_2', 'player_3']) {
    st.cities = st.cities.filter(c => c.owner !== p);
  }
  st.units = st.units.filter(u => u.owner !== 'player_2' && u.owner !== 'player_3');
  R.endTurn(st);
  assert.strictEqual(st.turn, 'player_4', 'p2 und p3 (tot) werden übersprungen');
  R.endTurn(st);
  assert.strictEqual(st.turn, 'player_1');
});

test('Fog of War: Sicht von Einheiten und Städten deckt Karte auf', () => {
  const st = makeState();
  st.explored = { player_1: [], player_2: [] };
  const u = unit('a', 'player_1', 'warrior', 5, 5);
  st.units = [u];
  assert.ok(!R.isExplored(st, 'player_1', 5, 5), 'vorher verborgen');
  R.updateExplored(st, 'player_1');
  assert.ok(R.isExplored(st, 'player_1', 5, 5), 'eigenes Feld');
  assert.ok(R.isExplored(st, 'player_1', 5, 6), 'Nachbarfeld');
  assert.ok(!R.isExplored(st, 'player_1', 8, 8), 'entfernt bleibt verborgen');
  assert.ok(!R.isExplored(st, 'player_2', 5, 5), 'P2 sieht nichts');
});

console.log('\n-- Ressourcen & Gebäude --');

test('createGame erzeugt Ressourcen nahe der Startstädte', () => {
  for (let i = 0; i < 6; i++) {
    const st = R.createGame(3000 + i);
    assert.ok(Object.keys(st.resources).length > 0, 'Ressourcen vorhanden');
    for (const c of st.cities.filter(c => c.owner)) {
      const near = R.territory(c).some(([q, r]) => R.resourceAt(st, q, r));
      assert.ok(near, 'Startstadt hat Ressourcen in Reichweite');
    }
  }
});

test('Ressourcen im Stadtgebiet erhöhen das Einkommen', () => {
  const st = makeState();
  st.cities = [{ q: 5, r: 5, owner: 'player_1', pop: 1, trained: false }];
  st.resources = { '5,6': 'fruit', '6,5': 'animals' };
  assert.strictEqual(R.cityIncome(st, st.cities[0]), 3);
  assert.strictEqual(R.incomeFor(st, 'player_1'), 3);
});

test('Gebäude: Gelände-, Voraussetzungs- und Ressourcen-Regeln', () => {
  const st = makeState();
  const city = { q: 5, r: 5, owner: 'player_1', pop: 1, trained: false };
  st.cities = [city];
  st.stars.player_1 = 50;
  st.turn = 'player_1';
  st.terrain[6 * MAP_W + 5] = 'forest';
  st.resources = { '6,5': 'fruit' };
  assert.ok(!R.canImprove(st, city, 'farm', 6, 5).ok, 'Ressourcenfeld gesperrt');
  assert.ok(!R.canImprove(st, city, 'farm', 6, 6).ok, 'außerhalb Stadtgebiet');
  assert.ok(R.canImprove(st, city, 'sawmill', 5, 6).ok, 'Wald für Sägewerk');
  assert.ok(!R.canImprove(st, city, 'farm', 5, 6).ok, 'Farm nur auf Feld');

  let res = R.improve(st, city, 'sawmill', 5, 6, 'player_1');
  assert.strictEqual(res.reason, 'Technologie fehlt');
  st.techs.player_1.push('forestry');
  const before = R.incomeFor(st, 'player_1');
  res = R.improve(st, city, 'sawmill', 5, 6, 'player_1');
  assert.ok(res.ok);
  assert.strictEqual(R.improvementAt(st, 5, 6), 'sawmill');
  assert.strictEqual(R.incomeFor(st, 'player_1'), before + 1, 'Sägewerk +1 Einkommen');
  assert.ok(!R.canImprove(st, city, 'sawmill', 5, 6).ok, 'bereits bebaut');
});

test('Tempel bringt +2 Einkommen und nutzt Meditation', () => {
  const st = makeState();
  const city = { q: 5, r: 5, owner: 'player_1', pop: 1, trained: false };
  st.cities = [city];
  st.stars.player_1 = 50;
  st.turn = 'player_1';
  assert.strictEqual(R.improve(st, city, 'temple', 6, 5, 'player_1').reason, 'Technologie fehlt');
  st.techs.player_1.push('climbing', 'meditation');
  const before = R.incomeFor(st, 'player_1');
  assert.ok(R.improve(st, city, 'temple', 6, 5, 'player_1').ok);
  assert.strictEqual(R.incomeFor(st, 'player_1'), before + 2);
});

console.log('\n-- Marine --');

test('Marine: nur auf Wasser, Küstenstadt nötig', () => {
  const st = makeState();
  st.terrain[5 * MAP_W + 6] = 'water';
  const boat = unit('b', 'player_1', 'boat', 5, 5);
  st.units = [boat];
  const reach = R.reachableMap(st, boat);
  assert.ok(reach.has('6,5'), 'Boot fährt auf Wasser');
  assert.ok(!reach.has('4,5'), 'Boot betritt kein Land');
  st.units = [unit('w', 'player_1', 'warrior', 5, 5)];
  assert.ok(!R.reachableMap(st, st.units[0]).has('6,5'), 'Landeinheit betritt kein Wasser');
  st.units = [];

  const city = { q: 5, r: 5, owner: 'player_1', pop: 1, trained: false };
  st.cities = [city];
  st.turn = 'player_1';
  st.stars.player_1 = 50;
  st.techs.player_1.push('fishing', 'sailing');
  assert.ok(R.canTrain(st, city, 'boat', 'player_1').ok, 'Küstenstadt erlaubt Boote');
  const inland = { q: 2, r: 2, owner: 'player_1', pop: 1, trained: false };
  st.cities = [inland];
  assert.strictEqual(R.canTrain(st, inland, 'boat', 'player_1').reason, 'Küstenstadt nötig');
});

test('Aquatismus gibt Verteidigungsbonus auf Wasser', () => {
  const st = makeState();
  st.terrain[6 * MAP_W + 5] = 'water';
  const boat = unit('b', 'player_2', 'boat', 5, 6);
  st.units = [boat];
  assert.strictEqual(R.defenceBonus(st, boat), 1, 'ohne Aquatismus');
  st.techs.player_2.push('fishing', 'ramming', 'aquatism');
  assert.strictEqual(R.defenceBonus(st, boat), 1.5);
});

test('Segeln/Navigation schalten Boote und Kriegsschiffe frei', () => {
  const st = makeState();
  assert.ok(!R.unlockedUnits(st, 'player_1').includes('boat'));
  st.techs.player_1.push('sailing');
  assert.ok(R.unlockedUnits(st, 'player_1').includes('boat'));
  assert.ok(R.unlockedUnits(st, 'player_1').includes('ship'));
  assert.ok(!R.unlockedUnits(st, 'player_1').includes('battleship'));
  st.techs.player_1.push('navigation');
  assert.ok(R.unlockedUnits(st, 'player_1').includes('battleship'));
});

test('Kampfprognose liefert Schaden und Vergeltung', () => {
  const st = makeState();
  const a = unit('a', 'player_1', 'warrior', 5, 5);
  st.units = [a, unit('b', 'player_2', 'archer', 5, 6), unit('c', 'player_2', 'warrior', 6, 5)];
  const preview = R.attackPreview(st, a);
  assert.strictEqual(preview.length, 2);
  const archer = preview.find(x => x.target.type === 'archer');
  assert.strictEqual(archer.damage, 6);
  assert.strictEqual(archer.retaliation, 2);
});

console.log('\n-- KI-Simulation --');

test('4 Bots: 30 Runden ohne Verletzungen', () => {
  const st = R.createGame(777);
  let guard = 0;
  for (let round = 0; round < 30 && !st.winner; round++) {
    for (const player of st.players) {
      let steps = 0;
      while (st.turn === player && !st.winner) {
        const step = botStep(st, player);
        if (!step) break;
        let res;
        if (step.kind === 'attack') res = R.attack(st, step.attacker, step.defender);
        else if (step.kind === 'move') res = R.moveUnit(st, step.unit, step.q, step.r);
        else if (step.kind === 'train') res = R.trainUnit(st, step.city, step.type, player);
        else if (step.kind === 'buyPop') res = R.buyPop(st, step.city, player);
        else if (step.kind === 'improve') res = R.improve(st, step.city, step.type, step.q, step.r, player);
        else if (step.kind === 'settle') res = R.foundCity(st, step.unit, player);
        else if (step.kind === 'research') res = R.research(st, step.tech, player);
        else throw new Error('unknown step ' + step.kind);
        if (res && res.ok === false) throw new Error(`${step.kind} fehlgeschlagen: ${res.reason}`);
        assertInvariants(st);
        steps++;
        if (steps > 200) throw new Error('Bot-Loop über 200 Schritte');
        if (++guard > 16000) throw new Error('globale Sicherung ausgelöst');
      }
      if (st.turn === player && !st.winner) R.endTurn(st);
      assertInvariants(st);
    }
  }
  assert.ok(st.round >= 2, 'Fortschritt im Spiel');
  if (st.winner) console.log('      (Sieger nach ' + st.round + ' Runden: ' + st.winner + ')');
  else {
    const aliveCount = st.players.filter(p => st.cities.some(c => c.owner === p)).length;
    console.log('      (nach ' + st.round + ' Runden offen, aktive Spieler: ' + aliveCount + ')');
  }
});

console.log('\n-- Siedler & Stadtgründung --');

test('canTrain: Siedler nur in der Hauptstadt', () => {
  const st = R.createGame(4242);
  const cap = st.cities.find(c => c.owner === 'player_1' && c.isCapital);
  const other = st.cities.find(c => c.owner === 'player_1' && !c.isCapital);
  st.stars['player_1'] = 20;
  if (other) {
    const chk = R.canTrain(st, other, 'settler', 'player_1');
    assert.strictEqual(chk.ok, false);
    assert.ok(chk.reason.includes('Hauptstadt'), 'Grund = Hauptstadt, war: ' + chk.reason);
  }
  cap.trained = false;
  st.units = st.units.filter(u => !(u.q === cap.q && u.r === cap.r));
  const ok = R.canTrain(st, cap, 'settler', 'player_1');
  assert.ok(ok.ok, 'Siedler in Hauptstadt trainierbar: ' + ok.reason);
  const res = R.trainUnit(st, cap, 'settler', 'player_1');
  assert.ok(res.ok, 'Siedler ausgebildet');
  assert.ok(st.units.some(u => u.type === 'settler' && u.owner === 'player_1'), 'Siedler vorhanden');
});

test('createGame: erste Stadt jedes Spielers ist Hauptstadt', () => {
  for (let i = 0; i < 8; i++) {
    const st = R.createGame(900 + i);
    for (const p of st.players) {
      const owned = st.cities.filter(c => c.owner === p);
      assert.ok(owned.length >= 1, 'Spieler hat Stadt');
      assert.strictEqual(owned[0].isCapital, true, p + ' hat Hauptstadt');
    }
  }
});

test('canFound/foundCity: Regeln und Gründung', () => {
  const st = makeState();
  st.stars.player_1 = 20;
  st.cities = [{ q: 1, r: 1, owner: 'player_1', pop: 1, trained: false, isCapital: true }];
  const s = unit(1, 'player_1', 'settler', 3, 3);
  st.units = [s];
  const chk = R.canFound(st, s, 'player_1');
  assert.ok(chk.ok, 'freies Feld gründbar: ' + chk.reason);
  st.units.push(unit(2, 'player_1', 'settler', 1, 0));
  const near = st.units[1];
  const chk2 = R.canFound(st, near, 'player_1');
  assert.strictEqual(chk2.ok, false, 'zu nah an Stadt verboten');
  st.units[1].q = 10; st.units[1].r = 8;
  const s3 = unit(3, 'player_1', 'settler', 12, 12);
  st.units[1] = s3;
  st.resources[hk(12, 12)] = 'fruit';
  const chk3 = R.canFound(st, s3, 'player_1');
  assert.strictEqual(chk3.ok, false, 'Ressourcenfeld verboten');
  delete st.resources[hk(12, 12)];
  const res = R.foundCity(st, s3, 'player_1');
  assert.ok(res.ok, 'Gründung klappt: ' + res.reason);
  assert.ok(st.cities.some(c => c.q === 12 && c.r === 12 && c.owner === 'player_1'), 'neue Stadt da');
  assert.ok(!st.units.includes(s3), 'Siedler verbraucht');
  const s4 = unit(4, 'player_1', 'settler', 13, 12);
  const chk4 = R.canFound(st, s4, 'player_1');
  assert.strictEqual(chk4.ok, false, 'nahe neuer Stadt verboten');
});

console.log('\n-- Spieleinstellungen --');

test('createGame: 5 Spieler, mehrere Seeds', () => {
  for (let i = 0; i < 6; i++) {
    const st = R.createGame(4000 + i, 5);
    assert.strictEqual(st.players.length, 5);
    assertInvariants(st);
  }
});

test('createGame: Start-Sterne-Option', () => {
  const normal = R.createGame(4321, 4, { tribe: 'vengir', stars: 10 });
  const tr = R.tribeName(normal, 'player_1'); // nur um Zugriff zu zeigen
  assert.ok(normal.stars['player_1'] >= 10, 'reich: >= 10 Sterne');
  const knapp = R.createGame(4321, 4, { stars: 2 });
  assert.ok(knapp.stars['player_1'] >= 2 && knapp.stars['player_1'] < 10, 'knapp: wenige Sterne');
});

console.log('\n-- Korrekturen --');

test('Siedler (Angriff 0) kann nicht angreifen, KI greift damit nicht an', () => {
  const st = makeState();
  st.cities.push({ q: 2, r: 2, owner: 'player_1', pop: 1, trained: true, isCapital: true });
  st.cities.push({ q: 20, r: 12, owner: 'player_2', pop: 1, trained: true, isCapital: true });
  const s = unit('s', 'player_1', 'settler', 5, 5);
  const w = unit('w', 'player_2', 'warrior', 6, 5);
  st.units.push(s, w);
  assert.strictEqual(R.attackTargets(st, s).length, 0, 'keine Ziele');
  const res = R.attack(st, s, w);
  assert.strictEqual(res.ok, false, 'Angriff abgelehnt');
  assert.strictEqual(s.hp, UNITS.settler.hp, 'Siedler unverletzt');
  st.stars.player_1 = 0;
  const step = botStep(st, 'player_1');
  assert.ok(!step || step.kind !== 'attack', 'KI-Siedler greift nicht an');
});

test('Gedankenbeuger (Angriff 0) darf weiterhin bekehren', () => {
  const st = makeState();
  st.cities.push({ q: 2, r: 2, owner: 'player_1', pop: 1, trained: false, isCapital: true });
  const m = unit('m', 'player_1', 'mindbender', 5, 5);
  const w = unit('w', 'player_2', 'warrior', 6, 5);
  st.units.push(m, w);
  assert.strictEqual(R.attackTargets(st, m).length, 1);
  R.attack(st, m, w);
  assert.strictEqual(w.owner, 'player_1');
});

test('Nebel: entdeckt, aber außer Sicht = kein Angriffsziel', () => {
  const st = makeState();
  st.explored = { player_1: [], player_2: [] };
  st.cities.push({ q: 2, r: 2, owner: 'player_1', pop: 1, trained: false, isCapital: true });
  const a = unit('a', 'player_1', 'archer', 10, 8);
  const e = unit('e', 'player_2', 'warrior', 12, 8);
  st.units.push(a, e);
  st.explored.player_1.push(hk(12, 8));
  assert.ok(R.isVisible(st, 'player_1', 12, 8), 'Bogenschütze sieht 2 Felder');
  assert.strictEqual(R.attackTargets(st, a).length, 1);
  e.q = 13; // weiter weg, Feld bleibt aber "entdeckt"
  st.explored.player_1.push(hk(13, 8));
  assert.ok(R.isExplored(st, 'player_1', 13, 8));
  assert.ok(!R.isVisible(st, 'player_1', 13, 8), 'nicht mehr sichtbar');
});

test('isExplored: Cache folgt neuen Einträgen', () => {
  const st = makeState();
  st.explored = { player_1: [] };
  assert.ok(!R.isExplored(st, 'player_1', 3, 3));
  st.explored.player_1.push(hk(3, 3));
  assert.ok(R.isExplored(st, 'player_1', 3, 3));
});

test('isEliminated: Mensch ohne Städte ist raus, KI spielt nicht endlos weiter', () => {
  const st = makeState();
  st.cities.push({ q: 20, r: 12, owner: 'player_2', pop: 1, trained: false, isCapital: true });
  st.cities.push({ q: 4, r: 12, owner: 'player_3', pop: 1, trained: false, isCapital: true });
  assert.ok(R.isEliminated(st, 'player_1'));
  assert.ok(!R.isEliminated(st, 'player_2'));
  assert.strictEqual(st.winner, null, 'noch kein Sieger');
});

console.log('\n-- Spielstand --');

function memStore() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

test('saveGame/loadGame: Rundreise erhält den Spielstand', () => {
  const store = memStore();
  const st = R.createGame(777, 3, { tribe: 'bardur' });
  assert.ok(saveGame('bot', st, store));
  const data = loadGame(store);
  assert.strictEqual(data.mode, 'bot');
  assert.deepStrictEqual(data.state, JSON.parse(JSON.stringify(st)));
  assert.deepStrictEqual(saveInfo(store), { mode: 'bot', label: 'Gegen KI', round: st.round });
  // geladener Stand ist spielbar
  const loaded = data.state;
  R.endTurn(loaded);
  assert.notStrictEqual(loaded.turn, 'player_1');
});

test('saveGame: Online und beendete Spiele werden nicht gespeichert', () => {
  const store = memStore();
  const st = R.createGame(778, 2);
  assert.ok(!saveGame('online', st, store));
  saveGame('hotseat', st, store);
  st.winner = 'player_1';
  saveGame('hotseat', st, store);
  assert.strictEqual(loadGame(store), null, 'Sieg löscht Spielstand');
  store.setItem('pb_save_v1', '{kaputt');
  assert.strictEqual(loadGame(store), null, 'kaputte Daten werden ignoriert');
  clearSave(store);
});

test('KI-Partie läuft zu Ende (Simulation, mehrere Seeds)', () => {
  for (const seed of [11, 12, 13]) {
    const st = R.createGame(seed, 3);
    let guard = 0;
    while (!st.winner && st.round < 60 && guard < 20000) {
      const p = st.turn;
      const step = botStep(st, p);
      guard++;
      if (!step) { R.endTurn(st); continue; }
      if (step.kind === 'attack') {
        const res = R.attack(st, step.attacker, step.defender);
        assert.notStrictEqual(res.ok, false, 'KI wählt nur gültige Angriffe');
      } else if (step.kind === 'move') R.moveUnit(st, step.unit, step.q, step.r);
      else if (step.kind === 'train') R.trainUnit(st, step.city, step.type, p);
      else if (step.kind === 'buyPop') R.buyPop(st, step.city, p);
      else if (step.kind === 'improve') R.improve(st, step.city, step.type, step.q, step.r, p);
      else if (step.kind === 'settle') R.foundCity(st, step.unit, p);
      else if (step.kind === 'research') R.research(st, step.tech, p);
    }
    assert.ok(guard < 20000, 'keine Endlosschleife');
    for (const u of st.units) assert.ok(u.hp > 0 && u.hp <= UNITS[u.type].hp, 'LP im gültigen Bereich');
  }
});

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed) process.exit(1);
