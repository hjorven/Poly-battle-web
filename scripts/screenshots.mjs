// Nimmt die Bilder für README und Wiki im echten Spiel auf (Chromium über Playwright).
// Fester Zufall, damit die Bilder bei jedem Lauf gleich aussehen.
// Aufruf: npm run screenshots   → schreibt docs/screenshot.png, docs/city.png, docs/build.png
// PB_CHROMIUM: eigener Chromium-Pfad, falls Playwrights eigener fehlt.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = new URL('../docs/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = path === '/' || path === '\\' ? 'index.html' : path;
  try {
    const body = await readFile(join(ROOT, file));
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (e) {
    res.writeHead(404); res.end();
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.PB_CHROMIUM || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1, colorScheme: 'light' });
const page = await ctx.newPage();
page.on('pageerror', e => console.error('Fehler auf der Seite:', e.message));
await page.route(/supabase\.co/, route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
const SEED = Number(process.env.PB_SEED || 7);
await page.addInitScript(seed => {
  let x = seed;
  Math.random = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  try {
    if (!sessionStorage.getItem('shot-init')) {
      localStorage.clear();
      sessionStorage.setItem('shot-init', '1');
      localStorage.setItem('pb_tribe', 'imperius');
      localStorage.setItem('pb_settings_v1', JSON.stringify({ bots: 2, stars: 'normal', gamemode: 'conquest', ai: 'normal', mapsize: 'small', maptype: 'continents', onlinebots: '0', humans: '2' }));
    }
  } catch (e) { /* ignore */ }
}, SEED);
await page.goto(URL_);
await page.waitForTimeout(500);

// Partie gegen die KI starten und 17 Runden lang alle Stämme (auch den eigenen) von der KI spielen lassen.
await page.click('[data-mtab="play"]').catch(() => {});
await page.click('[data-mode="bot"]');
await page.waitForFunction(() => window.__pb && window.__pb.app.state);
await page.evaluate(async rounds => {
  const { app, R, botStep, sync } = window.__pb;
  const { applyStep } = await import('./js/ai.js');
  const st = app.state;
  for (let i = 0; i < rounds * st.players.length && !st.winner; i++) {
    const pl = st.turn; let k = 0;
    while (st.turn === pl && k++ < 300) { const s = botStep(st, pl); if (!s) break; applyStep(st, s, pl); }
    if (st.turn === pl) R.endTurn(st);
  }
  while (st.turn !== 'player_1') R.endTurn(st);
  for (const c of st.cities) c.pending = [];
  document.getElementById('news').classList.add('hidden');
  sync();
}, 17);
await page.waitForTimeout(500);
await page.click('[data-news-close]').catch(() => {});
console.log('Städte:', await page.evaluate(() => window.__pb.app.state.cities.filter(c => c.owner === 'player_1').length));

// 1. Übersicht: Kamera auf die Hauptstadt.
await page.keyboard.press('h');
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT + 'screenshot.png' });

// 2. Hauptstadt gewählt: Schild an der Stadt und Werkzeugreihe.
await page.evaluate(() => {
  const { app, sync } = window.__pb; const st = app.state;
  const TERRAIN_WALK = (st, q, r) => ['field', 'forest', 'hills'].includes(st.terrain[r * st.mapW + q]);
  const c = st.cities.find(x => x.owner === 'player_1' && x.isCapital) || st.cities.find(x => x.owner === 'player_1');
  st.stars.player_1 = Math.max(st.stars.player_1, 30);
  // Einheit aus der Stadt auf ein freies Nachbarfeld stellen, damit die Werkzeugreihe Einheiten anbietet.
  const u = st.units.find(x => x.q === c.q && x.r === c.r);
  if (u) {
    const free = window.__pb.R.cityTiles(st, c).find(([q, r]) => (q !== c.q || r !== c.r) && TERRAIN_WALK(st, q, r) && !st.units.some(x => x.q === q && x.r === r));
    if (free) [u.q, u.r] = free;
  }
  app.sel = { kind: 'city', q: c.q, r: c.r }; sync();
});
await page.waitForTimeout(800);
await page.screenshot({ path: OUT + 'city.png' });

// 3. Bau-Fenster der Hauptstadt. Damit rechts Bauoptionen mit Ertragsvorschau stehen,
// wird ein bebautes Feld neben der Stadt wieder frei gemacht und gewählt.
const pick = await page.evaluate(() => {
  const { app, R, sync } = window.__pb; const st = app.state;
  const c = st.cities.find(x => x.owner === 'player_1' && x.isCapital) || st.cities.find(x => x.owner === 'player_1');
  const imp = st.improvements || {};
  const tiles = R.cityTiles(st, c).filter(([q, r]) => (q !== c.q || r !== c.r) && st.terrain[r * st.mapW + q] === 'field' && !st.units.some(u => u.q === q && u.r === r));
  const f = tiles.find(([q, r]) => !imp[q + ',' + r] && !st.resources[q + ',' + r]) || tiles.find(([q, r]) => imp[q + ',' + r]);
  if (!f) return null;
  delete imp[f[0] + ',' + f[1]];
  app.sel = { kind: 'city', q: c.q, r: c.r }; sync();
  return f[0] + ',' + f[1];
});
await page.waitForTimeout(800);
await page.click('#panel [data-build-open]');
await page.waitForTimeout(1200);
if (pick) await page.click(`#build-map [data-hex="${pick}"]`).catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: OUT + 'build.png' });

await browser.close();
server.close();
console.log('Bilder geschrieben nach docs/');
