import {getDb} from '../../../../../db';
import {issueInsights,validIssueId} from '../../../../../lib/issue-insights';
import {normalizeGrade} from '../../../../../lib/issue-insights-core';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'no-store'};
// Public market data only (no viewer-specific fields), so it is safe to cache at the CDN.
const cached={'Cache-Control':'public, s-maxage=300, stale-while-revalidate=3600'};

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const id=validIssueId((await params).id);
 if(id===null)return Response.json({error:'Invalid issue id.'},{status:400,headers:noStore});
 const rawGrade=new URL(request.url).searchParams.get('grade');
 const grade=rawGrade===null||rawGrade===''?null:normalizeGrade(rawGrade);
 if(rawGrade&&(grade===null||!/^\s*(10(\.0)?|[0-9](\.[0-9])?)\s*$/.test(rawGrade)))return Response.json({error:'Invalid grade. Use a CGC grade such as 9.8.'},{status:400,headers:noStore});
 try{
  const result=await issueInsights(getDb(),id,{grade});
  if(!result)return Response.json({error:'Issue not found.'},{status:404,headers:noStore});
  return Response.json(result,{headers:cached});
 }catch{
  return Response.json({error:'Sales data is temporarily unavailable.'},{status:503,headers:noStore});
 }
}
