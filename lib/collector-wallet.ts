import type {Pool,PoolClient} from 'pg';
import {evaluateCommercePolicy,type CommerceState} from './commerce-policy';

type Order={id:string;version:number;buyer_user_id:string;seller_user_id:string;buyer_id:string;seller_id:string;sandbox:number;
 status:string;snapshot:string;state:string;payment_intent_id:string|null;charge_id:string|null;transfer_id:string|null};
type Entry={id:string;user_id:string;order_id:string;mode:'live'|'sandbox';bucket:'pending'|'available'|'activity';kind:string;amount_cents:number;source_reference:string;created_at:string};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const amount=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=100_000_000?value:null;

async function reconcileOrder(client:PoolClient,row:Order,userId:string){
 let snapshot:unknown,state:CommerceState;
 try{snapshot=JSON.parse(row.snapshot);state=JSON.parse(row.state)}catch{return false}
 if(!object(snapshot)||!state||state.status!==row.status||evaluateCommercePolicy(state,new Date().toISOString()).reason==='invalid_or_unknown_state')return false;
 const order=state.order,total=amount(snapshot.totalCents),proceeds=amount(snapshot.sellerTransferCents);
 if(total===null||proceeds===null||proceeds>total||snapshot.currency!=='USD'||order.orderId!==row.id||order.buyerId!==row.buyer_id||order.sellerId!==row.seller_id||order.totalCents!==total||order.sellerTransferCents!==proceeds)return false;
 if(!order.paidAt||!row.payment_intent_id||!row.charge_id||order.paymentIntentId!==row.payment_intent_id||order.chargeId!==row.charge_id)return false;
 const [payment]=(await client.query<{id:string}>("SELECT id FROM ch_web.commerce_events WHERE order_id=$1 AND type='payment_confirmed' AND provider_event_id IS NOT NULL LIMIT 1",[row.id])).rows;
 if(!payment)return false;
 const mode=row.sandbox===1?'sandbox':'live',entries:Entry[]=[];
 const entry=(kind:Entry['kind'],bucket:Entry['bucket'],value:number,reference:string,stamp:string)=>entries.push({id:'wallet:'+row.id+':'+userId+':'+kind,user_id:userId,order_id:row.id,mode,bucket,kind,amount_cents:value,source_reference:reference,created_at:stamp});
 if(row.buyer_user_id===userId)entry('purchase','activity',-total,row.payment_intent_id,order.paidAt);
 if(row.seller_user_id===userId)entry('sale_pending','pending',proceeds,row.payment_intent_id,order.paidAt);
 const financial=state.financial;let valid=true;
 if(financial?.confirmedAt&&financial.processorId){
  const [receipt]=(await client.query<{provider_id:string}>(`SELECT provider_id FROM ch_web.commerce_money_requests
   WHERE id=$1 AND order_id=$2 AND kind=$3 AND status='succeeded' AND provider_id=$4 AND amount_cents=$5 LIMIT 1`,
  [financial.requestId,row.id,financial.kind,financial.processorId,financial.kind==='transfer'?proceeds:total])).rows;
  if(!receipt)valid=false;
  else if(financial.kind==='transfer'){
   if(row.transfer_id!==receipt.provider_id)valid=false;
   else if(row.seller_user_id===userId){
    entry('pending_release','pending',-proceeds,receipt.provider_id,financial.confirmedAt);
    entry('sale_proceeds','available',proceeds,receipt.provider_id,financial.confirmedAt);
   }
  }else if(financial.kind==='refund'){
   if(row.buyer_user_id===userId)entry('refund','activity',total,receipt.provider_id,financial.confirmedAt);
   if(row.seller_user_id===userId){
    const prior=(await client.query("SELECT id FROM ch_web.collector_wallet_entries WHERE user_id=$1 AND order_id=$2 AND kind='sale_proceeds'",[userId,row.id])).rows;
    if(prior.length)valid=false;
    else entry('pending_refund','pending',-proceeds,receipt.provider_id,financial.confirmedAt);
   }
  }
 }
 if(entries.length)await client.query(`INSERT INTO ch_web.collector_wallet_entries(id,user_id,order_id,mode,bucket,kind,amount_cents,source_reference,created_at)
  SELECT id,user_id,order_id,mode,bucket,kind,amount_cents,source_reference,created_at FROM jsonb_to_recordset($1::jsonb)
   AS x(id text,user_id text,order_id text,mode text,bucket text,kind text,amount_cents bigint,source_reference text,created_at timestamptz)
  ON CONFLICT(user_id,order_id,mode,kind) DO NOTHING`,[JSON.stringify(entries)]);
 return valid;
}

/** Reconcile authenticated processor receipts only. Manual sold reports never
 * credit funds, sandbox balances are separate, and cash-out stays disabled
 * until a payment account and payout service are connected. */
export async function collectorWallet(pool:Pool,userId:string,offset=0){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('comichuddle-wallet:'||$1))",[userId]);
  const candidates=`FROM ch_web.commerce_orders o LEFT JOIN ch_web.wallet_reconciliation_checks c ON c.order_id=o.id AND c.user_id=$1
   WHERE (o.buyer_user_id=$1 OR o.seller_user_id=$1) AND (c.order_id IS NULL OR c.order_version<>o.version)
   AND EXISTS(SELECT 1 FROM ch_web.commerce_events e WHERE e.order_id=o.id AND e.type='payment_confirmed' AND e.provider_event_id IS NOT NULL)`;
  const orders=await client.query<Order>(`SELECT o.* ${candidates} ORDER BY o.created_at DESC,o.id LIMIT 100`,[userId]);
  for(const row of orders.rows){
   const valid=await reconcileOrder(client,row,userId);
   await client.query(`INSERT INTO ch_web.wallet_reconciliation_checks(user_id,order_id,order_version,valid)
    VALUES($1,$2,$3,$4) ON CONFLICT(user_id,order_id) DO UPDATE SET order_version=excluded.order_version,valid=excluded.valid,checked_at=now()`,[userId,row.id,row.version,valid]);
  }
  await client.query('COMMIT');
  const balances=await client.query<{mode:string;bucket:string;cents:string}>(`SELECT mode,bucket,sum(amount_cents)::text AS cents FROM ch_web.collector_wallet_entries WHERE user_id=$1 GROUP BY mode,bucket`,[userId]);
  const result={live:{availableCents:'0',pendingCents:'0'},sandbox:{availableCents:'0',pendingCents:'0'}};
  for(const row of balances.rows)if((row.mode==='live'||row.mode==='sandbox')&&(row.bucket==='available'||row.bucket==='pending'))result[row.mode][row.bucket==='available'?'availableCents':'pendingCents']=row.cents;
  const history=await client.query<{id:string;order_id:string;mode:string;bucket:string;kind:string;amount_cents:string;created_at:string}>(`SELECT id,order_id,mode,bucket,kind,amount_cents::text AS amount_cents,created_at FROM ch_web.collector_wallet_entries WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET $2`,[userId,offset]);
  const [unreconciled]=(await client.query<{n:string}>("SELECT count(*)::text AS n FROM ch_web.wallet_reconciliation_checks WHERE user_id=$1 AND NOT valid",[userId])).rows;
  const [remaining]=(await client.query<{n:string}>(`SELECT count(*)::text AS n ${candidates}`,[userId])).rows;
  return {...result,history:history.rows.slice(0,30),hasMore:history.rows.length>30,offset,unreconciledOrders:Number(unreconciled.n),remainingOrders:Number(remaining.n),withdrawalEnabled:false,
   note:'Balances reflect confirmed platform payment and transfer receipts. Cash and manually marked sales do not create funds. Sandbox amounts are separate from real USD proceeds. Cash-out is unavailable until the payout service is connected.'};
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
