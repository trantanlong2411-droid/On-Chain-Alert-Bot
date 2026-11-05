import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {VERSION,USDC_DEFAULT} from '../src/config.mjs';
const base=(process.env.ALERT_BOT_URL||'https://on-chain-alert-bot.trantanlong2411.workers.dev').replace(/\/$/,'');
async function get(path){
 const r=await fetch(base+path,{signal:AbortSignal.timeout(20000),cache:'no-store'});
 let data;try{data=await r.json()}catch{data=null}
 return {status:r.status,data};
}
let h;
for(let i=0;i<28;i++){
 try{
  const r=await get('/api/health');
  h=r;
  if(r.status===200&&r.data?.version===VERSION)break;
  console.log('WAIT_FOR_WORKER',i+1,'status',r.status,'version',r.data?.version||'unknown');
 }catch(e){console.log('WAIT_FOR_WORKER',i+1,String(e.message||e).slice(0,120))}
 await new Promise(r=>setTimeout(r,4000));
}
assert.equal(h?.status,200,'Expected deployed Worker health');
assert.equal(h.data.version,VERSION,'Deployment version has not reached Cloudflare');
assert.equal(h.data.chainId,688689);
assert.equal(h.data.network,'eip155:688689');
assert.equal(h.data.asset.toLowerCase(),USDC_DEFAULT.toLowerCase());
assert.equal(h.data.storageConfigured,true,'SQLite Durable Object must be bound');
assert.match(h.data.polling,/Cron Trigger every minute/);
const st=await get('/api/status');
assert.equal(st.status,200,'Durable state endpoint must work');
assert.equal(st.data.ok,true);
assert.equal(st.data.asset.toLowerCase(),USDC_DEFAULT.toLowerCase());
assert.ok(/^\d+(\.\d+)?$/.test(st.data.thresholdUSDC));
assert.ok(Array.isArray(st.data.recent));
console.log('ALERT_DELIVERY_STATE',JSON.stringify({
 telegramConfigured:st.data.telegramConfigured,
 lastError:st.data.lastError||null,
 events:st.data.recent.slice(0,5).map(e=>({
  status:e.delivery,amountUSDC:e.amountUSDC,
  source:e.source,hash:e.hash,deliveryError:e.error||null
 }))
}));
assert.equal(typeof st.data.telegramConfigured,'boolean');
assert.equal(typeof st.data.adminConfigured,'boolean');
const rejected=await fetch(base+'/api/admin/threshold',{method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({thresholdUSDC:'0.001'}),signal:AbortSignal.timeout(15000)});
assert.ok([401,503].includes(rejected.status),'Public callers must not write admin threshold');
const rejectedBody=await rejected.json().catch(()=>({}));
const expectedAdminStatus=h.data.adminConfigured?401:503;
console.log('ADMIN_CONFIG_DIAGNOSTIC',JSON.stringify({
 healthAdminConfigured:h.data.adminConfigured,statusAdminConfigured:st.data.adminConfigured,
 unauthenticatedPostStatus:rejected.status,
 expectedUnauthenticatedPostStatus:expectedAdminStatus,
 error:rejectedBody.error||null
}));
assert.equal(st.data.adminConfigured,h.data.adminConfigured,
 'Health and durable status disagree on admin configuration');
assert.equal(rejected.status,expectedAdminStatus,
 'Production HTTP POST admin guard disagrees with GET health: mixed deployments or lost secret');

const page=await fetch(base,{signal:AbortSignal.timeout(15000)}).then(r=>r.text());
assert.ok(page.includes('ON-CHAIN')&&page.includes('Telegram'));
const result={
 schema:'pharos-onchain-alert-deployed-readiness-v1',
 checkedAtUtc:new Date().toISOString(),
 origin:base,version:VERSION,chainId:688689,
 asset:st.data.asset,
 thresholdUSDC:st.data.thresholdUSDC,
 cron:'* * * * *',
 storage:true,publicDashboard:true,
 unauthorizedWriteRefused:true,
 telegramConfigured:st.data.telegramConfigured,
 adminConfigured:st.data.adminConfigured,
 alertCount:st.data.alertsTotal,
 deliveredTelegramAlerts:st.data.deliveredTotal,
 lastScan:st.data.lastScan,
 actualTelegramDeliveryVerified:st.data.deliveredTotal>0,
 note:'Public Worker smoke test checks deployed status and admin protection. Telegram delivery is only confirmed if the durable log has a SENT alert; user still needs to confirm the actual message in their Telegram chat.'
};
await mkdir('proof',{recursive:true});
await writeFile('proof/deployed-readiness.json',JSON.stringify(result,null,2)+'\n');
console.log('PHAROS_ONCHAIN_ALERT_BOT_LIVE_WORKER_CHECK',JSON.stringify(result));
