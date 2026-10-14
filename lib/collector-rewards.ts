import type {Pool} from 'pg';
export async function collectorRewards(pool:Pool,userId:string,mode:'live'|'sandbox'='live'){
 const rows=(await pool.query<{mode:string;points_balance:number;credit_cents:number;reserved_cents:number}>('SELECT mode,points_balance,credit_cents,reserved_cents FROM ch_web.reward_accounts WHERE user_id=$1',[userId])).rows;
 const balances=Object.fromEntries(['live','sandbox'].map(key=>{const row=rows.find(row=>row.mode===key);return[key,{points:Math.max(0,Number(row?.points_balance||0)),pointsDebt:Math.max(0,-Number(row?.points_balance||0)),availableCreditCents:Number(row?.credit_cents||0)-Number(row?.reserved_cents||0),reservedCreditCents:Number(row?.reserved_cents||0)}]}));
 const history=(await pool.query('SELECT id,kind,points_delta,credit_delta,created_at FROM ch_web.reward_ledger WHERE user_id=$1 AND mode=$2 ORDER BY created_at DESC,id LIMIT 30',[userId,mode])).rows;
 return {balances,history,pointsPerDollar:1,pointsPerCreditDollar:100,cashOutEnabled:false,transferEnabled:false};
}
export async function convertPoints(pool:Pool,userId:string,mode:'live'|'sandbox',requestId:string,points:number){
 await pool.query('SELECT ch_web.convert_reward_points($1,$2,$3,$4)',[userId,mode,requestId,points]);return collectorRewards(pool,userId,mode);
}
