import {getDb} from '../../../db';
import {locationChoices} from '../../../lib/location-search';
export async function GET(request:Request){try{
 const q=new URL(request.url).searchParams.get('q')||'';
 return Response.json({choices:await locationChoices(getDb(),q),attribution:'GeoNames',approximate:true},{headers:{'Cache-Control':'public, max-age=300'}});
}catch{return Response.json({error:'Location suggestions are unavailable.'},{status:503})}}
