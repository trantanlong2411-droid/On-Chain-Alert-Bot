// Fixed public ntfy delivery endpoint. No arbitrary webhook URLs or user-supplied secrets.
export const NTFY_ROOT='https://ntfy.sh/';
export function channelName(){
 return 'pharos-alert-'+crypto.randomUUID().replace(/-/g,'').toLowerCase();
}
export function validateTopic(topic){
 if(typeof topic!=='string'||!/^pharos-alert-[0-9a-f]{32}$/.test(topic))
  throw Error('Invalid private notification topic');
 return topic;
}
export async function hashAccess(token){
 if(typeof token!=='string'||!/^[0-9a-f]{32}\.[0-9a-f]{32}$/.test(token))
  throw Error('Invalid personal access credential');
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
 return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function publishNtfy({topic,event,title,message},fetcher=fetch){
 validateTopic(topic);
 if(event){
  if(!/^https:\/\/atlantic\.pharosscan\.xyz\/tx\/0x[0-9a-f]{64}$/i.test(event.explorer||''))
   throw Error('Not a verified Atlantic explorer link');
  if(!/^0x[0-9a-f]{64}$/i.test(event.hash||'')||!/^[0-9]+(?:\.[0-9]+)?$/.test(event.amountUSDC||''))
   throw Error('Invalid verified transfer evidence');
 }
 const body=event?{
  topic,title:'Pharos Atlantic · USDC transfer alert',
  message:'Confirmed USDC transfer: '+event.amountUSDC+' USDC\nFrom: '+event.from+
   '\nTo: '+event.to+'\nBlock: '+event.block+'\nTX: '+event.explorer,
  click:event.explorer,tags:['rotating_light','moneybag'],priority:3
 }:{
  topic,title:String(title||'Pharos channel test').slice(0,80),
  message:String(message||'This is a notification connection test, not an on-chain alert.').slice(0,350),
  tags:['test_tube'],priority:3
 };
 const res=await fetcher(NTFY_ROOT,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 const response=await res.json().catch(()=>null);
 if(!res.ok||response?.event!=='message'||typeof response?.id!=='string'||!response.id)
  throw Error('ntfy refused notification (HTTP '+res.status+')');
 if(response.topic!==topic)throw Error('ntfy returned unexpected topic');
 return {ok:true,messageId:response.id,topic,channel:'ntfy',acceptedAtUtc:new Date().toISOString(),
  deliveryStatus:'accepted_by_ntfy',note:'ntfy accepted the push. Delivery to a specific subscribed device is not proven.'};
}
