// Private listing drafts, several per seller (migration 049). Each "Sell a comic" starts a new draft; saved ones
// show in the marketplace's Drafts section. The legacy single draft (migration 022, also written when a seller
// edits a live listing) is moved in here the first time drafts are read.
import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import type {getDb} from '../db';
import {ApiRequestError} from './api-security';
import {listingDraftSchema,type ListingDraft} from './listing-draft';

type Db=ReturnType<typeof getDb>;
export const MAX_LISTING_DRAFTS=50;
export type DraftSummary={id:string;title:string;comics:number;photoId:string|null;saleType:'fixed'|'auction';step:number;updatedAt:string};
type DraftRow={id:string;revision:string;data:unknown;updated_at:string|Date};

export async function adoptLegacyDraft(db:Db,userId:string){
 await db.execute(sql`WITH moved AS (DELETE FROM ch_web.collector_listing_drafts WHERE user_id = ${userId} RETURNING revision,data,updated_at) INSERT INTO ch_web.listing_drafts(id,user_id,revision,data,created_at,updated_at) SELECT ${randomUUID()}::uuid,${userId},revision,data,updated_at,updated_at FROM moved`);
}
const iso=(value:string|Date)=>new Date(value).toISOString();
function parse(data:unknown):ListingDraft|null{const value=typeof data==='string'?JSON.parse(data):data;const parsed=listingDraftSchema.safeParse(value);return parsed.success?parsed.data as ListingDraft:null}
function summary(row:DraftRow):DraftSummary|null{
 const draft=parse(row.data);if(!draft)return null;
 const comics=draft.rows.reduce((sum,item)=>sum+item.copyIds.length,0),first=draft.rows[0];
 const title=draft.title.trim()||(first?(first.title+' '+first.issue).trim()+(draft.rows.length>1?' and '+(draft.rows.length-1)+' more':''):'Untitled listing');
 return {id:row.id,title:title.slice(0,120),comics,photoId:draft.photos[0]||null,saleType:draft.saleType==='auction'?'auction':'fixed',step:draft.step,updatedAt:iso(row.updated_at)};
}

export async function listDrafts(db:Db,userId:string){
 await adoptLegacyDraft(db,userId);
 const rows=(await db.execute(sql`SELECT id,revision,data,updated_at FROM ch_web.listing_drafts WHERE user_id = ${userId} ORDER BY updated_at DESC LIMIT ${MAX_LISTING_DRAFTS}`)).rows as DraftRow[];
 return rows.flatMap(row=>{const value=summary(row);return value?[value]:[]});
}
/** One draft by id; 'latest' opens the most recent one (after editing a live listing). Unknown ids are new drafts. */
export async function readDraft(db:Db,userId:string,id:string){
 await adoptLegacyDraft(db,userId);
 const rows=(id==='latest'?await db.execute(sql`SELECT id,revision,data,updated_at FROM ch_web.listing_drafts WHERE user_id = ${userId} ORDER BY updated_at DESC LIMIT 1`):await db.execute(sql`SELECT id,revision,data,updated_at FROM ch_web.listing_drafts WHERE user_id = ${userId} AND id = ${id}::uuid`)).rows as DraftRow[];
 const row=rows[0];
 if(!row)return {id:id==='latest'?randomUUID():id,draft:null,revision:null,updatedAt:null};
 return {id:row.id,draft:parse(row.data),revision:row.revision,updatedAt:iso(row.updated_at)};
}
export async function writeDraft(db:Db,userId:string,input:{draftId:string;baseRevision:string|null;draft:ListingDraft}){
 const revision=randomUUID(),data=JSON.stringify(input.draft);
 if(input.baseRevision){
  const result=await db.execute(sql`UPDATE ch_web.listing_drafts SET data=${data}::jsonb,revision=${revision}::uuid,updated_at=now() WHERE id=${input.draftId}::uuid AND user_id=${userId} AND revision=${input.baseRevision}::uuid RETURNING id`);
  return result.rows.length?{saved:true,id:input.draftId,revision}:null;
 }
 const count=Number(((await db.execute(sql`SELECT count(*)::int AS n FROM ch_web.listing_drafts WHERE user_id = ${userId}`)).rows[0] as {n:number}).n);
 if(count>=MAX_LISTING_DRAFTS)throw new ApiRequestError('You have '+MAX_LISTING_DRAFTS+' saved drafts. Publish or delete one first.',409);
 const result=await db.execute(sql`INSERT INTO ch_web.listing_drafts(id,user_id,revision,data) VALUES(${input.draftId}::uuid,${userId},${revision}::uuid,${data}::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id`);
 return result.rows.length?{saved:true,id:input.draftId,revision}:null;
}
export async function deleteDraft(db:Db,userId:string,id:string,revision:string|null){
 await db.execute(revision?sql`DELETE FROM ch_web.listing_drafts WHERE id=${id}::uuid AND user_id=${userId} AND revision=${revision}::uuid`:sql`DELETE FROM ch_web.listing_drafts WHERE id=${id}::uuid AND user_id=${userId}`);
 return {saved:true};
}
