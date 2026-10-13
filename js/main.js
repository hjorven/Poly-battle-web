import * as R from './rules.js';
import * as render from './render.js';
import * as ui from './ui.js';
import * as net from './net.js';
import { botStep, applyStep } from './ai.js';
import { sfx, isMuted, setMuted } from './sound.js';
import { saveGame, loadGame, saveInfo, clearSave } from './save.js';
import { NAMES, UNITS, TECHS, IMPROVEMENTS, CITY_REWARDS } from './config.js';

const app = {
  mode: null,
  state: null,
  myRole: null,
  hasOpponent: true,
  gameId: null,
  sel: null,
  busy: false,
  online: false,
  // Wird bei jedem neuen/geladenen Spiel erhöht; eine noch laufende
  // KI-Schleife des alten Spiels erkennt daran, dass sie aufhören muss.
  gen: 0,
  // Rückgängig: Spielstände vor den Aktionen dieses Zuges (nur lokal).
  undo: []
};

// Einen Spielstand übernehmen und seine Kartengröße aktivieren.
function adopt(state) {
  app.state = state;
  if (state) R.useMap(state);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function needName(state, player) {
  return R.tribeName(state, player) || NAMES[player];
}

function ctx() {
  return {
    mode: app.mode,
    myRole: app.myRole,
    actAs: app.mode === 'hotseat' ? (app.state ? app.state.turn : 'player_1') : (app.myRole || 'player_1'),
    viewer: viewer(),
    myTurn: myTurn()
  };
}

function myTurn() {
  const st = app.state;
  if (!st || st.winner || app.busy) return false;
  if (app.mode === 'bot') return st.turn === 'player_1';
  if (app.mode === 'hotseat') return true;
  if (app.mode === 'online') return !!app.myRole && app.hasOpponent && st.turn === app.myRole;
  return false;
}

function statusText() {
  const st = app.state;
  if (!st) return 'Lade Spiel…';
  if (st.winner) {
    return st.endReason === 'score'
      ? `${needName(st, st.winner)} gewinnt nach Punkten.`
      : `${needName(st, st.winner)} hat alle Städte erobert und gewinnt.`;
  }
  if (app.mode === 'online') {
    if (!app.myRole) return `Zuschauer · Am Zug: ${needName(st, st.turn)}`;
    if (!app.hasOpponent) return 'Warte auf Mitspieler – teile den Link (Menü → Link kopieren).';
    if (myTurn()) return `Du bist am Zug (${needName(st, app.myRole)})`;
    return `Gegner ist am Zug (${needName(st, st.turn)})`;
  }
  if (app.mode === 'bot') return myTurn() ? 'Du bist am Zug' : 'Die KI denkt nach …';
  return `Am Zug: ${needName(st, st.turn)}`;
}

function refresh() {
  if (!app.state) return;
  ui.updateStrip(app.state, ctx());
  ui.setStatus(statusText());
  ui.setEndTurn(myTurn());
  const idle = myTurn() ? R.idleUnits(app.state, actAs()) : [];
  ui.setIdle(idle.length);
  render.setIdleMarkers(idle);
  ui.setUndo(canUndo());
  render.drawMinimap(app.state, viewer());
  updateSelection();
  checkWinnerUI();
}

// Reihum zur nächsten Einheit springen, die noch etwas tun kann.
function nextIdle() {
  if (!myTurn()) return;
  const idle = R.idleUnits(app.state, actAs());
  if (!idle.length) return;
  const cur = app.sel && app.sel.kind === 'unit' ? idle.findIndex(u => u.id === app.sel.id) : -1;
  const u = idle[(cur + 1) % idle.length];
  app.sel = { kind: 'unit', id: u.id };
  render.cameraTo(u.q, u.r, true);
  refresh();
}

function updateSelection() {
  const st = app.state;
  if (!st) return;
  if (app.sel) {
    if (app.sel.kind === 'unit' && !R.findUnit(st, app.sel.id)) app.sel = null;
    if (app.sel.kind === 'city' && !R.cityAt(st, app.sel.q, app.sel.r)) app.sel = null;
  }
  if (!app.sel) {
    render.setHighlights({});
    ui.hidePanel();
    return;
  }
  if (app.sel.kind === 'unit') {
    const u = R.findUnit(st, app.sel.id);
    const canCommand = myTurn() && u.owner === ctx().actAs && !u.acted;
    const canBridge = myTurn() && u.owner === ctx().actAs && !u.acted;
    render.setHighlights({
      selected: u.q + ',' + u.r,
      move: canCommand && u.mp > 0 ? R.reachableMap(st, u) : null,
      attack: canCommand ? R.attackTargets(st, u) : null,
      bridge: canBridge ? R.bridgeOptions(st, u).flatMap(o => o.tiles) : null
    });
    ui.showUnitPanel(st, u, ctx());
  } else {
    const city = R.cityAt(st, app.sel.q, app.sel.r);
    render.setHighlights({ selected: city.q + ',' + city.r });
    ui.showCityPanel(st, city, ctx());
  }
}

function humanDefeated() {
  return app.mode === 'bot' && !!app.state && !app.state.winner && R.isEliminated(app.state, 'player_1');
}

function checkWinnerUI() {
  if (!app.state) return;
  const over = app.state.winner || humanDefeated();
  if (over && app.endSound !== app.gen) {
    app.endSound = app.gen;
    const me = app.mode === 'online' ? app.myRole : 'player_1';
    sfx(app.state.winner && (app.mode === 'hotseat' || app.state.winner === me) ? 'win' : 'lose');
  }
  if (app.state.winner) { clearSave(); ui.showWinner(app.state, ctx()); }
  else if (humanDefeated()) { clearSave(); ui.showDefeat(app.state, ctx()); }
}

// Lokale Partien nach jeder Aktion sichern (Neuladen / Tab schließen).
function persist() {
  if (app.online || !app.state) return;
  if (humanDefeated()) { clearSave(); return; }
  saveGame(app.mode, app.state);
}

function showMenu() {
  ui.setContinue(saveInfo());
  ui.showMenu();
}

async function saveOnline() {
  if (!app.online || !app.gameId) return;
  app.state.rev = (app.state.rev || 0) + 1;
  const { error, rejected } = await net.saveMatch(app.gameId, app.state);
  if (!error) return;
  ui.toast(error, 'warn');
  // Server hat den Zug abgelehnt: auf den gültigen Stand der Datenbank zurück.
  if (rejected) {
    const { match } = await net.fetchMatch(app.gameId);
    if (match && match.game_state) {
      adopt(match.game_state);
      app.sel = null;
      render.syncBoard(app.state, viewer());
      refresh();
    }
  }
}

// Kampf, Eroberung und Ruinen decken Neues auf bzw. hängen vom Zufall ab –
// danach ist kein Rückgängig mehr möglich.
const FINAL_EVENTS = new Set(['damage', 'kill', 'convert', 'capture', 'ruin', 'retaliate', 'promote']);

function announce(events) {
  for (const ev of events) {
    if (ev.kind === 'capture') {
      ui.toast(ev.to ? `Stadt erobert! (${needName(app.state, ev.to)})` : 'Stadt neutralisiert', 'good');
      sfx('capture');
    } else if (ev.kind === 'ruin') {
      ui.toast(`Ruine erkundet: ${ev.text}`, 'good');
      sfx('coin');
    } else if (ev.kind === 'promote') {
      ui.toast(`${UNITS[ev.type].name} wird Veteran! (+5 Leben, voll geheilt)`, 'good');
      sfx('promote');
    } else if (ev.kind === 'embark') {
      ui.toast('Eingeschifft – die Einheit fährt jetzt als Boot');
      sfx('splash');
    } else if (ev.kind === 'disembark') {
      ui.toast('An Land gegangen');
      sfx('move');
    } else if (ev.kind === 'note') {
      ui.toast(ev.text);
    }
  }
}

async function afterAction(events = []) {
  announce(events);
  if (events.some(ev => FINAL_EVENTS.has(ev.kind))) app.undo = [];
  app.busy = false;
  refresh();
  const token = (app.state.round || 0) + ':' + app.state.turn;
  if (myTurn() && !anyIdle(actAs()) && app.idleWarned !== token) {
    app.idleWarned = token;
    ui.toast('Alle Einheiten erledigt – Zug beenden', 'good');
  }
  persist();
  await saveOnline();
  offerReward();
  offerDiplomacy();
  if (!app.state.winner) await maybeBot();
}

// --- Rückgängig -------------------------------------------------------------

function canUndo() {
  return !app.online && myTurn() && app.undo.length > 0;
}

function pushUndo(snapshot) {
  if (app.online) return;
  app.undo.push(snapshot);
  if (app.undo.length > 30) app.undo.shift();
}

function snap() {
  return app.online ? null : JSON.stringify(app.state);
}

async function doUndo() {
  if (!canUndo()) return;
  adopt(JSON.parse(app.undo.pop()));
  app.sel = null;
  sfx('select');
  ui.toast('Rückgängig gemacht');
  await render.syncBoard(app.state, viewer());
  persist();
  refresh();
}

// --- Diplomatie -------------------------------------------------------------

function doOfferPeace(to) {
  if (!myTurn()) return;
  const before = snap();
  const res = R.offerPeace(app.state, actAs(), to);
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  pushUndo(before);
  const name = needName(app.state, to);
  if (res.accepted) { ui.toast(`Frieden mit ${name} geschlossen`, 'good'); sfx('peace'); }
  else if (res.pending) ui.toast(`Friedensangebot an ${name} gesendet`, 'good');
  else { ui.toast(`${name} lehnt ab (neuer Versuch in 3 Runden)`, 'warn'); sfx('error'); }
  ui.showOverview(app.state, ctx());
  afterAction();
}

function doDeclareWar(to) {
  if (!myTurn()) return;
  ui.showConfirm(`${needName(app.state, to)} den Krieg erklären? Ein neuer Frieden ist frühestens in 3 Runden möglich.`, () => {
    const before = snap();
    const res = R.declareWar(app.state, actAs(), to);
    if (!res.ok) { ui.toast(res.reason, 'warn'); return; }
    pushUndo(before);
    ui.toast(`Krieg mit ${needName(app.state, to)}!`, 'warn');
    sfx('war');
    ui.hideOverview();
    afterAction();
  }, { yes: 'Krieg erklären' });
}

// Eingehendes Friedensangebot dem Spieler am Zug vorlegen.
function offerDiplomacy() {
  if (!myTurn() || ui.isRewardOpen() || ui.isConfirmOpen()) return;
  const me = actAs();
  const offer = (app.state.peaceOffers || []).find(o => o.to === me);
  if (!offer) return;
  const answer = accept => {
    const res = R.respondPeace(app.state, me, offer.from, accept);
    if (!res.ok) return;
    if (accept) { ui.toast(`Frieden mit ${needName(app.state, offer.from)} geschlossen`, 'good'); sfx('peace'); }
    else ui.toast('Angebot abgelehnt');
    app.undo = [];
    afterAction();
  };
  ui.showConfirm(`${needName(app.state, offer.from)} bietet dir Frieden an. Solange er gilt, könnt ihr euch nicht angreifen und nicht die Städte des anderen betreten.`,
    () => answer(true), { onNo: () => answer(false), yes: 'Frieden schließen', no: 'Ablehnen' });
}

function actAs() {
  return ctx().actAs;
}

// Panels und Dialoge halten Objekte aus dem Stand, mit dem sie gezeichnet
// wurden. Ersetzt ein Online-Update den Stand, würde eine Aktion sonst ein
// verwaistes Objekt ändern – deshalb immer im aktuellen Stand nachschlagen.
function liveCity(city) {
  return city ? R.cityAt(app.state, city.q, city.r) : null;
}

function liveUnit(unit) {
  return unit ? R.findUnit(app.state, unit.id) : null;
}

// Offene Stadt-Belohnung des aktiven Spielers direkt zur Auswahl anbieten.
function offerReward() {
  if (!myTurn() || ui.isRewardOpen()) return;
  const city = R.citiesFor(app.state, actAs()).find(c => R.pendingLevel(c));
  if (city) ui.showReward(app.state, city, ctx());
}

async function doChooseReward(city, id) {
  city = liveCity(city);
  if (!city) return;
  const before = snap();
  const res = R.chooseReward(app.state, city, id, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  pushUndo(before);
  app.busy = true;
  ui.toast(`${CITY_REWARDS[id].name} gewählt`, 'good');
  sfx('coin');
  await render.syncBoard(app.state, viewer());
  await afterAction(res.events);
}

function viewer() {
  if (!app.state) return null;
  if (app.mode === 'hotseat') return app.state.turn;
  if (app.mode === 'bot') return 'player_1';
  if (app.mode === 'online') return app.myRole || null;
  return null;
}

async function doMove(unit, q, r) {
  app.busy = true;
  const before = snap();
  const res = R.moveUnit(app.state, unit, q, r);
  if (!res.ok) { app.busy = false; refresh(); return; }
  pushUndo(before);
  if (!res.events.some(e => e.kind === 'embark')) sfx('move');
  app.sel = { kind: 'unit', id: unit.id };
  await render.syncBoard(app.state, viewer());
  await afterAction(res.events);
}

async function doAttack(attacker, defender) {
  app.busy = true;
  const { events } = R.attack(app.state, attacker, defender);
  app.undo = [];
  sfx(events.some(e => e.kind === 'kill') ? 'kill' : 'attack');
  render.syncBoard(app.state, viewer());
  await render.playCombat(events);
  if (R.findUnit(app.state, attacker.id)) app.sel = { kind: 'unit', id: attacker.id };
  else app.sel = null;
  await afterAction(events);
}

async function doTrain(city, type) {
  city = liveCity(city);
  if (!city) return;
  const before = snap();
  const res = R.trainUnit(app.state, city, type, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  pushUndo(before);
  app.busy = true;
  ui.toast(`${UNITS[type].name} ausgebildet`, 'good');
  sfx('coin');
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doBuyPop(city) {
  city = liveCity(city);
  if (!city) return;
  const before = snap();
  const res = R.buyPop(app.state, city, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  pushUndo(before);
  app.busy = true;
  ui.toast('Bevölkerung wächst', 'good');
  sfx('coin');
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doImprove(city, type, q, r) {
  city = liveCity(city);
  if (!city) return;
  const before = snap();
  const res = R.improve(app.state, city, type, q, r, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  pushUndo(before);
  app.busy = true;
  const def = IMPROVEMENTS[type];
  ui.toast(`${def ? def.name + ' gebaut' : 'Gebäude gebaut'}`, 'good');
  sfx('build');
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doFound(unit) {
  unit = liveUnit(unit);
  if (!unit) return;
  const before = snap();
  const res = R.foundCity(app.state, unit, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  pushUndo(before);
  app.busy = true;
  ui.toast('Stadt gegründet', 'good');
  sfx('capture');
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doBuildBridge(unit, dir) {
  unit = liveUnit(unit);
  if (!unit) return;
  const before = snap();
  const res = R.buildBridge(app.state, unit, dir, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  pushUndo(before);
  app.busy = true;
  ui.toast('Brücke gebaut', 'good');
  sfx('build');
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doDestroyBridge(unit, q, r) {
  unit = liveUnit(unit);
  if (!unit) return;
  const before = snap();
  const res = R.destroyBridge(app.state, unit, q, r, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  pushUndo(before);
  app.busy = true;
  ui.toast('Brücke eingerissen', 'good');
  sfx('splash');
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

function doDisband(unit) {
  const name = UNITS[unit.type].name;
  ui.showConfirm(`${name} auflösen? Du erhältst ${R.disbandRefund(unit)} Sterne zurück.`, async () => {
    const u = liveUnit(unit);
    if (!u || !myTurn()) return;
    const before = snap();
    const res = R.disbandUnit(app.state, u, actAs());
    if (!res.ok) { ui.toast(res.reason, 'warn'); return; }
    pushUndo(before);
    sfx('select');
    app.busy = true;
    app.sel = null;
    ui.toast(`${name} aufgelöst (+${res.refund} Sterne)`, 'good');
    await render.syncBoard(app.state, viewer());
    await afterAction();
  });
}

function anyIdle(owner) {
  return R.idleUnits(app.state, owner).length > 0;
}

function doEndTurnNow() {
  app.busy = true;
  app.sel = null;
  app.undo = [];
  R.endTurn(app.state);
  sfx('turn');
  // Hotseat: erst Übergabe-Bildschirm, dann die Sicht des nächsten Spielers.
  if (app.mode === 'hotseat' && !app.state.winner) {
    ui.showHandover(needName(app.state, app.state.turn), () => {
      render.syncBoard(app.state, viewer());
      focusHome();
      afterAction();
    });
    app.busy = false;
    persist();
    refresh();
    return Promise.resolve();
  }
  return render.syncBoard(app.state, viewer()).then(() => afterAction());
}

async function doEndTurn() {
  if (!myTurn()) return;
  const idle = R.idleUnits(app.state, actAs());
  if (app.mode !== 'hotseat' && idle.length) {
    ui.showConfirm(`Noch bereit: ${ui.describeUnits(idle)}. Zug trotzdem beenden?`, doEndTurnNow);
    return;
  }
  await doEndTurnNow();
}

async function doResearch(techId) {
  const before = snap();
  const res = R.research(app.state, techId, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  pushUndo(before);
  app.busy = true;
  ui.toast(`${TECHS[techId].name} erforscht`, 'good');
  sfx('research');
  await afterAction();
  if (ui.isTechOpen()) ui.openTech(app.state, ctx(), true);
}

// Spielt sich der KI-Schritt in Sichtweite des Menschen ab? Nur dann wird er
// animiert – Züge im Nebel laufen ohne Pause durch.
function botStepVisible(step) {
  const seen = (q, r) => R.isVisible(app.state, 'player_1', q, r);
  const spots = [];
  for (const o of [step.unit, step.attacker, step.defender, step.city]) if (o) spots.push([o.q, o.r]);
  if (step.q != null) spots.push([step.q, step.r]);
  return spots.some(([q, r]) => seen(q, r));
}

// Einen KI-Schritt ausführen und für den Menschen sichtbar machen.
// Gibt zurück, ob er sichtbar war (dann folgt eine kurze Pause).
async function playBotStep(step, player) {
  const human = 'player_1';
  const seen = (q, r) => R.isVisible(app.state, human, q, r);
  const visibleBefore = botStepVisible(step);
  const res = applyStep(app.state, step, player) || {};
  const visible = visibleBefore || botStepVisible(step);
  if (!visible && step.kind !== 'war') {
    render.syncBoard(app.state, viewer());
    return false;
  }
  if (step.kind === 'attack') {
    if (seen(step.defender.q, step.defender.r) || seen(step.attacker.q, step.attacker.r)) {
      sfx((res.events || []).some(e => e.kind === 'kill') ? 'kill' : 'attack');
    }
    render.syncBoard(app.state, viewer());
    await render.playCombat(res.events || []);
    if ((res.events || []).some(e => e.kind === 'capture' && e.from === human)) {
      ui.toast(`${needName(app.state, player)} hat eine deiner Städte erobert!`, 'warn');
    }
    return true;
  }
  if (step.kind === 'move' && (res.events || []).some(e => e.kind === 'capture' && e.from === human)) {
    ui.toast(`${needName(app.state, player)} hat eine deiner Städte erobert!`, 'warn');
  }
  if (step.kind === 'war' && res.ok) {
    if (step.target === human) { ui.toast(`${needName(app.state, player)} bricht den Frieden und erklärt dir den Krieg!`, 'warn'); sfx('war'); }
  }
  if (step.kind !== 'research' && step.kind !== 'war') await render.syncBoard(app.state, viewer());
  return step.kind !== 'research';
}

async function maybeBot() {
  if (app.mode !== 'bot' || app.busy || !app.state || app.state.winner) return;
  if (app.state.turn === 'player_1') return;
  const gen = app.gen;
  const stale = () => gen !== app.gen;
  app.busy = true;
  app.sel = null;
  refresh();
  await sleep(550);
  if (stale()) return;
  while (app.state.turn !== 'player_1' && !app.state.winner && !humanDefeated()) {
    const player = app.state.turn;
    let steps = 0;
    while (app.state.turn === player && !app.state.winner) {
      if (stale()) return;
      let step = null;
      let shown = false;
      try {
        step = botStep(app.state, player);
        if (!step) break;
        shown = await playBotStep(step, player);
      } catch (e) {
        // Ein Fehler in einem KI-Schritt darf das Spiel nie einfrieren:
        // Zug dieser KI beenden und weiterspielen.
        console.error('KI-Fehler', step && step.kind, e);
        break;
      }
      ui.updateStrip(app.state, ctx());
      // Sichtbare Schritte kurz zeigen; unsichtbare nur gelegentlich dem
      // Browser Luft lassen, damit die Seite bedienbar bleibt.
      if (shown) await sleep(430);
      else if (steps % 8 === 0) await sleep(0);
      if (stale()) return;
      steps++;
      if (steps > 220) break;
    }
    if (stale()) return;
    if (app.state.turn === player && !app.state.winner) {
      R.endTurn(app.state);
      await render.syncBoard(app.state, viewer());
      ui.updateStrip(app.state, ctx());
    }
  }
  app.busy = false;
  persist();
  refresh();
}

async function onHexPick(key) {
  if (!app.state || app.state.winner || app.busy) return;
  const [q, r] = key.split(',').map(Number);
  const st = app.state;
  const v = viewer();
  const rawUnit = R.unitAt(st, q, r);
  // Feindliche Einheiten im Nebel lassen sich weder anwählen noch angreifen.
  const unit = rawUnit && (!v || rawUnit.owner === v || R.isVisible(st, v, q, r)) ? rawUnit : null;
  const rawCity = R.cityAt(st, q, r);
  // Städte im unentdeckten Nebel bleiben verborgen.
  const city = rawCity && R.cityView(st, v, rawCity) ? rawCity : null;

  if (!myTurn()) {
    app.sel = unit ? { kind: 'unit', id: unit.id } : (city ? { kind: 'city', q, r } : null);
    refresh();
    return;
  }

  const sel = app.sel;
  if (sel && sel.kind === 'unit') {
    const me = R.findUnit(st, sel.id);
    if (me && me.owner === actAs() && !me.acted) {
      if (unit && unit.owner !== me.owner) {
        if (R.attackTargets(st, me).some(t => t.id === unit.id)) return doAttack(me, unit);
        refresh();
        return;
      } else if (!unit) {
        const reach = R.reachableMap(st, me);
        if (reach.has(key)) return doMove(me, q, r);
      } else if (unit.owner === me.owner) {
        app.sel = { kind: 'unit', id: unit.id };
        refresh();
        return;
      } else if (city && city.owner === actAs()) {
        app.sel = { kind: 'city', q, r };
        refresh();
        return;
      }
    } else if (me && me.owner === actAs() && me.acted && unit && unit.owner === me.owner) {
      app.sel = { kind: 'unit', id: unit.id };
      refresh();
      return;
    }
  }

  if (unit) app.sel = { kind: 'unit', id: unit.id };
  else if (city) app.sel = { kind: 'city', q, r };
  else app.sel = null;
  refresh();
}

function startLocal(mode) {
  app.gen++;
  app.mode = mode;
  app.online = false;
  app.gameId = null;
  app.myRole = null;
  app.hasOpponent = true;
  app.sel = null;
  app.busy = false;
  app.idleWarned = null;
  const settings = ui.getSettings();
  const count = mode === 'bot' ? settings.bots + 1 : 2;
  const tribe = mode === 'bot' ? ui.getTribe() : null;
  const map = { mapSize: settings.mapSize, mapType: settings.mapType };
  const opts = mode === 'bot'
    ? {
        tribe, stars: settings.stars, turnLimit: settings.turnLimit, aiLevel: settings.aiLevel,
        ai: Array.from({ length: count - 1 }, (_, k) => 'player_' + (k + 2)), ...map
      }
    : { turnLimit: settings.turnLimit, ...map };
  app.state = R.createGame(Math.floor(Math.random() * 2 ** 31), count, opts);
  app.undo = [];
  enterLocal();
  persist();
}

function enterLocal() {
  if (app.channel) {
    try { net.unsubscribe(app.channel); } catch (e) { /* ignore */ }
    app.channel = null;
  }
  history.replaceState(null, '', location.pathname);
  ui.hideMenu();
  ui.hideWinner();
  document.getElementById('copyLinkBtn').classList.add('hidden');
  render.syncBoard(app.state, viewer());
  focusHome();
  refresh();
}

// Kamera zu Spielbeginn auf die eigene Hauptstadt richten.
function focusHome() {
  const v = viewer();
  if (!app.state || !v) return;
  const cities = R.citiesFor(app.state, v);
  const home = cities.find(c => c.isCapital) || cities[0];
  if (home) render.cameraTo(home.q, home.r);
}

function continueGame() {
  const data = loadGame();
  if (!data) { ui.setContinue(null); ui.toast('Kein Spielstand gefunden', 'warn'); return; }
  app.gen++;
  app.mode = data.mode;
  app.online = false;
  app.gameId = null;
  app.myRole = null;
  app.hasOpponent = true;
  app.sel = null;
  app.busy = false;
  app.idleWarned = null;
  adopt(data.state);
  app.undo = [];
  if (app.mode === 'hotseat') {
    enterLocal();
    ui.showHandover(needName(app.state, app.state.turn), () => { focusHome(); offerReward(); offerDiplomacy(); });
    return;
  }
  enterLocal();
  ui.toast(`Spielstand geladen · Runde ${app.state.round}`, 'good');
  offerReward();
  offerDiplomacy();
  maybeBot();
}

async function startOnline() {
  app.gen++;
  app.mode = 'online';
  app.online = true;
  app.sel = null;
  app.busy = false;
  const hashId = location.hash.slice(1);

  if (hashId) {
    app.gameId = hashId;
    const { match, role, error } = await net.joinMatch(hashId);
    if (error) { ui.toast(error, 'warn'); showMenu(); return; }
    adopt(match.game_state);
    app.myRole = role;
    app.hasOpponent = !!match.player_2;
    ui.hideMenu();
    render.syncBoard(app.state, viewer());
    focusHome();
    refresh();
    if (!app.myRole) ui.toast('Spiel läuft bereits – du schaust zu.');
  } else {
    const state = R.createGame(Math.floor(Math.random() * 2 ** 31), 2);
    const { match, error } = await net.createMatch(state);
    if (error) { ui.toast(error, 'warn'); showMenu(); return; }
    adopt(match.game_state);
    app.myRole = 'player_1';
    app.hasOpponent = false;
    app.gameId = match.id;
    location.hash = match.id;
    ui.hideMenu();
    render.syncBoard(app.state, viewer());
    focusHome();
    refresh();
    ui.toast('Spiel erstellt – teile den Link!', 'good');
  }
  document.getElementById('copyLinkBtn').classList.remove('hidden');

  if (app.channel) {
    try { net.unsubscribe(app.channel); } catch (e) { /* ignore */ }
    app.channel = null;
  }
  app.channel = net.subscribe(app.gameId, match => {
    if (!app.online || !match.game_state) return;
    if (match.player_2) app.hasOpponent = true;
    // Nur echte Neuerungen übernehmen. Das Echo des eigenen Zuges (gleiche
    // rev) würde den Stand durch eine identische Kopie ersetzen und offene
    // Panels/Dialoge auf verwaiste Objekte zeigen lassen.
    if ((match.game_state.rev || 0) > (app.state?.rev || 0)) {
      adopt(match.game_state);
      app.busy = false;
      render.syncBoard(app.state, viewer());
    }
    refresh();
  });
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(location.href);
    ui.toast('Link kopiert!', 'good');
  } catch (e) {
    prompt('Link zum Teilen:', location.href);
  }
}

function boot() {
  const canvas = document.getElementById('gameCanvas');
  const ok = render.initRender(canvas, { onPick: onHexPick });
  if (!ok) {
    ui.setStatus('WebGL steht nicht zur Verfügung – 3D-Ansicht nicht möglich.');
    return;
  }

  ui.initUI({
    onOpenTech: () => { if (app.state) ui.openTech(app.state, ctx()); },
    onResearch: doResearch,
    onEndTurn: doEndTurn,
    onTrain: doTrain,
    onBuyPop: doBuyPop,
    onImprove: doImprove,
    onFound: doFound,
    onBuildBridge: doBuildBridge,
    onDestroyBridge: doDestroyBridge,
    onDisband: doDisband,
    onNextIdle: nextIdle,
    onUndo: doUndo,
    onToggleSound: () => { setMuted(!isMuted()); ui.setSoundIcon(isMuted()); if (!isMuted()) sfx('select'); },
    onOfferPeace: doOfferPeace,
    onDeclareWar: doDeclareWar,
    onChooseReward: doChooseReward,
    onClosePanel: () => { app.sel = null; refresh(); },
    onOpenOverview: () => { if (app.state) ui.showOverview(app.state, ctx()); },
    onCloseOverview: () => ui.hideOverview(),
    onFocusUnit: id => {
      const u = R.findUnit(app.state, id);
      if (!u) return;
      ui.hideOverview();
      app.sel = { kind: 'unit', id: u.id };
      render.cameraTo(u.q, u.r, true);
      refresh();
    },
    onFocusCity: (q, r) => {
      ui.hideOverview();
      app.sel = { kind: 'city', q, r };
      render.cameraTo(q, r, true);
      refresh();
    },
    onMenu: () => showMenu(),
    onRestart: () => { ui.hideWinner(); showMenu(); },
    onContinue: continueGame,
    onMode: mode => mode === 'online' ? startOnline() : startLocal(mode),
    onCopyLink: copyLink
  });

  document.getElementById('copyLinkBtn').addEventListener('click', copyLink);
  ui.setSoundIcon(isMuted());
  render.initMinimap(document.getElementById('minimap'), ([q, r]) => render.cameraTo(q, r));

  if (location.hash.length > 1) startOnline();
  else showMenu();

  window.__pb = { app, project: render.project, R, botStep, sync: () => { render.syncBoard(app.state, viewer()); refresh(); } };
}

boot();
