// Drive the real worker module: a fake KV, a fake push service that actually
// DECRYPTS what it receives, and real WebCrypto. Nothing is stubbed that matters.
import {webcrypto} from 'node:crypto';
import nodeCrypto from 'node:crypto';
import ece from 'http_ece';
import webpush from 'web-push';
globalThis.atob=s=>Buffer.from(s,'base64').toString('binary');
globalThis.btoa=s=>Buffer.from(s,'binary').toString('base64');

const KV=new Map();
const env={
  SYNC_KV:{
    get:async k=>KV.has(k)?KV.get(k):null,
    put:async (k,v)=>{KV.set(k,v);},
    delete:async k=>{KV.delete(k);},
    list:async ({prefix})=>({keys:[...KV.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))})
  }
};
const vapid=webpush.generateVAPIDKeys();
Object.assign(env,{VAPID_PUBLIC_KEY:vapid.publicKey,VAPID_PRIVATE_KEY:vapid.privateKey,VAPID_SUBJECT:'mailto:owner@example.com'});

// The push service. Records everything, decrypts it, and can be told to die.
const delivered=[]; let pushMode='ok';
const device=nodeCrypto.createECDH('prime256v1'); device.generateKeys();
const deviceAuth=nodeCrypto.randomBytes(16);
const subscription={endpoint:'https://push.example.com/send/DEVICE1',
  keys:{p256dh:device.getPublicKey().toString('base64url'),auth:deviceAuth.toString('base64url')}};

globalThis.fetch=async(url,opts)=>{
  if(String(url).startsWith('https://push.example.com/')){
    if(pushMode==='gone')return new Response('gone',{status:410});
    if(pushMode==='fail')return new Response('nope',{status:500});
    const body=Buffer.from(await new Response(opts.body).arrayBuffer());
    const plain=ece.decrypt(body,{version:'aes128gcm',privateKey:device,authSecret:deviceAuth});
    delivered.push({auth:opts.headers.Authorization,urgency:opts.headers.Urgency,
      payload:JSON.parse(plain.toString())});
    return new Response('',{status:201});
  }
  throw new Error('unexpected fetch '+url);
};

const mod=(await import('../worker.js')).default;
const req=(method,path,{body,headers}={})=>new Request('https://w.example'+path,
  {method,body:body?JSON.stringify(body):undefined,headers:{'Content-Type':'application/json',...(headers||{})}});

let pass=0,fail=0;
const ck=(n,c,d)=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(d?'  → '+d:'')));};
const H=t=>console.log('\n'+t);

// ── set up a real group (5.0.0: no licences, every group gets everything) ──
let r=await mod.fetch(req('POST','/sync/create',{body:{name:'Family',apps:[]}}),env,{});
const created=await r.json();
const CODE=created.code, ADMIN=created.adminToken;
ck('group created',!!CODE&&!!ADMIN,JSON.stringify(created).slice(0,120));

H('1. The server says what it is, and has no licence routes left');
{ const j=await (await mod.fetch(req('GET','/'),env,{})).json();
  ck('GET / names the service and version',j.service==='nashub-sync'&&/^\d+\.\d+\.\d+$/.test(j.version),JSON.stringify(j));
  const rr=await mod.fetch(req('GET','/license/validate?key=ANY'),env,{});
  ck('the old licence check is gone (404)',rr.status===404,String(rr.status));
  ck('a new group is on the open tier with the full member cap',created.tier==='open'&&created.maxMembers===999,JSON.stringify(created).slice(0,120));
}

H('2. Subscribing');
{ const rr=await mod.fetch(req('POST',`/sync/${CODE}/alerts/subscribe`,
    {body:{subscription,prefs:{quiet:{from:1380,to:420},tzOffsetMin:0}},
     headers:{'Authorization':'Bearer '+ADMIN,'X-Device-Id':'d1','X-Device-Name':'Owner iPhone'}}),env,{});
  const j=await rr.json();
  ck('accepted',rr.status===200&&j.devices===1,rr.status+' '+JSON.stringify(j));
  ck('prefs were sanitised and kept',j.prefs&&j.prefs.quiet.from===1380,JSON.stringify(j.prefs));
  ck('the group is in the cron index',JSON.parse(KV.get('alert-index')).includes(CODE),KV.get('alert-index'));
  const bad=await mod.fetch(req('POST',`/sync/${CODE}/alerts/subscribe`,
    {body:{subscription:{endpoint:'http://insecure.example/x',keys:subscription.keys}},
     headers:{'Authorization':'Bearer '+ADMIN,'X-Device-Id':'d2'}}),env,{});
  ck('an http endpoint is refused',bad.status===400,String(bad.status));
  const noauth=await mod.fetch(req('POST',`/sync/${CODE}/alerts/subscribe`,
    {body:{subscription},headers:{'Authorization':'Bearer WRONG','X-Device-Id':'d3'}}),env,{});
  ck('a wrong token is refused',noauth.status===403,String(noauth.status));
}

H('3. The test notification actually decrypts on the device');
{ delivered.length=0;
  const rr=await mod.fetch(req('POST',`/sync/${CODE}/alerts/test`,
    {headers:{'Authorization':'Bearer '+ADMIN,'X-Device-Id':'d1'}}),env,{});
  ck('accepted',rr.status===200,String(rr.status));
  ck('exactly one push delivered',delivered.length===1,String(delivered.length));
  ck('the phone can read it',delivered[0]&&delivered[0].payload.title==='Alerts are working',
     delivered[0]&&JSON.stringify(delivered[0].payload));
  ck('signed with VAPID',/^vapid t=.+, k=/.test(delivered[0].auth||''),(delivered[0]||{}).auth?.slice(0,40));
}

H('4. A real outage, end to end through the cron');
{ delivered.length=0;
  const nas=(states)=>KV.set(`nas:${CODE}`,JSON.stringify({ts:new Date(t-30000).toISOString(),info:{hostname:'truenas'},
    apps:Object.entries(states).map(([id,state])=>({id,name:id,state})),pools:[{name:'tank',status:'ONLINE'}]}));
  const UP={jellyfin:'RUNNING',sonarr:'RUNNING',immich:'RUNNING'};
  let t=Date.parse('2026-09-16T12:00:00Z');
  // scheduled() hands its work to waitUntil and returns immediately, exactly as
  // the real runtime lets it. The test has to await that promise or it checks
  // the results before the tick has done anything.
  const tick=async()=>{ let p; await mod.scheduled({},env,{waitUntil:x=>{p=x;}}); await p; };
  // The cron uses Date.now(); freeze it so quiet hours are deterministic (noon).
  const realNow=Date.now; Date.now=()=>t;
  nas(UP); await tick(); t+=5*60000;
  nas(UP); await tick(); t+=5*60000;
  ck('a healthy NAS sends nothing',delivered.length===0,String(delivered.length));
  nas({...UP,sonarr:'CRASHED'}); await tick(); t+=5*60000;
  nas({...UP,sonarr:'CRASHED'}); await tick(); t+=5*60000;
  ck('still nothing after two bad reports',delivered.length===0,String(delivered.length));
  nas({...UP,sonarr:'CRASHED'}); await tick(); t+=5*60000;
  ck('the third fires exactly one notification',delivered.length===1,String(delivered.length));
  ck('and it says what broke',delivered[0]&&delivered[0].payload.title==='sonarr crashed',
     delivered[0]&&delivered[0].payload.title);
  ck('app alerts are normal urgency',delivered[0]&&delivered[0].urgency==='normal',delivered[0]&&delivered[0].urgency);
  for(let i=0;i<12;i++){ nas({...UP,sonarr:'CRASHED'}); await tick(); t+=5*60000; }
  ck('an hour of it still being down adds nothing',delivered.length===1,String(delivered.length));

  delivered.length=0;
  KV.delete(`nas:${CODE}`);                      // the NAS stops reporting
  for(let i=0;i<6;i++){ await tick(); t+=5*60000; }
  ck('silence alerts once',delivered.length===1&&delivered[0].payload.kind==='silent',
     JSON.stringify(delivered.map(d=>d.payload.kind)));
  ck('and is marked urgent',delivered[0]&&delivered[0].urgency==='high',delivered[0]&&delivered[0].urgency);
  Date.now=realNow;
}

H('5. A dead subscription is dropped, not retried forever');
{ pushMode='gone'; delivered.length=0;
  const rr=await mod.fetch(req('POST',`/sync/${CODE}/alerts/test`,
    {headers:{'Authorization':'Bearer '+ADMIN,'X-Device-Id':'d1'}}),env,{});
  ck('410 from the push service reports back honestly',rr.status===410,String(rr.status));
  const rec=JSON.parse(KV.get(`alerts:${CODE}`));
  ck('and the dead subscription is removed',!rec.subs.d1,JSON.stringify(Object.keys(rec.subs)));
  pushMode='ok';
}

H('6. Unsubscribing takes the group out of the cron index');
{ await mod.fetch(req('POST',`/sync/${CODE}/alerts/subscribe`,
    {body:{subscription},headers:{'Authorization':'Bearer '+ADMIN,'X-Device-Id':'d1'}}),env,{});
  ck('back in the index',JSON.parse(KV.get('alert-index')).includes(CODE));
  const rr=await mod.fetch(req('DELETE',`/sync/${CODE}/alerts/subscribe`,
    {headers:{'Authorization':'Bearer '+ADMIN,'X-Device-Id':'d1'}}),env,{});
  ck('unsubscribed',rr.status===200,String(rr.status));
  ck('and out of the index',!JSON.parse(KV.get('alert-index')).includes(CODE),KV.get('alert-index'));
  const rec=JSON.parse(KV.get(`alerts:${CODE}`));
  ck('but the alert state is KEPT, so re-subscribing does not re-fire everything',!!rec.state,JSON.stringify(!!rec.state));
}

H('7. GET /alerts tells the settings screen the truth');
{ await mod.fetch(req('POST',`/sync/${CODE}/alerts/subscribe`,
    {body:{subscription},headers:{'Authorization':'Bearer '+ADMIN,'X-Device-Id':'d1'}}),env,{});
  const j=await (await mod.fetch(req('GET',`/sync/${CODE}/alerts`,
    {headers:{'Authorization':'Bearer '+ADMIN,'X-Device-Id':'d1'}}),env,{})).json();
  ck('reports tier, subscription and the VAPID key the browser needs',
     j.tier==='open'&&j.subscribed===true&&j.vapidPublicKey===vapid.publicKey,JSON.stringify(j).slice(0,160));
}

console.log('\n'+(fail?('FAILURES: '+fail+' of '+(pass+fail)):('ALL '+pass+' END-TO-END CHECKS PASS')));
process.exit(fail?1:0);
