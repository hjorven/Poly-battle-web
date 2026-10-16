import {
  UNITS, UNIT_ORDER, TECHS, NAMES, MAX_POP,
  TRIBES, TRIBE_POOL, ABILITY_INFO, TERRAIN, RESOURCES, IMPROVEMENTS, STARS_OPTIONS, MONUMENTS, ROAD, PERSONAS,
  CITY_REWARDS, GAME_MODES, BRIDGE, MAP_SIZES, MAP_TYPES
} from './config.js';
import {
  cityIncome, techCost, tribeName, playerColor, maxHp, maxMove, attackOf, popCost, monumentReady, canBuildRoad, roadAt,
  terrainAt, defenceBonus, attackPreview, canImprove, resourceAt, improvementAt, cityTiles, canBuyPop,
  canAttackNow, canFound, canTrain, pendingLevel, rewardOptions, score, scoreBreakdown, ranking,
  bridgeOptions, canBuildBridge, destroyableBridges, disbandRefund, unitOptions, cityView, canRegenerate,
  hpCap, unitCost, tribeOf, cityAt, unitAt, cityPorts, improvementIncome, tradeOption, incomeFor, tileYield, improvePreview, monumentProgress, threatenedCities, loadOptions, unloadOptions, upgradeOption, improvementCost, defenseOf, players as playersOf, alive, atPeace, hasMet, canOfferPeace, pendingOffer
} from './rules.js';
import { DIRS, toWorld, hexDistance } from './hex.js';
import { openCityView, closeCityView, cityViewPick, cityViewProject, setCityViewMarks, project } from './render.js';

// Himmelsrichtungen der sechs Hex-Richtungen (Kamera blickt nach Norden).
const DIR_NAMES = ['Osten', 'Nordosten', 'Nordwesten', 'Westen', 'Südwesten', 'Südosten'];

const $ = id => document.getElementById(id);
const settings = { bots: 3, stars: 'normal', gamemode: 'conquest', ai: 'easy', mapsize: 'normal', maptype: 'continents', onlinebots: '0', humans: '2' };
let handlers = {};
let selectedTribe = null;

export function initUI(h) {
  handlers = h;
  bindTechNav();
  $('techBtn').addEventListener('click', () => handlers.onOpenTech());
  $('techClose').addEventListener('click', () => closeTech());
  $('tech-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeTech();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isTechOpen()) {
      e.preventDefault();
      closeTech();
    }
  });
  $('endTurnBtn').addEventListener('click', () => handlers.onEndTurn());
  $('idleBtn').addEventListener('click', () => handlers.onNextIdle());
  $('soundBtn').addEventListener('click', () => handlers.onToggleSound());
  document.querySelectorAll('[data-cam]').forEach(btn => btn.addEventListener('click', () => handlers.onCamera(btn.dataset.cam)));
  // Tastatur: Q/E drehen, R/F neigen, N Standardansicht (nicht beim Tippen in Feldern).
  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const map = { q: 'rotL', e: 'rotR', r: 'tiltUp', f: 'tiltDown', n: 'reset' };
    // Offene Dialoge (Menü, Bestätigung, Belohnung …): nur Escape gilt dort.
    const dialog = [...document.querySelectorAll('.overlay')].some(o => !o.classList.contains('hidden'));
    if (dialog) return;
    const cmd = map[e.key.toLowerCase()];
    if (cmd) { handlers.onCamera(cmd); return; }
    const keys = {
      ' ': 'next', Enter: 'end', t: 'tech', o: 'overview', i: 'details', h: 'home', m: 'sound', b: 'report',
      Escape: 'deselect', ArrowLeft: 'panL', ArrowRight: 'panR', ArrowUp: 'panU', ArrowDown: 'panD',
      '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut'
    };
    const action = keys[e.key] || keys[e.key.toLowerCase()];
    if (!action || e.target.closest && e.target.closest('button, select') && (action === 'next' || action === 'end')) return;
    e.preventDefault();
    handlers.onHotkey(action);
  });
  $('menuBtn').addEventListener('click', () => handlers.onMenu());
  $('coachBtn').addEventListener('click', () => handlers.onCoach && handlers.onCoach());
  $('chatBtn').addEventListener('click', () => handlers.onChat('toggle'));
  $('chatClose').addEventListener('click', () => handlers.onChat('close'));
  $('chatForm').addEventListener('submit', e => { e.preventDefault(); const t = $('chatInput').value.trim(); if (t) handlers.onChat('send', t); });
  $('chatInput').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') handlers.onChat('close'); });
  const QUICK = ['Hallo!', 'Gut gespielt', 'Kurz warten, bin gleich da', 'Frieden?', 'Das war knapp', 'Revanche?'];
  $('chatQuick').innerHTML = QUICK.map(q => `<button type="button" class="chip-btn" data-quick="${q}">${q}</button>`).join('');
  $('chatQuick').querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => handlers.onChat('send', b.dataset.quick)));
  // Die Karte reicht bis oben; Elemente darunter richten sich nach der Höhe der Kärtchen.
  const syncTop = () => document.documentElement.style.setProperty('--hud-h', $('topbar').offsetHeight + 'px');
  syncTop();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncTop).observe($('topbar'));
  else window.addEventListener('resize', syncTop);
  $('buildClose').addEventListener('click', closeBuild);
  $('build-overlay').addEventListener('click', e => { if (e.target === $('build-overlay')) closeBuild(); });
  document.addEventListener('keydown', e => { if (build.open && !e.target.closest('input, textarea, select')) buildKey(e); });
  $('winnerRestart').addEventListener('click', () => handlers.onRestart());
  $('winnerEasier').addEventListener('click', () => handlers.onRetry(true));
  $('winnerHarder').addEventListener('click', () => handlers.onRetry('harder'));
  document.querySelectorAll('[data-board]').forEach(b => b.addEventListener('click', () => handlers.onBoard(b.dataset.board)));
  // Menü-Reiter: Maus/Touch per Antippen, Tastatur mit Pfeiltasten (letzter Reiter bleibt gemerkt).
  const tabs = [...document.querySelectorAll('[data-mtab]')];
  tabs.forEach(t => {
    t.addEventListener('click', () => menuTab(t.dataset.mtab, true));
    t.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const i = tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1);
      const next = tabs[(i + tabs.length) % tabs.length];
      menuTab(next.dataset.mtab, true);
      next.focus();
    });
  });
  let saved = null;
  try { saved = localStorage.getItem('pb_menu_tab'); } catch (e) { saved = null; }
  menuTab(tabs.some(t => t.dataset.mtab === saved) ? saved : 'play', false);
  $('winnerMap').addEventListener('click', () => handlers.onReview(true));
  $('rpPlay').addEventListener('click', () => handlers.onReplay('toggle'));
  $('rpSlider').addEventListener('input', e => handlers.onReplay('seek', Number(e.target.value)));
  document.querySelectorAll('[data-rpspeed]').forEach(b => b.addEventListener('click', () => handlers.onReplay('speed', Number(b.dataset.rpspeed))));
  $('reviewBack').addEventListener('click', () => handlers.onReview(false));
  $('winnerShare').addEventListener('click', () => handlers.onShare());
  $('reviewShare').addEventListener('click', () => handlers.onShare());
  $('winnerRetry').addEventListener('click', () => handlers.onRetry(false));
  $('overviewBtn').addEventListener('click', () => handlers.onOpenOverview());
  $('overviewClose').addEventListener('click', () => handlers.onCloseOverview());
  $('overview-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) handlers.onCloseOverview();
  });
  $('confirmYes').addEventListener('click', () => {
    const yes = handlers._confirmYes;
    hideConfirm();
    if (yes) yes();
  });
  $('confirmNo').addEventListener('click', () => {
    const no = handlers._confirmNo;
    hideConfirm();
    if (no) no();
  });
  $('confirm-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideConfirm();
  });
  $('continueBtn')?.addEventListener('click', () => handlers.onContinue?.());
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => handlers.onMode(btn.dataset.mode));
  });
  buildTribePicker(h.onTribe || (() => {}));
  buildSettings();
}

export function getSettings() {
  return {
    bots: settings.bots,
    stars: STARS_OPTIONS[settings.stars].stars,
    turnLimit: GAME_MODES[settings.gamemode].turnLimit,
    aiLevel: settings.ai,
    mapSize: MAP_SIZES[settings.mapsize] ? settings.mapsize : 'normal',
    mapType: MAP_TYPES[settings.maptype] ? settings.maptype : 'continents',
    humans: Math.max(2, Math.min(5, Number(settings.humans) || 2)),
    onlineBots: Math.max(0, Math.min(3, Number(settings.onlinebots) || 0))
  };
}

export function getTribe() {
  return selectedTribe;
}

// Einstellungen im Browser merken (nur bekannte Schlüssel und Werte).
function saveSettings() {
  try { localStorage.setItem('pb_settings_v1', JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

function loadSettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('pb_settings_v1') || 'null'); } catch (e) { saved = null; }
  if (!saved || typeof saved !== 'object') return;
  for (const k of Object.keys(settings)) {
    const v = saved[k];
    if (k === 'bots' ? Number.isInteger(v) && v >= 1 && v <= 5 : typeof v === 'string' && v.length < 20) settings[k] = v;
  }
  if (!STARS_OPTIONS[settings.stars]) settings.stars = 'normal';
  if (!GAME_MODES[settings.gamemode]) settings.gamemode = 'conquest';
}

function buildSettings() {
  const wrap = $('settings-box');
  if (!wrap) return;
  // Mitteilung bei Online-Zug: „An“ fragt den Browser um Erlaubnis.
  const notifyBtns = wrap.querySelectorAll('[data-notify]');
  const markNotify = () => { let on = false; try { on = localStorage.getItem('pb_notify') === '1'; } catch (e) { on = false; } notifyBtns.forEach(b => b.classList.toggle('active', (b.dataset.notify === '1') === on)); };
  notifyBtns.forEach(b => b.addEventListener('click', async () => {
    let on = b.dataset.notify === '1';
    if (on) {
      if (!('Notification' in window)) { toast('Dieser Browser zeigt keine Mitteilungen – du hörst aber einen Ton, und der Tab-Titel blinkt.', 'warn'); }
      else if (Notification.permission !== 'granted') {
        try { on = (await Notification.requestPermission()) === 'granted'; } catch (e) { on = false; }
        if (!on) toast('Mitteilungen wurden nicht erlaubt – Ton und blinkender Tab-Titel bleiben.', 'warn');
      }
    }
    try { localStorage.setItem('pb_notify', on ? '1' : '0'); } catch (e) { /* ignore */ }
    markNotify();
  }));
  markNotify();
  // Darstellung (gilt sofort, gemerkt im Browser).
  const themeBtns = wrap.querySelectorAll('[data-theme-pick]');
  let theme = 'system';
  try { theme = localStorage.getItem('pb_theme') || 'system'; } catch (e) { theme = 'system'; }
  const markTheme = () => themeBtns.forEach(b => b.classList.toggle('active', b.dataset.themePick === theme));
  themeBtns.forEach(b => b.addEventListener('click', () => {
    theme = b.dataset.themePick;
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try { if (theme === 'system') localStorage.removeItem('pb_theme'); else localStorage.setItem('pb_theme', theme); } catch (e) { /* ignore */ }
    markTheme();
  }));
  markTheme();
  loadSettings();
  wrap.addEventListener('click', e => { if (e.target.closest('button')) saveSettings(); });
  const bots = wrap.querySelectorAll('[data-bots]');
  bots.forEach(b => b.addEventListener('click', () => {
    settings.bots = Number(b.dataset.bots);
    bots.forEach(x => x.classList.toggle('active', x === b));
  }));
  const stars = wrap.querySelectorAll('[data-stars]');
  stars.forEach(b => b.addEventListener('click', () => {
    settings.stars = b.dataset.stars;
    stars.forEach(x => x.classList.toggle('active', x === b));
  }));
  bots.forEach(x => x.classList.toggle('active', Number(x.dataset.bots) === settings.bots));
  stars.forEach(x => x.classList.toggle('active', x.dataset.stars === settings.stars));
  const seg = (attr, key) => {
    const btns = wrap.querySelectorAll(`[data-${attr}]`);
    btns.forEach(b => b.addEventListener('click', () => {
      settings[key] = b.dataset[attr];
      btns.forEach(x => x.classList.toggle('active', x === b));
    }));
    btns.forEach(x => x.classList.toggle('active', x.dataset[attr] === settings[key]));
  };
  seg('gamemode', 'gamemode');
  seg('ai', 'ai');
  seg('mapsize', 'mapsize');
  seg('maptype', 'maptype');
  seg('onlinebots', 'onlinebots');
  seg('humans', 'humans');
}

function hex(c) {
  return '#' + c.toString(16).padStart(6, '0');
}

function buildTribePicker() {
  const wrap = $('tribe-pick');
  if (!wrap) return;
  try { const t = localStorage.getItem('pb_tribe'); if (TRIBE_POOL.includes(t)) selectedTribe = t; } catch (e) { /* ignore */ }
  wrap.innerHTML = '';
  for (const id of TRIBE_POOL) {
    const t = TRIBES[id];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tribe-opt';
    btn.dataset.tribe = id;
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = `<span class="tribe-name"><span class="dot" style="background:${hex(t.color)}"></span>${t.name}</span>
      ${t.perk ? `<span class="tribe-tech">${t.perk.name}</span>` : ''}`;
    btn.addEventListener('click', () => {
      selectedTribe = selectedTribe === id ? null : id;
      try { if (selectedTribe) localStorage.setItem('pb_tribe', selectedTribe); else localStorage.removeItem('pb_tribe'); } catch (e) { /* ignore */ }
      markTribe();
    });
    wrap.appendChild(btn);
  }
  markTribe();
}

// Gewählten Stamm markieren und darunter ausführlich beschreiben.
function markTribe() {
  const wrap = $('tribe-pick');
  wrap.querySelectorAll('.tribe-opt').forEach(b => {
    const on = b.dataset.tribe === selectedTribe;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const info = $('tribe-info');
  if (!info) return;
  if (!selectedTribe) { info.innerHTML = 'Kein Stamm gewählt: Du bekommst einen zufälligen. Tippe einen Stamm an, um ihn zu wählen, und nochmal, um die Wahl aufzuheben.'; return; }
  const t = TRIBES[selectedTribe];
  const startTech = t.startTechs.length ? t.startTechs.map(x => TECHS[x].name).join(', ') : `keine Technologie (+${t.bonusStars} Sterne)`;
  const startUnits = t.startUnits.map(u => UNITS[u].name).join(', ');
  info.innerHTML = `<b>${t.name}</b> · Start: ${startTech} · ${startUnits}${t.perk ? `<br><span class="tribe-perk">${t.perk.name}: ${t.perk.desc}</span>` : ''}`;
}

export function setStatus(text) {
  $('status').textContent = text;
}

export function toast(text, cls = '') {
  const area = $('toast-area');
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.textContent = text;
  area.appendChild(el);
  while (area.children.length > 4) area.firstChild.remove();
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, 2300);
  setTimeout(() => el.remove(), 2700);
}

function chip(player, state, ctx) {
  const s = state.stars[player];
  const cities = state.cities.filter(c => c.owner === player).length;
  const units = state.units.filter(u => u.owner === player).length;
  const active = state.turn === player && !state.winner;
  const me = ctx.mode !== 'online' || ctx.myRole === player;
  const name = tribeName(state, player) || NAMES[player];
  if (cities === 0) {
    const e = state.eliminated && state.eliminated[player];
    const by = e && e.by ? ` von ${tribeName(state, e.by) || NAMES[e.by]}` : '';
    return `<div class="chip dead" title="Besiegt${by}${e ? ` in Runde ${e.round}` : ''}">
      <span class="dot" style="background:${hex(playerColor(state, player))}"></span>
      <span class="dead-name">${name}${ctx.mode === 'online' && me ? ' (du)' : ''}</span>
      <span class="dead-tag">besiegt${e ? ` · Runde ${e.round}` : ''}</span>
    </div>`;
  }
  const meta = `${cities} ${cities === 1 ? 'Stadt' : 'Städte'}, ${units} ${units === 1 ? 'Einheit' : 'Einheiten'}${state.turnLimit ? `, ${score(state, player)} Punkte` : ''}`;
  return `<div class="chip ${active ? 'active' : ''}" title="${esc(name)}: ${s} Sterne, ${meta}">
    <span class="dot" style="background:${hex(playerColor(state, player))}"></span>
    <span>${name}${ctx.mode === 'online' && me ? ' (du)' : ''}</span>
    <span class="stars">${s}</span>
    ${state.turnLimit ? `<span class="pts">${score(state, player)} P</span>` : ''}
  </div>`;
}

export function updateStrip(state, ctx) {
  const players = state.players && state.players.length ? state.players : ['player_1', 'player_2'];
  // Besiegte Stämme ans Ende.
  const order = [...players.filter(p => state.cities.some(c => c.owner === p)), ...players.filter(p => !state.cities.some(c => c.owner === p))];
  $('player-strip').innerHTML = order.map(p => chip(p, state, ctx)).join('');
  // Groß links: Sterne des Spielers, der hier handelt, und was nächste Runde dazukommt.
  const me = ctx.actAs && state.players.includes(ctx.actAs) ? ctx.actAs : ctx.viewer;
  const tr = $('treasury');
  if (me && state.stars[me] != null) {
    const inc = incomeFor(state, me);
    tr.innerHTML = `<span class="tr-hex" aria-hidden="true"></span><span class="tr-num">${state.stars[me]}</span><span class="tr-txt"><span class="tr-lbl">${state.stars[me] === 1 ? 'Stern' : 'Sterne'}</span><span class="tr-inc">+${inc} nächste Runde</span></span>`;
    tr.title = `${state.stars[me]} Sterne, nächste Runde kommen ${inc} dazu`;
  } else tr.innerHTML = '';
  $('round-label').textContent = 'Runde ' + state.round + (state.turnLimit ? ' / ' + state.turnLimit : '');
  // Testpartie (Admin-Panel) für alle sichtbar markieren, auch online.
  let flag = $('test-flag');
  if (!flag) { flag = document.createElement('span'); flag.id = 'test-flag'; flag.className = 'test-flag'; flag.textContent = 'Testpartie'; flag.title = 'In dieser Partie wurde das Admin-Panel benutzt: zählt nicht für die Bestenliste, der Server prüft die Züge nicht.'; $('round-label').after(flag); }
  flag.classList.toggle('hidden', !state.admin);
}

// Lautsprecher als kleine Vektorgrafik (keine Emojis); durchgestrichen = stumm.
// Kleine Symbole als SVG (keine Schriftzeichen/Emojis).
const STAR_ICON = '<svg class="ico" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" fill="currentColor"/></svg>';
const CHECK_ICON = '<svg class="ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SPEAKER = '<path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor"/>';
const WAVES = '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
const CROSS = '<path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
export function setSoundIcon(muted) {
  const btn = $('soundBtn');
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${SPEAKER}${muted ? CROSS : WAVES}</svg>`;
  btn.title = muted ? 'Ton ist aus – einschalten' : 'Ton ist an – ausschalten';
  btn.setAttribute('aria-label', btn.title);
}

// Tutorial-Karte: Text, Fortschritt, Weiter (nur beim letzten/Info-Schritt) und Überspringen.
export function showTutor({ text, step, total, next }) {
  const box = $('tutor');
  box.innerHTML = `<div class="tu-head"><span>Tutorial · Schritt ${step + 1} von ${total}</span></div>
    <div class="tu-bar"><div style="width:${Math.round((step + 1) / total * 100)}%"></div></div>
    <p class="tu-text">${esc(text)}</p>
    <div class="tu-btns">
      <button class="btn small" data-tu-skip>${next === 'Fertig' ? 'Schließen' : 'Tutorial beenden'}</button>
      ${next ? `<button class="btn small primary" data-tu-next>${esc(next)}</button>` : ''}
    </div>`;
  box.querySelector('[data-tu-skip]').addEventListener('click', () => handlers.onTutor('skip'));
  const n = box.querySelector('[data-tu-next]');
  if (n) n.addEventListener('click', () => handlers.onTutor('next'));
  box.classList.remove('hidden');
}

export function hideTutor() {
  $('tutor').classList.add('hidden');
}

// --- Profil ---------------------------------------------------------------------

const fmtDate = key => { const [, m, d] = key.split('-'); return `${d}.${m}.`; };

export function renderProfile(profile, lp, daily, achievements, weekly = null) {
  if (weekly) {
    const wb = profile.weekly && profile.weekly.best[weekly.key];
    const wt = TRIBES[weekly.tribe] ? TRIBES[weekly.tribe].name : weekly.tribe;
    $('weeklyBtn').innerHTML = `Woche ${esc(weekly.key.split('-W')[1])}: ${esc(weekly.name)}<span class="sub">${esc(weekly.desc)} ${esc(wt)}, ${weekly.turnLimit} Runden${wb != null ? `, Bestwert ${wb}` : ''}</span>`;
    $('weeklyBtn').title = 'Wochen-Herausforderung: jede Woche eine feste Karte mit Sonderregel';
  }
  const winRate = profile.games ? Math.round(100 * profile.wins / profile.games) : 0;
  $('profile-card').innerHTML = `<div class="pc-level">${lp.level}</div>
    <div><span class="pc-title">${profile.name ? esc(profile.name) : esc(lp.title)}</span> <span class="pc-sub">${profile.name ? esc(lp.title) + ', ' : ''}Stufe ${lp.level}, ${lp.into} von ${lp.need} Erfahrung</span></div>
    <div class="pc-sub">${profile.games} ${profile.games === 1 ? 'Spiel' : 'Spiele'} · ${profile.wins} ${profile.wins === 1 ? 'Sieg' : 'Siege'}${profile.games ? ` (${winRate} %)` : ''}${profile.winStreak > 1 ? ` · ${profile.winStreak} Siege in Folge` : ''}${profile.daily.streak ? ` · Tagesserie ${profile.daily.streak}` : ''}</div>
    <div class="xp-bar"><div style="width:${Math.round(lp.frac * 100)}%"></div></div>
    <div class="profile-name">
      <button class="btn ghost" data-pname title="${profile.name ? 'Namen ändern' : 'Mit Namen erscheinst du in der Bestenliste'}">${profile.name ? 'Namen ändern' : 'Namen wählen'}</button>
      <button class="btn ghost" data-pcode>Profil-Code</button></div>`;
  $('profile-card').querySelector('[data-pname]').addEventListener('click', () => handlers.onChooseName());
  $('profile-card').querySelector('[data-pcode]').addEventListener('click', () => handlers.onProfileCode());
  const best = profile.daily.best[daily.key];
  const tribe = TRIBES[daily.tribe] ? TRIBES[daily.tribe].name : daily.tribe;
  $('dailyBtn').innerHTML = `Heute, ${fmtDate(daily.key)}<span class="sub">Tagesherausforderung: ${esc(tribe)}, ${esc(MAP_TYPES[daily.mapType].label)}, 30 Runden${best != null ? `, Bestwert ${best}` : ''}</span>`;
  renderStats(profile);
  const ids = Object.keys(achievements);
  const got = ids.filter(id => profile.achievements[id]);
  $('achievements-title').textContent = `Erfolge (${got.length}/${ids.length})`;
  $('achievements').innerHTML = ids.map(id => `<div class="ach ${profile.achievements[id] ? 'got' : ''}"><b>${esc(achievements[id].name)}</b>${esc(achievements[id].desc)}</div>`).join('');
}

const MODE_NAMES = { bot: 'Gegen KI', online: 'Online', daily: 'Tag', weekly: 'Woche', campaign: 'Kampagne' };
function renderStats(profile) {
  const t = profile.totals || {};
  const tribeName = id => (TRIBES[id] ? TRIBES[id].name : '–');
  const top = o => { const e = Object.entries(o || {}).sort((a, b) => b[1] - a[1])[0]; return e ? `${tribeName(e[0])} (${e[1]})` : '–'; };
  const cell = (label, v) => `<div class="stat">${esc(label)}<b>${esc(String(v))}</b></div>`;
  // Tagesherausforderung: Bestwerte der letzten 14 Tage als Balken.
  const days = Object.entries((profile.daily && profile.daily.best) || {}).sort().slice(-14);
  const max = Math.max(1, ...days.map(d => d[1]));
  const bars = days.length ? `<div class="stat-bars">${days.map(([k, v]) => `<div title="${esc(k)}: ${v} Punkte"><span style="height:${Math.round(v / max * 100)}%"></span><em>${esc(k.slice(8))}</em></div>`).join('')}</div>` : '<div class="hint">Noch keine Tagesherausforderung gespielt.</div>';
  const recent = (profile.recent || []).slice().reverse().map(r => `<li class="${r.won ? 'won' : ''}"><div><b>${r.won ? 'Sieg' : 'Niederlage'}</b> · ${esc(MODE_NAMES[r.mode] || r.mode || '')} · ${esc(tribeName(r.tribe))} · Runde ${r.round} · ${r.score} Punkte</div><span>${esc((r.date || '').split('-').reverse().join('.'))}</span></li>`).join('');
  $('stats').innerHTML = `<div class="stat-row">
      ${cell('Spiele', profile.games)}${cell('Siege', profile.wins)}${cell('Siegquote', profile.games ? Math.round(100 * profile.wins / profile.games) + ' %' : '–')}
      ${cell('Beste Serie', profile.bestWinStreak)}${cell('Bestwert', profile.bestScore)}${cell('Schnellster Sieg', profile.fastestWin ? 'Runde ' + profile.fastestWin : '–')}
      ${cell('Besiegte Einheiten', t.kills || 0)}${cell('Eroberte Städte', t.captures || 0)}${cell('Ausgebildet', t.trained || 0)}
      ${cell('Gespielte Runden', t.rounds || 0)}${cell('Lieblingsstamm', top(profile.tribeGames))}${cell('Meiste Siege', top(profile.tribeWins))}
    </div>
    <div class="panel-sub" style="margin-top:10px">Tagesherausforderung (Bestwerte)</div>${bars}
    <div class="panel-sub" style="margin-top:10px">Letzte Partien</div>
    ${recent ? `<ul class="recent">${recent}</ul>` : '<div class="hint">Noch keine Partie beendet.</div>'}`;
}

// Namensdialog; `onSave(name)` liefert eine Fehlermeldung oder null.
const NAME_TEXT = 'Mit diesem Namen erscheinst du in der Bestenliste. 3–16 Zeichen, Buchstaben, Ziffern, Leerzeichen, _ und -.';
export function askName(current, onSave, { title = 'Wähle deinen Namen', text = NAME_TEXT, max = 16, ok = 'Speichern' } = {}) {
  $('name-title').textContent = title;
  $('name-text').textContent = text;
  $('nameOk').textContent = ok;
  const input = $('name-input');
  input.maxLength = max;
  input.value = current || '';
  $('name-error').textContent = '';
  $('name-overlay').classList.remove('hidden');
  input.focus();
  const close = () => { $('name-overlay').classList.add('hidden'); $('nameOk').onclick = null; input.onkeydown = null; };
  const save = async () => {
    $('nameOk').disabled = true;
    const err = await onSave(input.value);
    $('nameOk').disabled = false;
    if (err) $('name-error').textContent = err;
    else close();
  };
  $('nameOk').onclick = save;
  input.onkeydown = e => { if (e.key === 'Enter') save(); };
  $('nameCancel').onclick = close;
}

// Bestenliste anzeigen (oder Hinweis bei Fehler/ohne Einträge).
export function renderBoard(res, kind, myName) {
  const box = $('board');
  document.querySelectorAll('[data-board]').forEach(b => b.classList.toggle('active', b.dataset.board === kind));
  if (!res) { box.innerHTML = '<div class="hint">Lädt …</div>'; return; }
  if (res.error) { box.innerHTML = `<div class="hint">${esc(res.error)}</div>`; return; }
  const d = res.data || {};
  const top = d.top || [];
  const tribe = id => (TRIBES[id] ? TRIBES[id].name : '');
  const rows = top.map(r => `<li class="${myName && r.name === myName ? 'me' : ''}"><span>${r.rank}.</span><span>${esc(r.name)} <span class="b-sub">Stufe ${r.level} · ${esc(tribe(r.tribe))} · Runde ${r.round}</span></span><b>${r.score}</b></li>`).join('');
  const me = d.me && !top.some(r => r.name === d.me.name) ? `<li class="me"><span>${d.me.rank}.</span><span>${esc(d.me.name)}</span><b>${d.me.score}</b></li>` : '';
  box.innerHTML = top.length ? `<ol class="board-list">${rows}${me}</ol><div class="hint">${d.total} ${d.total === 1 ? 'Spieler' : 'Spieler'} ${kind === 'daily' ? 'heute' : 'diese Woche'}</div>`
    : `<div class="hint">Noch keine Einträge ${kind === 'daily' ? 'heute' : 'diese Woche'} – spiel die ${kind === 'daily' ? 'Tages' : 'Wochen'}-Herausforderung und sei die Nummer 1!</div>`;
  if (!myName) box.innerHTML += '<div class="hint">Wähle oben im Profil einen Namen, damit deine Punkte hier erscheinen.</div>';
}

// Kampagne im Menü: Missionen mit Sternen, gesperrte mit Hinweis.
export function renderCampaign(profile, missions, unlocked, total) {
  $('campaign-title').textContent = `Kampagne (${total}/${missions.length * 3} Sterne)`;
  $('campaign').innerHTML = `<div class="mission-list">${missions.map((m, i) => {
    const stars = (profile.campaign && profile.campaign[m.id]) || 0;
    const ok = unlocked(profile, i);
    return `<button class="btn action" data-mission="${m.id}" ${ok ? '' : 'disabled'}>
      <span>${i + 1}. ${esc(m.title)}<span class="sub">${ok ? esc(m.goal) + ' – ' + esc(m.story) : 'Gesperrt: erst Mission ' + i + ' schaffen'}</span></span>
      <span class="m-stars">${stars ? stars + ' von 3 Sternen' : ''}</span></button>`;
  }).join('')}</div>`;
  $('campaign').querySelectorAll('[data-mission]').forEach(b => b.addEventListener('click', () => handlers.onMode('mission:' + b.dataset.mission)));
}

export function showMission(text, frac) {
  const bar = $('mission-bar');
  if (!text) { bar.classList.add('hidden'); return; }
  bar.innerHTML = `${text}<div class="mb-bar"><div style="width:${Math.round(Math.min(1, frac) * 100)}%"></div></div>`;
  bar.classList.remove('hidden');
}

// Kosmetik-Auswahl: freigeschaltete Teile wählbar, gesperrte mit Hinweis.
export function renderLooks(profile, cosmetics, unlocked, hint, current) {
  $('looks').innerHTML = Object.entries(cosmetics).map(([cat, c]) => `<div class="setting-row">
      <span class="setting-label">${esc(c.label)}</span>
      <div class="seg">${Object.entries(c.items).map(([id, it]) => {
        const ok = unlocked(profile, cat, id);
        return `<button class="chip-btn ${current[cat] === id ? 'active' : ''}" data-look="${cat}:${id}" ${ok ? '' : 'disabled'} title="${esc(ok ? it.name : 'Gesperrt: ' + hint(cat, id))}">${esc(it.name)}${ok ? '' : ' · ' + esc(hint(cat, id))}</button>`;
      }).join('')}</div></div>`).join('') + '<div class="hint">Gilt für deine Städte und Einheiten. Mehr schaltest du mit Stufen und Erfolgen frei.</div>';
  $('looks').querySelectorAll('[data-look]').forEach(b => b.addEventListener('click', () => {
    const [cat, id] = b.dataset.look.split(':');
    handlers.onLook(cat, id);
  }));
}

// Ergebnis für das Profil auf dem Endbildschirm.
export function showProfileResult(res, lp, achievements) {
  const box = $('winner-profile');
  if (!res) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="wp-xp"><span>+${res.gain} Erfahrung</span>
      <span class="${res.levelAfter > res.levelBefore ? 'wp-up' : ''}">${res.levelAfter > res.levelBefore ? `Aufgestiegen: Stufe ${lp.level} – ${esc(lp.title)}!` : `Stufe ${lp.level} · ${lp.into}/${lp.need}`}</span></div>
    <div class="xp-bar"><div style="width:${Math.round(lp.frac * 100)}%"></div></div>
    ${res.achievements.length ? `<div class="wp-ach">${res.achievements.map(id => `<span>Erfolg: ${esc(achievements[id].name)}</span>`).join('')}</div>` : ''}
    ${res.mission ? `<div class="wp-daily">Mission: ${res.mission.stars} von 3 Sternen${res.mission.improved ? ' – neuer Bestwert!' : ''}</div>` : ''}
    ${res.weekly ? `<div class="wp-daily">Wochen-Herausforderung: ${res.weekly.score} Punkte${res.weekly.improved ? ' – neuer Wochenbestwert!' : ` (Bestwert ${res.weekly.best})`}</div>` : ''}
    ${res.daily ? `<div class="wp-daily">Tagesherausforderung ${fmtDate(res.daily.key)}: ${res.daily.score} Punkte${res.daily.improved ? ' – neuer Bestwert!' : ` (Bestwert ${res.daily.best})`} · Tagesserie ${res.daily.streak}</div>` : ''}`;
}

// Rückblick: Liste {text, q?, r?}; antippen springt zum Ort.
export function showNews(report) {
  const box = $('news');
  const flat = [];
  const html = report.sections.map(sec => `<div class="news-sec"><h4>${esc(sec.title)}</h4><ul>${sec.lines.map(l => {
    const i = flat.push(l) - 1;
    return `<li class="tone-${l.tone || 'info'}"><button data-news="${i}" ${l.q == null ? 'tabindex="-1"' : ''}>${esc(l.text)}${l.q != null ? ' <span class="news-go">zeigen</span>' : ''}</button></li>`;
  }).join('')}</ul></div>`).join('');
  box.innerHTML = `<div class="news-top"><h3>Rundenbericht</h3><button class="btn ghost small" data-news-close>Schließen</button></div><div class="news-head">${esc(report.head)}</div>${html}`;
  box.querySelectorAll('[data-news]').forEach(b => b.addEventListener('click', () => {
    const l = flat[Number(b.dataset.news)];
    if (l.q != null) handlers.onJump(l.q, l.r);
  }));
  box.querySelector('[data-news-close]').addEventListener('click', hideNews);
  box.classList.remove('hidden');
}

export function hideNews() {
  $('news').classList.add('hidden');
}

export function setEndTurn(enabled) {
  $('endTurnBtn').disabled = !enabled;
}

// Zeigt an, wie viele eigene Einheiten in diesem Zug noch etwas tun können.
export function setIdle(count) {
  const btn = $('idleBtn');
  btn.classList.toggle('hidden', !count);
  btn.innerHTML = `<span class="idle-dot"></span>${count}<span class="lbl"> bereit</span>`;
}

// „2 Krieger, 1 Reiter“
export function describeUnits(units) {
  const counts = new Map();
  for (const u of units) counts.set(u.type, (counts.get(u.type) || 0) + 1);
  return [...counts].map(([t, n]) => `${n} ${UNITS[t].name}`).join(', ');
}

export function hidePanel() {
  $('panel').classList.add('hidden');
  if (anchor.kind === 'city') clearAnchor();
}

// --- Schild am Objekt (wie bei Mini Metro): folgt der Kamera ------------------------
const anchor = { kind: null, q: 0, r: 0, raf: 0 };
function setAnchor(kind, q, r, html) {
  let el = $('anchor-tag');
  if (!el) {
    el = document.createElement('div');
    el.id = 'anchor-tag';
    el.setAttribute('role', 'status');
    $('stage').appendChild(el);
  }
  el.innerHTML = html;
  el.classList.remove('hidden');
  Object.assign(anchor, { kind, q, r });
  if (!anchor.raf) {
    const step = () => {
      anchor.raf = 0;
      if (!anchor.kind) return;
      const p = project(anchor.q, anchor.r);
      const tag = $('anchor-tag');
      if (p && tag) {
        tag.style.left = p.x + 'px';
        tag.style.top = p.y + 'px';
        tag.style.visibility = p.x < 0 || p.y < 0 || p.x > innerWidth || p.y > innerHeight ? 'hidden' : '';
      }
      anchor.raf = requestAnimationFrame(step);
    };
    step();
  }
}
function clearAnchor() {
  anchor.kind = null;
  if (anchor.raf) cancelAnimationFrame(anchor.raf);
  anchor.raf = 0;
  const el = $('anchor-tag');
  if (el) el.classList.add('hidden');
}
const hpBar = (v, max, cls = '') => `<span class="at-bar ${cls}"><span style="width:${Math.max(0, Math.min(100, v / max * 100))}%"></span></span>`;

function panel(html, mode = '') {
  const p = $('panel');
  p.innerHTML = html;
  p.className = mode;
  p.classList.remove('hidden');
  p.querySelectorAll('.tb-row').forEach(wheelSideways);
}

// Mausrad scrollt eine Werkzeugreihe seitwärts (am PC ohne Querscrollen).
function wheelSideways(row) {
  row.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth) return;
    e.preventDefault();
    row.scrollLeft += e.deltaY;
  }, { passive: false });
}

// Kleine Symbole für Werte (SVG, keine Schriftzeichen). Bedeutung im title.
const ICON = {
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/>',
  sword: '<path d="M19.5 3.5l-.6 3.4-8 8-2.8-2.8 8-8zM6 11.6l1.4-1.4 6.4 6.4-1.4 1.4zM8.6 15.4l1.4 1.4-3.6 3.6a1 1 0 0 1-1.4-1.4z"/>',
  shield: '<path d="M12 3.5l7 2.6v5.2c0 4.6-3 7.8-7 9.2-4-1.4-7-4.6-7-9.2V6.1z"/>',
  boot: '<path d="M7 3.5h6v8l5.2 2.4A3 3 0 0 1 20 16.6V18H6.2L7 13.5zM5.8 19.2H20v1.6H5.8z"/>',
  bow: '<path d="M6.5 4.5c7 1 11.4 6.6 10.6 14.4l-1.6-.2c.7-6.9-3.2-11.7-9.2-12.6zM6.3 5.1l1.1-1.1 11.8 11.8-1.1 1.1zM19.4 18.3l-1.2-3.6-1.6 1.6z"/>'
};
const LABEL = { heart: 'Leben', sword: 'Angriff', shield: 'Verteidigung', boot: 'Bewegung', bow: 'Reichweite' };
function stat(kind, value) {
  return `<span class="vstat" title="${LABEL[kind]}" aria-label="${LABEL[kind]} ${value}"><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="currentColor">${ICON[kind]}</svg>${value}</span>`;
}

function abilityChips(type) {
  const list = UNITS[type].abilities || [];
  return list
    .filter(a => a !== 'land')
    .map(a => ABILITY_INFO[a]
      ? `<span class="ability" role="button" tabindex="0" data-desc="${ABILITY_INFO[a].desc}">${ABILITY_INFO[a].name}</span>`
      : '')
    .join('');
}

function wirePanel(p) {
  p.querySelectorAll('.ability').forEach(el => {
    const show = () => toast(el.dataset.desc || '');
    el.addEventListener('click', show);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
  });
  p.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => handlers.onClosePanel());
  });
}

// Kleine Leiste für die gewählte Einheit (statt des großen Info-Menüs).
export function showUnitChip(state, unit, ctx) {
  const bar = $('unit-chip');
  const def = UNITS[unit.carry || unit.type];
  const mine = unit.owner === ctx.actAs;
  const live = mine && ctx.myTurn;
  const opts = live ? unitOptions(state, unit) : [];
  const cap = hpCap(unit);
  if (ctx.duel) {
    const d = ctx.duel, foe = d.foe, fcap = hpCap(foe);
    const fAfter = foe.hp - d.damage, aAfter = Math.max(0, unit.hp - d.back);
    const row = (name, owner, hp, max, after, note) => `
      <div class="du-row"><span class="dot" style="background:${hex(playerColor(state, owner))}"></span><b>${name}</b><span class="du-note">${note}</span></div>
      <span class="du-bar" aria-hidden="true"><span class="du-now" style="width:${hp / max * 100}%"></span><span class="du-after${after <= 0 ? ' dead' : ''}" style="width:${Math.max(0, after) / max * 100}%"></span></span>
      <div class="du-hp">${hp} auf <b>${Math.max(0, after)}</b> von ${max} Leben</div>`;
    setAnchor('unit', d.q, d.r, `
      <div class="du-title">Angriff</div>
      ${row(UNITS[foe.type].name, foe.owner, foe.hp, fcap, fAfter, fAfter <= 0 ? 'wird besiegt' : `−${d.damage}`)}
      ${row(def.name, unit.owner, unit.hp, cap, aAfter, d.back ? `Gegenschlag −${d.back}` : 'kein Gegenschlag')}
      <div class="du-go">Nochmal tippen zum Angreifen</div>`);
  } else setAnchor('unit', unit.q, unit.r, `
    <div class="at-head"><span class="dot" style="background:${hex(playerColor(state, unit.owner))}"></span><b>${def.name}${unit.carry ? ' (Boot)' : ''}</b>${unit.vet ? '<span class="at-vet">Veteran</span>' : ''}</div>
    ${hpBar(unit.hp, cap, unit.hp / cap <= 0.35 ? 'low' : '')}
    <div class="at-stats">${stat('heart', `${unit.hp}/${cap}`)}${stat('sword', attackOf(state, unit))}${stat('shield', defenseOf(state, unit))}${stat('boot', `${fmtMp(unit.mp)}/${maxMove(state, unit.owner, unit.type)}`)}${def.range > 1 ? stat('bow', def.range) : ''}</div>`);
  const status = ctx.hint ? `<b class="uc-hint">${esc(ctx.hint)}</b>`
    : !mine ? esc(tribeName(state, unit.owner) || NAMES[unit.owner])
    : !ctx.myTurn ? 'Nicht am Zug'
    : opts.length ? 'Kann noch ' + esc(opts.join(', ')) : 'Hat in diesem Zug gehandelt';
  const acts = live ? quickActions(state, unit, ctx) : [];
  if (live && ctx.expanded) acts.push({ label: 'Auflösen', cost: '+' + disbandRefund(unit), danger: true, run: () => handlers.onDisband(unit) });
  let more = '';
  if (ctx.expanded) {
    const tile = TERRAIN[terrainAt(state, unit.q, unit.r)];
    const info = [`Gelände: ${tile.name}, Verteidigung ${defenceBonus(state, unit)}-fach`];
    if (!unit.vet && !UNITS[unit.type].reward) info.push(`Siege ${unit.kills || 0} von 3 bis zum Veteranen (+5 Leben)`);
    if (unit.hp < cap) info.push(canRegenerate(state, unit) ? 'Heilt zu Beginn des nächsten Zuges' : 'Heilt nicht: hat angegriffen oder ein Gegner ist in Reichweite');
    if (unit.cargo) info.push(`Fracht: ${UNITS[unit.cargo.type].name}`);
    if (unit.carry) info.push('Fährt als Boot; an Land gehen beendet die Bewegung.');
    more = `<div class="tb-more"><div class="ability-row">${abilityChips(unit.type)}</div><div class="tb-info">${info.map(esc).join('<br>')}</div></div>`;
  }
  bar.innerHTML = `
    ${more}
    <div class="tb-cap">${status}</div>
    <div class="tb-row">
      ${acts.map((a, i) => `<button class="btn tool-tile${a.reason ? ' off' : ''}${a.danger ? ' danger' : ''}" data-act="${i}" ${a.reason ? 'aria-disabled="true"' : ''} title="${esc(a.reason || a.label)}"><b>${esc(a.label)}</b><span class="tt-foot">${a.cost != null ? `<span class="tt-cost">${a.cost}</span>` : ''}${a.reason ? `<span class="tt-why">${esc(a.reason)}</span>` : ''}</span></button>`).join('')}
      <button class="btn tool-tile ghost" data-details aria-expanded="${!!ctx.expanded}"><b>${ctx.expanded ? 'Weniger' : 'Details'}</b><span class="tt-foot"><span class="tt-why">${ctx.expanded ? 'Details zuklappen (Taste I)' : 'Fähigkeiten, Gelände, Auflösen (Taste I)'}</span></span></button>
    </div>`;
  bar.querySelectorAll('.tb-row').forEach(wheelSideways);
  wirePanel(bar);
  bar.querySelector('[data-details]').addEventListener('click', () => handlers.onUnitDetails());
  bar.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
    const a = acts[Number(b.dataset.act)];
    if (a.reason) toast(`${a.label}: ${a.reason}`, 'warn'); else a.run();
  }));
  bar.classList.remove('hidden');
}

// Häufige Aktionen der Einheit (dieselben Regeln wie im Detail-Menü).
function quickActions(state, unit, ctx) {
  const out = [];
  if (unit.type === 'settler') { const f = canFound(state, unit, ctx.actAs); out.push({ label: 'Stadt gründen', reason: f.ok ? '' : f.reason, run: () => handlers.onFound(unit) }); }
  if (UNITS[unit.type].abilities.includes('trade')) {
    const t = tradeOption(state, unit);
    out.push({ label: t ? `Handeln: +${t.stars}` : 'Handeln', reason: t ? '' : 'In oder neben eine andere eigene Stadt ziehen (fremde nur im Frieden)', run: () => handlers.onTrade(unit) });
  }
  const city = cityAt(state, unit.q, unit.r);
  if (city && city.owner === ctx.actAs) out.push({ label: 'Stadtmenü', run: () => handlers.onSelectCity(unit.q, unit.r) });
  const up = upgradeOption(state, unit);
  if (up) out.push({ label: `Aufrüsten: ${UNITS[up.to].name}`, cost: up.cost, reason: up.ok ? '' : up.reason, run: () => handlers.onUpgrade(unit) });
  for (const o of bridgeOptions(state, unit)) { const chk = canBuildBridge(state, unit, o.dir, ctx.actAs); out.push({ label: `Brücke nach ${DIR_NAMES[o.dir]}`, cost: o.cost, reason: chk.ok ? '' : chk.reason, run: () => handlers.onBuildBridge(unit, o.dir) }); }
  if (!unit.carry && !UNITS[unit.type].abilities.includes('water') && state.techs[ctx.actAs].includes(ROAD.tech) && !roadAt(state, unit.q, unit.r)) {
    const chk = canBuildRoad(state, ctx.actAs, unit.q, unit.r, true);
    const spent = unit.mp <= 0 && unit.hasMoved;
    if (chk.reason !== 'Städte sind schon angebunden') out.push({ label: 'Weg bauen', cost: ROAD.cost, reason: spent ? 'Keine Bewegung mehr' : chk.ok ? '' : chk.reason, run: () => handlers.onBuildRoad(unit.q, unit.r, unit) });
  }
  const dirTo = (q, r) => DIRS.findIndex(([dq, dr]) => unit.q + dq === q && unit.r + dr === r);
  for (const [q, r] of unit.cargo ? unloadOptions(state, unit) : []) out.push({ label: `Absetzen nach ${DIR_NAMES[dirTo(q, r)]}`, run: () => handlers.onUnloadCargo(unit, q, r) });
  for (const u of loadOptions(state, unit)) out.push({ label: `${UNITS[u.type].name} aufnehmen`, run: () => handlers.onLoadCargo(unit, u.id) });
  for (const [q, r] of destroyableBridges(state, unit)) out.push({ label: 'Brücke einreißen', run: () => handlers.onDestroyBridge(unit, q, r) });
  return out;
}

export function hideUnitChip() {
  $('unit-chip').classList.add('hidden');
  if (anchor.kind === 'unit') clearAnchor();
}

export function showUnitPanel(state, unit, ctx) {
  const def = UNITS[unit.type];
  const cap = hpCap(unit);
  const owner = tribeName(state, unit.owner) || NAMES[unit.owner];
  const land = unit.carry ? UNITS[unit.carry] : null;
  const mine = unit.owner === ctx.actAs;
  const hpPct = Math.max(0, (unit.hp / cap) * 100);
  const tile = TERRAIN[terrainAt(state, unit.q, unit.r)];
  const tb = defenceBonus(state, unit);
  let hint = '';
  if (state.winner) hint = 'Spiel vorbei.';
  else if (!mine || !ctx.myTurn) hint = 'Nicht am Zug – nur beobachten.';
  else if (unit.acted && unit.mp <= 0) hint = 'Einheit hat gehandelt. Zug beenden, um sie nächste Runde zu aktivieren.';
  else {
    hint = unit.mp > 0 ? 'Helle Felder = Bewegung' : 'Bewegung aufgebraucht';
    if (attackPreview(state, unit).length) hint += ' · Rote Felder = Angriffsziel';
  }

  let forecast = '';
  if (mine && ctx.myTurn && canAttackNow(state, unit)) {
    const preview = attackPreview(state, unit);
    if (preview.length) {
      forecast = `<div class="panel-head" style="margin-top:12px"><div class="panel-sub">Kampfprognose</div></div>
        <div class="forecast-list">${preview.map(p => {
          const t = UNITS[p.target.type];
          const lethal = p.damage >= p.target.hp;
          const back = p.retaliation > 0 ? `· Vergeltung −${p.retaliation}` : '· keine Vergeltung';
          return `<div class="forecast"><span>${t.name} <span class="fc-hp">${p.target.hp} LP</span></span><b class="${lethal ? 'lethal' : ''}">${lethal ? 'Besiegt' : '−' + p.damage} ${back}</b></div>`;
        }).join('')}</div>`;
    }
  }

  let todo = '';
  if (mine && ctx.myTurn) {
    const opts = unitOptions(state, unit);
    if (opts.length) todo = `<div class="hint todo">Kann noch: ${opts.join(', ')}</div>`;
  }
  if (unit.hp < cap) {
    todo += `<div class="hint">${canRegenerate(state, unit) ? 'Heilt zu Beginn des nächsten Zuges' : 'Heilt nicht: hat angegriffen oder steht in Reichweite eines Gegners'}</div>`;
  }

  let extra = '';
  if (mine && ctx.myTurn) {
    const bridges = bridgeOptions(state, unit);
    if (bridges.length) {
      extra += `<div class="panel-head" style="margin-top:12px"><div class="panel-sub">Brücke bauen</div></div><div class="action-list">`;
      for (const o of bridges) {
        const chk = canBuildBridge(state, unit, o.dir, ctx.actAs);
        extra += `<button class="btn action" data-bridge="${o.dir}" ${chk.ok ? '' : 'disabled'}>
          <span>Brücke nach ${DIR_NAMES[o.dir]} (${o.tiles.length} ${o.tiles.length === 1 ? 'Feld' : 'Felder'})<span class="sub">${chk.ok ? 'Blau markiert · verbraucht den Zug der Einheit' : chk.reason}</span></span>
          <span class="cost">${o.cost} Sterne</span></button>`;
      }
      extra += `</div>`;
    }
    // Straße auf dem eigenen Feld (auch außerhalb des Gebiets).
    if (!unit.carry && !UNITS[unit.type].abilities.includes('water') && state.techs[ctx.actAs].includes(ROAD.tech) && !roadAt(state, unit.q, unit.r)) {
      const chk = canBuildRoad(state, ctx.actAs, unit.q, unit.r, true);
      const spent = unit.mp <= 0 && unit.hasMoved;
      if (!(chk.reason === 'Städte sind schon angebunden')) {
        extra += `<div class="action-list"><button class="btn action" data-road ${chk.ok && !spent ? '' : 'disabled'}>
          <span>Weg bauen<span class="sub">${spent ? 'Keine Bewegung mehr' : chk.ok ? 'Auf diesem Feld · verbraucht die restliche Bewegung' : chk.reason}</span></span>
          <span class="cost">${ROAD.cost} Sterne</span></button></div>`;
      }
    }
    const up = upgradeOption(state, unit);
    if (up) {
      extra += `<div class="action-list"><button class="btn action" data-upgrade ${up.ok ? '' : 'disabled'}>
        <span>Aufrüsten zu ${esc(UNITS[up.to].name)}<span class="sub">${up.ok ? 'Verletzungen bleiben anteilig · verbraucht den Zug' : esc(up.reason)}</span></span>
        <span class="cost">${up.cost} Sterne</span></button></div>`;
    }
    // Lastenballon: Fracht aufnehmen oder absetzen.
    const dirTo = (q, r) => DIRS.findIndex(([dq, dr]) => unit.q + dq === q && unit.r + dr === r);
    if (unit.cargo) {
      extra += `<div class="hint">Fracht: ${esc(UNITS[unit.cargo.type].name)}</div>`;
      const spots = unloadOptions(state, unit);
      if (spots.length) {
        extra += `<div class="action-list">${spots.map(([q, r]) => `<button class="btn action" data-unload="${q},${r}">
          <span>Absetzen nach ${DIR_NAMES[dirTo(q, r)]}<span class="sub">Fracht steigt aus · verbraucht den Zug</span></span></button>`).join('')}</div>`;
      } else if (!unit.acted) extra += `<div class="hint">Zum Absetzen neben ein freies Landfeld fliegen.</div>`;
    }
    const loads = loadOptions(state, unit);
    if (loads.length) {
      extra += `<div class="action-list">${loads.map(u => `<button class="btn action" data-load="${u.id}">
        <span>Aufnehmen: ${esc(UNITS[u.type].name)} (${DIR_NAMES[dirTo(u.q, u.r)]})<span class="sub">Die Einheit fliegt mit</span></span></button>`).join('')}</div>`;
    }
    const breakable = destroyableBridges(state, unit);
    if (breakable.length) {
      extra += `<div class="action-list">${breakable.map(([q, r]) =>
        `<button class="btn action" data-unbridge="${q},${r}"><span>Brücke einreißen<span class="sub">${q === unit.q && r === unit.r ? 'Unter dem Schiff' : 'Auf dem Nachbarfeld'} · verbraucht den Zug</span></span></button>`).join('')}</div>`;
    }
    extra += `<div class="action-list"><button class="btn action ghost" data-disband>
      <span>Einheit auflösen<span class="sub">Entfernt die Einheit dauerhaft</span></span>
      <span class="cost">+${disbandRefund(unit)} Sterne</span></button></div>`;
  }

  let found = '';
  if (mine && ctx.myTurn && unit.type === 'settler') {
    const f = canFound(state, unit, ctx.actAs);
    found = `<div class="action-list"><button class="btn action" data-found ${f.ok ? '' : 'disabled'}>
      <span>Stadt gründen<span class="sub">${f.ok ? 'Gründet auf diesem Feld eine neue Stadt' : f.reason}</span></span>
    </button></div>`;
  }

  panel(`
    <div class="panel-head">
      <div>
        <div class="panel-title">${land ? `${land.name} (eingeschifft)` : def.name}${unit.vet ? ` <span class="vet-badge">${STAR_ICON} Veteran</span>` : ''}</div>
        <div class="panel-sub owner-line"><span class="dot" style="background:${hex(playerColor(state, unit.owner))}"></span>${owner}${mine ? ' (deine Einheit)' : ''}</div>
      </div>
      <div class="panel-head-right">
        <span class="panel-sub">${unit.acted && unit.mp <= 0 ? 'erledigt' : 'bereit'}</span>
        <button class="btn icon-btn panel-close" data-close>Schließen</button>
      </div>
    </div>
    <div class="hp-bar ${unit.hp / cap <= 0.35 ? 'low' : ''}"><div style="width:${hpPct}%"></div></div>
    <div class="stat-row">
      <div class="stat">Leben<b>${unit.hp}/${cap}</b></div>
      <div class="stat">Angriff<b>${attackOf(state, unit)}</b></div>
      <div class="stat">Verteidigung<b>${defenseOf(state, unit)}</b></div>
      <div class="stat">Bewegung<b>${fmtMp(unit.mp)}/${maxMove(state, unit.owner, unit.type)}</b></div>
      <div class="stat">Reichweite<b>${def.range}</b></div>
    </div>
    <div class="ability-row">${abilityChips(unit.type)}</div>
    ${unit.vet ? '' : `<div class="hint">Siege: ${unit.kills || 0}/3 bis zur Beförderung (+5 Leben)</div>`}
    ${land ? '<div class="hint">Fährt als Boot; an Land gehen beendet die Bewegung.</div>' : ''}
    <div class="hint">Gelände: ${tile.name} · Verteidigungsfaktor ${tb}-fach</div>
    ${switchToCity(state, unit, ctx)}
    ${todo}
    ${found}
    ${forecast}
    ${extra}
    <div class="hint">${hint}</div>
  `);
  wirePanel($('panel'));
  const upBtn = $('panel').querySelector('[data-upgrade]');
  if (upBtn) upBtn.addEventListener('click', () => handlers.onUpgrade(unit));
  $('panel').querySelectorAll('[data-load]').forEach(btn => btn.addEventListener('click', () => handlers.onLoadCargo(unit, btn.dataset.load)));
  $('panel').querySelectorAll('[data-unload]').forEach(btn => btn.addEventListener('click', () => {
    const [q, r] = btn.dataset.unload.split(',').map(Number);
    handlers.onUnloadCargo(unit, q, r);
  }));
  const roadBtn = $('panel').querySelector('[data-road]');
  if (roadBtn) roadBtn.addEventListener('click', () => handlers.onBuildRoad(unit.q, unit.r, unit));
  const foundBtn = $('panel').querySelector('[data-found]');
  if (foundBtn) foundBtn.addEventListener('click', () => handlers.onFound(unit));
  $('panel').querySelectorAll('[data-bridge]').forEach(btn => {
    btn.addEventListener('click', () => handlers.onBuildBridge(unit, Number(btn.dataset.bridge)));
  });
  $('panel').querySelectorAll('[data-unbridge]').forEach(btn => {
    const [q, r] = btn.dataset.unbridge.split(',').map(Number);
    btn.addEventListener('click', () => handlers.onDestroyBridge(unit, q, r));
  });
  const cityBtn = $('panel').querySelector('[data-open-city]');
  if (cityBtn) cityBtn.addEventListener('click', () => handlers.onSelectCity(unit.q, unit.r));
  const disbandBtn = $('panel').querySelector('[data-disband]');
  if (disbandBtn) disbandBtn.addEventListener('click', () => handlers.onDisband(unit));
}

// Einheit und Stadt auf demselben Feld: Knopf zum Wechseln zwischen den Menüs.
function switchToCity(state, unit, ctx) {
  const city = cityAt(state, unit.q, unit.r);
  if (!city || !cityView(state, ctx.viewer, city)) return '';
  const label = city.owner === ctx.actAs ? 'Stadtmenü öffnen' : 'Stadt ansehen';
  return `<div class="action-list"><button class="btn action ghost" data-open-city><span>${label}<span class="sub">Die Einheit steht in einer ${city.isCapital ? 'Hauptstadt' : 'Stadt'} – ausbilden, Bevölkerung, Gebäude</span></span></button></div>`;
}

function switchToUnit(state, city, ctx) {
  const u = unitAt(state, city.q, city.r);
  if (!u) return '';
  const def = UNITS[u.carry || u.type];
  const mine = u.owner === ctx.actAs;
  return `<button class="btn small unit-in-city" data-open-unit="${u.id}" title="Steht in der Stadt${mine ? ' – ziehen, angreifen, auflösen' : ''}">${mine ? 'Einheit wählen' : 'Einheit ansehen'}: ${def.name}</button>`;
}

export function showCityPanel(state, city, ctx) {
  // Fremde Städte außer Sicht nur so zeigen, wie man sie zuletzt gesehen hat.
  const view = cityView(state, ctx.viewer, city);
  if (view && !view.live) return showRememberedCity(state, view);
  const mine = city.owner === ctx.actAs && ctx.myTurn;
  const ownerName = city.owner ? (tribeName(state, city.owner) || NAMES[city.owner]) : 'Neutral';
  const income = city.owner ? cityIncome(state, city) : 0;
  const occupied = state.units.some(u => u.q === city.q && u.r === city.r);

  const tiles = cityTiles(state, city);
  const built = tiles.filter(([q, r]) => improvementAt(state, q, r)).length;
  const res = tiles.filter(([q, r]) => resourceAt(state, q, r)).length;

  // Wie bei Mini Metro: Infos als Schild an der Stadt, Werkzeuge als Reihe unten.
  const name = city.isCapital ? 'Hauptstadt' : 'Stadt';
  const rewards = Object.entries(city.rewards || {}).sort((a, b) => a[0] - b[0]).map(([, id]) => CITY_REWARDS[id].name);
  setAnchor('city', city.q, city.r, `
    <div class="at-head">${city.owner ? `<span class="dot" style="background:${hex(playerColor(state, city.owner))}"></span>` : ''}<b>${name}</b><span class="at-lvl">Stufe ${city.pop}</span></div>
    <span class="at-hexes" aria-label="Stufe ${city.pop} von ${MAX_POP}">${Array.from({ length: MAX_POP }, (_, i) => `<span class="${i < city.pop ? 'on' : ''}"></span>`).join('')}</span>
    <div class="at-stats">${city.owner ? `<span class="at-inc">+${income} pro Runde</span>` : `<span>${esc(ownerName)}</span>`}<span>${tiles.length} Felder</span></div>
    ${rewards.length ? `<div class="at-sub">${rewards.map(esc).join(', ')}</div>` : ''}`);
  const tiles2 = [];
  let cap = '';
  if (city.owner && city.owner === ctx.actAs) {
    const lvl = pendingLevel(city);
    if (lvl && mine) tiles2.push(`<button class="btn primary tool-tile" data-reward-open><b>Stufe ${lvl}</b><span class="tt-foot"><span class="tt-why">Belohnung wählen</span></span></button>`);
    const can = buildOptionsCount(state, city, ctx);
    tiles2.push(`<button class="btn tool-tile tt-main" data-build-open><b>Ausbauen</b><span class="tt-foot"><span class="tt-why">${can ? `${can} ${can === 1 ? 'Möglichkeit' : 'Möglichkeiten'}` : 'Gebiet ansehen'}</span></span></button>`);
    const popReason = popReasonFor(state, city, ctx);
    tiles2.push(`<button class="btn tool-tile" data-buypop ${popReason ? 'disabled' : ''} title="${popReason || 'Mehr Sterne pro Runde, neue Stufe mit Belohnung'}"><b>Bevölkerung +1</b><span class="tt-foot">${popReason ? `<span class="tt-why">${popReason}</span>` : `<span class="tt-cost">${popCost(city, state)}</span>`}</span></button>`);
    tiles2.push('<span class="tb-sep" aria-hidden="true"></span>');
    const unlocked = UNIT_ORDER.filter(t => !UNITS[t].reward && (!UNITS[t].tech || state.techs[city.owner].includes(UNITS[t].tech)));
    for (const t of unlocked) {
      const u = UNITS[t];
      const reason = trainReason(state, city, t, ctx);
      const atk = attackOf(state, { type: t, owner: city.owner });
      const mv = maxMove(state, city.owner, t);
      tiles2.push(`<button class="btn tool-tile" data-train="${t}" ${reason ? 'disabled' : ''} title="${reason ? reason + ': ' : ''}${u.name}, Angriff ${atk}, Verteidigung ${u.def}, Bewegung ${mv}, Reichweite ${u.range}, Leben ${u.hp}">
        <b>${u.name}</b><span class="tt-stats">${stat('sword', atk)}${stat('shield', u.def)}${stat('boot', mv)}${u.range > 1 ? stat('bow', u.range) : ''}</span>
        <span class="tt-foot"><span class="tt-cost">${unitCost(state, city.owner, t)}</span></span></button>`);
    }
    if (occupied) cap = 'Einheit in der Stadt – zum Ausbilden zuerst wegziehen.';
    else if (city.trained) cap = `Diese Runde schon ausgebildet${cityPorts(state, city).length && !city.trainedShip ? ' – ein Schiff geht noch' : ''}.`;
    else if (city.trainedShip) cap = 'Schiff gebaut – eine Landeinheit geht noch.';
    else if (!ctx.myTurn) cap = 'Nicht dein Zug.';
  } else {
    cap = !city.owner ? 'Neutrale Stadt – rücke mit einer Einheit hinein, um sie zu erobern.'
      : 'Feindliche Stadt – besiege die Verteidiger und rücke ein, um sie zu erobern.';
  }
  const u0 = unitAt(state, city.q, city.r);
  panel(`
    <div class="tb-cap">
      <span>${cap ? esc(cap) : ''}</span>
      ${u0 ? `<button class="btn ghost small" data-open-unit="${u0.id}">${u0.owner === ctx.actAs ? 'Einheit wählen' : 'Einheit ansehen'}: ${UNITS[u0.carry || u0.type].name}</button>` : ''}
      ${city.owner !== ctx.actAs ? '<button class="btn ghost small" data-build-open>Gebiet ansehen</button>' : ''}
      <button class="btn ghost small" data-close>Schließen</button>
    </div>
    ${tiles2.length ? `<div class="tb-row">${tiles2.join('')}</div>` : ''}
  `, 'toolbar');
  wirePanel($('panel'));
  $('panel').querySelectorAll('[data-train]').forEach(btn => {
    btn.addEventListener('click', () => handlers.onTrain(city, btn.dataset.train));
  });
  const unitBtn = $('panel').querySelector('[data-open-unit]');
  if (unitBtn) unitBtn.addEventListener('click', () => handlers.onSelectUnit(unitBtn.dataset.openUnit));
  const rwBtn = $('panel').querySelector('[data-reward-open]');
  if (rwBtn) rwBtn.addEventListener('click', () => showReward(state, city, ctx));
  const popBtn = $('panel').querySelector('[data-buypop]');
  if (popBtn) popBtn.addEventListener('click', () => handlers.onBuyPop(city));
  $('panel').querySelectorAll('[data-build-open]').forEach(btn => btn.addEventListener('click', () => openBuild(state, city, ctx)));
  // Offenes Bau-Fenster mit dem neuen Stand nachziehen (z. B. nach dem Bauen).
  if (build.open && build.city && build.city.q === city.q && build.city.r === city.r) renderBuild(state, city, ctx);
}

function showRememberedCity(state, view) {
  const ownerName = view.owner ? (tribeName(state, view.owner) || NAMES[view.owner]) : 'Neutral';
  panel(`
    <div class="panel-head">
      <div>
        <div class="panel-title">Stadt${view.isCapital ? ' · Hauptstadt' : ''}</div>
        <div class="panel-sub owner-line">${view.owner ? `<span class="dot" style="background:${hex(playerColor(state, view.owner))}"></span>` : ''}${ownerName}</div>
      </div>
      <div class="panel-head-right">
        <button class="btn icon-btn panel-close" data-close>Schließen</button>
      </div>
    </div>
    <div class="stat-row">
      <div class="stat">Stufe<b>${view.pop}/${MAX_POP}</b></div>
      <div class="stat">Mauer<b>${view.wall ? 'ja' : 'nein'}</b></div>
    </div>
    <div class="hint">Im Nebel – so hast du die Stadt zuletzt gesehen. Schick eine Einheit oder einen Spion hin, um den aktuellen Stand zu sehen.</div>
  `);
  wirePanel($('panel'));
}

function levelChips(city) {
  const got = Object.entries(city.rewards || {}).sort((a, b) => a[0] - b[0]);
  if (!got.length) return '';
  return `<div class="level-row">${got.map(([lvl, id]) =>
    `<span class="level-chip" title="Stufe ${lvl}: ${CITY_REWARDS[id].desc}">${CITY_REWARDS[id].name}</span>`).join('')}</div>`;
}

// Auswahl-Dialog für die Belohnung einer aufgestiegenen Stadt.
export function showReward(state, city, ctx) {
  const lvl = pendingLevel(city);
  if (!lvl) return false;
  $('reward-title').textContent = `${city.isCapital ? 'Hauptstadt' : 'Stadt'} erreicht Stufe ${lvl}`;
  $('reward-text').textContent = 'Wähle eine Belohnung.';
  const box = $('reward-options');
  box.innerHTML = '';
  rewardOptions(city).forEach((id, i) => {
    const def = CITY_REWARDS[id];
    const b = document.createElement('button');
    b.className = 'btn big reward-opt' + (i === 0 ? ' primary' : '');
    b.innerHTML = `<span>${def.name}</span><span class="sub">${def.desc}</span>`;
    b.addEventListener('click', () => {
      $('reward-overlay').classList.add('hidden');
      handlers.onChooseReward(city, id);
    });
    box.appendChild(b);
  });
  $('reward-overlay').classList.remove('hidden');
  return true;
}

export function isRewardOpen() {
  return !$('reward-overlay').classList.contains('hidden');
}

export function showHandover(name, onGo) {
  $('handover-title').textContent = `${name} ist am Zug`;
  $('handover-text').textContent = 'Gib das Gerät weiter. Die Karte wird erst angezeigt, wenn du bereit bist.';
  const btn = $('handoverGo');
  btn.onclick = () => { $('handover-overlay').classList.add('hidden'); onGo && onGo(); };
  $('handover-overlay').classList.remove('hidden');
}

// --- Bau-Fenster: Stadtgebiet als Wabenkarte, Feld wählen, Gebäude bauen ---------

const IMP_EFFECT = {
  farm: '+1 Stern pro Runde',
  sawmill: '+1 Stern pro Runde',
  mine: '+1 Stern pro Runde',
  port: '+1 Stern pro Runde, Schiffe ausbilden',
  temple: '+2 Sterne pro Runde',
  airfield: '+1 Stern pro Runde, Luft-Einheiten ausbilden',
  mill: '+1 Stern, +1 je angrenzender Farm',
  forge: '+1 Stern, +1 je angrenzendem Berg, +2 wenn dort eine Mine steht',
  market: '+1 Stern je angrenzendem Gebäude oder Rohstoff (bis 5)',
  fort: 'Einheiten darauf verteidigen dreifach',
  monastery: '+2 Sterne, Einheiten im Gebiet heilen mehr',
  watchtower: 'Sicht 3 Felder, Einheiten darauf und daneben verteidigen anderthalbfach',
  fishhut: '+1 Stern, +1 je Fischgrund daneben'
};
const impEffect = id => IMPROVEMENTS[id].monument ? `+${3} Bevölkerung, 200 Punkte (einmalig je Stamm)` : IMP_EFFECT[id] || '';

const build = { open: false, city: null, sel: null, state: null, ctx: null, opts: [] };

// Was lässt sich auf diesem Feld bauen? Erforschtes zuerst, Fehlendes mit Grund.
function tileOptions(state, city, q, r, ctx) {
  const tile = terrainAt(state, q, r);
  if (cityAt(state, q, r)) return [];
  const owner = city.owner;
  const out = [];
  for (const id of Object.keys(IMPROVEMENTS)) {
    const d = IMPROVEMENTS[id];
    if (!d.terrain.includes(tile)) continue;
    if (d.monument && !monumentReady(state, owner, id)) continue;
    const chk = canImprove(state, city, id, q, r);
    let reason = '';
    const known = !d.tech || state.techs[owner].includes(d.tech);
    if (!known) reason = 'Forschung: ' + TECHS[d.tech].name;
    else if (!chk.ok) reason = chk.reason;
    else if (state.stars[owner] < improvementCost(state, owner, id)) reason = 'Zu wenig Sterne';
    else if (!ctx.myTurn) reason = 'Nicht dein Zug';
    // Belegte Felder: keine Liste aller Gebäude, nur der Grund oben.
    if (!chk.ok && (chk.reason === 'Bereits bebaut' || chk.reason === 'Ressource wird genutzt')) continue;
    // Echter Gewinn an genau diesem Feld (inkl. Nachbarn wie Windmühle neben Farm).
    const pv = known && chk.ok ? improvePreview(state, city, id, q, r) : null;
    out.push({ kind: 'imp', id, name: d.name, cost: d.monument ? 0 : improvementCost(state, owner, id), reason, known,
      effect: impEffect(id), gain: pv ? pv.gain : null, changed: pv ? pv.changed : [], after: pv ? pv.after : null });
  }
  if (TERRAIN[tile].walkable && !roadAt(state, q, r)) {
    const known = state.techs[owner].includes(ROAD.tech);
    const chk = canBuildRoad(state, owner, q, r);
    const reason = !known ? 'Forschung: ' + TECHS[ROAD.tech].name : !chk.ok ? chk.reason : !ctx.myTurn ? 'Nicht dein Zug' : '';
    out.push({ kind: 'road', id: 'road', name: 'Weg', cost: ROAD.cost, reason, known, effect: 'Schritt von Weg zu Weg kostet halbe Bewegung' });
  }
  return out.sort((a, b) => (a.reason ? 1 : 0) - (b.reason ? 1 : 0) || (b.known ? 1 : 0) - (a.known ? 1 : 0));
}

function buildOptionsCount(state, city, ctx) {
  if (!ctx.myTurn) return 0;
  // Wege zählen nicht mit – sie gehen fast überall und würden alles überdecken.
  return cityTiles(state, city).reduce((n, [q, r]) => n + tileOptions(state, city, q, r, ctx).filter(o => !o.reason && o.kind !== 'road').length, 0);
}

function openBuild(state, city, ctx) {
  build.open = true;
  build.city = city;
  build.sel = null;
  $('build-overlay').classList.remove('hidden');
  // Echte 3D-Ansicht des Stadtgebiets; ohne WebGL bleibt die Wabenkarte.
  const box = $('build-map');
  box.innerHTML = '<canvas class="b3-canvas" aria-hidden="true"></canvas><div class="b3-tags"></div><div class="b3-hint">Ziehen dreht die Ansicht, Rad oder zwei Finger zoomen</div>';
  box.classList.add('b3');
  box.style.width = ''; box.style.height = '';
  const radius = Math.max(1, ...cityTiles(state, city).map(([q, r]) => hexDistance(q, r, city.q, city.r)));
  build.view3d = openCityView(box.querySelector('.b3-canvas'), city.q, city.r, radius, placeTags);
  if (build.view3d) {
    box.querySelector('.b3-canvas').addEventListener('click', e => {
      const hex = cityViewPick(e.clientX, e.clientY);
      if (!hex || !box.querySelector(`[data-hex="${hex.q},${hex.r}"]`)) return;
      selectBuildHex(hex.q + ',' + hex.r);
    });
  } else {
    box.classList.remove('b3');
    box.innerHTML = '';
  }
  renderBuild(state, city, ctx);
  const first = $('build-map').querySelector('[data-hex].sel');
  if (first) first.focus({ preventScroll: true });
}

function selectBuildHex(key) {
  build.sel = key;
  renderBuild(build.state, build.city, build.ctx);
  const again = $('build-map').querySelector(`[data-hex="${key}"]`);
  if (again) again.focus({ preventScroll: true });
}

// Marken über den Feldern der 3D-Ansicht an die Kamera anpassen.
function placeTags() {
  const box = $('build-map');
  if (!box) return;
  box.querySelectorAll('.b3-tag').forEach(t => {
    const [q, r] = t.dataset.hex.split(',').map(Number);
    const p = cityViewProject(q, r);
    t.style.visibility = p ? '' : 'hidden';
    if (p) { t.style.left = p.x + 'px'; t.style.top = p.y + 'px'; }
  });
}

export function closeBuild() {
  build.open = false;
  if (build.view3d) { closeCityView(); build.view3d = false; }
  $('build-overlay').classList.add('hidden');
}

export function isBuildOpen() {
  return build.open;
}

function renderBuild(state, city, ctx) {
  build.state = state; build.city = city; build.ctx = ctx;
  const mineCity = city.owner === ctx.actAs;
  const tiles = cityTiles(state, city);
  // Das Stadtfeld selbst gehört zur Ansicht (Mitte), auch wenn dort nichts gebaut wird.
  if (!tiles.some(([q, r]) => q === city.q && r === city.r)) tiles.unshift([city.q, city.r]);
  const info = tiles.map(([q, r]) => {
    const opts = mineCity ? tileOptions(state, city, q, r, ctx) : [];
    return { q, r, key: q + ',' + r, opts, can: opts.some(o => !o.reason && o.kind !== 'road') };
  });
  if (!build.sel || !info.some(t => t.key === build.sel)) {
    const pick = info.find(t => t.can) || info.find(t => !cityAt(state, t.q, t.r)) || info[0];
    build.sel = pick ? pick.key : null;
  }
  $('build-title').textContent = `${city.isCapital ? 'Hauptstadt' : 'Stadt'} ${mineCity ? 'ausbauen' : '· Gebiet'}`;
  build.income = mineCity ? incomeFor(state, city.owner) : 0;
  $('build-stars').innerHTML = mineCity ? buildHead() : '';

  if (build.view3d) { renderBuild3d(state, city, ctx, info); return; }

  // Wabenkarte: gleiche Ausrichtung wie das Spielfeld (Spitze oben).
  const box = $('build-map');
  const c0 = toWorld(city.q, city.r);
  const pts = info.map(t => { const w = toWorld(t.q, t.r); return { ...t, x: w.x - c0.x, z: w.z - c0.z }; });
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
  const minZ = Math.min(...pts.map(p => p.z)), maxZ = Math.max(...pts.map(p => p.z));
  const avail = Math.max(240, Math.min(box.parentElement.clientWidth || 420, 520));
  const sx = (maxX - minX) + Math.sqrt(3), sz = (maxZ - minZ) + 2;
  const size = Math.max(26, Math.min(76, avail / sx, (window.innerHeight * 0.55) / sz));
  const w = Math.sqrt(3) * size, h = 2 * size;
  box.style.width = `${sx * size}px`;
  box.style.height = `${sz * size}px`;
  box.innerHTML = pts.map(t => {
    const tile = terrainAt(state, t.q, t.r);
    const imp = improvementAt(state, t.q, t.r);
    const res = resourceAt(state, t.q, t.r);
    const isCity = !!cityAt(state, t.q, t.r);
    const unit = unitAt(state, t.q, t.r);
    const main = isCity ? (city.isCapital ? 'Hauptstadt' : 'Stadt') : imp ? IMPROVEMENTS[imp].name : res ? RESOURCES[res].name : '';
    const tags = [roadAt(state, t.q, t.r) && !isCity ? 'Weg' : '', unit && !isCity ? 'Einheit' : ''].filter(Boolean).join(', ');
    const yld = isCity ? 0 : tileYield(state, city, t.q, t.r);
    const cls = ['bhex', t.key === build.sel ? 'sel' : '', t.can ? 'can' : '', imp ? 'built' : '', isCity ? 'city' : ''].filter(Boolean).join(' ');
    const label = [TERRAIN[tile].name, main, tags, yld ? `bringt ${yld}` : '', t.can ? 'baubar' : ''].filter(Boolean).join(', ');
    return `<button class="${cls}" data-hex="${t.key}" aria-label="${label}" aria-pressed="${t.key === build.sel}"
      style="left:${(t.x - minX) * size}px;top:${(t.z - minZ) * size}px;width:${w}px;height:${h}px">
      <span class="hx-in" style="background:${hex(TERRAIN[tile].color)}">
        <span class="hx-t">${TERRAIN[tile].name}</span>
        ${main ? `<span class="hx-m${imp ? ' imp' : res ? ' res' : ''}">${main}</span>` : ''}
        ${tags ? `<span class="hx-g">${tags}</span>` : ''}
        ${yld ? `<span class="hx-y">+${yld}</span>` : ''}
        ${isCity && mineCity ? `<span class="hx-g">Stufe ${city.pop}</span>` : ''}
      </span>
      <span class="hx-gain" aria-hidden="true"></span>
    </button>`;
  }).join('');
  box.querySelectorAll('[data-hex]').forEach(b => b.addEventListener('click', () => {
    build.sel = b.dataset.hex;
    renderBuild(build.state, build.city, build.ctx);
    const again = $('build-map').querySelector(`[data-hex="${build.sel}"]`);
    if (again) again.focus({ preventScroll: true });
  }));
  renderBuildDetail(state, city, ctx, info.find(t => t.key === build.sel));
  // Fokus nach dem Neuzeichnen (z. B. nach dem Bauen) auf dem gewählten Feld halten.
  if (build.open && (!document.activeElement || document.activeElement === document.body)) {
    const b = box.querySelector('.bhex.sel');
    if (b) b.focus({ preventScroll: true });
  }
}

// 3D-Ansicht: Marken (Knöpfe) über den Feldern und Ringe in der Szene.
function renderBuild3d(state, city, ctx, info) {
  const mineCity = city.owner === ctx.actAs;
  const tags = $('build-map').querySelector('.b3-tags');
  tags.innerHTML = info.map(t => {
    const imp = improvementAt(state, t.q, t.r);
    const res = resourceAt(state, t.q, t.r);
    const isCity = !!cityAt(state, t.q, t.r);
    const yld = isCity ? 0 : tileYield(state, city, t.q, t.r);
    const unit = unitAt(state, t.q, t.r);
    const main = isCity ? (city.isCapital ? 'Hauptstadt' : 'Stadt') : imp ? IMPROVEMENTS[imp].name : res ? RESOURCES[res].name : '';
    const tile = TERRAIN[terrainAt(state, t.q, t.r)].name;
    const label = [tile, main, unit && !isCity ? 'Einheit' : '', yld ? `bringt ${yld}` : '', t.can ? 'baubar' : ''].filter(Boolean).join(', ');
    const cls = ['b3-tag', t.key === build.sel ? 'sel' : '', t.can ? 'can' : '', main ? 'named' : 'blank', isCity ? 'city' : ''].filter(Boolean).join(' ');
    return `<button class="${cls}" data-hex="${t.key}" aria-label="${esc(label)}" aria-pressed="${t.key === build.sel}">${main ? `<span class="b3-m">${esc(main)}</span>` : ''}${yld ? `<span class="b3-y">+${yld}</span>` : ''}${isCity && mineCity ? `<span class="b3-y">Stufe ${city.pop}</span>` : ''}<span class="hx-gain" aria-hidden="true"></span></button>`;
  }).join('');
  tags.querySelectorAll('[data-hex]').forEach(b => b.addEventListener('click', () => selectBuildHex(b.dataset.hex)));
  placeTags();
  setCityViewMarks({ sel: build.sel, can: info.filter(t => t.can).map(t => t.key) });
  renderBuildDetail(state, city, ctx, info.find(t => t.key === build.sel));
  if (build.open && (!document.activeElement || document.activeElement === document.body)) {
    const b = tags.querySelector('.sel');
    if (b) b.focus({ preventScroll: true });
  }
}

function renderBuildDetail(state, city, ctx, t) {
  const box = $('build-detail');
  build.opts = [];
  if (!t) { box.innerHTML = ''; return; }
  const tile = terrainAt(state, t.q, t.r);
  const imp = improvementAt(state, t.q, t.r);
  const res = resourceAt(state, t.q, t.r);
  const lines = [];
  const isCity = !!cityAt(state, t.q, t.r);
  if (isCity) lines.push(`Stufe ${city.pop}, ${stars(cityIncome(state, city))} pro Runde. Gebaut wird auf den Feldern drumherum, hier bildest du Einheiten aus.`);
  if (imp) {
    const inc = improvementIncome(state, city.owner, imp, t.q, t.r);
    const extra = IMPROVEMENTS[imp].adjacent || IMPROVEMENTS[imp].monument || !inc ? ' ' + impEffect(imp) : '';
    lines.push(`<b>${IMPROVEMENTS[imp].name}</b> steht hier${inc ? ` und bringt +${inc} ${inc === 1 ? 'Stern' : 'Sterne'} pro Runde` : ''}.${extra}`);
  }
  if (res) lines.push(`<b>${RESOURCES[res].name}</b>: Rohstoff, bringt der Stadt schon Ertrag. Darauf lässt sich nichts bauen.`);
  if (roadAt(state, t.q, t.r) && !cityAt(state, t.q, t.r)) lines.push('Hier verläuft ein Weg.');
  const unit = unitAt(state, t.q, t.r);
  if (unit && !cityAt(state, t.q, t.r)) lines.push(`Hier steht ${UNITS[unit.type].name} – zum Bauen muss das Feld frei sein.`);
  const mineCity = city.owner === ctx.actAs;
  let opts = '';
  if (mineCity && isCity) {
    // Ausbilden direkt im Bau-Fenster (gleiche Regeln wie im Stadtmenü).
    const types = UNIT_ORDER.filter(ty => !UNITS[ty].reward && (!UNITS[ty].tech || state.techs[city.owner].includes(UNITS[ty].tech)));
    build.opts = types.map(ty => ({ kind: 'train', id: ty, reason: trainReason(state, city, ty, ctx) }));
    opts = `<div class="bsec">Einheiten ausbilden</div><div class="bopts">${types.map((ty, i) => {
      const u = UNITS[ty], reason = build.opts[i].reason;
      return `<button class="btn bopt" data-opt="${i}" ${reason ? 'disabled' : ''}>
        <span class="bo-key">${i < 9 ? i + 1 : ''}</span>
        <span class="bo-main"><b>${u.name}</b><span class="sub">${reason ? reason + ', ' : ''}Angriff ${attackOf(state, { type: ty, owner: city.owner })}, Verteidigung ${u.def}, Bewegung ${maxMove(state, city.owner, ty)}${u.range > 1 ? ', Reichweite ' + u.range : ''}, Leben ${u.hp}</span></span>
        <span class="cost">${stars(unitCost(state, city.owner, ty))}</span>
      </button>`;
    }).join('')}</div>`;
  } else if (mineCity && t.opts.length) {
    const ready = t.opts.filter(o => o.known);
    const later = t.opts.filter(o => !o.known);
    build.opts = ready;
    opts = `<div class="bopts">${ready.map((o, i) => `
      <button class="btn bopt" data-opt="${i}" ${o.reason ? 'disabled' : ''}>
        <span class="bo-key">${i < 9 ? i + 1 : ''}</span>
        <span class="bo-main"><b>${o.name}${o.gain ? ` <span class="bo-gain">+${o.gain} pro Runde</span>` : ''}</b><span class="sub">${o.reason ? o.reason + ', ' : ''}${o.effect}${o.changed && o.changed.length ? `, dazu ${neighbourText(state, o.changed)}` : ''}</span></span>
        <span class="cost">${o.cost ? stars(o.cost) : 'frei'}</span>
      </button>`).join('')}</div>`;
    if (!ready.length) opts += '<div class="hint">Noch nichts erforscht, was hier gebaut werden kann.</div>';
    if (later.length) opts += `<div class="blater"><span>Nach Forschung möglich:</span> ${later.map(o => `<span class="blater-chip" title="${o.effect}">${o.name} <i>${o.reason.replace('Forschung: ', '')}</i></span>`).join('')}</div>`;
  } else if (mineCity && !cityAt(state, t.q, t.r) && !imp && !res) {
    opts = '<div class="hint">Auf diesem Gelände gibt es nichts zu bauen.</div>';
  } else if (!mineCity) {
    opts = '<div class="hint">Nicht deine Stadt.</div>';
  }
  box.innerHTML = `<h3>${isCity ? (city.isCapital ? 'Hauptstadt' : 'Stadt') : TERRAIN[tile].name}</h3>${lines.map(l => `<p>${l}</p>`).join('')}${opts}`;
  box.querySelectorAll('[data-opt]').forEach(b => {
    b.addEventListener('click', () => doBuildOpt(Number(b.dataset.opt)));
    // Vorschau: profitierende Nachbarfelder hervorheben, Einkommen danach zeigen.
    const on = () => previewOpt(build.opts[Number(b.dataset.opt)]);
    b.addEventListener('mouseenter', on);
    b.addEventListener('focus', on);
    b.addEventListener('mouseleave', () => previewOpt(null));
    b.addEventListener('blur', () => previewOpt(null));
  });
}

const stars = n => `${n} ${n === 1 ? 'Stern' : 'Sterne'}`;

function buildHead(after = null) {
  const st = build.state, owner = build.city.owner;
  return `${stars(st.stars[owner])}<span class="bh-inc">, Einkommen ${build.income}${after != null && after !== build.income ? `, danach <b>${after}</b>` : ''} pro Runde</span>`;
}

function neighbourText(state, changed) {
  return changed.map(c => {
    const imp = improvementAt(state, c.q, c.r);
    return `${imp ? IMPROVEMENTS[imp].name : 'Nachbarfeld'} daneben ${c.delta > 0 ? '+' : ''}${c.delta}`;
  }).join(', ');
}

function previewOpt(o) {
  const map = $('build-map');
  map.querySelectorAll('[data-hex].gain').forEach(h => { h.classList.remove('gain'); h.querySelector('.hx-gain').textContent = ''; });
  if (!build.open) return;
  $('build-stars').innerHTML = buildHead(o && o.after != null ? o.after : null);
  if (build.view3d) {
    const can = [...map.querySelectorAll('[data-hex].can')].map(h => h.dataset.hex);
    setCityViewMarks({ sel: build.sel, can, gain: o && o.changed ? o.changed.map(c => c.q + ',' + c.r) : [] });
  }
  if (!o || !o.changed) return;
  for (const c of o.changed) {
    const h = map.querySelector(`[data-hex="${c.q},${c.r}"]`);
    if (!h) continue;
    h.classList.add('gain');
    h.querySelector('.hx-gain').textContent = `${c.delta > 0 ? '+' : ''}${c.delta}`;
  }
}

function doBuildOpt(i) {
  const o = build.opts[i];
  if (!o || o.reason || !build.sel) return;
  const [q, r] = build.sel.split(',').map(Number);
  if (o.kind === 'road') handlers.onBuildRoad(q, r, null);
  else if (o.kind === 'train') handlers.onTrain(build.city, o.id);
  else handlers.onImprove(build.city, o.id, q, r);
}

// Pfeiltasten: links/rechts = vorheriges/nächstes Feld, hoch/runter = nächstes
// Feld in dieser Richtung. Ziffern bauen die entsprechende Möglichkeit.
function buildKey(e) {
  if (!build.open) return;
  if (e.key === 'Escape') { e.preventDefault(); closeBuild(); return; }
  if (/^[1-9]$/.test(e.key)) { e.preventDefault(); doBuildOpt(Number(e.key) - 1); return; }
  if (!e.key.startsWith('Arrow') || !build.sel) return;
  e.preventDefault();
  const list = [...$('build-map').querySelectorAll('[data-hex]')].map(b => ({ key: b.dataset.hex, x: parseFloat(b.style.left) || 0, y: parseFloat(b.style.top) || 0 }));
  const cur = list.find(t => t.key === build.sel);
  if (!cur) return;
  let next = null;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const sorted = list.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const i = sorted.findIndex(t => t.key === cur.key);
    next = sorted[(i + (e.key === 'ArrowRight' ? 1 : -1) + sorted.length) % sorted.length];
  } else {
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const cand = list.filter(t => (t.y - cur.y) * dir > 1);
    cand.sort((a, b) => Math.abs(a.y - cur.y) + Math.abs(a.x - cur.x) * 0.8 - (Math.abs(b.y - cur.y) + Math.abs(b.x - cur.x) * 0.8));
    next = cand[0];
  }
  if (!next) return;
  selectBuildHex(next.key);
}

function trainReason(state, city, type, ctx) {
  const chk = canTrain(state, city, type, ctx.actAs);
  if (!chk.ok) return chk.reason;
  if (!ctx.myTurn) return 'Nicht dein Zug';
  return '';
}

function popReasonFor(state, city, ctx) {
  if (!ctx.myTurn) return 'Nicht dein Zug';
  const chk = canBuyPop(state, city, ctx.actAs);
  return chk.ok ? '' : chk.reason;
}

const ROOTS = ['organization', 'climbing', 'fishing', 'hunting', 'riding'];
const CHILDREN = (() => {
  const map = {};
  for (const id in TECHS) {
    const req = TECHS[id].req;
    if (req) (map[req] || (map[req] = [])).push(id);
  }
  return map;
})();
// Zweigfarben (dezent, passend zu den Teamfarben-Plaketten).
const BRANCH_COLOR = {
  organization: '#d97706', climbing: '#64748b', fishing: '#0284c7', hunting: '#16a34a', riding: '#a16207'
};
const branchOf = id => { let t = id; while (TECHS[t].req) t = TECHS[t].req; return t; };

const techNav = { scale: 1, tx: 0, ty: 0, bound: false, lastDrag: 0, home: { scale: 1, tx: 0, ty: 0 } };
// Der Baum ist eine Wabe aus Sechsecken in einem festen virtuellen Raum und
// wird passend in das sichtbare Feld skaliert (zoom-/verschiebbar).
const HEX_W = 92, HEX_H = 104, COL_W = 98, ROW_H = HEX_H + 8, TREE_PAD = 24;
let selectedTech = null;
let lastTechClick = null;
let lastTechTarget = null;
function resetTechNav() {
  techNav.scale = techNav.home.scale;
  techNav.tx = techNav.home.tx;
  techNav.ty = techNav.home.ty;
  applyTechNav();
}
function applyTechNav() {
  const vp = $('tech-viewport');
  if (vp) vp.style.transform = `translate(${techNav.tx}px, ${techNav.ty}px) scale(${techNav.scale})`;
}
function bindTechNav() {
  if (techNav.bound || !$('tech-tree')) return;
  techNav.bound = true;
  const tree = $('tech-tree');
  const zoomAt = (factor, cx, cy) => {
    const ns = Math.min(3.2, Math.max(0.4, techNav.scale * factor));
    if (ns === techNav.scale) return;
    const k = ns / techNav.scale;
    techNav.tx = cx - (cx - techNav.tx) * k;
    techNav.ty = cy - (cy - techNav.ty) * k;
    techNav.scale = ns;
    applyTechNav();
  };
  tree.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = tree.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
  const pointers = new Map();
  const pinch = { prevDist: 0, cx: 0, cy: 0 };
  let dragAcc = 0;
  tree.addEventListener('pointerdown', e => {
    lastTechTarget = e.target.closest('.tech-hex') || null;
    tree.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragAcc = 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch.prevDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinch.cx = (a.x + b.x) / 2;
      pinch.cy = (a.y + b.y) / 2;
    }
    tree.classList.add('grabbing');
  });
  tree.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      const p = pointers.get(e.pointerId);
      const dx = cur.x - p.x, dy = cur.y - p.y;
      dragAcc += Math.abs(dx) + Math.abs(dy);
      techNav.tx += dx;
      techNav.ty += dy;
      p.x = cur.x; p.y = cur.y;
      applyTechNav();
    } else if (pointers.size === 2) {
      pointers.set(e.pointerId, cur);
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.prevDist > 0) {
        const rect = tree.getBoundingClientRect();
        zoomAt(dist / pinch.prevDist, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      }
      pinch.prevDist = dist;
      pinch.cx = (a.x + b.x) / 2;
      pinch.cy = (a.y + b.y) / 2;
    }
  });
  const endPointer = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch.prevDist = 0;
    if (pointers.size === 0) {
      tree.classList.remove('grabbing');
      if (dragAcc > 6) techNav.lastDrag = Date.now();
    }
  };
  tree.addEventListener('pointerup', endPointer);
  tree.addEventListener('pointercancel', endPointer);
  window.addEventListener('pointerup', endPointer);
  let lastTap = 0;
  tree.addEventListener('click', e => {
    e.stopPropagation();
    if (Date.now() - techNav.lastDrag < 350) {
      e.preventDefault();
      return;
    }
    if (lastTechTarget && lastTechTarget.isConnected && lastTechClick) {
      e.preventDefault();
      lastTechClick(lastTechTarget);
      lastTechTarget = null;
      return;
    }
    const now = Date.now();
    if (now - lastTap < 300) {
      e.preventDefault();
      lastTap = 0;
      resetTechNav();
    } else {
      lastTap = now;
    }
  }, true);
}

// Querformat: Wurzeln oben, je zwei Zweige darunter (Wabe), die dritte
// Stufe direkt unter ihrem Zweig. Hochformat (Handy): dieselbe Struktur
// gedreht – Wurzeln links, Stufen nach rechts, Zweige untereinander.
function layoutTechs(portrait) {
  const pos = {};
  if (!portrait) {
    const rowY = [TREE_PAD + HEX_H / 2];
    rowY.push(rowY[0] + HEX_H * 0.75 + 6);
    for (let k = 2; k < 6; k++) rowY.push(rowY[k - 1] + HEX_H + 6);
    const colX = c => TREE_PAD + (c + 0.5) * COL_W;
    let depth = 1;
    // Ab Stufe 2 läuft jeder Ast in seiner Spalte nach unten (auch Stufe 5/6).
    const down = (id, col, row) => {
      pos[id] = { x: colX(col), y: rowY[row] };
      depth = Math.max(depth, row);
      for (const c of CHILDREN[id] || []) down(c, col, row + 1);
    };
    ROOTS.forEach((root, i) => {
      pos[root] = { x: TREE_PAD + (2 * i + 1) * COL_W, y: rowY[0] };
      (CHILDREN[root] || []).forEach((child, j) => down(child, 2 * i + j, 1));
    });
    return { pos, w: TREE_PAD * 2 + ROOTS.length * 2 * COL_W, h: rowY[depth] + HEX_H / 2 + TREE_PAD };
  }
  const colX = [TREE_PAD + HEX_W / 2];
  colX.push(colX[0] + COL_W * 0.86);
  for (let k = 2; k < 6; k++) colX.push(colX[k - 1] + COL_W + 6);
  const rowY = r => TREE_PAD + (r + 0.5) * ROW_H;
  let depth = 1;
  const right = (id, row, col) => {
    pos[id] = { x: colX[col], y: rowY(row) };
    depth = Math.max(depth, col);
    for (const c of CHILDREN[id] || []) right(c, row, col + 1);
  };
  ROOTS.forEach((root, i) => {
    pos[root] = { x: colX[0], y: TREE_PAD + (2 * i + 1) * ROW_H };
    (CHILDREN[root] || []).forEach((child, j) => right(child, 2 * i + j, 1));
  });
  return { pos, w: colX[depth] + HEX_W / 2 + TREE_PAD, h: TREE_PAD * 2 + ROOTS.length * 2 * ROW_H };
}

// Was eine Technologie freischaltet (Einheiten, Gebäude) – für die Details.
function techUnlocks(id) {
  const out = [];
  for (const t of UNIT_ORDER) if (UNITS[t].tech === id) out.push(UNITS[t].name);
  for (const k of Object.keys(IMPROVEMENTS)) if (IMPROVEMENTS[k].tech === id) out.push(IMPROVEMENTS[k].name);
  return out;
}

function techStatus(state, id, actAs) {
  const t = TECHS[id];
  const mine = state.techs[actAs];
  if (mine.includes(id)) return 'done';
  if (t.req && !mine.includes(t.req)) return 'locked';
  return state.stars[actAs] >= techCost(state, id, actAs) ? 'ready' : 'poor';
}

function renderTechDetail(state, ctx) {
  const box = $('tech-detail');
  if (!box) return;
  if (!selectedTech || !TECHS[selectedTech]) {
    box.innerHTML = '<div class="hint">Tippe auf eine Technologie, um Details zu sehen und sie zu erforschen.</div>';
    return;
  }
  const id = selectedTech, t = TECHS[id];
  const status = techStatus(state, id, ctx.actAs);
  const cost = techCost(state, id, ctx.actAs);
  const unlocks = techUnlocks(id);
  let reason = '';
  if (status === 'done') reason = 'Bereits erforscht';
  else if (status === 'locked') reason = `Benötigt zuerst: ${TECHS[t.req].name}`;
  else if (status === 'poor') reason = `Zu wenig Sterne (${state.stars[ctx.actAs]} von ${cost})`;
  else if (!ctx.myTurn) reason = 'Nicht dein Zug';
  box.innerHTML = `
    <div class="td-head">
      <span class="td-dot" style="background:${BRANCH_COLOR[branchOf(id)]}"></span>
      <b>${t.name}</b>
      <span class="td-tier">Stufe ${t.tier}</span>
    </div>
    <div class="td-desc">${esc(t.desc)}</div>
    ${unlocks.length ? `<div class="td-unlock">Schaltet frei: ${unlocks.map(esc).join(', ')}</div>` : ''}
    <button class="btn primary td-buy" ${reason ? 'disabled' : ''}>${status === 'done' ? 'Erforscht' : `Erforschen · ${cost} Sterne`}</button>
    ${reason && status !== 'done' ? `<div class="hint">${esc(reason)}</div>` : ''}`;
  const buy = box.querySelector('.td-buy');
  if (buy && !reason) buy.addEventListener('click', () => handlers.onResearch(id));
}

export function openTech(state, ctx, keepView = false) {
  const overlay = $('tech-overlay');
  overlay.classList.remove('hidden');
  const stars = state.stars[ctx.actAs];
  $('tech-stars').textContent = stars + ' Sterne';
  const tree = $('tech-tree');
  const svg = $('tech-lines');
  const nodes = $('tech-nodes');
  nodes.innerHTML = '';
  const W = tree.clientWidth || 560;
  const H = tree.clientHeight || 360;
  const portrait = W < 560;
  const { pos, w: TREE_W, h: TREE_H } = layoutTechs(portrait);
  // Hochformat: auf Breite skalieren, oben beginnen, nach unten verschieben.
  // Nie kleiner als lesbar (Namen mindestens 12 px). Passt der Baum dann nicht
  // ganz hinein, zeigt die Startansicht, was du jetzt erforschen kannst.
  const MIN_SCALE = 12 / 14;
  const fit = portrait ? Math.min(1.1, W / TREE_W) : Math.min(1.2, W / TREE_W, H / TREE_H);
  const scale = Math.max(MIN_SCALE, fit);
  let tx = (W - TREE_W * scale) / 2, ty = portrait ? 0 : (H - TREE_H * scale) / 2;
  if (scale > fit) {
    const front = Object.keys(TECHS).filter(id => ['ready', 'poor'].includes(techStatus(state, id, ctx.actAs)));
    const fx = front.length ? front.reduce((n, id) => n + pos[id].x, 0) / front.length : TREE_W / 2;
    const fy = front.length ? front.reduce((n, id) => n + pos[id].y, 0) / front.length : 0;
    const clamp = (v, size, view) => size * scale <= view ? (view - size * scale) / 2 : Math.min(0, Math.max(view - size * scale, v));
    tx = clamp(W / 2 - fx * scale, TREE_W, W);
    ty = clamp(H * 0.4 - fy * scale, TREE_H, H);
  }
  techNav.home = { scale, tx, ty };
  // Sprungleiste zu den fünf Zweigen, wenn der Baum nicht ganz hineinpasst.
  const jump = $('tech-jump');
  if (jump) {
    jump.classList.toggle('hidden', scale <= fit + 0.001);
    jump.innerHTML = ROOTS.map(r => `<button class="tj-btn" data-jump="${r}"><span class="tj-dot" style="background:${BRANCH_COLOR[r]}"></span>${TECHS[r].name}</button>`).join('');
    jump.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
      const ids = Object.keys(TECHS).filter(id => branchOf(id) === b.dataset.jump);
      const xs = ids.map(id => pos[id].x), ys = ids.map(id => pos[id].y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, top = Math.min(...ys);
      const clampTo = (v, size, view) => size * techNav.scale <= view ? (view - size * techNav.scale) / 2 : Math.min(0, Math.max(view - size * techNav.scale, v));
      techNav.tx = clampTo(W / 2 - cx * techNav.scale, TREE_W, W);
      techNav.ty = clampTo(30 - (top - HEX_H / 2) * techNav.scale, TREE_H, H);
      if (portrait) { techNav.tx = clampTo(30 - (Math.min(...xs) - HEX_W / 2) * techNav.scale, TREE_W, W); techNav.ty = clampTo(H / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * techNav.scale, TREE_H, H); }
      applyTechNav();
    }));
  }
  // Beim erneuten Öffnen (z. B. nach dem Erforschen) Ansicht und Auswahl
  // behalten, beim ersten Öffnen auf die Gesamtansicht setzen.
  if (!keepView) { resetTechNav(); selectedTech = null; }
  const vp = $('tech-viewport');
  vp.style.right = 'auto';
  vp.style.bottom = 'auto';
  vp.style.width = TREE_W + 'px';
  vp.style.height = TREE_H + 'px';

  const mine = state.techs[ctx.actAs];
  let lines = '';
  for (const id in TECHS) {
    const t = TECHS[id];
    if (!t.req) continue;
    const a = pos[t.req], b = pos[id];
    const color = mine.includes(id) ? BRANCH_COLOR[branchOf(id)] : 'var(--border-strong)';
    lines += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" style="stroke:${color}" stroke-width="4" stroke-linecap="round" />`;
  }
  svg.setAttribute('viewBox', `0 0 ${TREE_W} ${TREE_H}`);
  svg.setAttribute('width', TREE_W);
  svg.setAttribute('height', TREE_H);
  svg.innerHTML = lines;

  lastTechIds = new Set(mine);
  for (const id in TECHS) {
    const t = TECHS[id];
    const p = pos[id];
    const status = techStatus(state, id, ctx.actAs);
    const btn = document.createElement('button');
    btn.className = `tech-hex ${status}${id === selectedTech ? ' selected' : ''}`;
    btn.style.left = p.x + 'px';
    btn.style.top = p.y + 'px';
    btn.style.setProperty('--branch', BRANCH_COLOR[branchOf(id)]);
    btn.dataset.tech = id;
    const cost = techCost(state, id, ctx.actAs);
    btn.innerHTML = `<span class="tn-in"><span class="tn-name" lang="de">${t.name}</span><span class="tn-cost">${status === 'done' ? CHECK_ICON : cost}</span></span>`;
    btn.setAttribute('aria-label', `${t.name}, ${status === 'done' ? 'erforscht' : status === 'locked' ? 'gesperrt, ' + cost + ' Sterne' : cost + ' Sterne'}`);
    nodes.appendChild(btn);
  }
  renderTechDetail(state, ctx);
  // Antippen wählt nur aus – erforscht wird über den Knopf in den Details.
  lastTechClick = node => {
    selectedTech = node.dataset.tech;
    nodes.querySelectorAll('.tech-hex').forEach(b => b.classList.toggle('selected', b.dataset.tech === selectedTech));
    renderTechDetail(state, ctx);
  };
}

function doneFor(id) {
  return lastTechIds.has(id);
}

let lastTechIds = new Set();

export function closeTech() {
  lastTechClick = null;
  lastTechTarget = null;
  $('tech-overlay').classList.add('hidden');
}

export function isTechOpen() {
  return !$('tech-overlay').classList.contains('hidden');
}

function menuTab(id, remember) {
  document.querySelectorAll('[data-mtab]').forEach(t => {
    const on = t.dataset.mtab === id;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('.menu-pane').forEach(p => p.classList.toggle('hidden', p.id !== 'mpane-' + id));
  if (remember) { try { localStorage.setItem('pb_menu_tab', id); } catch (e) { /* ignore */ } }
  if (id === 'board' && handlers.onBoard) handlers.onBoard('daily');
}

export function showMenu() {
  $('menu-overlay').classList.remove('hidden');
}

export function hideMenu() {
  $('menu-overlay').classList.add('hidden');
}

export function showWinner(state, ctx) {
  const winner = state.winner;
  $('winner-title').textContent = (tribeName(state, winner) || NAMES[winner]) + ' gewinnt!';
  let text = state.endReason === 'score' ? 'Höchste Punktzahl nach ' + state.turnLimit + ' Runden.'
    : state.endReason === 'mission' ? `Mission geschafft – ${state.missionStars} von 3 Sternen.` : 'Alle anderen Städte wurden erobert.';
  if (ctx.mode === 'bot') text = (winner === 'player_1' ? 'Du hast gewonnen. ' : 'Die KI hat gewonnen. ') + text;
  else if (ctx.mode === 'online') text = (winner === ctx.myRole ? 'Du hast gewonnen. ' : 'Dein Gegner hat gewonnen. ') + text;
  $('winner-text').textContent = text + ` · Runde ${state.round}`;
  $('winnerEasier').classList.add('hidden');
  $('winnerHarder').classList.add('hidden');
  $('winnerRetry').classList.toggle('hidden', ctx.mode !== 'bot');
  $('winner-stats').innerHTML = statsHtml(state, ctx);
  $('winner-overlay').classList.remove('hidden');
}

// Nach drei Siegen in Folge auf einer Stufe: schwerere Stufe anbieten.
export function offerHarder(level, label) {
  const b = $('winnerHarder');
  b.textContent = `Drei Siege in Folge – nächstes Spiel auf ${label}`;
  b.dataset.level = level;
  b.classList.remove('hidden');
}

const TIPS = [
  'Lass keine Stadt leer stehen: Eine Einheit darin verteidigt mit Bonus, leere Städte werden im Vorbeigehen erobert.',
  'Bogenschützen und Schiffe greifen aus 2 Feldern an – Nahkämpfer können dann nicht zurückschlagen.',
  'Nimm früh neutrale Dörfer ein: Mehr Städte bedeuten mehr Sterne pro Runde.',
  'Verschanze verletzte Einheiten in Städten: Dort heilen sie 4 Leben pro Runde.',
  'Ein roter Ring um eine Stadt heißt: Ein Gegner kann sie im nächsten Zug angreifen. Stell rechtzeitig einen Verteidiger hinein.',
  'Erforsche „Schildmacher“ für Verteidiger – sie halten Städte sehr gut.',
  'Wähle bei Stufe 3 die Stadtmauer, wenn Gegner in der Nähe sind: Verteidiger bekommen dann 4-fache Verteidigung.',
  'Greif nicht an, wenn die Vorschau mehr Gegenschlag als Schaden zeigt – warte lieber auf Verstärkung.'
];

// Nachrichten in Online-Partien.
export function setChat({ visible, open, items = [], unread = 0, nameOf, colorOf, me }) {
  $('chatBtn').classList.toggle('hidden', !visible);
  $('chatBadge').classList.toggle('hidden', !unread);
  $('chatBadge').textContent = unread > 9 ? '9+' : String(unread);
  const box = $('chat');
  box.classList.toggle('hidden', !visible || !open);
  if (!visible || !open) return;
  const list = $('chatList');
  const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
  list.innerHTML = items.length ? items.map(m => `<li class="${m.role === me ? 'mine' : ''}"><span class="dot" style="background:${colorOf(m.role)}"></span><b>${esc(nameOf(m.role))}</b> ${esc(m.text)}</li>`).join('')
    : '<li class="chat-empty">Noch keine Nachrichten. Schreib etwas oder nimm eine Kurzantwort.</li>';
  if (atEnd || unread) list.scrollTop = list.scrollHeight;
}

export function clearChatInput() { $('chatInput').value = ''; }

// KI-Lehrling: Vorschlag mit Erklärung, Ausführen oder Schließen.
export function showCoach(hint, onRun, onClose) {
  const box = $('coach');
  if (!hint) { box.classList.add('hidden'); return; }
  box.innerHTML = `<div class="co-head">Tipp der KI</div><div class="co-text">${esc(hint.text)}</div>${hint.why ? `<div class="co-why">${esc(hint.why)}</div>` : ''}
    <div class="co-acts">${hint.runnable ? '<button class="btn primary small" data-co-run>Ausführen</button>' : ''}<button class="btn ghost small" data-co-close>Schließen</button></div>`;
  box.classList.remove('hidden');
  box.querySelector('[data-co-run]')?.addEventListener('click', onRun);
  box.querySelector('[data-co-close]').addEventListener('click', onClose);
}

// Wiederholung: Regler, Abspielen/Anhalten, Tempo.
export function setReplay(info) {
  const bar = $('replay-bar');
  if (!info) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const slider = $('rpSlider');
  slider.max = String(info.count - 1);
  slider.value = String(info.index);
  $('rpLabel').textContent = `Runde ${info.round}${info.index === info.count - 1 ? ' (Ende)' : ''}`;
  $('rpPlay').textContent = info.playing ? 'Anhalten' : info.index === info.count - 1 ? 'Von vorn abspielen' : 'Abspielen';
  bar.querySelectorAll('[data-rpspeed]').forEach(b => b.classList.toggle('active', Number(b.dataset.rpspeed) === info.speed));
}

export function setReview(on) {
  $('review-bar').classList.toggle('hidden', !on);
  if (on) $('winner-overlay').classList.add('hidden');
}

export function showDefeat(state, ctx, opts = {}) {
  const me = 'player_1';
  const b = scoreBreakdown(state, me);
  const kills = (state.killsBy && state.killsBy[me]) || 0;
  const peak = Math.max(b.cities, (state.peak && state.peak[me]) || 0);
  const monuments = ((state.monumentsBuilt && state.monumentsBuilt[me]) || []).length;
  const best = Math.max(0, ...(state.history || []).map(h => h.scores[me] || 0));
  const done = [
    `${state.round} ${state.round === 1 ? "Runde" : "Runden"} durchgehalten`,
    `bis zu ${peak} ${peak === 1 ? 'Stadt' : 'Städte'}`,
    kills ? `${kills} Gegner besiegt` : null,
    b.techs ? `${b.techs} Technologien` : null,
    b.ruins ? `${b.ruins} Ruinen erkundet` : null,
    b.lighthouses ? `${b.lighthouses} Leuchttürme` : null,
    monuments ? `${monuments} Monumente` : null,
    best ? `Bestwert ${best} Punkte` : null
  ].filter(Boolean);
  $('winner-title').textContent = 'Diesmal hat es nicht gereicht';
  $('winner-text').innerHTML = `<div class="achieve">${done.map(d => `<span>${esc(d)}</span>`).join('')}</div>
    <p class="tip"><b>Tipp:</b> ${esc(TIPS[(state.round + kills) % TIPS.length])}</p>`;
  $('winner-stats').innerHTML = statsHtml(state, ctx || {});
  $('winnerEasier').classList.toggle('hidden', !opts.easier);
  $('winnerRetry').classList.toggle('hidden', !opts.retry);
  $('winner-overlay').classList.remove('hidden');
}

function playerLabel(state, p) {
  return tribeName(state, p) || NAMES[p];
}

function statsHtml(state, ctx) {
  const me = ctx.mode === 'online' ? ctx.myRole : ctx.mode === 'bot' ? 'player_1' : null;
  const rows = ranking(state).map(({ player }, i) => {
    const b = scoreBreakdown(state, player);
    const sc = state.finalScores ? state.finalScores[player] : b.score;
    return `<tr class="${player === me ? 'me' : ''}">
      <td class="num">${i + 1}.</td>
      <td><span class="dot" style="background:${hex(playerColor(state, player))}"></span>${playerLabel(state, player)}${player === me ? ' (du)' : ''}</td>
      <td class="num">${sc}</td><td class="num">${b.cities}</td><td class="num">${b.pop}</td>
      <td class="num">${b.techs}</td><td class="num">${b.units}</td><td class="num">${b.ruins}</td><td class="num">${b.lighthouses}</td>
    </tr>`;
  }).join('');
  return `${chartSvg(state)}
    <div class="stats-scroll"><table class="stats-table">
      <thead><tr><th class="num">#</th><th>Stamm</th><th class="num">Punkte</th><th class="num">Städte</th>
      <th class="num">Bev.</th><th class="num">Techs</th><th class="num">Einh.</th><th class="num">Ruinen</th><th class="num">Leuchtt.</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

// Punkteverlauf als schlichtes Liniendiagramm (eine Linie je Stamm).
function chartSvg(state) {
  const hist = state.history || [];
  if (hist.length < 2) return '';
  const W = 540, H = 180, padL = 40, padR = 12, padT = 12, padB = 24;
  const players = state.players || [];
  const maxY = Math.max(10, ...hist.flatMap(h => players.map(p => h.scores[p] || 0)));
  const r0 = hist[0].round, r1 = hist[hist.length - 1].round;
  const x = r => padL + ((r - r0) / Math.max(1, r1 - r0)) * (W - padL - padR);
  const y = v => padT + (1 - v / maxY) * (H - padT - padB);
  const grid = [0, 0.5, 1].map(f => {
    const v = Math.round(maxY * f);
    return `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--border)" stroke-width="1"/>
      <text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" style="fill:var(--muted)">${v}</text>`;
  }).join('');
  const lines = players.map(p => {
    const pts = hist.map(h => `${x(h.round).toFixed(1)},${y(h.scores[p] || 0).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${hex(playerColor(state, p))}" stroke-width="2" stroke-linejoin="round"/>`;
  }).join('');
  const axis = `<text x="${padL}" y="${H - 6}" font-size="10" style="fill:var(--muted)">Runde ${r0}</text>
    <text x="${W - padR}" y="${H - 6}" font-size="10" style="fill:var(--muted)" text-anchor="end">Runde ${r1}</text>`;
  return `<div class="chart-cap">Punkteverlauf</div>
    <svg class="score-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Punkteverlauf aller Stämme">${grid}${lines}${axis}</svg>`;
}

export function setContinue(info) {
  const btn = $('continueBtn');
  if (!btn) return;
  if (!info) { btn.classList.add('hidden'); return; }
  btn.textContent = `Weiterspielen (${info.label}, Runde ${info.round})`;
  btn.classList.remove('hidden');
}

export function hideWinner() {
  $('winner-overlay').classList.add('hidden');
}

export function showConfirm(text, onYes, opts = {}) {
  $('confirm-text').textContent = text;
  handlers._confirmYes = onYes;
  handlers._confirmNo = opts.onNo || null;
  if (!$('confirmYes').dataset.label) $('confirmYes').dataset.label = $('confirmYes').textContent;
  if (!$('confirmNo').dataset.label) $('confirmNo').dataset.label = $('confirmNo').textContent;
  $('confirmYes').textContent = opts.yes || $('confirmYes').dataset.label;
  $('confirmNo').textContent = opts.no || $('confirmNo').dataset.label;
  $('confirm-overlay').classList.remove('hidden');
}

export function isConfirmOpen() {
  return !$('confirm-overlay').classList.contains('hidden');
}

export function hideConfirm() {
  handlers._confirmYes = null;
  handlers._confirmNo = null;
  $('confirm-overlay').classList.add('hidden');
}

const fmtMp = n => String(n).replace('.', ',');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function unitStatus(u, actAs) {
  if (u.owner !== actAs) return 'fremd';
  if (u.acted && u.mp <= 0) return 'erledigt';
  return 'aktiv';
}

// Übersicht mit Reitern: Städte, Armee, Diplomatie, Monumente.
let overviewTab = 'staedte';
export function showOverview(state, ctx) {
  const actAs = ctx.actAs;
  const menu = $('overview-list');
  const myCities = state.cities.filter(c => c.owner === actAs);
  const myUnits = state.units.filter(u => u.owner === actAs);
  const built = (state.monumentsBuilt && state.monumentsBuilt[actAs]) || [];
  const unlocked = (state.monumentsUnlocked && state.monumentsUnlocked[actAs]) || [];
  const others = playersOf(state).filter(p => p !== actAs && alive(state, p));
  const perk = tribeOf(state, actAs)?.perk;
  const tabs = [['staedte', `Städte ${myCities.length}`], ['armee', `Armee ${myUnits.length}`], ['diplomatie', 'Diplomatie'], ['monumente', `Monumente ${built.length}/${Object.keys(MONUMENTS).length}`]];
  if (!tabs.some(t => t[0] === overviewTab)) overviewTab = 'staedte';

  let body = '';
  if (overviewTab === 'staedte') {
    const threatened = new Set(ctx.myTurn ? threatenedCities(state, actAs).map(c => c.q + ',' + c.r) : []);
    body = myCities.length ? `<table class="ov-table"><thead><tr><th>Stadt</th><th>Stufe</th><th class="num">Einkommen</th><th class="num">Felder</th><th>Jetzt</th></tr></thead><tbody>${myCities.map(c => {
      const todo = [];
      if (pendingLevel(c)) todo.push('<span class="ov-tag good">Belohnung wählen</span>');
      if (threatened.has(c.q + ',' + c.r)) todo.push('<span class="ov-tag bad">bedroht</span>');
      if (ctx.myTurn && UNIT_ORDER.some(t => !UNITS[t].reward && canTrain(state, c, t, actAs).ok)) todo.push('<span class="ov-tag">kann ausbilden</span>');
      return `<tr data-city="${c.q},${c.r}" tabindex="0"><td><b>${c.isCapital ? 'Hauptstadt' : 'Stadt'}</b></td>
        <td><span class="ov-hexes" aria-label="Stufe ${c.pop}">${Array.from({ length: MAX_POP }, (_, i) => `<span class="${i < c.pop ? 'on' : ''}"></span>`).join('')}</span></td>
        <td class="num ov-inc">+${cityIncome(state, c)}</td><td class="num">${cityTiles(state, c).length}</td><td>${todo.join(' ') || '<span class="ov-none">–</span>'}</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="hint">Du besitzt keine Städte.</div>';
  } else if (overviewTab === 'armee') {
    const order = u => (unitStatus(u, actAs) === 'aktiv' ? 0 : 1);
    body = myUnits.length ? `<table class="ov-table"><thead><tr><th>Einheit</th><th>Werte</th><th>Status</th></tr></thead><tbody>${myUnits.slice().sort((a, b) => order(a) - order(b)).map(u => {
      const def = UNITS[u.type];
      const st = unitStatus(u, actAs);
      return `<tr data-unit="${u.id}" tabindex="0" class="${st === 'aktiv' ? '' : 'ov-dim'}"><td><b>${def.name}</b>${u.vet ? ' <span class="ov-tag good">Veteran</span>' : ''}</td>
        <td><span class="ov-stats">${stat('heart', `${u.hp}/${hpCap(u)}`)}${stat('sword', attackOf(state, u))}${stat('shield', defenseOf(state, u))}</span></td>
        <td>${st === 'aktiv' ? '<span class="ov-tag">bereit</span>' : esc(st)}</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="hint">Du hast keine Einheiten.</div>';
  } else if (overviewTab === 'diplomatie') {
    body = others.length ? others.map(p => {
      const met = hasMet(state, actAs, p);
      const peace = atPeace(state, actAs, p);
      const name = met ? (tribeName(state, p) || NAMES[p]) : 'Unbekannter Stamm';
      let status = !met ? 'noch nicht begegnet' : peace ? 'Frieden' : 'Krieg';
      const persona = met && state.persona && state.persona[p] && PERSONAS[state.persona[p]];
      if (persona) status = `${persona.name}, ${status}`;
      if (pendingOffer(state, actAs, p)) status += ', Angebot gesendet';
      let action = '';
      if (met && ctx.myTurn) {
        if (peace) action = `<button class="btn ghost small" data-war="${p}">Krieg erklären</button>`;
        else {
          const chk = canOfferPeace(state, actAs, p);
          action = `<button class="btn ghost small" data-peace="${p}" ${chk.ok ? '' : 'disabled'} title="${esc(chk.reason || 'Frieden anbieten')}">Frieden anbieten</button>`;
          if (!chk.ok) status += `, ${chk.reason}`;
        }
      }
      return `<div class="dip-row"><span><span class="dip-name"><span class="dot" style="background:${met ? hex(playerColor(state, p)) : 'var(--faint)'}"></span>${esc(name)}</span>
        <span class="dip-state ${peace ? 'peace' : ''}">${esc(status)}</span></span>${action}</div>`;
    }).join('') : '<div class="hint">Keine anderen Stämme mehr im Spiel.</div>';
  } else {
    body = `<div class="ov-mons">${Object.entries(MONUMENTS).map(([id, m]) => {
      const [have, need] = monumentProgress(state, actAs, id);
      const done = built.includes(id), ready = unlocked.includes(id) && !done;
      const label = done ? 'errichtet' : ready ? 'bereit – über Ausbauen in einer Stadt errichten' : `${Math.min(have, need)} von ${need}: ${m.goal}`;
      return `<div class="ov-mon ${done ? 'done' : ready ? 'ready' : ''}"><b>${IMPROVEMENTS[id].name}</b>
        <span class="ov-bar"><span style="width:${done || ready ? 100 : Math.round(Math.min(1, have / need) * 100)}%"></span></span>
        <span class="ov-mon-sub">${esc(label)}</span></div>`;
    }).join('')}</div><div class="hint">Jedes Monument bringt der Stadt +3 Bevölkerung und 200 Punkte.</div>`;
  }

  menu.innerHTML = `
    <div class="ov-sum">
      <div class="stat">Sterne<b>${state.stars[actAs]}</b></div>
      <div class="stat">Einkommen<b>+${incomeFor(state, actAs)}</b></div>
      <div class="stat">Runde<b>${state.round}${state.turnLimit ? '/' + state.turnLimit : ''}</b></div>
      <div class="stat">Punkte<b>${score(state, actAs)}</b></div>
    </div>
    ${perk ? `<div class="hint ov-perk"><b>${esc(perk.name)}:</b> ${esc(perk.desc)}</div>` : ''}
    ${ctx.hasReport ? '<button class="btn ghost small ov-report" data-report>Letzten Rundenbericht zeigen (B)</button>' : ''}
    <div class="ov-tabs" role="tablist">${tabs.map(([id, label]) => `<button class="ov-tab${id === overviewTab ? ' active' : ''}" role="tab" aria-selected="${id === overviewTab}" data-ovtab="${id}">${label}</button>`).join('')}</div>
    <div class="ov-body">${body}</div>`;
  menu.querySelectorAll('[data-ovtab]').forEach(b => b.addEventListener('click', () => { overviewTab = b.dataset.ovtab; showOverview(state, ctx); }));
  menu.querySelector('[data-report]')?.addEventListener('click', () => handlers.onShowReport());
  const go = (el, fn) => { el.addEventListener('click', fn); el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } }); };
  menu.querySelectorAll('[data-city]').forEach(tr => go(tr, () => { const [q, r] = tr.dataset.city.split(',').map(Number); handlers.onFocusCity(q, r); }));
  menu.querySelectorAll('[data-unit]').forEach(tr => go(tr, () => handlers.onFocusUnit(tr.dataset.unit)));
  menu.querySelectorAll('[data-peace]').forEach(b => b.addEventListener('click', () => handlers.onOfferPeace(b.dataset.peace)));
  menu.querySelectorAll('[data-war]').forEach(b => b.addEventListener('click', () => handlers.onDeclareWar(b.dataset.war)));
  $('overview-overlay').classList.remove('hidden');
}

export function hideOverview() {
  $('overview-overlay').classList.add('hidden');
}
