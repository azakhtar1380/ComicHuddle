// This checks a real embedded Postgres engine, not a SQL-string mock.
import assert from 'node:assert/strict';
import {createPostgres, createReporter} from './runtime.mjs';

const db = await createPostgres();
const reporter = createReporter('PostgreSQL isolated environment');
let engine;
await reporter.test('Version is actual PostgreSQL with explicit engine attribution', async () => {
  engine = (await db.query('SELECT version() AS version, current_user AS actor')).rows[0];
  assert.match(engine.version, /^PostgreSQL \d+\.\d+/);
  assert.equal(engine.actor, db.engineKind === 'native-postgresql' ? 'qa_owner' : 'postgres');
  console.log('ENGINE ' + JSON.stringify(engine));
});
await reporter.test('Restricted role observes RLS and transaction role context resets', async () => {
  await db.exec(`CREATE ROLE qa_reader NOLOGIN;
    CREATE TABLE qa_private(owner text NOT NULL);
    INSERT INTO qa_private VALUES('alice'),('bob');
    ALTER TABLE qa_private ENABLE ROW LEVEL SECURITY;
    CREATE POLICY owner_only ON qa_private FOR SELECT
      USING(owner=current_setting('app.user_id',true));
    GRANT SELECT ON qa_private TO qa_reader;`);
  await db.transaction(async tx => {
    await tx.exec("SET LOCAL ROLE qa_reader; SET LOCAL app.user_id='alice';");
    assert.deepEqual((await tx.query('SELECT owner FROM qa_private')).rows, [{owner: 'alice'}]);
  });
  assert.equal((await db.query('SELECT current_user AS actor')).rows[0].actor, engine.actor);
  await db.transaction(async tx => {
    await tx.exec("SET LOCAL ROLE qa_reader; SET LOCAL app.user_id='outsider';");
    assert.deepEqual((await tx.query('SELECT owner FROM qa_private')).rows, []);
  });
});
await reporter.test('Failed transaction rolls back all preceding SQL writes', async () => {
  await assert.rejects(db.transaction(async tx => {
    await tx.query('INSERT INTO qa_private(owner) VALUES($1)', ['rolled-back']);
    await tx.query('INSERT INTO table_that_does_not_exist(owner) VALUES($1)', ['abort']);
  }), error => error.code === '42P01');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM qa_private WHERE owner='rolled-back'")).rows[0].n, 0);
});
if (db.openSecondary) await reporter.test('Separate clients reach distinct PostgreSQL backend connections', async () => {
  const other = await db.openSecondary();
  try {assert.notEqual((await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
    (await other.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);}
  finally {await other.close();}
});
reporter.finish({engine: engine?.version, engineKind: db.engineKind, genuineProviderCalls: 0, paymentExecutions: 0,
  connectionConcurrency: db.openSecondary ? 'Separate backends verified; domain races have their own cases' : 'NOT EXECUTED: PGlite has one backend connection'});
await db.close();
