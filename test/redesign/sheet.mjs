// Phase 3 (4.18.0): the status list and the app sheet, clicked through in a real browser.
// Usage: node test/redesign/sheet.mjs [baseUrl]   (serve apps/nashub on 8099 first)
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://127.0.0.1:8099/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
let fails = 0;
const ok = (name, pass, detail = '') => { if (!pass) fails++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(base + '?demo=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.evaluate(() => {
  checkAll = () => {};   // the app's own minute-by-minute check would overwrite the test's statuses
  S.apps.forEach(a => S.status[a.id] = 'online'); S.lastChecked = new Date();
  const q = S.apps.find(a => a.id === 'qbittorrent'); S.status[q.id] = 'offline';
  S.health[q.id] = Array.from({ length: 20 }, (_, i) => ({ status: i > 16 ? 'offline' : 'online', ms: i > 16 ? null : 150, ts: Date.now() - (20 - i) * 60000 }));
  S.apps[0] = { ...S.apps[0], username: 'dave', password: 'p@ss-test' };
  render();
});

// Home sentence → status list
await page.click('.home-head-btn');
await page.waitForTimeout(150);
ok('the status sentence opens the status list', await page.evaluate(() => S.view === 'status'));
const attn = await page.$$eval('.st-card', cs => cs.map(c => c.querySelector('.st-name').firstChild.textContent.trim()));
ok('the down app is under "Needs attention", with its recent checks', attn.join() === 'qBittorrent' && await page.isVisible('.st-card .h-bars'), attn.join());
const why = (await page.textContent('.st-card .st-why')).trim();
ok('it says when the app last answered', /Offline · last answered \d+m ago/.test(why), why);
const rows = await page.$$eval('.st-list .st-row', rs => rs.length);
ok('every other app is a plain row', rows === 11 && !(await page.$('.st-list .h-bars')), rows + ' rows');
ok('the healthy list is in alphabetical order', await page.$$eval('.st-list .st-name1', ns => { const t = ns.map(n => n.textContent.trim()); return t.join() === [...t].sort((a, b) => a.localeCompare(b)).join(); }));

// a row opens the sheet over the list
await page.click('.st-list .st-row >> nth=0');
await page.waitForTimeout(150);
ok('a row opens that app\'s sheet', await page.evaluate(() => !!S.qaApp && S.view === 'status'));
ok('the sheet is a labelled dialog', await page.evaluate(() => { const d = document.querySelector('.qa-sheet[role=dialog][aria-modal=true]'); return d && document.getElementById(d.getAttribute('aria-labelledby')).textContent.trim() === S.qaApp.name; }));
await page.click('.sheet-scrim', { position: { x: 20, y: 20 } });
await page.waitForTimeout(150);
ok('tapping outside closes the sheet', await page.evaluate(() => !S.qaApp));

// sheet contents for an app with a saved sign-in and quick actions
await page.evaluate(() => { go('home'); tapTile(S.apps[0].id); });
await page.waitForTimeout(150);
ok('saved username shows with Copy', (await page.textContent('.qa-card')).includes('dave'));
ok('the password is hidden until asked', (await page.textContent('#qa-pw-disp')).trim() === '••••••••');
await page.click('.qa-eye'); await page.waitForTimeout(100);
ok('the eye button shows the password', (await page.textContent('#qa-pw-disp')).trim() === 'p@ss-test');
ok('Open and the quick actions are there', await page.isVisible('.qa-primary') && (await page.$$('.qa-pill')).length >= 3);
ok('the address row shows the address and a Copy button', /192\.168\.1\.20:\d+/.test(await page.textContent('.qa-addr')));
ok('recent checks and 24-hour history sections are kept', await page.evaluate(() => /Recent checks/.test(document.querySelector('.qa-sheet').textContent) && /24-hour uptime/i.test(document.querySelector('.qa-sheet').textContent)));
const fav0 = await page.evaluate(() => S.apps[0].favorite);
await page.click('.qa-foot .qa-secondary >> nth=0'); await page.waitForTimeout(150);
ok('the favourite button toggles and closes', await page.evaluate(f => S.apps[0].favorite === !f && !S.qaApp, fav0));
await page.evaluate(() => toggleFav(S.apps[0].id));
await page.evaluate(() => tapTile(S.apps[0].id)); await page.waitForTimeout(100);
await page.keyboard.press('Escape'); await page.waitForTimeout(100);
ok('Escape closes the sheet', await page.evaluate(() => !S.qaApp));

// drag down from the grab bar closes it; a short drag does not
const drag = async (dy) => page.evaluate(dy => {
  const g = document.querySelector('.qa-sheet .sheet-grab');
  const mk = (type, y) => { const t = new Touch({ identifier: 1, target: g, clientX: 195, clientY: y }); g.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true })); };
  mk('touchstart', 300); mk('touchmove', 300 + dy); mk('touchend', 300 + dy);
}, dy);
await page.evaluate(() => tapTile(S.apps[1].id)); await page.waitForTimeout(100);
await drag(40); await page.waitForTimeout(150);
ok('a short drag leaves the sheet open', await page.evaluate(() => !!S.qaApp));
await drag(160); await page.waitForTimeout(150);
ok('dragging the sheet down closes it', await page.evaluate(() => !S.qaApp));
await page.evaluate(() => setNetMode && openNetSheet()); await page.waitForTimeout(100);
await page.evaluate(() => { const g = document.querySelector('.net-sheet .sheet-grab'); const mk = (type, y) => { const t = new Touch({ identifier: 1, target: g, clientX: 195, clientY: y }); g.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true })); }; mk('touchstart', 300); mk('touchmove', 460); mk('touchend', 460); });
await page.waitForTimeout(150);
ok('dragging the network chooser down closes it too', await page.evaluate(() => !S.netSheet));

// an app with no address
await page.evaluate(() => { S.apps.push({ id: 'x1', name: 'Grafana', emoji: '📈', color: '#F46800', address: '' }); render(); tapTile('x1'); });
await page.waitForTimeout(100);
ok('an app with no address offers to add one and has no Open button', !(await page.$('.qa-primary')) && /No address yet/.test(await page.textContent('.qa-sheet')));
await page.click('.qa-addr .qa-link'); await page.waitForTimeout(100);
ok('Add opens the edit form', await page.evaluate(() => S.view === 'edit'));

ok('no script errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL STATUS AND SHEET CHECKS PASS');
process.exit(fails ? 1 : 0);
