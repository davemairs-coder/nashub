// Cross-check the worker's hand-written Web Push crypto against the web-push
// npm package, which is an entirely separate implementation by other people.
// Same salt, same sender keypair, same subscription -> the bytes must match
// exactly. If they do, the worker speaks RFC 8291 correctly.
const fs=require('fs'), crypto=require('crypto').webcrypto, nodeCrypto=require('crypto');
global.crypto=crypto;
global.atob=s=>Buffer.from(s,'base64').toString('binary');
global.btoa=s=>Buffer.from(s,'binary').toString('base64');

const src=fs.readFileSync(require('path').join(__dirname,'..','worker.js'),'utf8');
function grab(n){const i=src.indexOf('function '+n+'(')>=0?src.indexOf('function '+n+'('):src.indexOf('async function '+n+'(');
  let d=0;for(let k=src.indexOf('{',i);k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'){d--;if(!d)return src.slice(i,k+1);}}}
function grabAsync(n){const i=src.indexOf('async function '+n+'(');let d=0;
  for(let k=src.indexOf('{',i);k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'){d--;if(!d)return src.slice(i,k+1);}}}
const code=['const __name=()=>{};','var PUSH_TTL=21600;',grab('b64urlToBytes'),grab('bytesToB64url'),grab('concatBytes'),
  grabAsync('hmac'),grabAsync('hkdf'),'var UTF8=new TextEncoder();',grabAsync('encryptPush'),grabAsync('vapidAuth'),
  'module.exports={encryptPush,vapidAuth,b64urlToBytes,bytesToB64url};return module.exports;'].join('\n');
const W=new Function('module','exports',code)({exports:{}},{});

const ece=require('./node_modules/http_ece');
const webpush=require('web-push');

(async()=>{
  let pass=0,fail=0;
  const ck=(n,c,d)=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(d?'  → '+d:'')));};

  // A subscription exactly as a browser produces one.
  const ua=nodeCrypto.createECDH('prime256v1'); ua.generateKeys();
  const p256dh=ua.getPublicKey().toString('base64url');
  const authSecret=nodeCrypto.randomBytes(16);
  const auth=authSecret.toString('base64url');

  // Fix the two random inputs so both implementations can be compared.
  const salt=nodeCrypto.randomBytes(16);
  const serverEcdh=nodeCrypto.createECDH('prime256v1'); serverEcdh.generateKeys();
  const serverPrivRaw=serverEcdh.getPrivateKey(); const serverPubRaw=serverEcdh.getPublicKey();
  const serverJwk={kty:'EC',crv:'P-256',ext:true,
    d:serverPrivRaw.toString('base64url'),
    x:serverPubRaw.subarray(1,33).toString('base64url'),
    y:serverPubRaw.subarray(33,65).toString('base64url')};
  const serverKeys={
    privateKey: await crypto.subtle.importKey('jwk',serverJwk,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']),
    publicKey:  await crypto.subtle.importKey('raw',serverPubRaw,{name:'ECDH',namedCurve:'P-256'},true,[])
  };

  const msg='Pool tank is DEGRADED';
  const mine=await W.encryptPush(msg,p256dh,auth,new Uint8Array(salt),serverKeys);

  console.log('1. Against the web-push package (independent implementation)');
  ece.keys={}; // http_ece is what web-push uses under the hood
  const theirs=ece.encrypt(Buffer.from(msg),{
    version:'aes128gcm', salt:salt.toString('base64url'),
    privateKey:serverEcdh, dh:ua.getPublicKey(), authSecret:authSecret
  });
  ck('byte-identical ciphertext for the same inputs',Buffer.from(mine).equals(theirs),
     'mine '+Buffer.from(mine).length+'B vs theirs '+theirs.length+'B');

  console.log('\n2. Round trip: does a real receiver get the plaintext back?');
  const back=ece.decrypt(Buffer.from(mine),{version:'aes128gcm',privateKey:ua,authSecret:authSecret});
  ck('decrypts to exactly what was sent',back.toString()===msg,JSON.stringify(back.toString()));

  console.log('\n3. Structure (RFC 8188 header)');
  const b=Buffer.from(mine);
  ck('16-byte salt at the front',b.subarray(0,16).equals(salt));
  ck('record size 4096',b.readUInt32BE(16)===4096,String(b.readUInt32BE(16)));
  ck('key id length 65',b[20]===65,String(b[20]));
  ck('uncompressed EC point (0x04) follows',b[21]===0x04,'0x'+b[21].toString(16));
  ck('ciphertext = plaintext + delimiter + 16-byte GCM tag',b.length===21+65+(msg.length+1)+16,
     b.length+' vs '+(21+65+msg.length+1+16));

  console.log('\n4. A different random salt each time (no nonce reuse)');
  const a1=await W.encryptPush(msg,p256dh,auth);
  const a2=await W.encryptPush(msg,p256dh,auth);
  ck('two encryptions of the same message differ',!Buffer.from(a1).equals(Buffer.from(a2)));
  ck('and both still decrypt',
     ece.decrypt(Buffer.from(a1),{version:'aes128gcm',privateKey:ua,authSecret:authSecret}).toString()===msg &&
     ece.decrypt(Buffer.from(a2),{version:'aes128gcm',privateKey:ua,authSecret:authSecret}).toString()===msg);

  console.log('\n5. VAPID JWT');
  const vapid=webpush.generateVAPIDKeys();
  const env={VAPID_PUBLIC_KEY:vapid.publicKey,VAPID_PRIVATE_KEY:vapid.privateKey,VAPID_SUBJECT:'mailto:owner@example.com'};
  const hdr=await W.vapidAuth('https://fcm.googleapis.com/fcm/send/abc123',env,1789600000);
  ck('header shape: vapid t=<jwt>, k=<key>',/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(hdr),hdr.slice(0,60));
  const jwt=hdr.slice(8).split(', k=')[0];
  const [h,p,sg]=jwt.split('.');
  const claims=JSON.parse(Buffer.from(p,'base64url').toString());
  ck('aud is the push service ORIGIN, not the full endpoint',claims.aud==='https://fcm.googleapis.com',claims.aud);
  ck('sub carries a contact',claims.sub==='mailto:owner@example.com',claims.sub);
  ck('exp is 12h out and under the 24h limit',claims.exp===1789600000+43200);
  // Verify the signature with the PUBLIC key, independently.
  const pubRaw=Buffer.from(vapid.publicKey,'base64url');
  const pk=await crypto.subtle.importKey('jwk',
    {kty:'EC',crv:'P-256',x:pubRaw.subarray(1,33).toString('base64url'),y:pubRaw.subarray(33,65).toString('base64url')},
    {name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const ok=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pk,
    Buffer.from(sg,'base64url'),Buffer.from(h+'.'+p));
  ck('signature verifies against the public key',ok);
  const bad=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pk,
    Buffer.from(sg,'base64url'),Buffer.from(h+'.'+p+'x'));
  ck('and fails on a tampered payload',!bad);
  let threw=false; try{ await W.vapidAuth('https://x.example/1',{},1); }catch(e){ threw=/VAPID keys are not configured/.test(e.message); }
  ck('missing keys fail loudly rather than sending unsigned',threw);

  console.log('\n'+(fail?('FAILURES: '+fail):('ALL '+pass+' CRYPTO CHECKS PASS')));
  process.exit(fail?1:0);
})();
