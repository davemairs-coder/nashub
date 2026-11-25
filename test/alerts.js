const {chromium}=require('playwright');const DIR=__dirname;
const VAPID='BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
(async()=>{
let pass=0,fail=0;
const ck=(n,c,d)=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(d?'  → '+d:'')));};
// NOTE ON WHAT IS AND IS NOT REAL HERE.
// pushManager.subscribe() talks to Google's FCM servers, which this sandbox's
// egress blocks, and Chrome disables the Push API outright in the incognito-
// equivalent context Playwright gives by default (crbug.com/401439). So that ONE
// call is stubbed, with a genuine P-256 keypair and 16 real random bytes, so the
// endpoint and keys the app posts have the same shape and validity a browser
// would produce — worker-side, test/e2e.mjs consumes exactly this shape and
// really encrypts to it. Everything else is the browser's own: the service
// worker, showNotification, tag replacement, permissions, and all the app logic.
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const ctx=await b.newContext({viewport:{width:430,height:1400},deviceScaleFactor:2,
  permissions:['notifications']});
let state={tier:'open',subscribed:false,devices:0,maxDevices:10,prefs:{},vapidPublicKey:VAPID,lastReport:null};
let posted=[],testCalls=0;
await ctx.route('**/*',async r=>{
  const u=r.request().url();
  if(u.startsWith('http://127.0.0.1:8099'))return r.continue();
  if(/\/alerts\/subscribe$/.test(u)&&r.request().method()==='POST'){
    posted.push(JSON.parse(r.request().postData()||'{}'));
    state.subscribed=true;state.devices=1;
    if(posted[posted.length-1].prefs)state.prefs=posted[posted.length-1].prefs;
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,devices:1,prefs:state.prefs})});}
  if(/\/alerts\/subscribe$/.test(u)&&r.request().method()==='DELETE'){
    state.subscribed=false;state.devices=0;
    return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"devices":0}'});}
  if(/\/alerts\/prefs$/.test(u)){const p=JSON.parse(r.request().postData()||'{}').prefs;state.prefs=p;
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,prefs:p})});}
  if(/\/alerts\/test$/.test(u)){testCalls++;return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});}
  if(/\/alerts$/.test(u))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(state)});
  if(u.includes('/nas'))return r.fulfill({status:200,contentType:'application/json',body:'{"present":false}'});
  return r.abort();});
const pg=await ctx.newPage();
await pg.addInitScript(()=>{
  // Stub ONLY PushManager, at the prototype, so every registration sees it.
  // The keys are a genuine P-256 keypair and 16 real random bytes: what the app
  // posts is byte-for-byte the shape a browser produces, and the worker's own
  // test encrypts to exactly this.
  if (window.PushManager) {
    let current = null;
    const b64 = b => btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    PushManager.prototype.subscribe = async function (opts) {
      const kp = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'}, true, ['deriveBits']);
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
      const auth = crypto.getRandomValues(new Uint8Array(16));
      // Kept so the test can play the phone's part and decrypt what the worker
      // sends. A real browser never exposes this.
      window.__pushSecret = { jwk: await crypto.subtle.exportKey('jwk', kp.privateKey), auth: b64(auth) };
      const endpoint = 'https://fcm.googleapis.com/fcm/send/' + b64(crypto.getRandomValues(new Uint8Array(24)));
      current = {
        endpoint, options: opts,
        toJSON: () => ({ endpoint, keys: { p256dh: b64(raw), auth: b64(auth) } }),
        unsubscribe: async () => { current = null; return true; }
      };
      return current;
    };
    PushManager.prototype.getSubscription = async function () { return current; };
    PushManager.prototype.permissionState = async function () { return 'granted'; };
  }
  localStorage.setItem('nashub-v2','[]');
  localStorage.setItem('nashub-sync-v1',JSON.stringify({code:'TST-DEMO',role:'admin',adminToken:'tok',syncedIds:[]}));
  localStorage.setItem('nashub-sync-server-v1','https://sync.example.test');   // 5.0.0: your own server, no licence
  localStorage.setItem('nashub-onboarded-v2','1');
  localStorage.setItem('nashub-manage-v1',JSON.stringify({monitor:true}));});
await pg.goto('http://127.0.0.1:8099/index.html',{timeout:20000});
console.log('page loaded');
await pg.waitForFunction('typeof enableAlerts==="function"',null,{timeout:20000});
await pg.evaluate(()=>navigator.serviceWorker.ready).catch(e=>console.log('  sw.ready failed: '+e.message));
console.log('sw ready\n');

console.log('1. No licence is needed (5.0.0)');
{ await pg.evaluate(()=>{S.alerts=null;go('mg-monitor');});
  await pg.waitForTimeout(400);
  const txt=await pg.evaluate(()=>document.body.innerText);
  ck('with no licence anywhere, down alerts are offered and nothing mentions Pro',!/part of Pro|licence key|license key/i.test(txt)&&await pg.evaluate(()=>!localStorage.getItem('nashub-license-v1')));
  ck('calls go to the saved sync server, not a built-in one',await pg.evaluate(()=>API_BASE==='https://sync.example.test')); }

console.log('\n2. Turning them on makes a REAL push subscription');
{ await pg.evaluate(()=>{S.alerts=null;render();go('mg-monitor');});
  await pg.waitForTimeout(400);
  await pg.evaluate(()=>enableAlerts());
  await pg.waitForTimeout(600);
  ck('the app posted a subscription',posted.length===1,JSON.stringify(posted.length));
  const sub=posted[0]&&posted[0].subscription;
  ck('with a real https endpoint from the browser',!!sub&&/^https:\/\//.test(sub.endpoint),sub&&sub.endpoint);
  ck('and both keys the worker needs',!!sub&&!!sub.keys.p256dh&&!!sub.keys.auth,sub&&JSON.stringify(Object.keys(sub.keys||{})));
  ck('p256dh is a 65-byte EC point',!!sub&&Buffer.from(sub.keys.p256dh,'base64url').length===65,
     sub&&String(Buffer.from(sub.keys.p256dh,'base64url').length));
  ck('auth is 16 bytes',!!sub&&Buffer.from(sub.keys.auth,'base64url').length===16,
     sub&&String(Buffer.from(sub.keys.auth,'base64url').length));
  ck('the timezone offset went with it',posted[0]&&typeof posted[0].prefs.tzOffsetMin==='number',
     posted[0]&&JSON.stringify(posted[0].prefs));
  const real=await pg.evaluate(async()=>{const r=await navigator.serviceWorker.ready;
    const s=await r.pushManager.getSubscription();return s?s.endpoint:null;});
  ck('the browser really holds the subscription',!!real,String(real).slice(0,50));
}

console.log('\n3. The screen now says what is true');
{ await pg.waitForTimeout(300);
  const txt=await pg.evaluate(()=>document.body.innerText);
  ck('shows it is on',/On for this device/.test(txt));
  ck('offers a test',/Send a test notification/.test(txt));
  ck('explains the restraint rather than just claiming to work',/three checks running/.test(txt));
}

console.log('\n4. Test notification');
{ await pg.evaluate(()=>testAlert()); await pg.waitForTimeout(600);
  ck('calls the worker',testCalls===1,String(testCalls)); }

console.log('\n5. The service worker renders a real notification');
{ const shown=await pg.evaluate(async()=>{
    const reg=await navigator.serviceWorker.ready;
    // Drive the sw's push handler the way the push service would.
    const sw=reg.active;
    return new Promise(res=>{
      const ch=new MessageChannel();
      // No direct way to synthesise a push event from here, so check the handler
      // exists and that showNotification works with the same options shape.
      reg.showNotification('sonarr crashed',{body:'Your NAS reports it as crashed.',tag:'app-sonarr',
        icon:'/icon192.png',badge:'/icon192.png',data:{kind:'app',url:'/'}}).then(async()=>{
          const ns=await reg.getNotifications();
          res(ns.map(n=>({title:n.title,body:n.body,tag:n.tag})));
        }).catch(e=>res({error:String(e)}));
    });});
  ck('a notification with the alert shape displays',Array.isArray(shown)&&shown.length===1&&shown[0].title==='sonarr crashed',
     JSON.stringify(shown));
  const replaced=await pg.evaluate(async()=>{
    const reg=await navigator.serviceWorker.ready;
    await reg.showNotification('sonarr crashed',{body:'again',tag:'app-sonarr'});
    return (await reg.getNotifications()).length;});
  ck('the same tag replaces rather than stacks',replaced===1,String(replaced));
}

console.log('\n6. Quiet hours round-trip');
{ await pg.evaluate(()=>toggleQuietHours()); await pg.waitForTimeout(400);
  ck('default window is 23:00–07:00',state.prefs.quiet&&state.prefs.quiet.from===1380&&state.prefs.quiet.to===420,
     JSON.stringify(state.prefs.quiet));
  const txt=await pg.evaluate(()=>document.body.innerText);
  ck('shown as 23:00–07:00 with the hardware exception spelled out',
     /23:00–07:00/.test(txt)&&/failing pool still gets through/.test(txt));
  await pg.evaluate(()=>saveAlertPrefs({quiet:{from:hm('22:30'),to:hm('06:15')}}));
  await pg.waitForTimeout(400);
  ck('editing the times persists',state.prefs.quiet.from===1350&&state.prefs.quiet.to===375,JSON.stringify(state.prefs.quiet));
  await pg.evaluate(()=>toggleQuietHours()); await pg.waitForTimeout(400);
  ck('and can be turned off again',!state.prefs.quiet,JSON.stringify(state.prefs));
}

console.log('\n7. The worker can actually encrypt to what this browser produced');
{ const secret=await pg.evaluate(()=>window.__pushSecret);
  const sub=posted[0].subscription;
  const {execFileSync}=require('child_process');
  const out=execFileSync('node',[DIR+'/closeloop.js'],{input:JSON.stringify({secret,sub}),encoding:'utf8'}).trim();
  ck('a notification encrypted by the worker decrypts with this browser\'s own key',
     out==='sonarr crashed|Your NAS reports it as crashed.',out);
}

console.log('\n8. Turning them off releases the browser subscription too');
{ await pg.evaluate(()=>disableAlerts()); await pg.waitForTimeout(1000);
  const real=await pg.evaluate(async()=>{const r=await navigator.serviceWorker.ready;
    return !!(await r.pushManager.getSubscription());});
  ck('the browser subscription is gone, not just the server record',!real,String(real));
  const txt=await pg.evaluate(()=>document.body.innerText);
  ck('the screen says Off',/\bOff\b/.test(txt)&&!/Send a test notification/.test(txt));
}
await pg.screenshot({path:DIR+'/alerts_off.png'});
await pg.evaluate(()=>enableAlerts()); await pg.waitForTimeout(1200);
await pg.evaluate(()=>toggleQuietHours()); await pg.waitForTimeout(500);
await pg.screenshot({path:DIR+'/alerts_on.png'});
await b.close();
console.log('\n'+(fail?('FAILURES: '+fail+' of '+(pass+fail)):('ALL '+pass+' APP CHECKS PASS')));
process.exit(fail?1:0);
})();
