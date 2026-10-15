import * as R from './rules.js';
import * as render from './render.js';
import * as ui from './ui.js';
import * as net from './net.js';
import { botStep, applyStep } from './ai.js';
import { sfx, isMuted, setMuted } from './sound.js';
import { saveGame, loadGame, saveInfo, clearSave, validState } from './save.js';
import * as P from './profile.js';
import { shareResult } from './share.js';
import * as K from './campaign.js';
import * as AP from './admin-panel.js';
import { NAMES, UNITS, TECHS, IMPROVEMENTS, CITY_REWARDS, AI_LEVELS, PERSONAS } from './config.js';

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
    if (!app.hasOpponent) return `Warte auf Mitspieler (${app.seated || 1}/${app.humanSeats || 2} da) – teile den Link (im Menü auf „Link zum Spiel kopieren“).`;
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
  greetNewFaces();
  announceEliminations();
  announceMonuments();
  showNews();
  turnStartFeedback();
  tutorTick();
  missionTick();
  render.drawMinimap(app.state, viewer());
  updateSelection();
  checkWinnerUI();
  AP.update();
}

// Bedrohte Städte rot markieren und einmal pro Zug darauf hinweisen.
// Zugbeginn: Einkommen über der Hauptstadt zeigen, Schonfrist ankündigen.
function turnStartFeedback() {
  if (!myTurn() || app.state.winner) return;
  const p = actAs(), st = app.state;
  const key = `${app.gen}:${st.round}:${p}`;
  if (app.turnGreeted === key) return;
  app.turnGreeted = key;
  const cities = R.citiesFor(st, p);
  const home = cities.find(c => c.isCapital) || cities[0];
  if (home && st.round > 1) render.floatAt(home.q, home.r, `+${R.incomeFor(st, p)}`, '#facc15');
  const grace = R.graceUntil(st);
  const bots = st.players.filter(o => R.isBot(st, o) && R.alive(st, o));
  if (!grace || !bots.some(o => R.graceProtects(st, o, p))) return;
  if (st.round === 1) ui.toast(`Schonfrist: Die KI greift dich bis Runde ${grace} nicht an – außer du greifst sie zuerst an. Nutze die Zeit zum Ausbauen!`, 'good');
  else if (st.round === grace) ui.toast('Letzte Runde der Schonfrist – ab der nächsten Runde kann die KI angreifen.', 'warn');
}

// Rundenbericht zu Beginn des eigenen Zuges: was dir passiert ist (gruppiert
// nach Gegner), was in der Welt geschah, und wie du dastehst.
function showNews() {
  if (!myTurn()) return;
  const st = app.state, p = actAs();
  const all = R.takeReport(st, p);
  const key = `${app.gen}:${st.round}:${p}`;
  if (app.reportShown === key) return;
  app.reportShown = key;
  if (st.round <= 1 || !R.alive(st, p)) return;
  const name = pl => needName(st, pl);
  const ACC = { archer: 'Bogenschützen', giant: 'Riesen' };
  const unitName = t => ACC[t] || UNITS[t].name;
  const mine = all.filter(e => e.victim === p);
  const sections = [];

  // Gegen dich: je Gegner zusammengefasst.
  const against = [];
  for (const e of mine.filter(e => e.kind === 'war')) against.push({ tone: 'bad', text: `${name(e.by)} hat dir den Krieg erklärt` });
  for (const e of mine.filter(e => e.kind === 'cityLost')) against.push({ tone: 'bad', text: `${name(e.by)} hat eine deiner Städte erobert`, q: e.q, r: e.r });
  const byFoe = new Map();
  for (const e of mine.filter(e => ['unitLost', 'hit', 'converted'].includes(e.kind))) {
    const f = byFoe.get(e.by) || { lost: [], conv: [], hits: 0, dmg: 0, at: null };
    if (e.kind === 'unitLost') f.lost.push(unitName(e.unit));
    else if (e.kind === 'converted') f.conv.push(unitName(e.unit));
    else { f.hits++; f.dmg += e.dmg || 0; }
    f.at = f.at || [e.q, e.r];
    byFoe.set(e.by, f);
  }
  for (const [foe, f] of byFoe) {
    const parts = [];
    if (f.lost.length) parts.push(`${f.lost.length === 1 ? 'eine Einheit' : f.lost.length + ' Einheiten'} besiegt (${f.lost.join(', ')})`);
    if (f.conv.length) parts.push(`${f.conv.join(', ')} bekehrt`);
    if (f.hits) parts.push(`${f.hits === 1 ? 'einmal' : f.hits + '-mal'} angegriffen (−${f.dmg} Leben)`);
    against.push({ tone: f.lost.length || f.conv.length ? 'bad' : 'warn', text: `${name(foe)}: ${parts.join(', ')}`, q: f.at[0], r: f.at[1] });
  }
  if (against.length) sections.push({ title: 'Gegen dich', lines: against });

  // Weltgeschehen: Eroberungen und Niederlagen anderer, soweit du sie kennst.
  const known = new Set((st.explored && st.explored[p]) || []);
  const world = [];
  for (const e of all.filter(e => e.victim !== p)) {
    if (e.kind === 'eliminated') world.push({ tone: 'info', text: `${name(e.victim)} wurde von ${name(e.by)} besiegt` });
    else if (e.kind === 'cityLost' && known.has(e.q + ',' + e.r)) {
      world.push({ tone: 'info', text: `${name(e.by)} hat eine Stadt von ${e.victim ? name(e.victim) : 'neutral'} erobert`, q: e.q, r: e.r });
    } else if (e.kind === 'war' && e.victim) world.push({ tone: 'info', text: `${name(e.by)} hat ${name(e.victim)} den Krieg erklärt` });
  }
  if (world.length) sections.push({ title: 'In der Welt', lines: world.slice(0, 4) });

  // Deine Lage: Einkommen, Rang, Bedrohungen, offene Aufgaben.
  const rank = R.ranking(st).filter(x => R.alive(st, x.player));
  const place = rank.findIndex(x => x.player === p) + 1;
  const status = [];
  const threats = R.threatenedCities(st, p);
  if (threats.length) status.push({ tone: 'warn', text: `${threats.length === 1 ? 'Eine Stadt ist' : threats.length + ' Städte sind'} bedroht`, q: threats[0].q, r: threats[0].r });
  const pending = R.citiesFor(st, p).find(c => R.pendingLevel(c));
  if (pending) status.push({ tone: 'good', text: 'Eine Stadt ist aufgestiegen – Belohnung wählen', q: pending.q, r: pending.r });
  const ready = R.readyMonuments(st, p);
  if (ready.length) status.push({ tone: 'good', text: `Monument bereit: ${IMPROVEMENTS[ready[0]].name}` });
  if (!against.length && !world.length && !status.length) return;
  app.lastReport = {
    head: `Runde ${st.round} · +${R.incomeFor(st, p)} Sterne · Platz ${place} von ${rank.length}${rank[0] && rank[0].player !== p ? ` · vorn: ${name(rank[0].player)}` : ''}`,
    sections: status.length ? [...sections, { title: 'Bei dir', lines: status }] : sections
  };
  ui.showNews(app.lastReport);
  persist();
}

// KI-Botschaft je Persönlichkeit, z. B. beim ersten Treffen oder bei Krieg.
function quote(ai, kind) {
  const st = app.state;
  const persona = PERSONAS[R.personaOf(st, ai)];
  if (!persona || !persona.lines[kind]) return;
  const lines = persona.lines[kind];
  const line = lines[(st.round + ai.length + kind.length) % lines.length];
  ui.toast(`„${line}“ – ${needName(st, ai)} (${persona.name})`, 'quote');
}

// Erste Begegnung mit einer KI: Begrüßung in ihrem Ton.
function greetNewFaces() {
  const st = app.state, me = viewer();
  if (!st || !me || !st.persona) return;
  if (!app.metSeen || app.metSeen.gen !== app.gen) {
    app.metSeen = { gen: app.gen, set: new Set(st.players.filter(p => R.hasMet(st, me, p))) };
    return;
  }
  for (const p of st.players) {
    if (p === me || app.metSeen.set.has(p) || !R.hasMet(st, me, p)) continue;
    app.metSeen.set.add(p);
    quote(p, 'meet');
  }
}

// Neu besiegte Stämme einmal melden.
function announceEliminations() {
  const st = app.state;
  if (!st) return;
  if (!app.elimSeen || app.elimSeen.gen !== app.gen) {
    // Beim Laden eines Spiels bereits bekannte Niederlagen nicht erneut melden.
    app.elimSeen = { gen: app.gen, set: new Set(Object.keys(st.eliminated || {})) };
    return;
  }
  if (!st.eliminated) return;
  const me = viewer();
  for (const [p, e] of Object.entries(st.eliminated)) {
    if (app.elimSeen.set.has(p)) continue;
    app.elimSeen.set.add(p);
    if (p === me) continue;
    if (e.by === me) quote(p, 'doom');
    const by = e.by === me ? 'dir' : e.by ? needName(st, e.by) : null;
    ui.toast(`${needName(st, p)} wurde besiegt${by ? ` – von ${by}` : ''}!`, e.by === me ? 'good' : '');
    if (e.by === me) sfx('win');
  }
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
    const pend = app.pending && app.pending.unitId === u.id && !app.pending.until ? app.pending : null;
    render.setHighlights({
      selected: u.q + ',' + u.r,
      target: pend ? pend.key : null,
      move: canCommand && u.mp > 0 ? R.reachableMap(st, u) : null,
      attack: canCommand ? R.attackTargets(st, u) : null,
      bridge: canBridge ? R.bridgeOptions(st, u).flatMap(o => o.tiles) : null
    });
    let hint = null;
    let duel = null;
    if (pend) {
      const [tq, tr] = pend.key.split(',').map(Number);
      const foe = R.unitAt(st, tq, tr);
      if (pend.kind === 'attack' && foe) {
        const res = R.battleResults(st, u, foe);
        const range = Math.max(...[u.q - tq, u.r - tr, u.q - tq + u.r - tr].map(Math.abs));
        const back = res.damage >= foe.hp ? 0 : (R.rangeOf(st, foe) >= range && !UNITS[foe.type].abilities.includes('stiff') ? res.retaliation : 0);
        hint = `Nochmal tippen zum Angreifen · ${res.damage >= foe.hp ? 'besiegt ' + UNITS[foe.type].name : res.damage + ' Schaden'}${back ? ' · Gegenschlag ' + back : ''}`;
        // Kampfvorschau als Schild am Ziel: beide Einheiten vorher und nachher.
        duel = { q: tq, r: tr, foe, damage: Math.min(res.damage, foe.hp), back };
      } else hint = 'Ziel gewählt – nochmal tippen zum Ziehen';
    }
    // Details klappen die Werkzeugreihe auf (statt eines eigenen Fensters).
    ui.hidePanel();
    ui.showUnitChip(st, u, { ...ctx(), hint, duel, expanded: app.panelOpen });
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
  if (!same) app.pending = null;
  app.sel = { kind: 'unit', id };
  app.panelOpen = open || (same && app.panelOpen);
}

function humanDefeated() {
  return app.mode === 'bot' && !!app.state && !app.state.winner && R.isEliminated(app.state, 'player_1');
}

function checkWinnerUI() {
  if (!app.state || app.reviewing) return;
  const over = app.state.winner || humanDefeated();
  if (over && app.endSound !== app.gen) {
    app.endSound = app.gen;
    const me = app.mode === 'online' ? app.myRole : 'player_1';
    sfx(app.state.winner && (app.mode === 'hotseat' || app.state.winner === me) ? 'win' : 'lose');
  }
  if (app.state.winner) { clearSave(); ui.showWinner(app.state, ctx()); recordProfile(); }
  else if (humanDefeated()) {
    clearSave();
    const easier = app.state.aiLevel !== 'easy' || app.state.players.length > 2;
    ui.showDefeat(app.state, ctx(), { easier, retry: true });
    recordProfile();
  }
}

// Beendete Partie einmal ins Profil eintragen (Solo gegen KI und online).
function recordProfile() {
  const st = app.state;
  const me = app.mode === 'online' ? app.myRole : app.mode === 'bot' ? 'player_1' : null;
  if (!me) { ui.showProfileResult(null); return; }
  // Testpartien (Admin-Panel) zählen nur auf Wunsch fürs Profil, nie für die Bestenliste.
  if (st.admin && !st.adminScore) {
    if (app.recordedGen !== app.gen) { app.recordedGen = app.gen; app.lastResult = null; ui.toast('Testpartie: nicht gewertet'); }
    ui.showProfileResult(null);
    return;
  }
  if (app.recordedGen !== app.gen) {
    app.recordedGen = app.gen;
    const score = st.finalScores && st.finalScores[me] != null ? st.finalScores[me] : R.score(st, me);
    const profile = P.loadProfile();
    // Online-Partien bleiben nach dem Ende abrufbar: jede nur einmal zählen.
    const gid = app.online ? 'online:' + app.gameId : null;
    if (gid && (profile.seen || []).includes(gid)) { app.lastResult = null; ui.showProfileResult(null); return; }
    app.lastResult = P.recordGame(profile, P.gameFacts(st, me, { won: st.winner === me, mode: app.mode, score }));
    if (gid) profile.seen = [...(profile.seen || []), gid].slice(-50);
    P.saveProfile(profile);
    syncOnline(profile, st, me, score);
    if (app.lastResult.achievements.length || app.lastResult.levelAfter > app.lastResult.levelBefore) sfx('promote');
  }
  if (app.lastResult) ui.showProfileResult(app.lastResult, P.levelProgress(P.loadProfile().xp), P.ACHIEVEMENTS);
  else ui.showProfileResult(null);
}

// Mit Namen: Tages-/Wochenwertung einreichen und das Profil auf dem Server
// sichern (für andere Geräte). Ohne Verbindung bleibt alles lokal.
async function syncOnline(profile, st, me, score) {
  if (!profile.name) {
    if (st.daily || st.weekly) ui.toast('Wähle im Menü einen Namen, dann zählen deine Punkte in der Bestenliste.');
    return;
  }
  const kind = st.admin ? null : st.daily ? 'daily' : st.weekly ? 'weekly' : null;
  if (kind) {
    const res = await net.submitScore(kind, st.daily || st.weekly, score, st.tribes ? st.tribes[me] : null, st.round);
    if (res.data) ui.toast(`Bestenliste ${kind === 'daily' ? 'heute' : 'diese Woche'}: Platz ${res.data.rank} von ${res.data.total}`, 'good');
    else if (res.error) ui.toast('Bestenliste: ' + res.error, 'warn');
  }
  await net.saveRemoteProfile(profile, P.levelOf(profile.xp));
}

function chooseName() {
  const profile = P.loadProfile();
  ui.askName(profile.name, async name => {
    const res = await net.claimName(name);
    if (res.error) return res.error;
    const fresh = P.loadProfile();
    fresh.name = res.data.name;
    P.saveProfile(fresh);
    await net.saveRemoteProfile(fresh, P.levelOf(fresh.xp));
    ui.toast(`Willkommen, ${res.data.name}!`, 'good');
    showMenu();
    return null;
  });
}

function profileCodeDialog() {
  ui.askName(net.profileCode(), async code => {
    code = String(code || '').trim();
    if (code === net.profileCode()) return null;
    if (!net.useProfileCode(code)) return 'Das ist kein gültiger Profil-Code.';
    const res = await net.myRemoteProfile();
    if (res.error || !res.data) return 'Zu diesem Code gibt es kein Profil (oder keine Verbindung).';
    const loaded = P.sanitizeProfile({ ...(res.data.data || {}), name: res.data.name });
    P.saveProfile(loaded);
    ui.toast(`Profil von ${res.data.name} geladen`, 'good');
    showMenu();
    return null;
  }, {
    title: 'Profil-Code', max: 64, ok: 'Übernehmen',
    text: 'Das ist dein geheimer Profil-Code. Gib ihn auf einem anderen Gerät hier ein, um Name, Stufe und Erfolge mitzunehmen. Verrate ihn niemandem – wer ihn kennt, spielt als du.'
  });
}

async function showBoard(kind) {
  const period = kind === 'daily' ? P.dateKey() : P.weekKey();
  ui.renderBoard(null, kind);
  const res = await net.leaderboard(kind, period);
  ui.renderBoard(res, kind, P.loadProfile().name);
}

// Lokale Partien nach jeder Aktion sichern (Neuladen / Tab schließen).
function persist() {
  if (app.online || !app.state) return;
  if (humanDefeated()) { clearSave(); return; }
  saveGame(app.mode, app.state);
}

function showMenu() {
  const profile = P.loadProfile();
  ui.renderProfile(profile, P.levelProgress(profile.xp), P.dailyChallenge(), P.ACHIEVEMENTS, P.weeklyChallenge());
  ui.renderLooks(profile, P.COSMETICS, P.cosmeticUnlocked, P.cosmeticHint, P.lookOf(profile));
  ui.renderCampaign(profile, K.MISSIONS, K.missionUnlocked, K.campaignStars(profile));
  ui.setContinue(saveInfo());
  ui.showMenu();
}

async function saveOnline() {
  if (!app.online || !app.gameId) return;
  // Eigenes Aussehen mitschicken (Mitspieler setzen ihres beim ersten Speichern).
  if (app.myRole) {
    if (!app.state.looks) app.state.looks = {};
    app.state.looks[app.myRole] = P.lookOf(P.loadProfile());
  }
  app.state.rev = (app.state.rev || 0) + 1;
  const { error, rejected } = await net.saveMatch(app.gameId, app.state);
  if (!error) return;
  ui.toast(error, 'warn');
  // Server hat den Zug abgelehnt: auf den gültigen Stand der Datenbank zurück.
  if (rejected) {
    const { match } = await net.fetchMatch(app.gameId);
    if (match && validState(match.game_state)) {
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
      if (ev.from && R.isBot(app.state, ev.from) && ev.to === viewer()) quote(ev.from, 'loseCity');
      sfx('capture');
      if (ev.city) render.celebrate(ev.city.q, ev.city.r, R.playerColor(app.state, ev.to), true);
    } else if (ev.kind === 'bounty') {
      if (ev.player === actAs()) ui.toast(`Gegner besiegt: +${ev.stars} Stern Beute`, 'good');
    } else if (ev.kind === 'provoke') {
      ui.toast(`Du hast ${needName(app.state, ev.player)} angegriffen – die Schonfrist gegen diesen Stamm ist vorbei.`, 'warn');
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
  app.pending = null;
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
  if (res.accepted) { ui.toast(`Frieden mit ${name} geschlossen`, 'good'); quote(to, 'peaceYes'); sfx('peace'); }
  else if (res.pending) ui.toast(`Friedensangebot an ${name} gesendet`, 'good');
  else { ui.toast(`${name} lehnt ab (neuer Versuch in 3 Runden)`, 'warn'); quote(to, 'peaceNo'); sfx('error'); }
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
  // Nach Spielende: ganze Karte ohne Nebel.
  if (app.reviewing) return null;
  if (app.mode === 'hotseat') return app.state.turn;
  if (app.mode === 'bot') return 'player_1';
  if (app.mode === 'online') return app.myRole || null;
  return null;
}

async function doMove(unit, q, r) {
  app.busy = true;
  render.setMovePath(unit.id, R.pathTo(app.state, unit, q, r));
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
  // Erst der Schlagabtausch (Geschoss, Treffer), dann Umfallen und Nachrücken.
  await render.playCombat(events);
  await render.syncBoard(app.state, viewer());
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
  render.celebrate(city.q, city.r);
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
  sfx(def && def.monument ? 'win' : 'build');
  render.celebrate(q, r, def && def.monument ? 0xfacc15 : 0x86efac, !!(def && def.monument));
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doBuildRoad(q, r, unit) {
  if (unit) { unit = liveUnit(unit); if (!unit) return; }
  const res = R.buildRoad(app.state, actAs(), q, r, unit);
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  app.busy = true;
  ui.toast('Weg gebaut', 'good');
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

async function doTrade(unit) {
  unit = liveUnit(unit);
  if (!unit) return;
  const res = R.trade(app.state, unit, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  app.busy = true;
  app.sel = null;
  ui.toast(`Handel ${res.foreign ? 'mit ' + needName(app.state, res.city.owner) : 'abgeschlossen'}: +${res.stars} Sterne`, 'good');
  sfx('build');
  render.floatAt(res.city.q, res.city.r, `+${res.stars}`, '#facc15');
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doUpgrade(unit) {
  unit = liveUnit(unit);
  if (!unit) return;
  const from = UNITS[unit.type].name;
  const res = R.upgradeUnit(app.state, unit, actAs());
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  app.busy = true;
  ui.toast(`${from} aufgerüstet zu ${UNITS[res.to].name}`, 'good');
  sfx('promote');
  render.celebrate(unit.q, unit.r, 0xfacc15);
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doLoadCargo(balloon, unitId) {
  balloon = liveUnit(balloon);
  const unit = R.findUnit(app.state, unitId);
  if (!balloon || !unit) return;
  const res = R.loadCargo(app.state, balloon, unit);
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  app.busy = true;
  ui.toast(`${UNITS[unit.type].name} steigt in den Ballon`, 'good');
  sfx('move');
  await render.syncBoard(app.state, viewer());
  await afterAction();
}

async function doUnloadCargo(balloon, q, r) {
  balloon = liveUnit(balloon);
  if (!balloon) return;
  const res = R.unloadCargo(app.state, balloon, q, r);
  if (!res.ok) { ui.toast(res.reason, 'warn'); sfx('error'); return; }
  app.busy = true;
  ui.toast(`${UNITS[res.unit.type].name} abgesetzt`, 'good');
  sfx('move');
  await render.syncBoard(app.state, viewer());
  await afterAction(res.events);
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
  app.pending = null;
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
  if (step.kind === 'move' && visibleBefore) render.setMovePath(step.unit.id, R.pathTo(app.state, step.unit, step.q, step.r));
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
    await render.playCombat(res.events || []);
    await render.syncBoard(app.state, viewer());
    if ((res.events || []).some(e => e.kind === 'capture' && e.from === human)) {
      ui.toast(`${needName(app.state, player)} hat eine deiner Städte erobert!`, 'warn');
      quote(player, 'winCity');
    }
    return true;
  }
  if (step.kind === 'move' && (res.events || []).some(e => e.kind === 'capture' && e.from === human)) {
    ui.toast(`${needName(app.state, player)} hat eine deiner Städte erobert!`, 'warn');
  }
  if (step.kind === 'war' && res.ok) {
    if (step.target === human) { ui.toast(`${needName(app.state, player)} bricht den Frieden und erklärt dir den Krieg!`, 'warn'); quote(player, 'war'); sfx('war'); }
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
      // Admin-Panel: pausierte KI beendet ihren Zug sofort.
      if (app.adminPauseAi) break;
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
  if (!app.state) return;
  const [q, r] = key.split(',').map(Number);
  if (AP.activeTool()) {
    if (app.busy) { ui.toast('Warte, bis die KI fertig ist', 'warn'); return; }
    if (AP.pick(q, r)) return;
  }
  if (app.state.winner || app.busy) return;
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

  // Zweiter Tipp auf ein vorgemerktes Ziel: ausführen (auch nach Wechsel ins Stadtmenü).
  const pend = app.pending;
  if (pend && pend.key === key && (!pend.until || performance.now() < pend.until)) {
    const me = R.findUnit(st, pend.unitId);
    app.pending = null;
    if (me && me.owner === actAs()) {
      if (pend.kind === 'attack' && unit && R.attackTargets(st, me).some(t => t.id === unit.id)) return doAttack(me, unit);
      if (pend.kind === 'move' && !unit && R.reachableMap(st, me).has(key)) return doMove(me, q, r);
    }
  }

  const sel = app.sel;
  if (sel && sel.kind === 'unit') {
    const me = R.findUnit(st, sel.id);
    if (me && me.owner === actAs() && !me.acted) {
      if (unit && unit.owner !== me.owner) {
        // Erster Tipp auf einen Gegner: nur vormerken und Vorschau zeigen.
        if (R.attackTargets(st, me).some(t => t.id === unit.id)) {
          app.pending = { unitId: me.id, key, kind: 'attack' };
          app.panelOpen = false;
          sfx('select');
        }
        refresh();
        return;
      } else if (!unit) {
        const reach = R.reachableMap(st, me);
        if (reach.has(key)) {
          if (city && city.owner === actAs()) {
            // Eigene Stadt: Antippen öffnet das Stadtmenü; nur ein schneller
            // Doppeltipp zieht die Einheit hinein.
            app.pending = { unitId: me.id, key, kind: 'move', until: performance.now() + 450 };
            app.sel = { kind: 'city', q, r };
            refresh();
            return;
          }
          app.pending = { unitId: me.id, key, kind: 'move' };
          app.panelOpen = false;
          sfx('select');
          refresh();
          return;
        }
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
  { text: 'Die hellen Felder zeigen, wohin er ziehen kann. Tippe ein helles Feld an – es leuchtet gelb – und tippe es zum Bestätigen noch einmal an. So ziehst du nie aus Versehen. Der Nebel lichtet sich, wo deine Einheiten sind.',
    done: st => st.units.some(u => u.owner === 'player_1' && u.hasMoved) },
  { text: 'Gut! Graue Städte sind neutrale Dörfer: Ziehe hinein, um sie einzunehmen. Ruinen (Steinsäulen) bringen Belohnungen. Wenn deine Einheiten fertig sind, tippe oben auf „Zug beenden“.',
    done: (st, base) => st.round > base.round },
  { text: 'Jede Runde bekommst du Sterne: die große Zahl oben links, darunter steht, wie viele nächste Runde dazukommen. Tippe deine Hauptstadt an und bilde unter „Einheiten ausbilden“ eine Einheit aus. Steht dort eine Einheit, tippe die Stadt mehrmals an.',
    init: st => ({ units: st.units.filter(u => u.owner === 'player_1').length }),
    done: (st, base) => st.cities.some(c => c.owner === 'player_1' && c.trained) },
  { text: 'Öffne oben die „Forschung“ und erforsche eine Technologie. Sie schaltet neue Einheiten, Gebäude und Fähigkeiten frei – zum Beispiel Landwirtschaft für Farmen.',
    init: st => ({ techs: st.techs.player_1.length }),
    done: (st, base) => st.techs.player_1.length > base.techs },
  { text: 'Tippe deine Hauptstadt an und dann „Ausbauen“: Du siehst dein Stadtgebiet in 3D. Orange markierte Felder kannst du jetzt bebauen – tippe eins an und wähle ein Gebäude. Jedes zeigt, wie viele Sterne es pro Runde mehr bringt.',
    init: st => ({ built: Object.keys(st.improvements || {}).filter(k => { const [q, r] = k.split(',').map(Number); const c = R.tileCity(st, q, r); return c && c.owner === 'player_1'; }).length }),
    done: (st, base) => Object.keys(st.improvements || {}).filter(k => { const [q, r] = k.split(',').map(Number); const c = R.tileCity(st, q, r); return c && c.owner === 'player_1'; }).length > base.built,
    next: 'Später' },
  { text: 'Der Knopf „bereit“ oben zeigt, wie viele Einheiten noch handeln können, und springt zur nächsten (auch mit der Leertaste). Ein roter Ring warnt dich, wenn eine Stadt im nächsten Zug angegriffen werden kann.',
    next: 'Weiter' },
  { text: 'Ziel: Nimm die Hauptstadt des Gegners ein. Mehr steht im Menü unter „Anleitung“, z. B. zu Brücken, Wegen, Leuchttürmen und Monumenten. Viel Erfolg!',
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

function startDaily() {
  const ch = P.dailyChallenge();
  startLocal('bot', {
    count: ch.count, tribe: ch.tribe, mapSize: ch.mapSize, mapType: ch.mapType,
    aiLevel: ch.aiLevel, turnLimit: ch.turnLimit, stars: ch.stars, seed: ch.seed
  });
  app.state.daily = ch.key;
  persist();
  ui.toast('Tagesherausforderung: Heute spielen alle dieselbe Karte mit demselben Stamm. Nach 30 Runden zählt die Punktzahl.', 'good');
}

function startMission(id) {
  const m = K.missionById(id);
  if (!m) return;
  const s = m.setup;
  let seed = 0;
  for (const ch of 'mission:' + id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  startLocal('bot', { count: s.count, tribe: s.tribe, mapSize: s.mapSize, mapType: s.mapType, aiLevel: s.aiLevel, turnLimit: null, seed });
  K.prepareMission(app.state, m);
  persist();
  refresh();
  ui.toast(`Mission „${m.title}“: ${m.goal}`, 'good');
}

// Missionsleiste und Abschluss: geschafft = Sieg mit Sternen.
function missionTick() {
  const st = app.state;
  if (!st || !st.mission || app.mode !== 'bot') { ui.showMission(null); return; }
  const s = K.missionStatus(st);
  if (!s) { ui.showMission(null); return; }
  const m = s.mission;
  const par = m.par ? ` · 2 Sterne bis Runde ${m.par[0]}, 3 bis Runde ${m.par[1]}` : ' · Sterne für 3 bzw. 5 Städte am Ende';
  ui.showMission(`<b>${esc2(m.title)}</b>: ${esc2(m.goal)} (${Math.min(s.have, s.need)}/${s.need})${par}`, s.have / s.need);
  if (s.done && !st.winner) {
    st.missionStars = s.stars;
    st.winner = 'player_1';
    st.endReason = 'mission';
    R.recordHistory(st, true);
  }
}
const esc2 = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function startWeekly() {
  const ch = P.weeklyChallenge();
  startLocal('bot', {
    count: ch.count, tribe: ch.tribe, mapSize: ch.mapSize, mapType: ch.mapType,
    aiLevel: ch.aiLevel, turnLimit: ch.turnLimit, stars: ch.stars, seed: ch.seed
  });
  R.applyWeeklyRule(app.state, ch.rule);
  app.state.weekly = ch.key;
  render.syncBoard(app.state, viewer());
  persist();
  refresh();
  ui.toast(`Wochen-Herausforderung „${ch.name}“: ${ch.desc} Nach ${ch.turnLimit} Runden zählt die Punktzahl.`, 'good');
}

function startTutorial() {
  startLocal('bot', {
    count: 2, tribe: 'imperius', mapSize: 'small', mapType: 'continents', aiLevel: 'easy', turnLimit: null
  });
  app.state.tutorial = { step: 0, base: { round: app.state.round } };
  persist();
  refresh();
}

function endReview() {
  app.reviewing = false;
  ui.setReview(false);
}

function startLocal(mode, override = null) {
  endReview();
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
  app.state = R.createGame(override && override.seed != null ? override.seed : Math.floor(Math.random() * 2 ** 31), count, opts);
  // Eigenes Aussehen (Kosmetik) für den Menschen gegen die KI.
  if (mode === 'bot') app.state.looks = { player_1: P.lookOf(P.loadProfile()) };
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

// Admin-Panel: geladenen Spielstand als lokale Partie fortsetzen.
function adminLoad(state) {
  app.gen++;
  app.mode = state.ai && state.ai.length ? 'bot' : 'hotseat';
  app.online = false;
  app.gameId = null;
  app.myRole = null;
  app.hasOpponent = true;
  app.sel = null;
  app.busy = false;
  app.idleWarned = null;
  app.lastReport = null;
  adopt(state);
  enterLocal();
  persist();
  offerReward();
  maybeBot();
}

async function startOnline() {
  endReview();
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
    if (!validState(match.game_state)) { ui.toast('Dieses Spiel ist beschädigt und kann nicht geladen werden.', 'warn'); showMenu(); return; }
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
    if (!validState(match.game_state)) return;
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
    onLoadCargo: doLoadCargo,
    onUpgrade: doUpgrade,
    onTrade: doTrade,
    onUnloadCargo: doUnloadCargo,
    onBuildRoad: doBuildRoad,
    onJump: (q, r) => render.cameraTo(q, r, true),
    onDestroyBridge: doDestroyBridge,
    onDisband: doDisband,
    onNextIdle: nextIdle,
    onSelectCity: (q, r) => { app.sel = { kind: 'city', q, r }; sfx('select'); refresh(); },
    onSelectUnit: id => { if (R.findUnit(app.state, id)) { selectUnit(id, true); sfx('select'); refresh(); } },
    onUnitDetails: () => { if (app.sel && app.sel.kind === 'unit') { app.panelOpen = !app.panelOpen; refresh(); } },
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
      else if (key === 'report') { if (app.lastReport) ui.showNews(app.lastReport); else ui.toast('Noch kein Rundenbericht in diesem Spiel'); }
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
    onOpenOverview: () => { if (app.state) ui.showOverview(app.state, { ...ctx(), hasReport: !!app.lastReport }); },
    onShowReport: () => { ui.hideOverview(); if (app.lastReport) ui.showNews(app.lastReport); },
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
    onChooseName: chooseName,
    onProfileCode: profileCodeDialog,
    onBoard: showBoard,
    onLook: (cat, id) => {
      const profile = P.loadProfile();
      if (!P.cosmeticUnlocked(profile, cat, id)) return;
      profile.look = { ...(profile.look || {}), [cat]: id };
      P.saveProfile(profile);
      ui.renderLooks(profile, P.COSMETICS, P.cosmeticUnlocked, P.cosmeticHint, P.lookOf(profile));
      const me = viewer();
      if (app.state && me && app.mode !== 'hotseat') {
        app.state.looks = { ...(app.state.looks || {}), [me]: P.lookOf(profile) };
        render.syncBoard(app.state, viewer());
        persist();
      }
      sfx('select');
    },
    onRestart: () => { endReview(); ui.hideWinner(); showMenu(); },
    onReview: on => {
      if (!app.state) return;
      app.reviewing = on;
      app.sel = null;
      ui.setReview(on);
      ui.hidePanel();
      render.syncBoard(app.state, viewer());
      if (on) render.resetCamera();
      refresh();
    },
    onShare: async () => {
      const st = app.state;
      if (!st) return;
      const me = app.mode === 'online' ? app.myRole : app.mode === 'bot' ? 'player_1' : null;
      const won = st.winner && st.winner === me;
      const headline = me ? (won ? 'Sieg!' : 'Besiegt') : `${needName(st, st.winner)} gewinnt`;
      const pts = me ? (st.finalScores && st.finalScores[me] != null ? st.finalScores[me] : R.score(st, me)) : null;
      const text = me
        ? (won ? `Ich habe Poly Battle als ${needName(st, me)} in Runde ${st.round} gewonnen` : `Ich habe als ${needName(st, me)} ${st.round} Runden in Poly Battle durchgehalten`) + ` – ${pts} Punkte${st.daily ? ` in der Tagesherausforderung ${st.daily.split('-').reverse().join('.')}` : ''}. Schaffst du mehr?`
        : `${needName(st, st.winner)} hat Poly Battle in Runde ${st.round} gewonnen.`;
      let photo = null;
      try { photo = render.snapshotMap(st, 2160, 1240); } catch (e) { photo = null; }
      // Danach wieder die normale Sicht (mit Nebel, außer in der Kartenansicht).
      render.syncBoard(st, viewer());
      const res = await shareResult(st, me, headline, text, photo);
      if (res === 'geladen') ui.toast('Bild gespeichert, Text in die Zwischenablage kopiert', 'good');
      else if (res === 'fehler') ui.toast('Bild konnte nicht erstellt werden', 'warn');
    },
    onRetry: easier => {
      const st = app.state;
      ui.hideWinner();
      if (!st) return showMenu();
      const levels = ['easy', 'normal', 'hard'];
      let aiLevel = st.aiLevel || 'normal', count = st.players.length;
      // Leichter: erst die Stufe senken, dann einen Gegner weniger.
      if (easier) { if (aiLevel !== 'easy') aiLevel = levels[levels.indexOf(aiLevel) - 1]; else count = Math.max(2, count - 1); }
      startLocal('bot', { count, aiLevel, tribe: st.tribes && st.tribes.player_1, mapSize: st.mapSize, mapType: st.mapType, turnLimit: st.turnLimit });
      if (easier) ui.toast(`Neues Spiel: ${AI_LEVELS[aiLevel].label}, ${count - 1} ${count === 2 ? 'Gegner' : 'Gegner'}`, 'good');
    },
    onContinue: continueGame,
    onMode: mode => mode === 'online' ? startOnline() : mode === 'tutorial' ? startTutorial() : mode === 'daily' ? startDaily() : mode === 'weekly' ? startWeekly() : mode.startsWith('mission:') ? startMission(mode.slice(8)) : startLocal(mode),
    onTutor,
    onCopyLink: copyLink
  });

  document.getElementById('copyLinkBtn').addEventListener('click', copyLink);
  ui.setSoundIcon(isMuted());
  render.initMinimap(document.getElementById('minimap'), ([q, r]) => render.cameraTo(q, r));

  AP.initAdmin({
    app: () => app,
    viewer,
    toast: ui.toast,
    // Online: Änderungen sofort an den Server (nur im eigenen Zug möglich).
    persist: () => { if (app.online) saveOnline(); else persist(); },
    myTurn,
    playerName: needName,
    redraw: () => { app.sel = null; render.syncBoard(app.state, viewer()); refresh(); },
    invalidateBoard: render.invalidateBoard,
    ai: { botStep, applyStep },
    validState,
    loadState: adminLoad,
    offerReward,
    showReport: () => { if (app.lastReport) ui.showNews(app.lastReport); else ui.toast('Noch kein Rundenbericht in diesem Spiel'); },
    askCode: onSave => ui.askName('', onSave, { title: 'Admin-Code', max: 40, ok: 'Freischalten', text: 'Nur für den Entwickler: Code eingeben, um das Admin-/Kreativ-Panel freizuschalten.' }),
    profileChanged: () => { if (!document.getElementById('menu-overlay').classList.contains('hidden')) showMenu(); },
    setPicking: on => document.body.classList.toggle('adm-picking', on)
  });

  // #admin am Ende der Adresse öffnet die Code-Abfrage (statt eines Online-Spiels).
  if (location.hash === '#admin') {
    history.replaceState(null, '', location.pathname + location.search);
    showMenu();
    AP.open();
  } else if (location.hash.length > 1) startOnline();
  else showMenu();
  // Auch bei schon offener Seite (Browser lädt bei geändertem # nicht neu).
  window.addEventListener('hashchange', () => {
    if (location.hash !== '#admin') return;
    history.replaceState(null, '', location.pathname + location.search);
    AP.open();
  });

  window.__pb = { app, project: render.project, R, botStep, sync: () => { render.syncBoard(app.state, viewer()); refresh(); }, cam: render.debugCamera };
}

boot();
