import type {Metadata,Sharp} from 'sharp';
import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import type {CatalogDb} from './catalog-store';
import {ApiRequestError} from './api-security';
import {COMMUNITY_COVER_CREDIT,SELLER_PHOTO_CREDIT,communityPhotoUrl} from './cover-cache-types';

// Member covers: they come before any catalog source. Full priority (see withCatalogCovers / resolveCoverBatch):
//  1. seller photo (front photo of an active, else most recent sold, listing of that exact issue, unless
//     the seller opted out)  2. most recent approved collector-submitted cover photo
//  3. reviewed local public-domain /covers/ files, then catalog art only when CATALOG_ART_COVERS=on
export type FallbackOrigin='seller'|'community';
export type FallbackCover={url:string;attribution:string;source:string;origin:FallbackOrigin};
export const FALLBACK_COVER_ORDER:readonly FallbackOrigin[]=['seller','community'];
export function pickFallbackCover(found:Partial<Record<FallbackOrigin,FallbackCover>>):FallbackCover|null{for(const origin of FALLBACK_COVER_ORDER){const cover=found[origin];if(cover)return cover}return null}

export const COMMUNITY_COVER_DAILY_LIMIT=20,COMMUNITY_COVER_MAX_UPLOAD=10*1024*1024,COMMUNITY_COVER_MAX_EDGE=1200;
export const communityCoverStatuses=['pending','approved','rejected','hidden'] as const;
/** New submissions are auto-approved for now; COMMUNITY_COVERS_REVIEW=manual queues them as pending. */
export const initialCommunityCoverStatus=(env:Record<string,string|undefined>=process.env)=>env.COMMUNITY_COVERS_REVIEW==='manual'?'pending' as const:'approved' as const;
const mediaId=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
export const communityCoverSubmission=z.object({issueId:z.coerce.number().int().min(0).max(6500000000),contentType:z.enum(['image/jpeg','image/png','image/webp'],{message:'Upload a JPEG, PNG or WebP photo.'})}).strict();
export const communityCoverReport=z.object({mediaId,reason:z.string().trim().max(500).optional()}).strict();

/** Decode, auto-orient and re-encode: EXIF/XMP/ICC text is dropped, longest edge ≤ 1200px. */
export async function normalizeCommunityCover(bytes:Uint8Array,contentType:string){
 const invalid=()=>new ApiRequestError('Upload a readable, still JPEG, PNG or WebP cover photo at least 200 pixels wide, up to 10 MB.',400);
 if(!/^image\/(jpeg|png|webp)$/.test(contentType)||!bytes.length)throw invalid();
 if(bytes.length>COMMUNITY_COVER_MAX_UPLOAD)throw new ApiRequestError('Cover photos must be 10 MB or smaller.',413);
 // Imported lazily so the catalog read path (withCatalogCovers) never loads the image codec.
 const {default:decode}=await import('sharp');let meta:Metadata,source:Sharp;
 try{source=decode(bytes,{limitInputPixels:40000000,animated:false,failOn:'error'});meta=await source.metadata()}catch{throw invalid()}
 // The declared type must match the decoded container, not just the header.
 if(!meta.width||!meta.height||(meta.pages||1)>1||meta.format!==contentType.slice(6))throw invalid();
 const [w,h]=(meta.orientation||1)>=5?[meta.height,meta.width]:[meta.width,meta.height];
 if(Math.min(w,h)<200)throw invalid();
 if(h/w<0.5||h/w>3)throw new ApiRequestError('Crop the photo to the comic cover before uploading.',400);
 try{
  const full=await source.clone().rotate().resize({width:COMMUNITY_COVER_MAX_EDGE,height:COMMUNITY_COVER_MAX_EDGE,fit:'inside',withoutEnlargement:true}).webp({quality:84}).toBuffer({resolveWithObject:true});
  const thumbnail=await source.clone().rotate().resize({width:480,height:640,fit:'inside',withoutEnlargement:true}).webp({quality:80}).toBuffer();
  return {bytes:full.data,thumbnail,contentType:'image/webp',width:full.info.width,height:full.info.height,hash:createHash('sha256').update(full.data).digest('hex')};
 }catch{throw invalid()}
}

// One definition of "may be shown publicly" for both the catalog fallback and /api/media.
const accountInGoodStanding=(profile:string)=>sql`${sql.raw(profile)}.moderated=0 AND ${sql.raw(profile)}.deletion_started_at IS NULL AND NOT EXISTS(SELECT 1 FROM ch_web.account_restrictions r WHERE r.user_id=${sql.raw(profile)}.user_id AND r.scope='account')`;
// cover_opt_out (migration 042): the seller kept this listing's photo out of the directory.
const coverListing=sql`l.status IN ('active','sold') AND l.issue_id IS NOT NULL AND l.cover_opt_out=0`;
const frontPhoto=sql`(CASE WHEN jsonb_typeof(l.photos::jsonb)='array' THEN l.photos::jsonb->>0 END)`;

async function sellerPhotoRows(db:CatalogDb,ids:number[]){
 const rows=await db.execute(sql`SELECT DISTINCT ON(l.issue_id) l.issue_id,m.id AS media_id FROM ch_web.listings l JOIN ch_web.profiles p ON p.id=l.seller_id JOIN ch_web.media m ON m.id=${frontPhoto} AND m.user_id=p.user_id
  WHERE l.issue_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND ${coverListing} AND p.visible=1 AND ${accountInGoodStanding('p')}
  ORDER BY l.issue_id,(l.status='active') DESC,l.created_at DESC,l.id`);
 return new Map(rows.rows.map(row=>[Number(row.issue_id),String(row.media_id)]));
}
async function communityCoverRows(db:CatalogDb,ids:number[]){
 const rows=await db.execute(sql`SELECT DISTINCT ON(c.issue_id) c.issue_id,c.media_id FROM ch_web.community_covers c JOIN ch_web.media m ON m.id=c.media_id AND m.user_id=c.user_id JOIN ch_web.profiles p ON p.user_id=c.user_id
  WHERE c.issue_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND c.status='approved' AND ${accountInGoodStanding('p')}
  ORDER BY c.issue_id,c.created_at DESC,c.id`);
 return new Map(rows.rows.map(row=>[Number(row.issue_id),String(row.media_id)]));
}

/** Fallback covers for issues that still have none. Never throws: a missing migration means no fallbacks. */
export async function fallbackCovers(db:CatalogDb,ids:number[]):Promise<Map<number,FallbackCover>>{
 const out=new Map<number,FallbackCover>(),wanted=[...new Set(ids.filter(id=>Number.isSafeInteger(id)&&id>=0))];if(!wanted.length)return out;
 const [seller,community]=await Promise.all([sellerPhotoRows(db,wanted).catch(()=>new Map<number,string>()),communityCoverRows(db,wanted).catch(()=>new Map<number,string>())]);
 for(const id of wanted){
  const s=seller.get(id),c=community.get(id);
  const cover=pickFallbackCover({
   ...(s?{seller:{url:communityPhotoUrl(s),attribution:SELLER_PHOTO_CREDIT,source:'/?section=Marketplace&issue='+id,origin:'seller' as const}}:{}),
   ...(c?{community:{url:communityPhotoUrl(c),attribution:COMMUNITY_COVER_CREDIT,source:communityPhotoUrl(c),origin:'community' as const}}:{})});
  if(cover)out.set(id,cover);
 }
 return out;
}

/** /api/media exception: a photo is public when it is currently usable as a catalog cover. */
export async function isPublicCoverPhoto(db:CatalogDb,id:string){
 if(!mediaId.safeParse(id).success)return false;
 const seller=await db.execute(sql`SELECT 1 FROM ch_web.media m JOIN ch_web.profiles p ON p.user_id=m.user_id JOIN ch_web.listings l ON l.seller_id=p.id
  WHERE m.id=${id} AND ${coverListing} AND ${frontPhoto}=m.id AND p.visible=1 AND ${accountInGoodStanding('p')} LIMIT 1`).catch(()=>({rows:[]}));
 if(seller.rows.length)return true;
 const community=await db.execute(sql`SELECT 1 FROM ch_web.community_covers c JOIN ch_web.media m ON m.id=c.media_id AND m.user_id=c.user_id JOIN ch_web.profiles p ON p.user_id=c.user_id
  WHERE c.media_id=${id} AND c.status='approved' AND ${accountInGoodStanding('p')} LIMIT 1`).catch(()=>({rows:[]}));
 return community.rows.length>0;
}

export async function communitySubmissionsToday(db:CatalogDb,userId:string){
 const rows=await db.execute(sql`SELECT count(*)::int AS n FROM ch_web.community_covers WHERE user_id=${userId} AND created_at>now()-interval '1 day'`);
 return Number(rows.rows[0]?.n||0);
}

/** Reports flag a cover for the admins' review queue. Only admins remove photos; as a safety net against
 * offensive images, a cover is hidden automatically once this many different members have reported it. */
export const COMMUNITY_COVER_AUTO_HIDE_REPORTS=3;
export async function reportCommunityCover(db:CatalogDb,userId:string,input:z.infer<typeof communityCoverReport>){
 const [cover]=(await db.execute(sql`SELECT id,status FROM ch_web.community_covers WHERE media_id=${input.mediaId}`)).rows as {id:string;status:string}[];
 if(!cover)throw new ApiRequestError('That cover photo was not found.',404);
 const inserted=await db.execute(sql`INSERT INTO ch_web.community_cover_reports(cover_id,reporter_user_id,reason) VALUES(${cover.id},${userId},${input.reason||''}) ON CONFLICT DO NOTHING RETURNING cover_id`);
 const added=inserted.rows.length;
 const [row]=(await db.execute(sql`UPDATE ch_web.community_covers SET report_count=report_count+${added},
  status=CASE WHEN status='approved' AND report_count+${added}>=${COMMUNITY_COVER_AUTO_HIDE_REPORTS} THEN 'hidden' ELSE status END,updated_at=now() WHERE id=${cover.id} RETURNING status`)).rows as {status:string}[];
 return {hidden:row?.status==='hidden'};
}

// ---- Admin moderation (callers must have passed requireAdmin) ----
export const adminCoverAction=z.object({action:z.enum(['approve','remove']),mediaId}).strict();
export type AdminCoverResult={kind:'community'|'seller';issueId:number};

/** approve: a pending/hidden collector photo goes live. remove: a collector photo is rejected, or a
 * seller's listing photo is taken out of the directory (the photo stays on the listing). */
export async function adminModerateCover(db:CatalogDb,action:'approve'|'remove',id:string):Promise<AdminCoverResult>{
 if(!mediaId.safeParse(id).success)throw new ApiRequestError('That cover photo was not found.',404);
 const status=action==='approve'?'approved':'rejected';
 // Approving a reported photo means "keep it": its open reports are cleared from the review queue.
 const [community]=(await db.execute(sql`UPDATE ch_web.community_covers SET status=${status},report_count=CASE WHEN ${status}='approved' THEN 0 ELSE report_count END,reviewed_at=now(),updated_at=now() WHERE media_id=${id} RETURNING issue_id`)).rows as {issue_id:unknown}[];
 if(community)return {kind:'community',issueId:Number(community.issue_id)};
 if(action==='remove'){
  const [listing]=(await db.execute(sql`UPDATE ch_web.listings l SET cover_opt_out=1 WHERE l.issue_id IS NOT NULL AND ${frontPhoto}=${id} RETURNING l.issue_id`)).rows as {issue_id:unknown}[];
  if(listing)return {kind:'seller',issueId:Number(listing.issue_id)};
 }
 throw new ApiRequestError('That cover photo was not found.',404);
}

/** When an admin replaces a seller's photo, that listing's photo leaves the directory. Returns its media id. */
export async function removeSellerCoverForIssue(db:CatalogDb,issueId:number){
 const id=(await sellerPhotoRows(db,[issueId])).get(issueId);
 if(id)await adminModerateCover(db,'remove',id);
 return id||null;
}

export type AdminCoverRow={mediaId:string;issueId:number;title:string;status:string;reportCount:number;uploader:string;createdAt:string;url:string};
/** review: waiting for approval, hidden by reports, or live with open reports. recent: the latest uploads. */
export async function adminCoverQueue(db:CatalogDb,view:'review'|'recent'):Promise<AdminCoverRow[]>{
 const filter=view==='review'?sql`(c.status IN ('pending','hidden') OR (c.status='approved' AND c.report_count>0))`:sql`TRUE`;
 const rows=(await db.execute(sql`SELECT c.issue_id,c.media_id,c.status,c.report_count,c.created_at,p.name AS uploader FROM ch_web.community_covers c
  LEFT JOIN ch_web.profiles p ON p.user_id=c.user_id WHERE ${filter} ORDER BY c.created_at DESC,c.id LIMIT 100`)).rows as Record<string,unknown>[];
 // Loaded lazily: catalog-store imports the cover modules, so a static import would be circular.
 const {catalogIssuesById}=await import('./catalog-store');
 const issues=new Map((await catalogIssuesById(db,[...new Set(rows.map(row=>Number(row.issue_id)))]).catch(()=>[])).map(issue=>[issue.id,issue]));
 return rows.map(row=>{const issue=issues.get(Number(row.issue_id)),id=String(row.media_id);return {mediaId:id,issueId:Number(row.issue_id),
  title:issue?issue.title+(issue.number?' #'+issue.number:''):'Issue '+row.issue_id,status:String(row.status),reportCount:Number(row.report_count||0),
  uploader:String(row.uploader||'A member'),createdAt:new Date(String(row.created_at)).toISOString(),url:'/api/media?id='+id}});
}

