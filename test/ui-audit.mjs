// Oberflächen-Prüfung: öffnet jedes Fenster des Spiels auf vielen Bildschirmgrößen
// (Handy, iPad, Monitor, jeweils hoch und quer), drückt die Knöpfe und prüft jeden
// sichtbaren Knopf: ganz im Bild, nicht abgeschnitten, nicht verdeckt, Text vollständig.
// Aufruf: node test/ui-audit.mjs [filter]       (filter: Teil des Gerätenamens)
// Ohne Internet: VENDOR=/pfad node test/ui-audit.mjs, dort three-0.160.0/package und
// supabase-supabase-js-2.45.4/package (aus `npm pack`), jsDelivr wird dann lokal bedient.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const VENDOR = process.env.VENDOR || null;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = path === '/' || path === '\\' ? 'index.html' : path;
  try {
    const body = await readFile(join(ROOT, file));
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

// Gängige Größen in CSS-Pixeln, jeweils hoch und quer.
const SIZES = [
  ['Handy klein (Android 360)', 360, 640, 'phone'],
  ['iPhone SE', 375, 667, 'phone'],
  ['iPhone 14/15', 390, 844, 'phone'],
  ['Pixel 7', 412, 915, 'phone'],
  ['iPhone Pro Max', 430, 932, 'phone'],
  ['iPad mini', 744, 1133, 'tablet'],
  ['iPad 9.7"', 768, 1024, 'tablet'],
  ['iPad 10.2"', 810, 1080, 'tablet'],
  ['iPad Air', 820, 1180, 'tablet'],
  ['iPad Pro 11"', 834, 1194, 'tablet'],
  ['iPad Pro 12.9"', 1024, 1366, 'tablet'],
  ['Laptop HD', 1280, 720, 'desktop'],
  ['Laptop 1366', 1366, 768, 'desktop'],
  ['MacBook Air', 1440, 900, 'desktop'],
  ['Monitor 1536', 1536, 864, 'desktop'],
  ['Monitor Full HD', 1920, 1080, 'desktop'],
  ['Monitor QHD', 2560, 1440, 'desktop']
];
const only = process.argv[2] ? process.argv[2].toLowerCase() : null;
const DEVICES = [];
for (const [name, a, b, kind] of SIZES) {
  const portrait = [Math.min(a, b), Math.max(a, b)], landscape = [Math.max(a, b), Math.min(a, b)];
  for (const [orient, [w, h]] of [['hoch', portrait], ['quer', landscape]]) {
    const label = `${name} ${orient} ${w}x${h}`;
    if (only && !label.toLowerCase().includes(only)) continue;
    const touch = kind !== 'desktop';
    DEVICES.push({ label, kind, touch, opts: { viewport: { width: w, height: h }, hasTouch: touch, isMobile: kind === 'phone', deviceScaleFactor: 1 } });
  }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']
});

const BOARD = { top: Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, name: ['Maximilian_Langer', 'Ka', 'Wüstenfuchs-1999', 'ÄÖÜ ßpieler', 'WWWWWWWWWWWWWWWW'][i % 5], level: 30 - i, tribe: 'imperius', round: 30, score: 99999 - i * 777 })), me: { rank: 123, name: 'WWWWWWWWWWWWWWWW', score: 12345 }, total: 4321 };

async function cdn(ctx) {
  await ctx.route(/supabase\.co/, route => {
    const u = route.request().url();
    const body = /pb_leaderboard/.test(u) ? JSON.stringify(BOARD) : '[]';
    return route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  if (!VENDOR) return;
  await ctx.route(/cdn\.jsdelivr\.net/, async route => {
    const u = new URL(route.request().url()).pathname;
    let m, file;
    if ((m = u.match(/^\/npm\/three@0\.160\.0\/(.*)$/))) file = join(VENDOR, 'three-0.160.0/package', m[1]);
    else if (/supabase-js@2\.45\.4/.test(u)) file = join(VENDOR, 'supabase-supabase-js-2.45.4/package/dist/umd/supabase.js');
    if (!file) return route.fulfill({ status: 404, body: '' });
    try { return route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(file) }); } catch (e) { return route.fulfill({ status: 404, body: '' }); }
  });
}

// Prüft im Browser alle sichtbaren Knöpfe der obersten Ebene.
const AUDIT = () => {
  const vw = innerWidth, vh = innerHeight;
  const SEL = 'button, [role=button], a.btn, input[type=range], .tech-hex, .tj-btn, [data-city], [data-mission]';
  const vis = el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const name = el => {
    const t = (el.innerText || el.getAttribute('aria-label') || el.title || el.value || '').replace(/\s+/g, ' ').trim();
    const id = el.id ? '#' + el.id : '';
    const data = [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}${a.value ? '=' + a.value : ''}]`).slice(0, 2).join('');
    return `${el.tagName.toLowerCase()}${id}${data} „${t.slice(0, 50)}“`;
  };
  const desc = el => el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''}` : 'nichts';
  // Oberste offene Ebene: ein offenes Overlay verdeckt alles darunter.
  const overlays = [...document.querySelectorAll('.overlay')].filter(o => !o.classList.contains('hidden') && vis(o));
  overlays.sort((a, b) => (parseInt(getComputedStyle(a).zIndex) || 0) - (parseInt(getComputedStyle(b).zIndex) || 0));
  const scope = overlays.length ? overlays[overlays.length - 1] : document.body;
  const issues = [];
  let count = 0;
  const els = [...scope.querySelectorAll(SEL)].filter(el => vis(el) && el.getBoundingClientRect().width > 0 && !el.closest('.hidden'));
  for (const el of els) {
    count++;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const n = name(el);
    // Der Forschungsbaum wird verschoben und gezoomt: dort nur den Text prüfen.
    const pan = !!el.closest('#tech-tree');
    // 1. ganz im Bild?
    if (!pan && (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5))
      issues.push({ kind: 'ausserhalb', el: n, info: `l=${r.left.toFixed(0)} t=${r.top.toFixed(0)} r=${r.right.toFixed(0)} b=${r.bottom.toFixed(0)} (Bild ${vw}x${vh})` });
    // 2. von einem Elternteil mit overflow abgeschnitten?
    let cl = { l: 0, t: 0, r: vw, b: vh };
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const ox = cs.overflowX, oy = cs.overflowY;
      if (ox === 'visible' && oy === 'visible') continue;
      const pr = p.getBoundingClientRect();
      if (ox !== 'visible') { cl.l = Math.max(cl.l, pr.left + p.clientLeft); cl.r = Math.min(cl.r, pr.left + p.clientLeft + p.clientWidth); }
      if (oy !== 'visible') { cl.t = Math.max(cl.t, pr.top + p.clientTop); cl.b = Math.min(cl.b, pr.top + p.clientTop + p.clientHeight); }
    }
    const cutW = Math.max(0, cl.l - r.left) + Math.max(0, r.right - cl.r), cutH = Math.max(0, cl.t - r.top) + Math.max(0, r.bottom - cl.b);
    if (!pan && (cutW > 1 || cutH > 1)) issues.push({ kind: 'abgeschnitten', el: n, info: `${cutW.toFixed(0)} px breit, ${cutH.toFixed(0)} px hoch fehlen` });
    // 3. verdeckt? Mitte und vier Punkte innen prüfen.
    const pts = [[0.5, 0.5], [0.2, 0.25], [0.8, 0.25], [0.2, 0.75], [0.8, 0.75]];
    let covered = 0, by = null;
    for (const [fx, fy] of pts) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit !== el && !el.contains(hit) && !(hit.contains(el))) { covered++; by = by || hit; }
    }
    if (!pan && covered >= 1) {
      // Mitte verdeckt = nicht drückbar
      const hitC = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const centre = hitC && hitC !== el && !el.contains(hitC) && !hitC.contains(el);
      issues.push({ kind: centre ? 'verdeckt' : 'teilweise verdeckt', el: n, info: `von ${desc(by)}${by && by.closest('[id]') ? ' in #' + by.closest('[id]').id : ''} (${covered}/5 Punkte)` });
    }
    // 4. Text vollständig?
    const textEls = [el, ...el.querySelectorAll('*')].filter(e => vis(e));
    for (const t of textEls) {
      const cs = getComputedStyle(t);
      const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.textOverflow === 'ellipsis';
      if (clips && t.innerText && t.innerText.trim() && (t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1))
        issues.push({ kind: 'text abgeschnitten', el: n, info: `${desc(t)} braucht ${t.scrollWidth}x${t.scrollHeight}, hat ${t.clientWidth}x${t.clientHeight}` });
    }
    // Text, der über den Knopfrand hinausläuft (overflow sichtbar).
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let worst = 0;
    for (let tn; (tn = walker.nextNode());) {
      if (!tn.textContent.trim() || !tn.parentElement || !vis(tn.parentElement)) continue;
      range.selectNodeContents(tn);
      for (const tr of range.getClientRects()) {
        if (tr.width < 1) continue;
        const o = Math.max(r.left - tr.left, tr.right - r.right, r.top - tr.top, tr.bottom - r.bottom);
        worst = Math.max(worst, o);
        // Text außerhalb des sichtbaren Ausschnitts
        const oc = Math.max(cl.l - tr.left, tr.right - cl.r, cl.t - tr.top, tr.bottom - cl.b);
        if (!pan && oc > 1 && !(cutW > 1 || cutH > 1)) issues.push({ kind: 'text abgeschnitten', el: n, info: `Text ragt ${oc.toFixed(0)} px aus dem sichtbaren Bereich` });
      }
    }
    if (worst > 1.5) issues.push({ kind: 'text ragt heraus', el: n, info: `${worst.toFixed(0)} px über den Knopfrand` });
    // 5. Wort mitten im Wort umgebrochen? (nur Knöpfe mit sichtbarem Text)
    const txt = (el.innerText || '').trim();
    if (txt && el.tagName === 'BUTTON') {
      const words = txt.split(/\s+/).filter(w => w.length >= 4);
      const lines = [];
      const w2 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let tn; (tn = w2.nextNode());) {
        const s = tn.textContent;
        let start = 0;
        for (let i = 0; i <= s.length; i++) {
          if (i === s.length || /[\s\u00ad-]/.test(s[i])) {
            if (i - start >= 4) { range.setStart(tn, start); range.setEnd(tn, i); const rs = [...range.getClientRects()].filter(x => x.width > 0); if (rs.length > 1 && Math.abs(rs[0].top - rs[rs.length - 1].top) > 2) lines.push(s.slice(start, i)); }
            start = i + 1;
          }
        }
      }
      if (lines.length) issues.push({ kind: 'wort getrennt', el: n, info: `„${lines.slice(0, 3).join('“, „')}“ über zwei Zeilen` });
      void words;
    }
    // 6. zu klein zum Antippen / Schrift zu klein
    issues.push(...(r.width < 24 || r.height < 24 ? [{ kind: 'sehr klein', el: n, info: `${r.width.toFixed(0)}x${r.height.toFixed(0)} px` }] : []));
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (txt && fs < 10.5) issues.push({ kind: 'schrift klein', el: n, info: `${fs.toFixed(1)} px` });
  }
  return { count, issues, scope: scope === document.body ? 'Spielfläche' : '#' + scope.id };
};

let results = [];
async function record(page, dev, state) {
  await page.waitForTimeout(150);
  const res = await page.evaluate(AUDIT).catch(e => ({ count: 0, issues: [{ kind: 'fehler', el: '-', info: e.message.split('\n')[0] }], scope: '?' }));
  const shot = res.issues.some(i => !['sehr klein', 'schrift klein'].includes(i.kind));
  let file = null;
  if (shot && process.env.SHOTS) {
    file = `${process.env.SHOTS}/${dev.label.replace(/[^\w]+/g, '_')}__${state.replace(/[^\w]+/g, '_')}.png`;
    await page.screenshot({ path: file }).catch(() => {});
  }
  results.push({ device: dev.label, kind: dev.kind, touch: dev.touch, state, scope: res.scope, count: res.count, issues: res.issues, shot: file });
  const bad = res.issues.filter(i => !['sehr klein', 'schrift klein'].includes(i.kind));
  process.stdout.write(bad.length ? `\n  ${state}: ${bad.length} Probleme` : '.');
}

async function open(ctx, { settings } = {}) {
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.addInitScript(s => {
    let x = 11;
    Math.random = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    try {
      if (!sessionStorage.getItem('test-init')) {
        localStorage.clear();
        sessionStorage.setItem('test-init', '1');
        localStorage.setItem('pb_tribe', 'imperius');
        localStorage.setItem('pb_settings_v1', JSON.stringify(s || { bots: 2, stars: 'normal', gamemode: 'conquest', ai: 'normal', mapsize: 'small', maptype: 'continents', onlinebots: '0', humans: '2' }));
      }
    } catch (e) { /* ignore */ }
  }, settings);
  await page.goto(URL_);
  await page.waitForTimeout(500);
  return page;
}

async function startGame(page, mode = 'bot') {
  await page.click('[data-mtab="play"]').catch(() => {});
  await page.click(`[data-mode="${mode}"]`);
  await page.waitForFunction(() => window.__pb && window.__pb.app.state);
  await page.evaluate(() => {
    const { app, R, sync } = window.__pb; const st = app.state;
    if (app.mode !== 'hotseat') while (st.turn !== 'player_1') R.endTurn(st);
    document.getElementById('news').classList.add('hidden');
    sync();
  });
  await page.waitForTimeout(300);
}

const ui = page => page.evaluate(async () => { window.__ui = await import('./js/ui.js'); window.__cfg = await import('./js/config.js'); });

async function closeAll(page) {
  await page.evaluate(() => document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden')));
}

async function runDevice(dev) {
  const ctx = await browser.newContext({ ...dev.opts });
  await cdn(ctx);
  // --- Menü ---------------------------------------------------------------
  let page = await open(ctx);
  if (!(await page.isVisible('#menu-overlay'))) await page.evaluate(() => document.getElementById('menu-overlay').classList.remove('hidden'));
  await record(page, dev, 'Menü: Spielen');
  // Jeden Einstellungs-Knopf und jeden Stamm drücken.
  const chips = await page.$$eval('#mpane-play [data-gamemode], #mpane-play [data-mapsize], #mpane-play [data-maptype], #mpane-play [data-ai], #mpane-play [data-bots], #mpane-play [data-humans], #mpane-play [data-onlinebots], #mpane-play [data-stars], #mpane-play [data-theme-pick]', l => l.map(e => { const a = [...e.attributes].find(x => x.name.startsWith('data-')); return `[${a.name}="${a.value}"]`; }));
  for (const c of chips) await page.click(c, { timeout: 8000 }).catch(e => results.push({ device: dev.label, state: 'Menü: Einstellung ' + c, issues: [{ kind: 'nicht klickbar', el: c, info: e.message.split('\n')[0] }], count: 1 }));
  await record(page, dev, 'Menü: Spielen nach allen Einstellungen');
  await page.click('[data-theme-pick="light"]').catch(() => {});
  const tribes = await page.$$eval('#tribe-pick button', l => l.length);
  for (let i = 0; i < tribes; i++) {
    await page.locator('#tribe-pick button').nth(i).click({ timeout: 2000 }).catch(() => {});
  }
  await record(page, dev, 'Menü: Stammwahl (letzter Stamm)');
  for (const t of ['campaign', 'board', 'profile', 'help']) {
    await page.click(`[data-mtab="${t}"]`);
    await page.waitForTimeout(300);
    await record(page, dev, `Menü: ${{ campaign: 'Kampagne', board: 'Bestenliste', profile: 'Profil', help: 'Anleitung' }[t]}`);
    if (t === 'board') { await page.click('[data-board="weekly"]').catch(() => {}); await record(page, dev, 'Menü: Bestenliste Woche'); }
  }
  await page.click('[data-pname]').catch(() => {});
  await record(page, dev, 'Namen wählen');
  await page.click('#nameCancel').catch(() => {});
  await page.click('[data-pcode]').catch(() => {});
  await record(page, dev, 'Profil-Code');
  await page.close();

  // --- Partie gegen KI ----------------------------------------------------
  page = await open(ctx);
  await startGame(page);
  await ui(page);
  await record(page, dev, 'Spiel: Leiste oben, nichts gewählt');
  await page.evaluate(() => { window.__ui.setIdle(3); });
  await record(page, dev, 'Spiel: mit Knopf „Bereit“');
  await page.keyboard.press(' ');
  await record(page, dev, 'Einheit gewählt');
  await page.click('#unit-chip [data-details]').catch(() => {});
  await record(page, dev, 'Einheit: Details aufgeklappt');
  await page.keyboard.press('Escape');
  // Alles erforscht, viele Sterne: Stadt mit allen Möglichkeiten.
  await page.evaluate(() => {
    const { app, sync } = window.__pb; const st = app.state;
    st.stars.player_1 = 999; st.techs.player_1 = Object.keys(window.__cfg.TECHS);
    const c = st.cities.find(x => x.owner === 'player_1');
    st.units = st.units.filter(u => !(u.q === c.q && u.r === c.r));
    app.sel = { kind: 'city', q: c.q, r: c.r }; sync();
  });
  await record(page, dev, 'Stadt gewählt (alles erforscht, 999 Sterne)');
  const more = await page.$('#panel [data-details], #panel .tt-more, #panel [data-more]');
  if (more) { await more.click().catch(() => {}); await record(page, dev, 'Stadt: mehr aufgeklappt'); }
  await page.click('#panel [data-build-open]').catch(() => {});
  await page.waitForTimeout(400);
  await record(page, dev, 'Stadt ausbauen');
  const opts = await page.$$('.bopt');
  if (opts.length) { await record(page, dev, 'Stadt ausbauen: Gebäudeliste'); }
  // anderes Feld wählen
  await page.keyboard.press('ArrowRight');
  await record(page, dev, 'Stadt ausbauen: anderes Feld');
  await page.click('#buildClose').catch(() => {});
  // Ausbildung: jede Einheit, die die Stadt anbietet
  await page.evaluate(() => {
    const { app, sync } = window.__pb; const st = app.state;
    const c = st.cities.find(x => x.owner === 'player_1');
    app.sel = { kind: 'city', q: c.q, r: c.r }; sync();
  });
  // Einheiten verschiedener Arten nacheinander wählen.
  const types = await page.evaluate(() => Object.keys(window.__cfg.UNITS));
  for (const type of types) {
    const ok = await page.evaluate(type => {
      const { app, R, sync } = window.__pb; const st = app.state;
      const def = window.__cfg.UNITS[type];
      const c = st.cities.find(x => x.owner === 'player_1');
      const naval = def.naval || def.domain === 'sea' || /boat|ship/.test(type);
      st.units = st.units.filter(u => u.id !== 'audit');
      let pos = null;
      for (let d = 0; d < 4 && !pos; d++) for (let q = c.q - d; q <= c.q + d && !pos; q++) for (let r = c.r - d; r <= c.r + d && !pos; r++) {
        const t = R.terrainAt(st, q, r);
        if (!t || R.unitAt(st, q, r)) continue;
        const water = t === 'water' || t === 'ocean';
        if (naval ? water : !water) pos = { q, r };
      }
      if (!pos) return false;
      st.units.push({ id: 'audit', owner: 'player_1', type, q: pos.q, r: pos.r, hp: Math.max(1, (def.hp || 10) - 3), mp: def.move || 1, hasMoved: false, acted: false, veteran: true, kills: 3 });
      app.sel = { kind: 'unit', id: 'audit' }; sync();
      return true;
    }, type);
    if (!ok) continue;
    // Aufgeklappt zeigt die Werkzeugreihe alles, was die Einheit kann.
    const det = await page.$('#unit-chip [data-details]');
    if (det && await det.isVisible()) { await det.click().catch(() => {}); await record(page, dev, `Einheit ${type}: Details`); await page.keyboard.press('i'); }
    else await record(page, dev, `Einheit gewählt: ${type}`);
  }
  await page.evaluate(() => { const { app, sync } = window.__pb; app.state.units = app.state.units.filter(u => u.id !== 'audit'); app.sel = null; sync(); });
  // Forschung
  await page.evaluate(() => { const { app, sync } = window.__pb; const st = app.state; st.techs.player_1 = st.techs.player_1.slice(0, 3); sync(); });
  await page.click('#techBtn');
  await page.waitForTimeout(400);
  await record(page, dev, 'Forschung');
  const hex = await page.$('.tech-hex.ready') || await page.$('.tech-hex');
  if (hex) {
    const b = await hex.boundingBox();
    if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await record(page, dev, 'Forschung: Technologie gewählt');
  }
  if (await page.isVisible('#tech-jump')) {
    const jumps = await page.$$('#tech-jump [data-jump]');
    if (jumps.length) { await jumps[jumps.length - 1].click().catch(() => {}); await record(page, dev, 'Forschung: Sprung zum letzten Zweig'); }
  }
  await page.click('#techClose').catch(() => {});
  // Übersicht
  await page.click('#overviewBtn');
  await page.waitForTimeout(300);
  for (const t of ['staedte', 'armee', 'diplomatie', 'monumente']) {
    await page.click(`[data-ovtab="${t}"]`).catch(() => {});
    await record(page, dev, `Übersicht: ${t}`);
  }
  await page.click('[data-ovtab="diplomatie"]').catch(() => {});
  const war = await page.$('[data-war]');
  if (war) { await war.click().catch(() => {}); await page.waitForTimeout(200); await record(page, dev, 'Rückfrage: Krieg erklären'); await page.click('#confirmNo').catch(() => {}); }
  await page.click('#overviewClose').catch(() => {});
  // Menü im Spiel
  await page.click('#menuBtn');
  await page.waitForTimeout(300);
  await record(page, dev, 'Menü im Spiel');
  // Online-Partie: Aufgeben und Plätze abgeben, Liste der eigenen Partien (nachgebildet).
  const hasOnline = await page.evaluate(() => {
    if (!window.__ui.renderOnlineActions) return false;
    window.__ui.renderOnlineActions([{ label: 'Aufgeben', resign: true }, { label: 'Freien Platz von Spieler 3 an die KI geben' }, { label: 'Abwesenden Spieler Xin-Xi an die KI geben' }]);
    const now = Date.now();
    window.__ui.renderMyMatches([
      { id: 'a', round: 12, last_move_at: new Date(now - 6e5).toISOString(), myTurn: true, open: true, me: 'player_1' },
      { id: 'b', round: 3, last_move_at: new Date(now - 5 * 36e5).toISOString(), open: true, waiting: true, me: 'player_1' },
      { id: 'c', round: 27, last_move_at: new Date(now - 3 * 864e5).toISOString(), open: true, turnName: 'Wüstenfuchs-Stamm Langname', me: 'player_1' },
      { id: 'd', round: 30, last_move_at: new Date(now - 9 * 864e5).toISOString(), winner: 'player_2', me: 'player_1' },
      { id: 'e', round: 8, last_move_at: new Date(now - 2 * 864e5).toISOString(), abandoned: true, me: 'player_1' }]);
    return true;
  });
  if (hasOnline) {
    await page.click('[data-mtab="play"]').catch(() => {});
    await record(page, dev, 'Menü im Spiel: Online-Knöpfe und eigene Partien');
    await page.click('[data-online-act="0"]').catch(() => {});
    await page.waitForTimeout(200);
    if (!(await page.isVisible('#confirm-overlay'))) await page.evaluate(() => window.__ui.showConfirm('Wirklich aufgeben? Dein Stamm wird ab sofort von der KI gespielt, das lässt sich nicht rückgängig machen.', () => {}, { yes: 'Aufgeben' }));
    await record(page, dev, 'Rückfrage: Aufgeben');
    await page.click('#confirmNo').catch(() => {});
    await page.evaluate(() => window.__ui.showConfirm('Abwesenden Spieler Xin-Xi an die KI geben? Das lässt sich nicht rückgängig machen.', () => {}, { yes: 'An die KI geben' }));
    await record(page, dev, 'Rückfrage: An die KI geben');
    await page.click('#confirmNo').catch(() => {});
    await page.evaluate(() => { window.__ui.renderOnlineActions([]); window.__ui.renderMyMatches([]); window.__ui.showMenu(); });
  }
  await page.click('#continueBtn').catch(() => closeAll(page));
  // Tipp der KI
  await page.click('#coachBtn').catch(() => {});
  await page.waitForTimeout(400);
  await record(page, dev, 'Tipp der KI');
  await page.click('[data-co-close]').catch(() => {});
  // Rundenbericht
  await page.evaluate(() => { const { app, R, sync } = window.__pb; const st = app.state; R.endTurn(st); while (st.turn !== 'player_1') R.endTurn(st); sync(); });
  await page.evaluate(() => {
    window.__ui.showNews({ round: 2, lines: [], items: [], events: [] });
  }).catch(() => {});
  await page.keyboard.press('b');
  await record(page, dev, 'Rundenbericht');
  await page.evaluate(() => window.__ui.hideNews());
  // Zug beenden mit bereiten Einheiten -> Rückfrage
  await page.evaluate(() => { const { app, sync } = window.__pb; for (const u of app.state.units) if (u.owner === 'player_1') { u.acted = false; u.hasMoved = false; } sync(); });
  await page.click('#endTurnBtn').catch(() => {});
  await page.waitForTimeout(300);
  if (!(await page.isVisible('#confirm-overlay'))) await page.evaluate(() => window.__ui.showConfirm('Noch bereit: 3 Krieger, 1 Reiter und 2 Bogenschützen. Zug trotzdem beenden?', () => {}));
  await record(page, dev, 'Rückfrage (Zug beenden)');
  await page.click('#confirmNo').catch(() => {});
  // Stadt steigt auf: jede Stufe
  for (const lvl of [2, 3, 4, 5]) {
    await page.evaluate(lvl => { const { app } = window.__pb; const st = app.state; const c = st.cities.find(x => x.owner === 'player_1'); c.pending = [lvl]; window.__ui.showReward(st, c, {}); }, lvl);
    await record(page, dev, `Stadt steigt auf: Stufe ${lvl}`);
    await closeAll(page);
  }
  await page.evaluate(() => { const st = window.__pb.app.state; for (const c of st.cities) c.pending = []; });
  // Spielende: Sieg mit allen Knöpfen
  await page.evaluate(() => {
    const { app, R, sync } = window.__pb; const st = app.state;
    for (const c of st.cities) c.owner = 'player_1'; R.checkWinner(st); sync();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__ui.offerHarder('hard', 'Schwer'); ['winnerEasier', 'winnerRetry'].forEach(id => document.getElementById(id).classList.remove('hidden')); });
  await record(page, dev, 'Spielende: Sieg (alle Knöpfe)');
  await page.click('#winnerMap').catch(() => {});
  await page.waitForTimeout(400);
  await record(page, dev, 'Wiederholung');
  await page.click('#rpPlay').catch(() => {});
  await record(page, dev, 'Wiederholung läuft');
  await page.evaluate(() => { window.__ui.setReplay(null); window.__ui.setReview(true); });
  await record(page, dev, 'Karte ansehen (Leiste unten)');
  await page.evaluate(() => { window.__ui.setReview(false); try { window.__ui.showDefeat(window.__pb.app.state, { mode: 'bot' }); } catch (e) { } });
  await page.waitForTimeout(200);
  await record(page, dev, 'Spielende: Niederlage');
  await page.close();

  // --- Tutorial -----------------------------------------------------------
  page = await open(ctx);
  await page.click('[data-mtab="play"]').catch(() => {});
  await page.click('[data-mode="tutorial"]').catch(() => {});
  await page.waitForTimeout(800);
  await record(page, dev, 'Tutorial');
  await page.click('[data-tu-next]').catch(() => {});
  await record(page, dev, 'Tutorial: Schritt 2');
  await page.close();

  // --- Hotseat: Spielerwechsel ---------------------------------------------
  page = await open(ctx);
  await page.click('[data-mtab="play"]').catch(() => {});
  await page.click('[data-mode="hotseat"]').catch(() => {});
  await page.waitForTimeout(800);
  if (!(await page.isVisible('#handover-overlay'))) { await ui(page); await page.evaluate(() => window.__ui.showHandover('Spieler Nummer 2 (Xin-Xi)', () => {})); }
  await record(page, dev, 'Hotseat: Spielerwechsel');
  await page.close();

  // --- Kampagne: Mission mit Ziel-Leiste ------------------------------------
  page = await open(ctx);
  await page.click('[data-mtab="campaign"]').catch(() => {});
  await page.click('[data-mission="m1"]').catch(() => {});
  await page.waitForTimeout(800);
  await record(page, dev, 'Kampagne: Mission 1');
  await page.close();

  // --- Tages- und Wochenherausforderung --------------------------------------
  for (const m of ['daily', 'weekly']) {
    page = await open(ctx);
    await page.click('[data-mtab="play"]').catch(() => {});
    await page.click(`[data-mode="${m}"]`).catch(() => {});
    await page.waitForTimeout(900);
    await record(page, dev, m === 'daily' ? 'Tagesherausforderung' : 'Wochen-Herausforderung');
    await page.close();
  }

  // --- Online (Server nachgebildet) ----------------------------------------
  page = await open(ctx);
  await page.click('[data-mtab="play"]').catch(() => {});
  await page.click('[data-mode="online"]').catch(() => {});
  await page.waitForTimeout(800);
  await record(page, dev, 'Online');
  await page.close();

  await ctx.close();
}

const t0 = Date.now();
for (const dev of DEVICES) {
  process.stdout.write(`\n${dev.label}`);
  try { await runDevice(dev); } catch (e) { console.log(`\n  FEHLER ${e.message.split('\n')[0]}`); results.push({ device: dev.label, state: 'Ablauf', issues: [{ kind: 'fehler', el: '-', info: e.message.split('\n')[0] }], count: 0 }); }
}
await browser.close();
server.close();
const out = process.env.OUT || 'ui-audit.json';
await writeFile(out, JSON.stringify(results, null, 1));
const bad = results.flatMap(r => r.issues.filter(i => !['sehr klein', 'schrift klein'].includes(i.kind)));
console.log(`\n\n${results.length} Ansichten, ${results.reduce((a, r) => a + (r.count || 0), 0)} Knopf-Prüfungen, ${bad.length} Probleme (${((Date.now() - t0) / 1000).toFixed(0)} s). Ergebnis: ${out}`);
