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
  handy: { viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true },
  // iPhone SE quer: die kleinste übliche Handy-Fläche im Querformat.
  handyQuer: { viewport: { width: 667, height: 375 }, screen: { width: 375, height: 667 }, hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
};

// PB_CHROMIUM: eigener Chromium-Pfad, falls Playwrights eigener fehlt.
const browser = await chromium.launch({ executablePath: process.env.PB_CHROMIUM || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
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
    // Auf GitHub als Hinweis an den Lauf hängen, dann steht der Fehler direkt im PR.
    if (process.env.GITHUB_ACTIONS) {
      const msg = String(e.message).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A').slice(0, 1500);
      console.log(`::error title=${name.replace(/[,:]/g, ' ')}::${msg}`);
    }
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

await test('Ohne fremde Server: Spiel startet, Menü reagiert', async () => {
  const ctx = await browser.newContext(DEVICES.pc);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  // Alles außer dem eigenen Webserver sperren (CDN, Supabase).
  await page.route(url => !url.href.startsWith(URL_), route => route.abort());
  await page.goto(URL_);
  await startGame(page);
  assert.ok(await page.isVisible('#endTurnBtn'), 'Spiel läuft nicht');
  assert.deepStrictEqual(page.errors, [], 'Fehler auf der Seite');
  await ctx.close();
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

await test('Obere Leiste: alle Knöpfe sichtbar von 320 bis 1400 px', async () => {
  for (const w of [320, 340, 360, 390, 560, 810, 1080, 1400]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 760 }, hasTouch: w < 1100, isMobile: w < 900 });
    const page = await ctx.newPage();
    await page.route(/supabase\.co/, r => r.fulfill({ status: 200, body: '[]' }));
    await page.goto(URL_);
    await startGame(page);
    const box = id => page.$eval('#' + id, e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, w: b.width }; });
    const visible = async ids => {
      for (const id of ids) {
        const r = await box(id);
        assert.ok(r.w > 0 && r.l >= 0 && r.r <= w + 0.5, `${w} px: ${id} nicht ganz sichtbar`);
      }
    };
    // Handy: zugeklappt alles in einer Zeile, der Rest hinter „Mehr“.
    if (await page.evaluate(() => document.documentElement.classList.contains('phone'))) {
      await visible(['techBtn', 'moreBtn', 'endTurnBtn']);
      assert.strictEqual((await box('techBtn')).t, (await box('endTurnBtn')).t, `${w} px: Leiste bricht um`);
      await page.click('#moreBtn');
      await visible(['overviewBtn', 'menuBtn', 'coachBtn', 'mapToggleBtn', 'camToggleBtn']);
    } else await visible(['techBtn', 'overviewBtn', 'menuBtn', 'endTurnBtn']);
    await ctx.close();
  }
});

await test('Handy-Ansicht: nach Gerät, nicht nach Fensterbreite oder Drehung', async () => {
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
  const cases = [
    ['PC, schmales Fenster', { viewport: { width: 390, height: 800 } }, false],
    ['iPad quer', DEVICES.ipadQuer, false],
    ['iPad hoch', DEVICES.ipadHoch, false],
    ['Handy hoch', DEVICES.handy, true],
    ['Handy quer', { viewport: { width: 760, height: 360 }, screen: { width: 760, height: 360 }, hasTouch: true, isMobile: true, userAgent: android }, true]
  ];
  for (const [name, opts, want] of cases) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    await page.goto(URL_);
    assert.strictEqual(await page.evaluate(() => document.documentElement.classList.contains('phone')), want, name);
    await ctx.close();
  }
});

await test('Handy: Minikarte auf Wunsch, Ansicht im Menü umstellbar', async () => {
  const page = await open('handy');
  await startGame(page);
  assert.ok(!(await page.isVisible('#minimap')), 'Minikarte zuerst aus');
  assert.ok(!(await page.isVisible('#camera-pad')), 'Kamera-Knöpfe zuerst aus');
  assert.ok(!(await page.isVisible('#player-strip')), 'Stämme zuerst eingeklappt');
  await page.click('#moreBtn');
  assert.ok(await page.isVisible('#player-strip'), 'Stämme unter „Mehr“');
  await page.click('#mapToggleBtn');
  assert.ok(await page.isVisible('#minimap'), 'Minikarte eingeschaltet');
  await page.click('#menuBtn');
  assert.ok(!(await page.$eval('#topbar', e => e.classList.contains('more-open'))), 'Mehr klappt nach Menü zu');
  await page.click('[data-mtab="play"]').catch(() => {});
  await page.click('[data-view-pick="large"]');
  assert.ok(!(await page.evaluate(() => document.documentElement.classList.contains('phone'))), 'Groß gewählt');
  await page.reload();
  await page.waitForTimeout(300);
  assert.ok(!(await page.evaluate(() => document.documentElement.classList.contains('phone'))), 'Wahl bleibt nach Neuladen');
  await page.click('[data-mtab="play"]').catch(() => {});
  await page.click('[data-view-pick="auto"]');
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('phone')), 'Automatisch erkennt das Handy');
  noErrors(page);
  await page.context().close();
});

await test('Handy quer: Kamera-Knöpfe nie unter der Leiste, Kacheln ohne Überlauf, Mehr klappt zu', async () => {
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, screen: { width: 640, height: 360 }, hasTouch: true, isMobile: true, userAgent: android });
  const page = await ctx.newPage();
  await page.route(/supabase\.co/, r => r.fulfill({ status: 200, body: '[]' }));
  await page.goto(URL_);
  await startGame(page);
  await page.click('#moreBtn');
  await page.click('#camToggleBtn');
  assert.ok(await page.isVisible('#camera-pad'), 'Kamera eingeschaltet');
  await page.evaluate(() => { document.activeElement.blur(); const { app, sync } = window.__pb; const u = app.state.units.find(x => x.owner === 'player_1'); app.sel = { kind: 'unit', id: u.id }; sync(); });
  await page.waitForTimeout(300);
  assert.ok(await page.isVisible('#unit-chip'), 'Einheit gewählt');
  assert.ok(!(await page.$eval('#topbar', e => e.classList.contains('more-open'))), 'Mehr klappt zu');
  assert.ok(!(await page.isVisible('#camera-pad')), 'Kamera-Knöpfe weg, solange die Leiste offen ist');
  const over = await page.$$eval('#unit-chip .tool-tile', ts => ts.map(t => t.scrollWidth - t.clientWidth).filter(d => d > 1));
  assert.deepStrictEqual(over, [], 'Kachel-Text läuft über');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.ok(await page.isVisible('#camera-pad'), 'Kamera-Knöpfe wieder da');
  await ctx.close();
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

await test('Übersicht: Reiter, Stadt antippen springt hin, Monumente mit Fortschritt', async () => {
  const page = await open('pc');
  await startGame(page, { rounds: 4 });
  await page.click('#overviewBtn');
  await page.waitForTimeout(200);
  assert.ok(await page.isVisible('.ov-table [data-city]'), 'Städte-Tabelle');
  for (const t of ['armee', 'diplomatie', 'monumente']) {
    await page.click(`[data-ovtab="${t}"]`);
    assert.ok(await page.isVisible(`[data-ovtab="${t}"].active`), t);
  }
  assert.strictEqual(await page.$$eval('.ov-mon', l => l.length), 6, 'sechs Monumente');
  await page.click('[data-ovtab="staedte"]');
  await page.click('.ov-table [data-city]');
  await page.waitForTimeout(300);
  assert.ok(!(await page.isVisible('#overview-overlay')), 'Übersicht schließt beim Antippen einer Stadt');
  assert.strictEqual(await page.evaluate(() => window.__pb.app.sel && window.__pb.app.sel.kind), 'city');
  noErrors(page);
  await page.context().close();
});

await test('Kampfvorschau: erster Tipp zeigt beide Einheiten, zweiter greift an', async () => {
  for (const d of ['pc', 'ipadQuer']) {
    const page = await open(d);
    await startGame(page);
    const pos = await page.evaluate(() => {
      const { app, R, sync } = window.__pb; const st = app.state;
      const me = st.units.find(u => u.owner === 'player_1');
      // Freies Landfeld neben dem Krieger suchen und dort einen Gegner hinstellen.
      const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
      for (const [dq, dr] of dirs) {
        const q = me.q + dq, r = me.r + dr;
        const t = R.terrainAt(st, q, r);
        if (t && t !== 'water' && t !== 'ocean' && t !== 'mountain' && !R.unitAt(st, q, r) && !R.cityAt(st, q, r)) {
          st.units.push({ id: 'feind', owner: 'player_2', type: 'warrior', q, r, hp: 10, mp: 1, hasMoved: false, acted: false });
          me.acted = false; me.hasMoved = false; me.mp = 1;
          app.sel = { kind: 'unit', id: me.id }; sync();
          return { q, r };
        }
      }
      return null;
    });
    assert.ok(pos, 'Testaufbau');
    await page.waitForTimeout(300);
    const pt = await page.evaluate(([q, r]) => window.__pb.project(q, r), [pos.q, pos.r]);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(300);
    const tag = await page.$eval('#anchor-tag', e => e.textContent.replace(/\s+/g, ' '));
    assert.ok(/Angriff/.test(tag) && /Nochmal tippen/.test(tag), 'Vorschau am Ziel: ' + tag.slice(0, 80));
    assert.strictEqual(await page.evaluate(() => window.__pb.app.state.units.find(u => u.id === 'feind').hp), 10, 'noch kein Schaden');
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(1500);
    const hp = await page.evaluate(() => { const f = window.__pb.app.state.units.find(u => u.id === 'feind'); return f ? f.hp : 0; });
    assert.ok(hp < 10, 'Angriff ausgeführt');
    noErrors(page);
    await page.context().close();
  }
});

await test('Ritter nach dem Angriff: zieht weiter, Krieger gilt als fertig', async () => {
  const page = await open('pc');
  await startGame(page);
  const setup = await page.evaluate(() => {
    const { app, R, sync } = window.__pb; const st = app.state;
    const me = st.units.find(u => u.owner === 'player_1');
    const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const free = (q, r) => R.terrainAt(st, q, r) === 'field' && !R.unitAt(st, q, r) && !R.cityAt(st, q, r);
    const spot = dirs.map(([dq, dr]) => [me.q + dq, me.r + dr]).find(([q, r]) => free(q, r));
    if (!spot) return null;
    // Krieger greift an: danach nichts mehr zu tun.
    st.units.push({ id: 'feind', owner: 'player_2', type: 'warrior', q: spot[0], r: spot[1], hp: 10, mp: 1, hasMoved: false, acted: false });
    me.acted = false; me.hasMoved = false; me.mp = 1;
    R.attack(st, me, st.units.find(u => u.id === 'feind'));
    const warriorIdle = R.idleUnits(st, 'player_1').some(u => u.id === me.id);
    // Ritter (Durchhalten) an derselben Stelle: greift an und darf weiterziehen.
    st.units.find(u => u.id === 'feind').hp = 10;
    me.type = 'knight'; me.hp = 10; me.acted = false; me.hasMoved = false; me.mp = 3;
    R.attack(st, me, st.units.find(u => u.id === 'feind'));
    const knightIdle = R.idleUnits(st, 'player_1').some(u => u.id === me.id);
    const goal = [...R.reachableMap(st, me).keys()][0];
    app.sel = { kind: 'unit', id: me.id }; sync();
    return { warriorIdle, knightIdle, goal, id: me.id };
  });
  assert.ok(setup && setup.goal, 'Testaufbau');
  assert.strictEqual(setup.warriorIdle, false, 'Krieger nach dem Angriff nicht mehr bereit');
  assert.strictEqual(setup.knightIdle, true, 'Ritter nach dem Angriff noch bereit');
  await page.waitForTimeout(300);
  const [q, r] = setup.goal.split(',').map(Number);
  const pt = await page.evaluate(([q, r]) => window.__pb.project(q, r), [q, r]);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(1200);
  const pos = await page.evaluate(id => { const u = window.__pb.app.state.units.find(x => x.id === id); return u.q + ',' + u.r; }, setup.id);
  assert.strictEqual(pos, setup.goal, 'Ritter ist nach dem Angriff weitergezogen');
  noErrors(page);
  await page.context().close();
});

await test('Einheit: Details klappen die Werkzeugreihe auf und wieder zu', async () => {
  const page = await open('ipadQuer');
  await startGame(page);
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  await page.click('#unit-chip [data-details]');
  await page.waitForTimeout(200);
  assert.ok(await page.isVisible('#unit-chip .tb-more'), 'Details sichtbar');
  assert.ok(await page.isVisible('#unit-chip .tool-tile.danger'), 'Auflösen angeboten');
  assert.ok(!(await page.isVisible('#panel')), 'kein altes Seitenfenster');
  await page.keyboard.press('i');
  await page.waitForTimeout(200);
  assert.ok(!(await page.isVisible('#unit-chip .tb-more')), 'Taste I klappt zu');
  noErrors(page);
  await page.context().close();
});

await test('Forschung: Sprungleiste nur wenn nötig, springt zum Zweig', async () => {
  const pc = await open('pc');
  await startGame(pc);
  await pc.click('#techBtn');
  await pc.waitForTimeout(300);
  assert.ok(!(await pc.isVisible('#tech-jump')), 'PC: Baum passt, keine Leiste');
  await pc.context().close();
  const page = await open('ipadHoch');
  await startGame(page);
  await page.click('#techBtn');
  await page.waitForTimeout(300);
  assert.ok(await page.isVisible('#tech-jump'), 'iPad: Leiste sichtbar');
  await page.click('[data-jump="riding"]');
  await page.waitForTimeout(200);
  const inView = await page.evaluate(() => { const h = document.querySelector('[data-tech="riding"]').getBoundingClientRect(); const t = document.getElementById('tech-tree').getBoundingClientRect(); return h.left >= t.left && h.right <= t.right && h.top >= t.top && h.bottom <= t.bottom; });
  assert.ok(inView, 'Reiten nach dem Sprung sichtbar');
  noErrors(page);
  await page.context().close();
});

await test('Wiederholung: nach Spielende abspielen, Regler, Tempo', async () => {
  const page = await open('pc');
  await startGame(page);
  // Partie von der KI für alle Stämme zu Ende spielen lassen.
  await page.evaluate(async () => {
    const { app, R, botStep, sync } = window.__pb;
    const { applyStep } = await import('./js/ai.js');
    const st = app.state;
    for (let i = 0; i < 4 * 120 && !st.winner; i++) {
      const pl = st.turn; let k = 0;
      while (st.turn === pl && k++ < 300) { const s = botStep(st, pl); if (!s) break; applyStep(st, s, pl); }
      if (st.turn === pl && !st.winner) R.endTurn(st);
    }
    if (!st.winner) R.finishByScore(st);
    sync();
  });
  await page.waitForTimeout(500);
  assert.ok(await page.isVisible('#winner-overlay'), 'Ergebnis erscheint');
  await page.click('#winnerMap');
  await page.waitForTimeout(300);
  assert.ok(await page.isVisible('#replay-bar'), 'Wiederholungsleiste');
  const max = Number(await page.$eval('#rpSlider', e => e.max));
  assert.ok(max >= 5, 'mehrere Runden: ' + max);
  await page.$eval('#rpSlider', e => { e.value = '2'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(200);
  assert.match(await page.textContent('#rpLabel'), /Runde 3/);
  await page.click('[data-rpspeed="200"]');
  await page.click('#rpPlay');
  await page.waitForTimeout(1200);
  const v = Number(await page.$eval('#rpSlider', e => e.value));
  assert.ok(v > 2, 'Zeitraffer läuft: ' + v);
  // Bei kurzen Partien kann der Zeitraffer schon am Ende stehen und hat
  // selbst angehalten; dann würde ein Klick ihn neu starten. Endet er genau
  // zwischen Lesen und Klick, startet der Klick ihn neu – dann noch einmal anhalten.
  for (let i = 0; i < 3 && /Anhalten/.test(await page.textContent('#rpPlay')); i++) {
    await page.click('#rpPlay');
    await page.waitForTimeout(100);
  }
  assert.match(await page.textContent('#rpPlay'), /bspielen/);
  await page.click('#reviewBack');
  await page.waitForTimeout(200);
  assert.ok(!(await page.isVisible('#replay-bar')), 'Leiste weg beim Zurück');
  noErrors(page);
  await page.context().close();
});

await test('KI-Lehrling: Tipp erklärt, Ausführen spielt den Zug, keine Bestenliste', async () => {
  const page = await open('ipadQuer');
  await startGame(page, { rounds: 2 });
  const before = await page.evaluate(() => JSON.stringify({ u: window.__pb.app.state.units.map(u => [u.id, u.q, u.r, u.hp]), s: window.__pb.app.state.stars.player_1, t: window.__pb.app.state.techs.player_1.length, c: window.__pb.app.state.cities.map(c => [c.pop, c.trained]) }));
  await page.click('#coachBtn');
  await page.waitForTimeout(300);
  assert.ok(await page.isVisible('#coach'), 'Tipp sichtbar');
  const text = await page.textContent('#coach .co-text');
  assert.ok(text.length > 10, text);
  assert.strictEqual(await page.evaluate(() => window.__pb.app.state.coached), true, 'Partie als „mit Tipps“ markiert');
  const unchanged = await page.evaluate(() => JSON.stringify({ u: window.__pb.app.state.units.map(u => [u.id, u.q, u.r, u.hp]), s: window.__pb.app.state.stars.player_1, t: window.__pb.app.state.techs.player_1.length, c: window.__pb.app.state.cities.map(c => [c.pop, c.trained]) }));
  assert.strictEqual(unchanged, before, 'Tipp allein ändert nichts');
  if (await page.isVisible('[data-co-run]')) {
    await page.click('[data-co-run]');
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => JSON.stringify({ u: window.__pb.app.state.units.map(u => [u.id, u.q, u.r, u.hp]), s: window.__pb.app.state.stars.player_1, t: window.__pb.app.state.techs.player_1.length, c: window.__pb.app.state.cities.map(c => [c.pop, c.trained]) }));
    assert.notStrictEqual(after, before, 'Ausführen ändert den Spielstand');
  }
  noErrors(page);
  await page.context().close();
});

await test('Gewählte Einheit verschwindet (besiegt, gehandelt): kein Absturz', async () => {
  const page = await open('pc');
  await startGame(page);
  await page.keyboard.press(' ');
  await page.waitForTimeout(200);
  await page.evaluate(() => { const { app, sync } = window.__pb; const id = app.sel.id; app.state.units = app.state.units.filter(u => u.id !== id); sync(); });
  await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(() => window.__pb.app.sel), null);
  noErrors(page);
  await page.context().close();
});

await test('Kampagne: neue Mission startet mit Rammbock und Ziel-Leiste', async () => {
  const page = await open('pc');
  await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('pb_profile_v1') || '{"v":1}'); p.v = 1; p.campaign = Object.fromEntries(Array.from({ length: 11 }, (_, i) => ['m' + (i + 1), 1])); localStorage.setItem('pb_profile_v1', JSON.stringify(p)); });
  await page.reload();
  await page.waitForTimeout(300);
  await page.click('[data-mtab="campaign"]');
  await page.click('[data-mission="m12"]');
  await page.waitForFunction(() => window.__pb && window.__pb.app.state);
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => window.__pb.app.state.units.some(u => u.owner === 'player_1' && u.type === 'ram')), 'Rammbock da');
  assert.match(await page.textContent('#mission-bar'), /Mauern brechen/);
  noErrors(page);
  await page.context().close();
});

await test('Nach drei Siegen in Folge: schwerere Stufe angeboten und gestartet', async () => {
  const page = await open('pc');
  await page.evaluate(() => {
    const p = { v: 1, xp: 0, recent: [1, 2].map(() => ({ mode: 'bot', aiLevel: 'normal', won: true, date: '2026-10-16' })) };
    localStorage.setItem('pb_profile_v1', JSON.stringify(p));
  });
  await page.reload();
  await page.waitForTimeout(300);
  await startGame(page);
  await page.evaluate(() => { const { app, R, sync } = window.__pb; const st = app.state; st.aiLevel = 'normal'; for (const c of st.cities) c.owner = 'player_1'; R.checkWinner(st); sync(); });
  await page.waitForTimeout(400);
  assert.ok(await page.isVisible('#winnerHarder'), 'Angebot sichtbar');
  assert.match(await page.textContent('#winnerHarder'), /Schwer/);
  await page.click('#winnerHarder');
  await page.waitForTimeout(400);
  assert.strictEqual(await page.evaluate(() => window.__pb.app.state.aiLevel), 'hard');
  noErrors(page);
  await page.context().close();
});

await test('Online am Zug: Mitteilung und blinkender Titel im Hintergrund', async () => {
  const page = await open('pc');
  await page.context().grantPermissions(['notifications']);
  await page.click('[data-mtab="play"]');
  await page.click('[data-notify="1"]');
  // Der Klick-Handler ist async (fragt ggf. um Erlaubnis), also auf das Ergebnis warten.
  await page.waitForFunction(() => document.querySelector('[data-notify="1"]').classList.contains('active'), null, { timeout: 4000 }).catch(() => {});
  assert.ok(await page.$eval('[data-notify="1"]', e => e.classList.contains('active')), 'Einstellung an');
  await startGame(page);
  const shown = await page.evaluate(async () => {
    const seen = [];
    window.Notification = class { constructor(title, opts) { seen.push(opts.body); } static get permission() { return 'granted'; } };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    window.__pb.notifyTurn();
    await new Promise(r => setTimeout(r, 1100));
    return { seen, title: document.title };
  });
  assert.ok(shown.seen.length === 1 && /am Zug/.test(shown.seen[0]), 'Mitteilung: ' + JSON.stringify(shown.seen));
  assert.match(shown.title, /am Zug|Poly Battle/);
  noErrors(page);
  await page.context().close();
});

await test('Online: gebauter Spielstand mit HTML führt keinen Code aus', async () => {
  const page = await open('pc', { online: true });
  const html = '<img src=x onerror="window.__xss=1">';
  // 1. Beitreten: der Server liefert einen Stand mit HTML statt Zahlen → wird abgewiesen.
  const state = await page.evaluate(() => JSON.parse(JSON.stringify(window.__pb.R.createGame(5, 2, { mapSize: 'small' }))));
  state.stars.player_2 = html;
  state.units[0].type = 'drache';
  await page.route(/rpc\/join_match/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ match: { id: 't1', game_state: state, joined: ['player_1'] }, role: 'player_2' }) }));
  await page.goto(URL_ + '?x=1#t1');
  await page.waitForTimeout(800);
  assert.ok(!(await page.evaluate(() => window.__xss)), 'kein Code ausgeführt');
  assert.ok(!(await page.evaluate(() => window.__pb.app.state && window.__pb.app.state.stars.player_2 === '<img src=x onerror="window.__xss=1">')), 'Stand nicht übernommen');
  assert.ok(await page.$('#player-strip img') === null);
  // 2. Auch wenn ein solcher Wert doch einmal im Stand landet, wird er nur als Text gezeigt.
  await page.goto(URL_);
  await page.waitForTimeout(300);
  await startGame(page);
  await page.evaluate(html => {
    const st = window.__pb.app.state;
    st.stars.player_2 = html;
    st.stars.player_1 = html;
    st.eliminated = { player_2: { round: html, by: 'player_1' } };
    window.__pb.sync();
  }, html);
  await page.waitForTimeout(300);
  assert.ok(!(await page.evaluate(() => window.__xss)), 'Spielerleiste escaped');
  assert.strictEqual(await page.$$eval('#player-strip img, #treasury img', l => l.length), 0);
  await page.context().close();
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

await test('Bedienhilfen: Fenster mit Rolle, Fokus bleibt im Fenster, Esc schließt Bestätigung und „Mehr“', async () => {
  const page = await open('pc');
  // Menü ist ein Dialog, der Fokus liegt darin, Tab verlässt es nicht.
  assert.strictEqual(await page.$eval('#menu-overlay', o => o.getAttribute('role') + '/' + o.getAttribute('aria-modal')), 'dialog/true');
  assert.ok(await page.evaluate(() => document.getElementById('menu-overlay').contains(document.activeElement)), 'Fokus im Menü');
  for (let i = 0; i < 60; i++) await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.getElementById('menu-overlay').contains(document.activeElement)), 'Tab bleibt im Menü');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+Tab');
  assert.ok(await page.evaluate(() => document.getElementById('menu-overlay').contains(document.activeElement)), 'Shift+Tab bleibt im Menü');
  await startGame(page);
  // Bestätigung: Fokus darin, Esc bricht ab (Nein-Zweig läuft).
  await page.evaluate(() => import('./js/ui.js').then(ui => ui.showConfirm('Test?', () => { window.__yes = 1; }, { onNo: () => { window.__no = 1; } })));
  await page.waitForTimeout(100);
  assert.strictEqual(await page.$eval('#confirm-overlay', o => o.getAttribute('role')), 'alertdialog');
  assert.ok(await page.evaluate(() => document.getElementById('confirm-overlay').contains(document.activeElement)), 'Fokus in der Bestätigung');
  await page.keyboard.press('Escape');
  assert.ok(await page.$eval('#confirm-overlay', o => o.classList.contains('hidden')), 'Esc schließt die Bestätigung');
  assert.deepStrictEqual(await page.evaluate(() => [window.__yes, window.__no]), [undefined, 1]);
  for (const id of ['tech-overlay', 'overview-overlay', 'reward-overlay', 'handover-overlay', 'name-overlay', 'winner-overlay', 'build-overlay', 'learn-overlay']) {
    assert.match(await page.$eval('#' + id, o => o.getAttribute('role') + '/' + o.getAttribute('aria-modal')), /dialog\/true/, id);
  }
  // Zoomen nicht gesperrt, Notch-Ränder wirken.
  const vp = await page.$eval('meta[name=viewport]', m => m.content);
  assert.ok(!/user-scalable=no|maximum-scale/.test(vp) && /viewport-fit=cover/.test(vp), vp);
  noErrors(page);
  await page.context().close();

  // Handy: Bereit-Knopf und Sterne haben einen lesbaren Namen, Esc klappt „Mehr“ zu.
  const phone = await open('handy');
  await startGame(phone);
  assert.ok(await phone.isVisible('#idleBtn'), 'Bereit-Knopf sichtbar');
  assert.match(await phone.locator('#idleBtn').ariaSnapshot(), /button "\d+ bereit"/);
  assert.match(await phone.locator('#treasury').ariaSnapshot(), /Stern/);
  await phone.click('#moreBtn');
  assert.ok(await phone.$eval('#topbar', e => e.classList.contains('more-open')));
  await phone.keyboard.press('Escape');
  assert.ok(!(await phone.$eval('#topbar', e => e.classList.contains('more-open'))), 'Esc klappt „Mehr“ zu');
  noErrors(phone);
  await phone.context().close();
});

await test('Handy-Menü: Reiter zeigen, dass man wischen kann; ohne Browserspeicher ein Hinweis', async () => {
  const page = await open('handy');
  const cls = () => page.$eval('.menu-tabs', e => e.className);
  const over = await page.$eval('.menu-tabs', e => e.scrollWidth > e.clientWidth + 1);
  if (over) {
    assert.match(await cls(), /fade-right/);
    await page.$eval('.menu-tabs', e => { e.scrollLeft = e.scrollWidth; });
    await page.waitForTimeout(150);
    assert.match(await cls(), /fade-left/);
    assert.doesNotMatch(await cls(), /fade-right/);
  } else assert.doesNotMatch(await cls(), /fade-/);
  assert.ok(!(await page.isVisible('#storage-warn')), 'mit Speicher kein Hinweis');
  await page.context().close();

  const ctx = await browser.newContext(DEVICES.pc);
  const p2 = await ctx.newPage();
  p2.errors = [];
  p2.on('pageerror', e => p2.errors.push(e.message));
  await p2.route(/supabase\.co/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await p2.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('gesperrt', 'SecurityError'); } });
  });
  await p2.goto(URL_);
  await p2.waitForTimeout(500);
  assert.ok(await p2.isVisible('#storage-warn'), 'Hinweis ohne Speicher');
  assert.match(await p2.$eval('#storage-warn', e => e.textContent), /Spielstand kann nicht gespeichert werden/);
  await startGame(p2);
  assert.ok(await p2.isVisible('#endTurnBtn'), 'Spiel läuft trotzdem');
  assert.deepStrictEqual(p2.errors, []);
  await ctx.close();
});

await test('Akku: Bau-Fenster nutzt einen Renderer, Handy-Auflösung höchstens 1,5', async () => {
  const page = await open('pc');
  await startGame(page);
  await page.evaluate(() => {
    const { app, sync } = window.__pb; const st = app.state;
    const c = st.cities.find(x => x.owner === 'player_1');
    st.units = st.units.filter(u => !(u.q === c.q && u.r === c.r));
    app.sel = { kind: 'city', q: c.q, r: c.r }; sync();
  });
  await page.waitForTimeout(300);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    await page.click('#panel [data-build-open]');
    await page.waitForTimeout(200);
    assert.ok(await page.isVisible('.build-map.b3 canvas'), '3D-Ansicht im Bau-Fenster');
    seen.push(await page.evaluate(() => { const c = document.querySelector('.b3-canvas'); c.pbId = c.pbId || Math.random(); return c.pbId; }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  }
  assert.strictEqual(new Set(seen).size, 1, 'Leinwand (und WebGL-Kontext) wird wiederverwendet');
  noErrors(page);
  await page.context().close();
  const ctx = await browser.newContext({ ...DEVICES.handy, deviceScaleFactor: 3 });
  const phone = await ctx.newPage();
  await phone.goto(URL_);
  await phone.waitForTimeout(400);
  const ratio = await phone.evaluate(() => { const c = document.getElementById('gameCanvas'); return c.width / c.clientWidth; });
  assert.ok(ratio <= 1.51, 'Handy zeichnet mit Auflösung ' + ratio);
  await ctx.close();
});

await test('Online langsam: „Verbinde …“, gesperrte Knöpfe, späte Antwort überschreibt kein neues Spiel', async () => {
  const page = await open('pc');
  await page.unroute(/supabase\.co/);
  await page.route(/supabase\.co/, async route => {
    if (/create_match/.test(route.request().url())) {
      const body = JSON.parse(route.request().postData());
      await new Promise(r => setTimeout(r, 2500));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'abc123', game_state: body.p_state, last_move_at: null }) }).catch(() => {});
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.click('[data-mtab="play"]');
  await page.click('[data-mode="online"]');
  await page.waitForTimeout(300);
  assert.ok(await page.$eval('[data-mode="bot"]', b => b.disabled), 'Knöpfe gesperrt');
  assert.match(await page.$eval('[data-mode="online"] .sub', e => e.textContent), /Verbinde/);
  // Anderer Startweg während des Wartens: Knopf freigeben und ein KI-Spiel starten.
  await page.$eval('[data-mode="bot"]', b => { b.disabled = false; });
  await page.click('[data-mode="bot"]');
  const before = await page.evaluate(() => window.__pb.app.state.players.length);
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => ({ mode: window.__pb.app.mode, online: window.__pb.app.online, players: window.__pb.app.state.players.length, hash: location.hash }));
  assert.deepStrictEqual(after, { mode: 'bot', online: false, players: before, hash: '' });
  assert.ok(!(await page.$eval('[data-mode="bot"]', b => b.disabled)), 'Knöpfe wieder frei');
  noErrors(page);
  await page.context().close();
});

await test('Online: Server hängt, Bestenliste meldet nach der Zeitgrenze „Keine Verbindung“', async () => {
  const page = await open('pc');
  await page.unroute(/supabase\.co/);
  await page.route(/supabase\.co/, () => { /* nie antworten */ });
  await page.click('[data-mtab="board"]');
  await page.waitForTimeout(500);
  assert.match(await page.$eval('#mpane-board', e => e.innerText), /Lädt/);
  await page.waitForTimeout(10500);
  assert.match(await page.$eval('#mpane-board', e => e.innerText), /Keine Verbindung zum Server/);
  noErrors(page);
  await page.context().close();
});

await test('Datenschutz: „Meine Partien“ fragt nur, wer schon online gespielt hat', async () => {
  const calls = async (setup) => {
    const ctx = await browser.newContext(DEVICES.pc);
    const page = await ctx.newPage();
    const seen = [];
    await page.route(/supabase\.co/, route => {
      const url = route.request().url();
      seen.push(url.replace(/^.*\/rpc\//, ''));
      const body = /pb_my_matches/.test(url)
        ? JSON.stringify([{ id: 'm1', role: 'player_1', round: 3, last_move_at: new Date().toISOString(), turn: 'player_1', humans: ['player_1', 'player_2'], joined: ['player_1', 'player_2'], ai: [] }])
        : '[]';
      route.fulfill({ status: 200, contentType: 'application/json', body });
    });
    if (setup) await page.addInitScript(setup);
    await page.goto(URL_);
    await page.waitForTimeout(800);
    // Unter Last kann die Antwort etwas dauern.
    const list = await page.waitForSelector('#my-matches .match-row', { state: 'visible', timeout: setup ? 4000 : 500 }).then(() => true, () => false);
    const flag = await page.evaluate(() => localStorage.getItem('pb_online'));
    const token = await page.evaluate(() => localStorage.getItem('pb_token'));
    await ctx.close();
    return { seen, list, flag, token };
  };
  const fresh = await calls(null);
  assert.deepStrictEqual(fresh.seen, [], 'Neuer Besuch: keine Serveranfrage');
  assert.strictEqual(fresh.token, null, 'Neuer Besuch: keine Kennung angelegt');
  const online = await calls(() => { localStorage.setItem('pb_token', 'abcdefabcdefabcdef12'); localStorage.setItem('pb_online', '1'); });
  assert.ok(online.seen.some(u => /pb_my_matches/.test(u)) && online.list, 'Online-Spieler sieht seine Partien');
  // Ältere Browser (Kennung, aber keine Markierung): einmal fragen, Ergebnis merken.
  const old = await calls(() => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', '1'); localStorage.setItem('pb_token', 'abcdefabcdefabcdef12'); } });
  assert.ok(old.list && old.flag === '1', 'Alte Kennung mit Partien wird markiert');
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

// Tutorial: der Hervorhebung folgen wie ein Mensch. Jeder Text muss sein Ziel
// zeigen (Knopf hervorgehoben bzw. Feld im Bild), und die Karte darf es nicht verdecken.
async function playLesson(page, id, device) {
  const tap = async (x, y) => { if (device === 'pc') await page.mouse.click(x, y); else await page.touchscreen.tap(x, y); };
  await page.click('[data-mtab="play"]').catch(() => {});
  await page.click('[data-mode="tutorial"]');
  await page.click(`[data-learn-tab="${id}"]`);
  await page.click('[data-learn-start]');
  await page.waitForTimeout(800);
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(600);
    const s = await page.evaluate(() => {
      const t = window.__pb.tutor(), app = window.__pb.app;
      const open = [...document.querySelectorAll('.overlay')].find(o => !o.classList.contains('hidden'));
      const card = document.querySelector('.tu-inline') || document.getElementById('tutor');
      const cr = card.getBoundingClientRect();
      const inside = r => r.right > cr.left && r.left < cr.right && r.bottom > cr.top && r.top < cr.bottom;
      const focus = [...document.querySelectorAll('.tu-focus')].map(e => e.getBoundingClientRect());
      let tile = null;
      if (t && t.tile) { const p = window.__pb.project(t.tile[0], t.tile[1]); tile = { x: p.x, y: p.y, on: p.x > 0 && p.y > 0 && p.x < innerWidth && p.y < innerHeight, under: inside({ left: p.x, right: p.x, top: p.y, bottom: p.y }) }; }
      // Gewählte Einheit und ihre Zielfelder: wie viele liegen unter der Karte?
      let movesUnder = 0;
      const R = window.__pb.R, su = app.sel && app.sel.kind === 'unit' && R.findUnit(app.state, app.sel.id);
      if (su && !document.querySelector('.tu-inline')) {
        for (const k of [su.q + ',' + su.r, ...R.reachableMap(app.state, su).keys()]) {
          const [q, r] = k.split(',').map(Number), p = window.__pb.project(q, r);
          if (p && inside({ left: p.x, right: p.x, top: p.y, bottom: p.y })) movesUnder++;
        }
      }
      return { t, open: open && open.id, busy: app.busy || app.state.turn !== 'player_1', active: !!app.state.tutorial, focus: focus.length, covered: !document.querySelector('.tu-inline') && focus.some(inside), tile, movesUnder, pending: app.pending && app.pending.key, sel: app.sel };
    });
    if (!s.active) throw new Error(`${id}: Tutorial vorzeitig beendet`);
    if (s.open === 'confirm-overlay') { await page.click('#confirmYes'); continue; }
    if (s.open === 'reward-overlay') { await page.click('#reward-options button'); continue; }
    if (s.busy || !s.t) continue;
    if (s.t.finished) return;
    const where = `${device} ${id} Schritt ${s.t.step + 1}: ${s.t.text}`;
    if (s.t.el) { assert.ok(s.focus > 0, 'nicht hervorgehoben: ' + where); assert.ok(!s.covered, 'Karte verdeckt den Knopf: ' + where); }
    if (s.t.tile) { assert.ok(s.tile.on, 'Feld nicht im Bild: ' + where); assert.ok(!s.tile.under, 'Karte verdeckt das Feld: ' + where); }
    if (device === 'handyQuer') assert.strictEqual(s.movesUnder, 0, 'Karte verdeckt Einheit oder Zielfelder: ' + where);
    if (s.t.manual) await page.click('[data-tu="next"]');
    else if (s.t.el) { const b = await (await page.$('.tu-focus')).boundingBox(); await tap(b.x + b.width / 2, b.y + b.height / 2); }
    else {
      const [q, r] = s.t.tile || await page.evaluate(() => {
        const { app, R } = window.__pb, st = app.state;
        if (app.pending) return app.pending.key.split(',').map(Number);
        const u = R.findUnit(st, app.sel.id);
        return [...R.reachableMap(st, u).keys()].map(k => k.split(',').map(Number)).find(([q, r]) => !R.cityAt(st, q, r));
      });
      const p = await page.evaluate(([q, r]) => window.__pb.project(q, r), [q, r]);
      await tap(p.x, p.y);
    }
  }
  throw new Error(`${device} ${id}: Lektion nicht abgeschlossen`);
}

await test('Tutorial: Lern-Tabs, Grundlagen durchspielen, jede Lektion startet mit sichtbarem Ziel', async () => {
  for (const d of ['pc', 'handy']) {
    const page = await open(d);
    await page.click('[data-mtab="play"]').catch(() => {});
    await page.click('[data-mode="tutorial"]');
    assert.strictEqual(await page.$$eval('[data-learn-tab]', l => l.length), 5, 'fünf Lektionen');
    await page.click('#learnClose');
    await playLesson(page, 'basics', d);
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pb_tutorial_v1')).includes('basics')), 'Grundlagen als geschafft gemerkt');
    await page.click('[data-tu="lessons"]');
    assert.ok(await page.isVisible('[data-learn-tab="basics"] .learn-done'), 'Haken am Tab');
    await page.click('#learnClose');
    // Erster Schritt jeder Lektion: Text sichtbar, Ziel zu sehen.
    for (const id of ['cities', 'build', 'combat', 'explore']) {
      await page.evaluate(() => document.getElementById('menuBtn').click());
      await page.click('[data-mtab="play"]').catch(() => {});
      await page.click('[data-mode="tutorial"]');
      await page.click(`[data-learn-tab="${id}"]`);
      await page.click('[data-learn-start]');
      await page.waitForTimeout(900);
      const t = await page.evaluate(() => window.__pb.tutor());
      assert.ok(t && t.text, `${d} ${id}: erster Schritt sichtbar`);
      if (t.el) assert.ok(await page.evaluate(() => !!document.querySelector('.tu-focus')), `${d} ${id}: Ziel hervorgehoben`);
    }
    noErrors(page);
    await page.context().close();
  }
});

await test('Tutorial Handy quer: Box verdeckt weder Einheit noch Zielfelder', async () => {
  const page = await open('handyQuer');
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('phone')), 'Handy-Ansicht');
  await playLesson(page, 'basics', 'handyQuer');
  noErrors(page);
  await page.context().close();
});

await browser.close();
server.close();
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed) process.exit(1);
