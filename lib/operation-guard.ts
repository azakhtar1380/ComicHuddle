import {eq,sql,type SQL} from 'drizzle-orm';
import {getDb} from '../db';
import {operationGuard} from '../db/schema';

type Db=ReturnType<typeof getDb>;
// Insert first and delete last in the same PostgreSQL transaction. An invalid condition must
// write valid=0 so the CHECK aborts, rather than silently selecting zero rows.
export function conditionalGuard(db:Db,valid:SQL){
 const id=crypto.randomUUID();return {
  start:db.insert(operationGuard).values({id,valid:sql<number>`CASE WHEN ${valid} THEN 1 ELSE 0 END`}),
  finish:db.delete(operationGuard).where(eq(operationGuard.id,id))
 };
}
export function operationGuardFailed(error:unknown){
 let current=error;
 for(let i=0;i<5&&current&&typeof current==='object';i++){
  const value=current as {message?:unknown;cause?:unknown};
  if(typeof value.message==='string'&&value.message.includes('operation_guard_valid'))return true;
  current=value.cause;
 }
 return false;
}
