import {canonicalJson,DomainError,sha256,type SqlClient} from './db';
import {cents} from './money';
export type LedgerKind='provider_clearing'|'order_hold'|'seller_available'|'seller_reserved'|'platform_revenue'|'tax_payable'|'shipping_reserve'|'reward_expense';
export type Entry={accountId:string;side:'credit'|'debit';amount:bigint};
export async function account(db:SqlClient,code:string,kind:LedgerKind,walletId:string|null=null):Promise<string>{
 const side=['provider_clearing','reward_expense'].includes(kind)?'debit':'credit';
 const row=(await db.query<{id:string;kind:string;wallet_id:string|null}>(
  'INSERT INTO ch_platform.ledger_accounts(code,kind,normal_side,currency,wallet_id) VALUES($1,$2,$3,\'USD\',$4) ON CONFLICT(code) DO UPDATE SET code=EXCLUDED.code RETURNING id,kind,wallet_id',[code,kind,side,walletId])).rows[0];
 if(row.kind!==kind||row.wallet_id!==walletId)throw new DomainError('ledger_account_mismatch','Account identity mismatch.');return row.id;
}
export async function sellerWallet(db:SqlClient,userId:string){
 await db.query('SELECT id FROM ch_platform.users WHERE id=$1 FOR UPDATE',[userId]);
 const wallet=(await db.query<{id:string}>('INSERT INTO ch_platform.user_wallets(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING id',[userId])).rows[0];
 return {id:wallet.id,available:await account(db,'wallet:'+wallet.id+':available','seller_available',wallet.id),reserved:await account(db,'wallet:'+wallet.id+':reserved','seller_reserved',wallet.id)};
}
export async function balance(db:SqlClient,accountId:string):Promise<bigint>{
 const row=(await db.query<{balance:string}>(`SELECT coalesce(sum(CASE WHEN e.side=a.normal_side THEN e.amount_cents ELSE -e.amount_cents END),0)::text AS balance
  FROM ch_platform.ledger_accounts a LEFT JOIN ch_platform.ledger_entries e ON e.account_id=a.id WHERE a.id=$1 GROUP BY a.id`,[accountId])).rows[0];
 if(!row)throw new DomainError('account_not_found','Ledger account not found.',404);return BigInt(row.balance);
}
export async function post(db:SqlClient,input:{key:string;kind:string;walletId?:string;orderId?:string;providerReference?:string;entries:Entry[]}):Promise<string>{
 const entries=input.entries.filter(e=>e.amount>BigInt(0));
 const total=entries.reduce((sum,e)=>sum+(e.side==='debit'?cents(e.amount):-cents(e.amount)),BigInt(0));
 if(total!==BigInt(0)||entries.length<2)throw new DomainError('unbalanced_ledger','Balanced debit and credit entries are required.');
 // Lock in stable order before writing; protects independent withdrawal/release workers.
 const ids=[...new Set(entries.map(e=>e.accountId))].sort();
 await db.query('SELECT id FROM ch_platform.ledger_accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);
 const hash=await sha256(canonicalJson(input));
 const previous=(await db.query<{id:string;request_hash:string}>('SELECT id,request_hash FROM ch_platform.wallet_transactions WHERE idempotency_key=$1',[input.key])).rows[0];
 if(previous){if(previous.request_hash!==hash)throw new DomainError('ledger_key_reused','Ledger operation input changed.');return previous.id}
 const tx=(await db.query<{id:string}>(`INSERT INTO ch_platform.wallet_transactions(wallet_id,order_id,kind,idempotency_key,request_hash,provider_reference)
  VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[input.walletId||null,input.orderId||null,input.kind,input.key,hash,input.providerReference||null])).rows[0];
 for(const e of entries)await db.query('INSERT INTO ch_platform.ledger_entries(transaction_id,account_id,side,amount_cents) VALUES($1,$2,$3,$4)',[tx.id,e.accountId,e.side,e.amount.toString()]);
 return tx.id;
}
