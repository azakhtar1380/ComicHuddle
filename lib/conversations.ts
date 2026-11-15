import {getDb} from '../db';
import {profiles,blocks,threads,listings,careProviders,media} from '../db/schema';
import {and,eq,or,inArray,sql} from 'drizzle-orm';
import {catalogIssuesById} from './catalog-store';
import {messageLinks,previewKey,type LinkPreview} from '../components/messages/links';
export type {LinkPreview};
type Db=ReturnType<typeof getDb>;
type Profile=typeof profiles.$inferSelect;

export async function blocked(db:Db,a:string,b:string){return (await db.select().from(blocks).where(or(and(eq(blocks.fromId,a),eq(blocks.toId,b)),and(eq(blocks.fromId,b),eq(blocks.toId,a))))).length>0}

/** One conversation per pair of collectors. Starting again returns the existing thread (context is kept from the first start). */
export async function beginThread(db:Db,p:Profile,to:string,context=''){
 if(p.id===to)throw Error('You cannot message yourself.');
 const [target]=await db.select().from(profiles).where(eq(profiles.id,to));if(!target||!target.visible||!target.dmOpen||await blocked(db,p.id,to))throw Error('This collector is not accepting messages.');
 const [a,b]=[p.id,to].sort(),pair=a+':'+b;await db.insert(threads).values({id:crypto.randomUUID(),pair,a,b,context,createdAt:new Date().toISOString()}).onConflictDoNothing();
 const [thread]=await db.select().from(threads).where(eq(threads.pair,pair));return thread;
}

/**
 * Context for a conversation opened from a listing or a Comic Workshop studio. The reference must belong to
 * the person being messaged and be publicly visible; anything else is ignored (never trusted from the client).
 */
export async function referenceContext(db:Db,to:string,ref:{listingId?:string;providerId?:string}){
 if(ref.listingId){const [l]=await db.select({title:listings.title,sellerId:listings.sellerId,status:listings.status}).from(listings).where(eq(listings.id,ref.listingId));if(l&&l.sellerId===to&&['active','ended'].includes(l.status))return l.title.slice(0,200)}
 if(ref.providerId){const [c]=await db.select({name:careProviders.name,profileId:careProviders.profileId,visible:careProviders.visible,moderated:careProviders.moderated}).from(careProviders).where(eq(careProviders.id,ref.providerId));if(c&&c.profileId===to&&c.visible&&!c.moderated)return ('Comic Workshop · '+c.name).slice(0,200)}
 return '';
}

// ---------- Optional storage (migration 035). Every reader tolerates the tables being absent. ----------
type Optional={attachments:boolean;states:boolean};
let optionalCache:{at:number;value:Optional}|null=null;
const rowsOf=(r:unknown)=>((r as {rows?:Record<string,unknown>[]})?.rows)||[];
export async function messagingStorage(db:Db):Promise<Optional>{
 if(optionalCache&&(optionalCache.value.attachments&&optionalCache.value.states||Date.now()-optionalCache.at<60000))return optionalCache.value;
 let value:Optional={attachments:false,states:false};
 try{const [row]=rowsOf(await db.execute(sql`SELECT to_regclass('ch_web.message_attachments') IS NOT NULL AS attachments, to_regclass('ch_web.conversation_states') IS NOT NULL AS states`));value={attachments:!!row?.attachments,states:!!row?.states}}catch{/* not PostgreSQL or not migrated */}
 optionalCache={at:Date.now(),value};return value;
}

export type ThreadState={readAt:string|null;archivedAt:string|null};
/** This member's read/archive markers for the given threads. */
export async function threadStates(db:Db,profileId:string,threadIds:string[]){
 const out=new Map<string,ThreadState>();if(!threadIds.length||!(await messagingStorage(db)).states)return out;
 try{for(const row of rowsOf(await db.execute(sql`SELECT thread_id,read_at,archived_at FROM ch_web.conversation_states WHERE profile_id = ${profileId} AND thread_id IN (${sql.join(threadIds.map(id=>sql`${id}`),sql`, `)})`)))out.set(String(row.thread_id),{readAt:row.read_at?String(row.read_at):null,archivedAt:row.archived_at?String(row.archived_at):null})}catch{/* optional */}
 return out;
}
/** Records that `profileId` has read `threadId` up to `stamp` (never moves backwards). */
export async function markThreadRead(db:Db,threadId:string,profileId:string,stamp:string){
 if(!(await messagingStorage(db)).states)return;
 try{await db.execute(sql`INSERT INTO ch_web.conversation_states(thread_id,profile_id,read_at) VALUES(${threadId},${profileId},${stamp}) ON CONFLICT (thread_id,profile_id) DO UPDATE SET read_at = EXCLUDED.read_at WHERE ch_web.conversation_states.read_at IS NULL OR ch_web.conversation_states.read_at < EXCLUDED.read_at`)}catch{/* optional */}
}
export async function peerReadAt(db:Db,threadId:string,peerId:string){
 if(!(await messagingStorage(db)).states)return null;
 try{const [row]=rowsOf(await db.execute(sql`SELECT read_at FROM ch_web.conversation_states WHERE thread_id = ${threadId} AND profile_id = ${peerId}`));return row?.read_at?String(row.read_at):null}catch{return null}
}
/** Archive (stamp) or restore (null). A newer message brings an archived conversation back to the inbox. */
export async function setThreadArchived(db:Db,threadId:string,profileId:string,archivedAt:string|null){
 if(!(await messagingStorage(db)).states)return false;
 await db.execute(sql`INSERT INTO ch_web.conversation_states(thread_id,profile_id,archived_at) VALUES(${threadId},${profileId},${archivedAt}) ON CONFLICT (thread_id,profile_id) DO UPDATE SET archived_at = EXCLUDED.archived_at`);
 return true;
}
/** Removes this member's conversation markers and orphaned attachment rows after account deletion. Best effort. */
export async function forgetConversationData(db:Db,profileId:string){
 const storage=await messagingStorage(db);
 try{if(storage.states)await db.execute(sql`DELETE FROM ch_web.conversation_states WHERE profile_id = ${profileId} OR NOT EXISTS (SELECT 1 FROM ch_web.threads t WHERE t.id = ch_web.conversation_states.thread_id)`)}catch{/* optional */}
 try{if(storage.attachments)await db.execute(sql`DELETE FROM ch_web.message_attachments WHERE NOT EXISTS (SELECT 1 FROM ch_web.messages m WHERE m.id = ch_web.message_attachments.message_id)`)}catch{/* optional */}
}

// ---------- Photo attachments ----------
export const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** True when every photo id was uploaded by this account (through /api/media). */
export async function ownsMedia(db:Db,userId:string,ids:string[]){
 const unique=[...new Set(ids)];if(!unique.length)return true;
 const rows=await db.select({id:media.id}).from(media).where(and(eq(media.userId,userId),inArray(media.id,unique)));return rows.length===unique.length;
}
export function attachmentInsert(db:Db,messageId:string,photoIds:string[]){
 return db.execute(sql`INSERT INTO ch_web.message_attachments(message_id,position,media_id) VALUES ${sql.join(photoIds.map((id,i)=>sql`(${messageId},${i},${id})`),sql`, `)}`);
}
export async function attachmentsFor(db:Db,messageIds:string[]){
 const out=new Map<string,string[]>();if(!messageIds.length||!(await messagingStorage(db)).attachments)return out;
 try{for(const row of rowsOf(await db.execute(sql`SELECT message_id,media_id FROM ch_web.message_attachments WHERE message_id IN (${sql.join(messageIds.map(id=>sql`${id}`),sql`, `)}) ORDER BY message_id,position`))){const key=String(row.message_id);out.set(key,[...(out.get(key)||[]),String(row.media_id)])}}catch{/* optional */}
 return out;
}
export const attachmentUrl=(messageId:string,mediaId:string,thumbnail=false)=>'/api/social/attachment?message='+messageId+'&photo='+mediaId+(thumbnail?'&size=thumbnail':'');

// ---------- Link previews (listing, comic, Comic Workshop studio) ----------
/** Resolves link previews with the same visibility rules as the listing, studio and directory pages. */
export async function linkPreviews(db:Db,viewer:Profile,bodies:string[],host:string){
 const refs=bodies.flatMap(b=>messageLinks(b,host)),out:Record<string,LinkPreview>={};
 const listingIds=[...new Set(refs.filter(r=>r.kind==='listing').map(r=>r.id))].slice(0,30),providerIds=[...new Set(refs.filter(r=>r.kind==='provider').map(r=>r.id))].slice(0,30),issueIds=[...new Set(refs.filter(r=>r.kind==='issue').map(r=>Number(r.id)))].filter(Number.isSafeInteger).slice(0,30);
 try{
  if(listingIds.length){
   const rows=await db.select().from(listings).where(inArray(listings.id,listingIds)),sellers=rows.length?await db.select().from(profiles).where(inArray(profiles.id,[...new Set(rows.map(l=>l.sellerId))])):[];
   const blockedIds=new Set((await db.select().from(blocks).where(or(eq(blocks.fromId,viewer.id),eq(blocks.toId,viewer.id)))).map(b=>b.fromId===viewer.id?b.toId:b.fromId));
   const covers=new Map((await catalogIssuesById(db,[...new Set(rows.flatMap(l=>l.issueId?[l.issueId]:[]))])).map(i=>[i.id,i.cover||null]));
   for(const l of rows){const seller=sellers.find(s=>s.id===l.sellerId);const own=seller?.id===viewer.id;if(!seller||!own&&(!['active','ended'].includes(l.status)||!seller.visible||seller.moderated||blockedIds.has(seller.id)))continue;
    let photo:string|null=null;try{const photos=JSON.parse(l.photos) as unknown[];const items=JSON.parse(l.items) as {photoId?:unknown}[];const first=[...photos,...items.map(i=>i?.photoId)].find(v=>typeof v==='string'&&uuidPattern.test(v));if(typeof first==='string')photo='/api/media?id='+first+'&size=thumbnail'}catch{/* malformed photo list */}
    out[previewKey({kind:'listing',id:l.id})]={kind:'listing',href:'/?section=Marketplace&listing='+encodeURIComponent(l.id),id:l.id,title:l.title,grade:l.grade,price:l.price,status:l.status,saleType:l.saleType,currentBid:l.currentBid??null,photo:photo||(l.issueId?covers.get(l.issueId)||null:null)}}
  }
  if(providerIds.length){for(const c of await db.select().from(careProviders).where(inArray(careProviders.id,providerIds))){if(!c.visible||c.moderated)continue;out[previewKey({kind:'provider',id:c.id})]={kind:'provider',href:'/?section=Pressing&provider='+encodeURIComponent(c.id),id:c.id,name:c.name,location:c.location,photo:c.logoId&&uuidPattern.test(c.logoId)?'/api/media?id='+c.logoId+'&size=thumbnail':null}}}
  if(issueIds.length){for(const i of await catalogIssuesById(db,issueIds))out[previewKey({kind:'issue',id:i.id})]={kind:'issue',href:'/?section=Directory&issue='+i.id,id:i.id,title:i.title,number:i.number,publisher:i.publisher,year:i.year||null,cover:i.cover||null}}
 }catch{/* previews are optional decoration; the message text always shows */}
 return out;
}

/** Messages from the other person that arrived after this member's read marker, per thread. */
export async function unreadCounts(db:Db,profileId:string,threadIds:string[]){
 const out=new Map<string,number>();if(!threadIds.length||!(await messagingStorage(db)).states)return out;
 try{for(const row of rowsOf(await db.execute(sql`SELECT m.thread_id,count(*)::int AS n FROM ch_web.messages m LEFT JOIN ch_web.conversation_states s ON s.thread_id = m.thread_id AND s.profile_id = ${profileId} WHERE m.thread_id IN (${sql.join(threadIds.map(id=>sql`${id}`),sql`, `)}) AND m.profile_id <> ${profileId} AND (s.read_at IS NULL OR m.created_at > s.read_at) GROUP BY m.thread_id`)))out.set(String(row.thread_id),Number(row.n)||0)}catch{/* optional */}
 return out;
}
