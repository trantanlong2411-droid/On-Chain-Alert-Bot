import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {setup} from '../src/config.mjs';
import {rpc,blockStatus,qualifying,messageFor} from '../src/monitor.mjs';
const c=setup({});
// A real on-chain Circle USDC transfer from the previously verified Agent Buyer.
const txHash='0x4a603ea2d43512a76cc21f2d64b09e1ec4e07c34adc929526b514289ccfa61e1';
const status=await blockStatus(c);
const receipt=await rpc(c,'eth_getTransactionReceipt',[txHash]);
assert.ok(receipt,'Transaction not found on Atlantic RPC');
assert.equal(BigInt(receipt.status),1n);
assert.ok(BigInt(receipt.blockNumber)<=status.safe);
const events=qualifying(receipt.logs||[],c.asset,'1000').filter(e=>e.hash.toLowerCase()===txHash);
assert.ok(events.length>0,'Expected a real Pharos Circle USDC transfer');
const transfer=events[0];
assert.equal(transfer.amountUSDC,'0.003');
assert.equal(transfer.from.toLowerCase(),'0x7376422B448cf185223e4C0D7c30FbeE12E4437f'.toLowerCase());
assert.equal(transfer.to.toLowerCase(),'0x4Fe2CC4Ce85fD93F327E2e121213474247F65242'.toLowerCase());
const text=messageFor(transfer);
assert.match(text,/0\.003 USDC/);
assert.ok(text.includes(txHash));
const evidence={
 schema:'pharos-onchain-alert-readonly-evidence-v1',
 observedAtUtc:new Date().toISOString(),
 network:'eip155:688689',latestBlock:status.latest.toString(),
 finalizedHead:status.safe.toString(),asset:c.asset,
 actualTransfer:transfer,telegramAlertPreview:text,
 evidenceType:'REAL_CHAIN_EVENT_READ_ONLY',
 telegramDeliveryStatus:'NOT_VERIFIED_BY_THIS_READ_ONLY_TEST',
 note:'This GitHub Action checks a confirmed transfer on Atlantic, constructs the actual message, and never sends Telegram. Real Telegram delivery must be confirmed with configured Cloudflare secrets and a durable alert event.'
};
await mkdir('proof',{recursive:true});
await writeFile('proof/atlantic-readonly-evidence.json',JSON.stringify(evidence,null,2)+'\n');
console.log('PHAROS_REAL_ONCHAIN_ALERT_EVENT_VERIFIED',JSON.stringify({
 txHash,block:transfer.block,amountUSDC:transfer.amountUSDC,asset:c.asset
}));
