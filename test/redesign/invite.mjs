// 5.0.0: an invite link names the sync server its group lives on. node test/redesign/invite.mjs [base] [shots dir]
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://127.0.0.1:8099/';
const out = process.argv[3];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
let failed = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) failed++; };
const mk = async () => {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await p.addInitScript(() => { try { localStorage.setItem('nashub-onboarded-v2', '1'); } catch (e) {} });
  let joins = 0;
  await p.route(/^https:\/\/(sync|evil)\.example\.test\//, r => {
    if (/\/sync\/[A-Z0-9-]+$/.test(new URL(r.request().url()).pathname)) joins++;
    return r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ apps: [], version: 1, name: 'Family', tier: 'open', memberToken: 'm' }) });
  });
  return { p, joins: () => joins };
};
// 1. an invite with a server asks first; No changes nothing
{ const { p, joins } = await mk();
  await p.goto(base + '#join=X7K-M2P&server=' + encodeURIComponent('https://evil.example.test')); await p.waitForTimeout(600);
  ok('a link naming a new server asks before doing anything', await p.isVisible('.ask-sheet') && /evil\.example\.test/.test(await p.textContent('.ask-sheet')) && joins() === 0);
  ok('the link is cleared from the address bar', !/join=/.test(p.url()));
  await p.click('.ask-no'); await p.waitForTimeout(300);
  ok('No: no server saved, no group joined, nothing sent', await p.evaluate(() => !hasServer() && !S.syncGroup) && joins() === 0);
  await p.close(); }
// 2. Yes saves the server and joins
{ const { p, joins } = await mk();
  await p.goto(base + '#join=X7K-M2P&server=' + encodeURIComponent('https://sync.example.test/')); await p.waitForTimeout(600);
  await p.click('.ask-ok'); await p.waitForTimeout(800);
  ok('Yes: the server is saved and the group is joined on it', await p.evaluate(() => API_BASE === 'https://sync.example.test' && S.syncGroup && S.syncGroup.code === 'X7K-M2P') && joins() >= 1);
  ok('the invite the owner shares carries the server', await p.evaluate(() => { S.syncGroup.role = 'admin'; S.syncGroup.adminToken = 't'; go('sync'); return document.body.innerHTML.includes('server=https%3A%2F%2Fsync.example.test'); }));
  await p.close(); }
// 3. a link with no server and none saved: says so, sends nothing
{ const { p, joins } = await mk();
  await p.goto(base + '#join=X7K-M2P'); await p.waitForTimeout(600);
  ok('an old style link with no server set says to set one', await p.evaluate(() => !S.syncGroup && /Set your sync server first/.test(document.body.textContent) && !!document.querySelector('#sync-server-inp')) && joins() === 0);
  await p.close(); }
// 4. a server value that is not a web address is ignored
{ const { p, joins } = await mk();
  await p.goto(base + '#join=X7K-M2P&server=' + encodeURIComponent('javascript:alert(1)')); await p.waitForTimeout(600);
  ok('a server that is not http(s) is dropped', await p.evaluate(() => !hasServer() && !S.syncGroup && !document.querySelector('.ask-sheet')) && joins() === 0);
  await p.close(); }
// 5. an address that could close a quote never becomes the server
{ const { p } = await mk();
  await p.goto(base); await p.waitForTimeout(400);
  const bad = ["https://sync.example.test/x');alert(1);//", 'https://sync.example.test/"><img src=x>', 'https://user:pw@sync.example.test', 'https://sync.example.test/?a=1', 'ftp://sync.example.test'];
  ok('odd addresses are all refused', await p.evaluate(list => list.every(x => cleanServerUrl(x) === ''), bad));
  ok('ordinary addresses pass', await p.evaluate(() => cleanServerUrl('https://nashub-sync.me.workers.dev/') === 'https://nashub-sync.me.workers.dev' && cleanServerUrl('http://192.168.1.20:8787') === 'http://192.168.1.20:8787'));
  await p.goto(base + '#join=X7K-M2P&server=' + encodeURIComponent("https://sync.example.test/x');window.__pwned=1;//")); await p.waitForTimeout(600);
  ok('an invite with such an address is dropped, nothing runs', await p.evaluate(() => !window.__pwned && !hasServer() && !document.querySelector('.ask-sheet')));
  await p.close(); }
if (out) {
  for (const [name, light] of [['dark', false], ['light', true]]) {
    const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
    await p.addInitScript(l => { try { localStorage.setItem('nashub-onboarded-v2', '1'); if (l) localStorage.setItem('nashub-theme-v1', 'light'); } catch (e) {} }, light);
    await p.goto(base); await p.waitForTimeout(500);
    for (const v of ['about', 'sync', 'manage']) { await p.evaluate(x => { S.syncView = 'home'; go(x); }, v); await p.waitForTimeout(250); await p.screenshot({ path: `${out}/${v}-${name}.png`, fullPage: true }); }
    await p.close();
  }
}
await b.close();
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
