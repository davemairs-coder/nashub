const {decideAlerts}=require('./harness.js');
const MIN=60000;
// A month of a normal home NAS, at the bridge's real 5-minute cadence.
// Deterministic PRNG so this is a regression test, not a coin toss.
let seed=20260916>>>0;
const rnd=()=>{seed=(seed+0x6D2B79F5)>>>0;let t=seed;t=Math.imul(t^(t>>>15),t|1);
  t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};

const APPS=['jellyfin','sonarr','radarr','immich','gitea','plex','adguard','nextcloud'];
const TICKS=31*24*12;                       // 8928 ticks
const start=Date.parse('2026-09-01T00:00:00Z');

// Scripted real events, the kind a home NAS actually has.
const realOutages=[
  {app:'sonarr',  from:3*24*12+40,  to:3*24*12+80},    // crashed overnight, ~3.3h
  {app:'immich',  from:11*24*12+10, to:11*24*12+14},   // 20 min, you restarted it
  {app:'nextcloud',from:19*24*12+5, to:26*24*12},      // stopped and left stopped for a week
];
const reboot={from:7*24*12+60, to:7*24*12+66};          // whole NAS down 30 min
const bridgeGap={from:15*24*12+30, to:15*24*12+42};     // cron broken for an hour
const poolBad={from:22*24*12, to:25*24*12, status:'DEGRADED'};

let state=null, sent=[], perDay={};
for(let i=0;i<TICKS;i++){
  const t=start+i*5*MIN;
  const day=new Date(t).toISOString().slice(0,10);
  const silent=(i>=bridgeGap.from&&i<bridgeGap.to)||(i>=reboot.from&&i<reboot.to);
  let report=null;
  if(!silent){
    const apps=APPS.map(id=>{
      let st='RUNNING';
      for(const o of realOutages) if(o.app===id&&i>=o.from&&i<o.to) st = id==='sonarr'?'CRASHED':'STOPPED';
      // The noise floor: a scrape that reads wrong ~1.5% of the time per app.
      if(st==='RUNNING'&&rnd()<0.015) st='STOPPED';
      return {id,name:id,state:st};
    });
    const pools=[{name:'tank',status:(i>=poolBad.from&&i<poolBad.to)?poolBad.status:'ONLINE'},
                 {name:'backup',status:'ONLINE'}];
    report={ts:new Date(t-30000).toISOString(),info:{hostname:'truenas'},apps,pools};
  }
  const r=decideAlerts(state,report,t,{});
  state=r.state;
  for(const a of r.alerts){ sent.push({day,t:new Date(t).toISOString().slice(0,16),kind:a.kind,title:a.title});
    perDay[day]=(perDay[day]||0)+1; }
}

// How much noise was in the input?
seed=20260916>>>0; let spurious=0;
for(let i=0;i<TICKS;i++){const silent=(i>=bridgeGap.from&&i<bridgeGap.to)||(i>=reboot.from&&i<reboot.to);
  if(silent)continue;
  for(const id of APPS){let st='RUNNING';for(const o of realOutages)if(o.app===id&&i>=o.from&&i<o.to)st='X';
    if(st==='RUNNING'&&rnd()<0.015)spurious++;}}

console.log('31 days at the bridge\'s 5-minute cadence: '+TICKS+' ticks, 8 apps');
console.log('Spurious single-tick bad reads in the input: '+spurious);
console.log('Real events scripted: 3 app outages, 1 NAS reboot, 1 hour of broken cron, 1 pool DEGRADED for 3 days\n');
console.log('NOTIFICATIONS SENT: '+sent.length+'  ('+(sent.length/31).toFixed(2)+'/day)\n');
for(const s of sent) console.log('  '+s.t+'  ['+s.kind+']  '+s.title);
const worst=Object.entries(perDay).sort((a,b)=>b[1]-a[1])[0];
console.log('\nBusiest day: '+(worst?worst[0]+' with '+worst[1]:'none'));
console.log('Days with any notification: '+Object.keys(perDay).length+' of 31');
