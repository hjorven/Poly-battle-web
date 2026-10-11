import {
  UNITS, UNIT_ORDER, TECHS, NAMES, MAX_POP,
  TRIBES, TRIBE_POOL, ABILITY_INFO, TERRAIN, RESOURCES, IMPROVEMENTS
} from './config.js';
import {
  cityIncome, techCost, tribeName, playerColor, maxHp, maxMove,
  terrainAt, defenceBonus, attackPreview, canImprove, resourceAt, improvementAt, territory,
  canAttackNow
} from './rules.js';

const $ = id => document.getElementById(id);
let handlers = {};
let selectedTribe = null;

export function initUI(h) {
  handlers = h;
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
  $('menuBtn').addEventListener('click', () => handlers.onMenu());
  $('winnerRestart').addEventListener('click', () => handlers.onRestart());
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => handlers.onMode(btn.dataset.mode));
  });
  buildTribePicker(h.onTribe || (() => {}));
}

export function getTribe() {
  return selectedTribe;
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
      <span class="tribe-tech">Start: ${startTech} · ${startUnits}</span>`;
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
  return `<div class="chip ${active ? 'active' : ''} ${cities === 0 ? 'dead' : ''}">
    <span class="dot" style="background:${hex(playerColor(state, player))}"></span>
    <span>${name}${ctx.mode === 'online' && me ? ' (du)' : ''}</span>
    <span class="stars">${s} Sterne</span>
    <span class="meta">${cities} Städte · ${units} Einheiten</span>
  </div>`;
}

export function updateStrip(state, ctx) {
  const players = state.players && state.players.length ? state.players : ['player_1', 'player_2'];
  $('player-strip').innerHTML = players.map(p => chip(p, state, ctx)).join('');
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

function abilityChips(type) {
  const list = UNITS[type].abilities || [];
  return list
    .filter(a => a !== 'land')
    .map(a => ABILITY_INFO[a] ? `<span class="ability" title="${ABILITY_INFO[a].desc}">${ABILITY_INFO[a].name}</span>` : '')
    .join('');
}

export function showUnitPanel(state, unit, ctx) {
  const def = UNITS[unit.type];
  const cap = maxHp(unit.type);
  const owner = tribeName(state, unit.owner) || NAMES[unit.owner];
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
          return `<div class="forecast"><span>${t.icon} ${t.name} <span class="fc-hp">${p.target.hp} LP</span></span><b class="${lethal ? 'lethal' : ''}">${lethal ? 'Besiegt' : '−' + p.damage} ${back}</b></div>`;
        }).join('')}</div>`;
    }
  }

  panel(`
    <div class="panel-head">
      <div>
        <div class="panel-title">${def.icon} ${def.name}</div>
        <div class="panel-sub" style="color:${hex(playerColor(state, unit.owner))}">${owner}${mine ? ' (deine Einheit)' : ''}</div>
      </div>
      <span class="panel-sub">${unit.acted && unit.mp <= 0 ? 'erledigt' : 'bereit'}</span>
    </div>
    <div class="hp-bar ${unit.hp / cap <= 0.35 ? 'low' : ''}"><div style="width:${hpPct}%"></div></div>
    <div class="stat-row">
      <div class="stat">Leben<b>${unit.hp}/${cap}</b></div>
      <div class="stat">Angriff<b>${def.atk}</b></div>
      <div class="stat">Verteidigung<b>${def.def}</b></div>
      <div class="stat">Bewegung<b>${unit.mp}/${maxMove(state, unit.owner, unit.type)}</b></div>
      <div class="stat">Reichweite<b>${def.range}</b></div>
    </div>
    <div class="ability-row">${abilityChips(unit.type)}</div>
    <div class="hint">Gelände: ${tile.name} · Verteidigungsfaktor ×${tb}</div>
    ${forecast}
    <div class="hint">${hint}</div>
  `);
}

export function showCityPanel(state, city, ctx) {
  const mine = city.owner === ctx.actAs && ctx.myTurn;
  const ownerName = city.owner ? (tribeName(state, city.owner) || NAMES[city.owner]) : 'Neutral';
  const income = city.owner ? cityIncome(state, city) : 0;
  const occupied = state.units.some(u => u.q === city.q && u.r === city.r);

  const cells = territory(city).map(([q, r]) => {
    const tdef = TERRAIN[terrainAt(state, q, r)];
    const imp = improvementAt(state, q, r);
    const res = resourceAt(state, q, r);
    let tag = tdef.name, cls = '';
    if (imp) { tag = `${IMPROVEMENTS[imp].icon} ${IMPROVEMENTS[imp].name}`; cls = 'built'; }
    else if (res) { tag = `${RESOURCES[res].icon} ${RESOURCES[res].name}`; cls = 'res'; }
    return `<span class="tile-chip ${cls}">${tag}</span>`;
  }).join('');

  let actions = '';
  if (city.owner && city.owner === ctx.actAs) {
    const unlocked = UNIT_ORDER.filter(t => {
      const u = UNITS[t];
      if (u.tech && !state.techs[city.owner].includes(u.tech)) return false;
      return true;
    });
    actions += `<div class="panel-head" style="margin-top:12px"><div class="panel-sub">Einheiten ausbilden</div></div><div class="action-list">`;
    for (const t of unlocked) {
      const u = UNITS[t];
      const reason = trainReason(state, city, t, ctx);
      actions += `<button class="btn action" data-train="${t}" ${reason ? 'disabled' : ''}>
        <span>${u.icon} ${u.name}<span class="sub">Angriff ${u.atk} · Verteidigung ${u.def} · Bewegung ${u.move} · Reichweite ${u.range} · Leben ${u.hp}</span></span>
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
    actions += buildRows(state, city, ctx);
  }

  panel(`
    <div class="panel-head">
      <div>
        <div class="panel-title">🏙️ Stadt</div>
        <div class="panel-sub" style="color:${city.owner ? hex(playerColor(state, city.owner)) : '#71717a'}">${ownerName}</div>
      </div>
      <span class="panel-sub">${city.pop >= MAX_POP ? 'max. Bev.' : ''}</span>
    </div>
    <div class="stat-row">
      <div class="stat">Bevölkerung<b>${city.pop}/${MAX_POP}</b></div>
      <div class="stat">Einkommen<b>${income}/Runde</b></div>
      <div class="stat">Gebiete<b>${territory(city).length}</b></div>
    </div>
    <div class="tile-grid">${cells}</div>
    ${actions || (!city.owner ? '<div class="hint">Neutrale Stadt – rücke mit einer Einheit hinein, um sie zu erobern.</div>' : '<div class="hint">Nicht dein Zug.</div>')}
  `);

  $('panel').querySelectorAll('[data-train]').forEach(btn => {
    btn.addEventListener('click', () => handlers.onTrain(city, btn.dataset.train));
  });
  const popBtn = $('panel').querySelector('[data-buypop]');
  if (popBtn) popBtn.addEventListener('click', () => handlers.onBuyPop(city));
  $('panel').querySelectorAll('[data-improve]').forEach(btn => {
    btn.addEventListener('click', () => handlers.onImprove(city, btn.dataset.improve, Number(btn.dataset.q), Number(btn.dataset.r)));
  });
}

function buildRows(state, city, ctx) {
  const rows = [];
  for (const [q, r] of territory(city)) {
    if (improvementAt(state, q, r) || resourceAt(state, q, r)) continue;
    const tile = terrainAt(state, q, r);
    const types = Object.keys(IMPROVEMENTS).filter(k => IMPROVEMENTS[k].terrain.includes(tile));
    if (!types.length) continue;
    const cellName = TERRAIN[tile].name;
    const btns = types.map(t => {
      const d = IMPROVEMENTS[t];
      let reason = '';
      const chk = canImprove(state, city, t, q, r);
      if (!chk.ok) reason = chk.reason;
      else if (d.tech && !state.techs[city.owner].includes(d.tech)) reason = 'Technologie fehlt';
      else if (state.stars[city.owner] < d.cost) reason = 'Zu wenig Sterne';
      return `<button class="btn chip-btn" data-improve="${t}" data-q="${q}" data-r="${r}" ${reason ? 'disabled' : ''} title="${reason || d.name}">${d.icon} ${d.name} <span class="cost">${d.cost}</span></button>`;
    }).join('');
    rows.push(`<div class="build-row"><span class="build-tile">${cellName}</span><span class="build-btns">${btns}</span></div>`);
  }
  if (!rows.length) return '';
  return `<div class="panel-head" style="margin-top:12px"><div class="panel-sub">Gebäude im Stadtgebiet</div></div>${rows.join('')}`;
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

const ROOTS = ['organization', 'climbing', 'fishing', 'hunting', 'riding'];
const CHILDREN = (() => {
  const map = {};
  for (const id in TECHS) {
    const req = TECHS[id].req;
    if (req) (map[req] || (map[req] = [])).push(id);
  }
  return map;
})();
const ANGLE = {};
ROOTS.forEach((id, i) => { ANGLE[id] = (-90 + i * 72) * Math.PI / 180; });

function layoutTechs(W, H) {
  const cx = W / 2, cy = H / 2;
  const m = Math.min(W, H);
  const radius = { 1: m * 0.20, 2: m * 0.38, 3: m * 0.52 };
  const pos = {};
  const polar = (r, a) => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  const place = id => {
    const t = TECHS[id];
    if (t.req) {
      const sibs = CHILDREN[t.req] || [id];
      const i = sibs.indexOf(id);
      const spread = t.tier === 2 ? 0.26 : 0.17;
      const off = sibs.length > 1 ? (i - (sibs.length - 1) / 2) * spread : 0;
      ANGLE[id] = ANGLE[t.req] + off;
    }
    pos[id] = polar(radius[t.tier], ANGLE[id]);
  };
  ROOTS.forEach(place);
  for (const id in TECHS) if (TECHS[id].tier === 2) place(id);
  for (const id in TECHS) if (TECHS[id].tier === 3) place(id);
  return pos;
}

export function openTech(state, ctx) {
  const overlay = $('tech-overlay');
  overlay.classList.remove('hidden');
  const stars = state.stars[ctx.actAs];
  $('tech-stars').textContent = stars + ' Sterne';
  const tree = $('tech-tree');
  const svg = $('tech-lines');
  const nodes = $('tech-nodes');
  nodes.innerHTML = '';
  const W = tree.clientWidth || 560;
  const H = tree.clientHeight || 420;
  const pos = layoutTechs(W, H);

  let lines = '';
  for (const id in TECHS) {
    const t = TECHS[id];
    if (!t.req) continue;
    const a = pos[t.req], b = pos[id];
    const done = state.techs[ctx.actAs].includes(id);
    lines += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${done ? '#16a34a' : '#d4d4d8'}" stroke-width="2" />`;
  }
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.innerHTML = lines;

  for (const id in TECHS) {
    const t = TECHS[id];
    const p = pos[id];
    const done = state.techs[ctx.actAs].includes(id);
    const locked = t.req && !state.techs[ctx.actAs].includes(t.req);
    const cost = techCost(state, id, ctx.actAs);
    const poor = stars < cost;
    const btn = document.createElement('button');
    btn.className = 'tech-node' + (done ? ' done' : locked ? ' locked' : '');
    btn.style.left = p.x + 'px';
    btn.style.top = p.y + 'px';
    btn.disabled = !!(done || locked || !ctx.myTurn || poor);
    btn.title = `${t.name} · ${done ? 'erforscht' : cost + ' Sterne'}\n${t.desc}`
      + (locked ? `\nBenötigt: ${TECHS[t.req].name}` : (poor && !done ? '\nZu wenig Sterne' : ''));
    btn.innerHTML = `<span class="tn-icon">${t.icon || '•'}</span><span class="tn-name">${t.name}</span><span class="tn-cost">${done ? '✓' : cost}</span>`;
    if (!btn.disabled) btn.addEventListener('click', () => handlers.onResearch(id));
    nodes.appendChild(btn);
  }
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
  $('winner-title').textContent = (tribeName(state, winner) || NAMES[winner]) + ' gewinnt!';
  let text = 'Alle anderen Städte wurden erobert.';
  if (ctx.mode === 'bot') text = winner === 'player_1' ? 'Du hast gewonnen.' : 'Die KI hat gewonnen.';
  else if (ctx.mode === 'online') text = winner === ctx.myRole ? 'Du hast gewonnen.' : 'Dein Gegner hat gewonnen.';
  $('winner-text').textContent = text + ` · Runde ${state.round}`;
  $('winner-overlay').classList.remove('hidden');
}

export function hideWinner() {
  $('winner-overlay').classList.add('hidden');
}
