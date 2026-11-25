// Security audit 2026-11-07: a share link or Group Sync address must never run code.
// Run: cd apps/nashub && python3 -m http.server 8099 --bind 127.0.0.1 & node test/share-link-xss.mjs http://127.0.0.1:8099
// Pass = 'pwned 0'. 4.13.6 printed 'pwned 1'.
import { chromium } from 'playwright';
const base = process.argv[2];
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERR', e.message)); page.on('dialog', d => { console.log('DIALOG', d.message()); d.dismiss(); });
const evil = 'http://nas.local&#39;);window.__pwned=1;//x';
const share = [{ id: 'evil', name: 'Plex', address: evil, port: '32400', emoji: '🎬' }];
const code = 'NASHUB1:' + Buffer.from(encodeURIComponent(JSON.stringify(share))).toString('base64');
await page.goto(base + '/', { waitUntil: 'load' });
// put the shared app straight into storage, as an import would
await page.evaluate((apps) => { localStorage.setItem('nashub_apps_v2', JSON.stringify(apps)); }, share);
const key = await page.evaluate(() => Object.keys(localStorage));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(800);
const ok = await page.evaluate(() => { try { S.apps = S.apps.filter(a=>a.id!=='evil').concat([cleanApp({id:'evil',name:'Plex',address:"http://nas.local&#39;);window.__pwned=1;//x",port:'32400'})]); S.onboarded=true; S.view='home'; S.qaApp={...S.apps.find(a=>a.id==='evil')}; render(); return true; } catch(e) { return String(e); } });
const btn = page.locator('button', { hasText: 'Open Plex' });
const n = await btn.count();
if (n) { console.log('onclick:', await btn.first().getAttribute('onclick')); const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 3000 }).catch(() => null), btn.first().click()]); console.log('popup url:', popup ? popup.url() : 'none'); }
console.log('setup', ok, 'buttons', n, 'pwned', await page.evaluate(() => window.__pwned || 0));
await browser.close();
