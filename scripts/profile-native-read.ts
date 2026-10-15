import {getPool} from '../db/postgres';
import {getDb} from '../db';
import {catalogOverview,searchSharedCatalog} from '../lib/catalog-store';
const pool=getPool();
try{
 const client=await pool.connect();
 try{
  const state=(await client.query("SELECT jsonb_array_length(retained_ids) AS extra_ids,metadata->>'issueCount' AS count FROM gcd.comichuddle_catalog_read_state WHERE id='directory'")).rows[0];
  console.log('NATIVE_READ_STATE '+JSON.stringify(state));
  const plans=(await client.query("EXPLAIN(FORMAT JSON) SELECT 4000000000::bigint+id FROM gcd.gcd_issue WHERE COALESCE(deleted,0)=0 ORDER BY id LIMIT 13")).rows[0];
  const nodes:unknown[]=[];
  function visit(node:any){nodes.push({node:node['Node Type'],rows:node['Plan Rows'],cost:node['Total Cost'],relation:node['Relation Name']});for(const child of node.Plans||[])visit(child)}
  visit(plans['QUERY PLAN'][0].Plan);console.log('NATIVE_READ_PLAN '+JSON.stringify(nodes));
 }finally{client.release()}
 const started=Date.now(),db=getDb();const meta=await catalogOverview(db);console.log('NATIVE_OVERVIEW_MS '+(Date.now()-started)+' COUNT '+meta.issueCount);
 const page=await searchSharedCatalog(db,{q:'',limit:12,offset:0});console.log('NATIVE_PAGE_MS '+(Date.now()-started)+' ROWS '+page.issues.length);
}catch(error){let code='unknown',cause:unknown=error;for(let d=0;d<5&&cause;d++){const e=cause as {code?:string;cause?:unknown};if(e.code)code=e.code;cause=e.cause}console.log('NATIVE_READ_ERROR '+code)}finally{await pool.end()}
