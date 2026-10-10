import { UNITS, TECHS, TECH_TIERS, NAMES, MAX_POP, MAX_HP, COLORS } from './config.js';
import { incomeFor, techCost } from './rules.js';

const $ = id => document.getElementById(id);
let handlers = {};

export function initUI(h) {
  handlers = h;
  $('techBtn').addEventListener('click', () => handlers.onOpenTech());
  $('techClose').addEventListener('click', () => closeTech());
  $('endTurnBtn').addEventListener('click', () => handlers.onEndTurn());
  $('menuBtn').addEventListener('click', () => handlers.onMenu());
  $('winnerRestart').addEventListener('click', () => handlers.onRestart());
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => handlers.onMode(btn.dataset.mode));
  });
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
  return `<div class="chip ${active ? 'active' : ''}">
    <span class="dot" style="background:#${COLORS[player].toString(16).padStart(6, '0')}"></span>
    <span>${NAMES[player]}${ctx.mode === 'online' && me ? ' (du)' : ''}</span>
    <span class="stars">${s} Sterne</span>
    <span class="meta">${cities} Städte · ${units} Einheiten</span>
  </div>`;
}

export function updateStrip(state, ctx) {
  $('player-strip').innerHTML = chip('player_1', state, ctx) + chip('player_2', state, ctx);
  $('round-label').textContent = 'Runde ' + state.round;
}

export function setEndTurn(enabled) {
  $('endTurnBtn').disabled = !enabled;
}

export function hidePanel() {
  $('panel').classList.add('hidden');
}

function panel(html) {
  const p = $('panel');
  p.innerHTML = html;
  p.classList.remove('hidden');
}

export function showUnitPanel(state, unit, ctx) {
  const def = UNITS[unit.type];
  const owner = NAMES[unit.owner];
  const mine = unit.owner === ctx.actAs;
  const hpPct = Math.max(0, (unit.hp / MAX_HP) * 100);
  let hint = '';
  if (state.winner) hint = 'Spiel vorbei.';
  else if (!mine || !ctx.myTurn) hint = 'Nicht am Zug – nur beobachten.';
  else if (unit.acted) hint = 'Einheit hat gehandelt. Zug beenden, um sie nächste Runde zu aktivieren.';
  else {
    const hasTargets = state.units.some(u => u.owner !== unit.owner &&
      dist(unit, u) <= def.range);
    hint = unit.mp > 0 ? 'Helle Felder = Bewegung' : 'Bewegung aufgebraucht';
    if (hasTargets) hint += ' · Rote Felder = Angriffsziel';
  }
  panel(`
    <div class="panel-head">
      <div>
        <div class="panel-title">${def.name}</div>
        <div class="panel-sub" style="color:#${COLORS[unit.owner].toString(16).padStart(6, '0')}">${owner}${mine ? ' (deine Einheit)' : ''}</div>
      </div>
      <span class="panel-sub">${unit.acted ? 'erledigt' : 'bereit'}</span>
    </div>
    <div class="hp-bar ${unit.hp <= 3 ? 'low' : ''}"><div style="width:${hpPct}%"></div></div>
    <div class="stat-row">
      <div class="stat">Leben<b>${unit.hp}/${MAX_HP}</b></div>
      <div class="stat">Angriff<b>${def.atk}</b></div>
      <div class="stat">Verteidigung<b>${def.def}</b></div>
      <div class="stat">Bewegung<b>${unit.mp}/${def.move}</b></div>
      <div class="stat">Reichweite<b>${def.range}</b></div>
    </div>
    <div class="hint">${hint}</div>
  `);
}

export function showCityPanel(state, city, ctx) {
  const mine = city.owner === ctx.actAs && ctx.myTurn;
  const ownerName = city.owner ? NAMES[city.owner] : 'Neutral';
  const income = city.owner ? incomeFor(state, city.owner) : city.pop;
  const occupied = state.units.some(u => u.q === city.q && u.r === city.r);
  let actions = '';
  if (city.owner) {
    const unlocked = Object.keys(UNITS).filter(t => !UNITS[t].tech || state.techs[city.owner].includes(UNITS[t].tech));
    if (city.owner === ctx.actAs) {
      actions += `<div class="panel-head" style="margin-top:12px"><div class="panel-sub">Einheiten ausbilden</div></div><div class="action-list">`;
      for (const t of unlocked) {
        const u = UNITS[t];
        const reason = trainReason(state, city, t, ctx);
        actions += `<button class="btn action" data-train="${t}" ${reason ? 'disabled' : ''}>
          <span>${u.name}<span class="sub">Angriff ${u.atk} · Verteidigung ${u.def} · Bewegung ${u.move} · Reichweite ${u.range}</span></span>
          <span class="cost">${u.cost} Sterne</span>
        </button>`;
      }
      actions += `</div>`;
      const popReason = popReasonFor(state, city, ctx);
      actions += `<div class="action-list"><button class="btn action ghost" data-buypop ${popReason ? 'disabled' : ''}>
        <span>Bevölkerung +1<span class="sub">Mehr Sterne pro Runde (max ${MAX_POP})</span></span>
        <span class="cost">${city.pop + 2} Sterne</span>
      </button></div>`;
      if (city.trained) actions += `<div class="hint">Diese Stadt hat bereits diese Runde ausgebildet.</div>`;
      if (occupied) actions += `<div class="hint">Einheit in der Stadt – zuerst wegziehen.</div>`;
    }
  }
  panel(`
    <div class="panel-head">
      <div>
        <div class="panel-title">Stadt</div>
        <div class="panel-sub" style="color:${city.owner ? '#' + COLORS[city.owner].toString(16).padStart(6, '0') : '#71717a'}">${ownerName}</div>
      </div>
      <span class="panel-sub">${city.pop >= MAX_POP ? 'max. Bev.' : ''}</span>
    </div>
    <div class="stat-row">
      <div class="stat">Bevölkerung<b>${city.pop}/${MAX_POP}</b></div>
      <div class="stat">Einkommen<b>${income}/Runde</b></div>
      <div class="stat">Ausbildung<b>${city.trained ? 'nein' : 'ja'}</b></div>
    </div>
    ${actions || (!city.owner ? '<div class="hint">Neutrale Stadt – rücke mit einer Einheit hinein, um sie zu erobern.</div>' : '<div class="hint">Nicht dein Zug.</div>')}
  `);

  $('panel').querySelectorAll('[data-train]').forEach(btn => {
    btn.addEventListener('click', () => handlers.onTrain(city, btn.dataset.train));
  });
  const popBtn = $('panel').querySelector('[data-buypop]');
  if (popBtn) popBtn.addEventListener('click', () => handlers.onBuyPop(city));
}

function dist(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

function trainReason(state, city, type, ctx) {
  if (!ctx.myTurn) return 'Nicht dein Zug';
  if (state.stars[ctx.actAs] < UNITS[type].cost) return 'Zu wenig Sterne';
  if (city.trained) return 'Bereits ausgebildet';
  if (state.units.some(u => u.q === city.q && u.r === city.r)) return 'Stadt besetzt';
  return '';
}

function popReasonFor(state, city, ctx) {
  if (!ctx.myTurn) return 'Nicht dein Zug';
  if (city.pop >= MAX_POP) return 'Maximum';
  if (state.stars[ctx.actAs] < city.pop + 2) return 'Zu wenig Sterne';
  if (state.units.some(u => u.q === city.q && u.r === city.r)) return 'Stadt besetzt';
  return '';
}

export function openTech(state, ctx) {
  const overlay = $('tech-overlay');
  const stars = state.stars[ctx.actAs];
  $('tech-stars').textContent = stars + ' Sterne';
  const list = $('tech-list');
  list.innerHTML = '';
  TECH_TIERS.forEach((tier, i) => {
    const label = document.createElement('div');
    label.className = 'tech-tier';
    label.textContent = 'Stufe ' + (i + 1);
    list.appendChild(label);
    for (const id of tier) {
      const t = TECHS[id];
      const cost = techCost(state, id, ctx.actAs);
      const done = state.techs[ctx.actAs].includes(id);
      const locked = t.req && !state.techs[ctx.actAs].includes(t.req);
      const poor = stars < cost;
      const btn = document.createElement('button');
      btn.className = 'tech' + (done ? ' done' : '');
      btn.disabled = done || locked || !ctx.myTurn;
      btn.innerHTML = `<span class="t-body"><span class="t-name">${t.name}</span><span class="t-desc">${t.desc}${locked ? ' · benötigt ' + TECHS[t.req].name : ''}</span></span><span class="t-cost">${cost} Sterne</span>`;
      if (!done && !locked && ctx.myTurn && !poor) {
        btn.addEventListener('click', () => handlers.onResearch(id));
      }
      list.appendChild(btn);
    }
  });
  overlay.classList.remove('hidden');
}

export function closeTech() {
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
  $('winner-title').textContent = NAMES[winner] + ' gewinnt!';
  let text = 'Alle Städte des Gegners wurden erobert.';
  if (ctx.mode === 'bot') text = winner === 'player_1' ? 'Du hast gewonnen.' : 'Die KI hat gewonnen.';
  else if (ctx.mode === 'online') text = winner === ctx.myRole ? 'Du hast gewonnen.' : 'Dein Gegner hat gewonnen.';
  $('winner-text').textContent = text + ` · Runde ${state.round}`;
  $('winner-overlay').classList.remove('hidden');
}

export function hideWinner() {
  $('winner-overlay').classList.add('hidden');
}
