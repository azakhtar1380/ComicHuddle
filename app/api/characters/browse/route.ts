// Character browsing for the /characters page (lib/characters.ts browseCharacters).
import {getDb} from '../../../../db';
import {browseCharacters,characterBrowseParams} from '../../../../lib/characters';
export const runtime='nodejs';
export async function GET(request:Request){
 const parsed=characterBrowseParams(new URL(request.url).searchParams);
 if(!parsed)return Response.json({error:'Use letter (a–z or #), sort (popular or az), offset and a limit of 1–60.'},{status:400,headers:{'Cache-Control':'no-store'}});
 try{return Response.json(await browseCharacters(getDb(),parsed),{headers:{'Cache-Control':'public, s-maxage=300, stale-while-revalidate=3600'}})}
 catch{console.error('Character browse stopped');return Response.json({error:'Characters are temporarily unavailable. Please retry.'},{status:503,headers:{'Cache-Control':'no-store'}})}
}
