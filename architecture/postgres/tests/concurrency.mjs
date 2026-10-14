// Prepared server-only tests. NOT executed by the PGlite run (one backend).
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createReporter,loadTypeScriptModule,plain} from './runtime.mjs';
import {database,directory,copy,listing,ids} from './fixtures.mjs';

const db=await database(),report=createReporter('Native PostgreSQL separate-connection concurrency');
if(!db.openSecondary){await db.close();console.error('NOT EXECUTED: concurrency requires native PostgreSQL separate clients.');process.exitCode=78;}
else{
  const other=await db.openSecondary(),moderation=loadTypeScriptModule('architecture/postgres/moderation.ts');
  const waitForLock=async pid=>{
    for(let turn=0;turn<100;turn++){
      const row=(await db.query('SELECT count(*)::int AS n FROM pg_locks WHERE pid=$1 AND NOT granted',[pid])).rows[0];
      if(row?.n>0)return;await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.fail('Second native backend did not reach an observable lock wait');
  };
  await report.test('Competing ACTIVE claims serialize at the unique physical-copy reservation',async()=>{
    const d=await directory(db),owned=await copy(db,d),a=await listing(db,[owned],{status:'DRAFT'}),b=await listing(db,[owned],{status:'DRAFT'});
    const otherPid=(await other.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await db.exec('BEGIN');await other.exec('BEGIN');
    let pending;
    try{
      await db.query("UPDATE comichuddle.marketplace_listings SET status='ACTIVE' WHERE id=$1",[a.id]);
      pending=other.query("UPDATE comichuddle.marketplace_listings SET status='ACTIVE' WHERE id=$1",[b.id]);
      const observed=pending.then(()=>({unexpected:true}),error=>({code:error.code}));
      await waitForLock(otherPid);await db.exec('COMMIT');
      assert.equal((await observed).code,'23505');await other.exec('ROLLBACK');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM comichuddle.listing_items WHERE copy_id=$1 AND reservation_active',[owned])).rows[0].n,1);
    }finally{await db.exec('ROLLBACK');await other.exec('ROLLBACK');}
  });
  await report.test('Overlapping identical merge requests return one durable idempotent outcome',async()=>{
    const reviewId=randomUUID(),custom=await directory(db,{custom:true,reviewId}),target=await directory(db);
    await listing(db,[await copy(db,custom)]);
    const input={reviewId,targetDirectoryId:target,expectedSourceVersion:'1',expectedTargetVersion:'1',requestId:randomUUID(),actorUserId:ids.admin};
    await db.exec('BEGIN');await other.exec('BEGIN');
    try{
      await db.query("SELECT set_config('app.user_id',$1,true)",[ids.admin]);await other.query("SELECT set_config('app.user_id',$1,true)",[ids.admin]);
      const first=await moderation.mergeCustomEdition(db,input),otherPid=(await other.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending=moderation.mergeCustomEdition(other,input);await waitForLock(otherPid);await db.exec('COMMIT');
      const second=await pending;await other.exec('COMMIT');assert.deepEqual(plain(second),plain(first));
      assert.equal((await db.query('SELECT count(*)::int AS n FROM comichuddle.moderation_audit WHERE request_id=$1',[input.requestId])).rows[0].n,1);
    }finally{await db.exec('ROLLBACK');await other.exec('ROLLBACK');}
  });
  report.finish({genuineProviderCalls:0,paymentExecutions:0,engineKind:db.engineKind});
  await other.close();await db.close();
}
