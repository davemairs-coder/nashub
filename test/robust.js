const {chromium}=require('playwright');const DIR=__dirname;
// Render every screen under states that should not happen but do: a licence
// record with no tier, a group with no token, apps that arrived from another
// device missing half their fields, a bridge report full of junk. A throw in a
// render path does not degrade — it blanks the whole app.
(async()=>{
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const ctx=await b.newContext({viewport:{width:430,height:900}});
await ctx.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8099')?r.continue():r.abort());
const pg=await ctx.newPage();
await pg.addInitScript(()=>{localStorage.setItem('nashub-onboarded-v2','1');});
await pg.goto('http://127.0.0.1:8099/index.html');
await pg.waitForFunction('typeof buildHTML==="function"');

const VIEWS=['home','manage','catalog','edit','share','import','scanner','groups','hosts',
  'packs','kid','tailscale','sync','license','jellyfin','portainer','truenas','apps'];

const res=await pg.evaluate((VIEWS)=>{
  const out=[];
  const APP_FULL={id:'jellyfin',name:'Jellyfin',emoji:'🎬',color:'#7b2ff7',address:'192.168.1.50',
    port:'8096',protocol:'http',cat:'Media',notes:'n',favorite:true,groupId:null};
  // What a record can look like when it comes off the wire from an older client.
  const APP_BARE={id:'x'};
  const APP_NULLS={id:'y',name:null,emoji:null,color:null,address:null,port:null,protocol:null,
    cat:null,notes:null,groupId:null,username:null,password:null,apiKey:null};
  const APP_WEIRD={id:'z',name:123,emoji:{},color:[],address:456,port:{},cat:null,notes:789,favorite:'yes'};

  const LICENCES=[
    ['no licence',null],
    ['empty object',{}],
    ['active, NO tier',{active:true}],
    ['active, null tier',{active:true,tier:null}],
    ['active pro',{active:true,tier:'pro',key:'K'}],
    ['revoked',{active:false,revoked:true,key:'K'}],
    ['grace expired',{active:false,graceExpired:true,key:'K'}],
    ['active, numeric tier',{active:true,tier:7}]
  ];
  const GROUPS=[
    ['no group',null],
    ['code only',{code:'ABC-DEF'}],
    ['admin',{code:'ABC-DEF',role:'admin',adminToken:'t',syncedIds:[]}],
    ['member, no token',{code:'ABC-DEF',role:'user'}],
    ['admin, no code',{role:'admin',adminToken:'t'}]
  ];
  const BRIDGES=[
    ['none',null],
    ['absent',{present:false}],
    ['fresh',{present:true,stale:false,ageSeconds:10,info:{hostname:'t'},
      apps:[{id:'a',name:'a',state:'RUNNING',portals:{'Web UI':'http://0.0.0.0:1/'}}],pools:[{name:'tank',status:'ONLINE'}]}],
    ['stale',{present:true,stale:true,ageSeconds:9999,info:null,apps:[],pools:[]}],
    ['junk',{present:true,stale:false,ageSeconds:5,info:'not an object',
      apps:[null,{},{id:null,name:null,state:null,portals:'nope'},{portals:{a:null}}],
      pools:[null,{},{name:null,status:null,free:'x',size:null}]}]
  ];
  const ALERTS=[
    ['none',null],
    ['free',{tier:'free',subscribed:false,devices:0,prefs:{}}],
    ['pro on',{tier:'pro',subscribed:true,devices:2,prefs:{quiet:{from:1380,to:420}},lastReport:new Date().toISOString()}],
    ['pro on, junk prefs',{tier:'pro',subscribed:true,devices:1,prefs:{quiet:{from:null,to:'x'}},lastReport:'not-a-date'}],
    ['pro, no prefs key',{tier:'pro',subscribed:true,devices:1}]
  ];
  const APPSETS=[
    ['none',[]],
    ['one full',[APP_FULL]],
    ['bare',[APP_BARE]],
    ['nulls',[APP_NULLS]],
    ['weird types',[APP_WEIRD]],
    ['mixed',[APP_FULL,APP_BARE,APP_NULLS,APP_WEIRD]]
  ];

  const base=JSON.parse(JSON.stringify({groups:S.groups,collapsed:S.collapsed}));
  function attempt(label,view,mut){
    // Reset the fields we touch, leave the rest of S alone.
    S.view=view; S.toast=null; S.pal=null; S.qaApp=null; S.kidSetup=null; S.kid=null;
    S.status={}; S.times={}; S.health={}; S.live={}; S.fails={}; S.groups=base.groups||[];
    S.collapsed={}; S.tnPicked={}; S.tnApps=[]; S.tnPools=[]; S.tnInfo=null; S.tnAgent=null;
    S.editing=null; S.netUnreachable=false; S.syncView=null; S.alertsBusy=false;
    try{ mut(); }catch(e){ out.push({label,view,phase:'setup',err:String(e&&e.message||e)}); return; }
    try{ const html=buildHTML(); if(typeof html!=='string'||!html.length)
      out.push({label,view,phase:'render',err:'produced no HTML'}); }
    catch(e){ out.push({label,view,phase:'render',err:String(e&&e.message||e)}); }
  }

  for(const view of VIEWS){
    for(const [ln,lv] of LICENCES) attempt('licence: '+ln,view,()=>{S.license=lv;S.syncGroup={code:'ABC-DEF',role:'admin',adminToken:'t'};S.apps=[APP_FULL];S.alerts=null;S.tnBridge=null;});
    for(const [gn,gv] of GROUPS)  attempt('group: '+gn,view,()=>{S.license={active:true,tier:'pro'};S.syncGroup=gv;S.apps=[APP_FULL];S.alerts=null;S.tnBridge=null;});
    for(const [bn,bv] of BRIDGES) attempt('bridge: '+bn,view,()=>{S.license={active:true,tier:'pro'};S.syncGroup={code:'ABC-DEF',role:'admin',adminToken:'t'};S.apps=[APP_FULL];S.alerts=null;S.tnBridge=bv;
      if(bv&&bv.present){S.tnApps=Array.isArray(bv.apps)?bv.apps:[];S.tnPools=Array.isArray(bv.pools)?bv.pools:[];S.tnInfo=bv.info;}});
    for(const [an,av] of ALERTS)  attempt('alerts: '+an,view,()=>{S.license={active:true,tier:'pro'};S.syncGroup={code:'ABC-DEF',role:'admin',adminToken:'t'};S.apps=[APP_FULL];S.alerts=av;S.tnBridge=null;});
    for(const [pn,pv] of APPSETS) attempt('apps: '+pn,view,()=>{S.license={active:true,tier:'pro'};S.syncGroup={code:'ABC-DEF',role:'admin',adminToken:'t'};S.apps=pv;S.alerts=null;S.tnBridge=null;});
    // Screens that need a target selected
    attempt('edit target: bare',view,()=>{S.license={active:true,tier:'pro'};S.apps=[APP_BARE];S.editing=APP_BARE;S.syncGroup=null;});
    attempt('quick actions: nulls',view,()=>{S.license={active:true,tier:'pro'};S.apps=[APP_NULLS];S.qaApp=APP_NULLS;S.syncGroup=null;});
    attempt('palette open, weird app',view,()=>{S.license={active:true,tier:'pro'};S.apps=[APP_WEIRD];S.pal={q:'',sel:0};S.syncGroup=null;});
    attempt('kid mode on, no allowed list',view,()=>{S.license={active:true,tier:'pro'};S.apps=[APP_FULL];S.kid={on:true};S.syncGroup=null;});
  }
  return out;
},VIEWS);

const seen=new Set(); const uniq=[];
for(const r of res){const k=r.err+'|'+r.phase;if(!seen.has(k)){seen.add(k);uniq.push({...r,count:1});}else uniq.find(u=>u.err===r.err&&u.phase===r.phase).count++;}
console.log('Rendered '+(VIEWS.length*(8+5+5+5+6+4))+' screen/state combinations.\n');
if(!res.length){console.log('✓ No screen threw.');}
else{
  console.log('✗ '+res.length+' failures, '+uniq.length+' distinct:\n');
  for(const u of uniq){
    const ex=res.filter(r=>r.err===u.err&&r.phase===u.phase);
    console.log('  ['+u.phase+'] '+u.err);
    console.log('     ×'+ex.length+'  e.g. view="'+ex[0].view+'" with '+ex[0].label);
    const views=[...new Set(ex.map(e=>e.view))];
    console.log('     views: '+views.join(', ')+'\n');
  }
}
// The specific journey that produced the crash: a spreadsheet whose address
// column Excel decided was numeric.
const imp=await pg.evaluate(()=>{
  const out={};
  try{
    S.apps=[];S.groups=[];S.view='home';S.license=null;S.syncGroup=null;
    S.xlsxPreview=[{name:123,address:192,port:8096,emoji:'',color:'',group:'',notes:'',username:'',password:'',favorite:false}];
    confirmXlsxImport();
    out.stored=JSON.parse(JSON.stringify(S.apps));
    out.render=(buildHTML()||'').length>0;
    S.view='manage'; out.manage=(buildHTML()||'').length>0;
    S.view='apps'; out.list=(buildHTML()||'').length>0;
  }catch(e){out.err=String(e&&e.message||e);}
  return out;
});
console.log('\nSpreadsheet import with numeric cells (address 192, name 123):');
if(imp.err)console.log('  ✗ threw: '+imp.err);
else{
  const a=imp.stored&&imp.stored[0];
  console.log('  stored address: '+JSON.stringify(a&&a.address)+'  (want the string "192")');
  console.log('  stored name   : '+JSON.stringify(a&&a.name)+'  (want the string "123")');
  console.log('  '+((typeof (a&&a.address)==='string'&&typeof a.name==='string'&&imp.render&&imp.manage&&imp.list)?'✓':'✗')
    +' coerced at the door, and home/manage/all-apps all render');
}
await b.close();
process.exit(res.length?1:0);
})();
