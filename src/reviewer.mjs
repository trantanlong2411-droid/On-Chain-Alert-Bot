import {blockStatus,rpc,qualifying,messageFor} from './monitor.mjs';

export const DEMO_HASH='0x4a603ea2d43512a76cc21f2d64b09e1ec4e07c34adc929526b514289ccfa61e1';
export const DEMO_MIN='1000';

export async function previewRealTransfer(c,transport=rpc){
 const {safe}=await blockStatus(c,transport);
 const receipt=await transport(c,'eth_getTransactionReceipt',[DEMO_HASH]);
 if(!receipt||BigInt(receipt.status||'0x0')!==1n)throw Error('Example transaction was not successful');
 if(BigInt(receipt.blockNumber)>safe)throw Error('Example has insufficient confirmations');
 const events=qualifying(receipt.logs||[],c.asset,DEMO_MIN)
  .filter(e=>e.hash===DEMO_HASH&&e.amountAtomic==='3000');
 if(events.length!==1)throw Error('Unexpected verified USDC transfer data');
 return {event:events[0],alertPreview:messageFor(events[0]),demoThresholdUSDC:'0.001',
   kind:'READ_ONLY_VERIFIED_TRANSACTION',note:'Read-only example, never sends a Telegram alert'};
}
