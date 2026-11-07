import {DurableObject} from 'cloudflare:workers';
import {setup,publicSetup,threshold,NETWORK,TRANSFER_TOPIC} from './config.mjs';
import {rpc,blockStatus,qualifying,scanWindow,sendTelegram,smallJson} from './monitor.mjs';
import {PAGE} from './page.mjs';
import {publishNtfy,channelName,hashAccess} from './ntfy.mjs';
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
    telegramMessageId:this.get('personal')==='true'?null:x.telegram_message_id,
    ntfyNotificationId:this.get('personal')==='true'?x.telegram_message_id:null,error:x.error}));
  return {ok:true,network:NETWORK,thresholdUSDC:c.min.display,asset:c.asset,
   alertsTotal:count,deliveredTotal:delivered,cursor:this.get('cursor'),
   deliveryChannel:this.get('personal')==='true'?'ntfy':'telegram',
   ntfyTopic:this.get('personal')==='true'?this.get('topic'):null,
   ntfySubscriptionUrl:this.get('personal')==='true'?'https://ntfy.sh/'+this.get('topic'):null,
   storedMode:this.get('personal')==='true'?'private-personal-alert':'legacy-telegram',
   noRepeatPolicy:'Each event keyed by transaction hash and log index and reserved before publish',
   lastScan:this.get('lastScan'),lastError:this.get('lastError'),
   telegramConfigured:c.hasTelegram,adminConfigured:c.hasAdmin,
   notificationsViaNtfy:this.get('personal')==='true',recent};
 }
 async notifyOnce(e,source='cron'){
  const found=this.sql.exec('SELECT id,delivery FROM alerts WHERE id=?',e.id).toArray()[0];
  if(this.get('personal')==='true'){
   const sentToday=this.sql.exec("SELECT COUNT(*) as c FROM alerts WHERE first_seen >= ?",
    new Date(Date.now()-24*3600000).toISOString()).toArray()[0]?.c??0;
   if(sentToday>=35)return {status:'DAILY_LIMIT',id:e.id,error:'Personal channel safety cap: 35 unique alerts per 24h'};
  }
  if(found)return {status:'DUPLICATE',id:e.id,delivered:found.delivery};
  const at=iso();
  // Reserve in SQLite before network delivery. Unknown Telegram outcomes are not retried.
  this.sql.exec('INSERT OR IGNORE INTO alerts (id,tx_hash,log_index,block_number,from_address,to_address,amount_atomic,amount_usdc,explorer,source,first_seen,delivery) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',e.id,e.hash,e.index,e.block,e.from,e.to,e.amountAtomic,e.amountUSDC,e.explorer,source,at,'SENDING');
  try{
   const personal=this.get('personal')==='true';
   const delivered=personal?await publishNtfy({topic:this.get('topic'),event:e}):
     await sendTelegram(e,this.env);
   this.sql.exec("UPDATE alerts SET delivery='SENT',delivered_at=?,telegram_message_id=?,error=NULL WHERE id=?",iso(),delivered.messageId,e.id);
   return {status:'SENT',id:e.id,hash:e.hash,amountUSDC:e.amountUSDC,explorer:e.explorer,
    channel:personal?'ntfy':'telegram',notificationId:delivered.messageId,
    warning:personal?'Accepted by ntfy; subscriber device delivery is not proven':null};
  }catch(ex){
   const reason=err(ex);
   this.sql.exec("UPDATE alerts SET delivery='DELIVERY_UNCERTAIN',error=? WHERE id=?",reason,e.id);
   return {status:'DELIVERY_UNCERTAIN',id:e.id,error:reason};
  }
 }
 async scan(){
  const c=this.opts();
  if(!c.hasTelegram&&this.get('personal')!=='true')
   return {ok:false,reason:'TELEGRAM_NOT_CONFIGURED',note:'Legacy Telegram watcher is inactive; create an ntfy personal channel on the website to monitor without secrets.'};
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
  if(!c.hasTelegram&&this.get('personal')!=='true')
   return reply({ok:false,error:'Configure Telegram secrets, or create a personal ntfy channel for key-free alerts'},503);
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
 async initPersonal(data){
  if(this.get('personal')==='true'||this.get('topic'))return reply({ok:false,error:'This private channel is already initialized'},409);
  try{
   const value=threshold(data.thresholdUSDC||'0.001');
   const tokenHash=await hashAccess(data.token);
   const topic=channelName();
   this.put('threshold',value.display);
   this.put('tokenHash',tokenHash);
   this.put('personal','true');
   this.put('topic',topic);
   this.put('createdAt',iso());
   await this.ctx.storage.setAlarm(Date.now()+3000);
   return reply({ok:true,channel:'ntfy',thresholdUSDC:value.display,topic,subscribeUrl:'https://ntfy.sh/'+topic});
  }catch(ex){return reply({ok:false,error:err(ex)},400);}
 }
 async ownerOK(request){
  const token=(request.headers.get('authorization')||'').replace(/^Bearer\\s+/i,'').trim();
  if(!token)return false;
  try{
   const hash=await hashAccess(token);
   return !!this.get('tokenHash')&&hash===this.get('tokenHash');
  }catch{return false;}
 }
 async testNtfy(){
  if(this.get('personal')!=='true')return reply({ok:false,error:'Not an ntfy channel'},400);
  const last=Date.parse(this.get('lastNtfyTest')||'');
  if(Number.isFinite(last)&&Date.now()-last<300000)
   return reply({ok:false,error:'Connection test allowed once every five minutes to prevent message spam'},429);
  try{
   const result=await publishNtfy({topic:this.get('topic'),
    title:'Pharos Alert Bot · Channel connection test',
    message:'Connection test sent at '+iso()+' UTC. This is NOT a real blockchain transaction alert.'});
   this.put('lastNtfyTest',iso());
   this.put('lastNtfyMessageId',result.messageId);
   return reply({ok:true,...result});
  }catch(ex){return reply({ok:false,error:err(ex)},502);}
 }
 async alarm(){
  try{
   if(this.get('personal')==='true')await this.scan();
  }catch(ex){
   this.put('lastError','Alarm: '+err(ex));
  }finally{
   if(this.get('personal')==='true')
    await this.ctx.storage.setAlarm(Date.now()+120000);
  }
 }
 async fetch(request){
  if(request.method!=='POST')return reply({error:'POST required'},405);
  const path=new URL(request.url).pathname;
  if(path==='/status')return reply(this.status());
  if(path==='/scan'){
   if(this.get('personal')==='true'&&!await this.ownerOK(request))return reply({ok:false,error:'Invalid channel edit token'},403);
   return reply(await this.scan());
  }
  let data;
  try{const raw=await request.text();if(raw.length>2500)throw Error('Too large');
   data=raw?JSON.parse(raw):{};}catch{return reply({ok:false,error:'Invalid JSON'},400)}
  if(path==='/init-ntfy')return this.initPersonal(data);
  if(path==='/ntfy-test'){
   if(!await this.ownerOK(request))return reply({ok:false,error:'Not authorized'},403);
   return this.testNtfy();
  }
  if(path==='/personal-inspect'){
   if(!await this.ownerOK(request))return reply({ok:false,error:'Not authorized'},403);
   if(this.get('personal')!=='true')return reply({ok:false,error:'Not a personal ntfy channel'},400);
   return this.inspect(data.hash);
  }
  if(path==='/personal-config'&&!await this.ownerOK(request))
   return reply({ok:false,error:'Not authorized'},403);
  if(path==='/config'||path==='/personal-config'){
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
const doRequest=(env,path,data={},scope='pharos-atlantic-usdc-watcher',authorization='')=>{
 const id=env.WATCH_STATE.idFromName(scope);
 const headers={'content-type':'application/json'};
 if(authorization)headers.authorization=authorization;
 return env.WATCH_STATE.get(id).fetch(new Request('https://alert-state.internal'+path,{
  method:'POST',headers,body:JSON.stringify(data)
 }));
};
const personalID=id=>'pharos-ntfy-'+id;
const createdByIp=new Map();
function allowCreate(request){
 const ip=(request.headers.get('cf-connecting-ip')||'anonymous').slice(0,90);
 const now=Date.now(),old=createdByIp.get(ip);
 if(!old||now-old.start>600000){createdByIp.set(ip,{start:now,count:1});return true;}
 old.count++;return old.count<=3;
}
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
    noDuplicatePolicy:'Reserve each event before delivery and never retry on uncertain results',
    ntfyEnabled:true,personalChannelsWithoutAdminKey:true,
    personalPoll:'Durable Object alarm every 2 minutes (best effort)',
    notificationChannel:'ntfy (free per-user topic) or existing optional Telegram'});
  if(!c.hasStorage)return reply({ok:false,error:'Missing WATCH_STATE Durable Object binding'},503);
  if(request.method==='GET'&&path==='/api/status')
   return doRequest(env,'/status');
  const personalPath=path.match(new RegExp('^/api/ntfy/([0-9a-f]{32})(?:/(threshold|inspect|test|scan))?
  if(request.method==='POST'&&path==='/api/ntfy/create'){
   if(!allowCreate(request))return reply({ok:false,error:'Create limit: 3 channels per 10 minutes. Retry later.'},429);
   try{
    const raw=await request.text();if(raw.length>300)throw Error('Creation request too long');
    const cfg=raw?JSON.parse(raw):{},value=threshold(cfg.thresholdUSDC||'0.001');
    const id=crypto.randomUUID().replace(/-/g,'');
    const token=crypto.randomUUID().replace(/-/g,'')+'.'+crypto.randomUUID().replace(/-/g,'');
    const initialized=await doRequest(env,'/init-ntfy',{token,thresholdUSDC:value.display},personalID(id));
    const result=await initialized.json();
    if(!initialized.ok||!result.ok)return reply(result,initialized.status);
    return reply({ok:true,id,editToken:token,thresholdUSDC:value.display,
     publicDashboard:url.origin+'/?channel='+id,subscribeUrl:result.subscribeUrl,
     channel:'ntfy',notice:'Save your edit token privately. Topic URLs are public to anyone who knows them; do not send sensitive data.'},201);
   }catch(ex){return reply({ok:false,error:err(ex)},400);}
  }
  if(personalPath){
   const id=personalPath[1],action=personalPath[2];
   if(request.method==='GET'&&!action)return doRequest(env,'/status',{},personalID(id));
   if(request.method==='POST'&&['threshold','inspect','test','scan'].includes(action)){
    try{
     const raw=await request.text();if(raw.length>500)throw Error('Request too long');
     const data=raw?JSON.parse(raw):{};
     const name={threshold:'/personal-config',inspect:'/personal-inspect',test:'/ntfy-test',scan:'/scan'}[action];
     return doRequest(env,name,data,personalID(id),request.headers.get('authorization')||'');
    }catch(ex){return reply({ok:false,error:err(ex)},400);}
   }
  }
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
));
  if(request.method==='POST'&&path==='/api/ntfy/create'){
   if(!allowCreate(request))return reply({ok:false,error:'Create limit: 3 channels per 10 minutes. Retry later.'},429);
   try{
    const raw=await request.text();if(raw.length>300)throw Error('Creation request too long');
    const cfg=raw?JSON.parse(raw):{},value=threshold(cfg.thresholdUSDC||'0.001');
    const id=crypto.randomUUID().replace(/-/g,'');
    const token=crypto.randomUUID().replace(/-/g,'')+'.'+crypto.randomUUID().replace(/-/g,'');
    const initialized=await doRequest(env,'/init-ntfy',{token,thresholdUSDC:value.display},personalID(id));
    const result=await initialized.json();
    if(!initialized.ok||!result.ok)return reply(result,initialized.status);
    return reply({ok:true,id,editToken:token,thresholdUSDC:value.display,
     publicDashboard:url.origin+'/?channel='+id,subscribeUrl:result.subscribeUrl,
     channel:'ntfy',notice:'Save your edit token privately. Topic URLs are public to anyone who knows them; do not send sensitive data.'},201);
   }catch(ex){return reply({ok:false,error:err(ex)},400);}
  }
  if(personalPath){
   const id=personalPath[1],action=personalPath[2];
   if(request.method==='GET'&&!action)return doRequest(env,'/status',{},personalID(id));
   if(request.method==='POST'&&['threshold','inspect','test','scan'].includes(action)){
    try{
     const raw=await request.text();if(raw.length>500)throw Error('Request too long');
     const data=raw?JSON.parse(raw):{};
     const name={threshold:'/personal-config',inspect:'/personal-inspect',test:'/ntfy-test',scan:'/scan'}[action];
     return doRequest(env,name,data,personalID(id),request.headers.get('authorization')||'');
    }catch(ex){return reply({ok:false,error:err(ex)},400);}
   }
  }
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
