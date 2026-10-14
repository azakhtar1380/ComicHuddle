import {DomainError,once,outbox,serializable,sha256,canonicalJson,type SqlPool} from './db';
import {account,balance,post,sellerWallet} from './ledger';
import {cents} from './money';
export type WalletConfig={withdrawalsEnabled:boolean;providerApproved:boolean;minimumWithdrawalCents:string;cashRewardsEnabled:false};
export const defaultWallet:WalletConfig={withdrawalsEnabled:false,providerApproved:false,minimumWithdrawalCents:'100',cashRewardsEnabled:false};
export async function requestWithdrawal(pool:SqlPool,userId:string,amountCents:string,key:string,config:WalletConfig){
 if(!config.withdrawalsEnabled||!config.providerApproved)throw new DomainError('withdrawals_disabled','Withdrawals are not enabled.',503);
 const amount=cents(amountCents);if(amount<cents(config.minimumWithdrawalCents))throw new DomainError('withdrawal_too_small','Withdrawal is below the minimum.',400);
 return serializable(pool,db=>once(db,key,'withdrawal',{userId,amountCents},async()=>{
  const seller=(await db.query<{connected_account_id:string|null;payouts_enabled:boolean}>('SELECT connected_account_id,payouts_enabled FROM ch_platform.users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
  if(!seller?.connected_account_id||!seller.payouts_enabled)throw new DomainError('payout_verification_required','Complete seller payout verification first.',403);
  const disputed=(await db.query<{id:string}>('SELECT id FROM ch_platform.orders WHERE seller_id=$1 AND dispute_open LIMIT 1',[userId])).rows[0];
  if(disputed)throw new DomainError('wallet_dispute_hold','Resolve the open dispute before requesting withdrawal.');
  const wallet=await sellerWallet(db,userId);
  if(await balance(db,wallet.available)<amount)throw new DomainError('insufficient_funds','Withdrawal exceeds available earned proceeds.');
  const row=(await db.query<{id:string}>(`INSERT INTO ch_platform.withdrawals(wallet_id,user_id,amount_cents,idempotency_key,request_hash)
   VALUES($1,$2,$3,$4,$5) RETURNING id`,[wallet.id,userId,amountCents,key,await sha256(canonicalJson({userId,amountCents}))])).rows[0];
  await post(db,{key:'reserve:'+row.id,kind:'withdrawal_reserved',walletId:wallet.id,entries:[{accountId:wallet.available,side:'debit',amount},{accountId:wallet.reserved,side:'credit',amount}]});
  await outbox(db,'stripe_payout',row.id,'payout:'+row.id,{withdrawalId:row.id,userId,destination:seller.connected_account_id,amountCents});
  return {withdrawalId:row.id,status:'reserved',amountCents};
 }));
}
// Called by a verified/reconciled provider event, never a collector HTTP body.
export async function settleWithdrawal(pool:SqlPool,id:string,event:{payoutId:string;connectedAccountId:string;amountCents:string;status:'paid'|'failed';receiptVerified:true},key:string){
 return serializable(pool,db=>once(db,key,'withdrawal_receipt',{id,event},async()=>{
  const w=(await db.query<{id:string;user_id:string;wallet_id:string;amount_cents:string;status:string;provider_payout_id:string|null}>('SELECT * FROM ch_platform.withdrawals WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!w)throw new DomainError('withdrawal_missing','Withdrawal not found.',404);
  const seller=(await db.query<{connected_account_id:string}>('SELECT connected_account_id FROM ch_platform.users WHERE id=$1',[w.user_id])).rows[0];
  if(!event.receiptVerified||seller.connected_account_id!==event.connectedAccountId||cents(event.amountCents)!==cents(w.amount_cents)||
   (w.provider_payout_id&&w.provider_payout_id!==event.payoutId))throw new DomainError('payout_mismatch','Provider payout needs reconciliation.');
  if(['paid','failed'].includes(w.status))throw new DomainError('payout_already_final','Payout already has a final outcome.');
  const wallet=await sellerWallet(db,w.user_id),amount=cents(w.amount_cents);
  await post(db,{key:'payout-receipt:'+w.id,kind:event.status==='paid'?'withdrawal_paid':'withdrawal_released',walletId:wallet.id,providerReference:event.payoutId,entries:[
   {accountId:wallet.reserved,side:'debit',amount},
   {accountId:event.status==='paid'?await account(db,'provider:clearing','provider_clearing'):wallet.available,side:'credit',amount}]});
  await db.query('UPDATE ch_platform.withdrawals SET status=$2,provider_payout_id=$3,updated_at=now() WHERE id=$1',[id,event.status,event.payoutId]);
  return {withdrawalId:id,status:event.status};
 }));
}
