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

function needName(state, player) {
  return R.tribeName(state, player) || NAMES[player];
}

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
  if (!st) return 'Lade Spiel…';
  if (st.winner) return `${needName(st, st.winner)} hat alle Städte erobert und gewinnt.`;
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
  updateSelection();
  checkWinnerUI();
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
    render.setHighlights({
      selected: u.q + ',' + u.r,
      move: canCommand && u.mp > 0 ? R.reachableMap(st, u) : null,
      attack: canCommand ? R.attackTargets(st, u) : null
    });
    ui.showUnitPanel(st, u, ctx());
  } else {
    const city = R.cityAt(st, app.sel.q, app.sel.r);
    render.setHighlights({ selected: city.q + ',' + city.r });
    ui.showCityPanel(st, city, ctx());
  }
}

function checkWinnerUI() {
  if (app.state && app.state.winner) ui.showWinner(app.state, ctx());
}

async function saveOnline() {
  if (!app.online || !app.gameId) return;
  const { error } = await net.saveMatch(app.gameId, app.state);
  if (error) ui.toast(error, 'warn');
}

async function afterAction(events = []) {
  for (const ev of events) {
    if (ev.kind === 'capture') {
      ui.toast(ev.to ? `Stadt erobert! (${needName(app.state, ev.to)})` : 'Stadt neutralisiert', 'good');
    }
  }
  app.busy = false;
  refresh();
  await saveOnline();
  if (!app.state.winner) await maybeBot();
}

function actAs() {
  return ctx().actAs;
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
  app.sel = { kind: 'unit', id: unit.id };
  await render.syncBoard(app.state, viewer());
  await afterAction(res.events);
}

async function doAttack(attacker, defender) {
  app.busy = true;
  const { events } = R.attack(app.state, attacker, defender);
  render.syncBoard(app.state, viewer());
  await render.playCombat(events);
  if (R.findUnit(app.state, attacker.id)) app.sel = { kind: 'unit', id: attacker.id };
  else app.sel = null;
  await afterAction(events);
}

async function doTrain(city, type) {
  const res = R.trainUnit(app.state, city, type, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); return; }
  app.busy = true;
  ui.toast(`${UNITS[type].name} ausgebildet`, 'good');
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doBuyPop(city) {
  const res = R.buyPop(app.state, city, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); return; }
  app.busy = true;
  ui.toast('Bevölkerung wächst', 'good');
  await render.syncBoard(app.state, viewer());
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
  await render.syncBoard(app.state, viewer());
  if (app.mode === 'hotseat') ui.toast(`Am Zug: ${needName(app.state, app.state.turn)}`);
  await afterAction();
}

async function maybeBot() {
  if (app.mode !== 'bot' || app.busy || !app.state || app.state.winner) return;
  if (app.state.turn === 'player_1') return;
  app.busy = true;
  app.sel = null;
  refresh();
  await sleep(550);
  while (app.state.turn !== 'player_1' && !app.state.winner) {
    const player = app.state.turn;
    let steps = 0;
    while (app.state.turn === player && !app.state.winner) {
      const step = botStep(app.state, player);
      if (!step) break;
      if (step.kind === 'attack') {
        const { events } = R.attack(app.state, step.attacker, step.defender);
        render.syncBoard(app.state, viewer());
        await render.playCombat(events);
      } else if (step.kind === 'move') {
        R.moveUnit(app.state, step.unit, step.q, step.r);
        await render.syncBoard(app.state, viewer());
      } else if (step.kind === 'train') {
        R.trainUnit(app.state, step.city, step.type, player);
        await render.syncBoard(app.state, viewer());
      } else if (step.kind === 'buyPop') {
        R.buyPop(app.state, step.city, player);
        await render.syncBoard(app.state, viewer());
      } else if (step.kind === 'research') {
        R.research(app.state, step.tech, player);
      }
      ui.updateStrip(app.state, ctx());
      await sleep(430);
      steps++;
      if (steps > 220) break;
    }
    if (app.state.turn === player && !app.state.winner) {
      R.endTurn(app.state);
      await render.syncBoard(app.state, viewer());
      ui.updateStrip(app.state, ctx());
    }
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
  else if (city && city.owner === actAs()) app.sel = { kind: 'city', q, r };
  else app.sel = null;
  refresh();
}

function startLocal(mode) {
  app.mode = mode;
  app.online = false;
  app.gameId = null;
  app.myRole = null;
  app.hasOpponent = true;
  app.sel = null;
  app.busy = false;
  const count = mode === 'bot' ? 4 : 2;
  const tribe = mode === 'bot' ? ui.getTribe() : null;
  app.state = R.createGame(Math.floor(Math.random() * 2 ** 31), count, tribe);
  history.replaceState(null, '', location.pathname);
  ui.hideMenu();
  ui.hideWinner();
  document.getElementById('copyLinkBtn').classList.add('hidden');
  render.syncBoard(app.state, viewer());
  refresh();
}

async function startOnline() {
  app.mode = 'online';
  app.online = true;
  app.sel = null;
  app.busy = false;
  const hashId = location.hash.slice(1);

  if (hashId) {
    app.gameId = hashId;
    const { match, role, error } = await net.joinMatch(hashId);
    if (error) { ui.toast(error, 'warn'); ui.showMenu(); return; }
    app.state = match.game_state;
    app.myRole = role;
    app.hasOpponent = !!match.player_2;
    ui.hideMenu();
    render.syncBoard(app.state, viewer());
    refresh();
    if (!app.myRole) ui.toast('Spiel läuft bereits – du schaust zu.');
  } else {
    const state = R.createGame(Math.floor(Math.random() * 2 ** 31), 2);
    const { match, error } = await net.createMatch(state);
    if (error) { ui.toast(error, 'warn'); ui.showMenu(); return; }
    app.state = match.game_state;
    app.myRole = 'player_1';
    app.hasOpponent = false;
    app.gameId = match.id;
    location.hash = match.id;
    ui.hideMenu();
    render.syncBoard(app.state, viewer());
    refresh();
    ui.toast('Spiel erstellt – teile den Link!', 'good');
  }
  document.getElementById('copyLinkBtn').classList.remove('hidden');

  if (app.channel) {
    try { net.unsubscribe(app.channel); } catch (e) { /* ignore */ }
    app.channel = null;
  }
  app.channel = net.subscribe(app.gameId, match => {
    if (!app.online) return;
    app.state = match.game_state;
    if (match.player_2) app.hasOpponent = true;
    app.busy = false;
    render.syncBoard(app.state, viewer());
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
    onMenu: () => ui.showMenu(),
    onRestart: () => { ui.hideWinner(); ui.showMenu(); },
    onMode: mode => mode === 'online' ? startOnline() : startLocal(mode),
    onCopyLink: copyLink
  });

  document.getElementById('copyLinkBtn').addEventListener('click', copyLink);

  if (location.hash.length > 1) startOnline();
  else ui.showMenu();

  window.__pb = { app, project: render.project, R, botStep };
}

boot();
