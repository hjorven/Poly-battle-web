import assert from 'node:assert';
import * as R from '../js/rules.js';
import {
  UNITS, TERRAIN, MAP_W, MAP_H, START_STARS, MAX_POP, TRIBES,
  RESOURCES, IMPROVEMENTS, LIGHTHOUSE, SCORE, TECHS, MONUMENT_POP, ROAD, BOUNTY
} from '../js/config.js';
import { hk, hexDistance, neighbors, inBounds, forEachHex } from '../js/hex.js';
import { botStep, applyStep, knownState } from '../js/ai.js';
import { saveGame, loadGame, saveInfo, clearSave, validState } from '../js/save.js';
import * as P from '../js/profile.js';
import * as K from '../js/campaign.js';
import * as A from '../js/admin.js';

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
      const n = st.units.filter(u => u.owner === owner).length;
      // Ein Boot ohne Wasser in der Nähe wird durch Sterne ersetzt.
      assert.ok(n === tribe.startUnits.length || (tribe.startUnits.includes('boat') && n === tribe.startUnits.length - 1), owner + ' Starteinheiten');
      const boatRefund = n < tribe.startUnits.length ? UNITS.boat.cost : 0;
      const expected = START_STARS + tribe.bonusStars + boatRefund + (owner === 'player_1' ? R.incomeFor(st, owner) : 0);
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

test('Wege: im eigenen Gebiet kosten Wald und Berg nur 1 Bewegung', () => {
  const st = makeState();
  st.terrain[5 * MAP_W + 6] = 'forest';
  st.terrain[8 * MAP_W + 9] = 'forest';
  st.cities = [{ q: 5, r: 5, owner: 'player_1', pop: 1 }];
  const u = unit('u', 'player_1', 'warrior', 5, 5);
  assert.strictEqual(R.moveCost(st, u, 6, 5), 2, 'ohne Wege');
  st.techs.player_1.push('riding', 'roads');
  assert.strictEqual(R.moveCost(st, u, 6, 5), 1, 'eigenes Gebiet');
  assert.strictEqual(R.moveCost(st, u, 9, 8), 2, 'außerhalb des Gebiets');
  assert.strictEqual(R.moveCost(st, unit('e', 'player_2', 'warrior', 7, 5), 6, 5), 2, 'fremdes Gebiet');
  assert.strictEqual(R.maxMove(st, 'player_1', 'rider'), UNITS.rider.move, 'keine Extra-Bewegung');
});

test('Stufe 4: Boni wirken (Kosten, Angriff, Bewegung, Einkommen, Heilung)', () => {
  const st = makeState();
  const city = { q: 5, r: 5, owner: 'player_1', pop: 3 };
  st.cities = [city];
  const base = R.incomeFor(st, 'player_1');
  st.techs.player_1.push('banking', 'scholarship');
  assert.strictEqual(R.incomeFor(st, 'player_1'), base + 2, 'Bankwesen + Gelehrsamkeit');
  assert.strictEqual(R.popCost(city, st), 5);
  st.techs.player_1.push('planning');
  assert.strictEqual(R.popCost(city, st), 3, 'Stadtplanung');
  assert.strictEqual(R.unitCost(st, 'player_1', 'catapult'), UNITS.catapult.cost);
  st.techs.player_1.push('engineering', 'espionage');
  assert.strictEqual(R.unitCost(st, 'player_1', 'catapult'), UNITS.catapult.cost - 3);
  assert.strictEqual(R.unitCost(st, 'player_1', 'spy'), UNITS.spy.cost - 2);
  const w = unit('w', 'player_1', 'warrior', 5, 5), e = unit('e', 'player_2', 'warrior', 6, 5);
  const before = R.battleResults(st, w, e).damage;
  st.techs.player_1.push('steel');
  assert.strictEqual(R.attackOf(st, w), UNITS.warrior.atk + 1);
  assert.ok(R.battleResults(st, w, e).damage > before, 'Stahl erhöht den Schaden');
  st.techs.player_1.push('horseshoes', 'seapower');
  assert.strictEqual(R.maxMove(st, 'player_1', 'rider'), UNITS.rider.move + 1);
  assert.strictEqual(R.maxMove(st, 'player_1', 'ship'), UNITS.ship.move + 1);
  assert.strictEqual(R.maxMove(st, 'player_1', 'knight'), UNITS.knight.move);
  st.techs.player_1.push('medicine');
  const hurt = unit('h', 'player_1', 'warrior', 9, 9, { hp: 2 });
  st.units = [hurt];
  R.startTurn(st);
  assert.strictEqual(hurt.hp, 2 + 2 + 2, 'Heilkunst: +2');
  for (const [id, t] of Object.entries(TECHS)) if (t.tier === 4) assert.strictEqual(TECHS[t.req].tier, 3, id);
});

test('Monumente: Erfolg schaltet frei, einmal bauen, +3 Bevölkerung, Punkte', () => {
  const st = makeState();
  const city = { q: 5, r: 5, owner: 'player_1', pop: 1 };
  st.cities = [city];
  assert.deepStrictEqual(R.checkMonuments(st, 'player_1'), []);
  assert.ok(!R.canImprove(st, city, 'm_treasury', 6, 5).ok, 'noch gesperrt');
  st.stars.player_1 = 100;
  assert.deepStrictEqual(R.checkMonuments(st, 'player_1'), ['m_treasury']);
  st.stars.player_1 = 5;
  assert.deepStrictEqual(R.checkMonuments(st, 'player_1'), [], 'bleibt freigeschaltet, nicht doppelt');
  assert.ok(R.monumentReady(st, 'player_1', 'm_treasury'));
  const before = R.score(st, 'player_1');
  assert.ok(R.improve(st, city, 'm_treasury', 6, 5, 'player_1').ok);
  assert.strictEqual(st.stars.player_1, 5, 'kostenlos');
  assert.strictEqual(city.pop, 1 + MONUMENT_POP);
  assert.ok(R.score(st, 'player_1') >= before + SCORE.monument);
  assert.ok(!R.monumentReady(st, 'player_1', 'm_treasury'), 'nur einmal');
  assert.ok(!R.improve(st, city, 'm_treasury', 4, 5, 'player_1').ok);
  st.killsBy = { player_1: 10 };
  assert.deepStrictEqual(R.checkMonuments(st, 'player_1'), ['m_valor']);
});

test('Straßen: halbe Bewegung, Bau im Gebiet oder per Einheit, nicht in fremdem Gebiet', () => {
  const st = makeState();
  st.cities = [{ q: 5, r: 5, owner: 'player_1', pop: 1 }, { q: 12, r: 5, owner: 'player_2', pop: 1 }];
  st.stars.player_1 = 30;
  assert.ok(!R.canBuildRoad(st, 'player_1', 6, 5).ok, 'ohne Wege');
  st.techs.player_1.push('riding', 'roads');
  assert.ok(R.buildRoad(st, 'player_1', 6, 5).ok, 'im eigenen Gebiet über das Stadtmenü');
  assert.strictEqual(st.stars.player_1, 30 - ROAD.cost);
  assert.ok(!R.canBuildRoad(st, 'player_1', 8, 5).ok, 'außerhalb nur mit Einheit');
  const w = unit('w', 'player_1', 'warrior', 7, 5);
  st.units = [w];
  assert.ok(R.buildRoad(st, 'player_1', 7, 5, w).ok, 'Einheit baut auf neutralem Land');
  assert.strictEqual(w.mp, 0, 'Bewegung verbraucht');
  assert.ok(!R.canBuildRoad(st, 'player_1', 11, 5, true).ok, 'fremdes Gebiet');
  // Stadt (5,5) -> Straße (6,5) -> Straße (7,5): je 0,5
  const r = unit('r', 'player_1', 'warrior', 5, 5);
  st.units = [r];
  const reach = R.reachableMap(st, r);
  assert.strictEqual(reach.get(hk(6, 5)), 0.5);
  assert.strictEqual(reach.get(hk(7, 5)), 1);
  assert.ok(!reach.has(hk(8, 5)), 'abseits der Straße volle Kosten');
  assert.ok(R.moveUnit(st, r, 6, 5).ok);
  assert.strictEqual(r.mp, 0.5);
  assert.ok(R.reachableMap(st, r).has(hk(7, 5)), 'halber Schritt reicht für das nächste Straßenfeld');
});

test('Rückblick: Verluste anderer Spieler werden einmal gemeldet', () => {
  const st = makeState();
  st.turn = 'player_2';
  const a = unit('a', 'player_2', 'swordsman', 5, 5), d = unit('d', 'player_1', 'warrior', 6, 5, { hp: 1 });
  const h = unit('h', 'player_1', 'defender', 7, 5); // neben dem Feld, auf das der Sieger nachrückt
  st.units = [a, d, h];
  assert.ok(R.attack(st, a, d).killed);
  a.acted = false; a.hasMoved = false;
  R.attack(st, a, h);
  const news = R.takeNews(st, 'player_1');
  assert.deepStrictEqual(news.map(e => e.kind), ['unitLost', 'hit']);
  assert.strictEqual(news[0].by, 'player_2');
  assert.deepStrictEqual(R.takeNews(st, 'player_1'), [], 'nur einmal');
  assert.deepStrictEqual(R.takeNews(st, 'player_2'), [], 'eigene Taten nicht');
});

test('Schonfrist: KI greift Menschen anfangs nicht an, bis sie angegriffen wird; Beute', () => {
  const st = makeState();
  st.ai = ['player_2'];
  st.aiLevel = 'normal';
  st.cities = [{ q: 2, r: 2, owner: 'player_1', pop: 1 }, { q: 12, r: 12, owner: 'player_2', pop: 1 }];
  const mine = unit('m', 'player_1', 'warrior', 6, 5, { hp: 3 });
  const bot = unit('b', 'player_2', 'swordsman', 5, 5);
  st.units = [mine, bot];
  st.turn = 'player_2';
  assert.ok(R.graceProtects(st, 'player_2', 'player_1'));
  assert.ok(!R.graceProtects(st, 'player_1', 'player_2'), 'Menschen sind nicht gebunden');
  const step = botStep(st, 'player_2');
  assert.ok(!step || step.kind !== 'attack', 'kein Angriff in der Schonfrist');
  st.round = 7;
  assert.ok(!R.graceProtects(st, 'player_2', 'player_1'), 'nach Runde 6 vorbei');
  st.round = 2;
  st.turn = 'player_1';
  const stars = st.stars.player_1;
  bot.hp = 1;
  const res = R.attack(st, mine, bot);
  assert.ok(res.events.some(e => e.kind === 'provoke' && e.player === 'player_2'));
  assert.ok(!R.graceProtects(st, 'player_2', 'player_1'), 'angegriffen: Schonfrist dieser KI vorbei');
  assert.strictEqual(st.stars.player_1, stars + BOUNTY, 'Beute');
});

test('Profil: Stufen, Erfolge, Serie, Speichern', () => {
  assert.strictEqual(P.levelOf(0), 1);
  assert.strictEqual(P.levelOf(199), 1);
  assert.strictEqual(P.levelOf(200), 2);
  assert.strictEqual(P.levelOf(600), 3);
  const prof = P.emptyProfile();
  const st = R.createGame(11, 4, { ai: ['player_2', 'player_3', 'player_4'], aiLevel: 'normal' });
  st.endReason = 'conquest';
  st.round = 20;
  st.killsBy = { player_1: 26 };
  const facts = P.gameFacts(st, 'player_1', { won: true, mode: 'bot', score: 2000 });
  const res = P.recordGame(prof, facts);
  for (const id of ['first_win', 'win_normal', 'blitz', 'warlord']) assert.ok(res.achievements.includes(id), id);
  assert.ok(!res.achievements.includes('win_hard'));
  assert.ok(res.gain >= (100 + 150) * 1.5 + 4 * 50 - 1);
  assert.strictEqual(prof.wins, 1);
  assert.strictEqual(prof.fastestWin, 20);
  assert.strictEqual(P.recordGame(prof, facts).achievements.length, 0, 'Erfolge nur einmal');
  // Tagesserie: gestern, heute -> 2; Lücke -> 1
  const lost = { ...facts, won: false, daily: '2026-10-13' };
  assert.strictEqual(P.recordGame(prof, lost).daily.streak, 1);
  assert.strictEqual(P.recordGame(prof, { ...lost, daily: '2026-10-14', score: 50 }).daily.streak, 2);
  const again = P.recordGame(prof, { ...lost, daily: '2026-10-14', score: 3000 });
  assert.strictEqual(again.daily.streak, 2, 'gleicher Tag zählt nicht doppelt');
  assert.ok(again.daily.improved && again.daily.best === 3000);
  assert.strictEqual(P.recordGame(prof, { ...lost, daily: '2026-10-17' }).daily.streak, 1, 'Lücke');
  // Tagesherausforderung ist für ein Datum immer gleich
  assert.deepStrictEqual(P.dailyChallenge('2026-10-14'), P.dailyChallenge('2026-10-14'));
  assert.notStrictEqual(P.dailyChallenge('2026-10-14').seed, P.dailyChallenge('2026-10-15').seed);
  // Speichern/Laden mit Ersatzspeicher
  const mem = new Map(); const store = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.ok(P.saveProfile(prof, store));
  assert.deepStrictEqual(P.loadProfile(store), prof);
  assert.deepStrictEqual(P.loadProfile({ getItem: () => '{kaputt', setItem() {} }), P.emptyProfile());
});

test('Besiegte Stämme: Runde und Sieger werden vermerkt', () => {
  const st = makeState();
  st.round = 7;
  st.turn = 'player_1';
  st.cities = [{ q: 5, r: 5, owner: 'player_1', pop: 1 }, { q: 6, r: 5, owner: 'player_2', pop: 1 }, { q: 9, r: 9, owner: 'player_3', pop: 1 }];
  st.units = [unit('w', 'player_1', 'warrior', 7, 5)];
  assert.ok(R.moveUnit(st, st.units[0], 6, 5).ok);
  assert.deepStrictEqual(st.eliminated.player_2, { round: 7, by: 'player_1' });
  assert.ok(!st.eliminated.player_3);
});

test('Hafen: eine Landeinheit und zusätzlich ein Schiff pro Runde', () => {
  const st = makeState();
  const city = { q: 5, r: 5, owner: 'player_1', pop: 1 };
  st.cities = [city];
  st.terrain[5 * MAP_W + 6] = 'water';
  st.terrain[4 * MAP_W + 6] = 'water';
  st.improvements = { '6,5': 'port', '6,4': 'port' };
  st.techs.player_1.push('fishing', 'sailing');
  st.stars.player_1 = 50;
  assert.ok(R.trainUnit(st, city, 'warrior', 'player_1').ok);
  assert.ok(!R.canTrain(st, city, 'warrior', 'player_1').ok, 'zweite Landeinheit nicht');
  st.units = st.units.filter(u => u.type !== 'warrior');
  assert.ok(!R.canTrain(st, city, 'warrior', 'player_1').ok, 'auch bei freier Stadt nicht');
  assert.ok(R.trainUnit(st, city, 'boat', 'player_1').ok, 'Schiff zusätzlich');
  assert.strictEqual(R.canTrain(st, city, 'ship', 'player_1').reason, 'Schon ein Schiff gebaut', 'trotz zweitem freien Hafen nur eins');
  R.startTurn(st);
  assert.ok(R.canTrain(st, city, 'ship', 'player_1').ok, 'nächste Runde wieder');
});

test('Luftwaffe: fliegen, Nahkampf erreicht sie nicht, Fernkampf zerstört Ballone, keine Eroberung', () => {
  const st = makeState();
  st.terrain[5 * MAP_W + 6] = 'water';
  st.terrain[5 * MAP_W + 7] = 'mountain';
  st.cities = [{ q: 2, r: 2, owner: 'player_1', pop: 1 }, { q: 8, r: 5, owner: 'player_2', pop: 1 }];
  const b = unit('b', 'player_1', 'balloon', 5, 5);
  st.units = [b];
  const reach = R.reachableMap(st, b);
  assert.strictEqual(reach.get('6,5'), 1, 'über Wasser');
  assert.strictEqual(reach.get('7,5'), 2, 'über Berge ohne Klettern');
  assert.ok(!reach.has('8,5'), 'nicht in fremde Städte');
  // Nahkämpfer erreicht den Ballon nicht, Bogenschütze zerstört ihn mit einem Treffer.
  const w = unit('w', 'player_2', 'warrior', 4, 5);
  const a = unit('a', 'player_2', 'archer', 3, 5);
  st.units.push(w, a);
  assert.ok(!R.attackTargets(st, w).includes(b), 'Krieger kann nicht nach oben');
  assert.ok(R.attackTargets(st, a).includes(b));
  assert.strictEqual(R.battleResults(st, a, b).damage, b.hp, 'zerbrechlich');
  // Kriegsluftschiff: doppelter Schaden durch Fernkampf, kein Gegenschlag von Nahkämpfern.
  const ship = unit('s', 'player_1', 'airship', 5, 4);
  const plain = R.battleResults(st, a, { ...ship, type: 'swordsman', hp: 12 });
  assert.ok(R.battleResults(st, a, ship).damage >= 2, 'nimmt Schaden');
  assert.strictEqual(R.battleResults(st, ship, w).retaliation, 0, 'Krieger schlägt nicht zurück');
  // Brandballon greift Bodenziele an, wird von Fernkämpfern beim Gegenschlag zerstört.
  const fb = unit('f', 'player_1', 'fireballoon', 3, 4);
  assert.strictEqual(R.battleResults(st, fb, a).retaliation, fb.hp);
  // Keine Eroberung aus der Luft: auch neutrale Dörfer sind tabu, ein Sieg rückt nicht nach.
  st.cities[1].owner = null;
  st.units = [unit('b2', 'player_1', 'balloon', 7, 5)];
  assert.ok(!R.moveUnit(st, st.units[0], 8, 5).ok, 'Ballon betritt kein Dorf');
  const fb2 = unit('f2', 'player_1', 'fireballoon', 7, 4);
  const victim = unit('v', 'player_2', 'warrior', 7, 5, { hp: 1 });
  st.units = [fb2, victim];
  st.cities[1].owner = 'player_2';
  assert.ok(R.attack(st, fb2, victim).killed);
  assert.deepStrictEqual([fb2.q, fb2.r], [7, 4], 'rückt nicht nach');
  assert.ok(plain.damage < R.battleResults(st, a, ship).damage, 'doppelter Schaden gegen große Hülle');
});

test('Ballonplatz und Lastenballon: aufsteigen, aufnehmen, absetzen', () => {
  const st = makeState();
  const city = { q: 5, r: 5, owner: 'player_1', pop: 1 };
  st.cities = [city];
  st.techs.player_1.push('hunting', 'forestry', 'mathematics', 'engineering', 'ballooning');
  st.stars.player_1 = 50;
  assert.strictEqual(R.canTrain(st, city, 'balloon', 'player_1').reason, 'Ballonplatz nötig');
  assert.ok(R.improve(st, city, 'airfield', 6, 5, 'player_1').ok);
  assert.ok(R.trainUnit(st, city, 'cargoballoon', 'player_1').ok);
  const cb = st.units.find(u => u.type === 'cargoballoon');
  assert.deepStrictEqual([cb.q, cb.r], [6, 5], 'steigt am Ballonplatz auf');
  assert.ok(!R.canTrain(st, city, 'warrior', 'player_1').ok, 'teilt den Landbauplatz');
  const w = unit('w', 'player_1', 'warrior', 7, 5);
  st.units.push(w);
  assert.ok(R.loadCargo(st, cb, w).ok);
  assert.ok(!st.units.includes(w) && cb.cargo.type === 'warrior');
  st.terrain[5 * MAP_W + 7] = 'water';
  cb.q = 8; cb.r = 4; cb.mp = 0;
  const opts = R.unloadOptions(st, cb);
  assert.ok(opts.length && opts.every(([q, r]) => R.terrainAt(st, q, r) !== 'water'), 'nur auf Land');
  const res = R.unloadCargo(st, cb, opts[0][0], opts[0][1]);
  assert.ok(res.ok && !cb.cargo && cb.acted);
  assert.strictEqual(res.unit.type, 'warrior');
  assert.ok(st.units.includes(res.unit));
});

test('Aufrüsten: nächste Stufe gegen Preisunterschied, im eigenen Gebiet, Verletzung anteilig', () => {
  const st = makeState();
  st.cities = [{ q: 5, r: 5, owner: 'player_1', pop: 1 }];
  st.stars.player_1 = 20;
  const w = unit('w', 'player_1', 'warrior', 5, 5, { hp: 5, vet: false });
  st.units = [w];
  assert.ok(!R.upgradeOption(st, w).ok, 'ohne Schmiedekunst nicht');
  st.techs.player_1.push('climbing', 'mining', 'smithery');
  const opt = R.upgradeOption(st, w);
  assert.ok(opt.ok && opt.to === 'swordsman');
  assert.strictEqual(opt.cost, UNITS.swordsman.cost - UNITS.warrior.cost);
  assert.ok(R.upgradeUnit(st, w, 'player_1').ok);
  assert.strictEqual(w.type, 'swordsman');
  assert.strictEqual(w.hp, Math.round(5 / 10 * UNITS.swordsman.hp), 'halb verletzt bleibt halb verletzt');
  assert.ok(w.acted && w.mp === 0);
  assert.strictEqual(st.stars.player_1, 20 - opt.cost);
  const far = unit('f', 'player_1', 'warrior', 12, 12);
  st.units.push(far);
  assert.strictEqual(R.upgradeOption(st, far).reason, 'Nur im eigenen Gebiet');
  assert.strictEqual(R.upgradeOption(st, unit('d', 'player_1', 'defender', 5, 5)), null, 'keine höhere Stufe');
});

test('Neue Gebäude: Windmühle, Schmelzhütte, Markt, Burg, Kloster; Zünfte, Dreifelder, Fischzucht', () => {
  const st = makeState();
  const city = { q: 5, r: 5, owner: 'player_1', pop: 1, rewards: { 4: 'borders' } };
  st.cities = [city];
  st.improvements = { '6,5': 'farm', '6,4': 'farm' };
  assert.strictEqual(R.improvementIncome(st, 'player_1', 'mill', 7, 4), 3, 'Mühle: 1 selbst + 1 je Farm daneben');
  st.improvements['7,4'] = 'mill';
  const base = R.cityIncome(st, city);
  st.terrain[3 * MAP_W + 7] = 'mountain';
  st.improvements['7,3'] = 'mine';
  assert.strictEqual(R.improvementIncome(st, 'player_1', 'forge', 6, 3), 1 + 2 * 1, 'Schmelzhütte: 1 selbst + 2 je Mine');
  assert.strictEqual(R.improvementIncome(st, 'player_1', 'market', 6, 3), 2, 'Markt: je Nachbargebäude 1');
  for (const k of ['5,3', '5,4', '6,2', '7,2']) st.improvements[k] = 'farm';
  assert.strictEqual(R.improvementIncome(st, 'player_1', 'market', 6, 3), 4, 'Markt zählt nur Nachbarn im eigenen Gebiet (4)');
  st.cities[0].rewards = { 4: 'borders' };
  for (const k of ['5,3', '5,4', '6,2', '7,2']) delete st.improvements[k];
  assert.ok(R.cityIncome(st, city) > base, 'Mine zählt');
  st.techs.player_1.push('farming', 'construction', 'mills', 'planning', 'rotation');
  assert.strictEqual(R.improvementIncome(st, 'player_1', 'farm', 6, 5), 2, 'Fruchtfolge');
  st.techs.player_1.push('roads', 'trade', 'markets', 'banking', 'guilds');
  assert.strictEqual(R.improvementCost(st, 'player_1', 'market'), IMPROVEMENTS.market.cost - 2, 'Zünfte');
  // Burg: 3-fache Verteidigung
  st.improvements['4,5'] = 'fort';
  const d = unit('d', 'player_1', 'defender', 4, 5);
  assert.strictEqual(R.defenceBonus(st, d), 3);
  // Fischzucht
  st.resources = { '4,6': 'fish' };
  st.terrain[6 * MAP_W + 4] = 'water';
  const before = R.cityIncome(st, city);
  st.techs.player_1.push('fishing', 'ramming', 'aquatism', 'fishfarming');
  assert.strictEqual(R.cityIncome(st, city), before + 1);
  // Kloster: +2 Heilung im Stadtgebiet
  st.improvements['5,6'] = 'monastery';
  const hurt = unit('h', 'player_1', 'warrior', 4, 4, { hp: 2 });
  st.units = [hurt];
  R.startTurn(st);
  assert.strictEqual(hurt.hp, 2 + 2 + 2, 'normal 2 + Kloster 2');
});

test('Neue Einheiten: Pikenier gegen Reiterei, Armbrust, Paladin; Plattenrüstung, Buchdruck, Kartografie', () => {
  const st = makeState();
  const pike = unit('p', 'player_1', 'pikeman', 5, 5), sword = unit('s', 'player_1', 'swordsman', 5, 5);
  const knight = unit('k', 'player_2', 'knight', 6, 5);
  const vsPike = R.battleResults(st, knight, pike), vsWar = R.battleResults(st, knight, unit('w', 'player_1', 'warrior', 5, 5));
  assert.ok(vsPike.retaliation > vsWar.retaliation, 'Pikenwall beim Gegenschlag');
  assert.ok(R.battleResults(st, pike, knight).damage > R.battleResults(st, unit('w2', 'player_1', 'warrior', 5, 5), knight).damage);
  assert.strictEqual(UNITS.crossbow.range, 2);
  st.techs.player_1.push('climbing', 'mining', 'smithery', 'smelting', 'steel', 'plate');
  assert.strictEqual(R.defenseOf(st, sword), UNITS.swordsman.def + 1, 'Plattenrüstung');
  // Paladin als Aufrüstung des Ritters
  st.cities = [{ q: 5, r: 5, owner: 'player_1', pop: 1 }];
  const kn = unit('kn', 'player_1', 'knight', 5, 5);
  st.units = [kn];
  st.techs.player_1.push('riding', 'freespirit', 'chivalry', 'horseshoes', 'tournaments', 'paladins');
  st.stars.player_1 = 30;
  assert.ok(R.upgradeUnit(st, kn, 'player_1').ok && kn.type === 'paladin');
  // Buchdruck verbilligt Forschung, Kartografie erweitert die Sicht
  const c0 = R.techCost(st, 'ballooning', 'player_1');
  st.techs.player_1.push('meditation', 'philosophy', 'scholarship', 'printing');
  assert.ok(R.techCost(st, 'ballooning', 'player_1') < c0 + 8, 'günstiger trotz 4 weiteren Techs');
  const sight = R.unitSight(st, kn);
  st.techs.player_1.push('fishing', 'sailing', 'navigation', 'cartography');
  assert.strictEqual(R.unitSight(st, kn), sight + 2, 'Segeln +1 und Kartografie +1');
});

test('Härtetest: zufällige und unsinnige Aufrufe brechen nichts', () => {
  let seed = 4242; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = a => a[Math.floor(rnd() * a.length)];
  const junk = () => pick([undefined, null, NaN, -1, 9999, 0.5, '3', {}, 'player_9']);
  const coord = () => rnd() < 0.2 ? junk() : Math.floor(rnd() * 30) - 2;
  for (let g = 0; g < 6; g++) {
    const st = R.createGame(700 + g, 2 + (g % 4), { mapType: pick(['continents', 'pangaea', 'archipelago']) });
    const acts = [
      () => R.moveUnit(st, pick(st.units), coord(), coord()),
      () => R.attack(st, pick(st.units), rnd() < 0.2 ? junk() : pick(st.units)),
      () => R.trainUnit(st, pick(st.cities), rnd() < 0.2 ? junk() : pick(Object.keys(UNITS)), pick(st.players)),
      () => R.research(st, rnd() < 0.2 ? junk() : pick(Object.keys(TECHS)), pick(st.players)),
      () => R.improve(st, pick(st.cities), pick(Object.keys(IMPROVEMENTS)), coord(), coord(), pick(st.players)),
      () => R.buildRoad(st, pick(st.players), coord(), coord(), rnd() < 0.5 ? pick(st.units) : null),
      () => R.upgradeUnit(st, rnd() < 0.2 ? junk() : pick(st.units), pick(st.players)),
      () => R.loadCargo(st, pick(st.units), rnd() < 0.2 ? junk() : pick(st.units)),
      () => R.disbandUnit(st, pick(st.units), pick(st.players)),
      () => R.endTurn(st),
      () => { const s = botStep(st, st.turn); if (s) applyStep(st, s, st.turn); }
    ];
    for (let i = 0; i < 500 && !st.winner; i++) {
      pick(acts)();
      const seen = new Set();
      for (const u of st.units) {
        const k = u.q + ',' + u.r;
        assert.ok(!seen.has(k), 'zwei Einheiten auf einem Feld');
        seen.add(k);
        assert.ok(u.hp > 0 && R.terrainAt(st, u.q, u.r), 'Einheit gültig');
      }
      for (const p of st.players) assert.ok(Number.isFinite(st.stars[p]) && st.stars[p] >= 0, 'Sterne gültig');
    }
  }
  R.createGame(1, 4);
});

test('Beschädigte Spielstände und Profile werden abgewiesen bzw. bereinigt', () => {
  const st = R.createGame(3, 2);
  assert.ok(validState(st));
  assert.ok(!validState({ ...st, terrain: [] }), 'Karte fehlt');
  assert.ok(!validState({ ...st, units: [{ q: 999, r: 0 }] }), 'Einheit außerhalb');
  assert.ok(!validState({ ...st, turn: 'player_9' }), 'unbekannter Zug');
  assert.ok(!validState(null) && !validState('x'));
  const mem = new Map(); const store = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  mem.set('pb_save_v1', JSON.stringify({ v: 1, mode: 'bot', state: { terrain: [] } }));
  assert.strictEqual(loadGame(store), null);
  mem.set('pb_profile_v1', JSON.stringify({ v: 1, xp: 1e308, games: -3, achievements: null, daily: 5, seen: 'x' }));
  const prof = P.loadProfile(store);
  assert.ok(prof.xp <= 1e7 && prof.games === 0 && typeof prof.achievements === 'object' && prof.daily.streak === 0);
  assert.ok(P.levelOf(1e308) > 1 && P.levelOf(NaN) === 1, 'Stufe ohne Endlosschleife');
});

test('Wochen-Herausforderung: feste Woche, Sonderregeln wirken, Bestwert im Profil', () => {
  assert.strictEqual(P.weekKey(new Date('2026-10-14T12:00')), '2026-W42');
  assert.strictEqual(P.weekKey(new Date('2027-01-01T12:00')), '2026-W53');
  assert.deepStrictEqual(P.weeklyChallenge('2026-W42'), P.weeklyChallenge('2026-W42'));
  const st = R.createGame(9, 4);
  R.applyWeeklyRule(st, 'clearsky');
  assert.ok(R.isVisible(st, 'player_1', MAP_W - 2, MAP_H - 2), 'kein Nebel');
  const s2 = R.createGame(9, 4);
  R.applyWeeklyRule(s2, 'titans');
  assert.strictEqual(s2.units.filter(u => u.type === 'giant').length, 4);
  const s3 = R.createGame(9, 4);
  R.applyWeeklyRule(s3, 'fortress');
  assert.ok(s3.cities.every(c => c.rewards[3] === 'wall'));
  const prof = P.emptyProfile();
  const facts = P.gameFacts(st, 'player_1', { won: false, mode: 'bot', score: 900 });
  const res = P.recordGame(prof, { ...facts, weekly: '2026-W42' });
  assert.strictEqual(res.weekly.best, 900);
  assert.ok(res.achievements.includes('weekly'));
  R.createGame(1, 4);
});

test('Kosmetik: Freischaltung über Stufe/Erfolg, gesperrte Wahl fällt auf Standard zurück', () => {
  const prof = P.emptyProfile();
  assert.ok(P.cosmeticUnlocked(prof, 'banner', 'standard'));
  assert.ok(!P.cosmeticUnlocked(prof, 'banner', 'pennant'), 'Stufe 2 nötig');
  prof.look = { banner: 'pennant', plume: 'gold' };
  assert.deepStrictEqual(P.lookOf(prof), { banner: 'standard', plume: 'none', decor: 'none' });
  prof.xp = P.xpFor(4);
  prof.achievements.warlord = '2026-10-14';
  assert.deepStrictEqual(P.lookOf(prof), { banner: 'pennant', plume: 'gold', decor: 'none' });
  assert.ok(P.cosmeticHint('decor', 'statue').includes('Baumeister'));
});

test('Kampagne: Fortschritt, Sterne nach Runden, Freischaltung, Profil', () => {
  assert.strictEqual(K.MISSIONS.length, 13);
  const st = R.createGame(4, 2, { mapSize: 'small' });
  K.prepareMission(st, K.missionById('m1'));
  let s = K.missionStatus(st);
  assert.strictEqual(s.have, 1);
  assert.ok(!s.done);
  st.cities.filter(c => !c.owner).slice(0, 2).forEach(c => { c.owner = 'player_1'; });
  st.round = 4;
  s = K.missionStatus(st);
  assert.ok(s.done && s.stars === 3, 'schnell: 3 Sterne');
  st.round = 7;
  assert.strictEqual(K.missionStatus(st).stars, 2);
  st.round = 30;
  assert.strictEqual(K.missionStatus(st).stars, 1);
  // Belagerung: eigene Hauptstadt zählt nicht, fremde schon – auch wenn die eigene fällt.
  const b = R.createGame(4, 2, { mapSize: 'small' });
  K.prepareMission(b, K.missionById('m7'));
  assert.strictEqual(K.missionStatus(b).have, 0);
  const foe = b.cities.find(c => c.isCapital && c.owner === 'player_2');
  foe.owner = 'player_1';
  b.cities.find(c => c.isCapital && c.q === b.home.q && c.r === b.home.r).owner = 'player_2';
  assert.ok(K.missionStatus(b).done);
  // Freischaltung und Profil
  const prof = P.emptyProfile();
  assert.ok(K.missionUnlocked(prof, 0) && !K.missionUnlocked(prof, 1));
  P.recordGame(prof, { ...P.gameFacts(st, 'player_1', { won: true, mode: 'bot', score: 500 }), mission: 'm1', missionStars: 2 });
  assert.ok(K.missionUnlocked(prof, 1));
  assert.strictEqual(K.campaignStars(prof), 2);
  R.createGame(1, 4);
});

test('Bedrohte Städte: nur sichtbare Feinde in Bewegung + Reichweite', () => {
  const st = makeState();
  st.explored = { player_1: [], player_2: [] };
  const c = { q: 5, r: 5, owner: 'player_1', pop: 1 };
  st.cities = [c];
  st.units = [unit('a', 'player_2', 'archer', 8, 5)];
  assert.deepStrictEqual(R.threatenedCities(st, 'player_1'), [], 'außer Sicht');
  st.units.push(unit('s', 'player_1', 'warrior', 7, 5));
  assert.deepStrictEqual(R.threatenedCities(st, 'player_1'), [c], 'Bogenschütze: 1 + 2 = 3 Felder');
  st.units[0].q = 9;
  st.units[1].q = 8;
  assert.deepStrictEqual(R.threatenedCities(st, 'player_1'), [], '4 Felder: zu weit');
  st.units.push(unit('sp', 'player_2', 'spy', 6, 5));
  assert.deepStrictEqual(R.threatenedCities(st, 'player_1'), [], 'Spion greift nicht an');
});

test('Leuchttürme: in allen vier Ecken, je Stamm einmal Sterne, Bonus für alle vier', () => {
  const st = R.createGame(5, 2);
  const keys = R.lighthouseKeys(st);
  assert.deepStrictEqual(keys.sort(), [hk(0, 0), hk(MAP_W - 1, 0), hk(MAP_W - 1, MAP_H - 1), hk(0, MAP_H - 1)].sort());
  for (const k of keys) assert.strictEqual(R.terrainAt(st, ...k.split(',').map(Number)), 'ocean');
  const ship = unit('s', 'player_1', 'ship', 1, 0);
  const before = st.stars.player_1;
  const ev = R.claimLighthouse(st, ship);
  assert.strictEqual(ev.kind, 'lighthouse');
  assert.strictEqual(st.stars.player_1, before + LIGHTHOUSE.stars);
  assert.ok(st.explored.player_1.includes(hk(0, 0)), 'Umgebung aufgedeckt');
  assert.strictEqual(R.claimLighthouse(st, ship), null, 'nur einmal');
  assert.ok(R.claimLighthouse(st, unit('t', 'player_2', 'ship', 0, 1)), 'anderer Stamm auch');
  const far = unit('f', 'player_1', 'ship', 5, 0);
  assert.strictEqual(R.claimLighthouse(st, far), null, 'zu weit weg');
  const s0 = st.stars.player_1;
  for (const [q, r] of [[MAP_W - 1, 0], [MAP_W - 1, MAP_H - 1], [0, MAP_H - 1]]) R.claimLighthouse(st, unit('x', 'player_1', 'ship', q, r));
  assert.strictEqual(st.stars.player_1, s0 + 3 * LIGHTHOUSE.stars + LIGHTHOUSE.allBonus);
  assert.strictEqual(R.lighthouseCount(st, 'player_1'), 4);
  assert.strictEqual(R.score(st, 'player_1') - R.score({ ...st, lighthouses: {} }, 'player_1'), 4 * SCORE.lighthouse);
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

test('Ritter: Angriff 3, Pikenier hält ihm stand', () => {
  const st = makeState();
  const a = unit('a', 'player_1', 'knight', 5, 5);
  const d = unit('b', 'player_2', 'warrior', 5, 6);
  st.units = [a, d];
  const res = R.battleResults(st, a, d);
  assert.ok(res.damage >= 5 && res.damage < 10, 'Ritter trifft einen Krieger hart, tötet ihn aber nicht mehr sofort: ' + res.damage);
  const p = unit('p', 'player_2', 'pikeman', 5, 6);
  st.units = [a, p];
  const rp = R.battleResults(st, a, p);
  assert.ok(rp.retaliation > res.retaliation, 'Pikenier schlägt härter zurück');
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
  assert.strictEqual(R.techCost(st, 'organization', 'player_1'), 2, 'Tier1 * (1 + 1 Stadt), noch nichts erforscht');
  assert.ok(R.research(st, 'organization', 'player_1').ok);
  assert.ok(!R.research(st, 'organization', 'player_1').ok, 'nicht doppelt');
  assert.ok(R.research(st, 'shields', 'player_1').ok, 'Voraussetzung erfüllt');

  st.cities.push({ q: 5, r: 5, owner: 'player_1', pop: 1, trained: false });
  assert.strictEqual(R.techCost(st, 'hunting', 'player_1'), 3 + 2 * 2, 'Tier1 * (1 + 2 Städte) + 2 je bekannter Technik');
  assert.strictEqual(R.techCost(st, 'smithery', 'player_1'), 4 * 3 + 2 * 2, 'Stufe 3: Faktor 4');
  assert.strictEqual(R.techCost(st, 'markets', 'player_1'), 6 * 3 + 2 * 2, 'Stufe 4: Faktor 6');
  assert.strictEqual(R.techCost(st, 'banking', 'player_1'), 8 * 3 + 2 * 2, 'Stufe 5: Faktor 8');

  const before = R.techCost(st, 'philosophy', 'player_1');
  st.techs.player_1.push('philosophy');
  const after = R.techCost(st, 'philosophy', 'player_1');
  assert.strictEqual(after, Math.ceil((before + 2) * 0.8));
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
  city.trainedShip = false;
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
        // Die KI sieht nicht durch den Nebel: ein Zug darf an einer verborgenen
        // Einheit in Reichweite scheitern, sonst nichts.
        const hidden = step.kind === 'move' && st.units.some(u => u.owner !== player &&
          !R.isVisible(st, player, u.q, u.r) && hexDistance(u.q, u.r, step.unit.q, step.unit.r) <= step.unit.mp * 2 + 1);
        const res = applyStep(st, step, player);
        if (res && res.ok === false && !hidden) throw new Error(`${step.kind} fehlgeschlagen: ${res.reason}`);
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

test('KI sieht nicht durch den Nebel: nur sichtbare Einheiten, entdeckte Ruinen', () => {
  const st = R.createGame(4242, 2, { ai: ['player_2'] });
  const view = knownState(st, 'player_2');
  for (const u of view.units) {
    assert.ok(u.owner === 'player_2' || R.isVisible(st, 'player_2', u.q, u.r), 'fremde Einheit nur in Sicht');
  }
  const hidden = st.units.filter(u => u.owner === 'player_1' && !R.isVisible(st, 'player_2', u.q, u.r));
  assert.ok(hidden.length > 0, 'zu Beginn sind die Einheiten des Menschen verborgen');
  for (const k of Object.keys(view.ruins || {})) {
    const [q, r] = k.split(',').map(Number);
    assert.ok(R.isExplored(st, 'player_2', q, r), 'Ruine nur auf entdecktem Feld');
  }
  // Ohne Nebel (Wochenregel) sieht die KI alles wie alle anderen.
  st.noFog = true;
  assert.strictEqual(knownState(st, 'player_2'), st);
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
  // Nächster Zug: über die Brücke laufen (1 aufs erste Feld, Brücke zu Brücke
  // wie Straße 0,5, dann 1 ans Ufer).
  w.acted = false; w.hasMoved = false; w.mp = 3;
  const reach = R.reachableMap(st, w);
  assert.strictEqual(reach.get(hk(8, 5)), 2.5, 'über 2 Brückenfelder ans andere Ufer');
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

test('Hauptstadt steht mitten in freiem Land, nicht am Rand', () => {
  for (const mapType of ['continents', 'pangaea', 'archipelago']) {
    for (const n of [2, 4, 5]) {
      for (let seed = 1; seed <= 10; seed++) {
        const st = R.createGame(seed * 31, n, { mapType, mapSize: 'small' });
        for (const c of st.cities.filter(c => c.isCapital)) {
          assert.ok(Math.min(c.q, c.r, MAP_W - 1 - c.q, MAP_H - 1 - c.r) >= 3, `${mapType}: Abstand zum Rand`);
          let land = 0;
          forEachHex((q, r) => { if (hexDistance(q, r, c.q, c.r) <= 2 && R.terrainAt(st, q, r) === 'field') land++; });
          assert.strictEqual(land, 19, `${mapType}/${n}/${seed}: Land um die Hauptstadt`);
        }
      }
    }
  }
  R.createGame(1, 4);
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

// --- Admin-/Kreativ-Panel ---------------------------------------------------------

const adminGame = () => R.createGame(4242, 3, { ai: ['player_2', 'player_3'], aiLevel: 'easy' });
const freeHex = (st, wantWet) => {
  let hit = null;
  forEachHex((q, r) => {
    if (hit) return;
    const t = R.terrainAt(st, q, r);
    const wet = t === 'water' || t === 'ocean';
    if (wet === wantWet && TERRAIN[t] && (wantWet || TERRAIN[t].walkable) && !R.unitAt(st, q, r) && !R.cityAt(st, q, r)) hit = [q, r];
  });
  return hit;
};

test('Admin: Passwort, Schlüssel und Prüfwert', async () => {
  assert.strictEqual(A.ADMIN_CHECK.length, 64);
  assert.strictEqual(await A.checkCode('falsch'), null);
  // Eigener Prüfwert: richtiges Passwort liefert den Schlüssel, der Prüfwert selbst schaltet nicht frei.
  const key = await A.keyFor('Mein Passwort 1');
  const check = await A.sha256Hex(key);
  assert.strictEqual(await A.checkCode('Mein Passwort 1', check), key);
  assert.strictEqual(await A.checkCode('mein passwort 1', check), null);
  assert.strictEqual(await A.checkKey(key, check), true);
  assert.strictEqual(await A.checkKey(check, check), false, 'abgeschriebener Prüfwert reicht nicht');
  assert.strictEqual(await A.checkKey('kaputt', check), false);
});

test('Admin: Sterne, Technik mit Voraussetzungen, Markierung', () => {
  const st = adminGame();
  assert.ok(!st.admin);
  A.setStars(st, 'player_1', 500);
  assert.strictEqual(st.stars.player_1, 500);
  assert.ok(st.admin);
  A.setStars(st, 'player_1', -5);
  assert.strictEqual(st.stars.player_1, 0);
  const deep = Object.keys(TECHS).find(t => TECHS[t].req && TECHS[TECHS[t].req].req);
  A.grantTech(st, 'player_1', deep);
  for (let t = deep; t; t = TECHS[t].req) assert.ok(st.techs.player_1.includes(t), t);
  A.grantTech(st, 'player_1', 'all');
  assert.strictEqual(new Set(st.techs.player_1).size, st.techs.player_1.length);
  for (const t of Object.keys(TECHS)) assert.ok(st.techs.player_1.includes(t));
});

test('Admin: Einheit setzen prüft Gelände, Belegung und Karte', () => {
  const st = adminGame();
  const [lq, lr] = freeHex(st, false);
  const [wq, wr] = freeHex(st, true);
  assert.ok(A.spawnUnit(st, 'player_1', 'knight', lq, lr).ok);
  assert.strictEqual(A.spawnUnit(st, 'player_1', 'warrior', lq, lr).ok, false);
  assert.strictEqual(A.spawnUnit(st, 'player_1', 'warrior', wq, wr).ok, false);
  assert.ok(A.spawnUnit(st, 'player_2', 'battleship', wq, wr).ok);
  assert.strictEqual(A.spawnUnit(st, 'player_1', 'warrior', -1, 3).ok, false);
  assert.strictEqual(A.spawnUnit(st, 'player_9', 'warrior', lq, lr + 1).ok, false);
  assert.strictEqual(A.spawnUnit(st, 'player_1', 'drache', lq, lr + 1).ok, false);
  const k = R.unitAt(st, lq, lr);
  assert.strictEqual(k.hp, UNITS.knight.hp);
  assert.ok(k.mp > 0 && !k.acted);
});

test('Admin: Einheit heilen, verletzen, Veteran, entfernen', () => {
  const st = adminGame();
  const u = st.units.find(x => x.owner === 'player_1');
  A.hurtUnit(st, u);
  assert.ok(u.hp < R.hpCap(u) && u.hp >= 1);
  A.makeVeteran(st, u);
  assert.ok(u.vet);
  assert.strictEqual(u.hp, R.hpCap(u));
  A.killUnit(st, u);
  assert.ok(!st.units.includes(u));
});

test('Admin: Stadt wachsen lässt Belohnungen offen, Besitzer wechseln', () => {
  const st = adminGame();
  const c = st.cities.find(x => x.owner === 'player_1');
  A.setCityPop(st, c, 5);
  assert.strictEqual(c.pop, 5);
  assert.deepStrictEqual(c.pending, [2, 3, 4, 5]);
  A.setCityPop(st, c, 2);
  assert.strictEqual(c.pop, 2);
  assert.deepStrictEqual(c.pending, [2]);
  const foe = st.cities.find(x => x.owner === 'player_2');
  assert.ok(A.setCityOwner(st, foe, 'player_1').ok);
  assert.strictEqual(foe.owner, 'player_1');
  assert.strictEqual(A.setCityOwner(st, foe, 'player_7').ok, false);
  A.toggleWall(st, c);
  assert.strictEqual(c.rewards[3], 'wall');
  A.toggleWall(st, c);
  assert.ok(!c.rewards[3]);
});

test('Admin: Gelände malen räumt Unpassendes ab und schützt Einheiten/Städte', () => {
  const st = adminGame();
  const [q, r] = freeHex(st, false);
  st.improvements[hk(q, r)] = 'farm';
  st.terrain[r * st.mapW + q] = 'field';
  assert.ok(A.paintTerrain(st, q, r, 'forest').ok);
  assert.strictEqual(R.terrainAt(st, q, r), 'forest');
  assert.ok(!st.improvements[hk(q, r)]);
  const c = st.cities[0];
  assert.strictEqual(A.paintTerrain(st, c.q, c.r, 'ocean').ok, false);
  const u = st.units.find(x => !R.cityAt(st, x.q, x.r)) || st.units[0];
  assert.strictEqual(A.paintTerrain(st, u.q, u.r, 'water').ok, false);
  assert.strictEqual(A.paintTerrain(st, 99, 99, 'field').ok, false);
});

test('Admin: Gebäude, Weg, Brücke, Rohstoff, Ruine, neue Stadt', () => {
  const st = adminGame();
  const [q, r] = freeHex(st, false);
  st.terrain[r * st.mapW + q] = 'field';
  assert.strictEqual(A.placeImprovement(st, q, r, 'mine').ok, false);
  assert.ok(A.placeImprovement(st, q, r, 'farm').ok);
  assert.strictEqual(st.improvements[hk(q, r)], 'farm');
  assert.ok(A.placeImprovement(st, q, r, 'none').ok);
  assert.ok(A.toggleRoad(st, q, r).ok && R.roadAt(st, q, r));
  assert.ok(A.toggleRoad(st, q, r).ok && !R.roadAt(st, q, r));
  assert.ok(A.setResource(st, q, r, 'fruit').ok);
  assert.strictEqual(A.setResource(st, q, r, 'fish').ok, false);
  assert.ok(A.toggleRuin(st, q, r).ok && st.ruins[hk(q, r)]);
  assert.ok(A.toggleRuin(st, q, r).ok);
  assert.ok(A.foundCity(st, q, r, 'player_1').ok);
  assert.strictEqual(R.cityAt(st, q, r).owner, 'player_1');
  assert.strictEqual(A.foundCity(st, q, r, null).ok, false);
  forEachHex((bq, br) => { if (R.terrainAt(st, bq, br) === 'water') st.bridgeTest = st.bridgeTest || [bq, br]; });
  const [bq, br] = st.bridgeTest;
  assert.ok(A.toggleBridge(st, bq, br).ok && R.bridgeAt(st, bq, br));
  assert.ok(A.toggleBridge(st, bq, br).ok && !R.bridgeAt(st, bq, br));
  assert.strictEqual(A.toggleBridge(st, q, r).ok, false);
});

test('Admin: Runden vorspulen mit KI endet am Zug des Menschen', () => {
  const st = adminGame();
  A.advanceRounds(st, 5, { botStep, applyStep });
  assert.ok(st.round >= 6 || st.winner);
  if (!st.winner) assert.strictEqual(st.turn, 'player_1');
  const st2 = adminGame();
  A.advanceRounds(st2, 3);
  assert.strictEqual(st2.round, 4);
  assert.strictEqual(st2.turn, 'player_1');
});

test('Admin: sofort gewinnen und verlieren', () => {
  const st = adminGame();
  A.winNow(st, 'player_1');
  assert.strictEqual(st.winner, 'player_1');
  const st2 = adminGame();
  A.loseNow(st2, 'player_1');
  assert.ok(!R.alive(st2, 'player_1'));
});

test('Admin: Spielstand exportieren und wieder laden', () => {
  const st = adminGame();
  A.revealAll(st, 'player_1');
  const back = A.importState(A.exportState(st), validState);
  assert.ok(back.ok);
  assert.strictEqual(back.state.admin, true);
  assert.strictEqual(back.state.terrain.length, st.terrain.length);
  assert.strictEqual(A.importState('{kaputt', validState).ok, false);
  assert.strictEqual(A.importState('{"terrain":[]}', validState).ok, false);
});

test('Admin: Profilwerte setzen bleibt gültig', () => {
  const p = P.emptyProfile();
  A.setProfileLevel(p, 7, P.xpFor);
  assert.strictEqual(P.levelOf(p.xp), 7);
  A.unlockAchievements(p, Object.keys(P.ACHIEVEMENTS), '2026-10-14');
  for (const cat of Object.keys(P.COSMETICS)) for (const id of Object.keys(P.COSMETICS[cat].items)) {
    assert.ok(P.cosmeticUnlocked(p, cat, id), cat + ':' + id);
  }
  A.setCampaign(p, K.MISSIONS, 3);
  assert.strictEqual(K.campaignStars(p), K.MISSIONS.length * 3);
  A.setDailyStreak(p, 4, '2026-10-14');
  const clean = P.sanitizeProfile(JSON.parse(JSON.stringify(p)));
  assert.strictEqual(clean.daily.streak, 4);
  assert.strictEqual(K.campaignStars(clean), K.MISSIONS.length * 3);
});

// --- Bau-Vorschau ------------------------------------------------------------------

test('Bau-Vorschau: Farm neben Windmühle zeigt Gewinn und Nachbarn, Stand bleibt unverändert', () => {
  const st = makeState();
  const city = { q: 5, r: 5, owner: 'player_1', pop: 1, trained: false, isCapital: true };
  st.cities = [city];
  st.improvements[hk(6, 5)] = 'mill';
  const snap = JSON.stringify(st);
  const pv = R.improvePreview(st, city, 'farm', 6, 4);
  assert.strictEqual(JSON.stringify(st), snap, 'Spielstand unverändert');
  assert.strictEqual(pv.here, 1, 'Farm bringt selbst 1');
  assert.strictEqual(pv.gain, 2, 'Farm +1 und Windmühle +1');
  assert.deepStrictEqual(pv.changed, [{ q: 6, r: 5, delta: 1 }]);
  assert.strictEqual(pv.after - pv.before, pv.gain);
});

test('Feld-Ertrag: Rohstoff, Gebäude, Stadtfeld', () => {
  const st = makeState();
  const city = { q: 5, r: 5, owner: 'player_1', pop: 1, trained: false };
  st.cities = [city];
  st.resources[hk(4, 5)] = 'fruit';
  st.improvements[hk(6, 5)] = 'temple';
  assert.strictEqual(R.tileYield(st, city, 4, 5), 1);
  assert.strictEqual(R.tileYield(st, city, 6, 5), IMPROVEMENTS.temple.pop);
  assert.strictEqual(R.tileYield(st, city, 5, 5), 0);
  assert.strictEqual(R.tileYield(st, city, 5, 6), 0);
  const sum = R.cityTiles(st, city).reduce((n, [q, r]) => n + R.tileYield(st, city, q, r), 0);
  assert.strictEqual(R.cityIncome(st, city), city.pop + sum, 'Summe der Felder plus Bevölkerung = Stadteinkommen');
});

test('Bau-Vorschau: Monument zählt die Bevölkerung mit', () => {
  const st = makeState();
  const city = { q: 5, r: 5, owner: 'player_1', pop: 1, trained: false };
  st.cities = [city];
  const pv = R.improvePreview(st, city, 'm_wisdom', 6, 5);
  assert.strictEqual(pv.gain, 3);
  assert.ok(!st.improvements[hk(6, 5)]);
});


test('Monument-Fortschritt passt zur Freischaltung', () => {
  const st = makeState();
  st.cities = [{ q: 5, r: 5, owner: 'player_1', pop: 5 }, { q: 9, r: 5, owner: 'player_1', pop: 5 }];
  assert.deepStrictEqual(R.monumentProgress(st, 'player_1', 'm_park'), [2, 3]);
  assert.deepStrictEqual(R.monumentProgress(st, 'player_1', 'm_palace'), [2, 8]);
  st.stars.player_1 = 120;
  assert.deepStrictEqual(R.monumentProgress(st, 'player_1', 'm_treasury'), [120, 100]);
  assert.deepStrictEqual(R.checkMonuments(st, 'player_1'), ['m_treasury']);
  st.cities.push({ q: 13, r: 5, owner: 'player_1', pop: 5 });
  assert.deepStrictEqual(R.checkMonuments(st, 'player_1'), ['m_park']);
});

// --- Neue Einheiten, Gebäude und Stammesboni ----------------------------------------

test('Rammbock: dreifacher Schaden gegen Stadt, kein Gegenschlag; im Feld schwach', () => {
  const st = makeState();
  st.cities = [{ q: 5, r: 6, owner: 'player_2', pop: 1 }];
  const ram = unit('r', 'player_1', 'ram', 5, 5);
  const def = unit('d', 'player_2', 'defender', 5, 6);
  st.units = [ram, def];
  const inCity = R.battleResults(st, ram, def);
  assert.strictEqual(inCity.retaliation, 0);
  st.cities = [];
  const field = R.battleResults(st, ram, def);
  assert.ok(inCity.damage >= field.damage * 2.5, `Stadt ${inCity.damage} vs Feld ${field.damage}`);
  assert.ok(field.retaliation > 0);
});

test('Bogenreiter: Reichweite 2, Pikeniere treffen ihn wie Reiterei', () => {
  const st = makeState();
  const h = unit('h', 'player_1', 'horsearcher', 5, 5);
  const p = unit('p', 'player_2', 'pikeman', 5, 7);
  st.units = [h, p];
  assert.ok(R.attackTargets(st, h).includes(p), 'trifft auf 2 Felder');
  const base = R.battleResults(st, unit('x', 'player_1', 'archer', 5, 5), p);
  assert.ok(R.battleResults(st, p, h).damage > R.battleResults(st, p, unit('y', 'player_1', 'archer', 5, 5)).damage, 'Pikenier stark gegen Bogenreiter');
  assert.ok(base.damage > 0);
});

test('Händlerkarren: Handel mit eigener Stadt, fremder nur im Frieden, erobert nicht', () => {
  const st = makeState();
  const home = { q: 2, r: 5, owner: 'player_1', pop: 1 };
  const other = { q: 9, r: 5, owner: 'player_1', pop: 1 };
  const foe = { q: 9, r: 9, owner: 'player_2', pop: 1 };
  st.cities = [home, other, foe];
  const cart = unit('c', 'player_1', 'cart', 8, 5, { home: { q: 2, r: 5 } });
  st.units = [cart];
  const o = R.tradeOption(st, cart);
  assert.ok(o && o.city === other && !o.foreign, 'eigene Stadt daneben');
  const s0 = st.stars.player_1;
  assert.ok(R.trade(st, cart, 'player_1').ok);
  assert.strictEqual(st.stars.player_1, s0 + Math.min(16, 2 + 7));
  assert.ok(!st.units.includes(cart), 'Karren verbraucht');
  // Fremde Stadt: nur im Frieden, nie hineinziehen.
  const c2 = unit('c2', 'player_1', 'cart', 9, 8, { home: { q: 2, r: 5 } });
  st.units = [c2];
  assert.strictEqual(R.tradeOption(st, c2), null, 'kein Handel im Krieg');
  assert.strictEqual(R.canEnter(st, c2, 'field', 9, 9), false, 'Karren erobert keine Stadt');
  st.peace = { 'player_1|player_2': { since: 1 } };
  const f = R.tradeOption(st, c2);
  assert.ok(f && f.foreign, 'Handel im Frieden');
  assert.strictEqual(f.stars, 16, 'weit entfernt und fremd: Obergrenze 16');
  const theirs = st.stars.player_2;
  R.trade(st, c2, 'player_1');
  assert.strictEqual(st.stars.player_2, theirs + 2, 'Partner bekommt 2 Sterne');
});

test('Wachturm: Sicht 3 und anderthalbfache Verteidigung daneben', () => {
  const st = makeState();
  st.explored = { player_1: [] };
  st.cities = [{ q: 5, r: 5, owner: 'player_1', pop: 1 }];
  const d = unit('d', 'player_1', 'warrior', 6, 4);
  st.units = [d];
  assert.strictEqual(R.defenceBonus(st, d), 1);
  st.improvements['6,5'] = 'watchtower';
  assert.strictEqual(R.defenceBonus(st, d), 1.5);
  assert.ok(R.visibleKeys(st, 'player_1').has(hk(9, 5)), 'sieht 3 Felder vom Turm');
});

test('Fischerhütte: +1 je Fischgrund daneben; Markt zählt Rohstoffe', () => {
  const st = makeState();
  st.cities = [{ q: 5, r: 5, owner: 'player_1', pop: 1 }];
  for (const [q, r] of [[6, 4], [7, 4], [6, 5]]) st.terrain[r * MAP_W + q] = 'water';
  st.resources['7,4'] = 'fish';
  assert.strictEqual(R.improvementIncome(st, 'player_1', 'fishhut', 6, 4), 2);
  st.resources['4,5'] = 'fruit';
  assert.strictEqual(R.improvementIncome(st, 'player_1', 'market', 4, 6), 1, 'Markt neben Obst');
});

test('Stammesboni: Legion verteidigt in Städten besser, Langbogen schießt aus dem Wald weiter', () => {
  const st = makeState();
  st.tribes = { player_1: 'imperius', player_2: 'hoodrick' };
  st.cities = [{ q: 5, r: 5, owner: 'player_1', pop: 1 }];
  const w = unit('w', 'player_1', 'warrior', 5, 5);
  assert.strictEqual(R.defenseOf(st, w), UNITS.warrior.def + 1);
  w.q = 6;
  assert.strictEqual(R.defenseOf(st, w), UNITS.warrior.def);
  const a = unit('a', 'player_2', 'archer', 8, 8);
  assert.strictEqual(R.rangeOf(st, a), 2);
  st.terrain[8 * MAP_W + 8] = 'forest';
  assert.strictEqual(R.rangeOf(st, a), 3);
});

test('Wiederholung: jede Runde nachbaubar, kompakt genug für Online', () => {
  const st = R.createGame(77, 4, { ai: ['player_1', 'player_2', 'player_3', 'player_4'], aiLevel: 'normal', mapSize: 'normal' });
  const truth = [];
  for (let i = 0; i < 4 * 40 && !st.winner; i++) {
    const pl = st.turn; let k = 0;
    while (st.turn === pl && k++ < 300) { const s = botStep(st, pl); if (!s) break; applyStep(st, s, pl); }
    const round = st.round;
    if (st.turn === pl && !st.winner) R.endTurn(st);
    if (st.round !== round) truth.push({ round: st.round, cities: st.cities.map(c => `${c.q},${c.r},${c.owner},${c.pop}`).sort(), units: st.units.length, imps: { ...st.improvements }, roads: Object.keys(st.roads || {}).sort() });
  }
  assert.ok(st.replay.length >= 10, 'Schnappschüsse vorhanden');
  // Die letzte Runde zeigt bei Spielende den Endstand (nach dem letzten Zug).
  const lastRound = st.replay[st.replay.length - 1].r;
  for (const t of truth.filter(t => t.round !== lastRound).slice(-5)) {
    const idx = st.replay.findIndex(f => f.r === t.round);
    assert.ok(idx >= 0, 'Runde ' + t.round);
    const rs = R.replayState(st, idx);
    assert.deepStrictEqual(rs.cities.map(c => `${c.q},${c.r},${c.owner},${c.pop}`).sort(), t.cities, 'Städte Runde ' + t.round);
    assert.strictEqual(rs.units.length, t.units, 'Einheiten Runde ' + t.round);
    assert.deepStrictEqual(rs.improvements, t.imps, 'Gebäude Runde ' + t.round);
    assert.deepStrictEqual(Object.keys(rs.roads).sort(), t.roads, 'Wege Runde ' + t.round);
  }
  const bytes = JSON.stringify(st.replay).length;
  // Je Runde gemessen: Wie lange eine KI-Partie dauert, schwankt mit jeder
  // Regeländerung; entscheidend ist, dass eine Runde klein bleibt.
  assert.ok(bytes < 1800 * st.round, 'Wiederholung ' + bytes + ' Bytes in ' + st.round + ' Runden');
  // Nach dem Laden (Kopie ohne Zwischenspeicher) geht es lückenlos weiter.
  const loaded = JSON.parse(JSON.stringify(st));
  if (!loaded.winner) { R.endTurn(loaded); }
  const last = R.replayState(loaded, loaded.replay.length - 1);
  assert.deepStrictEqual(last.improvements, loaded.improvements);
});

test('Schmelzhütte: +1 je Berg daneben, +2 wenn dort eine Mine steht', () => {
  const st = makeState();
  st.cities = [{ q: 5, r: 5, owner: 'player_1', pop: 1 }];
  st.terrain[4 * MAP_W + 6] = 'mountain';
  st.terrain[5 * MAP_W + 4] = 'mountain';
  assert.strictEqual(R.improvementIncome(st, 'player_1', 'forge', 5, 4), 1 + 2);
  st.improvements['6,4'] = 'mine';
  assert.strictEqual(R.improvementIncome(st, 'player_1', 'forge', 5, 4), 1 + 1 + 2);
});

test('Neue Missionen: Vorbereitung, Handel, Mauern, Wacht; neue Erfolge', () => {
  for (const id of ['m11', 'm12', 'm13']) {
    const m = K.missionById(id);
    const st = R.createGame(500, m.setup.count, { tribe: m.setup.tribe, ai: Array.from({ length: m.setup.count - 1 }, (_, k) => 'player_' + (k + 2)), aiLevel: m.setup.aiLevel, mapSize: m.setup.mapSize, mapType: m.setup.mapType });
    K.prepareMission(st, m);
    const s = K.missionStatus(st);
    assert.ok(s && !s.done, id + ' läuft');
    if (id === 'm11') {
      assert.ok(st.techs.player_1.includes('trade'), 'Handel erforscht');
      st.tradeStarsBy = { player_1: 25 };
      assert.ok(K.missionStatus(st).done);
    }
    if (id === 'm12') {
      assert.ok(st.units.some(u => u.owner === 'player_1' && u.type === 'ram'), 'Rammbock zum Start');
      assert.ok(st.cities.some(c => c.owner === 'player_2' && c.isCapital && c.rewards && c.rewards[3] === 'wall'), 'Mauer');
    }
    if (id === 'm13') {
      st.round = 16;
      assert.ok(K.missionStatus(st).done);
      assert.strictEqual(K.missionStatus(st).stars, 2, 'ohne Verlust, ohne Türme');
    }
  }
  const p = P.emptyProfile();
  const res = P.recordGame(p, { won: true, vsAi: true, aiLevel: 'hard', mode: 'bot', score: 1, round: 30, trades: 5, siegeCaptures: 1, coached: false, techs: 1, techTotal: 99, peakCities: 1, kills: 0, captures: 0, trained: 0, monuments: 0, lighthouses: 0, ruins: 0 });
  for (const a of ['trader', 'breaker', 'selfmade']) assert.ok(res.achievements.includes(a), a);
});

test('Passende KI-Stärke: drei Siege → schwerer, drei Niederlagen → leichter', () => {
  const p = P.emptyProfile();
  const game = (won, aiLevel = 'easy', extra = {}) => P.recordGame(p, { won, vsAi: true, aiLevel, mode: 'bot', score: 1, round: 20, techs: 1, techTotal: 99, peakCities: 1, kills: 0, captures: 0, trained: 0, monuments: 0, lighthouses: 0, ruins: 0, ...extra });
  game(true); game(true);
  assert.strictEqual(P.difficultyAdvice(p), null, 'erst nach drei');
  game(true);
  assert.deepStrictEqual(P.difficultyAdvice(p), { dir: 'up', level: 'normal' });
  game(true, 'easy', { mission: 'm1' });
  assert.deepStrictEqual(P.difficultyAdvice(p), { dir: 'up', level: 'normal' }, 'Missionen zählen nicht');
  game(false, 'hard'); game(false, 'hard'); game(false, 'hard');
  assert.deepStrictEqual(P.difficultyAdvice(p), { dir: 'down', level: 'normal' });
  game(true, 'hard');
  assert.strictEqual(P.difficultyAdvice(p), null, 'gemischt: kein Vorschlag');
});

console.log('\n-- Neue Landschaften, Einheiten, Söldnerlager --');

test('Hügel: begehbar mit 1 Bewegung, anderthalbfache Verteidigung, 1 Feld mehr Sicht', () => {
  const st = makeState();
  st.terrain[5 * MAP_W + 6] = 'hills';
  const u = unit('a', 'player_1', 'warrior', 5, 5);
  st.units = [u];
  assert.ok(R.reachableMap(st, u).has('6,5'), 'Krieger betritt Hügel');
  const before = R.unitSight(st, u);
  assert.ok(R.moveUnit(st, u, 6, 5).ok);
  assert.strictEqual(R.unitSight(st, u), before + 1);
  assert.strictEqual(R.defenceBonus(st, u), 1.5);
  assert.ok(IMPROVEMENTS.mine.terrain.includes('hills'), 'Mine auf Hügeln');
});

test('Sumpf: Betreten beendet die Bewegung, Verteidigung 0,75-fach', () => {
  const st = makeState();
  st.terrain[5 * MAP_W + 6] = 'swamp';
  const u = unit('a', 'player_1', 'rider', 5, 5);
  st.units = [u];
  const reach = R.reachableMap(st, u);
  assert.ok(reach.has('6,5'), 'Sumpf erreichbar');
  assert.ok(!reach.has('7,5') || R.pathTo(st, u, 7, 5).every(([q, r]) => R.terrainAt(st, q, r) !== 'swamp'), 'nicht durch den Sumpf hindurch');
  assert.ok(R.moveUnit(st, u, 6, 5).ok);
  assert.strictEqual(u.mp, 0, 'Bewegung verbraucht');
  assert.strictEqual(R.defenceBonus(st, u), 0.75);
});

test('Waldläufer: Wald, Hügel und Sumpf kosten 1 und halten nicht auf, aus dem Wald +1 Angriff', () => {
  const st = makeState();
  for (const q of [6, 7, 8]) st.terrain[5 * MAP_W + q] = 'swamp';
  st.terrain[6 * MAP_W + 5] = 'forest';
  const r = unit('r', 'player_1', 'ranger', 5, 5, { mp: 2 });
  st.units = [r];
  assert.strictEqual(R.moveCost(st, r, 5, 6), 1);
  assert.ok(R.reachableMap(st, r).has('7,5'), 'zwei Sumpffelder weit');
  const base = R.attackOf(st, r);
  r.r = 6;
  assert.strictEqual(R.attackOf(st, r), base + 1, 'Bonus im Wald');
  st.techs.player_1.push('hunting', 'forestry');
  assert.ok(R.unlockedUnits(st, 'player_1').includes('ranger'));
});

test('Bannerträger: +0,5 Angriff für eigene Nachbarn, nicht für sich, nicht doppelt, nicht für Gegner', () => {
  const st = makeState();
  const w = unit('w', 'player_1', 'warrior', 5, 5);
  const b1 = unit('b1', 'player_1', 'bannerman', 6, 5);
  const b2 = unit('b2', 'player_1', 'bannerman', 4, 5);
  const e = unit('e', 'player_2', 'warrior', 5, 6);
  st.units = [w, b1, e];
  assert.strictEqual(R.attackOf(st, w), UNITS.warrior.atk + 0.5);
  assert.strictEqual(R.attackOf(st, b1), UNITS.bannerman.atk, 'eigenes Banner zählt nicht');
  assert.strictEqual(R.attackOf(st, e), UNITS.warrior.atk, 'Gegner profitiert nicht');
  st.units.push(b2);
  assert.strictEqual(R.attackOf(st, w), UNITS.warrior.atk + 0.5, 'zwei Banner zählen einfach');
  const dmgWith = R.battleResults(st, w, e).damage;
  st.units = [w, e];
  assert.ok(dmgWith > R.battleResults(st, w, e).damage, 'mehr Schaden mit Banner');
});

test('Brander: trifft Nachbarn des Ziels mit halbem Schaden, sinkt, kein Gegenschlag', () => {
  const st = makeState();
  for (let q = 3; q < 10; q++) for (let r = 3; r < 9; r++) st.terrain[r * MAP_W + q] = 'water';
  const f = unit('f', 'player_1', 'fireship', 5, 5);
  const t = unit('t', 'player_2', 'ship', 6, 5);
  const n = unit('n', 'player_2', 'boat', 7, 5);
  const ally = unit('a', 'player_1', 'boat', 6, 4);
  st.units = [f, t, n, ally];
  const res0 = R.battleResults(st, f, t);
  assert.strictEqual(res0.retaliation, 0);
  const { events } = R.attack(st, f, t);
  assert.ok(!R.findUnit(st, 'f'), 'Brander ist gesunken');
  assert.strictEqual(t.hp, UNITS.ship.hp - res0.damage);
  const splash = Math.max(1, Math.round(res0.damage / 2));
  assert.strictEqual(n.hp, UNITS.boat.hp - splash, 'Nachbar getroffen');
  assert.strictEqual(ally.hp, UNITS.boat.hp, 'eigene Einheit verschont');
  assert.ok(events.some(e => e.kind === 'splash' && e.to === 'n'));
});

test('Söldnerlager: anwerben kostet Sterne, ohne Technologie, einmal je Stamm', () => {
  const st = makeState();
  st.camps = { '5,5': { type: 'knight', used: [] } };
  const u = unit('u', 'player_1', 'warrior', 5, 5);
  st.units = [u];
  const o = R.hireOption(st, u);
  assert.ok(o.ok, o.reason);
  assert.strictEqual(o.cost, R.mercCost('knight'));
  const res = R.hireMercenary(st, u, 'player_1');
  assert.ok(res.ok);
  assert.strictEqual(st.stars.player_1, 20 - R.mercCost('knight'));
  assert.strictEqual(st.units.filter(x => x.type === 'knight' && x.owner === 'player_1').length, 1);
  assert.ok(u.acted, 'verbraucht den Zug');
  u.acted = false;
  assert.ok(!R.hireOption(st, u).ok, 'nur einmal');
  const v = unit('v', 'player_2', 'warrior', 5, 5);
  st.units = [v];
  st.turn = 'player_2';
  st.stars.player_2 = 3;
  assert.strictEqual(R.hireOption(st, v).reason, 'Zu wenig Sterne');
  st.stars.player_2 = 20;
  assert.ok(R.hireMercenary(st, v, 'player_2').ok, 'anderer Stamm darf');
  assert.strictEqual(R.hireOption(st, unit('s', 'player_1', 'boat', 5, 5)), null, 'Schiffe werben nicht an');
});

test('KI wirbt im Söldnerlager an', () => {
  const st = makeState();
  st.ai = ['player_1'];
  st.camps = { '5,5': { type: 'swordsman', used: [] } };
  const u = unit('u', 'player_1', 'warrior', 5, 5);
  st.units = [u];
  const step = botStep(st, 'player_1');
  assert.strictEqual(step && step.kind, 'hire');
  assert.ok(applyStep(st, step, 'player_1').ok);
});

test('Kartenerzeugung: Hügel, Sumpf und Lager abseits der Städte, gleich bei gleichem Startwert', () => {
  for (const seed of [11, 12, 13, 14]) {
    const a = R.createGame(seed, 4);
    const b = R.createGame(seed, 4);
    assert.deepStrictEqual(a.terrain, b.terrain);
    assert.deepStrictEqual(a.camps, b.camps);
    assertInvariants(a);
    assert.ok(Object.keys(a.camps).length >= 1, 'mindestens ein Lager');
    for (const k of Object.keys(a.camps)) {
      const [q, r] = k.split(',').map(Number);
      assert.ok(a.cities.every(c => hexDistance(q, r, c.q, c.r) >= 3), 'Lager weit genug weg');
      assert.ok(['field', 'hills'].includes(R.terrainAt(a, q, r)));
    }
    for (const c of a.cities.filter(c => c.isCapital)) {
      forEachHex((q, r) => {
        if (hexDistance(q, r, c.q, c.r) <= 2) assert.ok(!['hills', 'swamp'].includes(R.terrainAt(a, q, r)), 'Startgebiet unverändert');
      });
    }
  }
});

test('Wiederholung: neue Einheiten stehen hinten, alte Aufzeichnungen bleiben lesbar', () => {
  const keys = Object.keys(UNITS);
  assert.deepStrictEqual(keys.slice(-3), ['ranger', 'bannerman', 'fireship']);
  assert.strictEqual(keys.indexOf('settler'), keys.length - 4);
});

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed) process.exit(1);
