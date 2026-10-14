import {and,eq,inArray,lt,or,sql} from 'drizzle-orm';
import {getDb} from '../db';
import {writeLimits,accountRestrictions,blocks} from '../db/schema';

type Db=ReturnType<typeof getDb>;
export class ApiRequestError extends Error {
  constructor(message:string,public status:number){super(message);this.name='ApiRequestError'}
}
export function privateJson(data:unknown,status=200,headers:Record<string,string>={}){
  return Response.json(data,{status,headers:{'Cache-Control':'private, no-store',...headers}});
}
export async function isRestricted(db:Db,userId:string,scope='account'){
 return (await db.select().from(accountRestrictions).where(and(eq(accountRestrictions.userId,userId),eq(accountRestrictions.scope,scope)))).length>0;
}
export function chunks<T>(items:T[],size=64):T[][]{
 const out:T[][]=[];for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));return out;
}
export async function blockedPeerIds(db:Db,meId:string,peers:string[]){
 const ids=new Set<string>();
 // Each query binds both sides of the relationship, so 32 IDs keep its total
 // parameters below D1's limit while preserving blocks in either direction.
 for(const batch of chunks([...new Set(peers)],32)){
  const rows=await db.select().from(blocks).where(or(and(eq(blocks.fromId,meId),inArray(blocks.toId,batch)),and(eq(blocks.toId,meId),inArray(blocks.fromId,batch))));
  for(const row of rows)ids.add(row.fromId===meId?row.toId:row.fromId);
 }
 return ids;
}
export async function readBytes(req:Request,maxBytes:number):Promise<Uint8Array>{
  const declared=Number(req.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>maxBytes)throw new ApiRequestError('Request too large.',413);
  if(!req.body)return new Uint8Array();
  const reader=req.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{
    while(true){const {value,done}=await reader.read();if(done)break;if(!value)continue;size+=value.byteLength;
      if(size>maxBytes){await reader.cancel();throw new ApiRequestError('Request too large.',413)}chunks.push(value)}
  }finally{reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}return bytes;
}
export async function readObject(req:Request,maxBytes:number):Promise<Record<string,unknown>>{
  const bytes=await readBytes(req,maxBytes);let value:unknown;
  try{value=JSON.parse(new TextDecoder().decode(bytes))}catch{throw new ApiRequestError('Invalid request.',400)}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiRequestError('Request must be a JSON object.',400);
  return value as Record<string,unknown>;
}

// Persisted fixed-window limits count rejected writes too. Each batch atomically
// increments the account minute/day budgets and the action budget, including when
// concurrent worker requests see the same counter.
export async function enforceWriteLimits(db:Db,userId:string,scope:string,actionMax=30):Promise<Response|null>{
  const stamp=Date.now();
  // Bound maintenance work per request; expired counters are not permanent
  // activity logs and may be purged by any subsequent authenticated write.
  await db.delete(writeLimits).where(inArray(writeLimits.id,db.select({id:writeLimits.id}).from(writeLimits).where(lt(writeLimits.expiresAt,stamp)).limit(100)));
  const limits=[{scope:'all-minute',windowMs:60000,max:120},{scope:'all-day',windowMs:86400000,max:1200},{scope,windowMs:60000,max:actionMax}];
  const statements=limits.map(limit=>{
    const start=Math.floor(stamp/limit.windowMs)*limit.windowMs;
    return db.insert(writeLimits).values({id:JSON.stringify([userId,limit.scope]),userId,windowStart:start,requests:1,expiresAt:start+limit.windowMs})
      .onConflictDoUpdate({target:writeLimits.id,set:{windowStart:start,expiresAt:start+limit.windowMs,requests:sql`CASE WHEN ${writeLimits.windowStart} = ${start} THEN ${writeLimits.requests} + 1 ELSE 1 END`}})
      .returning({requests:writeLimits.requests});
  });
  const counts=await db.batch(statements as [typeof statements[number],...typeof statements]);
  let retry=0;counts.forEach((rows,index)=>{if(rows[0]?.requests>limits[index].max){const limit=limits[index];retry=Math.max(retry,Math.ceil(((Math.floor(stamp/limit.windowMs)+1)*limit.windowMs-stamp)/1000))}});
  if(retry)return privateJson({error:'Too many changes. Please wait before trying again.'},429,{'Retry-After':String(retry)});
  return null;
}
