// Security audit 2026-11-07: wrong group-code guesses are limited per IP (20 an hour).
// Run: node test/guess-limit.mjs   (no dependencies)
import worker from '../worker.js';
const KV = new Map();
const env = { SYNC_KV: {
  get: async k => (KV.has(k) ? KV.get(k) : null), put: async (k, v) => { KV.set(k, v); },
  delete: async k => { KV.delete(k); }, list: async ({ prefix }) => ({ keys: [...KV.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }) } };
const ask = (code, ip) => worker.fetch(new Request('https://x.example/sync/' + code, { headers: { 'CF-Connecting-IP': ip } }), env, {});
let fail = 0; const check = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };
KV.set('group:REA-L42', JSON.stringify({ roster: [], created: 1 }));
const codes = []; for (let i = 0; i < 20; i++) codes.push((await ask('NOP-' + String(i).padStart(3, '0'), '1.1.1.1')).status);
check('first 20 wrong guesses answer 404', codes.every(s => s === 404));
check('the 21st wrong guess is refused (429)', (await ask('NOP-999', '1.1.1.1')).status === 429);
check('a right code from that IP is refused too while blocked', (await ask('REA-L42', '1.1.1.1')).status === 429);
check('another IP is unaffected and can join', (await ask('REA-L42', '2.2.2.2')).status === 200);
check('a normal join writes no guess counter', ![...KV.keys()].some(k => k.includes(':2.2.2.2:')));
process.exit(fail ? 1 : 0);
