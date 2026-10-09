import { UNITS, TECHS, TECH_TIERS, TRIBES, NAMES, MAX_POP, MAX_HP } from './config.js';

const \$ = id => document.getElementById(id);
let handlers = {};

export function initUI(h) {
  handlers = h;
  \$('techBtn')?.addEventListener('click', () => handlers.onOpenTech());
  $('techClose')?.addEventListener('click', () => closeTech());$('endTurnBtn')?.addEventListener('click', () => handlers.onEndTurn());
  $('menuBtn')?.addEventListener('click', () => handlers.onMenu());$('winnerRestart')?.addEventListener('click', () => handlers.onRestart());
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => handlers.onMode(btn.dataset.mode));
  });
}

export function setStatus(text) {
  const statusEl = \$('status');
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = 'text-sm font-semibold text-zinc-900 bg-white px-4 py-2 rounded-lg border border-zinc-200 shadow-sm';
}

export function toast(text, cls = '') {
  const area = \$('toast-area');
  if (!area) return;
  const el = document.createElement('div');
  
  let baseStyle = 'px-4 py-3 mb-2 rounded-lg shadow-sm border text-sm font-medium transition-opacity duration-300 pointer-events-auto ';
  if (cls === 'warn') baseStyle += 'border-red-200 bg-red-50 text-red-800';
  else if (cls === 'good') baseStyle += 'border-emerald-200 bg-emerald-50 text-emerald-800';
  else baseStyle += 'border-zinc-200 bg-white text-zinc-900';

  el.className = baseStyle;
  el.textContent = text;
  area.appendChild(el);
  while (area.children.length > 4) area.firstChild.remove();
  setTimeout(() => { el.style.opacity = '0'; }, 2300);
  setTimeout(() => el.remove(), 2700);
}

export function updateStrip(state, ctx) {
  const strip = \$('player-strip');
  if (!strip) return;

  const t1Key = state.tribes?.player_1 || 'imperius';
  const t2Key = state.tribes?.player_2 || 'bardur';
  const p1Tribe = TRIBES[t1Key] || TRIBES.imperius;
  const p2Tribe = TRIBES[t2Key] || TRIBES.bardur;

  const active1 = state.turn === 'player_1' && !state.winner;
  const active2 = state.turn === 'player_2' && !state.winner;

  strip.innerHTML = `
    <div class="flex items-center gap-3 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white font-semibold ${active1 ? 'ring-2 ring-zinc-900 shadow-sm' : 'opacity-70'}">
      <span class="text-xs uppercase font-bold tracking-wider text-zinc-400">[${p1Tribe.code}]</span>
      <span class="text-sm font-bold text-zinc-900">${p1Tribe.name}</span>
      <span class="text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-xs font-bold">Sterne: ${state.stars.player_1}</span>
    </div>
    <div class="flex items-center gap-3 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white font-semibold ${active2 ? 'ring-2 ring-zinc-900 shadow-sm' : 'opacity-70'}">
      <span class="text-xs uppercase font-bold tracking-wider text-zinc-400">[${p2Tribe.code}]</span>
      <span class="text-sm font-bold text-zinc-900">${p2Tribe.name}</span>
      <span class="text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-xs font-bold">Sterne: ${state.stars.player_2}</span>
    </div>
  `;

  const roundEl = \$('round-label');
  if (roundEl) {
    roundEl.className = 'px-3 py-1 text-sm font-bold text-zinc-600 bg-zinc-100 rounded-md border border-zinc-200';
    roundEl.textContent = 'Runde ' + state.round;
  }
}

export function setEndTurn(enabled) {
  const btn = \$('endTurnBtn');
  if (!btn) return;
  btn.disabled = !enabled;
  btn.className = `px-4 py-2 font-bold rounded-lg border transition-all ${enabled ? 'bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-800 shadow-sm' : 'bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed'}`;
}

export function hidePanel() {
  \$('panel')?.classList.add('hidden');
}

function panel(html) {
  const p = \$('panel');
  if (!p) return;
  p.innerHTML = `<div class="p-5 bg-white border border-zinc-200 shadow-lg rounded-xl overflow-hidden max-w-sm w-full">${html}</div>`;
  p.classList.remove('hidden');
}

export function showUnitPanel(state, unit, ctx) {
  const def = UNITS[unit.type];
  const owner = NAMES[unit.owner];
  const mine = unit.owner === ctx.actAs;
  const hpPct = Math.max(0, (unit.hp / (unit.maxHp || MAX_HP)) * 100);

  let hint = '';
  if (state.winner) hint = 'Spiel vorbei.';
  else if (!mine || !ctx.myTurn) hint = 'Nicht am Zug – nur beobachten.';
  else if (unit.acted) hint = 'Einheit hat gehandelt.';
  else hint = unit.mp > 0 ? 'Bewegen oder Angreifen' : 'Bewegung aufgebraucht';

  panel(`
    <div class="flex justify-between items-start mb-4">
      <div>
        <h2 class="text-lg font-bold text-zinc-900 flex items-center gap-2">
          <span class="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-600">${def.code}</span>
          ${def.name}
        </h2>
        <div class="text-xs font-medium mt-1 text-zinc-500">${owner}${mine ? ' (deine Einheit)' : ''}</div>
      </div>
      <span class="text-xs font-bold px-2 py-1 rounded border ${unit.acted ? 'bg-zinc-50 text-zinc-400 border-zinc-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}">${unit.acted ? 'Inaktiv' : 'Bereit'}</span>
    </div>
    <div class="w-full bg-zinc-100 rounded-full h-2 mb-4 overflow-hidden border border-zinc-200">
      <div class="h-full rounded-full transition-all duration-300 ${unit.hp <= 3 ? 'bg-red-500' : 'bg-zinc-800'}" style="width:${hpPct}%"></div>
    </div>
    <div class="grid grid-cols-2 gap-2 text-xs mb-4">
      <div class="flex justify-between p-2 rounded bg-zinc-50 border border-zinc-200"><span class="text-zinc-500">Leben</span><strong class="text-zinc-900">${unit.hp}/${unit.maxHp || MAX_HP}</strong></div>
      <div class="flex justify-between p-2 rounded bg-zinc-50 border border-zinc-200"><span class="text-zinc-500">Angriff</span><strong class="text-zinc-900">${def.atk}</strong></div>
      <div class="flex justify-between p-2 rounded bg-zinc-50 border border-zinc-200"><span class="text-zinc-500">Verteidigung</span><strong class="text-zinc-900">${def.def}</strong></div>
      <div class="flex justify-between p-2 rounded bg-zinc-50 border border-zinc-200"><span class="text-zinc-500">Bewegung</span><strong class="text-zinc-900">${unit.mp}/${def.move}</strong></div>
    </div>
    <div class="p-2.5 text-xs text-zinc-600 bg-zinc-50 rounded border border-zinc-200">${hint}</div>
  `);
}

export function showCityPanel(state, city, ctx) {
  const mine = city.owner === ctx.actAs && ctx.myTurn;
  const ownerName = city.owner ? NAMES[city.owner] : 'Neutral';
  const income = city.pop;

  let actions = '';
  if (city.owner && city.owner === ctx.actAs) {
    const unlocked = Object.keys(UNITS).filter(t => !UNITS[t].tech || state.techs[city.owner].includes(UNITS[t].tech));
    actions += `<div class="mt-4"><h3 class="text-xs font-bold tracking-wider text-zinc-400 uppercase mb-2">Ausbildung</h3><div class="flex flex-col gap-2">`;
    
    for (const t of unlocked) {
      const u = UNITS[t];
      const disabled = !ctx.myTurn || city.trained || state.stars[ctx.actAs] < u.cost;
      actions += `<button class="w-full flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${disabled ? 'border-zinc-200 bg-zinc-50 opacity-50 cursor-not-allowed' : 'border-zinc-300 bg-white hover:border-zinc-400'}" data-train="${t}" ${disabled ? 'disabled' : ''}>
        <div class="flex items-center gap-2">
          <span class="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-600">${u.code}</span>
          <span class="font-bold text-zinc-900 text-xs">${u.name}</span>
        </div>
        <span class="font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-xs">${u.cost} Sterne</span>
      </button>`;
    }
    actions += `</div></div>`;
  }

  panel(`
    <div class="flex justify-between items-start mb-4">
      <div>
        <h2 class="text-lg font-bold text-zinc-900">Stadt</h2>
        <div class="text-xs font-medium mt-0.5 text-zinc-500">${ownerName}</div>
      </div>
      <span class="text-xs font-bold px-2 py-1 rounded bg-zinc-100 border border-zinc-200 text-zinc-600">Bev. ${city.pop}/${MAX_POP}</span>
    </div>
    <div class="grid grid-cols-2 gap-2 text-center text-xs mb-2">
      <div class="p-2 rounded bg-zinc-50 border border-zinc-200"><div class="text-zinc-400 text-[10px] font-bold uppercase">Einkommen</div><strong class="text-zinc-900 block text-xs">+${income} Sterne</strong></div>
      <div class="p-2 rounded bg-zinc-50 border border-zinc-200"><div class="text-zinc-400 text-[10px] font-bold uppercase">Status</div><strong class="${city.trained ? 'text-zinc-400' : 'text-emerald-700'} block text-xs">${city.trained ? 'Ausgebildet' : 'Bereit'}</strong></div>
    </div>
    ${actions}
  `);

  \$('panel')?.querySelectorAll('[data-train]').forEach(btn => {
    btn.addEventListener('click', () => handlers.onTrain(city, btn.dataset.train));
  });
}

export function openTech(state, ctx) {
  const overlay = \$('tech-overlay');
  if (!overlay) return;
  
  overlay.className = 'fixed inset-0 bg-white/95 backdrop-blur-sm z-50 flex flex-col p-6 overflow-y-auto';
  
  const stars = state.stars[ctx.actAs];
  const topBar = \$('tech-stars');
  if (topBar) {
    topBar.className = 'text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg inline-flex mb-4 self-start';
    topBar.textContent = 'Verfügbar: ' + stars + ' Sterne';
  }
  
  const list = \$('tech-list');
  if (!list) return;
  list.innerHTML = '';
  
  TECH_TIERS.forEach((tier, i) => {
    const label = document.createElement('h3');
    label.className = 'text-xs font-bold tracking-widest text-zinc-400 uppercase mt-6 mb-3 border-b border-zinc-200 pb-1';
    label.textContent = 'Stufe ' + (i + 1);
    list.appendChild(label);
    
    for (const id of tier) {
      const t = TECHS[id];
      if (!t) continue;
      const done = state.techs[ctx.actAs].includes(id);
      const locked = t.req && !state.techs[ctx.actAs].includes(t.req);
      const poor = stars < t.baseCost;
      
      const btn = document.createElement('button');
      btn.className = `w-full max-w-2xl flex items-center justify-between p-3 mb-2 rounded-xl border text-left transition-all ${done ? 'border-zinc-200 bg-zinc-50 opacity-60' : (locked || !ctx.myTurn || poor ? 'border-zinc-200 bg-zinc-50/50 opacity-50 cursor-not-allowed' : 'border-zinc-300 bg-white hover:border-zinc-400')}`;
      btn.disabled = done || locked || !ctx.myTurn;
      
      btn.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="flex flex-col">
            <span class="font-bold text-zinc-900 text-sm ${done ? 'line-through text-zinc-400' : ''}">${t.name}</span>
            <span class="text-xs text-zinc-500">${t.desc}${locked ? ' · <span class="text-zinc-400">benötigt ' + TECHS[t.req].name + '</span>' : ''}</span>
          </div>
        </div>
        <span class="font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded text-xs shrink-0 ml-3">${t.baseCost} Sterne</span>
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
  \$('tech-overlay')?.classList.add('hidden');
}

export function isTechOpen() {
  return !\$('tech-overlay')?.classList.contains('hidden');
}

export function showMenu() {
  \$('menu-overlay')?.classList.remove('hidden');
}

export function hideMenu() {
  \$('menu-overlay')?.classList.add('hidden');
}

export function showWinner(state, ctx) {
  const winner = state.winner;
  const titleEl = \$('winner-title');
  if (titleEl) {
    titleEl.className = 'text-xl font-bold text-zinc-900 mb-2';
    titleEl.textContent = NAMES[winner] + ' gewinnt!';
  }

  const textEl = \$('winner-text');
  if (textEl) {
    textEl.className = 'text-xs font-medium text-zinc-500 mb-6';
    textEl.textContent = `Sieg nach Runde ${state.round}`;
  }
  
  \$('winner-overlay')?.classList.remove('hidden');
}

export function hideWinner() {
  \$('winner-overlay')?.classList.add('hidden');
}
