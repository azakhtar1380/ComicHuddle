// Issue profile for the detail page: key-issue reasons, first appearances, characters,
// teams, credits and description (lib/characters.ts). Never fails on a missing migration.
import {getDb} from '../../../../../db';
import {emptyProfile,issueProfile,profileIssueId} from '../../../../../lib/characters';
export const runtime='nodejs';
const CACHE='public, s-maxage=300, stale-while-revalidate=86400';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const id=profileIssueId((await params).id);
 if(id===null)return Response.json({error:'Use a valid directory issue ID.'},{status:400,headers:{'Cache-Control':'no-store'}});
 try{
  const profile=await issueProfile(getDb(),id,{deadlineMs:Date.now()+2500});
  if(!profile)return Response.json({error:'Directory issue not found.'},{status:404,headers:{'Cache-Control':'public, s-maxage=300'}});
  // A pending profile is re-checked sooner.
  return Response.json(profile,{headers:{'Cache-Control':profile.status==='pending'?'public, s-maxage=30, stale-while-revalidate=300':CACHE}});
 }catch(error){
  let cause:unknown=error,code='unknown';for(let depth=0;depth<5&&cause;depth++){const item=cause as {code?:string;cause?:unknown};if(item.code)code=item.code;cause=item.cause}
  console.error('Issue profile read stopped; database code '+code);
  return Response.json(emptyProfile(id),{headers:{'Cache-Control':'no-store'}});
 }
}
