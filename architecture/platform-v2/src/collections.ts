import {DomainError,once,serializable,type SqlPool} from './db';
import {cents} from './money';
import {listingVerificationGate} from './scans';
export async function addCollectionItem(pool:SqlPool,userId:string,input:{collectionId:string;comicId:string;gradeKey:string;certificationNumber?:string;purchasePriceCents?:string;purchasedAt?:string;privateNotes?:string;conditionNotes?:string},key:string){
 if((input.privateNotes?.length||0)>2000||(input.conditionNotes?.length||0)>2000)throw new DomainError('notes_too_long','Notes cannot exceed 2,000 characters.',400);
 return serializable(pool,db=>once(db,key,'add_collection_item',{userId,input},async()=>{
  const collection=(await db.query('SELECT id FROM ch_platform.user_collections WHERE id=$1 AND user_id=$2',[input.collectionId,userId])).rows[0];if(!collection)throw new DomainError('collection_missing','Owned collection not found.',404);
  const grade=(await db.query<{format:string;grader:string|null}>('SELECT format,grader FROM ch_platform.grade_profiles WHERE key=$1',[input.gradeKey])).rows[0];
  if(!grade||(grade.format==='raw'&&input.certificationNumber)||(grade.grader==='CGC'&&!/^[0-9]{6,20}$/.test(input.certificationNumber||'')))throw new DomainError('grade_cert_invalid','Choose a valid condition and matching certificate details.',400);
  const comic=(await db.query<{metadata_status:string}>('SELECT metadata_status FROM ch_platform.comics WHERE id=$1',[input.comicId])).rows[0];if(!comic||comic.metadata_status==='aliased')throw new DomainError('comic_missing','Choose the canonical or provisional directory record.',404);
  const item=(await db.query<{id:string}>(`INSERT INTO ch_platform.collection_items(collection_id,user_id,comic_id,grade_key,certification_number,purchase_price_cents,purchased_at,private_notes,condition_notes)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[input.collectionId,userId,input.comicId,input.gradeKey,input.certificationNumber||null,input.purchasePriceCents===undefined?null:cents(input.purchasePriceCents).toString(),input.purchasedAt||null,input.privateNotes||'',input.conditionNotes||''])).rows[0];return {copyId:item.id};
 }));
}
export async function createMarketplaceListing(pool:SqlPool,userId:string,input:{copyIds:string[];askingPriceCents:string;saleMode:'fixed'|'auction'|'trade';title:string},key:string){
 if(input.copyIds.length<1||input.copyIds.length>1000||new Set(input.copyIds).size!==input.copyIds.length||input.title.length<1||input.title.length>180||cents(input.askingPriceCents)===BigInt(0))throw new DomainError('listing_invalid','Choose distinct copies, a title and a positive price.',400);
 return serializable(pool,db=>once(db,key,'create_listing',{userId,input},async()=>{
  const copies=(await db.query<{id:string;comic_id:string;metadata_status:string;status:string}>(`SELECT p.id,p.comic_id,p.status,c.metadata_status FROM ch_platform.collection_items p JOIN ch_platform.comics c ON c.id=p.comic_id
   WHERE p.id=ANY($1::uuid[]) AND p.user_id=$2 ORDER BY p.id FOR UPDATE OF p`,[input.copyIds,userId])).rows;
  if(copies.length!==input.copyIds.length||copies.some(c=>c.status!=='held'||c.metadata_status==='aliased'))throw new DomainError('copies_unavailable','Select available physical copies from your collection.');
  const listing=(await db.query<{id:string}>(`INSERT INTO ch_platform.marketplace_listings(seller_id,comic_id,is_custom_entry,kind,sale_mode,title,asking_price_cents)
   VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[userId,copies[0].comic_id,copies.some(c=>c.metadata_status!=='canonical'),copies.length===1?'single':'collection',input.saleMode,input.title,input.askingPriceCents])).rows[0];
  for(const copy of copies)await db.query('INSERT INTO ch_platform.listing_items(listing_id,seller_id,collection_item_id,comic_id) VALUES($1,$2,$3,$4)',[listing.id,userId,copy.id,copy.comic_id]);return {listingId:listing.id,status:'draft'};
 }));
}
export async function activateListing(pool:SqlPool,userId:string,listingId:string,key:string,thresholdCents='50000'){
 return serializable(pool,db=>once(db,key,'activate_listing',{userId,listingId},async()=>{
  const row=(await db.query<{status:string}>('SELECT status FROM ch_platform.marketplace_listings WHERE id=$1 AND seller_id=$2 FOR UPDATE',[listingId,userId])).rows[0];if(!row||!['draft','under_review'].includes(row.status))throw new DomainError('listing_not_editable','Owned editable listing required.');
  await listingVerificationGate(db,listingId,userId,thresholdCents);
  const unavailable=(await db.query("SELECT p.id FROM ch_platform.listing_items l JOIN ch_platform.collection_items p ON p.id=l.collection_item_id WHERE l.listing_id=$1 AND p.status<>'held'",[listingId])).rows[0];if(unavailable)throw new DomainError('copy_unavailable','A listed copy is no longer held.');
  await db.query("UPDATE ch_platform.marketplace_listings SET status='active',version=version+1 WHERE id=$1",[listingId]);await db.query('UPDATE ch_platform.listing_items SET reserved=true WHERE listing_id=$1',[listingId]);return {listingId,status:'active'};
 }));
}
