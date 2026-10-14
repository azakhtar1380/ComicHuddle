import {collectionEntrySchema,type CollectionEntry} from '../../../lib/collection-entry';
import {assertUuid} from '../analyzer';
import type {Queryable} from '../types';

const labels={Universal:'UNIVERSAL','Signature Series':'SIGNATURE',Qualified:'QUALIFIED',Restored:'RESTORED',Conserved:'CONSERVED'} as const;
/** Never infer an FMV comparable or VERIFIED certification from user-entered metadata. */
export function collectionColumns(entry:CollectionEntry){
 const value=collectionEntrySchema.parse(entry);
 return {physical_format:value.format,raw_condition:value.format==='RAW'?value.rawCondition||'UNKNOWN':null,
  grade:value.grade,grading_company:value.gradingCompany,label_type:value.labelType?labels[value.labelType]:null,
  certification_number:value.certificationNumber,comparable_attributes_key:'UNKNOWN',
  purchase_price_cents:value.purchasePriceCents,purchase_currency:value.purchasePriceCents===null?null:'USD',
  purchased_at:value.acquiredOn,private_notes:value.notes};
}
/** Call inside withSession() using its verified userId, never a user ID from HTTP JSON. */
export async function saveOwnedCopy(db:Queryable,trustedUserId:string,directoryId:string,entry:CollectionEntry,requestId:string){
 assertUuid(trustedUserId);assertUuid(directoryId);assertUuid(requestId);
 const values=collectionColumns(entry);
 const resolved=await db.query<{id:string}>('SELECT comichuddle.resolve_directory_id($1::uuid) AS id',[directoryId]);
 const canonical=resolved.rows[0]?.id;if(!canonical)throw new Error('Directory edition unavailable');
 const keys=Object.keys(values),parameters=[requestId,trustedUserId,canonical,...Object.values(values)];
 const inserted=await db.query<{id:string}>(`INSERT INTO comichuddle.user_collections
  (id,user_id,directory_id,${keys.join(',')}) VALUES (${parameters.map((_,index)=>'$'+(index+1)).join(',')})
  ON CONFLICT(id) DO NOTHING RETURNING id`,parameters);
 if(inserted.rows[0])return {copyId:requestId,directoryComicId:canonical,replayed:false};
 const existing=await db.query<Record<string,unknown>>(`SELECT directory_id::text,physical_format,raw_condition,
  grade::text,grading_company,label_type,certification_number,comparable_attributes_key,purchase_price_cents::text,
  purchase_currency,purchased_at::text,private_notes FROM comichuddle.user_collections
  WHERE id=$1::uuid AND user_id=$2::uuid`,[requestId,trustedUserId]);
 const row=existing.rows[0];
 if(!row||row.directory_id!==canonical||keys.some(key=>row[key]!==values[key as keyof typeof values]))throw new Error('Save request conflicts with an existing copy');
 return {copyId:requestId,directoryComicId:canonical,replayed:true};
}
