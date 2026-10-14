import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getMigrations } from 'better-auth/db/migration';
import { getPool } from '../db/postgres';
import { authOptions } from '../lib/auth';
import { getDb } from '../db';
import { seedStarterStatements } from '../lib/catalog-store';
import { catalogIssues } from '../db/schema';
import { catalogSearchText } from '../lib/shared-catalog';
import type { Issue } from '../lib/catalog';

const pool = getPool(), client = await pool.connect();
try {
  await client.query("SET statement_timeout='120s'; SET lock_timeout='30s'");
  await client.query("SELECT pg_advisory_lock(hashtext('comichuddle-original-migration'))");
  await client.query('CREATE SCHEMA IF NOT EXISTS ch_web');
  await client.query('CREATE TABLE IF NOT EXISTS ch_web.schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const directory = new URL('../db/postgres-migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    const source = await readFile(new URL(name, directory), 'utf8');
    const hash = createHash('sha256').update(source).digest('hex');
    const applied = await client.query<{ sha256: string }>('SELECT sha256 FROM ch_web.schema_migrations WHERE name=$1', [name]);
    if (applied.rows[0]) { if (applied.rows[0].sha256 !== hash) throw Error('Applied database migration was modified.'); continue; }
    await client.query('BEGIN');
    try {
      console.log('Applying PostgreSQL migration: '+name);
      await client.query(source);
      await client.query('INSERT INTO ch_web.schema_migrations(name,sha256) VALUES ($1,$2)', [name, hash]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
  const authentication = await getMigrations(authOptions(pool));
  await authentication.runMigrations();
  await getDb().batch(seedStarterStatements(getDb(), new Date().toISOString()));
  let exported: Issue[] = [];
  try { exported = JSON.parse(await readFile(new URL('../db/catalog-export.json', import.meta.url), 'utf8')) as Issue[]; }
  catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; }
  for (let start = 0; start < exported.length; start += 25) {
    const db = getDb();
    await db.batch(exported.slice(start, start + 25).map(issue => {
      if (!Number.isSafeInteger(issue.id) || !issue.title || !issue.number || !issue.publisher) throw Error('Invalid approved catalog export.');
      const row = { id: issue.id, metronId: issue.metronId || null, gcdId: issue.gcdId || null,
        title: issue.title, number: issue.number, publisher: issue.publisher, year: issue.year,
        era: issue.era, kind: issue.kind, searchText: catalogSearchText(issue), data: JSON.stringify(issue),
        fetchedAt: '2026-10-14T05:01:05.272Z' };
      // A deployment never overwrites subsequent operator imports or live edits.
      return db.insert(catalogIssues).values(row).onConflictDoNothing();
    }));
  }
  if (exported.length) console.log(`Approved central catalog seeded: ${exported.length} records.`);
  console.log('Original ComicHuddle PostgreSQL schema, accounts and central directory initialized.');
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('comichuddle-original-migration'))");
  client.release(); await pool.end();
}
