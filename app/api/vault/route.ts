import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {collections,media,profiles,catalogIssues} from '../../../db/schema';
import {and,eq,inArray} from 'drizzle-orm';
import {vaultSchema,vaultSaveSchema} from '../../../lib/vault';
import {ApiRequestError,enforceWriteLimits,privateJson,readObject,chunks} from '../../../lib/api-security';
import {previewRulesVersion} from '../../../lib/community';
import {sharedProviderIdentity,listingDirectoryId} from '../../../lib/shared-catalog';

async function etag(row:typeof collections.$inferSelect|undefined){
 if(!row)return '"empty"';
 if(row.revision)return '"'+row.revision+'"';
 // Existing saved collections receive a stable version without a data migration.
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.data));
 return '"legacy-'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')+'"';
}

export async function GET(){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in required.'},401);
 const [row]=await getDb().select().from(collections).where(eq(collections.userId,user.userId));
 return privateJson(row?vaultSchema.parse(JSON.parse(row.data)):null,200,{ETag:await etag(row)});
}catch{return privateJson({error:'Could not load your collection. Please retry.'},500)}}

export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in required.'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return privateJson({error:'Request origin rejected.'},403);
 const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'vault',60);if(limited)return limited;
 const raw=await readObject(req,1000000),parsed=vaultSaveSchema.safeParse(raw);
 if(!parsed.success)return privateJson({error:parsed.error.issues.some(issue=>issue.path.includes('catalogId'))?'Select a directory issue that matches the comic’s series and issue number, or save it as an unlinked personal record.':'Check your collection, unique book IDs and owned trade copies.'},400);
 const data=parsed.data;
 const [profile]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));
 if(!profile)return privateJson({error:'Create your free collector profile first.'},403);
 if(profile.moderated)return privateJson({error:'Your account is restricted pending moderation review.'},403);
 if(profile.rulesVersion!==previewRulesVersion||!profile.rulesAcceptedAt)return privateJson({error:'Open your collector profile and accept the current community rules before saving.'},403);
 const wanted=data.wants.filter(id=>sharedProviderIdentity(id)!==null);
 for(const batch of chunks(wanted)){const rows=await db.select({id:catalogIssues.id}).from(catalogIssues).where(inArray(catalogIssues.id,batch));if(rows.length!==batch.length)return privateJson({error:'Select a comic already imported into the shared directory.'},400)}
 const external=[...new Set(data.books.flatMap(b=>{const id=b.externalCatalog?listingDirectoryId(b):null;return id===null?[]:[id]}))];
 const externalRecords=new Map<number,{title:string;number:string}>();
 for(const batch of chunks(external)){const rows=await db.select({id:catalogIssues.id,data:catalogIssues.data}).from(catalogIssues).where(inArray(catalogIssues.id,batch));for(const row of rows)externalRecords.set(row.id,JSON.parse(row.data) as {title:string;number:string})}
 for(const book of data.books){if(!book.externalCatalog)continue;const directoryId=listingDirectoryId(book),record=directoryId===null?undefined:externalRecords.get(directoryId);if(!record&&book.externalCatalog.provider==='GCD')return privateJson({error:'Select a GCD issue already imported into the shared directory.'},400);if(record){book.title=record.title;book.issue='#'+record.number}}
 const ids=[...new Set(data.books.flatMap(b=>b.photoId?[b.photoId]:[]))];
 for(const batch of chunks(ids)){const assets=await db.select().from(media).where(inArray(media.id,batch));if(assets.length!==batch.length||assets.some(m=>m.userId!==user.userId))return privateJson({error:'Only your own photos may be saved.'},403)}
 const expected=req.headers.get('if-match');
 if(!expected)return privateJson({error:'Reload your collection before saving so the latest changes are preserved.'},428);
 const [current]=await db.select().from(collections).where(eq(collections.userId,user.userId));
 if(expected!==await etag(current))return privateJson({error:'Your collection changed in another tab or device. Reload it before saving.'},409);
 const revision=crypto.randomUUID(),serialized=JSON.stringify(data);
 const changed=current
  ?await db.update(collections).set({data:serialized,revision}).where(and(eq(collections.userId,user.userId),eq(collections.revision,current.revision))).returning({userId:collections.userId})
  :await db.insert(collections).values({userId:user.userId,data:serialized,revision}).onConflictDoNothing().returning({userId:collections.userId});
 if(!changed.length)return privateJson({error:'Your collection changed while saving. Reload it before trying again.'},409);
 return privateJson({saved:true},200,{ETag:'"'+revision+'"'});
}catch(error){if(error instanceof ApiRequestError)return privateJson({error:error.message},error.status);return privateJson({error:'Could not save your collection. Please retry.'},500)}}
