// Plays the phone: takes the subscription the browser made and the private key
// behind it, encrypts a real alert with the WORKER's code, and decrypts it the
// way a push service delivery would arrive.
const fs=require('fs'),nodeCrypto=require('crypto'),ece=require('http_ece');
globalThis.atob=s=>Buffer.from(s,'base64').toString('binary');
globalThis.btoa=s=>Buffer.from(s,'binary').toString('base64');
const W=require('path').join(__dirname,'..','sync-server','worker.js');
const src=fs.readFileSync(W,'utf8');
const g=n=>{const i=src.indexOf('function '+n+'(')>=0&&src.indexOf('async function '+n+'(')<0?src.indexOf('function '+n+'('):src.indexOf('async function '+n+'(');
  let d=0;for(let k=src.indexOf('{',i);k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'){d--;if(!d)return src.slice(i,k+1);}}};
const M=new Function('module','exports',['const __name=()=>{};',g('b64urlToBytes'),g('bytesToB64url'),g('concatBytes'),
  g('hmac'),g('hkdf'),'var UTF8=new TextEncoder();',g('encryptPush'),'module.exports={encryptPush};return module.exports;'].join('\n'))({exports:{}},{});
(async()=>{
  const {secret,sub}=JSON.parse(fs.readFileSync(0,'utf8'));
  const body=await M.encryptPush(JSON.stringify({title:'sonarr crashed',body:'Your NAS reports it as crashed.',kind:'app',tag:'app-sonarr'}),
    sub.keys.p256dh, sub.keys.auth);
  const priv=nodeCrypto.createPrivateKey({key:secret.jwk,format:'jwk'});
  const ecdh=nodeCrypto.createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(secret.jwk.d,'base64url'));
  const plain=ece.decrypt(Buffer.from(body),{version:'aes128gcm',privateKey:ecdh,
    authSecret:Buffer.from(secret.auth,'base64url')});
  const d=JSON.parse(plain.toString());
  process.stdout.write(d.title+'|'+d.body);
})();
