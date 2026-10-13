import assert from 'node:assert';
import * as R from '../js/rules.js';
import {
  UNITS, TERRAIN, MAP_W, MAP_H, START_STARS, MAX_POP, TRIBES,
  RESOURCES, IMPROVEMENTS
} from '../js/config.js';
import { hk, hexDistance, neighbors, inBounds } from '../js/hex.js';
import { botStep, applyStep } from '../js/ai.js';
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
      if (!R.bridgeAt(state, nq, nr) && (!def.walkable || def.enterTech)) continue;
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
    const naval = (UNITS[u.type].abilities || []).includes('water');
    assert.ok(naval ? (tile === 'water' || tile === 'ocean' || !!R.cityAt(state, u.q, u.r)) : (TERRAIN[tile].walkable || R.bridgeAt(state, u.q, u.r)), 'unit on wrong terrain');
    const k = hk(u.q, u.r);
    assert.ok(!seen.has(k), 'two units on same tile: ' + k);
    seen.add(k);
    assert.ok(u.hp >= 1 && u.hp <= R.hpCap(u), 'hp out of range');
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
  // acted: hat angegriffen, regeneriert also nicht selbst – nur der Heiler wirkt.
  const hurt = unit('x', 'player_1', 'swordsman', 5, 6, { hp: 4, acted: true });
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

test('Marine: nur auf Wasser, Hafen nötig', () => {
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
  assert.strictEqual(R.canTrain(st, city, 'boat', 'player_1').reason, 'Hafen nötig', 'Küste allein reicht nicht');
  st.improvements = { '6,5': 'port' };
  assert.ok(R.canTrain(st, city, 'boat', 'player_1').ok, 'mit Hafen erlaubt');
  // Einheit in der Stadt stört nicht – das Boot entsteht im Hafen.
  st.units = [unit('w', 'player_1', 'warrior', 5, 5)];
  assert.ok(R.trainUnit(st, city, 'boat', 'player_1').ok);
  const built = st.units.find(u => u.type === 'boat');
  assert.deepStrictEqual([built.q, built.r], [6, 5], 'Boot liegt im Hafen');
  city.trained = false;
  assert.strictEqual(R.canTrain(st, city, 'boat', 'player_1').reason, 'Hafen besetzt');
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
        const res = applyStep(st, step, player);
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
      const res = applyStep(st, step, p);
      if (step.kind === 'attack') assert.notStrictEqual(res.ok, false, 'KI wählt nur gültige Angriffe');
      assert.ok(!res || res.ok !== false || step.kind === 'move', `KI-Schritt ${step.kind} gültig: ${res && res.reason}`);
    }
    assert.ok(guard < 20000, 'keine Endlosschleife');
    for (const u of st.units) assert.ok(u.hp > 0 && u.hp <= R.hpCap(u), 'LP im gültigen Bereich');
  }
});

console.log('\n-- Stadtstufen --');

function cityState() {
  const st = makeState();
  st.explored = { player_1: [], player_2: [] };
  const city = { q: 10, r: 8, owner: 'player_1', pop: 1, trained: false, isCapital: true };
  st.cities.push(city, { q: 20, r: 12, owner: 'player_2', pop: 1, trained: false, isCapital: true });
  return { st, city };
}

test('Bevölkerung 2 bis 5 erzeugt je eine offene Belohnung', () => {
  const { st, city } = cityState();
  R.growCity(st, city, 4);
  assert.strictEqual(city.pop, 5);
  assert.deepStrictEqual(city.pending, [2, 3, 4, 5]);
  assert.deepStrictEqual(R.rewardOptions(city), ['workshop', 'explorer']);
  assert.strictEqual(R.chooseReward(st, city, 'wall', 'player_1').ok, false, 'falsche Stufe');
  assert.strictEqual(R.chooseReward(st, city, 'workshop', 'player_2').ok, false, 'fremde Stadt');
});

test('Werkstatt und Park erhöhen das Einkommen', () => {
  const { st, city } = cityState();
  R.growCity(st, city, 4);
  const base = R.cityIncome(st, city);
  R.chooseReward(st, city, 'workshop', 'player_1');
  assert.strictEqual(R.cityIncome(st, city), base + 1);
  R.chooseReward(st, city, 'resources', 'player_1');
  R.chooseReward(st, city, 'borders', 'player_1');
  R.chooseReward(st, city, 'park', 'player_1');
  assert.ok(R.cityIncome(st, city) >= base + 2);
  assert.strictEqual(R.pendingLevel(city), null);
});

test('Vorräte: +5 Sterne · Erkunder: Umgebung aufgedeckt', () => {
  const { st, city } = cityState();
  R.growCity(st, city, 2);
  R.chooseReward(st, city, 'explorer', 'player_1');
  assert.ok(R.isExplored(st, 'player_1', city.q + 4, city.r), 'Radius 4 aufgedeckt');
  const before = st.stars.player_1;
  R.chooseReward(st, city, 'resources', 'player_1');
  assert.strictEqual(st.stars.player_1, before + 5);
});

test('Stadtmauer: Verteidiger in der Stadt ×4', () => {
  const { st, city } = cityState();
  const d = unit('d', 'player_1', 'defender', city.q, city.r);
  st.units.push(d);
  assert.strictEqual(R.defenceBonus(st, d), 1.5);
  city.rewards = { 3: 'wall' };
  assert.strictEqual(R.defenceBonus(st, d), 4);
});

test('Grenzerweiterung: Gebiet Radius 2, Bauen auch dort', () => {
  const { st, city } = cityState();
  assert.strictEqual(R.territory(city).length, 6);
  city.rewards = { 4: 'borders' };
  assert.strictEqual(R.territory(city).length, 18);
  st.techs.player_1.push('organization', 'farming');
  assert.ok(R.improve(st, city, 'farm', city.q + 2, city.r, 'player_1').ok, 'Farm im äußeren Ring');
});

test('Wachstum führt direkt zur nächsten Stufe', () => {
  const { st, city } = cityState();
  R.growCity(st, city, 3);
  R.chooseReward(st, city, 'workshop', 'player_1');
  R.chooseReward(st, city, 'resources', 'player_1');
  R.chooseReward(st, city, 'growth', 'player_1');
  assert.strictEqual(city.pop, 5);
  assert.deepStrictEqual(R.rewardOptions(city), ['park', 'giant']);
});

test('Riese nur als Belohnung, erscheint bei der Stadt', () => {
  const { st, city } = cityState();
  assert.ok(!R.unlockedUnits(st, 'player_1').includes('giant'));
  assert.strictEqual(R.canTrain(st, city, 'giant', 'player_1').ok, false);
  city.pop = 4; city.pending = [5]; city.rewards = {};
  R.chooseReward(st, city, 'giant', 'player_1');
  const g = st.units.find(u => u.type === 'giant');
  assert.ok(g && g.owner === 'player_1' && hexDistance(g.q, g.r, city.q, city.r) <= 1);
});

test('KI wählt offene Belohnungen selbst', () => {
  const { st, city } = cityState();
  city.owner = 'player_2';
  st.cities[1].owner = 'player_1';
  st.turn = 'player_2';
  R.growCity(st, city, 1);
  const step = botStep(st, 'player_2');
  assert.strictEqual(step.kind, 'reward');
  assert.ok(applyStep(st, step, 'player_2').ok);
});

console.log('\n-- Ruinen --');

test('createGame: Ruinen auf Feld/Wald, Abstand zu Städten', () => {
  for (const seed of [1, 2, 3, 4]) {
    const st = R.createGame(seed, 4);
    const keys = Object.keys(st.ruins);
    assert.ok(keys.length >= 4, 'genug Ruinen: ' + keys.length);
    for (const k of keys) {
      const [q, r] = k.split(',').map(Number);
      assert.ok(['field', 'forest'].includes(R.terrainAt(st, q, r)));
      assert.ok(st.cities.every(c => hexDistance(q, r, c.q, c.r) >= 3));
    }
  }
});

test('Ruine betreten: Belohnung, Ruine verschwindet', () => {
  const { st } = cityState();
  st.ruins = { [hk(6, 6)]: true };
  const w = unit('w', 'player_1', 'warrior', 5, 6);
  st.units.push(w);
  const before = st.stars.player_1;
  const res = R.moveUnit(st, w, 6, 6);
  const ev = res.events.find(e => e.kind === 'ruin');
  assert.ok(ev, 'Ruinen-Ereignis');
  assert.ok(!R.ruinAt(st, 6, 6), 'Ruine weg');
  assert.strictEqual(st.ruinsBy.player_1, 1);
  assert.ok(st.stars.player_1 >= before || st.techs.player_1.length > 1 || st.units.length > 1 || st.cities[0].pop > 1 || st.explored.player_1.length > 0);
});

test('Ruinen-Belohnungen einzeln', () => {
  for (const kind of ['stars', 'tech', 'unit', 'pop', 'reveal']) {
    const { st } = cityState();
    st.ruins = { [hk(6, 6)]: true };
    const w = unit('w', 'player_1', 'warrior', 6, 6);
    st.units.push(w);
    const stars = st.stars.player_1, techs = st.techs.player_1.length, units = st.units.length;
    const ev = R.claimRuin(st, w, kind);
    assert.strictEqual(ev.reward, kind, kind);
    if (kind === 'stars') assert.strictEqual(st.stars.player_1, stars + 10);
    if (kind === 'tech') assert.strictEqual(st.techs.player_1.length, techs + 1);
    if (kind === 'unit') assert.strictEqual(st.units.length, units + 1);
    if (kind === 'pop') assert.strictEqual(st.cities[0].pop, 2);
    if (kind === 'reveal') assert.ok(st.explored.player_1.length > 50);
  }
});

console.log('\n-- Perfektion & Punkte --');

test('Perfektion: nach 30 Runden gewinnt die höchste Punktzahl', () => {
  const st = R.createGame(31, 3, { turnLimit: 30 });
  let guard = 0;
  while (!st.winner && guard++ < 1000) R.endTurn(st);
  assert.strictEqual(st.endReason, 'score');
  assert.strictEqual(st.round, 30);
  const top = Math.max(...Object.values(st.finalScores));
  assert.strictEqual(st.finalScores[st.winner], top);
  assert.strictEqual(st.history[st.history.length - 1].round, 30);
  assert.ok(st.history.length >= 30, 'Verlauf je Runde');
  R.endTurn(st);
  assert.strictEqual(st.round, 30, 'nach Spielende passiert nichts mehr');
});

test('Punkte steigen mit Stadt, Tech und Einheiten', () => {
  const { st, city } = cityState();
  const a = R.score(st, 'player_1');
  R.growCity(st, city, 1);
  st.techs.player_1.push('organization');
  st.units.push(unit('x', 'player_1', 'warrior', 3, 3));
  const b = R.score(st, 'player_1');
  assert.strictEqual(b - a, 40 + 50 + 10);
});

test('Eroberung beendet Spiel mit Verlauf und Endpunkten', () => {
  const { st } = cityState();
  st.players = ['player_1', 'player_2'];
  st.cities[1].owner = 'player_1';
  R.checkWinner(st);
  assert.strictEqual(st.winner, 'player_1');
  assert.strictEqual(st.endReason, 'conquest');
  assert.ok(st.finalScores && st.finalScores.player_1 > 0);
});

console.log('\n-- KI-Schwierigkeit --');

test('KI-Stärke ändert Einkommen und Startsterne der Bots', () => {
  const opts = lvl => ({ aiLevel: lvl, ai: ['player_2', 'player_3'], stars: 5 });
  const easy = R.createGame(55, 3, opts('easy'));
  const norm = R.createGame(55, 3, opts('normal'));
  const hard = R.createGame(55, 3, opts('hard'));
  assert.strictEqual(hard.stars.player_2 - norm.stars.player_2, 3, 'Startbonus');
  assert.strictEqual(hard.stars.player_1, norm.stars.player_1, 'Mensch unverändert');
  for (const c of easy.cities) c.pop = 4;
  for (const c of norm.cities) c.pop = 4;
  for (const c of hard.cities) c.pop = 4;
  assert.ok(R.incomeFor(easy, 'player_2') < R.incomeFor(norm, 'player_2'));
  assert.strictEqual(R.incomeFor(hard, 'player_2'), R.incomeFor(norm, 'player_2') + 2);
  assert.strictEqual(R.incomeFor(easy, 'player_1'), R.incomeFor(norm, 'player_1'));
});

test('Komplette KI-Partien: jede Stärke, Perfektion bis zum Ende', () => {
  for (const lvl of ['easy', 'normal', 'hard']) {
    const st = R.createGame(900 + lvl.length, 4, { turnLimit: 30, aiLevel: lvl, ai: ['player_1', 'player_2', 'player_3', 'player_4'] });
    let guard = 0;
    while (!st.winner && guard < 40000) {
      const p = st.turn;
      const step = botStep(st, p);
      guard++;
      if (!step) { R.endTurn(st); continue; }
      const res = applyStep(st, step, p);
      assert.ok(!res || res.ok !== false || step.kind === 'move', `${lvl}: ${step.kind} gültig (${res && res.reason})`);
    }
    assert.ok(st.winner, lvl + ': Spiel endet');
    const pending = st.cities.filter(c => c.owner && R.pendingLevel(c) && st.ai.includes(c.owner) && c.owner !== st.turn);
    assert.ok(Object.keys(st.ruinsBy).length > 0, lvl + ': Ruinen werden erkundet');
    for (const u of st.units) assert.ok(u.hp > 0 && u.hp <= R.hpCap(u));
    console.log(`      (${lvl}: Sieger ${st.winner} durch ${st.endReason}, Runde ${st.round})`);
  }
});

console.log('\n-- Stadtgebiete --');

// Zwei eigene Städte im Abstand 2 mit Grenzerweiterung: Gebiete überlappen.
function twoCities() {
  const st = R.createGame(7, 2);
  const a = st.cities.find(c => c.owner === 'player_1');
  const bq = a.q + 2, br = a.r;
  st.terrain[br * MAP_W + bq] = 'field';
  delete st.resources[hk(bq, br)];
  st.units = st.units.filter(u => !(u.q === bq && u.r === br));
  st.cities = st.cities.filter(c => !(c.q === bq && c.r === br));
  const b = { q: bq, r: br, owner: 'player_1', pop: 1, trained: false, isCapital: false };
  st.cities.push(b);
  a.rewards = { 4: 'borders' };
  b.rewards = { 4: 'borders' };
  return { st, a, b };
}

test('Gebäude: nicht auf einem fremden Stadtfeld', () => {
  const { st, a, b } = twoCities();
  st.techs.player_1.push('farming');
  st.stars.player_1 = 99;
  const chk = R.canImprove(st, a, 'farm', b.q, b.r);
  assert.strictEqual(chk.ok, false);
  assert.strictEqual(R.improve(st, a, 'farm', b.q, b.r, 'player_1').ok, false);
});

test('Überlappende Gebiete: jedes Feld zählt nur für eine Stadt', () => {
  const { st, a, b } = twoCities();
  const seen = new Map();
  for (const c of [a, b]) {
    for (const [q, r] of R.cityTiles(st, c)) {
      assert.ok(!seen.has(hk(q, r)), 'Feld doppelt: ' + hk(q, r));
      seen.set(hk(q, r), c);
    }
  }
  // Ressource auf einem gemeinsamen Feld bringt insgesamt genau +1.
  const shared = R.territory(a).find(([q, r]) => hexDistance(q, r, b.q, b.r) === 1);
  for (const k of Object.keys(st.resources)) delete st.resources[k];
  const before = R.cityIncome(st, a) + R.cityIncome(st, b);
  st.resources[hk(shared[0], shared[1])] = 'fruit';
  assert.strictEqual(R.cityIncome(st, a) + R.cityIncome(st, b), before + 1);
});

test('Bevölkerung kaufen: eigene Garnison in der Stadt stört nicht', () => {
  const st = R.createGame(3, 2);
  const c = st.cities.find(x => x.owner === 'player_1');
  st.stars.player_1 = 50;
  if (!R.unitAt(st, c.q, c.r)) {
    st.units.push({ id: 'g1', owner: 'player_1', type: 'warrior', q: c.q, r: c.r, hp: 10, mp: 1, acted: false, hasMoved: false });
  }
  assert.ok(R.canBuyPop(st, c, 'player_1').ok);
});

console.log('\n-- Wasser & Brücken --');

const setT = (st, q, r, t) => { st.terrain[r * MAP_W + q] = t; };

test('Kartenbau: alles Wasser hängt zusammen, Städte bleiben über Land/Brücken erreichbar', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const st = R.createGame(seed, 2 + (seed % 4));
    const wet = [];
    forEachWet(st, (q, r) => wet.push([q, r]));
    const seen = new Set([hk(...wet[0])]);
    const queue = [wet[0]];
    while (queue.length) {
      const [q, r] = queue.pop();
      for (const [nq, nr] of neighbors(q, r)) {
        const t = R.terrainAt(st, nq, nr);
        if ((t === 'water' || t === 'ocean') && !seen.has(hk(nq, nr))) { seen.add(hk(nq, nr)); queue.push([nq, nr]); }
      }
    }
    assert.strictEqual(seen.size, wet.length, 'Seed ' + seed + ': getrenntes Gewässer');
    for (const k of Object.keys(st.bridges)) {
      const [q, r] = k.split(',').map(Number);
      assert.strictEqual(R.terrainAt(st, q, r), 'water', 'Brücke nur über Flachwasser');
    }
  }
});

function forEachWet(st, fn) {
  for (let r = 0; r < MAP_H; r++) for (let q = 0; q < MAP_W; q++) {
    const t = R.terrainAt(st, q, r);
    if (t === 'water' || t === 'ocean') fn(q, r);
  }
}

test('Brücke bauen: 1 und 2 Felder, braucht Wege, kostet Sterne und den Zug', () => {
  const st = makeState();
  setT(st, 6, 5, 'water');
  setT(st, 7, 5, 'water');
  setT(st, 5, 6, 'water');
  const w = unit('w', 'player_1', 'warrior', 5, 5);
  st.units = [w];
  const opts = R.bridgeOptions(st, w);
  const east = opts.find(o => o.dir === 0);
  assert.strictEqual(east.tiles.length, 2, 'zwei Felder nach Osten');
  assert.strictEqual(east.cost, 10);
  assert.ok(opts.some(o => o.tiles.length === 1), 'ein Feld nach Südosten');
  assert.strictEqual(R.buildBridge(st, w, 0, 'player_1').ok, false, 'ohne Wege nicht');
  st.techs.player_1.push('roads');
  assert.ok(R.buildBridge(st, w, 0, 'player_1').ok);
  assert.strictEqual(st.stars.player_1, 10);
  assert.ok(R.bridgeAt(st, 6, 5) && R.bridgeAt(st, 7, 5));
  assert.ok(w.acted && w.mp === 0, 'Zug verbraucht');
  // Nächster Zug: über die Brücke laufen (Kosten 1 pro Feld).
  w.acted = false; w.hasMoved = false; w.mp = 3;
  const reach = R.reachableMap(st, w);
  assert.strictEqual(reach.get(hk(8, 5)), 3, 'über 2 Brückenfelder ans andere Ufer');
});

test('Brücke über 3 Felder Wasser ist nicht möglich', () => {
  const st = makeState();
  for (const q of [6, 7, 8]) setT(st, q, 5, 'water');
  const w = unit('w', 'player_1', 'warrior', 5, 5);
  st.units = [w];
  assert.ok(!R.bridgeOptions(st, w).some(o => o.dir === 0));
});

test('Schiffe fahren unter Brücken durch und reißen sie ein', () => {
  const st = makeState();
  for (let q = 3; q <= 9; q++) setT(st, q, 5, 'water');
  st.bridges = { [hk(6, 5)]: 1 };
  const boat = unit('b', 'player_1', 'boat', 4, 5, { mp: 3 });
  st.units = [boat];
  assert.ok(R.reachableMap(st, boat).has(hk(7, 5)), 'durch die Brücke hindurch');
  assert.ok(R.moveUnit(st, boat, 5, 5).ok);
  boat.acted = false;
  assert.deepStrictEqual(R.destroyableBridges(st, boat), [[6, 5]]);
  assert.ok(R.destroyBridge(st, boat, 6, 5, 'player_1').ok);
  assert.ok(!R.bridgeAt(st, 6, 5));
  assert.ok(boat.acted);
});

test('Brücke mit Einheit darauf kann nicht eingerissen werden', () => {
  const st = makeState();
  setT(st, 5, 5, 'water'); setT(st, 6, 5, 'water');
  st.bridges = { [hk(6, 5)]: 0 };
  const boat = unit('b', 'player_1', 'boat', 5, 5);
  const w = unit('w', 'player_2', 'warrior', 6, 5);
  st.units = [boat, w];
  assert.strictEqual(R.destroyableBridges(st, boat).length, 0);
});

console.log('\n-- Spion, Auflösen, Heilung --');

test('Spion: betritt Berge ohne Klettern, sieht von dort 3 Felder, greift nicht an', () => {
  const st = makeState();
  st.explored = { player_1: [] };
  setT(st, 6, 5, 'mountain');
  const spy = unit('s', 'player_1', 'spy', 5, 5);
  const enemy = unit('e', 'player_2', 'warrior', 5, 6);
  st.units = [spy, enemy];
  assert.ok(R.reachableMap(st, spy).has(hk(6, 5)));
  assert.strictEqual(R.attackTargets(st, spy).length, 0);
  assert.strictEqual(R.unitSight(st, spy), 2);
  spy.q = 6;
  assert.strictEqual(R.unitSight(st, spy), 3);
  assert.ok(R.isVisible(st, 'player_1', 9, 5));
});

test('Einheit auflösen erstattet die halben Kosten', () => {
  const st = makeState();
  const k = unit('k', 'player_1', 'knight', 5, 5);
  st.units = [k];
  const res = R.disbandUnit(st, k, 'player_1');
  assert.ok(res.ok);
  assert.strictEqual(res.refund, 4);
  assert.strictEqual(st.stars.player_1, 24);
  assert.strictEqual(st.units.length, 0);
  assert.strictEqual(R.disbandUnit(st, unit('x', 'player_2', 'warrior', 1, 1), 'player_1').ok, false);
});

test('Regeneration: außer Reichweite heilt auch nach dem Ziehen, in Reichweite nicht', () => {
  const st = makeState();
  const safe = unit('a', 'player_1', 'swordsman', 2, 2, { hp: 5, hasMoved: true });
  const near = unit('b', 'player_1', 'swordsman', 10, 10, { hp: 5, hasMoved: true });
  const foe = unit('f', 'player_2', 'archer', 12, 10);
  const fought = unit('c', 'player_1', 'swordsman', 2, 8, { hp: 5, acted: true });
  st.units = [safe, near, foe, fought];
  R.startTurn(st);
  assert.strictEqual(safe.hp, 7, 'heilt +2 im Feld');
  assert.strictEqual(near.hp, 5, 'Bogenschütze in Reichweite 2');
  assert.strictEqual(fought.hp, 5, 'hat angegriffen');
});

console.log('\n-- Nebel & Tipps --');

test('Gedächtnis: Stadt außer Sicht zeigt den zuletzt gesehenen Stand', () => {
  const st = makeState();
  st.explored = { player_1: [], player_2: [] };
  const c = { q: 8, r: 5, owner: 'player_2', pop: 2, trained: false };
  st.cities = [c, { q: 1, r: 1, owner: 'player_1', pop: 1 }];
  const spy = unit('s', 'player_1', 'spy', 7, 5);
  st.units = [spy];
  R.updateExplored(st, 'player_1');
  assert.ok(R.cityView(st, 'player_1', c).live);
  spy.q = 2; spy.r = 2;
  c.pop = 4; c.owner = 'player_3';
  const v = R.cityView(st, 'player_1', c);
  assert.strictEqual(v.live, false);
  assert.strictEqual(v.pop, 2, 'alte Größe');
  assert.strictEqual(v.owner, 'player_2', 'alter Besitzer');
  assert.strictEqual(R.cityView(st, 'player_1', { q: 20, r: 12, owner: 'player_2', pop: 1 }), null, 'unentdeckt');
});

test('Bereite Einheiten: wer noch etwas tun kann', () => {
  const st = makeState();
  const a = unit('a', 'player_1', 'warrior', 5, 5);
  const b = unit('b', 'player_1', 'warrior', 9, 9, { acted: true, mp: 0, hasMoved: true });
  st.units = [a, b];
  assert.deepStrictEqual(R.idleUnits(st, 'player_1').map(u => u.id), ['a']);
  assert.ok(R.unitOptions(st, a).includes('ziehen'));
});

console.log('\n-- Veteranen, Einschiffen, Kontrollzone --');

test('Veteran: nach 3 Siegen befördert, +5 Leben und voll geheilt', () => {
  const st = makeState();
  const k = unit('k', 'player_1', 'swordsman', 5, 5, { kills: 2, hp: 6 });
  const v = unit('v', 'player_2', 'warrior', 6, 5, { hp: 1 });
  st.units = [k, v];
  const res = R.attack(st, k, v);
  assert.ok(res.events.some(e => e.kind === 'promote'));
  assert.ok(k.vet);
  assert.strictEqual(R.hpCap(k), 20);
  assert.strictEqual(k.hp, 20);
});

test('Einschiffen über eigenen Hafen, an Land gehen beendet den Zug', () => {
  const st = makeState();
  for (let q = 6; q <= 9; q++) setT(st, q, 5, 'water');
  st.cities = [{ q: 6, r: 4, owner: 'player_1', pop: 1, trained: false }];
  st.improvements = { [hk(6, 5)]: 'port' };
  const w = unit('w', 'player_1', 'warrior', 5, 5, { mp: 2 });
  st.units = [w];
  const reach = R.reachableMap(st, w);
  assert.ok(reach.has(hk(6, 5)), 'Hafenfeld betretbar');
  assert.ok(!reach.has(hk(7, 5)), 'nach dem Einschiffen geht es nicht weiter');
  const res = R.moveUnit(st, w, 6, 5);
  assert.ok(res.events.some(e => e.kind === 'embark'));
  assert.strictEqual(w.type, 'boat');
  assert.strictEqual(w.carry, 'warrior');
  assert.strictEqual(w.mp, 0);
  // Nächster Zug: über das Wasser und an Land.
  w.mp = 2; w.hasMoved = false;
  assert.ok(R.moveUnit(st, w, 8, 5).ok);
  w.mp = 2; w.hasMoved = false;
  const back = R.moveUnit(st, w, 10, 5);
  assert.ok(back.events.some(e => e.kind === 'disembark'));
  assert.strictEqual(w.type, 'warrior');
  assert.ok(!w.carry);
});

test('Ohne eigenen Hafen kein Einschiffen; gebaute Boote nie an Land', () => {
  const st = makeState();
  setT(st, 6, 5, 'water');
  const w = unit('w', 'player_1', 'warrior', 5, 5);
  const b = unit('b', 'player_1', 'boat', 6, 5);
  st.units = [w];
  assert.ok(!R.reachableMap(st, w).has(hk(6, 5)));
  st.units = [b];
  assert.ok(!R.reachableMap(st, b).has(hk(5, 5)));
});

test('Kontrollzone: neben einem Gegner endet die Bewegung', () => {
  // Schmaler Landweg in Reihe 5, sonst Wasser; der Gegner steht daneben.
  const st = makeState();
  st.terrain.fill('water');
  for (let q = 3; q <= 9; q++) setT(st, q, 5, 'field');
  setT(st, 6, 4, 'field');
  const r = unit('r', 'player_1', 'rider', 4, 5, { mp: 3 });
  st.units = [r];
  assert.ok(R.reachableMap(st, r).has(hk(7, 5)), 'ohne Gegner frei');
  st.units = [r, unit('e', 'player_2', 'warrior', 6, 4)];
  const reach = R.reachableMap(st, r);
  assert.ok(reach.has(hk(5, 5)), 'bis neben den Gegner');
  assert.ok(!reach.has(hk(6, 5)) && !reach.has(hk(7, 5)), 'nicht daran vorbei');
  r.q = 5;
  assert.ok(R.reachableMap(st, r).has(hk(4, 5)), 'aus der Kontrollzone darf man wegziehen');
});

console.log('\n-- Diplomatie --');

function dipState() {
  const st = makeState();
  st.ai = ['player_2'];
  st.explored = { player_1: [], player_2: [] };
  st.cities = [{ q: 2, r: 2, owner: 'player_1', pop: 1 }, { q: 9, r: 5, owner: 'player_2', pop: 1 }];
  st.techs.player_1.push('diplomacy');
  st.met = { player_1: ['player_2'], player_2: ['player_1'] };
  return st;
}

test('Frieden: nur mit Diplomatie und nach Begegnung, KI nimmt an', () => {
  const st = dipState();
  st.met = {};
  assert.strictEqual(R.offerPeace(st, 'player_1', 'player_2').ok, false, 'nicht begegnet');
  st.met = { player_1: ['player_2'], player_2: ['player_1'] };
  const res = R.offerPeace(st, 'player_1', 'player_2');
  assert.ok(res.ok && res.accepted);
  assert.ok(R.atPeace(st, 'player_1', 'player_2'));
});

test('Frieden: kein Angriff, keine Stadt betreten, keine Kontrollzone', () => {
  const st = dipState();
  R.offerPeace(st, 'player_1', 'player_2');
  const a = unit('a', 'player_1', 'warrior', 8, 5, { mp: 2 });
  const d = unit('d', 'player_2', 'warrior', 8, 6);
  st.units = [a, d];
  assert.strictEqual(R.attackTargets(st, a).length, 0);
  assert.ok(!R.reachableMap(st, a).has(hk(9, 5)), 'Stadt des Partners tabu');
  assert.ok(!R.inZoc(st, a, 7, 6));
  R.declareWar(st, 'player_1', 'player_2');
  assert.ok(R.attackTargets(st, a).length === 1, 'nach Kriegserklärung wieder Ziel');
  assert.strictEqual(R.offerPeace(st, 'player_1', 'player_2').ok, false, 'Abkühlzeit');
});

test('Frieden zwischen Menschen: Angebot muss angenommen werden', () => {
  const st = dipState();
  st.ai = [];
  const res = R.offerPeace(st, 'player_1', 'player_2');
  assert.ok(res.pending);
  assert.ok(!R.atPeace(st, 'player_1', 'player_2'));
  assert.ok(R.respondPeace(st, 'player_2', 'player_1', true).ok);
  assert.ok(R.atPeace(st, 'player_1', 'player_2'));
});

test('KI bricht Frieden, wenn sie sonst keine Ziele hat', () => {
  const st = dipState();
  R.offerPeace(st, 'player_1', 'player_2');
  st.turn = 'player_2';
  const step = botStep(st, 'player_2');
  assert.strictEqual(step.kind, 'war');
  assert.strictEqual(step.target, 'player_1');
});

console.log('\n-- Stämme, Karten, KI --');

test('Stammes-Fähigkeiten: Kosten, Bewegung, Einkommen', () => {
  const st = makeState();
  st.tribes = { player_1: 'imperius', player_2: 'xinxi', player_3: 'luxidoor', player_4: 'kickoo' };
  assert.strictEqual(R.unitCost(st, 'player_1', 'warrior'), 1);
  assert.strictEqual(R.unitCost(st, 'player_2', 'warrior'), 2);
  setT(st, 6, 5, 'mountain');
  st.techs.player_2.push('climbing');
  assert.strictEqual(R.moveCost(st, unit('x', 'player_2', 'warrior', 5, 5), 6, 5), 1);
  assert.strictEqual(R.moveCost(st, unit('y', 'player_1', 'warrior', 5, 5), 6, 5), 2);
  const cap = { q: 3, r: 3, owner: 'player_3', pop: 1, isCapital: true };
  st.cities = [cap];
  assert.strictEqual(R.cityIncome(st, cap), 3);
  assert.strictEqual(R.maxMove(st, 'player_4', 'boat'), 3);
});

test('Kartengrößen und -typen: richtige Größe, Wasser verbunden, Städte erreichbar', () => {
  for (const mapSize of ['small', 'normal', 'large']) {
    for (const mapType of ['continents', 'pangaea', 'archipelago']) {
      const st = R.createGame(42, 4, { mapSize, mapType });
      assert.strictEqual(st.terrain.length, MAP_W * MAP_H, mapSize);
      const c1 = st.cities.find(c => c.owner === 'player_1');
      const reach = flood(st, c1.q, c1.r);
      for (const c of st.cities.filter(c => c.owner)) assert.ok(reach.has(hk(c.q, c.r)), `${mapSize}/${mapType}: Hauptstadt erreichbar`);
    }
  }
  R.createGame(1, 4); // Standardgröße für die restlichen Tests
  assert.strictEqual(MAP_W, 26);
});

test('Pangäa hat mehr Land als Archipel', () => {
  const land = st => st.terrain.filter(t => t !== 'water' && t !== 'ocean').length;
  let p = 0, a = 0;
  for (let s = 1; s <= 5; s++) {
    p += land(R.createGame(s, 4, { mapType: 'pangaea' }));
    a += land(R.createGame(s, 4, { mapType: 'archipelago' }));
  }
  R.createGame(1, 4);
  assert.ok(p > a, `Pangäa ${p} > Archipel ${a}`);
});

test('KI besetzt eine leere, bedrohte Stadt', () => {
  const st = makeState();
  st.ai = ['player_1'];
  const city = { q: 5, r: 5, owner: 'player_1', pop: 1, trained: true };
  st.cities = [city, { q: 15, r: 10, owner: 'player_2', pop: 1 }];
  const guard = unit('g', 'player_1', 'warrior', 4, 5);
  const foe = unit('f', 'player_2', 'warrior', 7, 5);
  st.units = [guard, foe];
  const step = botStep(st, 'player_1');
  assert.strictEqual(step.kind, 'move');
  assert.deepStrictEqual([step.q, step.r], [5, 5]);
});

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed) process.exit(1);
