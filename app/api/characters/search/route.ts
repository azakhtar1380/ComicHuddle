// Character search for the directory filter and the header search suggestions (lib/characters.ts).
import {getDb} from '../../../../db';
import {characterSearchParams,searchCharacters} from '../../../../lib/characters';
export const runtime='nodejs';
export async function GET(request:Request){
 const parsed=characterSearchParams(new URL(request.url).searchParams);
 if(!parsed)return Response.json({error:'Search 2–80 characters with a limit of 1–20.'},{status:400,headers:{'Cache-Control':'no-store'}});
 try{
  const characters=await searchCharacters(getDb(),parsed.q,parsed.limit);
  return Response.json({characters},{headers:{'Cache-Control':'public, s-maxage=300, stale-while-revalidate=86400'}});
 }catch(error){
  let cause:unknown=error,code='unknown';for(let depth=0;depth<5&&cause;depth++){const item=cause as {code?:string;cause?:unknown};if(item.code)code=item.code;cause=item.cause}
  console.error('Character search stopped; database code '+code);
  return Response.json({error:'Character search is temporarily unavailable. Please retry.'},{status:503,headers:{'Cache-Control':'no-store'}});
 }
}
