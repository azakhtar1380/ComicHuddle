import {z} from 'zod';
import {getDb} from '../../../db';
import {getChatGPTUser} from '../../chatgpt-auth';
import {listingDraftSchema,type ListingDraft} from '../../../lib/listing-draft';
import {deleteDraft,listDrafts,readDraft,writeDraft} from '../../../lib/listing-drafts';
import {ApiRequestError,privateJson,readObject,enforceWriteLimits} from '../../../lib/api-security';
export const runtime='nodejs';export const dynamic='force-dynamic';
const draftId=z.string().uuid();
/** ?list=1 → the seller's drafts (newest first). ?id=<uuid>|latest → one draft; an unknown id is a new, empty draft. */
export async function GET(request:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to load your drafts.'},401);
 const url=new URL(request.url),db=getDb();
 if(url.searchParams.get('list')==='1')return privateJson({drafts:await listDrafts(db,user.userId)});
 const id=url.searchParams.get('id')||'latest';if(id!=='latest'&&!draftId.safeParse(id).success)return privateJson({error:'Choose a valid draft.'},400);
 return privateJson(await readDraft(db,user.userId,id));
}catch{return privateJson({error:'The saved draft could not connect. Your browser copy is retained.'},503)}}
export async function PUT(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)return privateJson({error:'Origin rejected.'},403);const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to save your private draft.'},401);
 const input=z.object({draftId,baseRevision:z.string().uuid().nullable(),draft:listingDraftSchema}).strict().parse(await readObject(request,650000)),db=getDb(),limited=await enforceWriteLimits(db,user.userId,'listing:draft',120);if(limited)return limited;
 const result=await writeDraft(db,user.userId,{draftId:input.draftId,baseRevision:input.baseRevision,draft:input.draft as ListingDraft});
 return result?privateJson(result):privateJson({error:'This draft changed in another tab. Your current selection is retained; reload the saved draft before overwriting it.'},409);
 }catch(error){if(error instanceof ApiRequestError)return privateJson({error:error.message},error.status);if(error instanceof z.ZodError)return privateJson({error:'The draft contains invalid fields. Your current selection is retained.'},400);return privateJson({error:'The draft could not be confirmed. Your current selection is retained.'},503)}}
export async function DELETE(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)return privateJson({error:'Origin rejected.'},403);const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in required.'},401);
 const url=new URL(request.url),id=url.searchParams.get('id'),revision=url.searchParams.get('revision');
 if(!id||!draftId.safeParse(id).success||revision&&!z.string().uuid().safeParse(revision).success)return privateJson({error:'Choose the draft to delete.'},400);
 return privateJson(await deleteDraft(getDb(),user.userId,id,revision));
}catch{return privateJson({error:'The saved draft could not be cleared.'},503)}}
