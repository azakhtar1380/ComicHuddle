import {z} from 'zod';
import {catalog} from './catalog';
import {linkedCatalogIssue} from './catalog-search';
import {sharedProviderIdentity} from './shared-catalog';
import {collectionEntrySchema} from './collection-entry';
const catalogById=new Map(catalog.map(issue=>[issue.id,issue]));
const issueId=z.number().int().min(0).refine(id=>catalogById.has(id),'Select an existing directory issue.');
const wantedIssueId=z.number().int().min(0).refine(id=>catalogById.has(id)||sharedProviderIdentity(id)!==null,'Select an existing directory issue.');
const externalCatalog=z.object({provider:z.enum(['Metron','GCD']),id:z.number().int().min(1).max(2147483647),sourceUrl:z.string().max(120),license:z.literal('CC BY-SA 4.0')}).strict().superRefine((record,ctx)=>{
 const exact=record.provider==='Metron'?'https://metron.cloud/issue/'+record.id+'/':'https://www.comics.org/issue/'+record.id+'/';
 if(record.sourceUrl!==exact)ctx.addIssue({code:z.ZodIssueCode.custom,path:['sourceUrl'],message:'Use the exact provider issue source.'});
});
export const vaultSchema=z.object({
profile:z.string().min(1).max(80),
books:z.array(z.object({id:z.string().trim().min(1).max(80),title:z.string().trim().min(1).max(160),issue:z.string().max(40),grade:z.string().max(80),price:z.number().finite().min(0).max(10000000),catalogId:issueId.optional(),externalCatalog:externalCatalog.optional(),photoId:z.string().uuid().optional(),ownership:collectionEntrySchema.optional()})).max(1000),
wants:z.array(wantedIssueId).max(1000),posts:z.array(z.string().min(1).max(1000)).max(100),likes:z.array(z.number().int()).max(100),
tradeBookIds:z.array(z.string().trim().min(1).max(80)).max(1000).default([]),clubs:z.array(z.string().max(40)).max(30).default([]),
watchlist:z.array(z.object({issueId,mode:z.enum(['Raw','CGC']),grade:z.string().max(10)})).max(1000).default([]),
tradeDrafts:z.array(z.object({id:z.string().max(200),title:z.string().max(300)})).max(100).default([])
}).superRefine((v,ctx)=>{
 const ids=new Set(v.books.map(b=>b.id));
 if(ids.size!==v.books.length)ctx.addIssue({code:z.ZodIssueCode.custom,path:['books'],message:'Each owned copy needs a unique ID.'});
 if(new Set(v.tradeBookIds).size!==v.tradeBookIds.length||v.tradeBookIds.some(id=>!ids.has(id)))ctx.addIssue({code:z.ZodIssueCode.custom,path:['tradeBookIds'],message:'Only unique owned copies belong in your trade pile.'});
 if(new Set(v.wants).size!==v.wants.length)ctx.addIssue({code:z.ZodIssueCode.custom,path:['wants'],message:'Each wanted issue may appear once.'});
 v.books.forEach((book,index)=>{if(book.catalogId!==undefined&&book.externalCatalog)ctx.addIssue({code:z.ZodIssueCode.custom,path:['books',index,'externalCatalog'],message:'Choose one directory identity for this comic.'});});
});
export type Vault=z.infer<typeof vaultSchema>;
// Reads retain existing saved records. Writes validate an explicit directory
// link and store its canonical identity instead of trusting editable labels.
export const vaultSaveSchema=vaultSchema.superRefine((v,ctx)=>{
 v.books.forEach((book,index)=>{
  if(book.catalogId===undefined)return;
  if(!linkedCatalogIssue(book))ctx.addIssue({code:z.ZodIssueCode.custom,path:['books',index,'catalogId'],message:'The selected directory issue must match this comic’s series and issue number.'});
 });
}).transform(v=>({...v,books:v.books.map(book=>{
 const issue=book.catalogId===undefined?undefined:catalogById.get(book.catalogId);
 return issue?{...book,title:issue.title,issue:'#'+issue.number}:book;
})}));
export function emptyVault(name:string):Vault{return {profile:name,books:[],wants:[],posts:[],likes:[],tradeBookIds:[],clubs:[],watchlist:[],tradeDrafts:[]}}
