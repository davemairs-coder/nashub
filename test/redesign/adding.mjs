// Phase 5 (4.20.0): adding apps, clicked through as a brand-new user.
// Usage: node test/redesign/adding.mjs [baseUrl]   (serve apps/nashub on 8099 first)
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://127.0.0.1:8099/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
let fails = 0;
const ok = (name, pass, detail = '') => { if (!pass) fails++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };

async function fresh() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  p.errs = []; p.dialogs = [];
  p.on('pageerror', e => p.errs.push(String(e)));
  p.on('dialog', d => { p.dialogs.push(d.message()); d.dismiss(); });
  await p.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  await p.goto(base, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  return { ctx, p };
}
const view = p => p.evaluate(() => S.view);

// ── 1. The 90-second stranger: first run → catalog → Jellyfin → open it ──
{
  const { ctx, p } = await fresh();
  const t0 = Date.now();
  ok('a new install opens on the first-run screen', await p.isVisible('.fr-wrap[role=dialog]') && (await p.textContent('#fr-h')).trim() === 'Put your NAS apps one tap away');
  ok('it offers four ways to start', (await p.$$('.fr .mg-row')).length === 4);
  ok('the version shows beside the name', /v\d+\.\d+\.\d+/.test(await p.textContent('.fr-brand')));
  await p.click('.fr .mg-row:has-text("Pick from the catalog")'); await p.waitForTimeout(150);
  ok('"Pick from the catalog" opens the catalog', await view(p) === 'catalog' && !(await p.$('.fr-wrap')));
  await p.fill('#cat-search', 'jelly'); await p.waitForTimeout(150);
  ok('search narrows the list', (await p.$$('.cat-row')).length === 2);
  await p.click('.cat-add[aria-label="Add Jellyfin"]'); await p.waitForTimeout(150);
  ok('Add opens the form for Jellyfin', await view(p) === 'edit' && (await p.textContent('.pg-top .pg-title')).trim() === 'Jellyfin');
  await p.fill('#edit-address', '192.168.1.50'); await p.click('.btn-save'); await p.waitForTimeout(300);
  ok('one tap on Add saves it and returns to the catalog for more', await view(p) === 'catalog' && await p.evaluate(() => S.apps.some(a => a.id === 'jellyfin' && a.address === '192.168.1.50')));
  await p.click('.pg-back'); await p.waitForTimeout(150);
  ok('back from the catalog reaches Home', await view(p) === 'home');
  const tile = await p.$('.tile:has-text("Jellyfin")');
  await tile.click(); await p.waitForTimeout(250);
  await p.click('.qa-primary'); await p.waitForTimeout(250);
  const opened = await p.evaluate(() => window.__opened);
  const secs = (Date.now() - t0) / 1000;
  ok('tapping the tile, then Open, opens Jellyfin at its address', opened.some(u => u.includes('192.168.1.50:8096')), opened.join(' '));
  ok('the whole path takes far under 90 seconds of clicking', secs < 90, secs.toFixed(1) + ' s');
  await p.evaluate(() => { if (S.qaApp) closeQA(); go('catalog'); }); await p.waitForTimeout(100);
  await p.fill('#cat-search', ''); await p.waitForTimeout(100);
  ok('the catalog now marks Jellyfin as Added', /Added/.test(await p.textContent('.cat-row:has-text("Jellyfin")')));
  await p.click('.cpill:has-text("Downloads")'); await p.waitForTimeout(100);
  ok('a category button filters and says it is pressed', await p.getAttribute('.cpill:has-text("Downloads")', 'aria-pressed') === 'true' && !(await p.$('.cat-row:has-text("Jellyfin")')));
  await p.fill('#cat-search', 'zzzz'); await p.waitForTimeout(100);
  ok('no match says so', /No apps match/.test(await p.textContent('.page')));
  ok('no browser pop-ups, no script errors', !p.dialogs.length && !p.errs.length, p.errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── 2. The other ways in ──
for (const [row, want, extra] of [['Find them for me', 'mg-add'], ['Paste a shared link', 'import'], ['Join with a sync code', 'sync', p => p.evaluate(() => S.syncView === 'join')]]) {
  const { ctx, p } = await fresh();
  await p.click(`.fr .mg-row:has-text("${row}")`); await p.waitForTimeout(150);
  ok(`"${row}" opens the right screen`, await view(p) === want && (!extra || await extra(p)) && await p.evaluate(() => localStorage.getItem(ONBOARD_KEY) === '1'));
  await ctx.close();
}
{
  const { ctx, p } = await fresh();
  ok('the demo link opens the demo', (await p.getAttribute('a.fr-link', 'href')) === '?demo=1');
  await p.click('.fr button.fr-link'); await p.waitForTimeout(150);
  ok('"Start with an empty shelf" goes to Home and stays dismissed', await view(p) === 'home' && !(await p.$('.fr-wrap')) && await p.evaluate(() => localStorage.getItem(ONBOARD_KEY) === '1'));
  await ctx.close();
}

// ── 3. Add apps, custom app and the icon picker ──
{
  const { ctx, p } = await fresh();
  await p.evaluate(() => { skipOnboard(); go('manage'); go('mg-add'); }); await p.waitForTimeout(150);
  const hs = await p.$$eval('.mg-h', h => h.map(x => x.textContent.trim()));
  ok('Add apps has three groups', hs.join('|') === "Pick them yourself|Find what's already running|Bring a list", hs.join('|'));
  ok('the spreadsheet row holds a file picker', !!(await p.$('label.mg-row input[type=file]')));
  await p.click('.mg-row:has-text("Custom app")'); await p.waitForTimeout(150);
  ok('Custom app opens the short form', await view(p) === 'edit' && (await p.textContent('.pg-top .pg-title')).trim() === 'Custom app');
  ok('no wall of icons on the form', !(await p.$('.page .ip-cell')) && !!(await p.$('.ed-id .mg-btn')));
  await p.click('.ed-id .mg-btn'); await p.waitForTimeout(150);
  ok('Choose icon opens a sheet with the current icon picked and focused', await p.isVisible('.ip-sheet[role=dialog]') && await p.evaluate(() => document.activeElement.classList.contains('ip-cell') && document.activeElement.getAttribute('aria-checked') === 'true'));
  ok('every icon has a name a screen reader can say', await p.$$eval('.ip-cell', cs => cs.every(c => (c.getAttribute('aria-label') || '').length > 1)));
  ok('the picker offers real app logos first', (await p.$$('.ip-logos .ip-cell img.logo')).length > 40);
  await p.click('.ip-logos .ip-cell[aria-label="GL.iNet logo"]'); await p.waitForTimeout(120);
  await p.click('.ip-sheet .mg-btn.primary'); await p.waitForTimeout(120);
  ok('choosing a logo puts it on the app', await p.evaluate(() => S.editApp.logo === 'glinet' && !!document.querySelector('.ed-plate img.logo[src="logos/glinet.svg"]')));
  await p.click('.ed-id .mg-btn'); await p.waitForTimeout(120);
  await p.click('.ip-grid:not(.ip-logos) .ip-cell >> nth=8'); await p.waitForTimeout(120);
  const picked = await p.evaluate(() => S.iconPick);
  await p.click('.ip-sheet .mg-btn.primary'); await p.waitForTimeout(120);
  ok('choosing a simple icon replaces the logo', await p.evaluate(e => S.editApp.emoji === e && S.editApp.logo === 'none' && !document.querySelector('.ed-plate img') && !document.querySelector('.ip-sheet'), picked));
  await p.click('.ed-id .mg-btn'); await p.waitForTimeout(120);
  await p.fill('#ip-own-inp', '🦊'); await p.waitForTimeout(80);
  ok('typing an emoji shows it in the preview', (await p.textContent('#ip-prev')).includes('🦊') || await p.evaluate(() => S.iconPick === '🦊'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(120);
  ok('Escape closes the picker without changing the icon', await p.evaluate(e => S.editApp.emoji === e && S.iconPick == null, picked));
  await p.click('.ed-sw >> nth=3'); await p.waitForTimeout(80);
  ok('a colour swatch is a radio button that shows it is picked', await p.getAttribute('.ed-sw >> nth=3', 'aria-checked') === 'true');
  ok('the yellow swatch really is yellow in light mode', await p.evaluate(() => { document.documentElement.classList.add('light'); document.body.classList.add('light'); const c = getComputedStyle(document.querySelectorAll('.ed-sw')[3]).backgroundColor; return c === 'rgb(255, 195, 0)'; }));
  await p.fill('#edit-name', 'Grafana'); await p.fill('#edit-address', 'http://192.168.1.60:3000');
  await p.click('.btn-save'); await p.waitForTimeout(300);
  ok('saving adds the custom app', await p.evaluate(() => S.apps.some(a => a.name === 'Grafana' && a.cat === 'Custom')));
  // from the catalog, the custom app goes back to the catalog
  await p.evaluate(() => go('catalog')); await p.waitForTimeout(100);
  await p.click('.cat-custom-card .mg-btn'); await p.waitForTimeout(120);
  await p.click('.pg-back'); await p.waitForTimeout(120);
  ok('back from a custom app opened in the catalog returns to the catalog', await view(p) === 'catalog');
  ok('no browser pop-ups, no script errors', !p.dialogs.length && !p.errs.length, p.errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── 3b. Real logos ──
{
  const { ctx, p } = await fresh();
  await p.evaluate(() => { skipOnboard(); S.apps = [
    { id: 'jellyfin', name: 'Jellyfin', emoji: '🎬', color: '#00A4DC', address: '192.168.1.5', port: '8096' },
    { id: 'custom-1', name: 'Flint 3', emoji: '📶', color: '#5252ff', address: '192.168.1.1', port: '80' },
    { id: 'custom-2', name: 'IronLog', emoji: '🏋️', color: '#5252ff', address: 'danielbuilds.org', port: '443' }]; save(); go('home'); });
  await p.waitForTimeout(800);
  const imgs = await p.$$eval('.qtile img.logo', a => a.map(i => [i.getAttribute('src'), i.naturalWidth > 0]));
  ok('catalog apps and clearly-named custom apps show their real logo', JSON.stringify(imgs.map(x => x[0])) === JSON.stringify(['logos/jellyfin.svg', 'logos/glinet.svg']), JSON.stringify(imgs));
  ok('every logo image loads', imgs.every(x => x[1]));
  ok('an app with no known logo keeps its simple icon', await p.evaluate(() => !document.querySelector('.qtile[data-app-id="custom-2"] img') && !!document.querySelector('.qtile[data-app-id="custom-2"] .plate svg, .qtile[data-app-id="custom-2"] .plate')));
  ok('a shared setup cannot point a logo at another file', await p.evaluate(() => cleanApp({ id: 'x', name: 'X', logo: '../../evil' }).logo === '' && cleanApp({ id: 'x', name: 'X', logo: 'plex' }).logo === 'plex' && cleanApp({ id: 'x', name: 'X', logo: 'none' }).logo === 'none'));
  ok('logos are cached for offline use', await p.evaluate(async () => { const r = await fetch('sw.js'); const t = await r.text(); return /logos\/jellyfin\.svg/.test(t) && /cache\.addAll\(LOGOS\)/.test(t); }));
  ok('no script errors', !p.errs.length, p.errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── 4. Starter packs ──
{
  const { ctx, p } = await fresh();
  await p.evaluate(() => { skipOnboard(); go('packs'); }); await p.waitForTimeout(150);
  ok('Starter packs has a plain title', (await p.textContent('.pg-top .pg-title')).trim() === 'Starter packs');
  await p.click('.pack-btn >> nth=0'); await p.waitForTimeout(150);
  await p.fill('#pack-ip', '192.168.1.70');
  const n0 = await p.evaluate(() => S.apps.length);
  await p.click('.pack-edit .mg-btn.primary'); await p.waitForTimeout(300);
  ok('a pack adds its apps with the address typed once', await p.evaluate(n => S.apps.length > n && S.apps.every(a => !a.address || a.address.includes('192.168.1.70')), n0));
  ok('no script errors', !p.errs.length, p.errs.slice(0, 2).join(' | '));
  await ctx.close();
}

await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL ADDING CHECKS PASS');
process.exit(fails ? 1 : 0);
