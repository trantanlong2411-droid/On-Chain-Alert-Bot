import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {VERSION} from '../src/config.mjs';
const base=(process.env.ALERT_BOT_URL||'https://on-chain-alert-bot.trantanlong2411.workers.dev').replace(/\/$/,'');
const hash='0x4a603ea2d43512a76cc21f2d64b09e1ec4e07c34adc929526b514289ccfa61e1';
async function call(path,{method='GET',data,token,timeoutMs=45000}={}){
 const res=await fetch(base+path,{method,headers:{
  ...(data?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})
 },body:data?JSON.stringify(data):undefined,cache:'no-store',
 signal:AbortSignal.timeout(timeoutMs)});
 let result;try{result=await res.json()}catch{result={error:'non-JSON response'};}
 return {status:res.status,data:result};
}
let health;
for(let i=0;i<24;i++){
 try{health=await call('/api/health');
  if(health.status===200&&health.data.version===VERSION&&health.data.ntfyEnabled)break;
  console.log('WAIT_V2_DEPLOY',i,health.status,health.data.version||'missing',health.data.ntfyEnabled);}
 catch(e){console.log('WAIT_V2_DEPLOY',i,String(e.message||e));}
 await new Promise(r=>setTimeout(r,4000));
}
assert.equal(health.status,200);
assert.equal(health.data.version,VERSION);
assert.equal(health.data.ntfyEnabled,true);
const created=await call('/api/ntfy/create',{method:'POST',data:{thresholdUSDC:'0.001'}});
assert.equal(created.status,201,JSON.stringify(created.data).slice(0,500));
const {id,editToken,subscribeUrl}=created.data;
assert.match(id,/^[0-9a-f]{32}$/);
assert.match(subscribeUrl,/^https:\/\/ntfy\.(?:jae\.fi|adminforge\.de|sh)\/pharos-alert-[0-9a-f]{32}$/);
assert.ok(!created.data.publicDashboard.includes(editToken));
const publicList=await call('/api/ntfy/'+id);
assert.equal(publicList.status,200);
assert.equal(publicList.data.deliveryChannel,'ntfy');
assert.equal(publicList.data.thresholdUSDC,'0.001');
const unauthorized=await call('/api/ntfy/'+id+'/threshold',{method:'POST',data:{thresholdUSDC:'0.002'}});
assert.equal(unauthorized.status,403);
const updated=await call('/api/ntfy/'+id+'/threshold',{method:'POST',data:{thresholdUSDC:'0.001'},token:editToken});
assert.equal(updated.status,200);
const notified=await call('/api/ntfy/'+id+'/inspect',{method:'POST',data:{hash},token:editToken,timeoutMs:70000});
assert.equal(notified.status,200,JSON.stringify(notified.data).slice(0,650));
assert.ok(notified.data.outcomes?.some(x=>x.status==='SENT'),JSON.stringify(notified.data));
const sent=notified.data.outcomes.find(x=>x.status==='SENT');
assert.equal(sent.channel,'ntfy');
const repeat=await call('/api/ntfy/'+id+'/inspect',{method:'POST',data:{hash},token:editToken,timeoutMs:70000});
assert.equal(repeat.status,200,JSON.stringify(repeat.data).slice(0,450));
assert.ok(repeat.data.outcomes?.every(x=>x.status==='DUPLICATE'));
const after=await call('/api/ntfy/'+id);
assert.equal(after.data.alertsTotal,1);
assert.equal(after.data.deliveredTotal,1);
assert.equal(after.data.recent[0].hash,hash);
assert.equal(after.data.recent[0].delivery,'SENT');
const topic=new URL(subscribeUrl).pathname.slice(1);
const r=await fetch(subscribeUrl+'/json?poll=1&since=10m',{
 signal:AbortSignal.timeout(18000)});
assert.equal(r.status,200,'ntfy message replay endpoint failed');
const lines=(await r.text()).split('\n').filter(Boolean);
const messages=lines.map(line=>{try{return JSON.parse(line)}catch{return {}}})
 .filter(x=>x.event==='message'&&x.topic===topic&&x.message?.includes(hash));
assert.equal(messages.length,1,'Exactly one real, verified transfer push must appear in ntfy cached delivery, not duplicate spam');
assert.equal(messages[0].id,sent.notificationId);
const proof={schema:'pharos-alert-ntfy-production-v2',checkedAtUtc:new Date().toISOString(),site:base,
 chainId:688689,thresholdUSDC:updated.data.thresholdUSDC,
 publicDashboard:created.data.publicDashboard,channel:subscribeUrl,
 transactionHash:hash,realEventAmountUSDC:'0.003',notificationAccepted:true,
 notificationId:sent.notificationId,ntfyCachedMessageVerified:true,
 duplicateRequestStatus:repeat.data.outcomes.map(x=>x.status),
 uniqueEventRows:after.data.alertsTotal,confirmedPushRows:after.data.deliveredTotal,
 historicalTxExplorer:'https://atlantic.pharosscan.xyz/tx/'+hash,
 notes:['This is a real historical confirmed Atlantic USDC Transfer, not a fabricated event.',
 'A real ntfy notification was published and independently re-read from the public ntfy cached feed.',
 'No delivery to a particular device is claimed unless its subscriber confirms receipt.',
 'The private edit token is intentionally excluded from this proof.',
 'Existing Telegram delivery is separate and may still need secrets.']};
await mkdir('proof',{recursive:true});
await writeFile('proof/ntfy-production-proof.json',JSON.stringify(proof,null,2)+'\n');
console.log('PHAROS_NTFY_LIVE_DELIVERY_VERIFIED',JSON.stringify(proof));
