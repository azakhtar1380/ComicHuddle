// node --experimental-vm-modules scripts/gcd_bulk_convert.mjs --input issues.jsonl
// --output issues.csv --manifest issues.manifest.json --snapshot-at <source UTC time>
// --source-url https://www.comics.org/download/ --license-acknowledged true
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,open,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {format,CSV_COLUMNS,csvRow,csvValues,jsonLines,argsFor} from './gcd_bulk_codec.mjs';

export async function convertGcdJsonl(options){
 const allowed=['input','output','manifest','snapshot-at','source-url','license-acknowledged','source-sha256'];if(Object.keys(options).some(k=>!allowed.includes(k))||!options.input||!options.output||!options.manifest||options['license-acknowledged']!=='true'||path.resolve(options.input)===path.resolve(options.output)||path.resolve(options.output)===path.resolve(options.manifest))throw Error('Supply distinct input/output/manifest paths, source snapshot and explicit license acknowledgement');
 const sourceHash=createHash('sha256'),temporary=await mkdtemp(path.join(os.tmpdir(),'gcd-bulk-')),spool=new DatabaseSync(path.join(temporary,'records.sqlite'));let count=0,csv,manifestFile,createdCsv=false,createdManifest=false;
 try{
  spool.exec('CREATE TABLE records(id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');const insert=spool.prepare('INSERT INTO records(id,payload) VALUES(?,?)');
  const snapshot=options['snapshot-at'];if(typeof snapshot!=='string'||!Number.isFinite(Date.parse(snapshot)))throw Error('Use the actual source snapshot time');
  for await(const {raw,line} of jsonLines(options.input,180000,chunk=>sourceHash.update(chunk))){let record;try{record=format.sanitizeGcdBulkRecord(raw,snapshot)}catch{throw Error('GCD bibliographic validation failed at source line '+line)}const id=Number(record.api_url.match(/\/([1-9]\d*)\/$/)[1]);try{insert.run(id,format.canonicalJson(record))}catch{throw Error('Duplicate GCD provider ID at source line '+line)}count++;if(count>format.GCD_BULK_BOUNDS.expectedRecords)throw Error('Export exceeds the supported count')}
  const inputSha256=sourceHash.digest('hex'),sourceSha256=options['source-sha256']||inputSha256;
  const base={schemaVersion:format.GCD_BULK_SCHEMA,sourceUrl:options['source-url']||'https://www.comics.org/download/',sourceSha256,exportSha256:'0'.repeat(64),recordsSha256:'0'.repeat(64),snapshotAt:snapshot,expectedRecords:count,licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',licenseAcknowledged:true};format.validateGcdBulkManifest(base);
  csv=await open(options.output,'wx');createdCsv=true;const exportHash=createHash('sha256');let chain=format.GCD_EMPTY_CHAIN;
  async function write(text){exportHash.update(text);await csv.writeFile(text,'utf8')}
  await write(csvRow(CSV_COLUMNS));for(const row of spool.prepare('SELECT payload FROM records ORDER BY id').iterate()){const record=JSON.parse(row.payload);chain=await format.appendGcdRecordChain(chain,record);await write(csvRow(csvValues(record)))}await csv.sync();await csv.close();csv=null;
  const manifest={...base,exportSha256:exportHash.digest('hex'),recordsSha256:chain};manifestFile=await open(options.manifest,'wx');createdManifest=true;await manifestFile.writeFile(JSON.stringify(manifest,null,2)+'\n');await manifestFile.sync();await manifestFile.close();manifestFile=null;
  return {outcome:'normalized-export-created',records:count,inputSha256,sourceSha256,exportSha256:manifest.exportSha256,importId:await format.sha256(format.canonicalJson(manifest)),artworkExported:false,valuationExported:false,historicalCoverageComplete:false};
 }catch(error){await csv?.close();await manifestFile?.close();if(createdCsv)await rm(options.output,{force:true});if(createdManifest)await rm(options.manifest,{force:true});throw error}finally{spool.close();await rm(temporary,{recursive:true,force:true})}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(await convertGcdJsonl(argsFor(process.argv.slice(2)))))}catch(e){console.error(JSON.stringify({outcome:'conversion-failed',reason:e.message}));process.exitCode=1}}
