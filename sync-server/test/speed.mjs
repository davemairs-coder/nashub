// Speed log endpoints: run with `node test/speed.mjs` from workers/nashub-sync (in-memory KV, no network).
import w from "../worker.js";
const kv=new Map();
const env={SYNC_KV:{async get(k){return kv.has(k)?kv.get(k):null},async put(k,v){kv.set(k,v)},async delete(k){kv.delete(k)},async list(){return{keys:[]}}}};
const call=async(method,path,{headers={},body}={})=>{const r=await w.fetch(new Request("https://x"+path,{method,headers:{...headers,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined}),env);return{status:r.status,json:await r.json().catch(()=>null)};};
let fails=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails++;};
const cr=await call("POST","/sync/create",{body:{name:"t"}});
const code=cr.json.code,admin=cr.json.adminToken;
const j1=await call("GET","/sync/"+code,{headers:{"X-Device-Id":"dev-A","X-Device-Name":"Dave iPhone"}});
const j2=await call("GET","/sync/"+code,{headers:{"X-Device-Id":"dev-B","X-Device-Name":"Wife Android"}});
const tA=j1.json.memberToken,tB=j2.json.memberToken;
const H=(id,t)=>({Authorization:"Bearer "+t,"X-Device-Id":id});
const now=Date.now();
const e=(id,mins,extra={})=>({id,ts:new Date(now-mins*60000).toISOString(),down:88.123,up:12.5,ping:23,lat:30.26721,lon:-97.74306,place:"Home",net:"wifi",...extra});
let r=await call("POST","/sync/"+code+"/speed",{headers:H("dev-A",tA),body:{entries:[e("a1",10),e("a2",5),e("a1",10)]}});
ok(r.status===200&&r.json.added===2,"A posts 3 (1 dup) -> 2 added");
r=await call("POST","/sync/"+code+"/speed",{headers:H("dev-B",tB),body:{entries:[e("b1",1,{place:"Lake <b>house</b>",lat:45.123456,lon:-90.987654})]}});
ok(r.json.added===1,"B posts 1");
r=await call("GET","/sync/"+code+"/speed",{headers:H("dev-A",tA)});
ok(r.status===200&&r.json.entries.length===3,"A reads 3 merged entries");
ok(r.json.entries[0].id==="b1"&&r.json.entries[0].devName==="Wife Android","newest first, carries device name");
ok(r.json.entries[0].place==="Lake bhouse/b","markup stripped: "+r.json.entries[0].place);
ok(r.json.entries[0].lat===45.123&&r.json.entries[0].lon===-90.988,"coords rounded to 3dp");
ok(r.json.entries.find(x=>x.id==="a1").dev==="dev-A","dev id tagged from roster");
r=await call("GET","/sync/"+code+"/speed",{headers:{"X-Device-Id":"dev-Z"}});ok(r.status===401,"no token -> 401");
r=await call("GET","/sync/"+code+"/speed",{headers:H("dev-A",tB)});ok(r.status===403,"wrong token -> 403");
r=await call("GET","/sync/"+code+"/speed",{headers:H("dev-Q","nope")});ok(r.status===403,"non-member -> 403");
r=await call("POST","/sync/"+code+"/speed",{headers:H("dev-A",tA),body:{entries:[{id:"bad",ts:"nope",down:5},{id:"x",ts:new Date().toISOString()},{id:"future",ts:new Date(now+9e9).toISOString(),down:1},{id:"c",ts:new Date().toISOString(),down:5e9}]}});
ok(r.json.added===0,"invalid/future/out-of-range/empty entries rejected");
r=await call("POST","/sync/"+code+"/speed",{headers:H("dev-A",tA),body:{entries:[e("nolat",2,{lat:999,lon:5})]}});
r=await call("GET","/sync/"+code+"/speed",{headers:H("dev-A",tA)});
const nl=r.json.entries.find(x=>x.id==="nolat");ok(nl&&nl.lat===null&&nl.lon===null,"bad coords dropped, entry kept");
r=await call("GET","/sync/"+code+"/speed",{headers:{Authorization:"Bearer "+admin,"X-Device-Id":"dev-ADMIN","X-Device-Name":"Admin"}});
ok(r.status===200&&r.json.entries.length===4,"admin can read");
r=await call("DELETE","/sync/"+code+"/speed",{headers:H("dev-A",tA)});
r=await call("GET","/sync/"+code+"/speed",{headers:H("dev-B",tB)});
ok(r.json.entries.length===1&&r.json.entries[0].id==="b1","A's delete removes only A's entries");
const big=Array.from({length:150},(_,i)=>e("z"+i,i));
r=await call("POST","/sync/"+code+"/speed",{headers:H("dev-B",tB),body:{entries:big}});ok(r.json.added===100,"batch capped at 100");
r=await call("POST","/sync/"+code+"/speed",{headers:H("dev-B",tB),body:"notjson"});

// ── edits + single delete ──
r=await call("POST","/sync/"+code+"/speed",{headers:H("dev-B",tB),body:{entries:[e("b1",1,{place:"Basement",lat:null,lon:null})]}});
ok(r.json.added===0,"re-posting same id is an edit, not a new entry");
r=await call("GET","/sync/"+code+"/speed",{headers:H("dev-A",tA)});
{const b=r.json.entries.find(x=>x.id==="b1");ok(b&&b.place==="Basement"&&b.lat===null,"edit replaced place and removed GPS");}
r=await call("POST","/sync/"+code+"/speed",{headers:H("dev-A",tA),body:{entries:[e("b1",1,{place:"HIJACK"})]}});
r=await call("GET","/sync/"+code+"/speed",{headers:H("dev-B",tB)});
ok(r.json.entries.find(x=>x.id==="b1"&&x.dev==="dev-B").place==="Basement","another device cannot overwrite B's entry");
r=await call("DELETE","/sync/"+code+"/speed?id=b1",{headers:H("dev-B",tB)});
ok(r.json.removed===1,"delete one entry by id");
r=await call("GET","/sync/"+code+"/speed",{headers:H("dev-B",tB)});
ok(!r.json.entries.some(x=>x.id==="b1"&&x.dev==="dev-B")&&r.json.entries.some(x=>x.id==="z0"),"only that entry removed");

// ── NAS (Jellyfin) speed fields ──
r=await call("POST","/sync/"+code+"/speed",{headers:H("dev-A",tA),body:{entries:[e("nas1",3,{nas:212.456,nasPing:4.4}),e("nas2",3,{nas:null,nasPing:null}),e("nas3",3,{nas:-5,nasPing:"x"})]}});
r=await call("GET","/sync/"+code+"/speed",{headers:H("dev-A",tA)});
{const g=id=>r.json.entries.find(x=>x.id===id);
ok(g("nas1").nas===212.46&&g("nas1").nasPing===4,"nas + nasPing stored and rounded");
ok(g("nas2").nas===null&&g("nas2").nasPing===null,"missing NAS test stays null, not 0");
ok(g("nas3").nas===null&&g("nas3").nasPing===null,"negative / junk NAS values dropped");}
r=await call("POST","/sync/"+code+"/speed",{headers:H("dev-A",tA),body:{entries:[{id:"onlynas",ts:new Date().toISOString(),nas:90}]}});
ok(r.json.added===1,"an entry with only a NAS result is valid");
console.log(fails?`\n${fails} FAILED`:"\nALL PASSED");process.exit(fails?1:0);
