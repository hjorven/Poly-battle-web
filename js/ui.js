import {
  UNITS, UNIT_ORDER, TECHS, NAMES, MAX_POP,
  TRIBES, TRIBE_POOL, ABILITY_INFO, TERRAIN, RESOURCES, IMPROVEMENTS, STARS_OPTIONS, MONUMENTS, ROAD,
  CITY_REWARDS, GAME_MODES, BRIDGE, MAP_SIZES, MAP_TYPES
} from './config.js';
import {
  cityIncome, techCost, tribeName, playerColor, maxHp, maxMove, attackOf, popCost, monumentReady, canBuildRoad, roadAt,
  terrainAt, defenceBonus, attackPreview, canImprove, resourceAt, improvementAt, cityTiles, canBuyPop,
  canAttackNow, canFound, canTrain, pendingLevel, rewardOptions, score, scoreBreakdown, ranking,
  bridgeOptions, canBuildBridge, destroyableBridges, disbandRefund, unitOptions, cityView, canRegenerate,
  hpCap, unitCost, tribeOf, cityAt, unitAt, cityPorts, loadOptions, unloadOptions, upgradeOption, improvementCost, defenseOf, players as playersOf, alive, atPeace, hasMet, canOfferPeace, pendingOffer
} from './rules.js';
import { DIRS } from './hex.js';

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
      ' ': 'next', Enter: 'end', t: 'tech', o: 'overview', i: 'details', h: 'home', m: 'sound',
      Escape: 'deselect', ArrowLeft: 'panL', ArrowRight: 'panR', ArrowUp: 'panU', ArrowDown: 'panD',
      '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut'
    };
    const action = keys[e.key] || keys[e.key.toLowerCase()];
    if (!action || e.target.closest && e.target.closest('button, select') && (action === 'next' || action === 'end')) return;
    e.preventDefault();
    handlers.onHotkey(action);
  });
  $('menuBtn').addEventListener('click', () => handlers.onMenu());
  $('winnerRestart').addEventListener('click', () => handlers.onRestart());
  $('winnerEasier').addEventListener('click', () => handlers.onRetry(true));
  $('winnerMap').addEventListener('click', () => handlers.onReview(true));
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

function buildSettings() {
  const wrap = $('settings-box');
  if (!wrap) return;
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
  wrap.innerHTML = '';
  for (const id of TRIBE_POOL) {
    const t = TRIBES[id];
    const startTech = t.startTechs.length
      ? t.startTechs.map(x => TECHS[x].name).join(', ')
      : `keine Tech (+${t.bonusStars} Sterne)`;
    const startUnits = t.startUnits.map(u => UNITS[u].name).join(', ');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tribe-opt';
    btn.dataset.tribe = id;
    btn.innerHTML = `<span class="tribe-name"><span class="dot" style="background:${hex(t.color)}"></span>${t.name}</span>
      <span class="tribe-tech">Start: ${startTech} · ${startUnits}</span>
      ${t.perk ? `<span class="tribe-perk">${STAR_ICON} ${t.perk.name}: ${t.perk.desc}</span>` : ''}`;
    btn.addEventListener('click', () => {
      selectedTribe = selectedTribe === id ? null : id;
      wrap.querySelectorAll('.tribe-opt').forEach(b => b.classList.toggle('active', b.dataset.tribe === selectedTribe));
    });
    wrap.appendChild(btn);
  }
  if (selectedTribe) {
    wrap.querySelectorAll('.tribe-opt').forEach(b => b.classList.toggle('active', b.dataset.tribe === selectedTribe));
  }
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
  return `<div class="chip ${active ? 'active' : ''}">
    <span class="dot" style="background:${hex(playerColor(state, player))}"></span>
    <span>${name}${ctx.mode === 'online' && me ? ' (du)' : ''}</span>
    <span class="stars">${s} Sterne</span>
    ${state.turnLimit ? `<span class="pts">${score(state, player)} P</span>` : ''}
    <span class="meta">${cities} ${cities === 1 ? 'Stadt' : 'Städte'} · ${units} ${units === 1 ? 'Einheit' : 'Einheiten'}</span>
  </div>`;
}

export function updateStrip(state, ctx) {
  const players = state.players && state.players.length ? state.players : ['player_1', 'player_2'];
  // Besiegte Stämme ans Ende.
  const order = [...players.filter(p => state.cities.some(c => c.owner === p)), ...players.filter(p => !state.cities.some(c => c.owner === p))];
  $('player-strip').innerHTML = order.map(p => chip(p, state, ctx)).join('');
  $('round-label').textContent = 'Runde ' + state.round + (state.turnLimit ? ' / ' + state.turnLimit : '');
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

export function renderProfile(profile, lp, daily, achievements) {
  const winRate = profile.games ? Math.round(100 * profile.wins / profile.games) : 0;
  $('profile-card').innerHTML = `<div class="pc-level">${lp.level}</div>
    <div><span class="pc-title">${esc(lp.title)}</span> <span class="pc-sub">· Stufe ${lp.level} · ${lp.into}/${lp.need} Erfahrung</span></div>
    <div class="pc-sub">${profile.games} ${profile.games === 1 ? 'Spiel' : 'Spiele'} · ${profile.wins} ${profile.wins === 1 ? 'Sieg' : 'Siege'}${profile.games ? ` (${winRate} %)` : ''}${profile.winStreak > 1 ? ` · ${profile.winStreak} Siege in Folge` : ''}${profile.daily.streak ? ` · Tagesserie ${profile.daily.streak}` : ''}</div>
    <div class="xp-bar"><div style="width:${Math.round(lp.frac * 100)}%"></div></div>`;
  const best = profile.daily.best[daily.key];
  const tribe = TRIBES[daily.tribe] ? TRIBES[daily.tribe].name : daily.tribe;
  $('dailyBtn').innerHTML = `Tagesherausforderung ${fmtDate(daily.key)}<span class="sub">${esc(tribe)} · ${esc(MAP_TYPES[daily.mapType].label)} · 30 Runden · ${best != null ? `dein Bestwert: ${best} Punkte` : 'heute noch nicht gespielt'}</span>`;
  const ids = Object.keys(achievements);
  const got = ids.filter(id => profile.achievements[id]);
  $('achievements-title').textContent = `Erfolge (${got.length}/${ids.length})`;
  $('achievements').innerHTML = ids.map(id => `<div class="ach ${profile.achievements[id] ? 'got' : ''}"><b>${esc(achievements[id].name)}</b>${esc(achievements[id].desc)}</div>`).join('');
}

// Ergebnis für das Profil auf dem Endbildschirm.
export function showProfileResult(res, lp, achievements) {
  const box = $('winner-profile');
  if (!res) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="wp-xp"><span>+${res.gain} Erfahrung</span>
      <span class="${res.levelAfter > res.levelBefore ? 'wp-up' : ''}">${res.levelAfter > res.levelBefore ? `Aufgestiegen: Stufe ${lp.level} – ${esc(lp.title)}!` : `Stufe ${lp.level} · ${lp.into}/${lp.need}`}</span></div>
    <div class="xp-bar"><div style="width:${Math.round(lp.frac * 100)}%"></div></div>
    ${res.achievements.length ? `<div class="wp-ach">${res.achievements.map(id => `<span>Erfolg: ${esc(achievements[id].name)}</span>`).join('')}</div>` : ''}
    ${res.daily ? `<div class="wp-daily">Tagesherausforderung ${fmtDate(res.daily.key)}: ${res.daily.score} Punkte${res.daily.improved ? ' – neuer Bestwert!' : ` (Bestwert ${res.daily.best})`} · Tagesserie ${res.daily.streak}</div>` : ''}`;
}

// Rückblick: Liste {text, q?, r?}; antippen springt zum Ort.
export function showNews(lines) {
  const box = $('news');
  const shown = lines.slice(0, 7);
  box.innerHTML = `<h3>Seit deinem letzten Zug</h3><ul>${shown.map((l, i) =>
    `<li><button data-news="${i}" ${l.q == null ? 'tabindex="-1"' : ''}>${esc(l.text)}</button></li>`).join('')}</ul>
    ${lines.length > shown.length ? `<div class="news-more">und ${lines.length - shown.length} weitere</div>` : ''}
    <button class="btn small" data-news-close>OK</button>`;
  box.querySelectorAll('[data-news]').forEach(b => b.addEventListener('click', () => {
    const l = shown[Number(b.dataset.news)];
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
}

function panel(html) {
  const p = $('panel');
  p.innerHTML = html;
  p.classList.remove('hidden');
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
  const chip = $('unit-chip');
  const def = UNITS[unit.carry || unit.type];
  const mine = unit.owner === ctx.actAs;
  const opts = mine && ctx.myTurn ? unitOptions(state, unit) : [];
  const status = !mine ? (tribeName(state, unit.owner) || NAMES[unit.owner])
    : opts.length ? 'kann noch: ' + opts.join(', ') : 'erledigt';
  chip.innerHTML = `
    <span class="dot" style="background:${hex(playerColor(state, unit.owner))}"></span>
    <span class="uc-main"><b>${def.name}${unit.carry ? ' (Boot)' : ''}${unit.vet ? ' ' + STAR_ICON : ''}</b>
      <span class="uc-sub">Leben ${unit.hp}/${hpCap(unit)} · Bewegung ${fmtMp(unit.mp)}/${maxMove(state, unit.owner, unit.type)} · ${esc(status)}</span></span>
    <button class="btn ghost small" data-details>Details</button>`;
  chip.querySelector('[data-details]').addEventListener('click', () => handlers.onUnitDetails());
  chip.classList.remove('hidden');
}

export function hideUnitChip() {
  $('unit-chip').classList.add('hidden');
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
          <span>Straße bauen<span class="sub">${spent ? 'Keine Bewegung mehr' : chk.ok ? 'Auf diesem Feld · verbraucht die restliche Bewegung' : chk.reason}</span></span>
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
        <div class="panel-title">${land ? `${land.name} (eingeschifft)` : def.name}${unit.vet ? ' <span class="vet-badge">${STAR_ICON} Veteran</span>' : ''}</div>
        <div class="panel-sub" style="color:${hex(playerColor(state, unit.owner))}">${owner}${mine ? ' (deine Einheit)' : ''}</div>
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
  return `<div class="action-list"><button class="btn action ghost" data-open-unit="${u.id}"><span>${mine ? 'Einheit auswählen' : 'Einheit ansehen'}: ${def.name}<span class="sub">Steht in der Stadt${mine ? ' – ziehen, angreifen, auflösen' : ''}</span></span></button></div>`;
}

export function showCityPanel(state, city, ctx) {
  // Fremde Städte außer Sicht nur so zeigen, wie man sie zuletzt gesehen hat.
  const view = cityView(state, ctx.viewer, city);
  if (view && !view.live) return showRememberedCity(state, view);
  const mine = city.owner === ctx.actAs && ctx.myTurn;
  const ownerName = city.owner ? (tribeName(state, city.owner) || NAMES[city.owner]) : 'Neutral';
  const income = city.owner ? cityIncome(state, city) : 0;
  const occupied = state.units.some(u => u.q === city.q && u.r === city.r);

  const cells = cityTiles(state, city).map(([q, r]) => {
    const tdef = TERRAIN[terrainAt(state, q, r)];
    const imp = improvementAt(state, q, r);
    const res = resourceAt(state, q, r);
    let tag = tdef.name, cls = '';
    if (imp) { tag = IMPROVEMENTS[imp].name; cls = 'built'; }
    if (roadAt(state, q, r)) tag += ' + Straße';
    else if (res) { tag = RESOURCES[res].name; cls = 'res'; }
    return `<span class="tile-chip ${cls}">${tag}</span>`;
  }).join('');

  let actions = '';
  if (city.owner && city.owner === ctx.actAs) {
    const unlocked = UNIT_ORDER.filter(t => {
      const u = UNITS[t];
      if (u.reward) return false;
      if (u.tech && !state.techs[city.owner].includes(u.tech)) return false;
      return true;
    });
    const lvl = pendingLevel(city);
    if (lvl && mine) {
      actions += `<div class="action-list"><button class="btn primary action" data-reward-open>
        <span>Stufe ${lvl} erreicht<span class="sub" style="color:#d4d4d8">Belohnung auswählen</span></span></button></div>`;
    }
    actions += `<div class="panel-head" style="margin-top:12px"><div class="panel-sub">Einheiten ausbilden</div></div><div class="action-list">`;
    for (const t of unlocked) {
      const u = UNITS[t];
      const reason = trainReason(state, city, t, ctx);
      actions += `<button class="btn action" data-train="${t}" ${reason ? 'disabled' : ''}>
        <span>${u.name}<span class="sub">${reason || `Angriff ${attackOf(state, { type: t, owner: city.owner })} · Verteidigung ${u.def} · Bewegung ${maxMove(state, city.owner, t)} · Reichweite ${u.range} · Leben ${u.hp}`}</span></span>
        <span class="cost">${unitCost(state, city.owner, t)} Sterne</span>
      </button>`;
    }
    actions += `</div>`;
    const popReason = popReasonFor(state, city, ctx);
    actions += `<div class="action-list"><button class="btn action ghost" data-buypop ${popReason ? 'disabled' : ''}>
      <span>Bevölkerung +1<span class="sub">Mehr Sterne pro Runde, neue Stufe mit Belohnung (max ${MAX_POP})</span></span>
      <span class="cost">${popCost(city, state)} Sterne</span>
    </button></div>`;
    if (city.trained) actions += `<div class="hint">Diese Stadt hat diese Runde schon eine Landeinheit ausgebildet${cityPorts(state, city).length && !city.trainedShip ? ' – ein Schiff geht noch' : ''}.</div>`;
    else if (city.trainedShip) actions += `<div class="hint">Schiff gebaut – eine Landeinheit geht diese Runde noch.</div>`;
    if (occupied) actions += `<div class="hint">Einheit in der Stadt – zum Ausbilden zuerst wegziehen.</div>`;
    actions += buildRows(state, city, ctx);
  }

  panel(`
    <div class="panel-head">
      <div>
        <div class="panel-title">Stadt${city.isCapital ? ' · Hauptstadt' : ''}</div>
        <div class="panel-sub" style="color:${city.owner ? hex(playerColor(state, city.owner)) : '#71717a'}">${ownerName}</div>
      </div>
      <div class="panel-head-right">
        <span class="panel-sub">${city.pop >= MAX_POP ? 'max. Bev.' : ''}</span>
        <button class="btn icon-btn panel-close" data-close>Schließen</button>
      </div>
    </div>
    <div class="stat-row">
      <div class="stat">Stufe<b>${city.pop}/${MAX_POP}</b></div>
      <div class="stat">Einkommen<b>${income}/Runde</b></div>
      <div class="stat">Gebiete<b>${cityTiles(state, city).length}</b></div>
    </div>
    ${levelChips(city)}
    ${switchToUnit(state, city, ctx)}
    <div class="tile-grid">${cells}</div>
    ${actions || (!city.owner ? '<div class="hint">Neutrale Stadt – rücke mit einer Einheit hinein, um sie zu erobern.</div>'
      : city.owner !== ctx.actAs ? '<div class="hint">Feindliche Stadt – besiege die Verteidiger und rücke ein, um sie zu erobern.</div>'
      : '<div class="hint">Nicht dein Zug.</div>')}
  `);
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
  $('panel').querySelectorAll('[data-buildroad]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [q, r] = btn.dataset.buildroad.split(',').map(Number);
      handlers.onBuildRoad(q, r, null);
    });
  });
  $('panel').querySelectorAll('[data-improve]').forEach(btn => {
    btn.addEventListener('click', () => handlers.onImprove(city, btn.dataset.improve, Number(btn.dataset.q), Number(btn.dataset.r)));
  });
}

function showRememberedCity(state, view) {
  const ownerName = view.owner ? (tribeName(state, view.owner) || NAMES[view.owner]) : 'Neutral';
  panel(`
    <div class="panel-head">
      <div>
        <div class="panel-title">Stadt${view.isCapital ? ' · Hauptstadt' : ''}</div>
        <div class="panel-sub" style="color:${view.owner ? hex(playerColor(state, view.owner)) : '#71717a'}">${ownerName}</div>
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
    `<span class="level-chip" title="${CITY_REWARDS[id].desc}">Stufe ${lvl}: ${CITY_REWARDS[id].name}</span>`).join('')}</div>`;
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

function buildRows(state, city, ctx) {
  const rows = [];
  const roadsKnown = city.owner && state.techs[city.owner].includes(ROAD.tech);
  for (const [q, r] of cityTiles(state, city)) {
    const tile = terrainAt(state, q, r);
    const free = !improvementAt(state, q, r) && !resourceAt(state, q, r);
    const types = free ? Object.keys(IMPROVEMENTS).filter(k => IMPROVEMENTS[k].terrain.includes(tile) &&
      (!IMPROVEMENTS[k].monument || monumentReady(state, city.owner, k))) : [];
    const road = roadsKnown && TERRAIN[tile].walkable && !roadAt(state, q, r);
    if (!types.length && !road) continue;
    const cellName = TERRAIN[tile].name;
    const btns = types.map(t => {
      const d = IMPROVEMENTS[t];
      let reason = '';
      const chk = canImprove(state, city, t, q, r);
      if (!chk.ok) reason = chk.reason;
      else if (d.tech && !state.techs[city.owner].includes(d.tech)) reason = 'Technologie fehlt';
      else if (state.stars[city.owner] < improvementCost(state, city.owner, t)) reason = 'Zu wenig Sterne';
      if (!ctx.myTurn && !reason) reason = 'Nicht dein Zug';
      const locked = !ctx.myTurn;
      return `<button class="btn chip-btn${reason ? ' disabled' : ''}" data-improve="${t}" data-q="${q}" data-r="${r}" ${locked ? 'disabled' : ''} title="${reason || d.name}">${d.name} <span class="cost">${d.monument ? 'frei' : improvementCost(state, city.owner, t)}</span></button>`;
    }).join('') + (road ? (() => {
      const chk = canBuildRoad(state, city.owner, q, r);
      const reason = !ctx.myTurn ? 'Nicht dein Zug' : chk.ok ? '' : chk.reason;
      return `<button class="btn chip-btn${reason ? ' disabled' : ''}" data-buildroad="${q},${r}" ${ctx.myTurn ? '' : 'disabled'} title="${reason || 'Straße: halbe Bewegung'}">Straße <span class="cost">${ROAD.cost}</span></button>`;
    })() : '');
    rows.push(`<div class="build-row"><span class="build-tile">${cellName}</span><span class="build-btns">${btns}</span></div>`);
  }
  if (!rows.length) return '';
  return `<div class="panel-head" style="margin-top:12px"><div class="panel-sub">Gebäude im Stadtgebiet</div></div>${rows.join('')}`;
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
    for (let k = 2; k < 6; k++) rowY.push(rowY[k - 1] + HEX_H + 12);
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
  const fit = portrait ? Math.min(1.1, W / TREE_W) : Math.min(1.2, W / TREE_W, H / TREE_H);
  techNav.home = { scale: fit, tx: (W - TREE_W * fit) / 2, ty: portrait ? 0 : (H - TREE_H * fit) / 2 };
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
    const color = mine.includes(id) ? BRANCH_COLOR[branchOf(id)] : '#d4d4d8';
    lines += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${color}" stroke-width="4" stroke-linecap="round" />`;
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
    btn.innerHTML = `<span class="tn-in"><span class="tn-name">${t.name}</span><span class="tn-cost">${status === 'done' ? CHECK_ICON : techCost(state, id, ctx.actAs) + ' Sterne'}</span></span>`;
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

export function showMenu() {
  $('menu-overlay').classList.remove('hidden');
}

export function hideMenu() {
  $('menu-overlay').classList.add('hidden');
}

export function showWinner(state, ctx) {
  const winner = state.winner;
  $('winner-title').textContent = (tribeName(state, winner) || NAMES[winner]) + ' gewinnt!';
  let text = state.endReason === 'score' ? 'Höchste Punktzahl nach ' + state.turnLimit + ' Runden.' : 'Alle anderen Städte wurden erobert.';
  if (ctx.mode === 'bot') text = (winner === 'player_1' ? 'Du hast gewonnen. ' : 'Die KI hat gewonnen. ') + text;
  else if (ctx.mode === 'online') text = (winner === ctx.myRole ? 'Du hast gewonnen. ' : 'Dein Gegner hat gewonnen. ') + text;
  $('winner-text').textContent = text + ` · Runde ${state.round}`;
  $('winnerEasier').classList.add('hidden');
  $('winnerRetry').classList.toggle('hidden', ctx.mode !== 'bot');
  $('winner-stats').innerHTML = statsHtml(state, ctx);
  $('winner-overlay').classList.remove('hidden');
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
    return `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="#e4e4e7" stroke-width="1"/>
      <text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#71717a">${v}</text>`;
  }).join('');
  const lines = players.map(p => {
    const pts = hist.map(h => `${x(h.round).toFixed(1)},${y(h.scores[p] || 0).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${hex(playerColor(state, p))}" stroke-width="2" stroke-linejoin="round"/>`;
  }).join('');
  const axis = `<text x="${padL}" y="${H - 6}" font-size="10" fill="#71717a">Runde ${r0}</text>
    <text x="${W - padR}" y="${H - 6}" font-size="10" fill="#71717a" text-anchor="end">Runde ${r1}</text>`;
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

export function showOverview(state, ctx) {
  const actAs = ctx.actAs;
  const menu = $('overview-list');
  menu.innerHTML = '';
  const myCities = state.cities.filter(c => c.owner === actAs);
  const myUnits = state.units.filter(u => u.owner === actAs);

  const stat = document.createElement('div');
  stat.className = 'overview-stat';
  stat.innerHTML = `<div class="panel-head"><div class="panel-title">Übersicht</div></div>
    <div class="stat-row">
      <div class="stat">Städte<b>${myCities.length}</b></div>
      <div class="stat">Einheiten<b>${myUnits.length}</b></div>
      <div class="stat">Sterne<b>${state.stars[actAs]}</b></div>
      <div class="stat">Runde<b>${state.round}${state.turnLimit ? '/' + state.turnLimit : ''}</b></div>
      <div class="stat">Punkte<b>${score(state, actAs)}</b></div>
    </div>`;
  menu.appendChild(stat);

  // Monumente: Erfolg, Status (offen / bereit / errichtet).
  const unlocked = (state.monumentsUnlocked && state.monumentsUnlocked[actAs]) || [];
  const built = (state.monumentsBuilt && state.monumentsBuilt[actAs]) || [];
  const mon = document.createElement('div');
  mon.innerHTML = `<div class="panel-head" style="margin-top:12px"><div class="panel-sub">Monumente (${built.length}/${Object.keys(MONUMENTS).length})</div></div>
    <div class="monument-list">${Object.entries(MONUMENTS).map(([id, m]) => {
      const st = built.includes(id) ? 'errichtet' : unlocked.includes(id) ? 'bereit – im Stadtmenü errichten' : m.goal;
      const cls = built.includes(id) ? 'done' : unlocked.includes(id) ? 'ready' : '';
      return `<div class="monument ${cls}"><span class="mon-dot" style="background:#${m.color.toString(16).padStart(6, '0')}"></span><b>${IMPROVEMENTS[id].name}</b><span class="sub">${esc(st)}</span></div>`;
    }).join('')}</div>`;
  menu.appendChild(mon);

  if (myCities.length) {
    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = `<div class="panel-sub">Städte (${myCities.length})</div>`;
    menu.appendChild(head);
    for (const c of myCities) {
      const row = document.createElement('button');
      row.className = 'btn action overview-row';
      row.innerHTML = `<span>${c.isCapital ? 'Hauptstadt' : 'Stadt'} (${cityTiles(state, c).length} Gebiete)<span class="sub">Bevölkerung ${c.pop} · +${cityIncome(state, c)}/Runde</span></span>`;
      row.addEventListener('click', () => handlers.onFocusCity(c.q, c.r));
      menu.appendChild(row);
    }
  }

  if (myUnits.length) {
    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = `<div class="panel-sub">Einheiten (${myUnits.length})</div>`;
    menu.appendChild(head);
    for (const u of myUnits) {
      const def = UNITS[u.type];
      const st = unitStatus(u, actAs);
      const cap = hpCap(u);
      const row = document.createElement('button');
      row.className = 'btn action overview-row' + (st === 'aktiv' ? '' : ' dimmed');
      row.innerHTML = `<span>${def.name}<span class="sub">${st === 'aktiv' ? 'bereit' : st} · Leben ${u.hp}/${cap}</span></span>`;
      row.addEventListener('click', () => handlers.onFocusUnit(u.id));
      menu.appendChild(row);
    }
  }

  const perk = tribeOf(state, actAs)?.perk;
  if (perk) {
    const p = document.createElement('div');
    p.className = 'hint';
    p.innerHTML = `<b>Stammes-Fähigkeit – ${perk.name}:</b> ${perk.desc}`;
    menu.insertBefore(p, menu.children[1] || null);
  }

  const others = playersOf(state).filter(p => p !== actAs && alive(state, p));
  if (others.length) {
    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = `<div class="panel-sub">Diplomatie</div>`;
    menu.appendChild(head);
    for (const p of others) {
      const row = document.createElement('div');
      row.className = 'dip-row';
      const met = hasMet(state, actAs, p);
      const peace = atPeace(state, actAs, p);
      const name = met ? (tribeName(state, p) || NAMES[p]) : 'Unbekannter Stamm';
      let status = !met ? 'noch nicht begegnet' : peace ? 'Frieden' : 'Krieg';
      if (pendingOffer(state, actAs, p)) status += ' · Angebot gesendet';
      let action = '';
      if (met && ctx.myTurn) {
        if (peace) action = `<button class="btn ghost" data-war="${p}">Krieg erklären</button>`;
        else {
          const chk = canOfferPeace(state, actAs, p);
          action = `<button class="btn ghost" data-peace="${p}" ${chk.ok ? '' : 'disabled'} title="${esc(chk.reason || 'Frieden anbieten')}">Frieden anbieten</button>`;
          if (!chk.ok) status += ` · ${chk.reason}`;
        }
      }
      row.innerHTML = `<span><span class="dip-name"><span class="dot" style="background:${met ? hex(playerColor(state, p)) : '#a1a1aa'}"></span>${esc(name)}</span>
        <span class="dip-state ${peace ? 'peace' : ''}">${esc(status)}</span></span>${action}`;
      row.querySelector('[data-peace]')?.addEventListener('click', () => handlers.onOfferPeace(p));
      row.querySelector('[data-war]')?.addEventListener('click', () => handlers.onDeclareWar(p));
      menu.appendChild(row);
    }
  }

  if (!myCities.length && !myUnits.length) {
    menu.insertAdjacentHTML('beforeend', `<div class="hint">Du besitzt keine Städte oder Einheiten.</div>`);
  }
  $('overview-overlay').classList.remove('hidden');
}

export function hideOverview() {
  $('overview-overlay').classList.add('hidden');
}
