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
  // Info-Menü einer gewählten Einheit offen? Einfaches Antippen wählt nur
  // aus (kleine Leiste); erneutes Antippen/Doppeltipp oder „Details“ öffnet.
  panelOpen: false,
  busy: false,
  online: false,
  // Wird bei jedem neuen/geladenen Spiel erhöht; eine noch laufende
  // KI-Schleife des alten Spiels erkennt daran, dass sie aufhören muss.
  gen: 0
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
    if (!app.hasOpponent) return `Warte auf Mitspieler (${app.seated || 1}/${app.humanSeats || 2} da) – teile den Link (Menü → Link kopieren).`;
    if (myTurn()) return `Du bist am Zug (${needName(st, app.myRole)})`;
    if (R.isBot(st, st.turn)) return `KI zieht (${needName(st, st.turn)}) …`;
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
  warnThreats();
  announceMonuments();
  showNews();
  tutorTick();
  render.drawMinimap(app.state, viewer());
  updateSelection();
  checkWinnerUI();
}

// Bedrohte Städte rot markieren und einmal pro Zug darauf hinweisen.
// Rückblick auf die Züge der anderen seit dem eigenen letzten Zug.
function showNews() {
  if (!myTurn()) return;
  const p = actAs();
  const news = R.takeNews(app.state, p);
  if (!news.length) return;
  const name = pl => needName(app.state, pl);
  // „deinen Krieger“, aber „dein Schiff“.
  const ACC = { archer: 'Bogenschützen', giant: 'Riesen' };
  const your = t => (['catapult', 'boat', 'ship', 'battleship'].includes(t) ? 'dein ' : 'deinen ') + (ACC[t] || UNITS[t].name);
  const lines = [];
  for (const e of news.filter(e => e.kind === 'war')) lines.push({ text: `${name(e.by)} hat dir den Krieg erklärt` });
  for (const e of news.filter(e => e.kind === 'cityLost')) lines.push({ text: `${name(e.by)} hat eine deiner Städte erobert`, q: e.q, r: e.r });
  for (const e of news.filter(e => e.kind === 'unitLost')) lines.push({ text: `${name(e.by)} hat ${your(e.unit)} besiegt`, q: e.q, r: e.r });
  for (const e of news.filter(e => e.kind === 'converted')) lines.push({ text: `${name(e.by)} hat ${your(e.unit)} bekehrt`, q: e.q, r: e.r });
  for (const e of news.filter(e => e.kind === 'hit')) lines.push({ text: `${name(e.by)} hat ${your(e.unit)} angegriffen (−${e.dmg} Leben)`, q: e.q, r: e.r });
  ui.showNews(lines);
  persist();
}

// Neu freigeschaltete Monumente einmal ankündigen.
function announceMonuments() {
  if (!myTurn()) return;
  const p = actAs();
  R.checkMonuments(app.state, p);
  if (!app.monAnnounced) app.monAnnounced = new Set();
  for (const t of R.readyMonuments(app.state, p)) {
    const key = `${app.gen}:${p}:${t}`;
    if (app.monAnnounced.has(key)) continue;
    app.monAnnounced.add(key);
    ui.toast(`Monument freigeschaltet: ${IMPROVEMENTS[t].name} – im Stadtmenü auf einem freien Feld errichten (+3 Bevölkerung)`, 'good');
    sfx('promote');
  }
}

function warnThreats() {
  const mine = myTurn() && !app.state.winner;
  const threats = mine ? R.threatenedCities(app.state, actAs()) : [];
  render.setThreatMarkers(threats);
  if (!threats.length) return;
  const key = `${app.state.round}:${actAs()}`;
  if (app.threatWarned === key) return;
  app.threatWarned = key;
  ui.toast(threats.length === 1
    ? 'Achtung: Eine deiner Städte ist bedroht (rot markiert)'
    : `Achtung: ${threats.length} deiner Städte sind bedroht (rot markiert)`, 'warn');
}

// Reihum zur nächsten Einheit springen, die noch etwas tun kann.
function nextIdle() {
  if (!myTurn()) return;
  const idle = R.idleUnits(app.state, actAs());
  if (!idle.length) return;
  const cur = app.sel && app.sel.kind === 'unit' ? idle.findIndex(u => u.id === app.sel.id) : -1;
  const u = idle[(cur + 1) % idle.length];
  selectUnit(u.id);
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
    ui.hideUnitChip();
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
    if (app.panelOpen) {
      ui.hideUnitChip();
      ui.showUnitPanel(st, u, ctx());
    } else {
      ui.hidePanel();
      ui.showUnitChip(st, u, ctx());
    }
  } else {
    const city = R.cityAt(st, app.sel.q, app.sel.r);
    render.setHighlights({ selected: city.q + ',' + city.r });
    ui.hideUnitChip();
    ui.showCityPanel(st, city, ctx());
  }
}

// Einheit wählen. Eine neu gewählte Einheit zeigt nur die kleine Leiste;
// `open` öffnet direkt das Info-Menü.
function selectUnit(id, open = false) {
  const same = app.sel && app.sel.kind === 'unit' && app.sel.id === id;
  app.sel = { kind: 'unit', id };
  app.panelOpen = open || (same && app.panelOpen);
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

function announce(events) {
  for (const ev of events) {
    if (ev.kind === 'capture') {
      ui.toast(ev.to ? `Stadt erobert! (${needName(app.state, ev.to)})` : 'Stadt neutralisiert', 'good');
      sfx('capture');
    } else if (ev.kind === 'ruin') {
      ui.toast(`Ruine erkundet: ${ev.text}`, 'good');
      sfx('coin');
    } else if (ev.kind === 'lighthouse') {
      ui.toast(ev.text, 'good');
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
  app.busy = false;
  refresh();
  const token = (app.state.round || 0) + ':' + app.state.turn;
  if (myTurn() && !anyIdle(actAs()) && app.idleWarned !== token) {
    app.idleWarned = token;
    ui.toast('Alle Einheiten erledigt – Zug beenden', 'good');
  }
  persist();
  if (botsToRun()) {
    // KI-Züge laufen hier; maybeBot speichert online am Ende selbst.
    await maybeBot();
    return;
  }
  app.botDriver = false;
  await saveOnline();
  offerReward();
  offerDiplomacy();
}

// --- Diplomatie -------------------------------------------------------------

function doOfferPeace(to) {
  if (!myTurn()) return;
  const res = R.offerPeace(app.state, actAs(), to);
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
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
    const res = R.declareWar(app.state, actAs(), to);
    if (!res.ok) { ui.toast(res.reason, 'warn'); return; }
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
  const res = R.chooseReward(app.state, city, id, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
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
  const res = R.moveUnit(app.state, unit, q, r);
  if (!res.ok) { app.busy = false; refresh(); return; }
  if (!res.events.some(e => e.kind === 'embark')) sfx('move');
  app.sel = { kind: 'unit', id: unit.id };
  await render.syncBoard(app.state, viewer());
  await afterAction(res.events);
}

async function doAttack(attacker, defender) {
  app.busy = true;
  const { events } = R.attack(app.state, attacker, defender);
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
  const res = R.trainUnit(app.state, city, type, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  app.busy = true;
  ui.toast(`${UNITS[type].name} ausgebildet`, 'good');
  sfx('coin');
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doBuyPop(city) {
  city = liveCity(city);
  if (!city) return;
  const res = R.buyPop(app.state, city, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  app.busy = true;
  ui.toast('Bevölkerung wächst', 'good');
  sfx('coin');
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doImprove(city, type, q, r) {
  city = liveCity(city);
  if (!city) return;
  const res = R.improve(app.state, city, type, q, r, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  app.busy = true;
  const def = IMPROVEMENTS[type];
  ui.toast(`${def ? def.name + ' gebaut' : 'Gebäude gebaut'}`, 'good');
  sfx('build');
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doBuildRoad(q, r, unit) {
  if (unit) { unit = liveUnit(unit); if (!unit) return; }
  const res = R.buildRoad(app.state, actAs(), q, r, unit);
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  app.busy = true;
  ui.toast('Straße gebaut', 'good');
  sfx('build');
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doFound(unit) {
  unit = liveUnit(unit);
  if (!unit) return;
  const res = R.foundCity(app.state, unit, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  app.busy = true;
  ui.toast('Stadt gegründet', 'good');
  sfx('capture');
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doBuildBridge(unit, dir) {
  unit = liveUnit(unit);
  if (!unit) return;
  const res = R.buildBridge(app.state, unit, dir, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  app.busy = true;
  ui.toast('Brücke gebaut', 'good');
  sfx('build');
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doDestroyBridge(unit, q, r) {
  unit = liveUnit(unit);
  if (!unit) return;
  const res = R.destroyBridge(app.state, unit, q, r, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
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
    const res = R.disbandUnit(app.state, u, actAs());
    if (!res.ok) { ui.toast(res.reason, 'warn'); return; }
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
  ui.hideNews();
  app.busy = true;
  app.sel = null;
  R.endTurn(app.state);
  if (app.online) app.botDriver = true;
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
  const res = R.research(app.state, techId, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  app.busy = true;
  ui.toast(`${TECHS[techId].name} erforscht`, 'good');
  sfx('research');
  await afterAction();
  if (ui.isTechOpen()) ui.openTech(app.state, ctx(), true);
}

// Spielt sich der KI-Schritt in Sichtweite des Menschen ab? Nur dann wird er
// animiert – Züge im Nebel laufen ohne Pause durch.
function botStepVisible(step) {
  const seen = (q, r) => R.isVisible(app.state, viewer() || 'player_1', q, r);
  const spots = [];
  for (const o of [step.unit, step.attacker, step.defender, step.city]) if (o) spots.push([o.q, o.r]);
  if (step.q != null) spots.push([step.q, step.r]);
  return spots.some(([q, r]) => seen(q, r));
}

// Einen KI-Schritt ausführen und für den Menschen sichtbar machen.
// Gibt zurück, ob er sichtbar war (dann folgt eine kurze Pause).
async function playBotStep(step, player) {
  const human = viewer() || 'player_1';
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

// Ist gerade eine KI am Zug, die dieses Gerät rechnen soll? Lokal immer;
// online nur auf dem Gerät, das gerade seinen Zug beendet hat.
function botsToRun() {
  const st = app.state;
  if (!st || st.winner || !R.isBot(st, st.turn)) return false;
  if (app.mode === 'bot') return true;
  return app.mode === 'online' && app.botDriver;
}

async function maybeBot() {
  if (app.busy || !botsToRun()) return;
  const gen = app.gen;
  const stale = () => gen !== app.gen;
  app.busy = true;
  app.sel = null;
  refresh();
  await sleep(250);
  if (stale()) return;
  while (R.isBot(app.state, app.state.turn) && !app.state.winner && !humanDefeated()) {
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
      if (shown) await sleep(260);
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
  // Online: erst jetzt (nach allen KI-Zügen) den Stand speichern – der Server
  // nimmt Speicherungen nur vom Spieler an, der zuletzt am Zug war.
  if (app.online) {
    app.botDriver = false;
    await saveOnline();
  }
  refresh();
  offerReward();
  offerDiplomacy();
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

  // Bereits gewählte Einheit erneut antippen (auch Doppeltipp): erst das
  // Info-Menü öffnen; steht sie in einer Stadt, danach zum Stadtmenü wechseln.
  const prev = app.sel;
  if (unit && prev && prev.kind === 'unit' && prev.id === unit.id) {
    if (!app.panelOpen) app.panelOpen = true;
    else if (city) app.sel = { kind: 'city', q, r };
    sfx('select');
    refresh();
    return;
  }
  if (unit && city && prev && prev.kind === 'city' && prev.q === q && prev.r === r) {
    selectUnit(unit.id, true);
    refresh();
    return;
  }

  if (!myTurn()) {
    if (unit) selectUnit(unit.id);
    else app.sel = city ? { kind: 'city', q, r } : null;
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
        selectUnit(unit.id);
        refresh();
        return;
      } else if (city && city.owner === actAs()) {
        app.sel = { kind: 'city', q, r };
        refresh();
        return;
      }
    } else if (me && me.owner === actAs() && me.acted && unit && unit.owner === me.owner) {
      selectUnit(unit.id);
      refresh();
      return;
    }
  }

  if (unit) selectUnit(unit.id);
  else if (city) app.sel = { kind: 'city', q, r };
  else app.sel = null;
  refresh();
}

// --- Tutorial ---------------------------------------------------------------
// Schritte mit Erfolgsbedingung; `base` merkt sich Werte vom Schrittbeginn.
const TUTOR = [
  { text: 'Willkommen! Das ist deine Hauptstadt mit einem Krieger. Tippe den Krieger an (oder drücke die Leertaste).',
    done: () => app.sel && app.sel.kind === 'unit' },
  { text: 'Die hellen Felder zeigen, wohin er ziehen kann. Tippe ein helles Feld an, um zu ziehen. Der Nebel lichtet sich, wo deine Einheiten sind.',
    done: st => st.units.some(u => u.owner === 'player_1' && u.hasMoved) },
  { text: 'Gut! Graue Städte sind neutrale Dörfer: Ziehe hinein, um sie einzunehmen. Ruinen (Steinsäulen) bringen Belohnungen. Wenn deine Einheiten fertig sind, tippe oben auf „Zug beenden“.',
    done: (st, base) => st.round > base.round },
  { text: 'Jede Runde bekommst du Sterne (oben links). Tippe deine Hauptstadt an und bilde unter „Einheiten ausbilden“ eine Einheit aus. Steht dort eine Einheit, tippe die Stadt mehrmals an.',
    init: st => ({ units: st.units.filter(u => u.owner === 'player_1').length }),
    done: (st, base) => st.cities.some(c => c.owner === 'player_1' && c.trained) },
  { text: 'Öffne oben die „Forschung“ und erforsche eine Technologie. Sie schaltet neue Einheiten, Gebäude und Fähigkeiten frei.',
    init: st => ({ techs: st.techs.player_1.length }),
    done: (st, base) => st.techs.player_1.length > base.techs },
  { text: 'Städte wachsen durch Gebäude (Farm, Mine, Hafen …) im Stadtmenü und bringen dann mehr Sterne. Ein roter Ring warnt dich, wenn eine Stadt bedroht ist.',
    next: 'Weiter' },
  { text: 'Ziel: Nimm die Hauptstadt des Gegners ein. Mehr steht im Menü unter Hilfe, z. B. zu Brücken, Straßen, Leuchttürmen und Monumenten. Viel Erfolg!',
    next: 'Fertig' }
];

function tutorTick() {
  const st = app.state;
  const t = st && st.tutorial;
  if (!t || app.mode !== 'bot' || st.winner) { ui.hideTutor(); return; }
  let step = TUTOR[t.step];
  while (step && step.done && step.done(st, t.base || {})) {
    t.step++;
    step = TUTOR[t.step];
    t.base = step ? { round: st.round, ...(step.init ? step.init(st) : {}) } : {};
    sfx('select');
    persist();
  }
  if (!step) { delete st.tutorial; ui.hideTutor(); persist(); return; }
  ui.showTutor({ text: step.text, step: t.step, total: TUTOR.length, next: step.next });
}

function onTutor(action) {
  const st = app.state;
  if (!st || !st.tutorial) return;
  const step = TUTOR[st.tutorial.step];
  if (action === 'next' && step && step.next) {
    st.tutorial.step++;
    const nx = TUTOR[st.tutorial.step];
    st.tutorial.base = nx ? { round: st.round, ...(nx.init ? nx.init(st) : {}) } : {};
  } else if (action === 'skip') {
    delete st.tutorial;
  }
  persist();
  tutorTick();
}

function startTutorial() {
  startLocal('bot', {
    count: 2, tribe: 'imperius', mapSize: 'small', mapType: 'continents', aiLevel: 'easy', turnLimit: null
  });
  app.state.tutorial = { step: 0, base: { round: app.state.round } };
  persist();
  refresh();
}

function startLocal(mode, override = null) {
  app.gen++;
  app.mode = mode;
  app.online = false;
  app.gameId = null;
  app.myRole = null;
  app.hasOpponent = true;
  app.sel = null;
  app.busy = false;
  app.idleWarned = null;
  const settings = { ...ui.getSettings(), ...(override || {}) };
  const count = override && override.count ? override.count : mode === 'bot' ? settings.bots + 1 : settings.humans;
  const tribe = mode === 'bot' ? (override && override.tribe) || ui.getTribe() : null;
  const map = { mapSize: settings.mapSize, mapType: settings.mapType };
  const opts = mode === 'bot'
    ? {
        tribe, stars: settings.stars, turnLimit: settings.turnLimit, aiLevel: settings.aiLevel,
        ai: Array.from({ length: count - 1 }, (_, k) => 'player_' + (k + 2)), ...map
      }
    : { turnLimit: settings.turnLimit, ...map };
  app.state = R.createGame(Math.floor(Math.random() * 2 ** 31), count, opts);
  enterLocal();
  persist();
}

function enterLocal() {
  if (app.channel) {
    try { net.unsubscribe(app.channel); } catch (e) { /* ignore */ }
    app.channel = null;
  }
  history.replaceState(null, '', location.pathname);
  ui.hideNews();
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
    app.hasOpponent = allSeated(match);
    ui.hideMenu();
    render.syncBoard(app.state, viewer());
    focusHome();
    refresh();
    if (!app.myRole) ui.toast('Spiel läuft bereits – du schaust zu.');
  } else {
    const settings = ui.getSettings();
    const humans = settings.humans;
    const bots = Math.min(settings.onlineBots, 5 - humans);
    const state = R.createGame(Math.floor(Math.random() * 2 ** 31), humans + bots, {
      tribe: ui.getTribe(), stars: settings.stars, turnLimit: settings.turnLimit, aiLevel: settings.aiLevel,
      mapSize: settings.mapSize, mapType: settings.mapType,
      ai: Array.from({ length: bots }, (_, k) => 'player_' + (k + humans + 1))
    });
    const { match, error } = await net.createMatch(state);
    if (error) { ui.toast(error, 'warn'); showMenu(); return; }
    adopt(match.game_state);
    app.myRole = 'player_1';
    app.hasOpponent = allSeated(match);
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
    if (allSeated(match)) app.hasOpponent = true;
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

// Haben alle menschlichen Plätze einen Spieler? (Öffentliche Antwort der
// Datenbank: `joined`; Realtime liefert die Zeile mit `seats`; ältere Server
// kennen nur player_2.)
function allSeated(match) {
  const st = match.game_state || app.state;
  if (!st) return !!match.player_2;
  const humans = (st.players || []).filter(p => !(st.ai || []).includes(p));
  const joined = Array.isArray(match.joined) ? match.joined
    : match.seats && typeof match.seats === 'object' ? Object.keys(match.seats)
    : [match.player_1 ? 'player_1' : null, match.player_2 ? 'player_2' : null].filter(Boolean);
  app.seated = humans.filter(h => joined.includes(h)).length;
  app.humanSeats = humans.length;
  return humans.every(h => joined.includes(h));
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
    onBuildRoad: doBuildRoad,
    onJump: (q, r) => render.cameraTo(q, r, true),
    onDestroyBridge: doDestroyBridge,
    onDisband: doDisband,
    onNextIdle: nextIdle,
    onSelectCity: (q, r) => { app.sel = { kind: 'city', q, r }; sfx('select'); refresh(); },
    onSelectUnit: id => { if (R.findUnit(app.state, id)) { selectUnit(id, true); sfx('select'); refresh(); } },
    onUnitDetails: () => { if (app.sel && app.sel.kind === 'unit') { app.panelOpen = true; refresh(); } },
    onCamera: cmd => {
      if (cmd === 'rotL') render.rotateCamera(-1);
      else if (cmd === 'rotR') render.rotateCamera(1);
      else if (cmd === 'tiltUp') render.tiltCamera(-1);
      else if (cmd === 'tiltDown') render.tiltCamera(1);
      else render.resetCamera();
    },
    onHotkey: key => {
      if (!app.state) return;
      if (key === 'next') nextIdle();
      else if (key === 'end') { if (myTurn()) doEndTurn(); }
      else if (key === 'tech') ui.openTech(app.state, ctx());
      else if (key === 'overview') ui.showOverview(app.state, ctx());
      else if (key === 'details') { if (app.sel && app.sel.kind === 'unit') { app.panelOpen = !app.panelOpen; refresh(); } }
      else if (key === 'home') focusHome();
      else if (key === 'sound') { setMuted(!isMuted()); ui.setSoundIcon(isMuted()); }
      else if (key === 'deselect') { app.sel = null; refresh(); }
      else if (key === 'panL') render.panCamera(-1, 0);
      else if (key === 'panR') render.panCamera(1, 0);
      else if (key === 'panU') render.panCamera(0, 1);
      else if (key === 'panD') render.panCamera(0, -1);
      else if (key === 'zoomIn') render.zoomCamera(0.8);
      else if (key === 'zoomOut') render.zoomCamera(1.25);
    },
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
      selectUnit(u.id);
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
    onMode: mode => mode === 'online' ? startOnline() : mode === 'tutorial' ? startTutorial() : startLocal(mode),
    onTutor,
    onCopyLink: copyLink
  });

  document.getElementById('copyLinkBtn').addEventListener('click', copyLink);
  ui.setSoundIcon(isMuted());
  render.initMinimap(document.getElementById('minimap'), ([q, r]) => render.cameraTo(q, r));

  if (location.hash.length > 1) startOnline();
  else showMenu();

  window.__pb = { app, project: render.project, R, botStep, sync: () => { render.syncBoard(app.state, viewer()); refresh(); }, cam: render.debugCamera };
}

boot();
