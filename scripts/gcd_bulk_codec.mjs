// Shared offline codec. Run entrypoints with --experimental-vm-modules.
// Repository dependencies are required; no provider HTTP is performed here.
import {readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const context=vm.createContext({console,crypto:webcrypto,Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Error,Date,AbortController,setTimeout,clearTimeout});
const cache=new Map();
const synthetic=(id,exports)=>new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v)},{context,identifier:id});
async function moduleFor(specifier,parent=''){
 if(specifier==='cloudflare:workers'){if(!cache.has(specifier))cache.set(specifier,synthetic(specifier,{env:{}}));return cache.get(specifier)}
 if(!specifier.startsWith('.')&&!specifier.startsWith('/')){if(!cache.has(specifier))cache.set(specifier,synthetic(specifier,await import(specifier)));return cache.get(specifier)}
 let file=path.resolve(parent?path.dirname(parent):root,specifier);if(!path.extname(file)){try{await readFile(file+'.ts');file+='.ts'}catch{file=path.join(file,'index.ts')}}if(cache.has(file))return cache.get(file);
 const code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 const m=new vm.SourceTextModule(code,{context,identifier:file});cache.set(file,m);return m;
}
const m=await moduleFor('./lib/gcd-bulk-format.ts');await m.link((s,p)=>moduleFor(s,p.identifier));await m.evaluate();
export const format=m.namespace;
export const CSV_COLUMNS=['gcd_id','series_id','title','issue_number','publication_date','original_price_kind','original_cover_price','api_json'];
export const sheetSafe=value=>/^[\s]*[=+\-@]/.test(String(value))?"'"+String(value):String(value);
export const csvRow=values=>values.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')+'\n';
export function csvValues(record){return [record.api_url.match(/\/([1-9]\d*)\/$/)[1],record.series.match(/\/([1-9]\d*)\/$/)[1],sheetSafe(record.series_name),sheetSafe(record.number),sheetSafe(record.publication_date),'ORIGINAL_COVER_PRICE',sheetSafe(record.price),format.canonicalJson(record)]}
export async function* jsonLines(file,maxBytes=180000,onChunk){
 const decoder=new TextDecoder('utf-8',{fatal:true});let pending='',line=0;
 for await(const chunk of createReadStream(file,{highWaterMark:65536})){
  onChunk?.(chunk);pending+=decoder.decode(chunk,{stream:true});let split;
  while((split=pending.indexOf('\n'))!==-1){let text=pending.slice(0,split);pending=pending.slice(split+1);line++;if(text.endsWith('\r'))text=text.slice(0,-1);if(line===1)text=text.replace(/^\uFEFF/,'');if(Buffer.byteLength(text)>maxBytes)throw Error('JSONL record exceeds the bounded size at line '+line);if(!text.trim())continue;let raw;try{raw=JSON.parse(text)}catch{throw Error('Invalid JSONL record at line '+line)}yield {raw,line}}
  if(Buffer.byteLength(pending)>maxBytes)throw Error('JSONL record exceeds the bounded size after line '+line);
 }
 pending+=decoder.decode();if(pending.trim()){line++;if(Buffer.byteLength(pending)>maxBytes)throw Error('Final JSONL record is too large');try{yield {raw:JSON.parse(pending),line}}catch(error){throw Error('Invalid final JSONL record at line '+line)}}
}
export async function* csvRows(file,onChunk){
 const decoder=new TextDecoder('utf-8',{fatal:true});let fields=[],field='',quoted=false,afterQuote=false,rowStarted=false;
 const endField=()=>{fields.push(field);field='';afterQuote=false};
 for await(const chunk of createReadStream(file,{highWaterMark:65536})){
  onChunk?.(chunk);const text=decoder.decode(chunk,{stream:true});
  for(const ch of text){
   if(quoted){if(ch==='"'){quoted=false;afterQuote=true}else field+=ch}
   else if(afterQuote){if(ch==='"'){field+='"';quoted=true;afterQuote=false}else if(ch===',')endField();else if(ch==='\n'){endField();yield fields;fields=[];rowStarted=false}else if(ch!=='\r')throw Error('Invalid CSV character after quoted field')}
   else if(ch==='"'){if(field)throw Error('Invalid CSV quote');quoted=true;rowStarted=true}
   else if(ch===','){endField();rowStarted=true}
   else if(ch==='\n'){endField();yield fields;fields=[];rowStarted=false}
   else if(ch!=='\r'){field+=ch;rowStarted=true}
   if(field.length>400000||fields.length>CSV_COLUMNS.length)throw Error('CSV row exceeds the bounded format');
  }
 }
 if(decoder.decode())throw Error('Unexpected CSV decoder tail');if(quoted)throw Error('Unclosed CSV quote');if(rowStarted||field||fields.length){endField();yield fields}
}
export async function* csvRecords(file,manifest,onChunk){
 let first=true,last=0;
 for await(const cells of csvRows(file,onChunk)){
  if(first){first=false;if(JSON.stringify(cells)!==JSON.stringify(CSV_COLUMNS))throw Error('CSV header does not match gcd-bulk/v1');continue}
  if(cells.length!==CSV_COLUMNS.length)throw Error('CSV row has an unexpected field count');let raw;try{raw=JSON.parse(cells[7])}catch{throw Error('CSV api_json is invalid')}
  const record=format.sanitizeGcdBulkRecord(raw,manifest.snapshotAt),id=Number(record.api_url.match(/\/([1-9]\d*)\/$/)[1]);
  if(id<=last||JSON.stringify(cells)!==JSON.stringify(csvValues(record)))throw Error('CSV rows must preserve the reviewed payload, labels and ascending unique IDs');last=id;yield record;
 }
 if(first)throw Error('CSV is empty');
}
export async function preflightCsv(file,manifest){
 const hash=createHash('sha256');let count=0,chain=format.GCD_EMPTY_CHAIN;
 for await(const record of csvRecords(file,manifest,chunk=>hash.update(chunk))){count++;chain=await format.appendGcdRecordChain(chain,record);if(count>manifest.expectedRecords)throw Error('CSV exceeds declared count')}
 if(count!==manifest.expectedRecords||chain!==manifest.recordsSha256||hash.digest('hex')!==manifest.exportSha256)throw Error('CSV count, record chain or file checksum does not match its manifest');return {count,chain};
}
export function argsFor(argv){const out={};for(let i=0;i<argv.length;i+=2){if(!/^--[a-z-]+$/.test(argv[i])||argv[i+1]===undefined||argv[i+1].startsWith('--')||out[argv[i].slice(2)]!==undefined)throw Error('Use named argument/value pairs');out[argv[i].slice(2)]=argv[i+1]}return out}
