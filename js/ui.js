import { UNITS, TECHS, TECH_TIERS, NAMES, MAX_POP, MAX_HP, COLORS } from './config.js';

const \$ = id => document.getElementById(id);
let handlers = {};

export function initUI(h) {
  handlers = h;
  \$('techBtn').addEventListener('click', () => handlers.onOpenTech());
  $('techClose').addEventListener('click', () => closeTech());$('endTurnBtn').addEventListener('click', () => handlers.onEndTurn());
  $('menuBtn').addEventListener('click', () => handlers.onMenu());$('winnerRestart').addEventListener('click', () => handlers.onRestart());
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => handlers.onMode(btn.dataset.mode));
  });
}

export function setStatus(text) {
  const statusEl = \$('status');
  statusEl.textContent = text;
  statusEl.className = 'text-sm font-semibold text-zinc-900 bg-white px-4 py-2 rounded-lg border border-zinc-200 shadow-sm';
}

export function toast(text, cls = '') {
  const area = \$('toast-area');
  const el = document.createElement('div');
  
  let baseStyle = 'px-4 py-3 mb-2 rounded-lg shadow-sm border text-sm font-medium transition-opacity duration-300 pointer-events-auto ';
  if (cls === 'warn') baseStyle += 'border-red-200 bg-red-50 text-red-800';
  else if (cls === 'good') baseStyle += 'border-emerald-200 bg-emerald-50 text-emerald-800';
  else baseStyle += 'border-zinc-200 bg-white text-zinc-900';

  el.className = baseStyle;
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
  
  return `<div class="flex items-center gap-3 px-4 py-2 rounded-lg border border-zinc-200 bg-white transition-all ${active ? 'ring-2 ring-zinc-900 shadow-md' : 'opacity-70 shadow-sm'}">
    <div class="w-3 h-3 rounded-full" style="background:#${COLORS[player].toString(16).padStart(6, '0')}"></div>
    <span class="font-semibold text-zinc-900">${NAMES[player]}${ctx.mode === 'online' && me ? ' <span class="text-zinc-500 font-normal">(du)</span>' : ''}</span>
    <span class="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-md flex items-center">⭐ ${s}</span>
    <span class="text-xs font-medium text-zinc-500 border-l border-zinc-200 pl-3">🏠 ${cities} · ⚔ ${units}</span>
  </div>`;
}

export function updateStrip(state, ctx) {
  \$('player-strip').innerHTML = chip('player_1', state, ctx) + chip('player_2', state, ctx);
  
  const roundEl = \$('round-label');
  if(roundEl) {
    roundEl.className = 'px-3 py-1 text-sm font-bold text-zinc-500 bg-zinc-100 rounded-md border border-zinc-200';
    roundEl.textContent = 'Runde ' + state.round;
  }
}

export function setEndTurn(enabled) {
  const btn = \$('endTurnBtn');
  btn.disabled = !enabled;
  btn.className = `px-4 py-2 font-bold rounded-lg border transition-all ${enabled ? 'bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-800 shadow-sm' : 'bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed'}`;
}

export function hidePanel() {
  \$('panel').classList.add('hidden');
}

function panel(html) {
  const p = \$('panel');
  p.innerHTML = `<div class="p-5 bg-white border border-zinc-200 shadow-lg rounded-xl overflow-hidden">${html}</div>`;
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
    const hasTargets = state.units.some(u => u.owner !== unit.owner && dist(unit, u) <= def.range);
    hint = unit.mp > 0 ? 'Helle Felder = Bewegung' : 'Bewegung aufgebraucht';
    if (hasTargets) hint += ' · Rote Felder = Angriffsziel';
  }
  
  panel(`
    <div class="flex justify-between items-start mb-5">
      <div>
        <h2 class="text-xl font-bold text-zinc-900 flex items-center gap-2">${unitEmoji(unit.type)} ${def.name}</h2>
        <div class="text-sm font-medium mt-1" style="color:#${COLORS[unit.owner].toString(16).padStart(6, '0')}">${owner}${mine ? ' <span class="text-zinc-500 font-normal">(deine Einheit)</span>' : ''}</div>
      </div>
      <span class="text-xs font-bold px-2 py-1 rounded-md border ${unit.acted ? 'bg-zinc-50 text-zinc-500 border-zinc-200' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}">${unit.acted ? '✓ erledigt' : 'bereit'}</span>
    </div>
    <div class="w-full bg-zinc-100 rounded-full h-2 mb-6 overflow-hidden border border-zinc-200">
      <div class="h-full rounded-full transition-all duration-300 ${unit.hp <= 3 ? 'bg-red-500' : 'bg-zinc-800'}" style="width:${hpPct}%"></div>
    </div>
    <div class="grid grid-cols-2 gap-2 text-sm mb-6">
      <div class="flex justify-between p-2 rounded-md bg-zinc-50 border border-zinc-200"><span class="text-zinc-500">Leben</span><strong class="text-zinc-900">${unit.hp}/${MAX_HP}</strong></div>
      <div class="flex justify-between p-2 rounded-md bg-zinc-50 border border-zinc-200"><span class="text-zinc-500">Angriff</span><strong class="text-zinc-900">${def.atk}</strong></div>
      <div class="flex justify-between p-2 rounded-md bg-zinc-50 border border-zinc-200"><span class="text-zinc-500">Vert.</span><strong class="text-zinc-900">${def.def}</strong></div>
      <div class="flex justify-between p-2 rounded-md bg-zinc-50 border border-zinc-200"><span class="text-zinc-500">Schritt</span><strong class="text-zinc-900">${unit.mp}/${def.move}</strong></div>
      <div class="flex justify-between p-2 rounded-md bg-zinc-50 border border-zinc-200 col-span-2"><span class="text-zinc-500">Reichweite</span><strong class="text-zinc-900">${def.range}</strong></div>
    </div>
    <div class="p-3 text-sm text-zinc-600 bg-zinc-50 rounded-lg border border-zinc-200 leading-relaxed">${hint}</div>
  `);
}

export function showCityPanel(state, city, ctx) {
  const mine = city.owner === ctx.actAs && ctx.myTurn;
  const ownerName = city.owner ? NAMES[city.owner] : 'Neutral';
  const income = city.pop + (city.owner && state.techs[city.owner].includes('ackerbau') ? 1 : 0);
  const occupied = state.units.some(u => u.q === city.q && u.r === city.r);
  
  let actions = '';
  if (city.owner) {
    const unlocked = Object.keys(UNITS).filter(t => !UNITS[t].tech || state.techs[city.owner].includes(UNITS[t].tech));
    if (city.owner === ctx.actAs) {
      actions += `<div class="mt-6"><h3 class="text-xs font-bold tracking-wider text-zinc-400 uppercase mb-3">Ausbildung</h3><div class="flex flex-col gap-2">`;
      for (const t of unlocked) {
        const u = UNITS[t];
        const reason = trainReason(state, city, t, ctx);
        actions += `<button class="w-full flex items-center justify-between p-3 rounded-lg border text-left transition-all ${reason ? 'border-zinc-200 bg-zinc-50 opacity-60 cursor-not-allowed' : 'border-zinc-300 bg-white hover:border-zinc-400 hover:shadow-sm'}" data-train="${t}" ${reason ? 'disabled' : ''}>
          <div class="flex flex-col">
            <span class="font-bold text-zinc-900">${unitEmoji(t)} ${u.name}</span>
            <span class="text-xs text-zinc-500 mt-1">⚔ ${u.atk} · 🛡 ${u.def} · 👟 ${u.move} · 🎯 ${u.range}</span>
          </div>
          <span class="font-bold text-amber-700 bg-amber-50 px-2 py-1 rounded-md border border-amber-100 shrink-0 ml-2">⭐ ${u.cost}</span>
        </button>`;
      }
      actions += `</div></div>`;
      
      const popReason = popReasonFor(state, city, ctx);
      actions += `<div class="mt-4 pt-4 border-t border-zinc-200">
        <button class="w-full flex items-center justify-between p-3 rounded-lg border text-left transition-all ${popReason ? 'border-zinc-200 bg-zinc-50 opacity-60 cursor-not-allowed' : 'border-zinc-300 bg-white hover:border-zinc-400 hover:shadow-sm'}" data-buypop ${popReason ? 'disabled' : ''}>
          <div class="flex flex-col">
            <span class="font-bold text-zinc-900">🌾 Bevölkerung +1</span>
            <span class="text-xs text-zinc-500 mt-1">Mehr Sterne pro Runde (max ${MAX_POP})</span>
          </div>
          <span class="font-bold text-amber-700 bg-amber-50 px-2 py-1 rounded-md border border-amber-100 shrink-0 ml-2">⭐ ${city.pop + 2}</span>
        </button>
      </div>`;
      
      if (city.trained) actions += `<div class="mt-4 p-3 text-sm text-zinc-600 bg-zinc-50 rounded-lg border border-zinc-200">Diese Stadt hat bereits diese Runde ausgebildet.</div>`;
      if (occupied) actions += `<div class="mt-2 p-3 text-sm text-zinc-600 bg-zinc-50 rounded-lg border border-zinc-200">Einheit in der Stadt – zuerst wegziehen.</div>`;
    }
  }

  panel(`
    <div class="flex justify-between items-start mb-6">
      <div>
        <h2 class="text-xl font-bold text-zinc-900">🏙 Stadt</h2>
        <div class="text-sm font-medium mt-1" style="color:${city.owner ? '#' + COLORS[city.owner].toString(16).padStart(6, '0') : '#71717a'}">${ownerName}</div>
      </div>
      ${city.pop >= MAX_POP ? '<span class="text-xs font-bold px-2 py-1 rounded-md bg-zinc-100 border border-zinc-200 text-zinc-500">max. Bev.</span>' : ''}
    </div>
    <div class="grid grid-cols-3 gap-2 text-center text-sm mb-2">
      <div class="p-2 rounded-md bg-zinc-50 border border-zinc-200"><div class="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-1">Bevölkerung</div><strong class="text-zinc-900 block text-base">${city.pop}/${MAX_POP}</strong></div>
      <div class="p-2 rounded-md bg-zinc-50 border border-zinc-200"><div class="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-1">Einkommen</div><strong class="text-zinc-900 block text-base">+${income}</strong></div>
      <div class="p-2 rounded-md bg-zinc-50 border border-zinc-200"><div class="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-1">Ausbildung</div><strong class="${city.trained ? 'text-zinc-400' : 'text-emerald-700'} block text-base">${city.trained ? 'Nein' : 'Ja'}</strong></div>
    </div>
    ${actions || (!city.owner ? '<div class="mt-5 p-3 text-sm text-zinc-600 bg-zinc-50 rounded-lg border border-zinc-200">Neutrale Stadt – rücke mit einer Einheit hinein, um sie zu erobern.</div>' : '<div class="mt-5 p-3 text-sm text-zinc-600 bg-zinc-50 rounded-lg border border-zinc-200">Nicht dein Zug.</div>')}
  `);

  \$('panel').querySelectorAll('[data-train]').forEach(btn => {
    btn.addEventListener('click', () => handlers.onTrain(city, btn.dataset.train));
  });
  const popBtn = \$('panel').querySelector('[data-buypop]');
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

export function unitEmoji(type) {
  return { warrior: '⚔️', archer: '🏹', rider: '🐎', defender: '🛡️', swordsman: '🗡️', catapult: '🪨' }[type] || '❔';
}

export function openTech(state, ctx) {
  const overlay = \$('tech-overlay');
  
  // Minimalist background styling if needed (assuming overlay div has standard fixed full screen classes)
  overlay.className = 'fixed inset-0 bg-white/95 backdrop-blur-sm z-50 flex flex-col p-6 overflow-y-auto';
  
  const stars = state.stars[ctx.actAs];
  
  const topBar = \$('tech-stars');
  if(topBar) {
    topBar.className = 'text-lg font-bold text-amber-700 bg-amber-50 border border-amber-100 px-4 py-2 rounded-lg inline-flex mb-6';
    topBar.textContent = '⭐ ' + stars + ' verfügbar';
  }
  
  const list = \$('tech-list');
  list.innerHTML = '';
  
  TECH_TIERS.forEach((tier, i) => {
    const label = document.createElement('h3');
    label.className = 'text-xs font-bold tracking-widest text-zinc-400 uppercase mt-8 mb-3 px-1 border-b border-zinc-200 pb-2';
    label.textContent = 'Stufe ' + (i + 1);
    list.appendChild(label);
    
    for (const id of tier) {
      const t = TECHS[id];
      const done = state.techs[ctx.actAs].includes(id);
      const locked = t.req && !state.techs[ctx.actAs].includes(t.req);
      const poor = stars < t.cost;
      
      const btn = document.createElement('button');
      btn.className = `w-full max-w-2xl flex items-center justify-between p-4 mb-3 rounded-xl border text-left transition-all ${done ? 'border-zinc-200 bg-zinc-50 opacity-60' : (locked || !ctx.myTurn || poor ? 'border-zinc-200 bg-zinc-50/50 opacity-50 cursor-not-allowed' : 'border-zinc-300 bg-white hover:border-zinc-400 hover:shadow-sm')}`;
      btn.disabled = done || locked || !ctx.myTurn;
      
      btn.innerHTML = `
        <div class="flex flex-col">
          <span class="font-bold text-zinc-900 text-lg ${done ? 'line-through text-zinc-500' : ''}">${t.name}</span>
          <span class="text-sm text-zinc-500 mt-1">${t.desc}${locked ? ' <strong class="text-zinc-400 font-medium ml-1">· benötigt ' + TECHS[t.req].name + '</strong>' : ''}</span>
        </div>
        <span class="font-bold text-amber-700 bg-amber-50 border border-amber-100 px-3 py-1.5 rounded-lg shrink-0 ml-4">⭐ ${t.cost}</span>
      `;
      
      if (!done && !locked && ctx.myTurn && !poor) {
        btn.addEventListener('click', () => handlers.onResearch(id));
      }
      list.appendChild(btn);
    }
  });
  overlay.classList.remove('hidden');
}

export function closeTech() {
  \$('tech-overlay').classList.add('hidden');
}

export function isTechOpen() {
  return !\$('tech-overlay').classList.contains('hidden');
}

export function showMenu() {
  \$('menu-overlay').classList.remove('hidden');
}

export function hideMenu() {
  \$('menu-overlay').classList.add('hidden');
}

export function showWinner(state, ctx) {
  const winner = state.winner;
  
  const titleEl = \$('winner-title');
  if(titleEl) {
    titleEl.className = 'text-3xl font-bold text-zinc-900 mb-2 tracking-tight';
    titleEl.textContent = NAMES[winner] + ' gewinnt!';
  }

  let text = 'Alle Städte des Gegners wurden erobert.';
  if (ctx.mode === 'bot') text = winner === 'player_1' ? 'Du hast gewonnen! 🎉' : 'Die KI hat gewonnen.';
  else if (ctx.mode === 'online') text = winner === ctx.myRole ? 'Du hast gewonnen! 🎉' : 'Dein Gegner hat gewonnen.';
  
  const textEl = \$('winner-text');
  if(textEl) {
    textEl.className = 'text-base font-medium text-zinc-500 mb-8';
    textEl.textContent = text + ` · Runde ${state.round}`;
  }
  
  \$('winner-overlay').classList.remove('hidden');
}

export function hideWinner() {
  \$('winner-overlay').classList.add('hidden');
}
