// Phase 4 (4.19.0): Manage as screens, clicked through in a real browser.
// Usage: node test/redesign/manage.mjs [baseUrl]   (serve apps/nashub on 8099 first)
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://127.0.0.1:8099/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
let fails = 0;
const ok = (name, pass, detail = '') => { if (!pass) fails++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
const view = p => p.evaluate(() => S.view);
const back = async p => { await p.click('.pg-back'); await p.waitForTimeout(120); };

// ── demo copy: screens, rows, sheets ──
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: false });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
const errs = [], dialogs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
await page.goto(base + '?demo=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.evaluate(() => { const t = document.querySelector('.demo-cta'); if (t) t.remove(); });

await page.click('header button[aria-label="Manage"]'); await page.waitForTimeout(120);
ok('the gear opens Manage', await view(page) === 'manage');
const groups = await page.$$eval('.mg-group .mg-h', h => h.map(x => x.textContent.trim()));
ok('Manage has three lists: Your apps, Connection, NAS Hub', groups.join() === 'Your apps,Connection,NAS Hub', groups.join());
ok('Manage has 9 rows', (await page.$$('.mg-row')).length === 9);
ok('no old accordion left', !(await page.$('.mg-sec')));

await page.click('.mg-row:has-text("Organize")'); await page.waitForTimeout(120);
ok('Organize opens as its own screen', await view(page) === 'mg-organize' && (await page.textContent('.pg-top .pg-title')).trim() === 'Organize');
ok('its back arrow says where it goes', await page.getAttribute('.pg-back', 'aria-label') === 'Back to Manage');
await page.click('.mg-row:has-text("All apps")'); await page.waitForTimeout(120);
ok('All apps opens from Organize', await view(page) === 'apps');
await back(page);
ok('back from All apps lands on Organize', await view(page) === 'mg-organize');
await back(page); await back(page);
ok('two more backs reach Home', await view(page) === 'home');

// the catalog opened from Home goes back to Home, not to Add apps
await page.evaluate(() => go('catalog')); await page.waitForTimeout(100);
await back(page);
ok('the catalog opened from Home goes back to Home', await view(page) === 'home');
await page.evaluate(() => { go('manage'); go('mg-add'); go('catalog'); }); await page.waitForTimeout(100);
await back(page);
ok('the catalog opened from Add apps goes back to Add apps', await view(page) === 'mg-add');

// jumping between two screens through search cannot trap back
await page.evaluate(() => { go('speed'); go('groups'); }); await page.waitForTimeout(100);
await back(page); await back(page); await back(page);
ok('back after a search jump does not bounce', await view(page) === 'manage', await view(page));

// every section screen has a title and back arrow
for (const [v, t] of [['mg-add', 'Add apps'], ['mg-access', 'Access'], ['mg-sync', 'Sync & backup'], ['mg-monitor', 'Monitoring']]) {
  await page.evaluate(v => go(v), v); await page.waitForTimeout(80);
  ok(`${t} screen has its title and a back arrow`, (await page.textContent('.pg-top .pg-title')).trim() === t && await page.isVisible('.pg-back'));
}

// Access: Face ID is a switch
await page.evaluate(() => go('mg-access')); await page.waitForTimeout(80);
ok('Face ID lock is a switch', await page.getAttribute('.mg-row[role=switch]', 'aria-checked') === 'false');

// Monitoring with no sync group offers to set one up
await page.evaluate(() => { S.syncGroup = null; go('mg-monitor'); }); await page.waitForTimeout(80);
await page.click('.mg-alerts .mg-btn'); await page.waitForTimeout(100);
ok('"Set up a sync group" goes to Group Sync', await view(page) === 'sync');

// Restore from code is a sheet; the question afterwards is a sheet, not a browser box
await page.evaluate(() => go('mg-sync')); await page.waitForTimeout(80);
await page.click('.mg-btn:has-text("Restore from code")'); await page.waitForTimeout(150);
ok('Restore from code opens a sheet with the code box focused', await page.isVisible('.restore-sheet') && await page.evaluate(() => document.activeElement.id === 'restore-txt'));
const code = await page.evaluate(() => backupCode());
await page.fill('#restore-txt', code);
await page.click('.restore-sheet .mg-btn.primary'); await page.waitForTimeout(150);
ok('Restore asks first, in the app\'s own sheet', await page.isVisible('.ask-sheet') && /Restore backup from/.test(await page.textContent('#ask-h')));
ok('the ask sheet is an alert dialog with focus on its button', await page.evaluate(() => !!document.querySelector('.ask-sheet[role=alertdialog]') && document.activeElement.classList.contains('ask-ok')));
await page.click('.ask-no'); await page.waitForTimeout(150);
ok('Cancel restores nothing', await page.evaluate(() => !document.querySelector('.ask-sheet')) && page.url().includes('demo=1'));

// Escape answers no; a "Remove" question shows a red Remove button (5.0.0: asked directly, the licence screen is gone)
await page.evaluate(() => { window.__ans = 'pending'; askSheet("Remove this pack? It cannot be brought back.").then(v => { window.__ans = v; }); }); await page.waitForTimeout(120);
ok('a Remove question asks with a red Remove button', (await page.textContent('.ask-ok')).trim() === 'Remove' && await page.evaluate(() => document.querySelector('.ask-ok').classList.contains('danger')));
await page.keyboard.press('Escape'); await page.waitForTimeout(120);
ok('Escape answers no', await page.evaluate(() => window.__ans === false && !document.querySelector('.ask-sheet')));

// 5.0.0: About replaces License; every feature is on; the sync server is a setting
await page.evaluate(() => go('manage')); await page.waitForTimeout(120);
ok('Manage has About with the version, and no License row', await page.evaluate(() => { const t = document.querySelector('.page').textContent; return /About/.test(t) && t.includes('v' + APP_VERSION) && !/License|Licence|\bPro\b/.test(t); }));
await page.evaluate(() => go('about')); await page.waitForTimeout(120);
ok('About shows the version, the MIT line and the code link', await page.evaluate(() => { const t = document.querySelector('.page').textContent; return t.includes('v' + APP_VERSION) && /MIT license/.test(t) && !!document.querySelector('.page a[href="' + REPO_URL + '"]'); }));
ok('About carries the one credit line, with a tagged link', await page.evaluate(() => { const a = [...document.querySelectorAll('.page a')].filter(x => /davedoingdavestuff\.com/.test(x.href)); return a.length === 1 && a[0].textContent === 'Dave Doing Dave Stuff' && /utm_source=nashub/.test(a[0].href) && /Made by/.test(a[0].parentElement.textContent); }));
ok('no licence or Pro code is left to call', await page.evaluate(() => typeof isPro === 'undefined' && typeof activateLicense === 'undefined' && typeof buildLicense === 'undefined' && !('license' in S)));
ok('kid mode setup opens without a licence', await page.evaluate(() => { startKidSetup(); return S.view !== 'about' && !/Pro feature/.test(document.body.textContent); }));
await page.evaluate(() => { S.syncView = 'home'; go('sync'); }); await page.waitForTimeout(150);
ok('with no sync server set, Sync shows the server box and the setup guide link', await page.evaluate(() => !hasServer() && !!document.querySelector('#sync-server-inp') && !!document.querySelector('.page a[href^="' + REPO_URL + '/tree/main/sync-server"]')));
ok('no address is built in: calls would go nowhere', await page.evaluate(() => /\.invalid$/.test(new URL(API_BASE).host) && !/workers\.dev|nashubapp/.test(API_BASE)));
await page.evaluate(() => createSyncGroup('x')); await page.waitForTimeout(150);
ok('Create a group without a server says so and makes no group', await page.evaluate(() => !S.syncGroup && /Set your sync server first/.test(document.body.textContent)));
await page.fill('#sync-server-inp', 'not a url'); await page.evaluate(() => saveSyncServer(document.getElementById('sync-server-inp').value)); await page.waitForTimeout(150);
ok('a bad address is refused and nothing is saved', await page.evaluate(() => !hasServer() && /starting with https/.test(document.body.textContent)));
// The demo blocks all network on purpose, so saving a server is tried on a normal (not demo) copy of the app.
const ps = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await ps.addInitScript(() => { try { localStorage.setItem('nashub-onboarded-v2', '1'); } catch (e) {} });
await ps.route(/^https:\/\/sync\.example\.test\//, r => r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ service: 'nashub-sync', version: '5.0.0' }) }));
await ps.route(/^https:\/\/other\.example\.test\//, r => r.fulfill({ contentType: 'text/html', headers: { 'Access-Control-Allow-Origin': '*' }, body: '<html>hello</html>' }));
await ps.goto(base); await ps.waitForTimeout(500);
await ps.evaluate(() => { S.syncView = 'home'; go('sync'); }); await ps.waitForTimeout(150);
await ps.fill('#sync-server-inp', 'https://sync.example.test/'); await ps.click('text=Save and test'); await ps.waitForTimeout(500);
ok('a real sync server is tested, then saved without its trailing slash', await ps.evaluate(() => hasServer() && API_BASE === 'https://sync.example.test' && localStorage.getItem(SYNC_SERVER_KEY) === 'https://sync.example.test'));
await ps.evaluate(() => saveSyncServer('https://other.example.test')); await ps.waitForTimeout(500);
ok('an address that is not a sync server is refused and the saved one stays', await ps.evaluate(() => API_BASE === 'https://sync.example.test'));
await ps.reload(); await ps.waitForTimeout(400);
ok('the saved server is still there after a reload', await ps.evaluate(() => API_BASE === 'https://sync.example.test'));
await ps.evaluate(() => saveSyncServer('')); await ps.waitForTimeout(150);
ok('clearing the box removes the server', await ps.evaluate(() => !hasServer() && localStorage.getItem(SYNC_SERVER_KEY) === null));
// 5.0.1: a server from before 5.0.0 has no GET / but answers an unknown share link with its own 404
const oldSrv = r => { const p = new URL(r.request().url()).pathname; const share = /^\/share\/[A-HJ-NP-Z2-9]{6}$/.test(p);
  return r.fulfill({ status: 404, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: share ? 'That share link has expired or never existed' : 'Not found' }) }); };
await ps.route(/^https:\/\/old\.example\.test\//, oldSrv);
await ps.route(/^https:\/\/any404\.example\.test\//, r => r.fulfill({ status: 404, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Not found' }) }));
await ps.evaluate(() => saveSyncServer('https://any404.example.test')); await ps.waitForTimeout(500);
ok('a site that answers 404 to everything is refused', await ps.evaluate(() => !hasServer()));
await ps.evaluate(() => saveSyncServer('https://old.example.test')); await ps.waitForTimeout(500);
ok('a sync server from before 5.0.0 is accepted and saved', await ps.evaluate(() => API_BASE === 'https://old.example.test' && localStorage.getItem(SYNC_SERVER_KEY) === 'https://old.example.test'));
await ps.evaluate(() => saveSyncServer('')); await ps.waitForTimeout(150);
await ps.close();

// All apps: keyboard and drag
await page.evaluate(() => go('apps')); await page.waitForTimeout(100);
const ids0 = await page.evaluate(() => S.apps.map(a => a.id));
await page.focus('.aa-handle[data-aa="0"]'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(120);
const ids1 = await page.evaluate(() => S.apps.map(a => a.id));
ok('arrow down moves the first app to second', ids1[1] === ids0[0] && ids1[0] === ids0[1]);
ok('focus stays on the moved app\'s handle', await page.evaluate(() => document.activeElement.dataset.aa === '1'));
const h0 = await page.$('.aa-handle[data-aa="0"]'), r2 = await page.$('.aa-row:nth-child(3)');
const hb = await h0.boundingBox(), rb = await r2.boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
for (let y = hb.y; y <= rb.y + rb.height * 0.8; y += 12) await page.mouse.move(hb.x + hb.width / 2, y);
await page.mouse.up(); await page.waitForTimeout(150);
const ids2 = await page.evaluate(() => S.apps.map(a => a.id));
ok('dragging the handle moves the app down', ids2[2] === ids1[0], ids2.slice(0, 3).join());
ok('the new order is saved', await page.evaluate(() => JSON.stringify(S.apps.map(a => a.id))) === JSON.stringify(ids2));
ok('tapping an app opens its edit screen, and back returns to All apps', await (async () => { await page.click('.aa-main >> nth=0'); await page.waitForTimeout(100); const e = await view(page) === 'edit'; await page.evaluate(() => goBack()); await page.waitForTimeout(100); return e && await view(page) === 'apps'; })());

// Groups: empty state
await page.evaluate(() => { S.groups = []; go('groups'); }); await page.waitForTimeout(100);
ok('no groups shows one card with "Create a group"', await page.isVisible('.mg-empty') && (await page.textContent('.mg-empty .mg-btn')).trim() === 'Create a group');
await page.click('.mg-empty .mg-btn'); await page.waitForTimeout(100);
ok('Create a group opens the form and hides the empty card', await page.isVisible('#grp-name-inp') && !(await page.$('.mg-empty')));

// Addresses: Change opens a sheet
await page.evaluate(() => go('hosts')); await page.waitForTimeout(100);
await page.click('.host-btn >> nth=0'); await page.waitForTimeout(120);
ok('Change opens the "My NAS moved" sheet with the address box focused', await page.isVisible('.host-sheet') && await page.evaluate(() => document.activeElement.id === 'host-to'));
await page.fill('#host-to', '10.0.0.9');
ok('the preview follows what is typed', (await page.textContent('#host-prev-to')).trim() === '10.0.0.9');
await page.keyboard.press('Escape'); await page.waitForTimeout(100);
ok('Escape closes it without changing anything', !(await page.$('.host-sheet')) && await page.evaluate(() => !S.apps.some(a => (a.address || '').includes('10.0.0.9'))));

ok('no browser pop-up boxes were used', dialogs.length === 0, dialogs.join(' | '));
ok('no script errors (demo)', errs.length === 0, errs.slice(0, 3).join(' | '));
await ctx.close();

// ── the real app (not the demo): the phone's back button ──
const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 } });
const p2 = await ctx2.newPage();
const errs2 = []; p2.on('pageerror', e => errs2.push(String(e)));
await p2.goto(base, { waitUntil: 'networkidle' }); await p2.waitForTimeout(300);
await p2.evaluate(() => { S.onboarded = true; S.apps = [{ id: 'jf', name: 'Jellyfin', emoji: '🎬', color: '#00A4DC', address: '192.168.1.20', port: '8096' }]; render(); });
const startLen = await p2.evaluate(() => history.length);
await p2.evaluate(() => { go('manage'); go('mg-organize'); go('apps'); }); await p2.waitForTimeout(100);
await p2.goBack(); await p2.waitForTimeout(150);
ok('the phone\'s back button goes up one level', await view(p2) === 'mg-organize', await view(p2));
await p2.goBack(); await p2.waitForTimeout(150);
await p2.goBack(); await p2.waitForTimeout(150);
ok('back reaches Home without leaving the app', await view(p2) === 'home' && p2.url().startsWith(base));
await p2.evaluate(() => go('manage')); await p2.waitForTimeout(100);
await p2.evaluate(() => go('home')); await p2.waitForTimeout(250);
ok('going Home by button leaves no dead back press', await p2.evaluate(() => history.length) <= startLen + 1);
ok('no script errors (real app)', errs2.length === 0, errs2.slice(0, 3).join(' | '));
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL MANAGE CHECKS PASS');
process.exit(fails ? 1 : 0);
