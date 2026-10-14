import {ApiRequestError} from './api-security';
import {GCD_LICENSE,GCD_ORIGIN,normalizeGcdIssue} from './gcd-catalog';

export const GCD_BULK_BOUNDS=Object.freeze({bodyBytes:1_600_000,records:8,expectedRecords:10_000_000});
export const GCD_BULK_SCHEMA='gcd-bulk/v1' as const;
export const GCD_EMPTY_CHAIN='0'.repeat(64);
export type GcdBulkManifest={schemaVersion:typeof GCD_BULK_SCHEMA;sourceUrl:string;sourceSha256:string;exportSha256:string;recordsSha256:string;snapshotAt:string;expectedRecords:number;licenseUrl:typeof GCD_LICENSE;licenseAcknowledged:true};
export const isSha256=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function canonicalJson(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,v])=>JSON.stringify(key)+':'+canonicalJson(v)).join(',')+'}';
 throw new ApiRequestError('Invalid canonical GCD export value.',400);
}
export async function sha256(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')}
export async function appendGcdRecordChain(chain:string,record:unknown){if(!isSha256(chain))throw new ApiRequestError('Invalid export record chain.',400);return sha256(chain+'\n'+canonicalJson(record))}
export function validateGcdBulkManifest(value:unknown,now=Date.now()):GcdBulkManifest{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiRequestError('A GCD export manifest is required.',400);
 const m=value as Record<string,unknown>,keys=['schemaVersion','sourceUrl','sourceSha256','exportSha256','recordsSha256','snapshotAt','expectedRecords','licenseUrl','licenseAcknowledged'];
 if(Object.keys(m).length!==keys.length||Object.keys(m).some(k=>!keys.includes(k))||m.schemaVersion!==GCD_BULK_SCHEMA||m.licenseUrl!==GCD_LICENSE||m.licenseAcknowledged!==true||!isSha256(m.sourceSha256)||!isSha256(m.exportSha256)||!isSha256(m.recordsSha256)||!Number.isSafeInteger(m.expectedRecords)||Number(m.expectedRecords)<1||Number(m.expectedRecords)>GCD_BULK_BOUNDS.expectedRecords||typeof m.snapshotAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(m.snapshotAt)||!Number.isFinite(Date.parse(m.snapshotAt))||new Date(m.snapshotAt).toISOString()!==m.snapshotAt||Date.parse(m.snapshotAt)>now||typeof m.sourceUrl!=='string')throw new ApiRequestError('The GCD manifest has invalid source, date, counts, checksums or license acknowledgement.',400);
 let source:URL;try{source=new URL(m.sourceUrl)}catch{throw new ApiRequestError('Use a supported GCD source URL.',400)}
 if(source.origin!==GCD_ORIGIN||source.username||source.password||source.search||source.hash||!['/download/','/api/'].includes(source.pathname))throw new ApiRequestError('Use the GCD download or API source URL.',400);
 return m as GcdBulkManifest;
}
/** A reviewed transport projection, using the same issue normalizer as API sync. */
export function sanitizeGcdBulkRecord(raw:unknown,snapshotAt:string){
 let n:ReturnType<typeof normalizeGcdIssue>;try{n=normalizeGcdIssue(raw,snapshotAt)}catch{throw new ApiRequestError('A bulk issue fails GCD bibliographic validation.',400)}
 const b=n.issue.bibliography!,metadata=JSON.parse(n.rawMetadata) as {descriptor:string;variantName:string;publisherName:string;notes:string};
 return {api_url:GCD_ORIGIN+'/api/issue/'+n.issue.gcdId+'/',series:GCD_ORIGIN+'/api/series/'+n.seriesId+'/',series_name:n.issue.title,number:n.issue.number,descriptor:metadata.descriptor,variant_name:metadata.variantName,variant_of:b.variantOf===null?null:GCD_ORIGIN+'/api/issue/'+b.variantOf+'/',title:b.issueTitle,volume:b.volume,publication_date:b.publicationDate,key_date:b.keyDate,on_sale_date:b.onSaleDate,price:b.originalCoverPrice.text,page_count:b.pageCount,isbn:b.isbn,barcode:b.barcode,indicia_publisher:b.indiciaPublisher,publisher_name:metadata.publisherName,brand_emblem:b.brandEmblem,rating:b.rating,indicia_frequency:b.indiciaFrequency,indicia_printer:b.indiciaPrinter,keywords:b.keywords,editing:b.editing,notes:metadata.notes,story_set:b.stories.map(s=>({type:s.type,title:s.title,feature:s.feature,sequence_number:s.sequenceNumber,page_count:s.pageCount,script:s.script,pencils:s.pencils,inks:s.inks,colors:s.colors,letters:s.letters,editing:s.editing,job_number:s.jobNumber,genre:s.genre,first_line:s.firstLine,characters:s.characters,synopsis:s.synopsis,notes:s.notes,keywords:s.keywords}))};
}
