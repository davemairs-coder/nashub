const {decideAlerts}=require('./harness.js');
const MIN=60000, HOUR=3600000;
let pass=0,fail=0;
function check(name,cond,detail){ if(cond){pass++;console.log('  ✓ '+name);} else {fail++;console.log('  ✗ '+name+(detail?'  → '+detail:''));} }
function head(t){console.log('\n'+t);}

// A clock that feeds reports in at 5-minute intervals, like the real cron.
function Clock(start){ this.t=start; this.state=null; this.log=[]; }
Clock.prototype.tick=function(apps,pools,cfg,skipReport){
  this.t += 5*MIN;
  const report = skipReport ? null : {ts:new Date(this.t-30000).toISOString(),info:{hostname:'truenas'},
    apps:(apps||[]).map(a=>({id:a[0],name:a[0],state:a[1]})), pools:(pools||[]).map(p=>({name:p[0],status:p[1]}))};
  const r=decideAlerts(this.state,report,this.t,cfg||{});
  this.state=r.state; this.log.push(r.alerts);
  return r.alerts;
};
const UP=s=>[['jellyfin','RUNNING'],['sonarr','RUNNING'],['immich','RUNNING'],['gitea','RUNNING'],['plex','RUNNING']].map(a=>s&&s[a[0]]?[a[0],s[a[0]]]:a);
const OK=[['tank','ONLINE']];

head('1. Turning alerts on must not fire for what is already broken');
{ const c=new Clock(Date.parse('2026-09-16T12:00:00Z'));
  const a1=c.tick(UP({sonarr:'STOPPED',gitea:'CRASHED'}),[['tank','DEGRADED']]);
  check('first tick is silent even with a stopped app, a crash AND a degraded pool',a1.length===0,JSON.stringify(a1));
  const a2=c.tick(UP({sonarr:'STOPPED',gitea:'CRASHED'}),[['tank','DEGRADED']]);
  check('second tick does not alert for pre-existing app failures',!a2.some(x=>x.kind==='app'||x.kind==='many'),JSON.stringify(a2.map(x=>x.kind)));
}

head('2. One bad scrape is not an outage');
{ const c=new Clock(Date.parse('2026-09-16T12:00:00Z'));
  c.tick(UP(),OK); c.tick(UP(),OK);
  const blip=c.tick(UP({sonarr:'STOPPED'}),OK);
  const blip2=c.tick(UP({sonarr:'STOPPED'}),OK);
  check('one bad report sends nothing',blip.length===0,JSON.stringify(blip));
  check('two in a row still sends nothing',blip2.length===0,JSON.stringify(blip2));
  const back=c.tick(UP(),OK);
  check('and recovering the next tick stays silent (no all-clear spam)',back.length===0,JSON.stringify(back));
}

head('3. A real outage does alert — once');
{ const c=new Clock(Date.parse('2026-09-16T12:00:00Z'));
  c.tick(UP(),OK); c.tick(UP(),OK);
  const t1=c.tick(UP({sonarr:'STOPPED'}),OK);
  const t2=c.tick(UP({sonarr:'STOPPED'}),OK);
  const t3=c.tick(UP({sonarr:'STOPPED'}),OK);
  check('silent on reports 1 and 2, alerts on the third',t1.length===0&&t2.length===0&&t3.length===1&&t3[0].kind==='app',JSON.stringify([t1,t2,t3]));
  check('the wording says what happened',t3[0]&&t3[0].title==='sonarr stopped',t3[0]&&t3[0].title);
  let more=0; for(let i=0;i<24;i++) more+=c.tick(UP({sonarr:'STOPPED'}),OK).length;
  check('two hours of it still being down sends NOTHING further',more===0,'sent '+more);
}

head('4. A flapping container cannot spam');
{ const c=new Clock(Date.parse('2026-09-16T12:00:00Z'));
  c.tick(UP(),OK); c.tick(UP(),OK);
  let n=0;
  for(let cycle=0;cycle<20;cycle++){           // down,down,up,up repeatedly for ~100 min
    n+=c.tick(UP({sonarr:'STOPPED'}),OK).length;
    n+=c.tick(UP({sonarr:'STOPPED'}),OK).length;
    n+=c.tick(UP({sonarr:'STOPPED'}),OK).length;
    n+=c.tick(UP(),OK).length;
    n+=c.tick(UP(),OK).length;
  }
  // The loop spans 6h40m, so the 6h cooldown legitimately permits a second.
  check('20 down/up cycles produce at most one alert per 6h',n<=3,'sent '+n);
}

head('5. Several apps at once is ONE event, not five');
{ const c=new Clock(Date.parse('2026-09-16T12:00:00Z'));
  c.tick(UP(),OK); c.tick(UP(),OK);
  const all={jellyfin:'STOPPED',sonarr:'STOPPED',immich:'STOPPED',gitea:'STOPPED',plex:'STOPPED'};
  c.tick(UP(all),OK); c.tick(UP(all),OK);
  const a=c.tick(UP(all),OK);
  check('five apps down = 1 notification',a.length===1,JSON.stringify(a.map(x=>x.kind)));
  check('and it blames the NAS, not the apps',a[0]&&a[0].kind==='many'&&/5 apps stopped on truenas/.test(a[0].title),a[0]&&a[0].title);
}
{ const c=new Clock(Date.parse('2026-09-16T12:00:00Z'));
  c.tick(UP(),OK); c.tick(UP(),OK);
  const two={sonarr:'STOPPED',gitea:'CRASHED'};
  c.tick(UP(two),OK); c.tick(UP(two),OK);
  const a=c.tick(UP(two),OK);
  check('but two apps stay individual (below the coalesce threshold)',a.length===2&&a.every(x=>x.kind==='app'),JSON.stringify(a.map(x=>x.title)));
}

head('6. Silence outranks everything, and stale data alerts about nothing');
{ const c=new Clock(Date.parse('2026-09-16T12:00:00Z'));
  c.tick(UP(),OK); c.tick(UP(),OK);
  let a=[]; for(let i=0;i<5;i++) a=a.concat(c.tick(null,null,{},true));   // 25 min of no report
  check('the NAS going quiet alerts exactly once',a.length===1&&a[0].kind==='silent','sent '+JSON.stringify(a.map(x=>x.kind)));
  let more=[]; for(let i=0;i<20;i++) more=more.concat(c.tick(null,null,{},true));
  check('and does not nag for the next 100 minutes',more.length===0,JSON.stringify(more.map(x=>x.kind)));
  const back=c.tick(UP({sonarr:'STOPPED'}),OK);
  check('when it comes back, one stale-looking app does not instantly alert',back.length===0,JSON.stringify(back));
  c.tick(UP({sonarr:'STOPPED'}),OK);
  const again=c.tick(UP({sonarr:'STOPPED'}),OK);
  check('it still has to confirm twice after the outage',again.length===1&&again[0].kind==='app',JSON.stringify(again.map(x=>x.kind)));
}
{ const c=new Clock(Date.parse('2026-09-16T12:00:00Z'));
  let a=[]; for(let i=0;i<5;i++) a=a.concat(c.tick(null,null,{},true));
  check('a NAS that NEVER reported does not alert as "stopped reporting"',a.length===0,JSON.stringify(a.map(x=>x.kind)));
}

head('7. A degraded pool is the one thing worth waking you for');
{ const c=new Clock(Date.parse('2026-09-16T12:00:00Z'));
  c.tick(UP(),OK);
  const a=c.tick(UP(),[['tank','DEGRADED']]);
  check('DEGRADED alerts immediately — no confirm-twice delay',a.length===1&&a[0].kind==='pool',JSON.stringify(a.map(x=>x.kind)));
  let n=0; for(let i=0;i<200;i++) n+=c.tick(UP(),[['tank','DEGRADED']]).length;   // ~16h
  check('but not again for 16 hours',n===0,'sent '+n);
  let m=0; for(let i=0;i<150;i++) m+=c.tick(UP(),[['tank','DEGRADED']]).length;   // past 24h
  check('after 24h it reminds you once',m===1,'sent '+m);
  const worse=c.tick(UP(),[['tank','FAULTED']]);
  check('and getting WORSE re-alerts immediately, cooldown or not',worse.length===1&&/FAULTED/.test(worse[0].title),JSON.stringify(worse.map(x=>x.title)));
  const fixed=c.tick(UP(),OK); const redeg=c.tick(UP(),[['tank','DEGRADED']]);
  check('a resilvered pool going bad again alerts afresh',redeg.length===1,JSON.stringify(redeg.map(x=>x.kind)));
}

head('8. Quiet hours');
{ const cfg={quiet:{from:23*60,to:7*60},tzOffsetMin:0};
  const c=new Clock(Date.parse('2026-09-17T01:00:00Z'));
  c.tick(UP(),OK,cfg); c.tick(UP(),OK,cfg);
  c.tick(UP({sonarr:'STOPPED'}),OK,cfg); c.tick(UP({sonarr:'STOPPED'}),OK,cfg);
  const a=c.tick(UP({sonarr:'STOPPED'}),OK,cfg);
  check('an app stopping at 1am is suppressed',a.length===0,JSON.stringify(a.map(x=>x.kind)));
  const p=c.tick(UP({sonarr:'STOPPED'}),[['tank','DEGRADED']],cfg);
  check('a pool going DEGRADED at 1am still gets through',p.length===1&&p[0].kind==='pool',JSON.stringify(p.map(x=>x.kind)));
  let held=0; for(let i=0;i<100;i++) held+=c.tick(UP({sonarr:'STOPPED'}),OK,cfg).length;
  check('and the suppressed alert is NOT delivered in a pile at 7am',held===0,'sent '+held);
}
{ const cfg={quiet:{from:23*60,to:7*60},tzOffsetMin:0,quietCoversHardware:true};
  const c=new Clock(Date.parse('2026-09-17T01:00:00Z'));
  c.tick(UP(),OK,cfg);
  const p=c.tick(UP(),[['tank','DEGRADED']],cfg);
  check('unless you asked for quiet hours to cover hardware too',p.length===0,JSON.stringify(p.map(x=>x.kind)));
}

head('9. Watching only some apps');
{ const cfg={watch:['jellyfin']};
  const c=new Clock(Date.parse('2026-09-16T12:00:00Z'));
  c.tick(UP(),OK,cfg); c.tick(UP(),OK,cfg);
  c.tick(UP({sonarr:'STOPPED'}),OK,cfg); c.tick(UP({sonarr:'STOPPED'}),OK,cfg);
  const a=c.tick(UP({sonarr:'STOPPED'}),OK,cfg);
  check('an unwatched app going down is ignored',a.length===0,JSON.stringify(a.map(x=>x.title)));
  c.tick(UP({jellyfin:'STOPPED'}),OK,cfg); c.tick(UP({jellyfin:'STOPPED'}),OK,cfg);
  const b=c.tick(UP({jellyfin:'STOPPED'}),OK,cfg);
  check('a watched one still alerts',b.length===1,JSON.stringify(b.map(x=>x.title)));
}

head('10. A whole quiet week must produce zero notifications');
{ const c=new Clock(Date.parse('2026-09-16T00:00:00Z'));
  let n=0; for(let i=0;i<7*24*12;i++) n+=c.tick(UP(),OK).length;   // 2016 ticks
  check('2016 healthy ticks (7 days) send nothing at all',n===0,'sent '+n);
}

console.log('\n'+(fail?('FAILURES: '+fail+' of '+(pass+fail)):('ALL '+pass+' CHECKS PASS')));
process.exit(fail?1:0);
