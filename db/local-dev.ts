// Local development database (PGlite, in-process Postgres).
// Only used when CH_LOCAL_DB=pglite and NODE_ENV !== 'production'. Never touches RDS.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Pool } from 'pg';

const SKIP = new Set(['003_catalog_ingestion.sql', '005_gcd_snapshot_import.sql']);

export function localDevEnabled() {
  return process.env.CH_LOCAL_DB === 'pglite' && process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1';
}

type Engine = { exec(sql: string): Promise<unknown>; query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; fields: { name: string }[]; affectedRows?: number }> };

async function boot(): Promise<Engine> {
  const { PGlite } = await import('@electric-sql/pglite');
  const engine = new PGlite() as unknown as Engine;
  await engine.exec(`CREATE SCHEMA gcd;
   CREATE TABLE gcd.gcd_publisher(id integer,name text,deleted integer);
   CREATE TABLE gcd.gcd_series(id integer,name text,publisher_id integer,deleted integer);
   CREATE TABLE gcd.gcd_issue(id integer,series_id integer,number text,publication_date text,key_date text,on_sale_date text,price text,page_count numeric,isbn text,barcode text,title text,volume text,variant_of_id integer,variant_name text,rating text,editing text,indicia_frequency text,notes text,created text,modified text,deleted integer);
   CREATE SCHEMA ch_web;`);
  const dir = resolve(process.cwd(), 'db/postgres-migrations');
  for (const name of readdirSync(dir).filter(n => n.endsWith('.sql') && !SKIP.has(n)).sort()) {
    try { await engine.exec(readFileSync(resolve(dir, name), 'utf8')); }
    catch (error) { console.warn(`[local-db] migration ${name} skipped: ${(error as Error).message.slice(0, 160)}`); }
  }
  await engine.exec('SET search_path TO ch_web,gcd,public;');
  await seedSampleCatalog(engine);
  return engine;
}

/** Loads the repository's bibliographic starter export into the native GCD tables so search works locally. */
async function seedSampleCatalog(engine: Engine) {
  try {
    const rows = JSON.parse(readFileSync(resolve(process.cwd(), 'db/catalog-export.json'), 'utf8')) as { title: string; number: string; publisher: string; year: number; variant?: string }[];
    const publishers = [...new Set(rows.map(r => r.publisher))], series = [...new Set(rows.map(r => r.publisher + '|' + r.title))];
    const values: string[] = [];
    const q = (v: string) => `'${String(v).replace(/'/g, "''")}'`;
    await engine.exec(`INSERT INTO gcd.gcd_publisher(id,name,deleted) VALUES ${publishers.map((p, i) => `(${i + 1},${q(p)},0)`).join(',')};`);
    await engine.exec(`INSERT INTO gcd.gcd_series(id,name,publisher_id,deleted) VALUES ${series.map((s, i) => { const [p, t] = s.split('|'); return `(${i + 1},${q(t)},${publishers.indexOf(p) + 1},0)`; }).join(',')};`);
    rows.forEach((r, i) => values.push(`(${900000 + i},${series.indexOf(r.publisher + '|' + r.title) + 1},${q(r.number)},${q(String(r.year))},${q(r.year + '-01-00')},'', '', 32, '', '', '', '', NULL, '', '', '', '', '', '', '', 0)`));
    await engine.exec(`INSERT INTO gcd.gcd_issue(id,series_id,number,publication_date,key_date,on_sale_date,price,page_count,isbn,barcode,title,volume,variant_of_id,variant_name,rating,editing,indicia_frequency,notes,created,modified,deleted) VALUES ${values.join(',')};`);
    const views = await engine.query<{ name: string }>(`SELECT schemaname||'.'||matviewname AS name FROM pg_matviews WHERE schemaname IN ('gcd','ch_web')`);
    for (const view of views.rows) { try { await engine.exec(`REFRESH MATERIALIZED VIEW ${view.name}`); } catch (error) { console.warn(`[local-db] refresh ${view.name}: ${(error as Error).message.slice(0, 120)}`); } }
    console.log(`[local-db] seeded ${rows.length} sample catalog issues`);
    // US ZIP centroids (CC BY 4.0 data shipped in the repo) so city/ZIP fields work locally.
    const postal = JSON.parse(readFileSync(resolve(process.cwd(), 'db/us-postal-centroids.json'), 'utf8')) as { source: string; archiveSha256: string; fetchedAt: string; records: unknown[] };
    await engine.query(`INSERT INTO ch_web.us_postal_centroids(zip,city,state,latitude,longitude,accuracy,source_url,source_sha256,fetched_at)
      SELECT zip,city,state,latitude,longitude,accuracy,$2,$3,$4 FROM jsonb_to_recordset($1::jsonb) AS x(zip text,city text,state text,latitude double precision,longitude double precision,accuracy bigint) ON CONFLICT DO NOTHING`,
      [JSON.stringify(postal.records), postal.source, postal.archiveSha256, postal.fetchedAt]);
    console.log(`[local-db] seeded ${postal.records.length} US ZIP locations`);
    // Two public-domain Golden Age characters so the Character Directory search works locally.
    await engine.exec(`INSERT INTO ch_web.characters(character_id,name,search_text,issue_count) VALUES
      (900001,'Mysta of the Moon','|mysta of the moon|',12),(900002,'Auro, Lord of Jupiter','|auro, lord of jupiter|auro|',20) ON CONFLICT DO NOTHING`);
  } catch (error) { console.warn('[local-db] sample catalog seed skipped: ' + (error as Error).message.slice(0, 200)); }
}

export function localDevPool(): Pool {
  const g = globalThis as typeof globalThis & { chLocalEngine?: Promise<Engine>; chLocalReady?: Promise<Engine> };
  g.chLocalEngine ??= boot();
  const make = (ready: () => Promise<Engine>) => {
    const query = async (config: string | { text: string; values?: unknown[]; rowMode?: string }, values: unknown[] = []) => {
      const engine = await ready();
      const text = typeof config === 'string' ? config : config.text;
      const params = typeof config === 'string' ? values : (config.values ?? values);
      const result = await engine.query<Record<string, unknown>>(text, params);
      const arrayMode = typeof config !== 'string' && config.rowMode === 'array';
      return { ...result, rowCount: result.affectedRows ?? result.rows.length, command: '', rows: arrayMode ? result.rows.map(row => result.fields.map(f => row[f.name])) : result.rows };
    };
    const pool = { query, connect: async () => ({ query, release() {} }), on() { return pool; }, end: async () => {} };
    return pool as unknown as Pool;
  };
  // Account tables come from Better Auth's own migration runner, as in scripts/migrate-postgres.ts.
  g.chLocalReady ??= g.chLocalEngine.then(async engine => {
    try {
      const [{ getMigrations }, { authOptions }] = await Promise.all([import('better-auth/db/migration'), import('../lib/auth')]);
      await (await getMigrations(authOptions(make(() => g.chLocalEngine!)))).runMigrations();
      console.log('[local-db] account tables ready');
    } catch (error) { console.warn('[local-db] account migration failed: ' + (error as Error).message.slice(0, 200)); }
    return engine;
  });
  return make(() => g.chLocalReady!);
}
