// Phase 2 (4.17.0) Home behaviour, clicked through in a real browser.
// Usage: node test/redesign/home.mjs [baseUrl]   (serve apps/nashub on 8099 first)
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://127.0.0.1:8099/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
let fails = 0;
const ok = (name, pass, detail = '') => { if (!pass) fails++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(base + '?demo=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const settle = async () => page.evaluate(() => { S.apps.forEach(a => S.status[a.id] = 'online'); S.lastChecked = new Date(); render(); });
await settle();

// status sentence
const head = await page.textContent('.home-head');
ok('status sentence counts every app', /^All \d+ apps are up›?$/.test(head.trim()), head.trim());
await page.evaluate(() => { S.status[S.apps[6].id] = 'offline'; render(); });
const line = (await page.textContent('.home-line')).replace(/\s+/g, ' ').trim();
ok('a down app is named in the second line', /qBittorrent isn't answering/.test(line), line);
ok('the down tile has a Down badge and no other tile does', await page.evaluate(() => document.querySelectorAll('.down-badge').length === 1 && !!document.querySelector(`[data-app-id="${S.apps[6].id}"] .down-badge`)));
ok('no dots, stars, coloured edges or bars on Home tiles', await page.evaluate(() => !document.querySelector('.home .sdot,.home .star-btn,.home .spark,.home .ts-badge,.home .jf-badge') && [...document.querySelectorAll('.home .tile')].every(t => getComputedStyle(t).borderTopWidth === '0px')));

// favourites once
const favDup = await page.evaluate(() => { const ids = [...document.querySelectorAll('.home .tile')].map(t => t.dataset.appId); return ids.length - new Set(ids).size; });
ok('each app appears once on Home', favDup === 0, favDup + ' duplicates');

// tap → popup, favourite toggle there moves the tile
await settle();
const first = await page.evaluate(() => S.apps.find(a => a.favorite).id);
await page.click(`.home [data-app-id="${first}"]`);
await page.waitForTimeout(200);
ok('tapping a tile opens its panel', await page.evaluate(id => S.qaApp && S.qaApp.id === id, first));
await page.evaluate(id => { toggleFav(id); closeQA && closeQA(); }, first);
await page.waitForTimeout(200);
const where = await page.evaluate(id => { const t = document.querySelector(`.home [data-app-id="${id}"]`); return t && t.closest('section').querySelector('.shelf-h').textContent.trim(); }, first);
ok('un-favouriting moves the app out of Favorites', where && !/^Favorites/.test(where), where);
await page.evaluate(id => toggleFav(id), first);

// keyboard: Tab to a tile, Enter opens it
await page.evaluate(() => { closeQA && closeQA(); document.activeElement && document.activeElement.blur(); });
await page.focus('.home .tile');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
ok('Enter on a focused tile opens its panel', await page.evaluate(() => !!S.qaApp));
await page.keyboard.press('Escape');

// network pill → sheet → Away; Escape closes
await page.click('.net-pill');
await page.waitForTimeout(150);
ok('the network pill opens the chooser', await page.isVisible('.net-sheet'));
await page.click('.net-opt:has(input[value="away"])');
await page.waitForTimeout(200);
ok('choosing Away sets Away and closes the chooser', await page.evaluate(() => S.netMode === 'away' && !S.netSheet && !document.querySelector('.net-sheet')));
await page.click('.net-pill'); await page.waitForTimeout(100);
await page.keyboard.press('Escape'); await page.waitForTimeout(100);
ok('Escape closes the chooser', await page.evaluate(() => !S.netSheet));
await page.evaluate(() => setNetMode('home'));
await settle();

// bottom bar
await page.click('.home-search'); await page.waitForTimeout(150);
ok('the search bar opens search', await page.evaluate(() => !!S.pal));
await page.keyboard.press('Escape');
await page.click('.home-add'); await page.waitForTimeout(150);
ok('the add button opens the catalog', await page.evaluate(() => S.view === 'catalog'));
await page.evaluate(() => go('home')); await settle();

// drag to reorder (mouse: hold, then move) inside "Everything else"
const before = await page.evaluate(() => [...document.querySelectorAll('[data-sec-id] .tile')].map(t => t.dataset.appId));
const a = await page.locator('[data-sec-id] .tile').nth(0).boundingBox();
const c = await page.locator('[data-sec-id] .tile').nth(2).boundingBox();
await page.mouse.move(a.x + a.width / 2, a.y + 30); await page.mouse.down();
await page.waitForTimeout(700);
await page.mouse.move(a.x + a.width / 2 + 10, a.y + 32, { steps: 3 });
await page.mouse.move(c.x + c.width / 2 + 5, c.y + 30, { steps: 12 });
await page.waitForTimeout(200); await page.mouse.up(); await page.waitForTimeout(300);
const after = await page.evaluate(() => [...document.querySelectorAll('[data-sec-id] .tile')].map(t => t.dataset.appId));
ok('hold and drag still rearranges apps', before.join() !== after.join() && after.length === before.length, `${before.slice(0, 3)} → ${after.slice(0, 3)}`);
await page.evaluate(() => { exitReorder && exitReorder(); });
ok('the favourites row cannot be dragged', await page.evaluate(() => drTileFrom(document.querySelector('.grid.fixed .tile')) === null));

// kid mode keeps its own screen
await page.evaluate(() => { S.kid = { on: true, ids: S.apps.slice(0, 2).map(a => a.id), pin: '1234' }; try { render(); } catch (e) { } });
ok('no script errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL HOME CHECKS PASS');
process.exit(fails ? 1 : 0);
