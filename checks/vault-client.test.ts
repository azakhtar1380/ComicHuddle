import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyVault,type Vault} from '../lib/vault';
import {mergeVaultChange,readVault,readVaultVersion,saveVaultChange,VaultConflictError,vaultVersionHeader,type VaultSnapshot} from '../lib/vault-client';

const book=(id:string,grade='Raw VF')=>({id,title:'Planet Comics',issue:'#12',grade,price:0,catalogId:18});
const base=():Vault=>emptyVault('QA Collector');
const snapshot=(data:Vault,version='"qa-revision-1"'):VaultSnapshot=>({data,version});
function backend(initial=base(),options:{conflictOnce?:boolean;failOnce?:boolean;stripSaveVersion?:boolean;conflictAlways?:boolean}={}){
 let data=initial,version='"qa-revision-1"',posts=0;
 const calls:{method:string;body?:Vault;headers:Headers}[]=[];
 const fetcher:typeof fetch=async(_url,init)=>{
  const method=init?.method||'GET',headers=new Headers(init?.headers);
  assert.equal(init?.cache,'no-store');assert.equal(init?.credentials,'same-origin');
  if(method==='GET'){calls.push({method,headers});return new Response(JSON.stringify(data),{headers:{ETag:'W/'+version,[vaultVersionHeader]:version}});}
  posts++;const body=JSON.parse(String(init?.body)) as Vault;calls.push({method,body,headers});
  if(options.failOnce&&posts===1)return Response.json({error:'Controlled temporary failure'},{status:503});
  if(options.conflictAlways||options.conflictOnce&&posts===1){
   data={...data,books:[...data.books,book('other-tab-'+posts)]};version='"qa-revision-'+(posts+1)+'"';
   return Response.json({error:'Stale revision'},{status:409});
  }
  if(headers.get(vaultVersionHeader)!==version||headers.get('if-match')!==version)return Response.json({error:'Stale revision'},{status:409});
  data=body;version='"saved-'+posts+'"';
  return Response.json({saved:true},{headers:options.stripSaveVersion?{}:{ETag:'W/'+version,[vaultVersionHeader]:version}});
 };
 return {fetcher,calls,current:()=>({data,version})};
}
test('compressed weak ETags become the exact application revision; unsafe validators are rejected',()=>{
 assert.equal(readVaultVersion(new Headers({ETag:'W/"empty"'})),'"empty"');
 assert.equal(readVaultVersion(new Headers({ETag:'W/"stale"',[vaultVersionHeader]:'"current"'})),'"current"');
 for(const value of ['*','"one", "two"','unquoted','W/*'])assert.equal(readVaultVersion(new Headers({ETag:value})),null);
});
test('initial read uses an uncached private request and accepts a weak proxy ETag',async()=>{
 const f=backend();const loaded=await readVault('QA Collector',f.fetcher);assert.equal(loaded.version,'"qa-revision-1"');assert.deepEqual(loaded.data,base());
});
test('a stale version automatically reconnects and retains both tabs additions',async()=>{
 const f=backend(base(),{conflictOnce:true}),before=base(),next={...before,books:[book('my-copy')]};
 const saved=await saveVaultChange(before,next,snapshot(before),'QA Collector',f.fetcher);
 assert.deepEqual(saved.data.books.map(item=>item.id),['other-tab-1','my-copy']);
 assert.deepEqual(f.calls.map(call=>call.method),['POST','GET','POST']);
});
test('saving before initial load completes preserves an existing remote collection',async()=>{
 const remote={...base(),profile:'Existing profile',books:[book('existing')]},f=backend(remote);
 const saved=await saveVaultChange(base(),{...base(),books:[book('new')]},null,'QA Collector',f.fetcher);
 assert.equal(saved.data.profile,'Existing profile');assert.equal(saved.data.books.length,2);
});
test('a stale React render cannot erase a copy from the preceding successful save',async()=>{
 const f=backend(),before=base();const first=await saveVaultChange(before,{...before,books:[book('first')]},snapshot(before),'QA Collector',f.fetcher);
 const second=await saveVaultChange(before,{...before,books:[book('second')]},first,'QA Collector',f.fetcher);
 assert.deepEqual(second.data.books.map(item=>item.id),['first','second']);
});
test('conflicting changes to the same copy preserve remote state and require review',()=>{
 const before={...base(),books:[book('shared')]},next={...before,books:[book('shared','Raw Fine')]},latest=snapshot({...before,books:[book('shared','CGC 9.8')]});
 assert.throws(()=>mergeVaultChange(before,next,latest),error=>error instanceof VaultConflictError&&error.latest===latest);
 assert.equal(latest.data.books[0].grade,'CGC 9.8');
});
test('removing a concurrently edited copy also requires review',()=>{
 const before={...base(),books:[book('shared')]},latest=snapshot({...before,books:[book('shared','Raw Good')]});
 assert.throws(()=>mergeVaultChange(before,{...before,books:[]},latest),VaultConflictError);
});
test('wants added elsewhere and trade membership survive a nonoverlapping book addition',()=>{
 const before={...base(),books:[book('owned')],wants:[0]},next={...before,books:[...before.books,book('new')],wants:[0,1]},latest=snapshot({...before,wants:[0,2],tradeBookIds:['owned']});
 const merged=mergeVaultChange(before,next,latest);assert.deepEqual(merged.wants,[0,2,1]);assert.deepEqual(merged.tradeBookIds,['owned']);
});
test('retrying an acknowledged copy ID is idempotent and never creates duplicate books',async()=>{
 const before=base(),next={...before,books:[book('stable-id')]},f=backend(next);
 const saved=await saveVaultChange(before,next,snapshot(before),'QA Collector',f.fetcher);assert.equal(saved.data.books.length,1);
});
test('temporary failure does not turn the collection permanently offline',async()=>{
 const f=backend(base(),{failOnce:true}),before=base(),next={...before,books:[book('retry')]};
 await assert.rejects(saveVaultChange(before,next,snapshot(before),'QA Collector',f.fetcher),/temporary failure/);
 const saved=await saveVaultChange(before,next,snapshot(before),'QA Collector',f.fetcher);assert.equal(saved.data.books[0].id,'retry');
});
test('missing save validators trigger an acknowledged-state reload',async()=>{
 const f=backend(base(),{stripSaveVersion:true}),before=base();const saved=await saveVaultChange(before,{...before,books:[book('reload')]},snapshot(before),'QA Collector',f.fetcher);
 assert.equal(saved.version,'"saved-1"');assert.deepEqual(f.calls.map(call=>call.method),['POST','GET']);
});
test('repeated concurrent writes stop after three attempts with the latest collection available',async()=>{
 const f=backend(base(),{conflictAlways:true}),before=base();
 await assert.rejects(saveVaultChange(before,{...before,books:[book('mine')]},snapshot(before),'QA Collector',f.fetcher),error=>error instanceof VaultConflictError&&error.latest.data.books.length===3);
 assert.equal(f.calls.filter(call=>call.method==='POST').length,3);assert.ok(!f.current().data.books.some(item=>item.id==='mine'));
});
