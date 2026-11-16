// Serves our own copies of Metron covers from the private S3 bucket until CloudFront is
// available (then METRON_COVER_CDN_BASE points at CloudFront and this route goes unused).
// Only the copiers' exact key shapes are readable (covers, plus character portraits from
// scripts/import-characters.ts); responses are cached at the edge.
import {GetObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {catalogArtCovers} from '../../../../lib/cover-policy';
export const runtime='nodejs';
const IMAGE=/^(metron\/[1-9][0-9]{0,9}\/(card|dense)|metron-characters\/[1-9][0-9]{0,9}\/portrait)\.webp$/,MANIFEST='metron/manifest.ndjson.gz';
let client:S3Client|null=null;
// Vercel reserves AWS_* names, so deployed credentials use COVER_AWS_*; local runs may use AWS_*.
function s3(){const e=process.env,id=e.COVER_AWS_ACCESS_KEY_ID,secret=e.COVER_AWS_SECRET_ACCESS_KEY;return client??=new S3Client({region:e.COVER_AWS_REGION||e.AWS_REGION||'us-east-2',...(id&&secret?{credentials:{accessKeyId:id,secretAccessKey:secret}}:{})})}
export async function GET(_request:Request,{params}:{params:Promise<{key:string[]}>}){
 const key=(await params).key.join('/'),bucket=process.env.COVER_S3_BUCKET;
 if(!bucket||!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))return new Response('Cover storage is not configured.',{status:503});
 const image=IMAGE.test(key);if(!image&&key!==MANIFEST)return new Response('Not found.',{status:404});
 // Copied Metron art is not shown while catalog art is off (lib/cover-policy.ts).
 if(image&&!catalogArtCovers())return new Response('Not found.',{status:404,headers:{'Cache-Control':'no-store'}});
 try{
  const object=await s3().send(new GetObjectCommand({Bucket:bucket,Key:key}));
  const body=await object.Body!.transformToByteArray();
  return new Response(Buffer.from(body),{headers:{'Content-Type':image?'image/webp':'application/gzip','Cache-Control':image?'public, max-age=31536000, s-maxage=31536000, immutable':'public, max-age=300, s-maxage=300','X-Content-Type-Options':'nosniff'}});
 }catch(error){
  const name=(error as {name?:string})?.name;
  if(name==='NoSuchKey'||name==='NotFound'||name==='AccessDenied')return new Response('Not found.',{status:404,headers:{'Cache-Control':'public, max-age=60'}});
  console.warn('cover-cdn read failed',name);return new Response('Cover temporarily unavailable.',{status:502});
 }
}
