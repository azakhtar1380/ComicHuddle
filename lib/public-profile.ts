// Server-only summary of a public profile for the /@handle page metadata and its Open Graph image.
// Returns null for unknown, hidden, moderated or deleting profiles, so they 404 and show no meta.
import {eq} from 'drizzle-orm';
import {getDb} from '../db';
import {collections,profiles} from '../db/schema';
import {emptyVault,vaultSchema} from './vault';
import {businessSummary} from './business-profile';
import {profileExtras} from './profile-extras';
import {avatarUrlForProfile} from './avatar';

export const handlePattern=/^[a-z][a-z0-9_]{2,23}$/;
export type PublicProfileSummary={id:string;handle:string;name:string;since:number;comics:number;keys:number;verified:'person'|'business'|null;rating:{stars:number|null;percent:number|null;count:number}|null;avatarUrl:string|null;tagline:string};
export async function publicProfileSummary(rawHandle:string):Promise<PublicProfileSummary|null>{
 const handle=rawHandle.toLowerCase();if(!handlePattern.test(handle))return null;
 try{
  const db=getDb();const [p]=await db.select().from(profiles).where(eq(profiles.handle,handle));
  if(!p||!p.visible||p.moderated||p.deletionStartedAt)return null;
  const [row]=await db.select().from(collections).where(eq(collections.userId,p.userId));
  const vault=row?vaultSchema.parse(JSON.parse(row.data)):emptyVault('Collector');
  const [biz,extras,avatarUrl]=await Promise.all([businessSummary(p.id),profileExtras(db as never,p,vault,false).catch(()=>null),avatarUrlForProfile(p.id)]);
  return {id:p.id,handle:p.handle,name:p.name,since:p.since,comics:vault.books.length,keys:extras?.keys||0,verified:biz.verified?(biz.isBusiness?'business':'person'):null,rating:extras?.rating||null,avatarUrl,tagline:p.tagline};
 }catch{return null}
}
