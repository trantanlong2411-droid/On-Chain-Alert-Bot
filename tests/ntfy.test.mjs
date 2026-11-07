import test from 'node:test';
import assert from 'node:assert/strict';
import {channelName,validateTopic,hashAccess,publishNtfy} from '../src/ntfy.mjs';
const topic='pharos-alert-'+'a'.repeat(32);
const event={
 hash:'0x'+'b'.repeat(64),amountUSDC:'0.003',
 from:'0x7376422B448cf185223e4C0D7c30FbeE12E4437f',
 to:'0x4Fe2CC4Ce85fD93F327E2e121213474247F65242',
 block:'1200000',explorer:'https://atlantic.pharosscan.xyz/tx/0x'+'b'.repeat(64)
};
test('a private channel uses an unguessable 32 hex topic and never an arbitrary hostname',()=>{
 const generated=channelName();
 assert.match(generated,/^pharos-alert-[0-9a-f]{32}$/);
 assert.equal(validateTopic(topic),topic);
 assert.throws(()=>validateTopic('http://localhost'),/Invalid/);
 assert.throws(()=>validateTopic('pharos-alert-foo'),/Invalid/);
});
test('channel access token is hashed and not used as topic URL',async()=>{
 const token='c'.repeat(32)+'.'+'d'.repeat(32);
 assert.equal((await hashAccess(token)).length,64);
 assert.notEqual(await hashAccess(token),await hashAccess('c'.repeat(32)+'.'+'e'.repeat(32)));
 await assert.rejects(hashAccess('bad'),/Invalid/);
});
test('sends a real-channel formatted event including amount/from/to and link',async()=>{
 let calls=0;
 const r=await publishNtfy({topic,event},async(url,req)=>{
  calls++;assert.equal(url,'https://ntfy.sh/');
  assert.equal(req.method,'POST');const body=JSON.parse(req.body);
  assert.equal(body.topic,topic);
  assert.match(body.message,/0\.003 USDC/);
  assert.ok(body.message.includes(event.from));
  assert.ok(body.message.includes(event.to));
  assert.ok(body.message.includes(event.hash));
  assert.equal(body.click,event.explorer);
  return {ok:true,status:200,json:async()=>({event:'message',id:'VY9c9S10',topic})};
 });
 assert.equal(calls,1);assert.equal(r.messageId,'VY9c9S10');assert.equal(r.deliveryStatus,'accepted_by_ntfy');
 assert.match(r.note,/not proven/);
});
test('service rejected or topic-mismatched alert is not confirmed as sent',async()=>{
 await assert.rejects(publishNtfy({topic,event},async()=>({
  ok:false,status:429,json:async()=>({code:42901})})),/refused/);
 await assert.rejects(publishNtfy({topic,event},async()=>({
  ok:true,status:200,json:async()=>({event:'message',id:'x',topic:'other'})})),/unexpected topic/);
 await assert.rejects(publishNtfy({topic,event:{...event,explorer:'https://evil.example/tx/0x'+'b'.repeat(64)}},async()=>{}),/explorer/);
});
test('test message is explicitly not represented as an on-chain alert',async()=>{
 const result=await publishNtfy({topic,title:'Pharos connection test',message:'NOT a real on-chain event'},async(url,req)=>{
  const payload=JSON.parse(req.body);
  assert.equal(payload.title,'Pharos connection test');
  assert.match(payload.message,/NOT a real on-chain event/);
  assert.equal(payload.click,undefined);
  return {ok:true,status:200,json:async()=>({event:'message',id:'1234',topic})};
 });
 assert.equal(result.ok,true);
});
