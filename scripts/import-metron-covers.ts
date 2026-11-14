// Imports ${METRON_COVER_CDN_BASE}/metron/manifest.ndjson.gz into ch_web.metron_cover_index
// and links rows to catalog issues (exact Metron/GCD links first, then unique
// series + year_began + number matches). Idempotent; safe to re-run.
//
//   node --import tsx scripts/import-metron-covers.ts [--budget-seconds 600] [--rematch]
//
// --rematch retries rows previously recorded as unmatched/ambiguous (after a GCD refresh).
import {getDb} from '../db';
import {importMetronCovers} from '../lib/metron-cover-import';

const args=process.argv.slice(2),flag=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined};
const budgetSeconds=Number(flag('--budget-seconds')||process.env.METRON_COVER_IMPORT_BUDGET_SECONDS||600);
try{
 const result=await importMetronCovers(getDb(),{budgetMs:Math.max(5,budgetSeconds)*1000,rematch:args.includes('--rematch'),log:line=>console.log('Metron covers: '+line)});
 console.log('Metron cover import '+result.status+': '+JSON.stringify(result));
}finally{
 // Close the pool only if one was opened (a disabled run never connects).
 const pool=(globalThis as typeof globalThis&{comicHuddlePool?:{end():Promise<void>}}).comicHuddlePool;
 await pool?.end().catch(()=>undefined);
}
