// Clean profile link: /@handle is rewritten here (next.config.ts). Renders the app on that collector's profile,
// with Open Graph/Twitter meta. Hidden, moderated or unknown profiles return 404 to other people and no meta.
import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {headers} from 'next/headers';
import {eq} from 'drizzle-orm';
import {getChatGPTUser} from '../../chatgpt-auth';
import Hub from '../../hub';
import {ownerAccountId} from '../../../lib/owner';
import {getDb} from '../../../db';
import {profiles} from '../../../db/schema';
import {handlePattern,publicProfileSummary} from '../../../lib/public-profile';

export const dynamic='force-dynamic';
type Params={params:Promise<{handle:string}>};
const clean=(raw:string)=>decodeURIComponent(raw).replace(/^@/,'').toLowerCase();

export async function generateMetadata({params}:Params):Promise<Metadata>{
 const handle=clean((await params).handle),p=await publicProfileSummary(handle);
 if(!p)return {title:'Profile not found · ComicHuddle',robots:{index:false}};
 const title=`${p.name} (@${p.handle}) on ComicHuddle`,description=[`${p.comics.toLocaleString('en-US')} ${p.comics===1?'comic':'comics'}`,`${p.keys.toLocaleString('en-US')} ${p.keys===1?'key':'keys'}`,p.rating?(p.rating.stars!==null?`${p.rating.stars.toFixed(1)}★`:`${p.rating.percent}% positive`)+` from ${p.rating.count} reviews`:null,p.verified?(p.verified==='business'?'Verified business':'Verified collector'):null].filter(Boolean).join(' · ');
 const image={url:'/api/og/profile?handle='+encodeURIComponent(p.handle),width:1200,height:630,alt:title};
 const h=await headers(),host=h.get('x-forwarded-host')||h.get('host')||'localhost:3000',proto=h.get('x-forwarded-proto')||(host.startsWith('localhost')||host.startsWith('127.')?'http':'https');
 return {metadataBase:new URL(proto+'://'+host),title,description,alternates:{canonical:'/@'+p.handle},openGraph:{type:'profile',title,description,url:'/@'+p.handle,images:[image],siteName:'ComicHuddle'},twitter:{card:'summary_large_image',title,description,images:[image.url]}};
}

export default async function ProfileLinkPage({params}:Params){
 const handle=clean((await params).handle);
 if(!handlePattern.test(handle))notFound();
 const user=await getChatGPTUser();
 const [p]=await getDb().select({userId:profiles.userId,visible:profiles.visible,moderated:profiles.moderated,deletion:profiles.deletionStartedAt}).from(profiles).where(eq(profiles.handle,handle));
 const own=!!p&&!!user&&p.userId===user.userId;
 if(!p||(!own&&(!p.visible||p.moderated||p.deletion)))notFound();
 return <Hub name={user?.displayName||'Collector'} signedIn={!!user} isOwner={user?.userId===ownerAccountId} initialSection="My Profile" initialCollector={handle}/>;
}
