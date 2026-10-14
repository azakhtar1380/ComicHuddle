import {getDb} from '../db';
import {profiles,blocks,threads} from '../db/schema';
import {and,eq,or} from 'drizzle-orm';
type Db=ReturnType<typeof getDb>;
export async function blocked(db:Db,a:string,b:string){return (await db.select().from(blocks).where(or(and(eq(blocks.fromId,a),eq(blocks.toId,b)),and(eq(blocks.fromId,b),eq(blocks.toId,a))))).length>0}
export async function beginThread(db:Db,p:typeof profiles.$inferSelect,to:string,context=''){
 if(p.id===to)throw Error('You cannot message yourself.');
 const [target]=await db.select().from(profiles).where(eq(profiles.id,to));if(!target||!target.visible||!target.dmOpen||await blocked(db,p.id,to))throw Error('This collector is not accepting messages.');
 const [a,b]=[p.id,to].sort(),pair=a+':'+b;await db.insert(threads).values({id:crypto.randomUUID(),pair,a,b,context,createdAt:new Date().toISOString()}).onConflictDoNothing();
 const [thread]=await db.select().from(threads).where(eq(threads.pair,pair));return thread;
}
