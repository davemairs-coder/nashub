// Pull the pure decision engine out of the worker and drive it like a clock.
const fs=require('fs');
const src=fs.readFileSync(require('path').join(__dirname,'..','worker.js'),'utf8');
function grab(name){
  const i=src.indexOf('function '+name+'(');
  if(i<0)throw new Error('missing '+name);
  let d=0;for(let k=src.indexOf('{',i);k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'){d--;if(!d)return src.slice(i,k+1);}}
}
const consts=src.match(/var ALERT_[A-Z_]+ = [^;]+;/g).join('\n')+'\n'+src.match(/var BAD_STATES = [^;]+;/)[0];
const code=[consts,'const __name=()=>{};',grab('isBadState'),grab('inQuietHours'),grab('decideAlerts'),'module.exports={decideAlerts,ALERT_CONFIRM,ALERT_APP_COOLDOWN_MS,ALERT_POOL_COOLDOWN_MS,ALERT_SILENCE_MS,ALERT_COALESCE_AT};'].join('\n');
module.exports = new Function('module','exports',code+'\nreturn module.exports;')({exports:{}},{});
