// Zugprotokoll der Tages- und Wochen-Herausforderung.
//
// Jede Aktion des Menschen wird als kleiner Eintrag mitgeschrieben (Felder
// statt Einheiten-IDs, die IDs hängen von der Uhrzeit ab). Weil Karte, KI
// und Zufall nur vom Startwert abhängen, lässt sich die ganze Partie aus dem
// Protokoll nachspielen: so prüft scripts/verify-scores.mjs eine eingereichte
// Punktzahl, bevor sie in die Bestenliste kommt.

import * as R from './rules.js';
import { botStep, applyStep } from './ai.js';
import * as P from './profile.js';

export const HUMAN = 'player_1';
const pos = o => [o.q, o.r];

// Neue Herausforderungspartie, genau so, wie das Spiel sie startet.
export function challengeGame(kind, key) {
  const ch = kind === 'weekly' ? P.weeklyChallenge(key) : P.dailyChallenge(key);
  const state = R.createGame(ch.seed, ch.count, {
    tribe: ch.tribe, stars: ch.stars, turnLimit: ch.turnLimit, aiLevel: ch.aiLevel,
    ai: Array.from({ length: ch.count - 1 }, (_, k) => 'player_' + (k + 2)),
    mapSize: ch.mapSize, mapType: ch.mapType
  });
  if (kind === 'weekly') R.applyWeeklyRule(state, ch.rule);
  state[kind] = ch.key;
  state.actions = [];
  return { state, challenge: ch };
}

// Eintrag anhängen (nur in Partien mit Protokoll).
export function logAction(state, entry) {
  if (state && Array.isArray(state.actions)) state.actions.push(entry);
}

// Einträge, wie main.js sie schreibt.
export const entry = {
  move: (unit, q, r) => ({ k: 'move', u: pos(unit), to: [q, r] }),
  attack: (attacker, defender) => ({ k: 'attack', u: pos(attacker), d: pos(defender) }),
  train: (city, type) => ({ k: 'train', c: pos(city), t: type }),
  buyPop: city => ({ k: 'pop', c: pos(city) }),
  improve: (city, type, q, r) => ({ k: 'improve', c: pos(city), t: type, at: [q, r] }),
  road: (q, r, unit) => ({ k: 'road', at: [q, r], u: unit ? pos(unit) : null }),
  found: unit => ({ k: 'found', u: pos(unit) }),
  trade: unit => ({ k: 'trade', u: pos(unit) }),
  hire: unit => ({ k: 'hire', u: pos(unit) }),
  upgrade: unit => ({ k: 'upgrade', u: pos(unit) }),
  load: (balloon, unit) => ({ k: 'load', u: pos(balloon), w: pos(unit) }),
  unload: (balloon, q, r) => ({ k: 'unload', u: pos(balloon), at: [q, r] }),
  bridge: (unit, dir) => ({ k: 'bridge', u: pos(unit), dir }),
  unbridge: (unit, q, r) => ({ k: 'unbridge', u: pos(unit), at: [q, r] }),
  disband: unit => ({ k: 'disband', u: pos(unit) }),
  research: tech => ({ k: 'research', t: tech }),
  reward: (city, choice) => ({ k: 'reward', c: pos(city), ch: choice }),
  peace: to => ({ k: 'peace', to }),
  war: to => ({ k: 'war', to }),
  respond: (from, accept) => ({ k: 'respond', from, yes: !!accept }),
  monuments: () => ({ k: 'mon' }),
  end: () => ({ k: 'end' })
};

// Die KI ziehen lassen, bis der Mensch wieder dran ist – dieselbe Schleife
// wie maybeBot in main.js, nur ohne Darstellung.
export function runBots(state, human = HUMAN) {
  while (R.isBot(state, state.turn) && !state.winner && !R.isEliminated(state, human)) {
    const player = state.turn;
    let steps = 0;
    while (state.turn === player && !state.winner) {
      let step = null;
      try {
        step = botStep(state, player);
        if (!step) break;
        applyStep(state, step, player);
      } catch (e) {
        break;
      }
      steps++;
      if (steps > 220) break;
    }
    if (state.turn === player && !state.winner) R.endTurn(state);
  }
}

// Einen Eintrag auf den Stand anwenden; liefert true, wenn die Aktion gültig war.
function apply(state, e, me) {
  const unit = p => Array.isArray(p) ? R.unitAt(state, p[0], p[1]) : null;
  const city = p => Array.isArray(p) ? R.cityAt(state, p[0], p[1]) : null;
  const ok = res => !!res && res.ok !== false;
  const mine = u => u && u.owner === me ? u : null;
  switch (e && e.k) {
    case 'move': { const u = mine(unit(e.u)); return !!u && ok(R.moveUnit(state, u, e.to[0], e.to[1])); }
    case 'attack': { const u = mine(unit(e.u)), d = unit(e.d); return !!u && !!d && ok(R.attack(state, u, d)); }
    case 'train': return ok(R.trainUnit(state, city(e.c), e.t, me));
    case 'pop': return ok(R.buyPop(state, city(e.c), me));
    case 'improve': return ok(R.improve(state, city(e.c), e.t, e.at[0], e.at[1], me));
    case 'road': return ok(R.buildRoad(state, me, e.at[0], e.at[1], e.u ? mine(unit(e.u)) : null));
    case 'found': { const u = mine(unit(e.u)); return !!u && ok(R.foundCity(state, u, me)); }
    case 'trade': { const u = mine(unit(e.u)); return !!u && ok(R.trade(state, u, me)); }
    case 'hire': { const u = mine(unit(e.u)); return !!u && ok(R.hireMercenary(state, u, me)); }
    case 'upgrade': { const u = mine(unit(e.u)); return !!u && ok(R.upgradeUnit(state, u, me)); }
    case 'load': { const b = mine(unit(e.u)), w = mine(unit(e.w)); return !!b && !!w && ok(R.loadCargo(state, b, w)); }
    case 'unload': { const b = mine(unit(e.u)); return !!b && ok(R.unloadCargo(state, b, e.at[0], e.at[1])); }
    case 'bridge': { const u = mine(unit(e.u)); return !!u && ok(R.buildBridge(state, u, e.dir, me)); }
    case 'unbridge': { const u = mine(unit(e.u)); return !!u && ok(R.destroyBridge(state, u, e.at[0], e.at[1], me)); }
    case 'disband': { const u = mine(unit(e.u)); return !!u && ok(R.disbandUnit(state, u, me)); }
    case 'research': return ok(R.research(state, e.t, me));
    case 'reward': return ok(R.chooseReward(state, city(e.c), e.ch, me));
    case 'peace': return ok(R.offerPeace(state, me, e.to));
    case 'war': return ok(R.declareWar(state, me, e.to));
    case 'respond': return ok(R.respondPeace(state, me, e.from, e.yes));
    case 'mon': R.checkMonuments(state, me); return true;
    case 'end': R.endTurn(state); runBots(state, me); return true;
    default: return false;
  }
}

// Partie aus dem Protokoll nachspielen. Ergebnis: Endstand mit Punktzahl
// und Runde, oder ein Fehler mit dem ersten ungültigen Eintrag.
export function replayChallenge(kind, key, log) {
  if (!Array.isArray(log) || log.length > 20000) return { error: 'Kein gültiges Protokoll' };
  const { state } = challengeGame(kind, key);
  const me = HUMAN;
  for (let i = 0; i < log.length; i++) {
    if (state.winner || R.isEliminated(state, me)) return { error: `Eintrag ${i}: Partie war schon vorbei` };
    if (state.turn !== me) return { error: `Eintrag ${i}: nicht am Zug` };
    let valid = false;
    try { valid = apply(state, log[i], me); } catch (e) { valid = false; }
    if (!valid) return { error: `Eintrag ${i} (${log[i] && log[i].k}) ist nach den Regeln nicht möglich` };
  }
  if (!state.winner && !R.isEliminated(state, me)) return { error: 'Partie ist nicht zu Ende gespielt' };
  const score = state.finalScores && state.finalScores[me] != null ? state.finalScores[me] : R.score(state, me);
  return { state, score, round: state.round, tribe: state.tribes ? state.tribes[me] : null };
}
