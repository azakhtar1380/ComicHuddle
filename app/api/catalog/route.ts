import {catalog} from '../../../lib/catalog';
import {getDb} from '../../../db';
import {catalogSearchDto} from '../../../lib/catalog-search';
import {catalogIssue,catalogOverview,searchSharedCatalog,browseSharedSeries} from '../../../lib/catalog-store';
import {catalogIssues} from '../../../db/schema';
import {inArray} from 'drizzle-orm';
import type {Issue} from '../../../lib/catalog';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
function integer(value:string|null,fallback:number,min:number,max:number){
 if(value===null)return fallback;
 if(!/^\d+$/.test(value))return undefined;
 const number=Number(value);return Number.isSafeInteger(number)&&number>=min&&number<=max?number:undefined;
}
export async function GET(req:Request){
 try{
 const params=req?new URL(req.url).searchParams:new URLSearchParams();
  const allowed=['q','id','ids','limit','offset','publisher','series','era','kind','sort','browse'];
 if([...params.keys()].some(name=>!allowed.includes(name))||allowed.some(name=>params.getAll(name).length>1))return json({error:'Use one supported value for each search parameter.'},400);
 if(params.has('ids')){
  const raw=params.get('ids')||'';if([...params.keys()].length!==1||!/^\d+(,\d+){0,24}$/.test(raw))return json({error:'Use up to 25 exact directory IDs.'},400);
  const ids=[...new Set(raw.split(',').map(Number))];if(ids.some(id=>!Number.isSafeInteger(id)))return json({error:'Use valid directory IDs.'},400);
  const db=getDb(),rows=await db.select({id:catalogIssues.id,data:catalogIssues.data}).from(catalogIssues).where(inArray(catalogIssues.id,ids));
  const byId=new Map(rows.map(row=>[row.id,JSON.parse(row.data) as Issue]));
  return json({...await catalogOverview(db),issues:ids.flatMap(id=>{const issue=byId.get(id)||catalog.find(i=>i.id===id);return issue?[catalogSearchDto(issue)]:[]})});
 }
 if(params.has('id')){
  if(allowed.filter(n=>n!=='id').some(name=>params.has(name)))return json({error:'Use either an exact directory ID or search parameters.'},400);
  const id=integer(params.get('id'),-1,0,Number.MAX_SAFE_INTEGER);
  if(id===undefined)return json({error:'Enter a valid directory ID.'},400);
  const db=getDb(),issue=await catalogIssue(db,id);if(!issue)return json({error:'Directory issue not found.'},404);
  return json({...await catalogOverview(db),issues:[catalogSearchDto(issue,true)],total:1,limit:1,offset:0,hasMore:false});
 }
 // Existing consumers may still request the complete, small starter list.
 if(![...params.keys()].length){const db=getDb(),meta=await catalogOverview(db);if(!meta.syncedIssueCount&&!meta.gcdIssueCount)return json({...meta,issues:catalog});return json(await searchSharedCatalog(db,{q:'',limit:30,offset:0}));}
 const query=(params.get('q')||'').trim(),limit=integer(params.get('limit'),12,1,30),offset=integer(params.get('offset'),0,0,2147483647);
 if(query.length>160||limit===undefined||offset===undefined)return json({error:'Search up to 160 characters with a limit of 1–30 and a valid offset.'},400);
  const publisher=params.get('publisher')||undefined,series=params.get('series')||undefined,era=params.get('era')||undefined,kind=params.get('kind')||undefined,sort=params.get('sort')||'featured';
  if([publisher,series,era,kind].some(value=>value&&value.length>160)||!['featured','title','oldest','newest'].includes(sort))return json({error:'Choose valid directory filters and sort order.'},400);
  if(params.has('browse')){
   if(params.get('browse')!=='series'||!publisher||['series','era','kind','sort'].some(key=>params.has(key)))return json({error:'Choose a publisher to browse its stored series.'},400);
   return json(await browseSharedSeries(getDb(),{publisher,q:query,limit,offset}));
  }
  return json(await searchSharedCatalog(getDb(),{q:query,limit,offset,publisher,series,era,kind,sort}));
 }catch{return json({error:'The saved comic directory could not be loaded. Please retry.'},503)}
}
