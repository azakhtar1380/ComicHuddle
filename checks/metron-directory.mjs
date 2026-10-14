// Run: node --experimental-vm-modules checks/metron-directory.mjs
// Actual route/helper/controller code, isolated SQLite and synthetic identities,
// tokens and schema-compatible metadata fixtures. No live Metron account/API call.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';

const root=process.cwd(),require=createRequire(path.join(root,'package.json')),sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir('drizzle')).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(await readFile(path.join('drizzle',file),'utf8'));
const token='SYNTHETIC-METRON-TOKEN-0000000000000001',otherToken='SYNTHETIC-METRON-TOKEN-0000000000000002';
const statements=[];
class Statement{
 constructor(sql,params=[]){this.sql=sql;this.params=params}
 bind(...params){return new Statement(this.sql,params)}
 prepare(){statements.push({sql:this.sql,params:this.params});assert.ok(this.params.length<=100);assert.ok(!JSON.stringify(this.params).includes(token));return sqlite.prepare(this.sql)}
 async raw(){const statement=this.prepare();statement.setReturnArrays(true);return statement.all(...this.params)}
 allSync(){return {results:this.prepare().all(...this.params),success:true,meta:{}}}
 async all(){return this.allSync()}
 async run(){const result=this.prepare().run(...this.params);return {results:[],success:true,meta:{changes:result.changes}}}
}
const database={prepare:sql=>new Statement(sql),async batch(list){sqlite.exec('BEGIN');try{const result=list.map(row=>row.allSync());sqlite.exec('COMMIT');return result}catch(error){sqlite.exec('ROLLBACK');throw error}}};
const clock={now:Date.parse('2026-10-09T12:00:00.000Z')};
class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock.now]))}static now(){return clock.now}}
const responseJson=(body,status=200,headers={})=>Response.json(body,{status,headers});
const issue={id:50,series:{id:15,name:'Fixture Saga',volume:1,year_began:2018},number:'1',issue:'Fixture Saga (2018) #1',cover_date:'2018-11-01',store_date:'2018-09-05',image:'https://static.metron.cloud/private-cover.jpg',cover_hash:'FIXTURE-HASH',modified:'2026-09-01T01:00:00Z'};
const detail={...issue,publisher:{id:7,name:'Fixture Publisher'},credits:[{creator:{id:9,name:'Fixture Writer'},role:[{id:1,name:'Writer'}]}],desc:'<p>SYNTHETIC synopsis is deliberately omitted.</p>',price:'3.99',price_currency:'USD',resource_url:'https://untrusted.example/steal',api_token:token};
const page=(rows=[issue],next=null,count=rows.length)=>({count,next,previous:null,results:rows});
let activeUser=null,upstream=null,fastTimeout=false;
const requests=[];
async function fakeFetch(url,options={}){
 const parsed=new URL(url);assert.equal(parsed.origin,'https://metron.cloud','External network forbidden');
 assert.match(parsed.pathname,/^\/api\/issue\/(?:[0-9]+\/)?$/);assert.ok(!parsed.href.includes(token));
 const headers=new Headers(options.headers);assert.equal(headers.get('Authorization'),'Bearer '+token);assert.equal(headers.get('Accept'),'application/json');
 assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');assert.equal(options.method,'GET');assert.equal(headers.get('Cookie'),null);
 assert.equal([...headers.keys()].length,2);assert.ok(options.signal instanceof AbortSignal);
 requests.push({url:parsed.href,headers,options});
 return upstream?upstream(parsed,options):responseJson(parsed.pathname.endsWith('/50/')?detail:page());
}
const context=vm.createContext({console,crypto:webcrypto,fetch:fakeFetch,Request,Response,URL,Headers,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,AbortController,AbortSignal,Date:ClockDate,
 setTimeout:(run,ms)=>setTimeout(run,fastTimeout&&ms===10000?0:ms),clearTimeout});
const cache=new Map();
function synthetic(id,exports){return new vm.SyntheticModule(Object.keys(exports),function(){for(const key of Object.keys(exports))this.setExport(key,exports[key])},{context,identifier:id})}
async function moduleFor(spec,parent=''){
 if(spec==='cloudflare:workers'){if(!cache.has(spec))cache.set(spec,synthetic(spec,{env:{DB:database}}));return cache.get(spec)}
 if(!spec.startsWith('.')&&!spec.startsWith('/')){if(!cache.has(spec))cache.set(spec,synthetic(spec,await import(require.resolve(spec))));return cache.get(spec)}
 let file=path.resolve(parent?path.dirname(parent):root,spec);if(!path.extname(file)){try{await readFile(file+'.ts');file+='.ts'}catch{file=path.join(file,'index.ts')}}
 if(cache.has(file))return cache.get(file);
 if(file.endsWith('/app/chatgpt-auth.ts')){const result=synthetic(file,{getChatGPTUser:async()=>activeUser});cache.set(file,result);return result}
 const code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 const result=new vm.SourceTextModule(code,{context,identifier:file});cache.set(file,result);return result;
}
async function load(file){const result=await moduleFor(path.join(root,file));if(result.status==='unlinked')await result.link((specifier,parent)=>moduleFor(specifier,parent.identifier));if(result.status==='linked')await result.evaluate();return result.namespace}
const route=await load('app/api/metron/route.ts'),api=await load('lib/metron-directory.ts'),community=await load('lib/community.ts');
const alice={userId:'metron-alice',email:'alice@example.test'},bob={userId:'metron-bob',email:'bob@example.test'},noProfile={userId:'metron-none',email:'none@example.test'};
function profile(user,change={}){
 const values={id:crypto.randomUUID(),user_id:user.userId,handle:user.userId,name:user.userId,bio:'Fixture',tagline:'Fixture',location:'USA',favorite:'Fixture',since:2020,color:'red',featured:'[]',visible:1,dm_open:1,created_at:new Date(clock.now).toISOString(),rules_version:community.previewRulesVersion,rules_accepted_at:new Date(clock.now).toISOString(),...change};
 const keys=Object.keys(values);sqlite.prepare(`INSERT INTO profiles (${keys.map(key=>JSON.stringify(key)).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>values[key]));return values.id;
}
profile(alice);profile(bob);
const searchBody=(change={})=>({action:'search',token,ownsToken:true,query:'Fixture Saga #1',...change});
const nextUrl='https://metron.cloud/api/issue/?series_name=Fixture+Saga&number=1&page=2';
async function call(user=alice,body=searchBody(),options={}){
 activeUser=user;
 const headers={'Origin':'https://comichuddle.test','Content-Type':'application/json',...options.headers};
 const req=new Request(options.url||'https://comichuddle.test/api/metron',{method:'POST',headers,body:options.raw??JSON.stringify(body),...(options.signal?{signal:options.signal}:{}),...(options.duplex?{duplex:'half'}:{})});
 const response=await route.POST(req),data=await response.json();
 assert.ok(!JSON.stringify(data).includes(token),'Response leaked caller token');
 assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 return {status:response.status,data,headers:response.headers};
}
const plain=value=>JSON.parse(JSON.stringify(value)),clone=value=>structuredClone(value);
const failures=[];let passed=0;
async function test(name,run){sqlite.prepare('DELETE FROM write_limits').run();upstream=null;fastTimeout=false;requests.length=0;try{await run();passed++;console.log('PASS: '+name)}catch(error){failures.push({name,error:error.message});console.error('FAIL: '+name+' — '+error.message)}finally{upstream=null;fastTimeout=false}}
const rejected=(run,code)=>assert.rejects(run,error=>error.code===code);

await test('Real authenticated route uses only caller Bearer token and returns a private metadata response',async()=>{
 const result=await call();assert.equal(result.status,200);assert.equal(requests.length,1);
 assert.equal(result.data.providerVerified,true);assert.equal(result.data.items[0].id,50);
 assert.equal(result.data.items[0].title,'Fixture Saga (2018)');assert.equal(result.headers.get('Pragma'),'no-cache');
 assert.equal(new URL(requests[0].url).searchParams.get('series_name'),'Fixture Saga');
 assert.equal(new URL(requests[0].url).searchParams.get('number'),'1');
});
await test('Guests cannot submit tokens or trigger a provider request or persisted budget',async()=>{
 assert.equal((await call(null)).status,401);assert.equal(requests.length,0);assert.equal(sqlite.prepare('SELECT count(*) n FROM write_limits').get().n,0);
});
await test('Missing and foreign origins are rejected before provider access',async()=>{
 for(const origin of ['', 'null','https://other.example','http://comichuddle.test'])assert.equal((await call(alice,searchBody(),{headers:{Origin:origin}})).status,403);
 assert.equal(requests.length,0);
});
await test('Credential-bearing request URLs are rejected and never echoed',async()=>{
 const result=await call(alice,searchBody(),{url:'https://comichuddle.test/api/metron?token='+token});assert.equal(result.status,400);assert.equal(requests.length,0);
});
await test('GET has no credential pathway and explicitly allows only POST',async()=>{
 const result=await route.GET();assert.equal(result.status,405);assert.equal(result.headers.get('Allow'),'POST');assert.equal(requests.length,0);
});
await test('Non-JSON content types cannot invoke the proxy',async()=>{
 for(const type of ['text/plain','application/x-www-form-urlencoded',''])assert.equal((await call(alice,searchBody(),{headers:{'Content-Type':type}})).status,415);
 assert.equal(requests.length,0);
});
await test('Malformed JSON, arrays and non-object bodies return bounded validation errors',async()=>{
 for(const raw of ['{bad JSON}',JSON.stringify([token]),JSON.stringify(token),'null'])assert.equal((await call(alice,null,{raw})).status,400);
 assert.equal(requests.length,0);
});
await test('Declared and streamed request bodies over8192 bytes are rejected',async()=>{
 assert.equal((await call(alice,searchBody(),{headers:{'Content-Length':'8193'}})).status,413);
 assert.equal((await call(alice,null,{raw:JSON.stringify({...searchBody(),padding:'x'.repeat(8200)})})).status,413);assert.equal(requests.length,0);
});
await test('A collector profile is required before token parsing or provider access',async()=>{
 assert.equal((await call(noProfile)).status,403);assert.equal(requests.length,0);assert.equal(sqlite.prepare('SELECT count(*) n FROM write_limits').get().n,0);
});
await test('Moderated, deletion-pending and restricted accounts cannot connect',async()=>{
 for(const change of [{moderated:1},{deletion_started_at:'2026-10-09T12:00:00Z'}]){
  const user={userId:'blocked-'+crypto.randomUUID(),email:'fixture@example.test'};profile(user,change);assert.equal((await call(user)).status,403);
 }
 const restricted={userId:'restricted-'+crypto.randomUUID(),email:'fixture@example.test'};profile(restricted);
 sqlite.prepare('INSERT INTO account_restrictions(user_id,scope,created_at) VALUES(?,?,?)').run(restricted.userId,'account',new Date(clock.now).toISOString());
 assert.equal((await call(restricted)).status,403);assert.equal(requests.length,0);
});
await test('Current rule version and rule acceptance are both required',async()=>{
 for(const change of [{rules_version:'old'},{rules_accepted_at:''}]){const user={userId:'rules-'+crypto.randomUUID(),email:'fixture@example.test'};profile(user,change);assert.equal((await call(user)).status,403)}
 assert.equal(requests.length,0);
});
await test('Private collector profiles can use their own directory without a public showcase',async()=>{
 const user={userId:'private-'+crypto.randomUUID(),email:'fixture@example.test'};profile(user,{visible:0});assert.equal((await call(user)).status,200);
});
await test('Request parser rejects extra endpoints, passwords, cover flags or arbitrary fields',async()=>{
 for(const change of [{url:'https://evil.example'}, {username:'user',password:'pass'}, {image:true},{action:'sync'},{next:false}])await rejected(async()=>api.parseMetronRequest(searchBody(change)),'metron_invalid_request');
 assert.equal((await call(alice,searchBody({url:'https://evil.example'}))).status,400);assert.equal(requests.length,0);
});
await test('Token shape, size and own-account attestation fail closed',async()=>{
 for(const value of ['', 'short', 'Bearer '+token, token+'\r\nX-Leak:1','x'.repeat(257),null,123])assert.equal(api.isMetronToken(value),false);
 for(const value of [false,undefined,'true'])await rejected(async()=>api.parseMetronRequest(searchBody({ownsToken:value})),'metron_invalid_request');
 assert.equal((await call(alice,searchBody({token:'short'}))).status,400);assert.equal(requests.length,0);
});
await test('Search grammar accepts series words and optional exact issue number, within160 characters',async()=>{
 assert.deepEqual(plain(api.parseMetronSearch('Amazing Spider-Man#300')),{seriesName:'Amazing Spider-Man',number:'300'});
 assert.deepEqual(plain(api.parseMetronSearch('Batman')),{seriesName:'Batman',number:null});
 assert.deepEqual(plain(api.parseMetronSearch('Series #1/2')),{seriesName:'Series',number:'1/2'});
 api.parseMetronSearch('A'.repeat(160));
 for(const query of ['', 'A','#1','Series #','Series #1 #2','A'.repeat(161),'Series\nName','<script>Title</script>'])await rejected(async()=>api.parseMetronSearch(query),'metron_invalid_request');
});
await test('Search encoding cannot turn series text into extra API parameters or place a token in a URL',async()=>{
 const result=await call(alice,searchBody({query:'Series & publisher=Other #1'}));assert.equal(result.status,200);
 const url=new URL(requests[0].url);assert.equal(url.searchParams.get('series_name'),'Series & publisher=Other');assert.equal(url.searchParams.has('publisher'),false);
 await rejected(async()=>api.parseMetronRequest(searchBody({query:token})),'metron_invalid_request');
});
await test('Detail accepts only positive bounded Metron IDs and fetches the fixed issue endpoint',async()=>{
 for(const id of [0,-1,1.5,'50',2147483648,NaN,Infinity])await rejected(async()=>api.parseMetronRequest({action:'detail',token,ownsToken:true,id}),'metron_invalid_request');
 const result=await call(alice,{action:'detail',token,ownsToken:true,id:50});assert.equal(result.status,200);assert.equal(requests[0].url,'https://metron.cloud/api/issue/50/');
});
await test('Valid next-page URLs preserve search terms and are fetched one page at a time',async()=>{
 upstream=()=>responseJson(page([issue],nextUrl,150));const first=await call();assert.equal(first.status,200);assert.equal(first.data.next,nextUrl);assert.equal(requests.length,1);
 upstream=()=>responseJson(page([{...issue,id:51}],null,150));const second=await call(alice,searchBody({next:first.data.next}));assert.equal(second.status,200);assert.equal(requests.length,2);assert.equal(second.data.items[0].id,51);
});
await test('Pagination rejects foreign hosts, paths, credentials, ports, fragments and unknown parameters',async()=>{
 const search=api.parseMetronSearch('Fixture Saga #1');
 const bad=[nextUrl.replace('metron.cloud','evil.example'),nextUrl.replace('/api/issue/','/api/collection/'),nextUrl.replace('https://','http://'),nextUrl.replace('metron.cloud','user:pass@metron.cloud'),nextUrl.replace('metron.cloud','metron.cloud:443'),nextUrl.replace('metron.cloud','metron.cloud:8443'),nextUrl+'#fragment',nextUrl+'&api_key='+token,nextUrl+'&page=3','/api/issue/?page=2',nextUrl.replace('page=2','page=1001')];
 for(const next of bad)assert.equal(api.safeMetronNext(next,search),null);
 assert.equal((await call(alice,searchBody({next:bad[0]}))).status,400);assert.equal(requests.length,0);
});
await test('Pagination rejects query changes and malformed page numbers',async()=>{
 const search=api.parseMetronSearch('Fixture Saga #1');
 for(const next of [nextUrl.replace('Fixture+Saga','Other'),nextUrl.replace('number=1','number=2'),nextUrl.replace('&number=1',''),nextUrl.replace('page=2','page=0'),nextUrl.replace('page=2','page=-1'),nextUrl.replace('page=2','page=2.5')])assert.equal(api.safeMetronNext(next,search),null);
});
await test('Unsafe upstream pagination is suppressed without making a second request',async()=>{
 upstream=()=>responseJson(page([issue],'https://evil.example/?credential='+token,150));const result=await call();assert.equal(result.status,200);assert.equal(result.data.next,null);assert.equal(result.data.paginationUnavailable,true);assert.equal(requests.length,1);
});
await test('Detail DTO keeps plain publisher, year, issue and creator metadata while dropping artwork and values',async()=>{
 const result=await call(alice,{action:'detail',token,ownsToken:true,id:50}),item=result.data.items[0];assert.equal(result.status,200);
 assert.equal(item.publisher,'Fixture Publisher');assert.equal(item.seriesYear,2018);assert.equal(item.number,'1');
 assert.deepEqual(item.credits,[{creator:'Fixture Writer',roles:['Writer']}]);assert.equal(item.sourceUrl,'https://metron.cloud/issue/50/');
 assert.equal(item.license,'CC BY-SA 4.0');assert.equal(item.artworkIncluded,false);assert.equal(item.valuationAvailable,false);
 for(const field of ['image','desc','price','price_currency','api_token','fmv','catalogId','cover_hash'])assert.equal(field in item,false);
});
await test('Sanitization strips markup and controls, bounds fields and ignores untrusted source URLs',async()=>{
 const safe=api.sanitizeMetronIssue({...detail,series:{...issue.series,name:'<b>Fixture &amp; Saga</b>\u0000'},credits:[{creator:{name:'<i>Writer</i>'},role:[{name:'Writer'},{name:'Writer'}]}]});
 assert.equal(safe.series,'Fixture & Saga');assert.equal(safe.credits[0].creator,'Writer');assert.deepEqual(plain(safe.credits[0].roles),['Writer']);assert.equal(safe.sourceUrl,'https://metron.cloud/issue/50/');
 assert.equal(api.sanitizeMetronIssue({...issue,series:{...issue.series,name:'x'.repeat(200)}}).series.length,120);
});
await test('Missing or malformed optional metadata remains unavailable rather than being invented',async()=>{
 const safe=api.sanitizeMetronIssue({...issue,cover_date:'2018-02-30',series:{name:'Fixture Saga',year_began:'2018',volume:-1}});
 assert.equal(safe.publisher,null);assert.equal(safe.coverDate,null);assert.equal(safe.seriesYear,null);assert.equal(safe.volume,null);assert.equal(safe.credits.length,0);
 for(const raw of [null,{}, {...issue,id:0},{...issue,number:null},{...issue,series:null}])assert.equal(api.sanitizeMetronIssue(raw),null);
});
await test('Reflected tokens in metadata fields are not returned to the caller',async()=>{
 upstream=()=>responseJson(page([{...issue,series:{...issue.series,name:token}}]));const result=await call();assert.equal(result.status,200);assert.equal(result.data.items.length,0);
 const safe=api.sanitizeMetronIssue({...detail,publisher:{name:token},credits:[{creator:{name:token},role:[]}]},token);assert.equal(safe.publisher,null);assert.equal(safe.credits.length,0);
});
await test('Personal entries retain exact issue and source license with no local catalogue ID or inferred FMV',async()=>{
 const entry=api.metronPersonalEntry(api.sanitizeMetronIssue(detail));assert.equal(entry.issue,'#1');assert.equal(entry.title,'Fixture Saga (2018)');assert.equal(entry.price,0);assert.equal(entry.grade,'Condition not recorded');assert.equal('catalogId' in entry,false);
 assert.deepEqual(plain(entry.externalCatalog),{provider:'Metron',id:50,sourceUrl:'https://metron.cloud/issue/50/',license:'CC BY-SA 4.0'});
});
await test('Provider401 and403 fail safely without echoing upstream errors or token content',async()=>{
 for(const status of [401,403]){upstream=()=>responseJson({detail:'PRIVATE ERROR '+token},status);const result=await call();assert.equal(result.status,424);assert.equal(result.data.code,'metron_token_rejected');assert.equal(requests.length,status===401?1:2)}
});
await test('Provider429 honors bounded Retry-After and rejects secret-bearing or impossible header values',async()=>{
 upstream=()=>responseJson({detail:token},429,{'Retry-After':'45'});let result=await call();assert.equal(result.status,429);assert.equal(result.headers.get('Retry-After'),'45');
 for(const value of [token,'9000000','-1','tomorrow']){upstream=()=>responseJson({detail:token},429,{'Retry-After':value});result=await call();assert.equal(result.headers.get('Retry-After'),'60')}
});
await test('Provider404,5xx and redirects never trigger automatic retries or credential redirects',async()=>{
 for(const status of [404,500,503,301,302,307,308]){sqlite.prepare('DELETE FROM write_limits').run();upstream=()=>new Response(token,{status,headers:{Location:'https://evil.example/'+token}});const before=requests.length,result=await call();assert.equal(result.status,status===404?404:503);assert.equal(requests.length,before+1)}
});
await test('Provider HTML, malformed JSON and malformed response envelopes are rejected',async()=>{
 const replies=[new Response('<html>'+token+'</html>',{headers:{'Content-Type':'text/html'}}),new Response('{'+token,{headers:{'Content-Type':'application/json'}}),responseJson({results:[]}),responseJson(page([issue],null,'1')),responseJson(page([issue],null,0))];
 for(const reply of replies){upstream=()=>reply;assert.equal((await call()).status,502)}
});
await test('Declared or streamed upstream responses beyond512KiB are rejected',async()=>{
 upstream=()=>responseJson(page(),200,{'Content-Length':'524289'});assert.equal((await call()).status,502);
 upstream=()=>responseJson({count:0,next:null,results:[],padding:'x'.repeat(524289)});assert.equal((await call()).status,502);
});
await test('Over100 rows, repeated Metron IDs or a mismatched detail ID are rejected',async()=>{
 for(const body of [page(Array.from({length:101},(_,n)=>({...issue,id:n+1}))),page([issue,clone(issue)])]){upstream=()=>responseJson(body);assert.equal((await call()).status,502)}
 upstream=()=>responseJson({...detail,id:51});assert.equal((await call(alice,{action:'detail',token,ownsToken:true,id:50})).status,502);
});
await test('Timeout aborts stalled response reading and cancels its body without logging provider errors',async()=>{
 fastTimeout=true;let cancelled=false;
 upstream=()=>new Response(new ReadableStream({start(){},cancel(){cancelled=true}}),{headers:{'Content-Type':'application/json'}});
 const result=await call();assert.equal(result.status,504);assert.equal(result.data.code,'metron_timeout');assert.equal(cancelled,true);assert.equal(requests.length,1);
});
await test('Network errors are sanitized and caller cancellation aborts the fixed-origin request',async()=>{
 upstream=()=>{throw new Error('PRIVATE NETWORK ERROR '+token)};assert.equal((await call()).status,503);
 const controller=new AbortController();controller.abort();let observed=false;
 upstream=(_url,options)=>{observed=options.signal.aborted;throw new Error(token)};
 assert.equal((await call(alice,searchBody(),{signal:controller.signal})).status,503);assert.equal(observed,true);
});
await test('Provider rate headers are parsed numerically and give a pause when remaining reaches zero',async()=>{
 const reset=Math.floor(clock.now/1000)+60;
 const usage=api.metronUsage(new Headers({'X-RateLimit-Burst-Remaining':'0','X-RateLimit-Sustained-Remaining':'100','X-RateLimit-Burst-Reset':String(reset)}),clock.now);
 assert.deepEqual(plain(usage),{burstRemaining:0,dailyRemaining:100,retryAfterSeconds:60});
 const bad=api.metronUsage(new Headers({'X-RateLimit-Burst-Remaining':token,'X-RateLimit-Sustained-Remaining':'-1','Retry-After':token}),clock.now);assert.deepEqual(plain(bad),{burstRemaining:null,dailyRemaining:null,retryAfterSeconds:null});
});
await test('Persistent app budget allows eight/minute, rejects the ninth, and remains user specific',async()=>{
 for(let n=0;n<8;n++)assert.equal((await call()).status,200);
 const limited=await call();assert.equal(limited.status,429);assert.equal(limited.data.code,'metron_app_limit');assert.equal(requests.length,8);
 assert.equal((await call(bob)).status,200);assert.equal(requests.length,9);
});
await test('Concurrent app requests cannot overrun the atomic eight-request minute budget',async()=>{
 const results=await Promise.all(Array.from({length:9},()=>call()));assert.equal(results.filter(row=>row.status===200).length,8);assert.equal(results.filter(row=>row.status===429).length,1);assert.equal(requests.length,8);
});
await test('The shared1200/day app ceiling remains below provider allowance and budgets expire',async()=>{
 const start=Math.floor(clock.now/86400000)*86400000;
 sqlite.prepare('INSERT INTO write_limits(id,user_id,window_start,requests,expires_at) VALUES(?,?,?,?,?)').run(JSON.stringify([alice.userId,'all-day']),alice.userId,start,1200,start+86400000);
 assert.equal((await call()).status,429);assert.equal(requests.length,0);assert.equal((await call(bob)).status,200);
 sqlite.prepare('DELETE FROM write_limits').run();for(let n=0;n<8;n++)assert.equal((await call()).status,200);assert.equal((await call()).status,429);
 const previous=clock.now;clock.now+=60001;assert.equal((await call()).status,200);clock.now=previous;
});
await test('Persisted profile and budget state never contains raw tokens or provider metadata',async()=>{
 await call();for(const table of ['profiles','write_limits','account_restrictions']){const json=JSON.stringify(sqlite.prepare('SELECT * FROM '+table).all());assert.ok(!json.includes(token));assert.ok(!json.includes('Fixture Saga'))}
 assert.ok(statements.every(row=>!JSON.stringify(row).includes(token)));
});
await test('Client controller cannot hold a token while signed out and suppresses overlapping actions',async()=>{
 const session=api.createMetronSession(false);assert.equal(session.connect(token),false);assert.equal(session.begin(),null);session.setSignedIn(true);assert.equal(session.connect(token),true);
 const first=session.begin();assert.ok(first);assert.equal(session.begin(),null);first.finish();assert.ok(session.begin());session.disconnect();assert.equal(session.hasToken(),false);
});
await test('Actual client helper uses one same-origin POST with ephemeral token body and no URL credential',async()=>{
 const session=api.createMetronSession(true);session.connect(token);let calls=0;
 const result=await api.requestMetronClient(session,{action:'search',query:'Fixture Saga #1'},async(url,options)=>{calls++;assert.equal(url,'/api/metron');assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin');assert.equal(new Headers(options.headers).get('Authorization'),null);assert.equal(JSON.parse(options.body).token,token);return responseJson({action:'search',items:[api.sanitizeMetronIssue(issue)],count:1,next:null,paginationUnavailable:false,providerVerified:true,usage:{burstRemaining:19,dailyRemaining:4999,retryAfterSeconds:null}})});
 assert.equal(calls,1);assert.equal(result.kind,'success');session.disconnect();assert.equal((await api.requestMetronClient(session,{action:'detail',id:50},async()=>{throw Error('No fetch permitted')})).kind,'ignored');
});
await test('Disconnect suppresses an in-flight successful provider result and aborts its signal',async()=>{
 const session=api.createMetronSession(true);session.connect(token);let resolve,signal;
 const pending=api.requestMetronClient(session,{action:'search',query:'Fixture Saga'},async(_url,options)=>{signal=options.signal;return new Promise(done=>resolve=done)});
 session.disconnect();assert.equal(signal.aborted,true);resolve(responseJson({providerVerified:true,items:[]}));assert.equal((await pending).kind,'ignored');assert.equal(session.hasToken(),false);
});
await test('Signout and unmount suppress late errors and require a new token on remount',async()=>{
 for(const clear of [session=>session.setSignedIn(false),session=>session.dispose()]){
  const session=api.createMetronSession(true);session.connect(token);let reject;
  const pending=api.requestMetronClient(session,{action:'search',query:'Fixture Saga'},()=>new Promise((_done,fail)=>reject=fail));clear(session);reject(Error('PRIVATE '+token));assert.equal((await pending).kind,'ignored');assert.equal(session.hasToken(),false);session.mount(true);assert.equal(session.hasToken(),false);
 }
});
await test('Replacing a token prevents stale completion from affecting the new connection',async()=>{
 const session=api.createMetronSession(true);session.connect(token);let resolve;
 const pending=api.requestMetronClient(session,{action:'detail',id:50},()=>new Promise(done=>resolve=done));session.connect(otherToken);
 const current=await api.requestMetronClient(session,{action:'detail',id:50},async(_url,options)=>{assert.equal(JSON.parse(options.body).token,otherToken);return responseJson({action:'detail',providerVerified:true,items:[api.sanitizeMetronIssue(detail)],count:1,next:null,paginationUnavailable:false,usage:{burstRemaining:19,dailyRemaining:4999,retryAfterSeconds:null}})});
 assert.equal(current.kind,'success');resolve(responseJson({providerVerified:true,items:[]}));assert.equal((await pending).kind,'ignored');
});
await test('Client never displays reflected upstream errors or accepts a response containing its token',async()=>{
 const session=api.createMetronSession(true);session.connect(token);
 await assert.rejects(()=>api.requestMetronClient(session,{action:'detail',id:50},async()=>responseJson({code:'metron_token_rejected',error:'PRIVATE '+token},424)),error=>error.code==='metron_token_rejected'&&!error.message.includes(token));
 await rejected(()=>api.requestMetronClient(session,{action:'detail',id:50},async()=>responseJson({providerVerified:true,items:[],leak:token})),'metron_bad_response');
 for(const body of [{providerVerified:true,items:[]},{action:'detail',providerVerified:true,items:[{...api.sanitizeMetronIssue(detail),sourceUrl:'https://evil.example'}],count:1,next:null,paginationUnavailable:false,usage:{burstRemaining:19,dailyRemaining:4999,retryAfterSeconds:null}}])
  await rejected(()=>api.requestMetronClient(session,{action:'detail',id:50},async()=>responseJson(body)),'metron_bad_response');
});
await test('Actual React markup offers credentials only after sign-in and shows source/license without artwork',async()=>{
 const source=await readFile('app/metron-directory.tsx','utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const module={exports:{}};
 new vm.Script(compiled,{filename:'app/metron-directory.tsx'}).runInContext(vm.createContext({module,exports:module.exports,
  require:specifier=>specifier==='../lib/metron-directory'?api:specifier.endsWith('.css')?{}:require(specifier)}));
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),Component=module.exports.default;
 const guest=renderToStaticMarkup(React.createElement(Component,{signedIn:false,onJoin(){}}));
 assert.match(guest,/Sign in to connect/);assert.doesNotMatch(guest,/type="password"/);assert.doesNotMatch(guest,/<img/);
 const signed=renderToStaticMarkup(React.createElement(Component,{signedIn:true,onJoin(){}}));
 assert.match(signed,/type="password"/);assert.match(signed,/autoComplete="off"/);assert.match(signed,/name="ownToken"/);
 assert.match(signed,/creativecommons\.org\/licenses\/by-sa\/4\.0/);assert.match(signed,/https:\/\/metron\.cloud/);assert.doesNotMatch(signed,/<img/);
 assert.ok(!guest.includes(token)&&!signed.includes(token));
});

console.log(`Metron integration: ${passed} named groups passed; ${failures.length} failed. Synthetic fixtures only; live token/provider validation remains unverified.`);
if(failures.length)process.exitCode=1;
