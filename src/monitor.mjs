import {getAddress,formatUnits} from 'ethers';
import {CHAIN_ID,TRANSFER_TOPIC,EXPLORER} from './config.mjs';
const asHex=x=>{
 if(typeof x!=='string'||!/^0x[0-9a-f]+$/i.test(x))throw Error('Invalid hex quantity returned from RPC');
 return BigInt(x);
};
export async function rpc(c,method,params=[],fetcher=fetch){
 if(!['eth_chainId','eth_blockNumber','eth_getLogs','eth_getTransactionReceipt'].includes(method))
  throw Error('Disallowed JSON-RPC method');
 let last;
 for(let i=0;i<3;i++){
  try{
   const id=crypto.getRandomValues(new Uint32Array(1))[0];
   const res=await fetcher(c.rpc,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(15000)
   });
   if(!res.ok)throw Error('Atlantic RPC HTTP '+res.status);
   const val=await res.json();
   if(val.jsonrpc!=='2.0'||val.id!==id)throw Error('Unexpected JSON-RPC response');
   if(val.error)throw Error('Atlantic RPC '+method+': '+String(val.error.message||'rejected').slice(0,150));
   if(val.result===undefined||val.result===null)throw Error('RPC returned null: '+method);
   return val.result;
  }catch(e){
   last=e;
   if(i<2)await new Promise(resolve=>setTimeout(resolve,500*(i+1)));
  }
 }
 throw Error(String(last?.message||last||'RPC timeout').slice(0,190));
}
export async function blockStatus(c,transport=rpc){
 const [chain,latestHex]=await Promise.all([
  transport(c,'eth_chainId',[]),transport(c,'eth_blockNumber',[])
 ]);
 if(asHex(chain)!==BigInt(CHAIN_ID))throw Error('Wrong RPC network, expected Pharos Atlantic 688689');
 const latest=asHex(latestHex);
 const safe=latest>BigInt(c.finality)?latest-BigInt(c.finality):0n;
 return {latest,safe};
}
const addressTopic=x=>{
 if(typeof x!=='string'||!/^0x[0-9a-f]{64}$/i.test(x))throw Error('Malformed indexed address');
 if(!/^0{24}$/i.test(x.slice(2,26)))throw Error('Non-address indexed topic');
 return getAddress('0x'+x.slice(26));
};
export function parseTransfer(log,asset){
 try{
  if(!log||log.removed===true||String(log.address).toLowerCase()!==asset.toLowerCase())return null;
  if(!Array.isArray(log.topics)||log.topics.length!==3||
   String(log.topics[0]).toLowerCase()!==TRANSFER_TOPIC)return null;
  const raw=String(log.data||'');
  if(!/^0x[0-9a-f]{64}$/i.test(raw)||!/^0x[0-9a-f]{64}$/i.test(String(log.transactionHash||'')))return null;
  const amount=BigInt(raw);
  if(amount<=0n||!Number.isSafeInteger(Number(asHex(log.logIndex))))return null;
  const from=addressTopic(log.topics[1]),to=addressTopic(log.topics[2]);
  return {
   id:String(log.transactionHash).toLowerCase()+':'+asHex(log.logIndex).toString(),
   hash:String(log.transactionHash).toLowerCase(),
   index:Number(asHex(log.logIndex)),
   block:asHex(log.blockNumber).toString(),from,to,
   amountAtomic:amount.toString(),amountUSDC:formatUnits(amount,6),
   explorer:EXPLORER+log.transactionHash
  };
 }catch{return null}
}
export function qualifying(logs,asset,minAtomic){
 return logs.map(l=>parseTransfer(l,asset)).filter(e=>e&&BigInt(e.amountAtomic)>=BigInt(minAtomic))
  .sort((a,b)=>BigInt(a.block)<BigInt(b.block)?-1:BigInt(a.block)>BigInt(b.block)?1:a.index-b.index);
}
export function scanWindow(cursor,safe,backfill=96n,maxRange=96n){
 const end=BigInt(safe);
 const first=cursor===null? (end>backfill?end-backfill+1n:0n):BigInt(cursor)+1n;
 if(first>end)return null;
 const to=first+maxRange-1n<end?first+maxRange-1n:end;
 return {from:first,to,remaining:end-to};
}
export function messageFor(e,observedUTC=new Date().toISOString()){
 return [
  '🚨 PHAROS ON-CHAIN ALERT',
  'Network: Atlantic Testnet (688689)',
  'Event: USDC transfer crossed configured threshold',
  'Value: '+e.amountUSDC+' USDC',
  'From: '+e.from,
  'To: '+e.to,
  'Block: '+e.block,
  'Observed at: '+observedUTC+' UTC',
  'Transaction: '+e.explorer
 ].join('\n');
}
export async function sendTelegram(e,env,fetcher=fetch){
 const token=String(env.TELEGRAM_BOT_TOKEN||'');
 const chatId=String(env.TELEGRAM_CHAT_ID||'');
 if(!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)||!chatId||chatId.length>150)
  throw Error('Telegram Bot API token or chat ID is not configured');
 const res=await fetcher('https://api.telegram.org/bot'+token+'/sendMessage',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({chat_id:chatId,text:messageFor(e),disable_web_page_preview:true}),
  signal:AbortSignal.timeout(12000)
 });
 const data=await res.json().catch(()=>null);
 if(!res.ok||data?.ok!==true||!data.result?.message_id)
  throw Error('Telegram sendMessage failed'+(res.status?': HTTP '+res.status:''));
 return {ok:true,messageId:String(data.result.message_id)};
}
export function smallJson(data,status=200){
 return Response.json(data,{status,headers:{
  'cache-control':'no-store','x-content-type-options':'nosniff'
 }});
}
