// Server side of the My Profile page (migration 051: ch_web.profile_extras). Every read is tolerant:
// before the migration runs, profiles simply show without the new parts.
import {z} from 'zod';
import {getPool} from '../db/postgres';
import type {CatalogDb} from './catalog-store';
import {catalogIssuesById} from './catalog-store';
import {characterPage} from './characters';
import {feedbackSummary} from './community-feedback';
import {issueKeys} from './issue-keys';
import {listingDirectoryId} from './shared-catalog';
import type {Vault} from './vault';
import {MAX_PROFILE_TAGS,defaultShare,emptyExtras,profileTagPattern,type ProfileExtras,type ProfileIssueRef} from './profile-page-types';

export type ExtrasRow={profile_id:string;user_id:string;cover_id:string|null;tags:unknown;favorite_character_id:number|null;favorite_issue_id:string|number|null;grail_issue_id:string|number|null;grail_reward:string;share_wishlist:boolean;share_reviews:boolean;share_city:boolean};
export const coverUrlFor=(coverId:string|null|undefined)=>coverId?'/api/profile-cover?id='+coverId:null;

export async function extrasRows(profileIds:readonly string[]):Promise<Map<string,ExtrasRow>>{
 const ids=[...new Set(profileIds.filter(Boolean))],out=new Map<string,ExtrasRow>();
 if(!ids.length)return out;
 try{for(const row of (await getPool().query<ExtrasRow>('SELECT * FROM ch_web.profile_extras WHERE profile_id = ANY($1::text[])',[ids])).rows)out.set(row.profile_id,row)}catch{/* not migrated yet */}
 return out;
}
const tagList=(value:unknown)=>Array.isArray(value)?value.filter((tag):tag is string=>typeof tag==='string'&&profileTagPattern.test(tag)).slice(0,MAX_PROFILE_TAGS):[];
const issueRef=(issue:{id:number;title:string;number:string;year:number}):ProfileIssueRef=>({issueId:issue.id,title:issue.title,number:issue.number.replace(/^#/,''),year:issue.year||null});

/** Everything the profile page adds on top of the public profile. `own` sees their own share settings applied loosely. */
export async function profileExtras(db:CatalogDb,profile:{id:string;userId:string},vault:Vault,own:boolean,row?:ExtrasRow|null):Promise<ProfileExtras>{
 const extras=row===undefined?(await extrasRows([profile.id])).get(profile.id)||null:row;
 const share=extras?{wishlist:extras.share_wishlist,reviews:extras.share_reviews,city:extras.share_city}:defaultShare;
 const issueIds=[extras?.favorite_issue_id,extras?.grail_issue_id].map(v=>v===null||v===undefined?null:Number(v)).filter((v):v is number=>v!==null&&Number.isSafeInteger(v));
 const owned=vault.books.map(book=>listingDirectoryId(book)).filter((id):id is number=>id!==null);
 const [issues,keys,character,feedback]=await Promise.all([
  issueIds.length?catalogIssuesById(db,issueIds).catch(()=>[]):Promise.resolve([]),
  issueKeys(db,[...owned,...issueIds]).catch(()=>new Map()),
  extras?.favorite_character_id?characterPage(db,extras.favorite_character_id).catch(()=>null):Promise.resolve(null),
  feedbackSummary(getPool(),profile.id,new Date(),5).catch(()=>null),
 ]);
 const byId=new Map(issues.map(issue=>[issue.id,issue]));
 const fav=extras?.favorite_issue_id!=null?byId.get(Number(extras.favorite_issue_id)):undefined,grail=extras?.grail_issue_id!=null?byId.get(Number(extras.grail_issue_id)):undefined;
 const d=feedback?.detailed,stars=d?[d.itemAsDescribed,d.communication,d.shippingSpeed].filter((v):v is number=>v!==null):[];
 const showReviews=own||share.reviews,showWishlist=own||share.wishlist;
 const review=feedback?.recent.find(entry=>entry.comment&&entry.rating==='positive');
 return {
  ...emptyExtras,
  coverUrl:coverUrlFor(extras?.cover_id),
  tags:tagList(extras?.tags),
  favoriteCharacter:character?{id:character.characterId,name:character.name,firstAppearance:character.firstAppearance?{issueId:character.firstAppearance.issueId,title:character.firstAppearance.title,number:character.firstAppearance.number,year:character.firstAppearance.year}:null}:null,
  favoriteComic:fav?{...issueRef(fav),keyNote:keys.get(fav.id)?.note||null}:null,
  grail:showWishlist&&grail?{...issueRef(grail),reward:extras?.grail_reward||''}:null,
  keys:owned.filter(id=>keys.has(id)).length,
  rating:showReviews&&feedback&&feedback.lifetimeCount>0?{stars:stars.length?Math.round(stars.reduce((a,b)=>a+b,0)/stars.length*10)/10:null,percent:feedback.percentPositive,count:feedback.lifetimeCount}:null,
  latestReview:showReviews&&review?{text:review.comment.slice(0,220),by:review.buyer}:null,
  share,
 };
}

export const extrasInput=z.object({
 tags:z.array(z.string().trim().regex(profileTagPattern,'Tags use letters, numbers and spaces (24 characters max).')).max(MAX_PROFILE_TAGS).refine(tags=>new Set(tags.map(t=>t.toLowerCase())).size===tags.length,'Each tag once.').optional(),
 favoriteCharacterId:z.number().int().refine(id=>id!==0).nullable().optional(),
 favoriteIssueId:z.number().int().min(0).nullable().optional(),
 grailIssueId:z.number().int().min(0).nullable().optional(),
 grailReward:z.string().trim().max(80).optional(),
 shareWishlist:z.boolean().optional(),shareReviews:z.boolean().optional(),shareCity:z.boolean().optional(),
 shopWindow:z.enum(['open','window','closed']).optional(),
}).strict();
export type ExtrasInput=z.infer<typeof extrasInput>;

/** Validates references (issues exist, character exists) and upserts only the provided fields. */
export async function saveExtras(db:CatalogDb,profile:{id:string;userId:string},input:ExtrasInput){
 const issueIds=[input.favoriteIssueId,input.grailIssueId].filter((v):v is number=>typeof v==='number');
 if(issueIds.length){const found=await catalogIssuesById(db,issueIds);if(new Set(found.map(i=>i.id)).size!==new Set(issueIds).size)throw new ExtrasError('Pick that comic from the Directory again.')}
 if(typeof input.favoriteCharacterId==='number'&&!await characterPage(db,input.favoriteCharacterId))throw new ExtrasError('Pick a character from the Character Directory.');
 const columns:[string,unknown][]=[];
 if(input.tags!==undefined)columns.push(['tags',JSON.stringify(input.tags)]);
 if(input.favoriteCharacterId!==undefined)columns.push(['favorite_character_id',input.favoriteCharacterId]);
 if(input.favoriteIssueId!==undefined)columns.push(['favorite_issue_id',input.favoriteIssueId]);
 if(input.grailIssueId!==undefined)columns.push(['grail_issue_id',input.grailIssueId]);
 if(input.grailReward!==undefined)columns.push(['grail_reward',input.grailReward]);
 if(input.shareWishlist!==undefined)columns.push(['share_wishlist',input.shareWishlist]);
 if(input.shareReviews!==undefined)columns.push(['share_reviews',input.shareReviews]);
 if(input.shareCity!==undefined)columns.push(['share_city',input.shareCity]);
 if(input.shopWindow!==undefined)columns.push(['shop_window',input.shopWindow]);
 await upsertExtras(profile,columns);
}
export class ExtrasError extends Error{status=400}
/** Column names are fixed by the callers above, never user input. */
export async function upsertExtras(profile:{id:string;userId:string},columns:[string,unknown][]){
 const names=columns.map(([name])=>name),values=columns.map(([,value])=>value);
 const insertCols=['profile_id','user_id',...names],placeholders=insertCols.map((name,i)=>name==='tags'?`$${i+1}::jsonb`:`$${i+1}`);
 const updates=names.map(name=>`${name}=EXCLUDED.${name}`).concat(['user_id=EXCLUDED.user_id','updated_at=now()']);
 await getPool().query(`INSERT INTO ch_web.profile_extras (${insertCols.join(',')}) VALUES (${placeholders.join(',')}) ON CONFLICT (profile_id) DO UPDATE SET ${updates.join(',')}`,[profile.id,profile.userId,...values]);
}
