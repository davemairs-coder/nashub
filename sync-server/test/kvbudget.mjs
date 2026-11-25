// KV write budget (2026-11-03): the free tier allows 1,000 writes a day and one family's
// NAS Hub was using ~600. A member's 15-minute polls and the 5-minute alert tick must not
// rewrite KV when nothing changed. Counts real puts against the real worker module.
const KV = new Map(); let puts = [];
const env = { SYNC_KV: {
  get: async k => KV.has(k) ? KV.get(k) : null,
  put: async (k, v) => { puts.push(k); KV.set(k, v); },
  delete: async k => { KV.delete(k); },
  list: async ({ prefix }) => ({ keys: [...KV.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }) } };
const mod = (await import('../worker.js')).default;
const req = (m, p, { body, headers } = {}) => new Request('https://w.example' + p,
  { method: m, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', ...(headers || {}) } });
let pass = 0, fail = 0;
const ck = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d ? '  → ' + d : ''))); };
console.log('\nKV write budget');
const created = await (await mod.fetch(req('POST', '/sync/create', { body: { name: 'Fam', apps: [] } }), env, {})).json();
const H = { 'X-Device-Id': 'phone-1', 'X-Device-Name': 'Phone' };
puts = [];
await mod.fetch(req('GET', `/sync/${created.code}`, { headers: H }), env, {});
ck('first poll registers the device (writes)', puts.some(k => k.startsWith('member:')), puts.join(','));
puts = [];
for (let i = 0; i < 3; i++) await mod.fetch(req('GET', `/sync/${created.code}`, { headers: H }), env, {});
ck('three more polls within the hour write nothing', puts.length === 0, puts.join(','));
const mk = `member:${created.code}:phone-1`;
const m = JSON.parse(KV.get(mk)); m.lastSeen = new Date(Date.now() - 61 * 60000).toISOString(); KV.set(mk, JSON.stringify(m));
puts = [];
await mod.fetch(req('GET', `/sync/${created.code}`, { headers: H }), env, {});
ck('a poll after an hour refreshes lastSeen (one write)', puts.length === 1 && puts[0] === mk, puts.join(','));
puts = [];
await mod.fetch(req('GET', `/sync/${created.code}`, { headers: { ...H, 'X-Device-Name': 'Renamed' } }), env, {});
ck('a renamed device is written straight away', puts.length === 1, puts.join(','));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
