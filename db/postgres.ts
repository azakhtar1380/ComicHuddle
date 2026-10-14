import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, types } from 'pg';
types.setTypeParser(20, value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds the application range.');
  return number;
});
types.setTypeParser(1700, value => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Database numeric result is not finite.');
  return number;
});
const globalPool = globalThis as typeof globalThis & { comicHuddlePool?: Pool };
export function getPool(): Pool {
  if (globalPool.comicHuddlePool) return globalPool.comicHuddlePool;
  for (const key of ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
    if (!process.env[key]) throw new Error(`Missing server database setting ${key}.`);
  }
  if (process.env.DB_SSL !== 'true') throw new Error('Database TLS must be enabled.');
  const host = process.env.DB_HOST!;
  const ca = readFileSync(resolve(process.cwd(), 'certificates/rds-ca.pem'), 'utf8');
  globalPool.comicHuddlePool = new Pool({
    host, port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    ssl: { ca, rejectUnauthorized: true, servername: host },
    max: 4, idleTimeoutMillis: 20000, connectionTimeoutMillis: 10000,
    options: '-c search_path=ch_web,gcd,public -c statement_timeout=15000',
  });
  return globalPool.comicHuddlePool;
}
