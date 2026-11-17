// Seller strikes (migration 059): a missed shipping deadline on a won auction. Admin-only view. Server-only.
import {getPool} from '../db/postgres';

/** A missed shipping deadline on a paid order: one strike on the seller, visible to admins. Safe to call twice. */
export async function recordSellerStrike(input:{sellerId:string;orderId:string;reason:string}){
 try{await getPool().query('INSERT INTO ch_web.seller_strikes(id,seller_id,order_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING',[crypto.randomUUID(),input.sellerId,input.orderId,input.reason])}
 catch{/* before migration 059 the strike is skipped; the refund still happens */}
}
export async function sellerStrikes(limit=100){
 try{const {rows}=await getPool().query<{seller_id:string;handle:string;strikes:string;last:Date}>(`SELECT s.seller_id,p.handle,count(*)::text AS strikes,max(s.created_at) AS last FROM ch_web.seller_strikes s JOIN ch_web.profiles p ON p.id=s.seller_id GROUP BY s.seller_id,p.handle ORDER BY max(s.created_at) DESC LIMIT $1`,[limit]);
  return rows.map(r=>({sellerId:r.seller_id,handle:r.handle,strikes:Number(r.strikes),last:new Date(r.last).toISOString()}))}
 catch{return []}
}
