const fs=require('fs');const src=fs.readFileSync(require('path').join(__dirname,'..','worker.js'),'utf8');
function grab(n){const i=src.indexOf('function '+n+'(');let d=0;
  for(let k=src.indexOf('{',i);k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'){d--;if(!d)return src.slice(i,k+1);}}}
function build(c,h){const consts=`var ALERT_CONFIRM=${c};var ALERT_APP_COOLDOWN_MS=${h}*3600000;
  var ALERT_POOL_COOLDOWN_MS=24*3600000;var ALERT_SILENCE_MS=20*60000;var ALERT_COALESCE_AT=3;
  var BAD_STATES=["STOPPED","CRASHED","FAILED","ERROR"];const __name=()=>{};`;
  return new Function('m','e',[consts,grab('isBadState'),grab('inQuietHours'),grab('decideAlerts'),
    'm.exports=decideAlerts;return m.exports;'].join('\n'))({exports:{}},{});}
const MIN=60000,APPS=['jellyfin','sonarr','radarr','immich','gitea','plex','adguard','nextcloud'];
const TICKS=31*24*12,start=Date.parse('2026-09-01T00:00:00Z');
// Pure noise: no real outages at all. Every alert is a false alarm by construction.
function falseAlarms(decide,noise,seed0){
  // mulberry32. The LCG this replaced had enough lattice structure that three
  // draws 8 apart never all landed under 3% — it reported zero false alarms for
  // a configuration that should produce about two a month, which would have been
  // a very convincing wrong answer.
  let seed=seed0>>>0;
  const rnd=()=>{seed=(seed+0x6D2B79F5)>>>0;let t=seed;t=Math.imul(t^(t>>>15),t|1);
    t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
  let state=null,n=0;
  for(let i=0;i<TICKS;i++){const t=start+i*5*MIN;
    const apps=APPS.map(id=>({id,name:id,state:rnd()<noise?'STOPPED':'RUNNING'}));
    const r=decide(state,{ts:new Date(t-30000).toISOString(),info:{hostname:'truenas'},apps,
      pools:[{name:'tank',status:'ONLINE'}]},t,{});
    state=r.state;n+=r.alerts.length;}
  return n;
}
console.log('Pure-noise month (no real outages): every alert below is a FALSE alarm.');
console.log('20 seeds each, reporting mean and worst month.\n');
process.stdout.write('config'.padEnd(18));
const noises=[0.005,0.015,0.030,0.060];
noises.forEach(x=>process.stdout.write(('noise '+(x*100).toFixed(1)+'%').padStart(20)));
console.log();
for(const [c,h] of [[2,6],[3,6],[3,12],[4,6]]){
  const d=build(c,h);process.stdout.write((`confirm ${c}, ${h}h`).padEnd(18));
  for(const nz of noises){
    const runs=[];for(let s=1;s<=20;s++)runs.push(falseAlarms(d,nz,1000003*s+7));
    const mean=(runs.reduce((a,b)=>a+b,0)/runs.length).toFixed(1),max=Math.max(...runs);
    process.stdout.write((`${mean} avg, ${max} worst`).padStart(20));}
  console.log();
}
