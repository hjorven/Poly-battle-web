// Oberfläche des Admin-/Kreativ-Panels. Nur nach Eingabe des Admin-Codes
// sichtbar; in Online-Partien gesperrt. Die eigentlichen Änderungen stehen in
// admin.js, main.js reicht über `api` die nötigen Zugriffe herein.

import * as A from './admin.js';
import * as P from './profile.js';
import * as K from './campaign.js';
import { UNITS, UNIT_ORDER, TECHS, IMPROVEMENTS, TERRAIN, RESOURCES } from './config.js';

const KEY = 'pb_admin_v1';
const BACKUP = 'pb_profile_admin_backup';

let api = null;
let tool = null;
let tab = 'spiel';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = () => { try { return globalThis.localStorage || null; } catch (e) { return null; } };

export function isUnlocked() {
  const s = store();
  try { return !!s && s.getItem(KEY) === A.ADMIN_HASH; } catch (e) { return false; }
}

function lock() {
  try { store().removeItem(KEY); } catch (e) { /* ignore */ }
  setTool(null);
  $('admin-panel').classList.add('hidden');
  $('adminBtn').classList.add('hidden');
  api.toast('Admin-Panel gesperrt');
}

export function initAdmin(handlers) {
  api = handlers;
  const btn = document.createElement('button');
  btn.id = 'adminBtn';
  btn.className = 'btn ghost small hidden';
  btn.textContent = 'Admin';
  btn.title = 'Admin-/Kreativ-Panel';
  btn.addEventListener('click', toggle);
  document.body.appendChild(btn);

  const box = document.createElement('aside');
  box.id = 'admin-panel';
  box.className = 'hidden';
  // Über allen Dialogen (auch dem Menü), damit der Profil-Reiter dort nutzbar ist.
  document.body.appendChild(box);
  box.addEventListener('click', onClick);
  box.addEventListener('change', onChange);
  // Tastenkürzel im Panel nicht an das Spiel weiterreichen.
  box.addEventListener('keydown', e => e.stopPropagation());

  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) { e.preventDefault(); open(); }
  });
  if (isUnlocked()) btn.classList.remove('hidden');
}

// Freischalten (Code-Abfrage) oder direkt öffnen.
export function open() {
  if (isUnlocked()) { show(); return; }
  api.askCode(async code => {
    if (!(await A.checkCode(code))) return 'Falscher Code.';
    try { store().setItem(KEY, A.ADMIN_HASH); } catch (e) { return 'Speichern im Browser nicht möglich.'; }
    $('adminBtn').classList.remove('hidden');
    show();
    return null;
  });
}

function toggle() {
  if ($('admin-panel').classList.contains('hidden')) show();
  else { $('admin-panel').classList.add('hidden'); setTool(null); }
}

function show() {
  $('admin-panel').classList.remove('hidden');
  render();
}

// Wird bei jedem refresh() aufgerufen, damit Anzeige und Spielstand passen.
export function update() {
  if (!api || $('admin-panel').classList.contains('hidden')) return;
  if (blocked() && tool) setTool(null);
  // Nicht neu zeichnen, während im Panel getippt wird.
  if ($('admin-panel').contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return;
  render();
}

export function activeTool() {
  return tool;
}

function blocked() {
  const app = api.app();
  if (!app.state) return 'Starte zuerst ein Spiel.';
  if (app.online || app.mode === 'online') return 'In Online-Partien ist das Panel gesperrt.';
  return null;
}

function setTool(t) {
  tool = t;
  api.setPicking(!!t);
  const b = $('admin-panel');
  if (b && !b.classList.contains('hidden')) render();
}

// --- Darstellung ----------------------------------------------------------------

const TABS = [['spiel', 'Spiel'], ['einheiten', 'Einheiten'], ['staedte', 'Städte'], ['karte', 'Karte'], ['profil', 'Profil'], ['stand', 'Spielstand']];

function render() {
  const box = $('admin-panel');
  const keepScroll = box.scrollTop;
  const app = api.app();
  const st = app.state;
  const why = blocked();
  let body;
  if (tab === 'profil') body = profileTab();
  else if (why) body = `<p class="hint">${esc(why)}</p>`;
  else body = { spiel: gameTab, einheiten: unitTab, staedte: cityTab, karte: mapTab, stand: saveTab }[tab](st);
  box.innerHTML = `
    <div class="adm-head">
      <b>Admin</b>
      ${st && st.admin ? '<span class="adm-flag" title="Diese Partie zählt nicht für die Bestenliste">Testpartie</span>' : ''}
      <span class="adm-grow"></span>
      <button class="btn ghost small" data-a="lock" title="Panel wieder sperren">Sperren</button>
      <button class="btn ghost small" data-a="close">Schließen</button>
    </div>
    <div class="adm-tabs">${TABS.map(([id, label]) => `<button class="btn small${tab === id ? ' active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
    ${tool ? `<div class="adm-tool">Werkzeug aktiv: <b>${esc(toolLabel(tool))}</b> – tippe aufs Spielfeld. <button class="btn small" data-a="tool-off">Beenden</button></div>` : ''}
    ${!why && tab !== 'profil' ? playerPick(st) : ''}
    <div class="adm-body">${body}</div>`;
  box.scrollTop = keepScroll;
}

function playerName(st, p) {
  if (!p) return 'Niemand (Dorf)';
  return api.playerName(st, p) + (st.ai && st.ai.includes(p) ? ' (KI)' : '');
}

function target() {
  const st = api.app().state;
  if (!st) return null;
  if (!st.players.includes(cur.player)) cur.player = api.viewer() || st.players[0];
  return cur.player;
}

// Gemerkte Auswahl im Panel.
const cur = { player: null, unit: 'warrior', unitAct: 'heal', cityAct: 'grow', imp: 'farm', terrain: 'field', res: 'fruit', tech: 'all', rounds: 5 };

function playerPick(st) {
  const p = target();
  return `<label class="adm-row">Für Spieler
    <select data-set="player">${st.players.map(x => `<option value="${x}"${x === p ? ' selected' : ''}>${esc(playerName(st, x))}</option>`).join('')}</select>
  </label>`;
}

const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`).join('');
const toolBtn = (kind, label) => `<button class="btn small${tool && tool.kind === kind ? ' primary' : ''}" data-tool="${kind}">${label}</button>`;

function gameTab(st) {
  const p = target();
  const techs = [['all', 'Alle Technologien'], ...Object.entries(TECHS).filter(([id]) => !st.techs[p].includes(id)).map(([id, t]) => [id, t.name])];
  const app = api.app();
  return `
    <h4>Sterne</h4>
    <div class="adm-row">
      <input type="number" min="0" max="99999" value="${st.stars[p]}" id="adm-stars" />
      <button class="btn small" data-a="stars-set">Setzen</button>
      <button class="btn small" data-a="stars-add">+100</button>
    </div>
    <h4>Forschung</h4>
    <div class="adm-row">
      <select data-set="tech">${opts(techs, cur.tech)}</select>
      <button class="btn small" data-a="tech"${techs.length > 1 ? '' : ' disabled'}>Erforschen</button>
    </div>
    <h4>Züge</h4>
    <div class="adm-grid">
      <button class="btn small" data-a="refresh">Einheiten und Städte erfrischen</button>
      <button class="btn small" data-a="pause">${app.adminPauseAi ? 'KI wieder handeln lassen' : 'KI pausieren'}</button>
    </div>
    <div class="adm-row">
      Runden vorspulen
      <select data-set="rounds">${opts([[1, '1'], [5, '5'], [10, '10'], [25, '25']].map(([a, b]) => [String(a), b]), String(cur.rounds))}</select>
      <button class="btn small" data-a="skip">Mit KI</button>
      <button class="btn small" data-a="skip-still">Ohne KI</button>
    </div>
    <p class="hint">Runde ${st.round}${st.turnLimit ? ' von ' + st.turnLimit : ''}. Schonfrist der KI: ${st.provoked && Object.keys(st.provoked).length ? 'teils aufgehoben' : 'aktiv'}.</p>
    <div class="adm-grid">
      <button class="btn small" data-a="provoke">Schonfrist aufheben</button>
      <button class="btn small" data-a="report">Rundenbericht zeigen</button>
    </div>
    <h4>Ende</h4>
    <div class="adm-grid">
      <button class="btn small" data-a="win">Sofort gewinnen</button>
      <button class="btn small danger" data-a="lose">Sofort verlieren</button>
    </div>
    <label class="adm-check"><input type="checkbox" data-set="score"${st.adminScore ? ' checked' : ''} /> Trotzdem ins Profil eintragen (Erfahrung, Erfolge, Kampagne). Die Bestenliste bleibt immer außen vor.</label>`;
}

function unitTab(st) {
  const types = UNIT_ORDER.filter(t => UNITS[t]).map(t => [t, UNITS[t].name]);
  const acts = [['heal', 'Heilen'], ['hurt', 'Halbe Lebenspunkte'], ['vet', 'Zum Veteranen machen'], ['owner', 'Dem gewählten Spieler geben'], ['kill', 'Entfernen']];
  return `
    <h4>Einheit erschaffen</h4>
    <div class="adm-row"><select data-set="unit">${opts(types, cur.unit)}</select>${toolBtn('spawn', 'Setzen')}</div>
    <p class="hint">Schiffe nur auf Wasser, Landeinheiten an Land; Luft überall.</p>
    <h4>Einheit bearbeiten</h4>
    <div class="adm-row"><select data-set="unitAct">${opts(acts, cur.unitAct)}</select>${toolBtn('unit', 'Anwenden')}</div>
    <div class="adm-grid"><button class="btn small" data-a="heal-all">Alle eigenen heilen</button></div>`;
}

function cityTab() {
  const acts = [['grow', 'Eine Stufe wachsen'], ['max', 'Auf Stufe 5'], ['shrink', 'Auf Stufe 1'], ['owner', 'Dem gewählten Spieler geben'], ['neutral', 'Zum freien Dorf machen'], ['wall', 'Mauer an/aus']];
  const imps = [['none', 'Entfernen'], ...Object.entries(IMPROVEMENTS).map(([id, d]) => [id, `${d.name} (${d.terrain.map(t => TERRAIN[t].name).join('/')})`])];
  return `
    <h4>Stadt</h4>
    <div class="adm-row"><select data-set="cityAct">${opts(acts, cur.cityAct)}</select>${toolBtn('city', 'Anwenden')}</div>
    <div class="adm-grid">${toolBtn('found', 'Stadt gründen')}${toolBtn('village', 'Freies Dorf setzen')}</div>
    <h4>Gebäude</h4>
    <div class="adm-row"><select data-set="imp">${opts(imps, cur.imp)}</select>${toolBtn('improve', 'Setzen')}</div>
    <p class="hint">Ohne Kosten und Technik; das Gelände muss passen.</p>
    <h4>Wege und Brücken</h4>
    <div class="adm-grid">${toolBtn('road', 'Weg an/aus')}${toolBtn('bridge', 'Brücke an/aus')}</div>`;
}

function mapTab(st) {
  const terr = Object.entries(TERRAIN).map(([id, t]) => [id, t.name]);
  const res = [['none', 'Entfernen'], ...Object.entries(RESOURCES).map(([id, d]) => [id, `${d.name} (${d.terrain.map(t => TERRAIN[t].name).join('/')})`])];
  return `
    <h4>Sicht</h4>
    <div class="adm-grid">
      <button class="btn small" data-a="fog">${st.noFog ? 'Nebel wieder an' : 'Nebel aus (alle)'}</button>
      <button class="btn small" data-a="reveal">Karte aufdecken</button>
    </div>
    <h4>Gelände malen</h4>
    <div class="adm-row"><select data-set="terrain">${opts(terr, cur.terrain)}</select>${toolBtn('paint', 'Pinsel')}</div>
    <h4>Rohstoffe und Ruinen</h4>
    <div class="adm-row"><select data-set="res">${opts(res, cur.res)}</select>${toolBtn('resource', 'Setzen')}</div>
    <div class="adm-grid">${toolBtn('ruin', 'Ruine an/aus')}${toolBtn('inspect', 'Feld ansehen')}</div>
    <div class="adm-info" id="adm-inspect">${cur.inspect ? esc(cur.inspect) : ''}</div>`;
}

function saveTab() {
  return `
    <h4>Spielstand</h4>
    <div class="adm-grid">
      <button class="btn small" data-a="export">Als Datei speichern</button>
      <button class="btn small" data-a="copy">In Zwischenablage</button>
    </div>
    <h4>Laden</h4>
    <textarea id="adm-import" rows="4" placeholder="Spielstand (JSON) hier einfügen"></textarea>
    <div class="adm-grid">
      <button class="btn small" data-a="import">Laden</button>
      <button class="btn small" data-a="file">Datei wählen</button>
    </div>
    <p class="hint">Geladene Stände gelten als Testpartie.</p>`;
}

function profileTab() {
  const p = P.loadProfile();
  const lv = P.levelOf(p.xp);
  const have = Object.keys(p.achievements).length, all = Object.keys(P.ACHIEVEMENTS).length;
  let backup = null;
  try { backup = store().getItem(BACKUP); } catch (e) { backup = null; }
  return `
    <p class="hint">Änderungen gelten sofort im Menü. Mit Namen wird das Profil beim nächsten Spielende auch auf dem Server gesichert – lege vorher eine Sicherung an, wenn du zurück willst.</p>
    <div class="adm-grid">
      <button class="btn small" data-a="p-backup">Sicherung anlegen</button>
      <button class="btn small" data-a="p-restore"${backup ? '' : ' disabled'}>Sicherung zurückholen</button>
    </div>
    <h4>Stufe (jetzt ${lv})</h4>
    <div class="adm-row"><input type="number" min="1" max="50" value="${lv}" id="adm-level" /><button class="btn small" data-a="p-level">Setzen</button></div>
    <h4>Erfolge (${have} von ${all})</h4>
    <div class="adm-grid">
      <button class="btn small" data-a="p-ach">Alle freischalten</button>
      <button class="btn small" data-a="p-ach-none">Alle zurücksetzen</button>
    </div>
    <h4>Kampagne (${K.campaignStars(p)} Sterne)</h4>
    <div class="adm-grid">
      <button class="btn small" data-a="p-camp-1">Alles freischalten</button>
      <button class="btn small" data-a="p-camp-3">Alles mit 3 Sternen</button>
      <button class="btn small" data-a="p-camp-0">Zurücksetzen</button>
    </div>
    <h4>Tagesserie (jetzt ${p.daily.streak})</h4>
    <div class="adm-row"><input type="number" min="0" max="999" value="${p.daily.streak}" id="adm-streak" /><button class="btn small" data-a="p-streak">Setzen</button></div>
    <h4>Alles</h4>
    <div class="adm-grid"><button class="btn small danger" data-a="p-reset">Profil zurücksetzen (Name bleibt)</button></div>`;
}

function toolLabel(t) {
  return {
    spawn: 'Einheit setzen: ' + UNITS[cur.unit].name,
    unit: 'Einheit bearbeiten',
    city: 'Stadt bearbeiten',
    found: 'Stadt gründen',
    village: 'Freies Dorf setzen',
    improve: 'Gebäude setzen',
    road: 'Weg an/aus',
    bridge: 'Brücke an/aus',
    paint: 'Gelände: ' + TERRAIN[cur.terrain].name,
    resource: 'Rohstoff setzen',
    ruin: 'Ruine an/aus',
    inspect: 'Feld ansehen'
  }[t.kind] || t.kind;
}

// --- Bedienung ------------------------------------------------------------------

function onChange(e) {
  const k = e.target.dataset.set;
  if (!k) return;
  if (k === 'score') { const st = api.app().state; if (st) { st.adminScore = e.target.checked; api.persist(); } return; }
  cur[k] = k === 'rounds' ? Number(e.target.value) : e.target.value;
  if (tool) render();
}

function onClick(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.tab) { tab = b.dataset.tab; render(); return; }
  if (b.dataset.tool) { const k = b.dataset.tool; setTool(tool && tool.kind === k ? null : { kind: k }); return; }
  const a = b.dataset.a;
  if (!a) return;
  if (a === 'close') { toggle(); return; }
  if (a === 'lock') { lock(); return; }
  if (a === 'tool-off') { setTool(null); return; }
  if (a.startsWith('p-')) { profileAction(a); return; }
  if (blocked()) return;
  gameAction(a);
}

function done(msg, { board = true, rebuild = false } = {}) {
  if (rebuild) api.invalidateBoard();
  if (board) api.redraw();
  api.persist();
  if (msg) api.toast(msg, 'good');
  render();
}

async function gameAction(a) {
  const app = api.app();
  const st = app.state;
  const p = target();
  switch (a) {
    case 'stars-set': A.setStars(st, p, $('adm-stars').value); return done('Sterne gesetzt', { board: false });
    case 'stars-add': A.setStars(st, p, st.stars[p] + 100); return done('100 Sterne dazu', { board: false });
    case 'tech': A.grantTech(st, p, cur.tech); cur.tech = 'all'; return done('Erforscht');
    case 'refresh': A.refreshUnits(st, p); return done('Einheiten und Städte können wieder handeln');
    case 'pause': app.adminPauseAi = !app.adminPauseAi; return done(app.adminPauseAi ? 'KI pausiert: Gegner beenden ihren Zug sofort' : 'KI handelt wieder', { board: false });
    case 'skip':
    case 'skip-still':
      if (app.busy) { api.toast('Warte, bis die KI fertig ist', 'warn'); return; }
      A.advanceRounds(st, cur.rounds, a === 'skip' ? api.ai : null);
      return done(`Jetzt Runde ${st.round}`);
    case 'provoke': A.markAdmin(st); st.provoked = Object.fromEntries(st.players.map(x => [x, true])); return done('Die KI darf jetzt angreifen', { board: false });
    case 'report': api.showReport(); return;
    case 'win': A.winNow(st, p); return done(null);
    case 'lose': A.loseNow(st, p); return done(null);
    case 'heal-all': for (const u of st.units) if (u.owner === p) A.healUnit(st, u); return done('Geheilt');
    case 'fog': A.toggleFog(st); return done(st.noFog ? 'Nebel aus' : 'Nebel an', { rebuild: true });
    case 'reveal': A.revealAll(st, p); return done('Karte aufgedeckt');
    case 'export': {
      const blob = new Blob([A.exportState(st)], { type: 'application/json' });
      const a2 = document.createElement('a');
      a2.href = URL.createObjectURL(blob);
      a2.download = `polybattle-runde${st.round}.json`;
      a2.click();
      setTimeout(() => URL.revokeObjectURL(a2.href), 2000);
      return;
    }
    case 'copy':
      try { await navigator.clipboard.writeText(A.exportState(st)); api.toast('Spielstand kopiert', 'good'); } catch (e) { api.toast('Zwischenablage nicht verfügbar', 'warn'); }
      return;
    case 'import': return importText($('adm-import').value);
    case 'file': {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/json,.json';
      inp.onchange = async () => { if (inp.files[0]) importText(await inp.files[0].text()); };
      inp.click();
      return;
    }
  }
}

function importText(text) {
  const res = A.importState(text, api.validState);
  if (!res.ok) { api.toast(res.reason, 'warn'); return; }
  api.loadState(res.state);
  api.toast('Spielstand geladen', 'good');
  render();
}

function profileAction(a) {
  const s = store();
  const p = P.loadProfile();
  const today = P.dateKey();
  let msg = 'Profil geändert';
  switch (a) {
    case 'p-backup':
      try { s.setItem(BACKUP, JSON.stringify(p)); api.toast('Sicherung angelegt', 'good'); } catch (e) { api.toast('Sicherung nicht möglich', 'warn'); }
      render();
      return;
    case 'p-restore': {
      let b = null;
      try { b = JSON.parse(s.getItem(BACKUP) || 'null'); } catch (e) { b = null; }
      if (!b) { api.toast('Keine Sicherung vorhanden', 'warn'); return; }
      P.saveProfile(P.sanitizeProfile(b));
      api.profileChanged();
      api.toast('Sicherung zurückgeholt', 'good');
      render();
      return;
    }
    case 'p-level': A.setProfileLevel(p, Number($('adm-level').value), P.xpFor); msg = 'Stufe gesetzt'; break;
    case 'p-ach': A.unlockAchievements(p, Object.keys(P.ACHIEVEMENTS), today); msg = 'Alle Erfolge freigeschaltet'; break;
    case 'p-ach-none': p.achievements = {}; msg = 'Erfolge zurückgesetzt'; break;
    case 'p-camp-1': A.setCampaign(p, K.MISSIONS, 1); msg = 'Alle Missionen freigeschaltet'; break;
    case 'p-camp-3': A.setCampaign(p, K.MISSIONS, 3); msg = 'Alle Missionen mit 3 Sternen'; break;
    case 'p-camp-0': A.setCampaign(p, K.MISSIONS, 0); msg = 'Kampagne zurückgesetzt'; break;
    case 'p-streak': A.setDailyStreak(p, Number($('adm-streak').value), today); msg = 'Tagesserie gesetzt'; break;
    case 'p-reset': {
      const fresh = P.emptyProfile();
      fresh.name = p.name;
      P.saveProfile(fresh);
      api.profileChanged();
      api.toast('Profil zurückgesetzt', 'good');
      render();
      return;
    }
    default: return;
  }
  P.saveProfile(p);
  api.profileChanged();
  api.toast(msg, 'good');
  render();
}

// Klick aufs Spielfeld mit aktivem Werkzeug. true = verarbeitet.
export function pick(q, r) {
  if (!tool || blocked()) return false;
  const st = api.app().state;
  const p = target();
  const unit = st.units.find(u => u.q === q && u.r === r) || null;
  const city = st.cities.find(c => c.q === q && c.r === r) || null;
  let res = { ok: true };
  let rebuild = false;
  switch (tool.kind) {
    case 'spawn': res = A.spawnUnit(st, p, cur.unit, q, r); break;
    case 'unit':
      if (!unit) { res = { ok: false, reason: 'Hier steht keine Einheit' }; break; }
      if (cur.unitAct === 'heal') A.healUnit(st, unit);
      else if (cur.unitAct === 'hurt') A.hurtUnit(st, unit);
      else if (cur.unitAct === 'vet') A.makeVeteran(st, unit);
      else if (cur.unitAct === 'kill') A.killUnit(st, unit);
      else res = A.setUnitOwner(st, unit, p);
      break;
    case 'city':
      if (!city) { res = { ok: false, reason: 'Hier steht keine Stadt' }; break; }
      if (cur.cityAct === 'grow') A.setCityPop(st, city, city.pop + 1);
      else if (cur.cityAct === 'max') A.setCityPop(st, city, 5);
      else if (cur.cityAct === 'shrink') A.setCityPop(st, city, 1);
      else if (cur.cityAct === 'owner') res = A.setCityOwner(st, city, p);
      else if (cur.cityAct === 'neutral') res = A.setCityOwner(st, city, null);
      else A.toggleWall(st, city);
      break;
    case 'found': res = A.foundCity(st, q, r, p); break;
    case 'village': res = A.foundCity(st, q, r, null); break;
    case 'improve': res = A.placeImprovement(st, q, r, cur.imp); break;
    case 'road': res = A.toggleRoad(st, q, r); break;
    case 'bridge': res = A.toggleBridge(st, q, r); break;
    case 'paint': res = A.paintTerrain(st, q, r, cur.terrain); break;
    case 'resource': res = A.setResource(st, q, r, cur.res); rebuild = true; break;
    case 'ruin': res = A.toggleRuin(st, q, r); break;
    case 'inspect': {
      cur.inspect = A.describeHex(st, q, r);
      render();
      return true;
    }
  }
  if (!res.ok) { api.toast(res.reason, 'warn'); return true; }
  done(null, { rebuild });
  api.offerReward();
  return true;
}
