import * as R from './rules.js';
import * as render from './render.js';
import * as ui from './ui.js';
import * as net from './net.js';
import { botStep } from './ai.js';
import { NAMES, UNITS, TECHS } from './config.js';

const app = {
  mode: null,
  state: null,
  myRole: null,
  hasOpponent: true,
  gameId: null,
  sel: null,
  busy: false,
  online: false
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function ctx() {
  return {
    mode: app.mode,
    myRole: app.myRole,
    actAs: app.mode === 'hotseat' ? (app.state ? app.state.turn : 'player_1') : (app.myRole || 'player_1'),
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
  if (!st) return 'Lade Spiel...';
  if (st.winner) return `${NAMES[st.winner]} hat das Spiel gewonnen.`;
  if (app.mode === 'online') {
    if (!app.myRole) return `Zuschauer - Am Zug: ${NAMES[st.turn]}`;
    if (!app.hasOpponent) return 'Warte auf Mitspieler.';
    if (myTurn()) return `Du bist am Zug (${NAMES[app.myRole]})`;
    return `Gegner ist am Zug (${NAMES[st.turn]})`;
  }
  if (app.mode === 'bot') return myTurn() ? 'Du bist am Zug' : 'KI berechnet Zug...';
  return `Am Zug: ${NAMES[st.turn]}`;
}

function refresh() {
  if (!app.state) return;
  ui.updateStrip(app.state, ctx());
  ui.setStatus(statusText());
  ui.setEndTurn(myTurn());
  checkWinnerUI();
}

function checkWinnerUI() {
  if (app.state && app.state.winner) ui.showWinner(app.state, ctx());
}

async function afterAction(events = []) {
  for (const ev of events) {
    if (ev.kind === 'capture') {
      ui.toast(ev.to ? `Stadt erobert von ${NAMES[ev.to]}` : 'Stadt neutralisiert', 'good');
    }
  }
  app.busy = false;
  refresh();
  if (!app.state.winner) await maybeBot();
}

function actAs() {
  return ctx().actAs;
}

async function doMove(unit, q, r) {
  app.busy = true;
  const res = R.moveUnit(app.state, unit, q, r);
  if (!res.ok) { app.busy = false; refresh(); return; }
  await render.syncBoard(app.state);
  await afterAction(res.events);
}

async function doAttack(attacker, defender) {
  app.busy = true;
  const { events } = R.attack(app.state, attacker, defender);
  render.syncBoard(app.state);
  await afterAction(events);
}

async function doTrain(city, type) {
  const res = R.trainUnit(app.state, city, type, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); return; }
  app.busy = true;
  ui.toast(`${UNITS[type].name} ausgebildet`, 'good');
  await render.syncBoard(app.state);
  await afterAction();
}

async function doResearch(techId) {
  const res = R.research(app.state, techId, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); return; }
  app.busy = true;
  ui.toast(`${TECHS[techId].name} erforscht`, 'good');
  await afterAction();
  if (ui.isTechOpen()) ui.openTech(app.state, ctx());
}

async function doEndTurn() {
  if (!myTurn()) return;
  app.busy = true;
  app.sel = null;
  R.endTurn(app.state);
  await render.syncBoard(app.state);
  if (app.mode === 'hotseat') ui.toast(`Am Zug: ${NAMES[app.state.turn]}`);
  await afterAction();
}

async function maybeBot() {
  if (app.mode !== 'bot' || app.busy || !app.state || app.state.winner) return;
  if (app.state.turn !== 'player_2') return;
  app.busy = true;
  refresh();
  await sleep(400);
  while (app.state.turn === 'player_2' && !app.state.winner) {
    const step = botStep(app.state, 'player_2');
    if (!step) break;
    if (step.kind === 'attack') {
      R.attack(app.state, step.attacker, step.defender);
      render.syncBoard(app.state);
    } else if (step.kind === 'move') {
      R.moveUnit(app.state, step.unit, step.q, step.r);
      await render.syncBoard(app.state);
    } else if (step.kind === 'train') {
      R.trainUnit(app.state, step.city, step.type, 'player_2');
      await render.syncBoard(app.state);
    } else if (step.kind === 'research') {
      R.research(app.state, step.tech, 'player_2');
    }
    ui.updateStrip(app.state, ctx());
    await sleep(300);
  }
  if (!app.state.winner) {
    R.endTurn(app.state);
    await render.syncBoard(app.state);
  }
  app.busy = false;
  refresh();
}

async function onHexPick(key) {
  if (!app.state || app.state.winner || app.busy) return;
  const [q, r] = key.split(',').map(Number);
  const st = app.state;
  const unit = R.unitAt(st, q, r);
  const city = R.cityAt(st, q, r);

  if (!myTurn()) {
    if (unit) ui.showUnitPanel(st, unit, ctx());
    else if (city) ui.showCityPanel(st, city, ctx());
    return;
  }

  const sel = app.sel;
  if (sel && sel.kind === 'unit') {
    const me = R.findUnit(st, sel.id);
    if (me && me.owner === actAs() && !me.acted) {
      if (unit && unit.owner !== me.owner) {
        if (R.attackTargets(st, me).some(t => t.id === unit.id)) return doAttack(me, unit);
      } else if (!unit) {
        const reach = R.reachableMap(st, me);
        if (reach.has(key)) return doMove(me, q, r);
      }
    }
  }

  if (unit) {
    app.sel = { kind: 'unit', id: unit.id };
    ui.showUnitPanel(st, unit, ctx());
  } else if (city && city.owner === actAs()) {
    app.sel = { kind: 'city', q, r };
    ui.showCityPanel(st, city, ctx());
  } else {
    app.sel = null;
    ui.hidePanel();
  }
  refresh();
}

function startLocal(mode) {
  app.mode = mode;
  app.online = false;
  app.myRole = null;
  app.hasOpponent = true;
  app.sel = null;
  app.busy = false;
  app.state = R.createGame(Math.floor(Math.random() * 2 ** 31), 'imperius', 'bardur');
  ui.hideMenu();
  ui.hideWinner();
  render.syncBoard(app.state);
  refresh();
}

function boot() {
  const canvas = document.getElementById('gameCanvas');
  const ok = render.initRender(canvas, { onPick: onHexPick });
  if (!ok) {
    ui.setStatus('WebGL steht nicht zur Verfuegung.');
    return;
  }

  ui.initUI({
    onOpenTech: () => { if (app.state) ui.openTech(app.state, ctx()); },
    onResearch: doResearch,
    onEndTurn: doEndTurn,
    onTrain: doTrain,
    onMenu: () => ui.showMenu(),
    onRestart: () => { ui.hideWinner(); ui.showMenu(); },
    onMode: mode => startLocal(mode)
  });

  ui.showMenu();
}

boot();
