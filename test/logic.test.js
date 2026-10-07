import assert from 'node:assert';
import * as R from '../js/rules.js';
import { UNITS, TERRAIN, MAP_W, MAP_H, MAX_HP, START_STARS, MAX_POP } from '../js/config.js';
import { hk, hexDistance, neighbors, inBounds } from '../js/hex.js';
import { botStep } from '../js/ai.js';

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
      if (!TERRAIN[R.terrainAt(state, nq, nr)].walkable) continue;
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
    assert.ok(TERRAIN[R.terrainAt(state, u.q, u.r)].walkable, 'unit on unwalkable tile');
    const k = hk(u.q, u.r);
    assert.ok(!seen.has(k), 'two units on same tile: ' + k);
    seen.add(k);
    assert.ok(u.hp >= 1 && u.hp <= MAX_HP, 'hp out of range');
    assert.ok(UNITS[u.type], 'unknown unit type');
    assert.ok(state.stars[u.owner] >= 0, 'negative stars');
  }
  for (const c of state.cities) {
    assert.ok(inBounds(c.q, c.r), 'city out of bounds');
    assert.ok(TERRAIN[R.terrainAt(state, c.q, c.r)].walkable, 'city unwalkable');
    assert.ok(c.pop >= 1 && c.pop <= MAX_POP, 'city pop out of range');
    assert.ok(c.owner === null || c.owner === 'player_1' || c.owner === 'player_2', 'bad owner');
  }
}

function makeState() {
  return {
    terrain: Array(MAP_W * MAP_H).fill('plains'),
    cities: [], units: [],
    stars: { player_1: 10, player_2: 10 },
    techs: { player_1: [], player_2: [] },
    turn: 'player_1', round: 1, winner: null
  };
}

function unit(id, owner, type, q, r, extra = {}) {
  return { id, owner, type, q, r, hp: MAX_HP, mp: UNITS[type].move, acted: false, ...extra };
}

console.log('\n-- Erzeugung --');

test('createGame: Grundinvarianten über mehrere Seeds', () => {
  for (let i = 0; i < 10; i++) {
    const st = R.createGame(1000 + i);
    assertInvariants(st);
    assert.strictEqual(st.terrain.length, MAP_W * MAP_H);
    assert.ok(st.cities.length >= 4, 'min 4 Städte, got ' + st.cities.length);
    assert.strictEqual(st.cities.filter(c => c.owner === 'player_1').length, 1);
    assert.strictEqual(st.cities.filter(c => c.owner === 'player_2').length, 1);
    assert.strictEqual(st.units.filter(u => u.owner === 'player_1').length, 2);
    assert.strictEqual(st.units.filter(u => u.owner === 'player_2').length, 2);
    assert.strictEqual(st.stars.player_1, START_STARS + 2, 'P1 bekommt Starteinkommen');
    assert.strictEqual(st.stars.player_2, START_STARS);
    assert.strictEqual(st.turn, 'player_1');
    assert.strictEqual(st.winner, null);
  }
});

test('createGame: alle Städte und Starteinheiten erreichbar', () => {
  for (let i = 0; i < 5; i++) {
    const st = R.createGame(500 + i);
    const c1 = st.cities.find(c => c.owner === 'player_1');
    const reach = flood(st, c1.q, c1.r);
    for (const c of st.cities) assert.ok(reach.has(hk(c.q, c.r)), 'city unreachable');
    for (const u of st.units) assert.ok(reach.has(hk(u.q, u.r)), 'unit unreachable');
  }
});

test('hex: Nachbarfelder haben Distanz 1', () => {
  for (const [nq, nr] of neighbors(5, 5)) {
    assert.strictEqual(hexDistance(5, 5, nq, nr), 1);
  }
});

console.log('\n-- Bewegung --');

test('reachableMap: Warrior max. 2 Felder, unwalkable gesperrt', () => {
  const st = makeState();
  st.terrain[5 * MAP_W + 5] = 'mountain';
  st.terrain[7 * MAP_W + 6] = 'water';
  const u = unit('x', 'player_1', 'warrior', 6, 5);
  st.units = [u];
  const reach = R.reachableMap(st, u);
  assert.ok(reach.has('6,6'), 'adjacent reachable');
  assert.ok(!reach.has('5,5'), 'mountain blocked');
  assert.ok(!reach.has('6,7'), 'water blocked');
  for (const [k, cost] of reach) {
    assert.ok(cost <= 2, 'cost exceeds mp');
    const [q, r] = k.split(',').map(Number);
    assert.ok(TERRAIN[R.terrainAt(st, q, r)].walkable, 'unwalkable in reach');
  }
  u.mp = 0;
  assert.strictEqual(R.reachableMap(st, u).size, 0, 'no mp -> no reach');
  u.mp = 2;
  u.acted = true;
  assert.strictEqual(R.reachableMap(st, u).size, 0, 'acted -> no reach');
});

test('reachableMap: Einheiten blockieren Durchgang', () => {
  const st = makeState();
  const u = unit('a', 'player_1', 'warrior', 6, 5);
  const blocker = unit('b', 'player_2', 'warrior', 6, 6);
  st.units = [u, blocker];
  const reach = R.reachableMap(st, u);
  assert.ok(!reach.has('6,6'), 'enemy hex not enterable');
  assert.ok(!reach.has('6,7'), 'cannot pass through enemy');
});

test('moveUnit: Wald kostet 2 Bewegung', () => {
  const st = makeState();
  st.terrain[7 * MAP_W + 6] = 'forest';
  const u = unit('a', 'player_1', 'warrior', 6, 6);
  st.units = [u];
  const res = R.moveUnit(st, u, 6, 7);
  assert.ok(res.ok);
  assert.deepStrictEqual([u.q, u.r], [6, 7]);
  assert.strictEqual(u.mp, 0, 'forest costs the full move');
});

test('moveUnit: ungültiges Ziel wird abgelehnt', () => {
  const st = makeState();
  const u = unit('a', 'player_1', 'warrior', 6, 6);
  st.units = [u];
  assert.ok(!R.moveUnit(st, u, -1, 0).ok, 'out of bounds');
  assert.ok(!R.moveUnit(st, u, 6, 9).ok, 'beyond mp');
  assert.deepStrictEqual([u.q, u.r], [6, 6]);
});

console.log('\n-- Kampf --');

test('Krieger vs Krieger: Schaden und Vergeltung', () => {
  const st = makeState();
  const a = unit('a', 'player_1', 'warrior', 5, 5);
  const d = unit('b', 'player_2', 'warrior', 5, 6);
  st.units = [a, d];
  const res = R.attack(st, a, d);
  const dmgEv = res.events.find(e => e.kind === 'damage');
  assert.ok(dmgEv && dmgEv.dmg >= 1 && dmgEv.dmg <= 5, 'reasonable damage');
  assert.ok(d.hp < 10, 'defender damaged');
  assert.ok(a.hp < 10, 'attacker took retaliation');
  assert.ok(a.acted && a.mp === 0, 'attacker done');
  assertInvariants(st);
});

test('Schütze: Reichweite 2, keine Vergeltung', () => {
  const st = makeState();
  const a = unit('a', 'player_1', 'archer', 5, 5);
  const d = unit('b', 'player_2', 'warrior', 5, 7);
  st.units = [a, d];
  assert.strictEqual(R.attackTargets(st, a).length, 1, 'archer sees distance 2');
  const far = unit('c', 'player_2', 'warrior', 5, 8);
  st.units.push(far);
  assert.strictEqual(R.attackTargets(st, a).length, 1, 'distance 3 out of range');
  const res = R.attack(st, a, d);
  assert.ok(!res.events.some(e => e.kind === 'retaliate'), 'no retaliation from range 2');
  assert.strictEqual(a.hp, 10);
});

test('Verteidiger nimmt weniger Schaden als Krieger', () => {
  const st = makeState();
  const a1 = unit('a1', 'player_1', 'warrior', 5, 5);
  const d1 = unit('d1', 'player_2', 'warrior', 5, 6);
  st.units = [a1, d1];
  const dmgWarrior = R.attack(st, a1, d1).events.find(e => e.kind === 'damage').dmg;

  const a2 = unit('a2', 'player_1', 'warrior', 7, 5);
  const d2 = unit('d2', 'player_2', 'defender', 7, 6);
  st.units.push(a2, d2);
  const dmgDefender = R.attack(st, a2, d2).events.find(e => e.kind === 'damage').dmg;
  assert.ok(dmgDefender < dmgWarrior, `${dmgDefender} < ${dmgWarrior}`);
});

test('Wald gibt Verteidigungsbonus', () => {
  const st = makeState();
  const a1 = unit('a1', 'player_1', 'warrior', 5, 5);
  const d1 = unit('d1', 'player_2', 'warrior', 5, 6);
  st.units = [a1, d1];
  const dmgPlain = R.attack(st, a1, d1).events.find(e => e.kind === 'damage').dmg;

  st.terrain[6 * MAP_W + 7] = 'forest';
  const a2 = unit('a2', 'player_1', 'warrior', 7, 5);
  const d2 = unit('d2', 'player_2', 'warrior', 7, 6);
  st.units.push(a2, d2);
  const dmgForest = R.attack(st, a2, d2).events.find(e => e.kind === 'damage').dmg;
  assert.ok(dmgForest < dmgPlain, `forest: ${dmgForest} < plain: ${dmgPlain}`);
});

test('Töten entfernt die Einheit', () => {
  const st = makeState();
  const a = unit('a', 'player_1', 'swordsman', 5, 5);
  const d = unit('b', 'player_2', 'archer', 5, 6, { hp: 2 });
  st.units = [a, d];
  const res = R.attack(st, a, d);
  assert.ok(res.killed);
  assert.strictEqual(st.units.length, 1);
  assertInvariants(st);
});

test('Angreifen nur bei gegnerischer Einheit in Reichweite', () => {
  const st = makeState();
  const a = unit('a', 'player_1', 'warrior', 5, 5);
  const own = unit('o', 'player_1', 'warrior', 5, 6);
  const enemyFar = unit('e', 'player_2', 'warrior', 5, 8);
  st.units = [a, own, enemyFar];
  assert.strictEqual(R.attackTargets(st, a).length, 0, 'keine Ziele');
  a.acted = true;
  const near = unit('n', 'player_2', 'warrior', 5, 6);
  st.units = [a, near];
  assert.strictEqual(R.attackTargets(st, a).length, 0, 'acted -> keine Ziele');
});

console.log('\n-- Städte & Ökonomie --');

test('Erobern neutrale Stadt und Sieg bei letzter feindlicher Stadt', () => {
  const st = makeState();
  st.cities = [
    { q: 3, r: 3, owner: 'player_1', pop: 2, trained: false },
    { q: 8, r: 8, owner: 'player_2', pop: 1, trained: false },
    { q: 6, r: 6, owner: null, pop: 2, trained: false }
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
  st.stars.player_1 = 10;

  let res = R.trainUnit(st, city, 'warrior', 'player_1');
  assert.ok(res.ok, 'warrior trainierbar');
  assert.strictEqual(st.stars.player_1, 8);
  assert.strictEqual(st.units.length, 1);
  assert.deepStrictEqual([st.units[0].q, st.units[0].r], [3, 3]);

  res = R.trainUnit(st, city, 'warrior', 'player_1');
  assert.ok(!res.ok, 'bereits ausgebildet');

  city.trained = false;
  st.units = [];
  res = R.trainUnit(st, city, 'archer', 'player_1');
  assert.ok(!res.ok, 'Tech fehlt');

  st.techs.player_1.push('jagd');
  res = R.trainUnit(st, city, 'archer', 'player_1');
  assert.ok(res.ok, 'nach Forschung ok');
  assert.strictEqual(st.stars.player_1, 8 - UNITS.archer.cost);
});

test('Ausbilden in besetzter Stadt verweigert', () => {
  const st = makeState();
  const city = { q: 3, r: 3, owner: 'player_1', pop: 2, trained: false };
  st.cities = [city];
  st.units = [unit('u', 'player_1', 'warrior', 3, 3)];
  const res = R.trainUnit(st, city, 'warrior', 'player_1');
  assert.ok(!res.ok);
  assert.strictEqual(res.reason, 'Stadt besetzt');
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

test('Forschung: Reihenfolge, doppelt verboten, Ackerbau-Einkommen', () => {
  const st = makeState();
  st.cities = [{ q: 3, r: 3, owner: 'player_1', pop: 2, trained: false }];
  st.stars.player_1 = 100;

  const base = R.incomeFor(st, 'player_1');
  assert.strictEqual(base, 2, 'Einkommen = Bevölkerung');
  assert.ok(!R.research(st, 'reitkunst', 'player_1').ok, 'Voraussetzung jagd fehlt');
  assert.ok(R.research(st, 'jagd', 'player_1').ok);
  assert.ok(!R.research(st, 'jagd', 'player_1').ok, 'nicht doppelt');
  assert.ok(R.research(st, 'ackerbau', 'player_1').ok);
  assert.strictEqual(R.incomeFor(st, 'player_1'), 3, 'Ackerbau +1 pro Stadt');
  assert.ok(R.research(st, 'bergbau', 'player_1').ok, 'Voraussetzung ackerbau erfüllt');
});

test('Zug beenden: Reset, Einkommen, Rundenzähler', () => {
  const st = R.createGame(4242);
  for (const u of st.units.filter(u => u.owner === 'player_1')) { u.acted = true; u.mp = 0; }
  const starsBefore = st.stars.player_2;
  const roundBefore = st.round;

  R.endTurn(st);
  assert.strictEqual(st.turn, 'player_2');
  assert.strictEqual(st.round, roundBefore);
  assert.ok(st.stars.player_2 > starsBefore, 'Einkommen zu Rundenbeginn');
  for (const u of st.units.filter(u => u.owner === 'player_2')) {
    assert.ok(!u.acted && u.mp === UNITS[u.type].move, 'P2-Einheiten aktiv');
  }
  for (const u of st.units.filter(u => u.owner === 'player_1')) {
    assert.ok(u.acted && u.mp === 0, 'P1-Einheiten bleiben erschöpft');
  }

  R.endTurn(st);
  assert.strictEqual(st.turn, 'player_1');
  assert.strictEqual(st.round, roundBefore + 1, 'Runde +1');
  for (const u of st.units.filter(u => u.owner === 'player_1')) {
    assert.ok(!u.acted && u.mp === UNITS[u.type].move, 'P1-Einheiten zurückgesetzt');
  }
});

console.log('\n-- KI-Simulation --');

test('Bot vs Bot: 25 Runden ohne Verletzungen', () => {
  const st = R.createGame(777);
  let guard = 0;
  for (let round = 0; round < 25 && !st.winner; round++) {
    for (const player of ['player_1', 'player_2']) {
      let steps = 0;
      while (st.turn === player && !st.winner) {
        const step = botStep(st, player);
        if (!step) break;
        let res;
        if (step.kind === 'attack') res = R.attack(st, step.attacker, step.defender);
        else if (step.kind === 'move') res = R.moveUnit(st, step.unit, step.q, step.r);
        else if (step.kind === 'train') res = R.trainUnit(st, step.city, step.type, player);
        else if (step.kind === 'buyPop') res = R.buyPop(st, step.city, player);
        else if (step.kind === 'research') res = R.research(st, step.tech, player);
        else throw new Error('unknown step ' + step.kind);
        if (res && res.ok === false) throw new Error(`${step.kind} fehlgeschlagen: ${res.reason}`);
        assertInvariants(st);
        steps++;
        if (steps > 200) throw new Error('Bot-Loop über 200 Schritte');
        if (++guard > 8000) throw new Error('globale Sicherung ausgelöst');
      }
      if (st.turn === player && !st.winner) R.endTurn(st);
      assertInvariants(st);
    }
  }
  assert.ok(st.round >= 2, 'Fortschritt im Spiel');
  if (st.winner) console.log('      (Sieger nach ' + st.round + ' Runden: ' + st.winner + ')');
  else console.log('      (nach ' + st.round + ' Runden noch offen, Städte: ' +
    st.cities.filter(c => c.owner === 'player_1').length + ':' +
    st.cities.filter(c => c.owner === 'player_2').length + ')');
});

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed) process.exit(1);
