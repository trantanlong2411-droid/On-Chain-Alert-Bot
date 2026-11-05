import {DurableObject} from 'cloudflare:workers';
import {setup,publicSetup,threshold,NETWORK,TRANSFER_TOPIC} from './config.mjs';
import {rpc,blockStatus,qualifying,scanWindow,sendTelegram,smallJson} from './monitor.mjs';
import {PAGE} from './page.mjs';
const iso=()=>new Date().toISOString();
const err=x=>String(x?.message||x||'Unknown error').slice(0,190);
const reply=smallJson;

export class WatchState extends DurableObject{
 constructor(ctx,env){
  super(ctx,env);this.sql=ctx.storage.sql;
  this.sql.exec('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT NOT NULL)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY,tx_hash TEXT NOT NULL,log_index INTEGER NOT NULL,block_number TEXT NOT NULL,from_address TEXT NOT NULL,to_address TEXT NOT NULL,amount_atomic TEXT NOT NULL,amount_usdc TEXT NOT NULL,explorer TEXT NOT NULL,source TEXT NOT NULL,first_seen TEXT NOT NULL,delivery TEXT NOT NULL,delivered_at TEXT,telegram_message_id TEXT,error TEXT)');
  this.sql.exec('CREATE INDEX IF NOT EXISTS ix_alerts_seen ON alerts(first_seen DESC)');
 }
 get(k){return this.sql.exec('SELECT v FROM meta WHERE k=?',k).toArray()[0]?.v??null}
 put(k,v){this.sql.exec('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v',k,String(v))}
 opts(){
  const c=setup(this.env);
  const saved=this.get('threshold');
  c.min=saved?threshold(saved):c.min;
  return c;
 }
 status(){
  const c=this.opts();
  const count=this.sql.exec('SELECT COUNT(*) as c FROM alerts').toArray()[0]?.c??0;
  const delivered=this.sql.exec("SELECT COUNT(*) as c FROM alerts WHERE delivery='SENT'").toArray()[0]?.c??0;
  const recent=this.sql.exec('SELECT id,tx_hash,block_number,from_address,to_address,amount_usdc,explorer,source,first_seen,delivery,delivered_at,telegram_message_id,error FROM alerts ORDER BY first_seen DESC LIMIT 25').toArray()
   .map(x=>({id:x.id,hash:x.tx_hash,block:x.block_number,
    from:x.from_address,to:x.to_address,amountUSDC:x.amount_usdc,
    explorer:x.explorer,source:x.source,observedAt:x.first_seen,
    delivery:x.delivery,deliveredAt:x.delivered_at,
    telegramMessageId:x.telegram_message_id,error:x.error}));
  return {ok:true,network:NETWORK,thresholdUSDC:c.min.display,asset:c.asset,
   alertsTotal:count,deliveredTotal:delivered,cursor:this.get('cursor'),
   lastScan:this.get('lastScan'),lastError:this.get('lastError'),
   telegramConfigured:c.hasTelegram,adminConfigured:c.hasAdmin,recent};
 }
 async notifyOnce(e,source='cron'){
  const found=this.sql.exec('SELECT id,delivery FROM alerts WHERE id=?',e.id).toArray()[0];
  if(found)return {status:'DUPLICATE',id:e.id,delivered:found.delivery};
  const at=iso();
  // Reserve in SQLite before network delivery. Unknown Telegram outcomes are not retried.
  this.sql.exec('INSERT OR IGNORE INTO alerts (id,tx_hash,log_index,block_number,from_address,to_address,amount_atomic,amount_usdc,explorer,source,first_seen,delivery) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',e.id,e.hash,e.index,e.block,e.from,e.to,e.amountAtomic,e.amountUSDC,e.explorer,source,at,'SENDING');
  try{
   const delivered=await sendTelegram(e,this.env);
   this.sql.exec("UPDATE alerts SET delivery='SENT',delivered_at=?,telegram_message_id=?,error=NULL WHERE id=?",iso(),delivered.messageId,e.id);
   return {status:'SENT',id:e.id,hash:e.hash,amountUSDC:e.amountUSDC,explorer:e.explorer,telegramMessageId:delivered.messageId};
  }catch(ex){
   const reason=err(ex);
   this.sql.exec("UPDATE alerts SET delivery='DELIVERY_UNCERTAIN',error=? WHERE id=?",reason,e.id);
   return {status:'DELIVERY_UNCERTAIN',id:e.id,error:reason};
  }
 }
 async scan(){
  const c=this.opts();
  if(!c.hasTelegram)return {ok:false,reason:'TELEGRAM_NOT_CONFIGURED',note:'Cron will not consume events until Telegram is configured'};
  try{
   const {latest,safe}=await blockStatus(c);
   const cursorText=this.get('cursor');
   const window=scanWindow(cursorText===null?null:BigInt(cursorText),safe,96n,96n);
   if(!window){
    this.put('lastScan',iso());return {ok:true,scanned:0,latest:latest.toString(),newAlerts:0,reason:'UP_TO_DATE'};
   }
   const logs=await rpc(c,'eth_getLogs',[{
    fromBlock:'0x'+window.from.toString(16),toBlock:'0x'+window.to.toString(16),
    address:c.asset,topics:[TRANSFER_TOPIC]
   }]);
   if(!Array.isArray(logs))throw Error('Invalid eth_getLogs response');
   const qualified=qualifying(logs,c.asset,c.min.amount);
   const results=[];
   for(const event of qualified.slice(0,5))results.push(await this.notifyOnce(event,'cron'));
   this.put('cursor',window.to.toString());
   this.put('lastScan',iso());this.put('lastError','');
   return {ok:true,from:window.from.toString(),to:window.to.toString(),
    latest:latest.toString(),safe:safe.toString(),logsScanned:logs.length,
    qualified:qualified.length,sent:results.filter(x=>x.status==='SENT').length,
    duplicates:results.filter(x=>x.status==='DUPLICATE').length,
    suppressedRateLimit:Math.max(0,qualified.length-5),
    remainingBlocks:window.remaining.toString(),outcomes:results};
  }catch(ex){
   this.put('lastError',err(ex));this.put('lastScan',iso());
   return {ok:false,error:err(ex)};
  }
 }
 async inspect(hash){
  const c=this.opts();
  if(!c.hasTelegram)return reply({ok:false,error:'Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first'},503);
  if(!/^0x[0-9a-f]{64}$/i.test(hash||''))return reply({ok:false,error:'Valid on-chain transaction hash required'},400);
  try{
   const {safe}=await blockStatus(c);
   const receipt=await rpc(c,'eth_getTransactionReceipt',[hash]);
   if(!receipt||String(receipt.status).toLowerCase()!=='0x1')return reply({ok:false,error:'Transaction not found or reverted'},422);
   if(BigInt(receipt.blockNumber)>safe)return reply({ok:false,error:'Transaction requires more confirmations'},409);
   const events=qualifying(receipt.logs||[],c.asset,c.min.amount).filter(e=>e.hash===hash.toLowerCase());
   if(!events.length)return reply({ok:false,error:'No confirmed USDC Transfer event meets threshold '+c.min.display+' USDC',thresholdUSDC:c.min.display},422);
   const results=[];
   for(const event of events.slice(0,5))results.push(await this.notifyOnce(event,'verified-tx-demo'));
   return reply({ok:true,transaction:hash,qualifyingEvents:events.length,outcomes:results,note:'Every alert comes from a real on-chain receipt'});
  }catch(ex){return reply({ok:false,error:err(ex)},503)}
 }
 async testTelegram(){
  const c=this.opts();
  if(!c.hasTelegram)return reply({ok:false,error:'Telegram configuration missing'},503);
  try{
   const token=String(this.env.TELEGRAM_BOT_TOKEN),chatId=String(this.env.TELEGRAM_CHAT_ID);
   const res=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({chat_id:chatId,text:'On-Chain Alert Bot connection test\nPharos Atlantic Testnet 688689\nTime: '+iso()+'\nThis is NOT a blockchain event.'}),
    signal:AbortSignal.timeout(10000)});
   const data=await res.json().catch(()=>null);
   if(!res.ok||data?.ok!==true)return reply({ok:false,error:'Telegram rejected connection test (HTTP '+res.status+')'},502);
   this.put('lastTelegramTest',iso());
   return reply({ok:true,telegramDelivered:true,messageId:data.result?.message_id,note:'Test notification only, not a transaction alert'});
  }catch(ex){return reply({ok:false,error:'Telegram test failed: '+err(ex)},503)}
 }
 async fetch(request){
  if(request.method!=='POST')return reply({error:'POST required'},405);
  const path=new URL(request.url).pathname;
  if(path==='/status')return reply(this.status());
  if(path==='/scan')return reply(await this.scan());
  let data;
  try{const raw=await request.text();if(raw.length>2500)throw Error('Too large');
   data=raw?JSON.parse(raw):{};}catch{return reply({ok:false,error:'Invalid JSON'},400)}
  if(path==='/config'){
   try{
    const val=threshold(data.thresholdUSDC);
    this.put('threshold',val.display);
    return reply({ok:true,thresholdUSDC:val.display,note:'Future scans use the updated threshold. Past events remain deduplicated.'});
   }catch(ex){return reply({ok:false,error:err(ex)},400)}
  }
  if(path==='/inspect')return this.inspect(data.hash);
  if(path==='/telegram-test')return this.testTelegram();
  return reply({ok:false,error:'Not found'},404);
 }
}
const doRequest=(env,path,data={})=>{
 const id=env.WATCH_STATE.idFromName('pharos-atlantic-usdc-watcher');
 return env.WATCH_STATE.get(id).fetch(new Request('https://alert-state.internal'+path,{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)
 }));
};
function adminAuthorized(request,env){
 const secret=String(env.ADMIN_API_KEY||'');
 return secret.length>=16&&request.headers.get('authorization')==='Bearer '+secret;
}
export default {
 async fetch(request,env={}){
  let c;try{c=setup(env)}catch(ex){return reply({ok:false,error:'Invalid Worker configuration: '+err(ex)},503)}
  const url=new URL(request.url),path=url.pathname;
  if(request.method==='GET'&&path==='/'){
   return new Response(PAGE,{headers:{'content-type':'text/html;charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff',
    'content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"}});
  }
  if(request.method==='GET'&&path==='/api/health')
   return reply({ok:true,...publicSetup(c),
    polling:'Cloudflare Cron Trigger every minute',
    event:'USDC Transfer above configured threshold',
    noDuplicatePolicy:'Reserve each event before delivery and never retry on uncertain results'});
  if(!c.hasStorage)return reply({ok:false,error:'Missing WATCH_STATE Durable Object binding'},503);
  if(request.method==='GET'&&path==='/api/status')
   return doRequest(env,'/status');
  const endpoints={
   '/api/admin/threshold':'/config',
   '/api/admin/inspect-tx':'/inspect',
   '/api/admin/telegram-test':'/telegram-test',
   '/api/admin/scan':'/scan'
  };
  if(request.method==='POST'&&endpoints[path]){
   if(!c.hasAdmin)return reply({ok:false,error:'Configure ADMIN_API_KEY as an encrypted Cloudflare secret'},503);
   if(!adminAuthorized(request,env))return reply({ok:false,error:'Unauthorized admin credential'},401);
   let data={};try{const raw=await request.text();
    if(raw.length>2500)throw Error('Input too long');data=raw?JSON.parse(raw):{};
   }catch{return reply({ok:false,error:'Malformed JSON'},400)}
   return doRequest(env,endpoints[path],data);
  }
  return reply({ok:false,error:'Not found'},404);
 },
 async scheduled(_controller,env,ctx){
  if(!env.WATCH_STATE){console.log('ALERT_SCAN_SKIPPED missing storage');return}
  ctx.waitUntil((async()=>{
   const res=await doRequest(env,'/scan');const result=await res.json();
   console.log('PHAROS_ALERT_CRON',JSON.stringify({
    ok:result.ok,from:result.from,to:result.to,
    sent:result.sent||0,duplicates:result.duplicates||0,
    reason:result.reason||result.error||null}));
  })());
 }
};
