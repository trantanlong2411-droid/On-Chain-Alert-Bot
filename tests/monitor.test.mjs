import test from 'node:test';
import assert from 'node:assert/strict';
import {getAddress,hexlify,toBeHex} from 'ethers';
import {threshold,setup,publicSetup,TRANSFER_TOPIC,USDC_DEFAULT} from '../src/config.mjs';
import {parseTransfer,qualifying,scanWindow,messageFor,sendTelegram,blockStatus} from '../src/monitor.mjs';

const payer=getAddress('0x7376422B448cf185223e4C0D7c30FbeE12E4437f');
const receiver=getAddress('0x4Fe2CC4Ce85fD93F327E2e121213474247F65242');
const topic=a=>'0x'+'0'.repeat(24)+a.slice(2).toLowerCase();
const hash='0x'+'ab'.repeat(32);
const makeLog=(amount=3000n,overrides={})=>({
 address:USDC_DEFAULT,removed:false,topics:[TRANSFER_TOPIC,topic(payer),topic(receiver)],
 data:toBeHex(amount,32),logIndex:'0x1',blockNumber:'0x100',
 transactionHash:hash,...overrides
});
test('monitor restricts chain and token; validates six-decimal configured threshold',()=>{
 const c=setup({});
 assert.equal(publicSetup(c).chainId,688689);
 assert.equal(c.min.display,'0.01');
 assert.equal(c.hasTelegram,false);
 assert.equal(threshold('0.001').amount,'1000');
 assert.equal(threshold('0.003').amount,'3000');
 assert.throws(()=>threshold('0'),/between/);
 assert.throws(()=>threshold('0.0000001'),/up to 6/);
 assert.throws(()=>threshold('abc'),/decimal/);
 assert.throws(()=>threshold('1000001'),/between/);
});
test('parses real indexed USDC Transfer, amount, block, UTC explorer fields',()=>{
 const e=parseTransfer(makeLog(),USDC_DEFAULT);
 assert.equal(e.amountUSDC,'0.003');
 assert.equal(e.amountAtomic,'3000');
 assert.equal(e.from,payer);
 assert.equal(e.to,receiver);
 assert.equal(e.index,1);
 assert.equal(e.block,'256');
 assert.equal(e.id,hash+':1');
 assert.equal(e.explorer,'https://atlantic.pharosscan.xyz/tx/'+hash);
 const msg=messageFor(e,'2026-11-05T09:15:00.000Z');
 for(const t of ['USDC transfer','0.003 USDC','Observed at: 2026-11-05T09:15:00.000Z','Transaction: https://atlantic.pharosscan.xyz/tx/',payer,receiver]){
  assert.ok(msg.includes(t),'Message missing '+t);
 }
});
test('refuses unrelated assets, malformed events, removed logs, zero value and bad topics',()=>{
 const c=USDC_DEFAULT;
 for(const log of [
  makeLog(1n,{address:receiver}),
  makeLog(1n,{removed:true}),
  makeLog(1n,{topics:['0x'+'aa'.repeat(32),topic(payer),topic(receiver)]}),
  makeLog(1n,{topics:[TRANSFER_TOPIC,topic(payer)]}),
  makeLog(1n,{transactionHash:'bogus'}),
  makeLog(1n,{data:'0x1234'}),
  makeLog(0n)
 ])assert.equal(parseTransfer(log,c),null);
});
test('threshold uses exact atomic integer units and bounded scan window',()=>{
 const logs=[makeLog(999n,{logIndex:'0x1'}),makeLog(1000n,{logIndex:'0x2'}),makeLog(3000n,{logIndex:'0x3'})];
 assert.deepEqual(qualifying(logs,USDC_DEFAULT,'1000').map(x=>x.amountAtomic),['1000','3000']);
 assert.deepEqual(qualifying(logs,USDC_DEFAULT,'3000').map(x=>x.amountAtomic),['3000']);
 const first=scanWindow(null,1000n);
 assert.equal(first.from,905n);assert.equal(first.to,1000n);
 const again=scanWindow(1000n,1000n);
 assert.equal(again,null);
 const catchup=scanWindow(200n,1500n);
 assert.equal(catchup.from,201n);assert.equal(catchup.to,296n);
});
test('always verifies Atlantic network and applies confirmation headroom',async()=>{
 const c=setup({});
 const ok=await blockStatus(c,async(_c,m)=>m==='eth_chainId'?'0xa8231':'0x110');
 assert.equal(ok.latest,272n);assert.equal(ok.safe,269n);
 await assert.rejects(blockStatus(c,async(_c,m)=>m==='eth_chainId'?'0x1':'0x110'),/Wrong RPC network/);
});
test('Telegram delivery includes the actual amount and explorer link, requires valid response',async()=>{
 const e=parseTransfer(makeLog(),USDC_DEFAULT);
 let calls=0;
 const telegram=await sendTelegram(e,{TELEGRAM_BOT_TOKEN:'123456789:'+'A'.repeat(35),TELEGRAM_CHAT_ID:'12345'},
  async(url,init)=>{
   calls++;assert.match(url,/api.telegram.org\/bot/);
   const payload=JSON.parse(init.body);
   assert.equal(payload.chat_id,'12345');
   assert.match(payload.text,/0\.003 USDC/);
   assert.match(payload.text,/atlantic\.pharosscan\.xyz\/tx/);
   return {ok:true,status:200,json:async()=>({ok:true,result:{message_id:456}})};
  });
 assert.equal(telegram.messageId,'456');assert.equal(calls,1);
 await assert.rejects(sendTelegram(e,{},async()=>{throw Error('Never call')}),/not configured/);
 await assert.rejects(sendTelegram(e,{TELEGRAM_BOT_TOKEN:'123456789:'+'A'.repeat(35),TELEGRAM_CHAT_ID:'12345'},
  async()=>({ok:false,status:401,json:async()=>({ok:false})})),/failed/);
});
