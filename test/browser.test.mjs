// Browser-Tests: das echte Spiel in Chromium (Playwright) auf PC-, iPad- und
// Handy-Größe. Startet einen eigenen kleinen Webserver.
// Aufruf: npm run test:browser          (alle)
//         npm run test:browser -- stadt  (nur Tests, deren Name „stadt“ enthält)

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert';

const ROOT = new URL('..', import.meta.url).pathname;
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

const DEVICES = {
  pc: { viewport: { width: 1400, height: 860 } },
  ipadQuer: { viewport: { width: 1080, height: 700 }, hasTouch: true, isMobile: true },
  ipadHoch: { viewport: { width: 810, height: 950 }, hasTouch: true, isMobile: true },
  handy: { viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true }
};

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const only = process.argv[2] ? process.argv[2].toLowerCase() : null;
let passed = 0, failed = 0;

// Neue Seite mit festem Zufall und leerem Speicher; sammelt Fehler der Seite.
async function open(device = 'pc', { scheme = 'light', online = false } = {}) {
  const ctx = await browser.newContext({ ...DEVICES[device], colorScheme: scheme });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  // Keine echten Serveraufrufe (Online, Bestenliste) aus Tests.
  await page.route(/supabase\.co/, route => route.fulfill({ status: 200, contentType: 'application/json', body: online ? 'null' : '[]' }));
  await page.addInitScript(() => {
    let x = 11;
    Math.random = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    try {
      if (!sessionStorage.getItem('test-init')) {
        localStorage.clear();
        sessionStorage.setItem('test-init', '1');
        localStorage.setItem('pb_tribe', 'imperius');
        localStorage.setItem('pb_settings_v1', JSON.stringify({ bots: 2, stars: 'normal', gamemode: 'conquest', ai: 'normal', mapsize: 'small', maptype: 'continents', onlinebots: '0', humans: '2' }));
      }
    } catch (e) { /* ignore */ }
  });
  await page.goto(URL_);
  await page.waitForTimeout(400);
  return page;
}

// Partie gegen die KI starten; optional ein paar Runden von der KI spielen lassen.
async function startGame(page, { rounds = 0 } = {}) {
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
  }, rounds);
  await page.waitForTimeout(300);
}

async function test(name, fn) {
  if (only && !name.toLowerCase().includes(only)) return;
  const start = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name} (${((Date.now() - start) / 1000).toFixed(1)} s)`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${String(e.message).split('\n')[0]}`);
  }
}

const noErrors = page => assert.deepStrictEqual(page.errors, [], 'Fehler auf der Seite');

// --- Tests --------------------------------------------------------------------------

await test('Menü passt ohne Scrollen aufs iPad (hoch und quer)', async () => {
  for (const d of ['ipadHoch', 'ipadQuer']) {
    const page = await open(d);
    const over = await page.evaluate(() => { const o = document.getElementById('menu-overlay'); return o.scrollHeight - o.clientHeight; });
    assert.ok(over <= 0, `${d}: Menü ragt ${over} px über den Bildschirm`);
    noErrors(page);
    await page.context().close();
  }
});

await test('Menü: Reiter wechseln, Einstellungen bleiben nach Neuladen', async () => {
  const page = await open('pc');
  await page.click('[data-mtab="profile"]');
  assert.ok(await page.isVisible('#mpane-profile'));
  await page.click('[data-mtab="play"]');
  await page.click('[data-mapsize="large"]');
  await page.reload();
  await page.waitForTimeout(300);
  assert.strictEqual(await page.$eval('[data-mapsize].active', e => e.dataset.mapsize), 'large');
  noErrors(page);
  await page.context().close();
});

await test('Obere Leiste: alle Knöpfe sichtbar von 360 bis 1400 px', async () => {
  for (const w of [360, 390, 560, 810, 1080, 1400]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 760 }, hasTouch: w < 1100, isMobile: w < 900 });
    const page = await ctx.newPage();
    await page.route(/supabase\.co/, r => r.fulfill({ status: 200, body: '[]' }));
    await page.goto(URL_);
    await startGame(page);
    for (const id of ['techBtn', 'overviewBtn', 'menuBtn', 'endTurnBtn']) {
      const r = await page.$eval('#' + id, e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width }; });
      assert.ok(r.w > 0 && r.l >= 0 && r.r <= w + 0.5, `${w} px: ${id} nicht ganz sichtbar`);
    }
    await ctx.close();
  }
});

await test('Stadt: Schild und Werkzeugreihe, Bau-Fenster in 3D, Farm bauen', async () => {
  for (const d of ['pc', 'ipadQuer']) {
    const page = await open(d);
    await startGame(page);
    const c = await page.evaluate(() => {
      const { app, R, sync } = window.__pb; const st = app.state;
      st.stars.player_1 = 50; st.techs.player_1.push('organization', 'farming');
      const c = st.cities.find(x => x.owner === 'player_1');
      for (const [q, r] of R.cityTiles(st, c)) if (q !== c.q || r !== c.r) { st.terrain[r * st.mapW + q] = 'field'; delete st.resources[q + ',' + r]; }
      st.units = st.units.filter(u => !(u.q === c.q && u.r === c.r));
      app.sel = { kind: 'city', q: c.q, r: c.r }; sync();
      return { q: c.q, r: c.r };
    });
    await page.waitForTimeout(300);
    assert.ok(await page.isVisible('#anchor-tag'), 'Schild an der Stadt');
    assert.ok(await page.isVisible('#panel.toolbar [data-build-open]'), 'Werkzeugreihe mit Ausbauen');
    await page.click('#panel [data-build-open]');
    await page.waitForTimeout(400);
    assert.ok(await page.isVisible('.build-map.b3 canvas'), '3D-Ansicht im Bau-Fenster');
    const inc0 = await page.evaluate(() => window.__pb.R.incomeFor(window.__pb.app.state, 'player_1'));
    await page.locator('.bopt', { hasText: 'Farm' }).first().click();
    await page.waitForTimeout(500);
    const inc1 = await page.evaluate(() => window.__pb.R.incomeFor(window.__pb.app.state, 'player_1'));
    assert.ok(inc1 > inc0, `Einkommen ${inc0} -> ${inc1}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert.ok(!(await page.isVisible('#build-overlay')), 'Esc schließt das Bau-Fenster');
    noErrors(page);
    await page.context().close();
  }
});

await test('Einheit: Schild folgt der Kamera, Esc hebt Auswahl auf', async () => {
  const page = await open('pc');
  await startGame(page);
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  assert.ok(await page.isVisible('#anchor-tag'), 'Schild an der Einheit');
  assert.ok(await page.isVisible('#unit-chip'), 'Werkzeugreihe der Einheit');
  const x0 = await page.$eval('#anchor-tag', e => e.style.left);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(500);
  assert.notStrictEqual(await page.$eval('#anchor-tag', e => e.style.left), x0, 'Schild bewegt sich mit');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.ok(!(await page.isVisible('#anchor-tag')), 'Schild weg nach Esc');
  noErrors(page);
  await page.context().close();
});

await test('Forschung: Schrift mindestens 12 px, Technologie erforschen', async () => {
  for (const d of ['pc', 'ipadHoch', 'handy']) {
    const page = await open(d);
    await startGame(page);
    await page.evaluate(() => { window.__pb.app.state.stars.player_1 = 30; window.__pb.sync(); });
    await page.click('#techBtn');
    await page.waitForTimeout(400);
    const px = await page.evaluate(() => {
      const el = document.querySelector('.tech-hex .tn-name');
      const t = getComputedStyle(document.getElementById('tech-viewport')).transform;
      return parseFloat(getComputedStyle(el).fontSize) * (t && t !== 'none' ? parseFloat(t.split('(')[1]) : 1);
    });
    assert.ok(px >= 11.9, `${d}: Schrift ${px.toFixed(1)} px`);
    const n0 = await page.evaluate(() => window.__pb.app.state.techs.player_1.length);
    const hex = await page.$('.tech-hex.ready');
    const box = await hex.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.click('.td-buy');
    await page.waitForTimeout(300);
    assert.strictEqual(await page.evaluate(() => window.__pb.app.state.techs.player_1.length), n0 + 1);
    noErrors(page);
    await page.context().close();
  }
});

await test('Darstellung: Dunkel wirkt sofort und bleibt nach Neuladen', async () => {
  const page = await open('pc');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await bg();
  await page.click('[data-mtab="play"]');
  await page.click('[data-theme-pick="dark"]');
  const dark = await bg();
  assert.notStrictEqual(dark, light);
  await page.reload();
  await page.waitForTimeout(300);
  assert.strictEqual(await bg(), dark);
  noErrors(page);
  await page.context().close();
});

await test('Zufallstest: 150 zufällige Klicks und Tasten ohne Fehler', async () => {
  for (const d of ['pc', 'handy']) {
    const page = await open(d);
    await startGame(page);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const vp = DEVICES[d].viewport;
    const keys = [' ', 'Enter', 't', 'o', 'b', 'Escape', 'ArrowLeft', 'q', 'h'];
    for (let i = 0; i < 150; i++) {
      const r = rnd();
      if (r < 0.5) await page.mouse.click(Math.floor(rnd() * vp.width), Math.floor(rnd() * vp.height));
      else if (r < 0.8) {
        const btns = await page.$$('button:visible');
        const b = btns[Math.floor(rnd() * btns.length)];
        const txt = b ? await b.innerText().catch(() => '') : '';
        if (b && !/Online|Link|Menü|Tutorial beenden/.test(txt)) await b.click({ timeout: 400 }).catch(() => {});
      } else await page.keyboard.press(keys[Math.floor(rnd() * keys.length)]);
    }
    await page.waitForTimeout(1500);
    const busy = await page.evaluate(() => window.__pb.app.busy);
    assert.strictEqual(busy, false, 'Spiel hängt (busy)');
    noErrors(page);
    await page.context().close();
  }
});

await browser.close();
server.close();
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed) process.exit(1);
