import {getAddress,parseUnits,formatUnits} from 'ethers';
export const VERSION='pharos-onchain-alert-2026-11-07-v2';
export const CHAIN_ID=688689;
export const NETWORK='eip155:688689';
export const RPC_DEFAULT='https://atlantic.dplabs-internal.com';
export const USDC_DEFAULT='0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B';
export const EXPLORER='https://atlantic.pharosscan.xyz/tx/';
export const TRANSFER_TOPIC='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export function threshold(text){
 const s=String(text??'').trim();
 if(!/^\d+(?:\.\d{1,6})?$/.test(s))throw Error('Threshold must be a decimal USDC amount, up to 6 decimals');
 const amount=parseUnits(s,6);
 if(amount<=0n||amount>parseUnits('1000000',6))throw Error('Threshold must be between 0.000001 and 1000000 USDC');
 return {amount:amount.toString(),display:formatUnits(amount,6)};
}
export function setup(env={}){
 const rpc=String(env.ATLANTIC_RPC_URL||RPC_DEFAULT);
 const asset=getAddress(String(env.USDC_CONTRACT||USDC_DEFAULT));
 if(!/^https:\/\/[^?#]+$/i.test(rpc))throw Error('Invalid RPC configuration');
 const min=threshold(env.ALERT_MIN_USDC||'0.01');
 const finality=Math.max(2,Math.min(24,Number(env.FINALITY_BLOCKS||3)||3));
 return {rpc,asset,min,finality,
  hasTelegram:Boolean(env.TELEGRAM_BOT_TOKEN&&env.TELEGRAM_CHAT_ID),
  hasAdmin:Boolean(env.ADMIN_API_KEY&&String(env.ADMIN_API_KEY).length>=16),
  hasStorage:Boolean(env.WATCH_STATE)};
}
export function publicSetup(c){
 return {version:VERSION,network:NETWORK,chainId:CHAIN_ID,
  asset:c.asset,explorer:EXPLORER,
  telegramConfigured:c.hasTelegram,adminConfigured:c.hasAdmin,
  storageConfigured:c.hasStorage,finalityBlocks:c.finality};
}
