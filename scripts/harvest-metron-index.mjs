// Harvest Metron's full issue list (id, series, number, dates, cover image URL) into NDJSON.
// Uses the paginated list endpoint (100 issues per request), so the whole catalogue
// (~190k issues) takes ~1,900 requests: well inside Metron's 5,000/day budget.
// Paced under the 20/minute burst limit, honours Retry-After, and resumes where it stopped.
//
//   node scripts/harvest-metron-index.mjs [outDir]        (default: .metron-cache)
//   METRON_API_TOKEN is read from the environment or .env.local. Never printed.
import {readFileSync,existsSync,mkdirSync,appendFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const outDir=process.argv[2]||'.metron-cache';
mkdirSync(outDir,{recursive:true});
const dataFile=join(outDir,'metron-issues.ndjson'),stateFile=join(outDir,'harvest-state.json');
function envToken(){
 if(process.env.METRON_API_TOKEN)return process.env.METRON_API_TOKEN;
 if(existsSync('.env.local'))for(const line of readFileSync('.env.local','utf8').split(/\r?\n/)){const m=/^METRON_API_TOKEN="?([^"]*)"?$/.exec(line);if(m)return m[1]}
 throw new Error('METRON_API_TOKEN is not set.');
}
const token=envToken();
const state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):{nextPage:1,total:null,written:0,startedAt:new Date().toISOString()};
const gapMs=Number(process.env.METRON_HARVEST_GAP_MS||4500); // ~13 requests/minute
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ua='ComicHuddle catalog cover indexer (server-side; contact via metron.cloud account)';

async function page(n){
 for(let attempt=1;;attempt++){
  const res=await fetch('https://metron.cloud/api/issue/?page='+n,{headers:{Authorization:'Bearer '+token,Accept:'application/json','User-Agent':ua},signal:AbortSignal.timeout(60000)}).catch(e=>({ok:false,status:0,error:e}));
  if(res.ok)return {body:await res.json(),remaining:Number(res.headers.get('x-ratelimit-sustained-remaining')),burst:Number(res.headers.get('x-ratelimit-burst-remaining'))};
  if(res.status===404)return null; // past the last page
  if(res.status===401||res.status===403)throw new Error('Metron rejected the token ('+res.status+').');
  const retry=Number(res.headers?.get?.('retry-after'))||Math.min(600,30*attempt);
  console.log(`page ${n}: HTTP ${res.status||'network'}; retrying in ${retry}s`);
  if(attempt>=8)throw new Error('Metron kept failing on page '+n);
  await sleep(retry*1000);
 }
}

for(;;){
 const n=state.nextPage,result=await page(n);
 if(!result){state.completedAt=new Date().toISOString();break}
 const {body}=result;state.total=body.count;
 const lines=body.results.map(i=>JSON.stringify({id:i.id,series:i.series?.name??null,volume:i.series?.volume??null,yearBegan:i.series?.year_began??null,number:i.number??null,issue:i.issue??null,coverDate:i.cover_date??null,storeDate:i.store_date??null,image:i.image||null,coverHash:i.cover_hash||null,modified:i.modified??null}));
 if(lines.length)appendFileSync(dataFile,lines.join('\n')+'\n');
 state.written+=lines.length;state.nextPage=n+1;writeFileSync(stateFile,JSON.stringify(state,null,1));
 if(n%25===0||!body.next)console.log(`page ${n}/${Math.ceil(body.count/100)} · ${state.written} issues · daily budget left ${result.remaining}`);
 if(!body.next){state.completedAt=new Date().toISOString();break}
 if(result.remaining<50){console.log('Daily budget nearly used; stopping. Re-run tomorrow to resume.');break}
 await sleep(result.burst<=2?65000:gapMs);
}
writeFileSync(stateFile,JSON.stringify(state,null,1));
console.log('done:',JSON.stringify({written:state.written,total:state.total,completedAt:state.completedAt||null}));
