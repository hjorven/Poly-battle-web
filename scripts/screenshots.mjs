// Nimmt die Bilder für README und Wiki im echten Spiel auf (Chromium über Playwright).
// Fester Zufall, damit die Bilder bei jedem Lauf gleich aussehen.
// Aufruf: npm run screenshots   → schreibt docs/menu.png, docs/screenshot.png, docs/city.png, docs/build.png
// Dunkle Darstellung, so wie das Spiel bei dunkler Systemeinstellung aussieht.
// PB_CHROMIUM (oder CHROMIUM): eigener Chromium-Pfad, siehe scripts/chromium-path.mjs.

import { chromium } from 'playwright';
import { chromiumPath } from './chromium-path.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

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

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1, colorScheme: 'dark' });
const page = await ctx.newPage();
page.on('pageerror', e => console.error('Fehler auf der Seite:', e.message));
await page.route(/supabase\.co/, route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
const SEED = Number(process.env.PB_SEED || 21);
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

// Headless-Chromium (SwiftShader) spiegelt bei einer Aufnahme des ganzen Fensters manchmal die
// Fläche eines Kärtchens oben als leeren Kasten an den unteren Rand der 3D-Szene. Aufnahmen
// der oberen und unteren Hälfte einzeln sind sauber, deshalb werden zwei Hälften zusammengesetzt.
function decodePng(png) {
  let i = 8, w = 0, h = 0, bpp = 3; const idat = [];
  while (i < png.length) {
    const len = png.readUInt32BE(i), type = png.toString('ascii', i + 4, i + 8);
    if (type === 'IHDR') { w = png.readUInt32BE(i + 8); h = png.readUInt32BE(i + 12); bpp = png[i + 17] === 6 ? 4 : 3; }
    if (type === 'IDAT') idat.push(png.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * w * 3);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      cur[x] = (raw[src + x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    for (let x = 0; x < w; x++) cur.copy(out, (y * w + x) * 3, x * bpp, x * bpp + 3);
    [prev, cur] = [cur, prev];
  }
  return { w, h, rgb: out };
}
function encodePng(w, h, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
async function shoot(file) {
  const { width, height } = page.viewportSize(), half = Math.floor(height / 2);
  const top = decodePng(await page.screenshot({ clip: { x: 0, y: 0, width, height: half } }));
  const bottom = decodePng(await page.screenshot({ clip: { x: 0, y: half, width, height: height - half } }));
  writeFileSync(OUT + file, encodePng(width, height, Buffer.concat([top.rgb, bottom.rgb])));
}

await page.goto(URL_);
await page.waitForTimeout(500);

// 0. Hauptmenü, Reiter „Spielen“.
await page.click('[data-mtab="play"]').catch(() => {});
await page.waitForTimeout(600);
await shoot('menu.png');

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
await shoot('screenshot.png');

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
await shoot('city.png');

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
await shoot('build.png');

await browser.close();
server.close();
console.log('Bilder geschrieben nach docs/');
