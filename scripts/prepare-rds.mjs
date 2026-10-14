import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const url = 'https://truststore.pki.rds.amazonaws.com/us-east-2/us-east-2-bundle.pem';
const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
if (!response.ok) throw new Error('AWS RDS trust bundle unavailable.');
const ca = await response.text();
if (!ca.includes('-----BEGIN CERTIFICATE-----')) throw new Error('Invalid AWS trust bundle.');
await mkdir('certificates', { recursive: true });
await writeFile('certificates/rds-ca.pem', ca);
if (process.env.MIGRATE_ON_BUILD === 'true' && (!process.env.VERCEL || process.env.VERCEL_ENV === 'production')) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-postgres.ts'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('ComicHuddle database migration failed.');
  const seed = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/seed-real-data.ts'], { stdio: 'inherit' });
  if (seed.status !== 0) throw new Error('ComicHuddle reviewed catalog seed failed.');
  const covers = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/seed-cover-references.ts'], { stdio: 'inherit' });
  if (covers.status !== 0) throw new Error('ComicHuddle cover-reference seed failed.');
}
